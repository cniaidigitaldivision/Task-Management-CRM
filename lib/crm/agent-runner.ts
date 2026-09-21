import 'server-only';

import { type AgentDecision, type AgentPurpose, decideAgentReply } from '@/lib/ai/agent-brain';
import { runDueFollowUps } from '@/lib/crm/followup-sender';
import { withAppRole } from '@/lib/db/client';
import {
  AGENT_MINUTES,
  AGENT_SLOT_RULES,
  type AgentBookingKind,
  availabilityLines,
  describeKarachi,
  describeToday,
  freeStarts,
  parseKarachiLocal,
  toKarachiLocal,
} from '@/lib/domain/crm-agent-slots';
import { handoverBeforeModel } from '@/lib/domain/crm-agent-guard';
import { sendableFileName } from '@/lib/domain/document-file-name';
import { purposeLabel } from '@/lib/domain/crm-followup-plans';
import { templateForPurpose, templateVarsFor } from '@/lib/domain/crm-template-for-purpose';
import { listTemplates, sendMedia, sendText } from '@/lib/crm/whatsapp';
import { downloadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * THE AGENT, ACTING — one inbound message in, at most one answer out
 * ----------------------------------------------------------------------------
 * Called from the WhatsApp webhook after a client's message is stored, for a
 * lead whose reply mode is "AI agent". `agent-brain.ts` decides; this does it:
 *
 *   · hands over    → `app.crm_agent_hand_over` — the red chip, the bell, and
 *                     the lead drops to Suggestions so nothing else is sent.
 *   · replies       → ordinary text (the client has just written, so the
 *                     24-hour window is open and it is free), then any document
 *                     it chose, then ONE follow-up that cancels itself if they
 *                     answer (231).
 *
 * ── ⚠️ IT RUNS WITH NOBODY SIGNED IN ─────────────────────────────────────
 * Everything goes through 231's definers under `withAppRole`. A plain table
 * read here would return nothing and the agent would answer a conversation it
 * could not see.
 *
 * ── ⚠️ A BURST IS ANSWERED ONCE ──────────────────────────────────────────
 * People send three short lines in a row. Each run waits a few seconds, and only
 * the run holding the NEWEST message answers — having read all three.
 *
 * ── ⚠️ ANY FAILURE HANDS OVER ────────────────────────────────────────────
 * A client who wrote and got silence is the worst outcome. If anything here
 * throws, the conversation goes to a person with the reason attached.
 * ========================================================================= */

export type AgentOutcome =
  | { readonly action: 'replied'; readonly decision: AgentDecision }
  | { readonly action: 'handed_over'; readonly reason: string }
  | { readonly action: 'skipped' | 'superseded' | 'failed'; readonly reason: string }
  | { readonly action: 'dry_run'; readonly decision: AgentDecision | null; readonly reason: string | null };

interface Context {
  lead_id: string;
  lead_name: string | null;
  phone: string | null;
  project_id: string;
  project_name: string;
  phone_number_id: string | null;
  business: string;
  owner_id: string | null;
  agent_mode: string;
  handoff_at: string | null;
  window_open: boolean;
  product: string | null;
  message_kind: string;
  message_body: string | null;
  message_voice: boolean;
  newest_inbound: string | null;
  agent_run_length: number;
  stage: string;
}

/** What goes out when the follow-up falls due inside an open window — free text. */
const FOLLOW_UP_TEXT: Record<AgentPurpose, string> = {
  proposal: 'AoA {{lead_first_name}}, just checking whether you had a chance to look at the proposal we shared. Happy to answer any questions.',
  quotation: 'AoA {{lead_first_name}}, did you get a chance to review the quotation we shared? Happy to go through it with you.',
  missing_information: 'AoA {{lead_first_name}}, whenever you have a moment, could you share the details we asked about so we can prepare the right option for you?',
  no_response: 'AoA {{lead_first_name}}, just checking in. Is there anything you would like to know?',
  meeting_feedback: 'AoA {{lead_first_name}}, thank you again for your time. How did you find it?',
  negotiation: 'AoA {{lead_first_name}}, following up on the terms we discussed. Is there anything you would like to adjust?',
  agreement: 'AoA {{lead_first_name}}, the agreement is ready for your review whenever suits you.',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(messageId: string, action: string, reason: string | null, detail: unknown): Promise<void> {
  await withAppRole((tx) => tx`
    select app.crm_agent_log(${messageId}::uuid, ${action}, ${reason}, ${tx.json((detail ?? null) as never)})
  `).catch(() => undefined);
}

/**
 * Hand over — and tell the client somebody is coming.
 *
 * ⚠️ SILENCE IS THE WORST ANSWER. Owner, 2026-09-21, watching a live thread: the
 * agent handed over on *"can you please change time of appointment"* and the
 * client then sent two more messages into nothing. A person would have said "let
 * me check and come back to you". So every handover sends one short line first —
 * inside the 24-hour window, because the client has only just written.
 *
 * ⚠️ ONCE PER HANDOVER, NOT PER MESSAGE. `crm_agent_hand_over` is what sets
 * `agent_handoff_at`; a lead already handed over is not told again (the runner
 * stops before here on the next message anyway).
 */
const HOLDING_LINE = 'Thank you — let me check this with my colleague. They will message you shortly.';

async function handOver(ctx: Context, messageId: string, reason: string, dryRun: boolean): Promise<AgentOutcome> {
  if (!dryRun) {
    const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
    if (token && ctx.phone && ctx.phone_number_id && !ctx.handoff_at) {
      const config = { phoneNumberId: ctx.phone_number_id, token, apiVersion: process.env.META_API_VERSION?.trim() || 'v26.0' };
      const said = await sendText(config, ctx.phone, HOLDING_LINE).catch(() => null);
      if (said) {
        await withAppRole((tx) => tx`
          select app.crm_agent_record_message(${ctx.lead_id}::uuid, ${said.wamid ?? null}, 'text', ${HOLDING_LINE},
                                              null, null, null, null, ${said.ok ? null : (said.error ?? 'refused')})
        `).catch(() => undefined);
      }
    }
    await withAppRole((tx) => tx`select app.crm_agent_hand_over(${ctx.lead_id}::uuid, ${reason})`);
    await log(messageId, 'handed_over', reason, null);
  }
  return { action: 'handed_over', reason };
}

/**
 * 236 · The times the agent may offer, from the salesperson's own diary, and
 * the client's appointment still to come (it may not book a second one).
 */
async function bookingOffer(ownerId: string, leadId: string) {
  const nowMs = Date.now();
  const until = new Date(nowMs + (AGENT_SLOT_RULES.horizonDays + 1) * 86_400_000).toISOString();
  const [diary, existing] = await withAppRole(async (tx) => [
    await tx`select starts_at, minutes from app.crm_agent_diary(${ownerId}::uuid, now(), ${until}::timestamptz)`,
    await tx`select kind, starts_at from app.crm_agent_lead_booked(${leadId}::uuid)`,
  ] as const);
  const busy = (diary as unknown as Array<{ starts_at: Date; minutes: number }>).map((d) => ({
    startMs: new Date(d.starts_at).getTime(),
    minutes: Number(d.minutes),
  }));
  const kinds: readonly AgentBookingKind[] = ['meeting', 'office_visit', 'site_visit'];
  const starts = Object.fromEntries(
    kinds.map((k) => [k, freeStarts(nowMs, busy, AGENT_MINUTES[k])]),
  ) as Record<AgentBookingKind, number[]>;
  const coming = (existing as unknown as Array<{ kind: string; starts_at: Date }>)[0];
  return {
    lines: {
      meeting: availabilityLines(starts.meeting),
      office_visit: availabilityLines(starts.office_visit),
      site_visit: availabilityLines(starts.site_visit),
    },
    starts: {
      meeting: starts.meeting.map(toKarachiLocal),
      office_visit: starts.office_visit.map(toKarachiLocal),
      site_visit: starts.site_visit.map(toKarachiLocal),
    },
    existing: coming
      ? `a ${coming.kind === 'meeting' ? 'demo' : coming.kind.replace('_', ' ')} on ${describeKarachi(new Date(coming.starts_at).getTime())}`
      : null,
    today: describeToday(nowMs),
  };
}

const BOOKING_WORD: Readonly<Record<AgentBookingKind, string>> = {
  meeting: 'demo',
  office_visit: 'office visit',
  site_visit: 'site visit',
};

/**
 * Book it through 236's definer, or MOVE the one they already have (244) —
 * both check the diary again under a lock.
 */
async function book(
  ctx: Context,
  kind: AgentBookingKind,
  at: string,
  move: boolean,
): Promise<{ ok: true; appointmentId: string; confirmationId: string | null } | { ok: false; reason: string }> {
  const what = BOOKING_WORD[kind];
  const doing = move ? 'move the' : 'book a';
  const atMs = parseKarachiLocal(at);
  if (atMs === null) return { ok: false, reason: `tried to ${doing} ${what} at "${at}", which is not a time` };
  try {
    const when = new Date(atMs).toISOString();
    const rows = (await withAppRole((tx) =>
      move
        ? tx`select appointment_id, confirmation_id
               from app.crm_agent_move(${ctx.lead_id}::uuid, ${when}::timestamptz, ${AGENT_MINUTES[kind]}::integer)`
        : tx`select appointment_id, confirmation_id
               from app.crm_agent_book(${ctx.lead_id}::uuid, ${kind}, ${when}::timestamptz, ${AGENT_MINUTES[kind]}::integer)`,
    )) as unknown as Array<{ appointment_id: string; confirmation_id: string | null }>;
    if (!rows[0]?.appointment_id) return { ok: false, reason: `tried to ${doing} ${what} and nothing was written` };
    return { ok: true, appointmentId: rows[0].appointment_id, confirmationId: rows[0].confirmation_id };
  } catch (error) {
    const why = error instanceof Error ? error.message.slice(0, 120) : 'it was refused';
    return { ok: false, reason: `tried to ${doing} ${what} for ${describeKarachi(atMs)}, but ${why}` };
  }
}

export async function runAgentOnMessage(
  messageId: string,
  opts: { dryRun?: boolean; debounceMs?: number } = {},
): Promise<AgentOutcome> {
  const dryRun = opts.dryRun === true;

  /* ── ⚠️ THE CHEAP QUESTION FIRST. Every inbound message on every lead comes
     through here; only the ones on "AI agent" should cost a claim row and a
     wait. Nothing is written for the rest. */
  const first = (await withAppRole((tx) => tx`
    select agent_mode, handoff_at from app.crm_agent_context(${messageId}::uuid)
  `)) as unknown as Array<{ agent_mode: string; handoff_at: string | null }>;
  if (!first[0] || (!dryRun && (first[0].agent_mode !== 'agent' || first[0].handoff_at))) {
    return { action: 'skipped', reason: 'not on AI agent' };
  }

  /* ── Claim it, so it is answered once ──────────────────────────────── */
  if (!dryRun) {
    const claimed = (await withAppRole((tx) => tx`select app.crm_agent_claim(${messageId}::uuid) as ok`)) as unknown as Array<{ ok: boolean }>;
    if (!claimed[0]?.ok) return { action: 'skipped', reason: 'already handled' };
    await sleep(opts.debounceMs ?? 6000);
  }

  const rows = (await withAppRole((tx) => tx`select * from app.crm_agent_context(${messageId}::uuid)`)) as unknown as Context[];
  const ctx = rows[0];
  if (!ctx) return { action: 'skipped', reason: 'message not found' };

  const stop = async (action: 'skipped' | 'superseded' | 'failed', reason: string): Promise<AgentOutcome> => {
    if (!dryRun) await log(messageId, action, reason, null);
    return { action, reason };
  };

  /* A dry run answers "what WOULD it do", so it skips the two mode checks. */
  if (!dryRun && ctx.agent_mode !== 'agent') return stop('skipped', 'the reply mode is not AI agent');
  if (!dryRun && ctx.handoff_at) return stop('skipped', 'waiting for a person after a handover');
  if (!dryRun && ctx.newest_inbound !== messageId) return stop('superseded', 'a newer message will be answered instead');
  if (!ctx.phone || !ctx.phone_number_id) return stop('failed', 'the lead or the project has no WhatsApp number');

  try {
    /* ── Rules first: voice notes, files, "call me" ─────────────────────── */
    const guard = handoverBeforeModel({
      kind: ctx.message_kind,
      body: ctx.message_body,
      voice: ctx.message_voice,
      agentRunLength: ctx.agent_run_length,
    });
    if (guard) return handOver(ctx, messageId, guard, dryRun);

    /* ── What it may know, how to write, what it may send, what was said ── */
    const [knowledge, rules, documents, thread, named] = await withAppRole(async (tx) => [
      /* ⚠️ EVERY PRODUCT, TAGGED (233). A lead filed as Taskly who asks about
         the CRM must be answered about the CRM — the dry run on 2026-09-21
         handed exactly that client over, with the CRM proposal on the shelf.
         agent-brain.ts decides which product's documents may go. */
      await tx`select question, answer, product from app.crm_agent_knowledge(${ctx.project_id}::uuid)`,
      await tx`select rule from app.crm_pilot_rules_for(${ctx.owner_id}::uuid, ${ctx.project_id}::uuid)`,
      await tx`select * from app.crm_agent_documents(${ctx.project_id}::uuid, null)`,
      await tx`select * from app.crm_agent_thread(${ctx.lead_id}::uuid, 30)`,
      await tx`select coalesce(app.crm_first_name(${ctx.lead_name}), 'there') as first`,
    ] as const);

    const knowledgeRows = knowledge as unknown as Array<{ question: string; answer: string; product: string }>;
    if (knowledgeRows.length === 0) {
      return handOver(ctx, messageId, 'nothing is approved for the assistant to say yet', dryRun);
    }
    const docRows = documents as unknown as Array<{ id: string; title: string; kind: string; product: string; storage_path: string; mime: string; size_bytes: number }>;
    const threadRows = thread as unknown as Array<{ direction: string; kind: string; body: string | null; media_filename: string | null; sent_by_agent: boolean }>;
    /* A file already in this conversation, by the name it was sent under. */
    const sentFiles = new Set(
      threadRows.filter((m) => m.direction === 'outbound' && m.media_filename).map((m) => m.media_filename!.toLowerCase()),
    );

    /* ── 236 · When it may book: the salesperson's own free times ─────────
       Owner: *"make the build agent booking start with demo and visit. Call is
       not working."* No owner means no diary, and then it may not book. */
    const booking = ctx.owner_id ? await bookingOffer(ctx.owner_id, ctx.lead_id) : null;

    const decision = await decideAgentReply({
      business: ctx.business,
      product: ctx.product,
      clientFirstName: (named as unknown as Array<{ first: string }>)[0]?.first ?? 'there',
      stage: ctx.stage,
      knowledge: knowledgeRows,
      pilotRules: (rules as unknown as Array<{ rule: string }>).map((r) => r.rule),
      documents: docRows.map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        product: d.product,
        alreadySent: sentFiles.has(sendableFileName(d.title, d.mime).toLowerCase()) || sentFiles.has(d.title.toLowerCase()),
      })),
      thread: threadRows.map((m) => ({ direction: m.direction, kind: m.kind, body: m.body, file: m.media_filename, byAgent: m.sent_by_agent })),
      booking,
    });

    if (dryRun) return { action: 'dry_run', decision, reason: decision.handoverReason };
    if (decision.action === 'handover') {
      return handOver(ctx, messageId, decision.handoverReason ?? 'the assistant was not sure how to answer', false);
    }

    /* ── Reply: the words first ────────────────────────────────────────── */
    const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
    const apiVersion = process.env.META_API_VERSION?.trim() || 'v26.0';
    if (!token) return handOver(ctx, messageId, 'WhatsApp is not connected on the server (no token)', false);
    const config = { phoneNumberId: ctx.phone_number_id, token, apiVersion };

    /* ── 236 · A booking: made, and confirmed by the booking's own message ──
       The appointment is an ordinary row, so its confirmation and its reminder
       are the ones a person's booking gets (220/235). That confirmation is sent
       NOW rather than on the next minute's run — and it is the reply, so the
       client does not get "booked!" and then the same news again. */
    if (decision.booking) {
      const made = await book(ctx, decision.booking.kind, decision.booking.at, decision.booking.move);
      if (!made.ok) return handOver(ctx, messageId, made.reason, false);
      if (decision.product) {
        await withAppRole((tx) => tx`select app.crm_agent_note_product(${ctx.lead_id}::uuid, ${decision.product})`);
      }
      let confirmed = false;
      if (made.confirmationId) {
        const reports = await runDueFollowUps(10).catch(() => []);
        confirmed = reports.some((r) => r.followUpId === made.confirmationId && r.outcome === 'sent');
      }
      if (!confirmed) {
        /* No confirmation went (no consent on file, or WhatsApp refused it) —
           so the client is told here. ⚠️ The model's words only when they SAY it
           is booked; when it misjudged a free time they say the opposite, and
           the code's own line is sent instead. */
        const atMs = parseKarachiLocal(decision.booking.at)!;
        const line = decision.booking.replyConfirms && decision.reply
          ? decision.reply
          : `Your ${BOOKING_WORD[decision.booking.kind]} is ${decision.booking.move ? 'moved' : 'booked'} to ${describeKarachi(atMs)}.`;
        const said = await sendText(config, ctx.phone, line);
        await withAppRole((tx) => tx`
          select app.crm_agent_record_message(${ctx.lead_id}::uuid, ${said.wamid ?? null}, 'text', ${line},
                                              null, null, null, null, ${said.ok ? null : (said.error ?? 'refused')})
        `);
      }
      await log(messageId, 'replied', null, { booking: decision.booking, appointmentId: made.appointmentId, confirmed });
      return { action: 'replied', decision };
    }

    const sent = await sendText(config, ctx.phone, decision.reply ?? '');
    await withAppRole((tx) => tx`
      select app.crm_agent_record_message(${ctx.lead_id}::uuid, ${sent.wamid ?? null}, 'text', ${decision.reply},
                                          null, null, null, null, ${sent.ok ? null : (sent.error ?? 'refused')})
    `);
    if (!sent.ok) {
      return handOver(ctx, messageId, `the assistant's reply could not be sent: ${sent.error ?? 'WhatsApp refused it'}`, false);
    }

    /* ── Then any document it chose ────────────────────────────────────── */
    for (const id of decision.documentIds) {
      const doc = docRows.find((d) => d.id === id);
      if (!doc) continue;
      const file = await downloadObject(doc.storage_path);
      if (!file.ok) continue;
      const filename = sendableFileName(doc.title, doc.mime);
      const media = await sendMedia(config, ctx.phone, { data: file.value.data, mime: doc.mime, filename }, null, { asDocument: true });
      await withAppRole((tx) => tx`
        select app.crm_agent_record_message(${ctx.lead_id}::uuid, ${media.wamid ?? null}, 'document', null,
                                            ${doc.mime}, ${filename}, ${doc.storage_path}, ${doc.size_bytes},
                                            ${media.ok ? null : (media.error ?? 'refused')})
      `);
    }

    /* ── Then one follow-up, which closes itself if they answer ────────── */
    if (decision.followUp) {
      const waba = (await withAppRole((tx) => tx`select app.crm_project_waba(${ctx.project_id}::uuid) as waba`)) as unknown as Array<{ waba: string | null }>;
      const list = waba[0]?.waba ? await listTemplates(waba[0].waba, apiVersion) : null;
      const pick = list ? templateForPurpose(decision.followUp.purpose, list) : null;
      await withAppRole((tx) => tx`
        select app.crm_agent_schedule_follow_up(
          ${ctx.lead_id}::uuid, ${decision.followUp!.purpose}, ${decision.followUp!.inDays}::integer,
          ${`${purposeLabel(decision.followUp!.purpose)} · set by the AI agent`},
          ${FOLLOW_UP_TEXT[decision.followUp!.purpose]},
          ${pick?.name ?? null}, ${pick?.language ?? null},
          ${pick ? templateVarsFor(pick.variables) : null}::text[]
        )
      `);
    }

    if (decision.product) {
      await withAppRole((tx) => tx`select app.crm_agent_note_product(${ctx.lead_id}::uuid, ${decision.product})`);
    }

    await log(messageId, 'replied', null, {
      reply: decision.reply,
      documents: decision.documentIds,
      followUp: decision.followUp,
      product: decision.product,
    });
    return { action: 'replied', decision };
  } catch (error) {
    const reason = `the assistant hit an error: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`;
    if (dryRun) return { action: 'failed', reason };
    await log(messageId, 'failed', reason, null);
    return handOver(ctx, messageId, reason, false).catch(() => ({ action: 'failed' as const, reason }));
  }
}
