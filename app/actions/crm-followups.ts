'use server';

/* ============================================================================
 * THE DRAWER'S FOLLOW-UPS TAB — what its buttons do
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, on the reference: Review reply · Reschedule · Stop on the
 * running sequence; Add reminder and New follow-up at the foot.
 *
 * Input is checked here; ownership is checked by RLS in the queries; what a
 * sequence may do next is checked by the engine's own stop-conditions. Every
 * write revalidates the desk, so the row's Next action and sequence label move
 * with it — and the drawer re-reads its own copy on the render that follows.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { polishMessage, type PolishMode } from '@/lib/ai/message-polish';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { listTemplates } from '@/lib/crm/whatsapp';
import { withUser } from '@/lib/db/client';
import { crmLeadDocuments } from '@/lib/db/queries/crm-documents';
import {
  closeFollowUp,
  createFollowUp,
  createLeadPlan,
  discardDraftPlan,
  pauseSequence,
  rescheduleSequence,
  startSequence,
  stopSequence,
  type FollowUpWrite,
  type LeadPlanWritten,
} from '@/lib/db/queries/crm-followups';
import {
  planProblem,
  purposeLabel,
  stepsToRows,
  MAX_STEPS,
  PURPOSE_CARDS,
  type PlanChannel,
  type PlanMode,
  type PlanStep,
} from '@/lib/domain/crm-followup-plans';

export type FollowUpResult = { readonly ok: true } | { readonly ok: false; readonly error: string };
export type PlanResult =
  | { readonly ok: true; readonly plan: LeadPlanWritten | null }
  | { readonly ok: false; readonly error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ['whatsapp', 'email', 'call', 'task'] as const;
const PURPOSES = PURPOSE_CARDS.map((p) => p.key);
/* ⚠️ `auto_send` IS ACCEPTED NOW — 187 to 190 built the sender and
   `/api/cron/crm-followups` delivers. What the browser may NOT do is claim a
   call or a task will send itself: no machine rings anybody. */
const MODES = ['remind_me', 'review_first', 'auto_send'] as const;
const SENDABLE = ['whatsapp', 'email'] as const;
const POLISH_MODES = ['improve', 'shorten', 'warmer', 'formal'] as const;

function settle(result: FollowUpWrite): FollowUpResult {
  if (!result.ok) return result;
  revalidatePath('/my-leads');
  revalidatePath('/todos');
  revalidatePath(`/leads/${result.leadId}`);
  return { ok: true };
}

/** A moment somebody chose: readable, not in the past, not absurdly far off. */
function when(iso: string, { allowPast = false } = {}): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  if (!allowPast && ms < Date.now() - 5 * 60_000) return null;
  if (ms > Date.now() + 366 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

export async function createFollowUpAction(input: {
  leadId: string;
  channel: string;
  title: string;
  note: string;
  dueAt: string;
}): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!CHANNELS.includes(input.channel as never)) return { ok: false, error: 'Choose how you will follow up.' };

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Say what the follow-up is.' };
  if (title.length > 140) return { ok: false, error: 'Keep the title under 140 characters — it has to fit on a row.' };
  const note = input.note.trim();
  if (note.length > 2000) return { ok: false, error: 'That note is longer than 2,000 characters.' };

  const dueAt = when(input.dueAt);
  if (!dueAt) return { ok: false, error: 'Choose a time from now onwards.' };

  return settle(
    await createFollowUp(user.id, {
      leadId: input.leadId,
      channel: input.channel as (typeof CHANNELS)[number],
      title,
      body: note || null,
      dueAt,
    }),
  );
}

/* ── The New follow-up dialog — one action, or a scheduler ───────────────── */

export interface PlanInput {
  readonly leadId: string;
  readonly kind: 'single' | 'schedule';
  readonly purpose: string;
  /** Schedule only: the plan's name, as it appears on the sequence card. */
  readonly name?: string;
  readonly stopOnReply: boolean;
  readonly stopOnVisit: boolean;
  readonly stopOnQuotationDead: boolean;
  readonly keepNextAction: boolean;
  /** Business hours in Karachi, or null for the project's quiet hours. */
  readonly hours: { readonly from: number; readonly to: number; readonly days: readonly number[] } | null;
  /** When the first step falls. Null: as soon as its own delay allows. */
  readonly firstAt: string | null;
  /** ⚠️ False saves a draft — the plan, with nothing running. */
  readonly start: boolean;
  readonly steps: ReadonlyArray<{
    readonly day: number;
    readonly channel: string;
    readonly title: string;
    readonly body: string;
    readonly subject: string;
    readonly mode: string;
    readonly onlyIfNoReply: boolean;
    readonly template: { readonly name: string; readonly language: string } | null;
  }>;
}

/**
 * ⚠️ THE SAME RULES THE DIALOG DREW WITH. `planProblem` and `stepsToRows` are
 * the pure functions the wizard uses on screen, called again here — a browser
 * can post anything, and two copies of "what a valid plan is" would eventually
 * disagree in the direction that reaches a client.
 */
export async function createFollowUpPlanAction(input: PlanInput): Promise<PlanResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!PURPOSES.includes(input.purpose as never)) return { ok: false, error: 'Choose what this follow-up is for.' };
  if (input.steps.length > MAX_STEPS) return { ok: false, error: `A plan can have at most ${MAX_STEPS} steps.` };

  for (const s of input.steps) {
    if (!CHANNELS.includes(s.channel as never)) return { ok: false, error: 'Choose how each step goes out.' };
    if (!MODES.includes(s.mode as never)) return { ok: false, error: 'Choose what happens when each step falls due.' };
    if (s.mode === 'auto_send' && !SENDABLE.includes(s.channel as never)) {
      return { ok: false, error: 'A call or a task cannot send itself — set it as a reminder for you.' };
    }
  }
  if (input.hours) {
    const { from, to, days } = input.hours;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 24 || from >= to) {
      return { ok: false, error: 'Business hours need a start before their end.' };
    }
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { ok: false, error: 'Choose at least one day the plan may send on.' };
    }
  }

  const steps = input.steps.map((s) => ({
    ...s,
    channel: s.channel as PlanChannel,
    mode: s.mode as PlanMode,
  })) as PlanStep[];
  const problem = planProblem(steps);
  if (problem) return { ok: false, error: problem };

  const firstAt = input.firstAt ? when(input.firstAt) : null;
  if (input.firstAt && !firstAt) return { ok: false, error: 'Choose a time from now onwards.' };

  /* ── One action ─────────────────────────────────────────────────────────
     ⚠️ A SINGLE FOLLOW-UP IS NOT A ONE-STEP SEQUENCE. It never pauses, never
     resumes and nothing ever advances it — writing it as a run would put an
     engine, a state machine and a pause reason behind "call him on Tuesday". */
  if (input.kind === 'single') {
    const step = steps[0];
    if (!step) return { ok: false, error: 'Say what the follow-up is.' };
    const dueAt = firstAt ?? when(new Date(Date.now() + (step.day - 1) * 86_400_000).toISOString());
    if (!dueAt) return { ok: false, error: 'Choose a time from now onwards.' };
    const written = await createFollowUp(user.id, {
      leadId: input.leadId,
      channel: step.channel,
      purpose: input.purpose,
      title: step.title.trim(),
      body: step.body.trim() || null,
      dueAt,
      keepNextAction: input.keepNextAction,
    });
    const settled = settle(written);
    return settled.ok ? { ok: true, plan: null } : settled;
  }

  /* ── A scheduler ───────────────────────────────────────────────────────── */
  const name = (input.name ?? '').trim() || purposeLabel(input.purpose);
  if (name.length > 80) return { ok: false, error: 'Keep the plan’s name under 80 characters.' };

  const written = await createLeadPlan(user.id, {
    leadId: input.leadId,
    name,
    purpose: input.purpose,
    stopOnReply: input.stopOnReply,
    stopOnVisit: input.stopOnVisit,
    stopOnQuotationDead: input.stopOnQuotationDead,
    keepNextAction: input.keepNextAction,
    hours: input.hours,
    firstAt,
    start: input.start,
    steps: stepsToRows(steps),
  });
  const settled = settle(written);
  return settled.ok ? { ok: true, plan: written.ok ? (written.plan ?? null) : null } : settled;
}

export async function completeFollowUpAction(
  followUpId: string,
  note: string,
  stopPlan = false,
): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(followUpId)) return { ok: false, error: 'That follow-up could not be found.' };
  const text = note.trim();
  if (text.length > 2000) return { ok: false, error: 'That note is longer than 2,000 characters.' };
  return settle(await closeFollowUp(user.id, followUpId, { done: true, note: text || null }, stopPlan));
}

export async function cancelFollowUpAction(followUpId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(followUpId)) return { ok: false, error: 'That follow-up could not be found.' };
  return settle(await closeFollowUp(user.id, followUpId, { done: false }));
}

export async function pauseSequenceAction(leadSequenceId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  return settle(await pauseSequence(user.id, leadSequenceId, user.fullName));
}

export async function rescheduleSequenceAction(leadSequenceId: string, at: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  const next = when(at);
  if (!next) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(await rescheduleSequence(user.id, leadSequenceId, next));
}

export async function stopSequenceAction(leadSequenceId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  return settle(await stopSequence(user.id, leadSequenceId, user.fullName));
}

export async function startSequenceAction(input: {
  leadId: string;
  sequenceId: string;
  firstAt: string | null;
}): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId) || !UUID.test(input.sequenceId)) {
    return { ok: false, error: 'That sequence could not be found.' };
  }
  const firstAt = input.firstAt ? when(input.firstAt) : null;
  if (input.firstAt && !firstAt) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(await startSequence(user.id, { leadId: input.leadId, sequenceId: input.sequenceId, firstAt }));
}

/* ── The compose screen's two helpers ────────────────────────────────────── */

/**
 * Files this lead's emails can carry.
 *
 * ⚠️ READ AS THE PERSON, so a document they may not see is not offered — and the
 * sender checks the same thing again against the lead before it attaches
 * anything (189).
 */
export async function leadDocumentsAction(leadId: string): Promise<
  ReadonlyArray<{ id: string; title: string; mime: string; sizeBytes: number }>
> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId)) return [];
  const rows = await crmLeadDocuments(user.id, leadId);
  return rows.map((d) => ({ id: d.id, title: d.title, mime: d.mime, sizeBytes: d.sizeBytes }));
}

/** Rewrite what somebody wrote — never add to it. See `lib/ai/message-polish.ts`. */
export async function polishMessageAction(input: {
  text: string;
  mode: string;
  channel: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  await requireCrmAccess();
  const text = input.text.trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  if (text.length > 4000) return { ok: false, error: 'That message is too long to rewrite.' };
  if (!POLISH_MODES.includes(input.mode as never)) return { ok: false, error: 'Unknown rewrite.' };
  const channel = input.channel === 'email' ? 'email' : 'whatsapp';
  try {
    return { ok: true, text: await polishMessage({ text, mode: input.mode as PolishMode, channel }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The rewrite did not come back.' };
  }
}

/* ── A saved draft ───────────────────────────────────────────────────────── */

/** Start a plan that was saved and never run. */
export async function startDraftAction(leadId: string, sequenceId: string, firstAt: string | null): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadId) || !UUID.test(sequenceId)) return { ok: false, error: 'That plan could not be found.' };
  const at = firstAt ? when(firstAt) : null;
  if (firstAt && !at) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(await startSequence(user.id, { leadId, sequenceId, firstAt: at }));
}

/**
 * Throw a draft away.
 *
 * ⚠️ ONLY A DRAFT. The query refuses a plan that has ever run — deleting one of
 * those would take its steps with it and leave the run pointing at nothing,
 * which is how a timeline starts showing blank rows for messages that were sent.
 */
export async function discardDraftAction(sequenceId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(sequenceId)) return { ok: false, error: 'That plan could not be found.' };
  return settle(await discardDraftPlan(user.id, sequenceId));
}

/* ── Templates, which only Meta can approve ──────────────────────────────── */

export interface TemplateList {
  readonly ok: boolean;
  /** Approved first; Meta's own status on each. */
  readonly templates: ReadonlyArray<{ name: string; language: string; status: string; category: string }>;
  /** Where a person goes to write and submit one. */
  readonly managerUrl: string;
  readonly error?: string;
}

/** Meta's WhatsApp Manager — the only place a template is written and approved. */
const WA_MANAGER = 'https://business.facebook.com/wa/manage/message-templates/';

/**
 * What this lead's project may send outside the 24-hour window.
 *
 * ⚠️ LIVE FROM META, NEVER CACHED. A template can be paused or disabled on
 * Meta's side with no call to us, and a stale local list would show "approved"
 * for something that has stopped sending (`lib/crm/whatsapp.ts` says the same).
 * ⚠️ AND A FAILED CALL IS NOT AN EMPTY ACCOUNT — the two are reported apart.
 */
export async function whatsAppTemplatesAction(leadId: string): Promise<TemplateList> {
  const { user } = await requireCrmAccess();
  const empty = { ok: false, templates: [], managerUrl: WA_MANAGER };
  if (!UUID.test(leadId)) return { ...empty, error: 'That lead could not be found.' };

  const rows = (await withUser(user.id, (tx) => tx`
    select app.crm_project_waba(l.project_id) as waba
      from public.crm_leads l where l.id = ${leadId}::uuid
  `)) as Array<{ waba: string | null }>;
  const waba = rows[0]?.waba;
  if (!waba) {
    return { ...empty, error: 'This project is not connected to a WhatsApp Business account yet.' };
  }

  const list = await listTemplates(waba, process.env.META_API_VERSION?.trim() || 'v26.0');
  if (list === null) {
    return { ...empty, error: 'Meta did not answer, so the template list could not be read just now.' };
  }
  const rank = (s: string) => (s === 'APPROVED' ? 0 : s === 'PENDING' ? 1 : 2);
  return {
    ok: true,
    managerUrl: WA_MANAGER,
    templates: [...list].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)),
  };
}
