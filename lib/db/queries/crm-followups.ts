import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * FOLLOW-UPS AND SEQUENCES — the writes behind the drawer's Follow-ups tab
 * ----------------------------------------------------------------------------
 * Every one runs as the person (`withUser`), so RLS decides whose lead it is:
 * 153's policies delegate both tables to `crm_leads`. A lead the caller cannot
 * see matches no row, and the write reports "not yours" rather than an error
 * that says which ids exist.
 *
 * ⚠️ EACH IS ONE TRANSACTION. Stopping a sequence and cancelling what it had
 * already queued, or completing a follow-up and moving the lead's next action
 * on, are one fact each — half of either is a desk that says something false.
 * ========================================================================= */

export type FollowUpWrite =
  | { readonly ok: true; readonly leadId: string }
  | { readonly ok: false; readonly error: string };

const NOT_YOURS = 'That could not be changed. It may not be yours to work.';

/** A refusal raised inside a transaction, so everything it wrote rolls back. */
class Refused extends Error {}

/**
 * ⚠️ "NOT YOURS" ONLY WHEN IT IS NOT. An update that matched nothing has two
 * causes: the row is hidden by RLS, or it is visible and already past the state
 * the button assumed — completed twice, stopped from another tab. The second
 * deserves its real reason, and asking costs one read on a path that already
 * failed.
 */
async function explainMiss(
  tx: Parameters<Parameters<typeof withUser>[1]>[0],
  table: 'crm_follow_ups' | 'crm_lead_sequences',
  id: string,
): Promise<null> {
  const rows = (table === 'crm_follow_ups'
    ? await tx`select status::text as s from public.crm_follow_ups where id = ${id}::uuid`
    : await tx`select state::text as s from public.crm_lead_sequences where id = ${id}::uuid`) as Array<{ s: string }>;
  const state = rows[0]?.s;
  if (!state) return null;
  if (table === 'crm_follow_ups') throw new Refused(`That follow-up is already ${state === 'done' ? 'completed' : state}.`);
  throw new Refused(state === 'stopped' ? 'That sequence has already stopped.' : `That sequence is ${state} — refresh and try again.`);
}

const run = async (actorId: string, fn: Parameters<typeof withUser>[1]): Promise<FollowUpWrite> => {
  try {
    const leadId = (await withUser(actorId, fn)) as string | null;
    return leadId ? { ok: true, leadId } : { ok: false, error: NOT_YOURS };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    const code = (error as { code?: string }).code;
    if (code === '23505') return { ok: false, error: 'This lead already has a sequence running. Stop it first.' };
    if (code === '23514') return { ok: false, error: 'That sequence has no steps to run.' };
    throw error;
  }
};

/* ── Follow-ups a person sets ───────────────────────────────────────────── */

export async function createFollowUp(
  actorId: string,
  input: {
    leadId: string;
    channel: 'whatsapp' | 'email' | 'call' | 'task';
    /** One of `crm_followup_purpose` — what this follow-up is for (185). */
    purpose?: string;
    title: string;
    body: string | null;
    dueAt: string;
    /** ⚠️ Advanced: leave the desk's Next action alone. */
    keepNextAction?: boolean;
  },
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = await tx`
      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
      select l.id, ${input.purpose ?? 'custom'}::public.crm_followup_purpose,
             ${input.channel}::public.crm_followup_channel, 'remind_me',
             (case when ${input.dueAt}::timestamptz <= now() then 'due' else 'planned' end)::public.crm_followup_status,
             ${input.title}, ${input.body}, ${input.dueAt}::timestamptz,
             coalesce(l.owner_id, ${actorId}::uuid), ${actorId}::uuid
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning lead_id
    `;
    if ((rows as unknown[]).length === 0) return null;

    /* ⚠️ THE DESK'S "NEXT ACTION" FOLLOWS. A follow-up set for tomorrow while the
       row still reads "Quotation check-in — overdue" is a table that lies about
       what is owed. It takes over when there is no next action, when the
       current one is already late, or when this one comes sooner. */
    if (!input.keepNextAction) {
      await tx`
        update public.crm_leads
           set next_action = ${input.title},
               next_action_at = ${input.dueAt}::timestamptz,
               next_action_type = ${input.channel}::public.crm_next_action_kind
         where id = ${input.leadId}::uuid
           and (next_action_at is null
                or next_action_at < now()
                or next_action_at > ${input.dueAt}::timestamptz)
      `;
    }
    return input.leadId;
  });
}

/**
 * Close a follow-up — done, with what happened, or cancelled.
 *
 * ⚠️ IF IT WAS THE LEAD'S NEXT ACTION, THE NEXT OPEN ONE TAKES ITS PLACE — or
 * nothing does, and the desk shows "nothing planned", which is then true.
 */
export async function closeFollowUp(
  actorId: string,
  followUpId: string,
  outcome: { done: true; note: string | null } | { done: false },
  /**
   * ⚠️ AND STOP THE CHASE, WHEN THE PERSON SAYS SO. Owner, 2026-09-17: *"if any
   * follow-up is showing, when you mark it as done or complete, it means that
   * follow-up should be stopped."* A salesperson who has just spoken to the
   * client does not want the plan to send the next nudge tomorrow morning — but
   * it is asked on screen rather than assumed, because sometimes the call was
   * the step and the rest of the plan still stands.
   */
  stopPlan = false,
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const closed = (await tx`
      update public.crm_follow_ups
         set status = ${outcome.done ? 'done' : 'cancelled'}::public.crm_followup_status,
             done_at = case when ${outcome.done} then now() else done_at end,
             done_by_id = case when ${outcome.done} then ${actorId}::uuid else done_by_id end,
             outcome_note = case when ${outcome.done} then ${outcome.done ? outcome.note : null} else outcome_note end,
             updated_at = now()
       where id = ${followUpId}::uuid
         and status in ('planned', 'due')
      returning lead_id, title
    `) as Array<{ lead_id: string; title: string }>;
    const row = closed[0];
    if (!row) return explainMiss(tx, 'crm_follow_ups', followUpId);

    await tx`
      update public.crm_leads l
         set next_action = nxt.title,
             next_action_at = nxt.due_at,
             next_action_type = nxt.channel::text::public.crm_next_action_kind
        from (select 1) one
        left join lateral (
          select o.title, o.due_at, o.channel
            from public.crm_follow_ups o
           where o.lead_id = ${row.lead_id}::uuid
             and o.id <> ${followUpId}::uuid
             and o.status in ('planned', 'due')
           order by o.due_at
           limit 1
        ) nxt on true
       where l.id = ${row.lead_id}::uuid
         and l.next_action is not distinct from ${row.title}
    `;

    if (stopPlan) {
      const stopped = (await tx`
        update public.crm_lead_sequences
           set state = 'stopped', stopped_at = now(), paused_at = null,
               pause_reason = 'the follow-up was completed', next_step_at = null, updated_at = now()
         where lead_id = ${row.lead_id}::uuid
           and state in ('scheduled', 'active', 'paused')
        returning id
      `) as Array<{ id: string }>;
      /* Whatever it had already queued goes with it — a stopped chase whose next
         message is still sitting in the queue is not stopped. */
      if (stopped[0]) {
        await tx`
          update public.crm_follow_ups
             set status = 'cancelled', updated_at = now()
           where lead_sequence_id = ${stopped[0].id}::uuid
             and status in ('planned', 'due')
        `;
      }
    }
    return row.lead_id;
  });
}

/* ── Sequences ──────────────────────────────────────────────────────────── */

export async function pauseSequence(actorId: string, leadSequenceId: string, byName: string): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = 'paused', paused_at = now(), pause_reason = ${`paused by ${byName}`},
             next_step_at = null, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active')
      returning lead_id
    `) as Array<{ lead_id: string }>;
    return rows[0]?.lead_id ?? explainMiss(tx, 'crm_lead_sequences', leadSequenceId);
  });
}

/**
 * Resume at a chosen moment — which is what Reschedule means.
 *
 * ⚠️ `resumed_at` IS WHAT MAKES IT STICK (182). Without it, the reply that
 * paused the sequence would pause it again on the engine's next pass.
 *
 * ⚠️ AND IT ASKS THE ENGINE'S OWN STOP-CONDITIONS BEFORE COMMITTING. A lead that
 * has closed, a client who said no, a quotation that expired: resuming those
 * would be a promise the engine immediately breaks. The same function decides
 * both, so the button and the scheduler cannot disagree.
 */
export async function rescheduleSequence(
  actorId: string,
  leadSequenceId: string,
  at: string,
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = (case when current_step = 0 then 'scheduled' else 'active' end)::public.crm_sequence_state,
             paused_at = null, pause_reason = null, resumed_at = now(),
             next_step_at = ${at}::timestamptz, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active', 'paused')
         and current_step < total_steps
      returning lead_id
    `) as Array<{ lead_id: string }>;
    if (!rows[0]) return explainMiss(tx, 'crm_lead_sequences', leadSequenceId);

    const [{ reason }] = (await tx`
      select app.crm_sequence_stop_reason(${leadSequenceId}::uuid) as reason
    `) as Array<{ reason: string | null }>;
    if (reason) throw new Refused(`It cannot run — ${reason}.`);
    return rows[0].lead_id;
  });
}

export async function stopSequence(actorId: string, leadSequenceId: string, byName: string): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = 'stopped', stopped_at = now(), paused_at = null,
             pause_reason = ${`stopped by ${byName}`}, next_step_at = null, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active', 'paused')
      returning lead_id
    `) as Array<{ lead_id: string }>;
    if (!rows[0]) return explainMiss(tx, 'crm_lead_sequences', leadSequenceId);

    /* ⚠️ WHAT IT HAD ALREADY QUEUED GOES TOO. A stopped chase whose next message
       is still sitting in the queue marked auto-send is not stopped. */
    await tx`
      update public.crm_follow_ups
         set status = 'cancelled', updated_at = now()
       where lead_sequence_id = ${leadSequenceId}::uuid
         and status in ('planned', 'due')
    `;
    return rows[0].lead_id;
  });
}

/**
 * Put a lead on a sequence.
 *
 * ⚠️ ONE LIVE SEQUENCE PER LEAD is the database's rule (a unique index), not
 * this function's — two chases on one client is exactly what it prevents.
 * ⚠️ A QUOTATION SEQUENCE IS TIED TO THE LIVE QUOTATION, so 170 stops it the
 * moment that quotation expires or is superseded.
 */
export async function startSequence(
  actorId: string,
  input: { leadId: string; sequenceId: string; firstAt: string | null },
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      insert into public.crm_lead_sequences
        (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at,
         quotation_id, created_by_id)
      select l.id, s.id, 'scheduled', 0,
             (select count(*) from public.crm_sequence_steps st where st.sequence_id = s.id),
             now(),
             coalesce(${input.firstAt}::timestamptz,
                      now() + make_interval(days => coalesce((
                        select greatest(st.delay_days, 0) from public.crm_sequence_steps st
                         where st.sequence_id = s.id and st.step_no = 1), 0))),
             case when s.purpose = 'quotation' then (
               select q.id from public.crm_quotations q
                where q.lead_id = l.id and q.status in ('approved', 'sent', 'pending_approval')
                order by q.version desc, q.created_at desc
                limit 1)
             end,
             ${actorId}::uuid
        from public.crm_leads l
        join public.crm_sequences s
          on s.id = ${input.sequenceId}::uuid
         and s.is_active
         and (s.project_id is null or s.project_id = l.project_id)
       where l.id = ${input.leadId}::uuid
      returning id, lead_id
    `) as Array<{ id: string; lead_id: string }>;
    if (!rows[0]) return null;

    const [{ reason }] = (await tx`
      select app.crm_sequence_stop_reason(${rows[0].id}::uuid) as reason
    `) as Array<{ reason: string | null }>;
    if (reason) throw new Refused(`It cannot start — ${reason}.`);
    return rows[0].lead_id;
  });
}

/* ── A scheduler for ONE lead — migration 185 ────────────────────────────── */

export interface PlanStepRow {
  readonly stepNo: number;
  readonly channel: string;
  readonly delayDays: number;
  readonly title: string;
  readonly body: string | null;
  readonly mode: string;
  readonly subject: string | null;
  readonly onlyIfNoReply: boolean;
  readonly templateName: string | null;
  readonly templateLanguage: string | null;
}

export interface LeadPlanWritten {
  readonly sequenceId: string;
  /** Null when the plan was saved as a draft — nothing is running. */
  readonly leadSequenceId: string | null;
  readonly nextStepAt: string | null;
}

/**
 * "Day 1, day 3, day 7" for one client, written by the person who works them.
 *
 * ⚠️ THE TEMPLATE, ITS STEPS AND THE RUN ARE ONE TRANSACTION. A plan with no
 * steps is a sequence the engine stops on its first pass with "every step has
 * been sent"; a template with no run is an orphan nobody ever sees. Half of this
 * is worse than none of it.
 *
 * ⚠️ AND IT ASKS THE ENGINE WHETHER IT COULD RUN, BEFORE IT COMMITS. The same
 * `app.crm_sequence_stop_reason` the scheduler calls — so a plan that would be
 * stopped on its first pass is refused now, with the engine's own words, rather
 * than appearing to start and dying quietly fifteen minutes later.
 */
export async function createLeadPlan(
  actorId: string,
  input: {
    leadId: string;
    name: string;
    purpose: string;
    stopOnReply: boolean;
    stopOnVisit: boolean;
    stopOnQuotationDead: boolean;
    keepNextAction: boolean;
    /** Business hours in Karachi, or null for the project's quiet hours. */
    hours: { from: number; to: number; days: readonly number[] } | null;
    /** When the first step falls. Null means as soon as its own delay allows. */
    firstAt: string | null;
    /** ⚠️ FALSE SAVES A DRAFT: the plan and its steps, with nothing running. */
    start: boolean;
    steps: readonly PlanStepRow[];
  },
): Promise<(FollowUpWrite & { readonly plan?: LeadPlanWritten })> {
  let plan: LeadPlanWritten | undefined;
  const result = await run(actorId, async (tx) => {
    /* ⚠️ THE PROJECT AND `is_test_data` COME FROM THE LEAD, never from the
       caller. A demo plan on a real lead would be started by the engine and
       reach a real customer; a plan whose project does not match its lead can
       never start at all (`startSequence`'s own join). */
    const made = (await tx`
      insert into public.crm_sequences
        (project_id, lead_id, name, purpose, stop_on_reply, stop_on_visit, stop_on_quotation_dead,
         send_from_hour, send_to_hour, send_days, is_active, is_test_data, created_by_id)
      select l.project_id, l.id, ${input.name}, ${input.purpose}::public.crm_followup_purpose,
             ${input.stopOnReply}, ${input.stopOnVisit}, ${input.stopOnQuotationDead},
             ${input.hours?.from ?? null}, ${input.hours?.to ?? null},
             ${input.hours ? [...input.hours.days] : null}::smallint[],
             true, l.is_test_data, ${actorId}::uuid
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning id
    `) as Array<{ id: string }>;
    if (!made[0]) return null;
    const sequenceId = made[0].id;

    /* One statement for every step — `unnest`, not a loop. Inside a transaction
       each round trip is serial (they share one connection), so six steps would
       otherwise be six waits on Singapore. */
    await tx`
      insert into public.crm_sequence_steps
        (sequence_id, step_no, channel, delay_days, purpose, title, body, mode, subject,
         only_if_no_reply, wa_template_name, wa_template_language)
      select ${sequenceId}::uuid, s.step_no, s.channel::public.crm_followup_channel,
             s.delay_days, ${input.purpose}, s.title, nullif(s.body, ''),
             s.mode::public.crm_followup_mode, nullif(s.subject, ''), s.only_if_no_reply = 1,
             nullif(s.template_name, ''), nullif(s.template_language, '')
        from unnest(
               ${input.steps.map((s) => s.stepNo)}::int[],
               ${input.steps.map((s) => s.channel)}::text[],
               ${input.steps.map((s) => s.delayDays)}::int[],
               ${input.steps.map((s) => s.title)}::text[],
               ${input.steps.map((s) => s.body ?? '')}::text[],
               ${input.steps.map((s) => s.mode)}::text[],
               ${input.steps.map((s) => s.subject ?? '')}::text[],
               /* ⚠️ 1 AND 0, NOT JS booleans. postgres.js infers an array of them
                  as a single boolean and the insert dies with "cannot cast type
                  boolean to boolean[]" — caught the first time a plan was saved
                  from the dialog. Integers infer as int[] reliably.
                  ⚠️ AND NO BACKTICKS IN THIS COMMENT: the query is one template
                  literal and a backtick ends it, which is how this file just
                  failed to parse (the memory note is backticks-break-sql-literals). */
               ${input.steps.map((s) => (s.onlyIfNoReply ? 1 : 0))}::int[],
               ${input.steps.map((s) => s.templateName ?? '')}::text[],
               ${input.steps.map((s) => s.templateLanguage ?? '')}::text[]
             ) as s(step_no, channel, delay_days, title, body, mode, subject, only_if_no_reply,
                    template_name, template_language)
    `;

    /* ⚠️ A DRAFT IS A PLAN WITH NOTHING RUNNING. No new state, no flag on the
       run — there simply is no run until somebody presses Start, which is also
       what makes "one live sequence per lead" still true while drafts exist. */
    if (!input.start) {
      plan = { sequenceId, leadSequenceId: null, nextStepAt: null };
      return input.leadId;
    }

    const started = (await tx`
      insert into public.crm_lead_sequences
        (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at,
         quotation_id, created_by_id)
      select l.id, ${sequenceId}::uuid, 'scheduled', 0, ${input.steps.length}, now(),
             coalesce(${input.firstAt}::timestamptz,
                      now() + make_interval(days => ${input.steps[0]?.delayDays ?? 0})),
             /* ⚠️ Tied to the quotation it is about, so 170 stops the chase the
                moment that quotation expires or is replaced. */
             case when ${input.purpose} in ('quotation', 'approved_offer') then (
               select q.id from public.crm_quotations q
                where q.lead_id = l.id and q.status in ('approved', 'sent', 'pending_approval')
                order by q.version desc, q.created_at desc
                limit 1)
             end,
             ${actorId}::uuid
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning id, next_step_at
    `) as Array<{ id: string; next_step_at: Date }>;
    if (!started[0]) return null;

    const [{ reason }] = (await tx`
      select app.crm_sequence_stop_reason(${started[0].id}::uuid) as reason
    `) as Array<{ reason: string | null }>;
    if (reason) throw new Refused(`It cannot start — ${reason}.`);

    const nextStepAt = new Date(started[0].next_step_at).toISOString();
    /* ⚠️ THE DESK FOLLOWS, or the row says "nothing planned" while three
       messages are scheduled. The engine writes no follow-up row until the first
       step falls due, so without this the plan would be invisible everywhere
       except this drawer. */
    if (!input.keepNextAction) {
      await tx`
        update public.crm_leads
           set next_action = ${input.steps[0]?.title ?? input.name},
               next_action_at = ${nextStepAt}::timestamptz,
               next_action_type = ${input.steps[0]?.channel ?? 'task'}::public.crm_next_action_kind
         where id = ${input.leadId}::uuid
           and (next_action_at is null
                or next_action_at < now()
                or next_action_at > ${nextStepAt}::timestamptz)
      `;
    }

    plan = { sequenceId, leadSequenceId: started[0].id, nextStepAt };
    return input.leadId;
  });
  return result.ok && plan ? { ...result, plan } : result;
}

/**
 * Discard a plan that was never started.
 *
 * ⚠️ `not exists (… crm_lead_sequences …)` IS THE WHOLE SAFETY. A plan that has
 * run owns rows in the timeline; deleting it would cascade its steps away and
 * leave sent messages pointing at a step that no longer exists.
 */
export async function discardDraftPlan(actorId: string, sequenceId: string): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      delete from public.crm_sequences s
       where s.id = ${sequenceId}::uuid
         and s.lead_id is not null
         and not exists (select 1 from public.crm_lead_sequences ls where ls.sequence_id = s.id)
      returning s.lead_id
    `) as Array<{ lead_id: string }>;
    return rows[0]?.lead_id ?? null;
  });
}
