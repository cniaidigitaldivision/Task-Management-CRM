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

import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  closeFollowUp,
  createFollowUp,
  createLeadPlan,
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
/* ⚠️ `auto_send` IS NOT ACCEPTED FROM A BROWSER. Nothing in the product sends a
   sequence step yet, so a plan that claimed to would be a promise kept by
   nobody — on somebody's client. The column exists for the day the sender does;
   until then a step is completed by a person. */
const MODES = ['remind_me', 'review_first'] as const;

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
  readonly keepNextAction: boolean;
  /** When the first step falls. Null: as soon as its own delay allows. */
  readonly firstAt: string | null;
  readonly steps: ReadonlyArray<{
    readonly day: number;
    readonly channel: string;
    readonly title: string;
    readonly body: string;
    readonly mode: string;
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
    if (!MODES.includes(s.mode as never)) {
      return { ok: false, error: 'A step is either a reminder for you or a draft to review — nothing sends by itself yet.' };
    }
  }

  const steps = input.steps.map((s) => ({ ...s, channel: s.channel as PlanChannel, mode: s.mode as PlanMode })) as PlanStep[];
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
    keepNextAction: input.keepNextAction,
    firstAt,
    steps: stepsToRows(steps),
  });
  const settled = settle(written);
  return settled.ok ? { ok: true, plan: written.ok ? (written.plan ?? null) : null } : settled;
}

export async function completeFollowUpAction(followUpId: string, note: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(followUpId)) return { ok: false, error: 'That follow-up could not be found.' };
  const text = note.trim();
  if (text.length > 2000) return { ok: false, error: 'That note is longer than 2,000 characters.' };
  return settle(await closeFollowUp(user.id, followUpId, { done: true, note: text || null }));
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
