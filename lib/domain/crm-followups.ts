/* ============================================================================
 * FOLLOW-UPS AND SEQUENCES — what the drawer's Follow-ups tab says, decided here
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock (the caller passes `nowMs`), no React. The tab
 * draws what this returns, so every "Delivered", "Paused" and "Due" on screen
 * is a decision that can be tested rather than one buried in JSX.
 *
 * ── HOW A SEQUENCE BECOMES ROWS (migration 170) ─────────────────────────────
 * A sequence template is a list of steps. When a step falls due, the engine
 * writes it as a `crm_follow_ups` row carrying `lead_sequence_id` and
 * `sequence_step_no`, and moves `current_step` on. So a step's truth is its row
 * when one exists, and the queue (`next_step_at` + each later step's delay) when
 * it does not yet.
 * ========================================================================= */

export type FollowUpChannel = 'whatsapp' | 'email' | 'call' | 'task';

export interface SequenceStepInput {
  readonly stepNo: number;
  readonly channel: string;
  readonly delayDays: number;
  readonly purpose: string;
  readonly body: string | null;
  /** What the person who planned it called this step — 185. */
  readonly title?: string | null;
}

export interface FollowUpInput {
  readonly id: string;
  readonly status: string;
  readonly mode: string;
  readonly dueAt: string;
  readonly doneAt: string | null;
  readonly leadSequenceId: string | null;
  readonly sequenceStepNo: number | null;
}

export interface SequenceInput {
  readonly id: string;
  readonly state: string;
  readonly currentStep: number;
  readonly nextStepAt: string | null;
  readonly steps: readonly SequenceStepInput[];
}

export type StepStatus =
  | 'sent'
  | 'queued'
  | 'needs_you'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'upcoming'
  | 'paused'
  | 'stopped';

export interface TimelineStep {
  readonly stepNo: number;
  readonly channel: string;
  readonly title: string;
  readonly detail: string | null;
  readonly status: StepStatus;
  /** When it happened or is due. Null when it cannot honestly be known. */
  readonly at: string | null;
  /** While paused: how many days after resuming this step would fall. */
  readonly daysAfterResume: number | null;
  readonly followUpId: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  call: 'Call',
  task: 'Task',
};

const PURPOSE_PHRASE: Record<string, string> = {
  quotation: 'quotation check-in',
  no_response: 'follow-up',
  appointment_reminder: 'visit reminder',
  missing_information: 'missing details',
  approved_offer: 'offer follow-up',
  payment_reminder: 'payment reminder',
  site_visit_checkin: 'visit check-in',
  re_engage: 're-engagement',
  custom: 'follow-up',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? 'Follow-up';
}

/**
 * "WhatsApp quotation check-in" — the reference's own phrasing, built from the
 * two things a step actually stores. A free-text purpose is used as written.
 */
export function stepTitle(channel: string, purpose: string): string {
  const phrase = PURPOSE_PHRASE[purpose] ?? (purpose.trim() || 'follow-up');
  return `${channelLabel(channel)} ${phrase}`;
}

const DAY = 86_400_000;

export function sequenceTimeline(
  sequence: SequenceInput,
  followUps: readonly FollowUpInput[],
): TimelineStep[] {
  const steps = [...sequence.steps].sort((a, b) => a.stepNo - b.stepNo);
  const rowFor = (n: number) =>
    followUps
      .filter((f) => f.leadSequenceId === sequence.id && f.sequenceStepNo === n)
      .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt))[0] ?? null;

  const next = sequence.currentStep + 1;
  const nextAt = sequence.nextStepAt ? Date.parse(sequence.nextStepAt) : null;

  return steps.map((step) => {
    const base = {
      stepNo: step.stepNo,
      channel: step.channel,
      /* ⚠️ THE PLANNER'S OWN WORDS FIRST. "Gentle reminder" is what they wrote
         and what the review screen showed them; deriving "WhatsApp follow-up"
         over the top of it renames their plan behind their back. */
      title: step.title?.trim() || stepTitle(step.channel, step.purpose),
      detail: step.body?.trim() || null,
      daysAfterResume: null,
    };
    const row = rowFor(step.stepNo);

    /* ── Queued already: its row is the truth ─────────────────────────────── */
    if (row) {
      const status: StepStatus =
        row.status === 'done'
          ? 'sent'
          : row.status === 'failed'
            ? 'failed'
            : row.status === 'skipped'
              ? 'skipped'
              : row.status === 'cancelled'
                ? 'cancelled'
                : /* ⚠️ ONLY `auto_send` IS SENT BY MACHINE. `review_first` and
                     `remind_me` are waiting on a person, and saying "queued" about
                     them would tell somebody it is handled when it is not. */
                  row.mode === 'auto_send'
                  ? 'queued'
                  : 'needs_you';
      return { ...base, status, at: row.doneAt ?? row.dueAt, followUpId: row.id };
    }

    /* A step the engine passed before rows were written for it (seeded data). */
    if (step.stepNo <= sequence.currentStep) {
      return { ...base, status: 'sent' as const, at: null, followUpId: null };
    }

    /* ── Not queued yet ───────────────────────────────────────────────────── */
    if (sequence.state === 'stopped') {
      return { ...base, status: 'stopped' as const, at: null, followUpId: null };
    }

    /* Days from the NEXT step to this one: the first waits for `next_step_at`
       (or for the resume); each later one adds its own delay. */
    const gap = steps
      .filter((s) => s.stepNo > next && s.stepNo <= step.stepNo)
      .reduce((sum, s) => sum + Math.max(0, s.delayDays), 0);

    if (sequence.state === 'paused') {
      return { ...base, status: 'paused' as const, at: null, daysAfterResume: gap, followUpId: null };
    }

    return {
      ...base,
      status: 'upcoming' as const,
      at: nextAt === null ? null : new Date(nextAt + gap * DAY).toISOString(),
      followUpId: null,
    };
  });
}

export type FollowUpState = 'planned' | 'due' | 'overdue' | 'done' | 'cancelled' | 'skipped' | 'failed';

/**
 * ⚠️ "DUE" IS TODAY IN KARACHI, "OVERDUE" IS BEFORE NOW. The engine stamps a
 * queued step `due` at the moment it queues it; a reminder somebody set for
 * this afternoon is still `planned` in the table but due as far as a person is
 * concerned — so the state shown is computed, not copied from the column.
 */
export function followUpState(f: { status: string; dueAt: string }, nowMs: number): FollowUpState {
  if (f.status === 'done') return 'done';
  if (f.status === 'cancelled') return 'cancelled';
  if (f.status === 'skipped') return 'skipped';
  if (f.status === 'failed') return 'failed';
  const due = Date.parse(f.dueAt);
  if (due < nowMs - 15 * 60_000) return 'overdue';
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  return day(due) === day(nowMs) || due <= nowMs ? 'due' : 'planned';
}

export interface FollowUpCounts {
  /** Waiting on somebody now — due today or already late. */
  readonly active: number;
  /** Coming up — open follow-ups due later, and sequence steps still to run. */
  readonly scheduled: number;
  /** Done. */
  readonly completed: number;
}

export function followUpCounts(
  followUps: readonly (FollowUpInput & { status: string })[],
  timeline: readonly TimelineStep[],
  nowMs: number,
): FollowUpCounts {
  let active = 0;
  let scheduled = 0;
  let completed = 0;
  for (const f of followUps) {
    const s = followUpState(f, nowMs);
    if (s === 'done') completed += 1;
    else if (s === 'due' || s === 'overdue') active += 1;
    else if (s === 'planned') scheduled += 1;
  }
  scheduled += timeline.filter((t) => t.status === 'upcoming').length;
  return { active, scheduled, completed };
}
