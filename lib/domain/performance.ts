/* ============================================================================
 * TEAM PERFORMANCE — the rules, with no database and no clock of its own
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"I want to know or see a single person's performance: his
 * whole history, what he has done today and yesterday, how his performance is
 * going, what things they are doing … every chitta-batta."*
 *
 * ── ⚠️ THE STANDING RULE THIS PAGE LIVES OR DIES BY ───────────────────────
 * **No invented figures.** A performance page is read as a judgement about a
 * person, and a number nobody can trace is worse here than on any other screen
 * in this product — it ends up in a conversation about somebody's work.
 *
 * So every function below answers from rows that exist, and where the evidence
 * is thin it says so rather than rounding up. `Measured<T>` is how: a value
 * carries the count it was computed from, and the screen can say "not measured
 * yet" instead of drawing a confident 0%.
 *
 * ── WHAT IS ACTUALLY RECORDED, MEASURED 2026-09-23 ─────────────────────────
 * `activity_log` carries every status move by name, with the actor and the
 * time, going back to 2026-08-06 — 3,724 entries. `updated` entries carry
 * before/after including `dueDate`, so a moved deadline is real evidence and
 * attributable to whoever moved it.
 *
 * What is NOT there, and must not be implied:
 *   · `revisions` — not one transition recorded, so "rejected submissions" has
 *     no data behind it. All 57 reviews are first-pass.
 *   · reopened work — zero. `done → in_progress` is Admin-only and unused.
 *   · `time_entries` — empty, so there are no logged hours. Attendance gives
 *     presence, which is a different thing and is labelled as such.
 *   · `availability` — empty, so leave is unknown, not zero.
 * ========================================================================= */

/** A figure and the evidence behind it, so a screen can refuse to show a lie. */
export interface Measured<T> {
  readonly value: T;
  /** How many rows it was computed from. 0 ⇒ nothing to say yet. */
  readonly of: number;
}

export const measured = <T>(value: T, of: number): Measured<T> => ({ value, of });

/** `null` when there is nothing to measure — never 0%, which reads as "bad". */
export function rate(part: number, whole: number): Measured<number | null> {
  if (whole <= 0) return measured(null, 0);
  return measured(Math.round((part / whole) * 100), whole);
}

/* ── The shape of one status move, as `activity_log` records it ─────────── */

export type MoveAction =
  | 'created'
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'revisions'
  | 'done'
  | 'cancelled'
  | 'updated'
  | 'deleted'
  | (string & {});

export interface Move {
  readonly taskId: string;
  readonly action: MoveAction;
  readonly actorId: string | null;
  readonly at: string;
}

/* ==========================================================================
 * QUALITY OF WORK
 * ==========================================================================
 * Owner's table: *"First-pass approvals, rejected submissions, corrections,
 * reopened tasks, review coverage, and reasons for rework."*
 *
 * Every one of these is derivable from the ORDER of the moves on a task, which
 * is why they are computed here from a sequence rather than stored as counters
 * that somebody has to remember to increment. */

export interface QualityOfWork {
  /** Submitted for review and approved without being sent back. */
  readonly firstPass: number;
  /** Submitted more than once — the second submission is the rework. */
  readonly resubmitted: number;
  /** Sent back for changes. */
  readonly sentBack: number;
  /** Closed and then moved back into the work — the expensive kind. */
  readonly reopened: number;
  /** Reached Done at all. */
  readonly completed: number;
  /** Reached Done THROUGH review, rather than straight from the doer. */
  readonly reviewed: number;
}

/**
 * Read one task's history and say what happened to it.
 *
 * ⚠️ THE ORDER IS THE EVIDENCE. `in_review` twice on the same task means the
 * first submission came back; `done` followed by `in_progress` means it was
 * reopened. Counting the actions without their order would report a task that
 * sailed through and one that bounced three times as the same thing.
 */
export function qualityOfTask(moves: readonly Move[]): {
  firstPass: boolean;
  resubmitted: boolean;
  sentBack: boolean;
  reopened: boolean;
  completed: boolean;
  reviewed: boolean;
} {
  const ordered = [...moves].sort((a, b) => a.at.localeCompare(b.at));
  let reviews = 0;
  let sentBack = false;
  let reopened = 0;
  let completed = false;
  let reviewedBeforeDone = false;
  let sawReviewSinceLastDone = false;

  for (const m of ordered) {
    if (m.action === 'in_review') {
      reviews += 1;
      sawReviewSinceLastDone = true;
    } else if (m.action === 'revisions') {
      sentBack = true;
    } else if (m.action === 'done') {
      completed = true;
      if (sawReviewSinceLastDone) reviewedBeforeDone = true;
      sawReviewSinceLastDone = false;
    } else if (m.action === 'in_progress' || m.action === 'todo' || m.action === 'backlog') {
      /* Moving back into the work AFTER it was closed is a reopen. Before it
         was ever closed it is just somebody planning. */
      if (completed) reopened += 1;
    }
  }

  return {
    /* First pass means: it went through review, came out done, and was never
       sent back or submitted twice. */
    firstPass: reviewedBeforeDone && reviews === 1 && !sentBack,
    resubmitted: reviews > 1,
    sentBack,
    reopened: reopened > 0,
    completed,
    reviewed: reviewedBeforeDone,
  };
}

/** The same, totalled over many tasks. */
export function qualityOfWork(byTask: ReadonlyMap<string, readonly Move[]>): QualityOfWork {
  const total: QualityOfWork = {
    firstPass: 0,
    resubmitted: 0,
    sentBack: 0,
    reopened: 0,
    completed: 0,
    reviewed: 0,
  };
  const out = { ...total };
  for (const moves of byTask.values()) {
    const q = qualityOfTask(moves);
    if (q.firstPass) out.firstPass += 1;
    if (q.resubmitted) out.resubmitted += 1;
    if (q.sentBack) out.sentBack += 1;
    if (q.reopened) out.reopened += 1;
    if (q.completed) out.completed += 1;
    if (q.reviewed) out.reviewed += 1;
  }
  return out;
}

/* ==========================================================================
 * DEADLINE RESPONSIBILITY
 * ==========================================================================
 * Owner's table: *"Original versus revised deadlines; delays caused by the
 * employee, reviewer, client, or dependency."*
 *
 * ⚠️ THE FIRST HALF IS EVIDENCE; THE SECOND HALF IS NOT RECORDED. An `updated`
 * entry carries the old and new due date and who changed it, so "moved twice,
 * by the coordinator" is a fact. WHY it moved — client, dependency, the
 * person — is nowhere in the database, and guessing it would be exactly the
 * kind of invented figure this page must not produce. So the screen reports the
 * movement and asks a human for the reason. */

export interface DeadlineMove {
  readonly taskId: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly byId: string | null;
  readonly at: string;
}

/** Only the `updated` entries that actually moved a due date. */
export function deadlineMoves(
  entries: ReadonlyArray<{
    taskId: string;
    action: string;
    actorId: string | null;
    at: string;
    before: unknown;
    after: unknown;
  }>,
): DeadlineMove[] {
  const out: DeadlineMove[] = [];
  for (const e of entries) {
    if (e.action !== 'updated') continue;
    const from = dateField(e.before);
    const to = dateField(e.after);
    /* Both absent means the edit was about something else entirely; equal means
       somebody saved the form without touching the date. Neither is a deadline
       move and reporting them as one would inflate every count on this page. */
    if (from === undefined || to === undefined || from === to) continue;
    out.push({ taskId: e.taskId, from, to, byId: e.actorId, at: e.at });
  }
  return out;
}

function dateField(blob: unknown): string | null | undefined {
  if (!blob || typeof blob !== 'object') return undefined;
  const v = (blob as Record<string, unknown>).dueDate;
  if (v === undefined) return undefined;
  return v === null ? null : String(v);
}

/** Later than it was ⇒ the work was given more time. */
export const isSlip = (m: DeadlineMove): boolean =>
  m.from !== null && m.to !== null && m.to > m.from;

/* ==========================================================================
 * A PERSON'S DAY
 * ==========================================================================
 * Owner's table: *"Today's planned work, completed work, unexpected
 * assignments, unfinished work, reasons, and carry-forward tasks."* */

export interface DayLike {
  readonly dueDate: string | null;
  readonly status: string;
  readonly completedOn: string | null;
  readonly createdOn: string;
  readonly assignedOn: string | null;
}

export interface DayAccount {
  /** Due today, and known about before today — the plan. */
  readonly planned: number;
  /** Finished today, whenever it was due. */
  readonly completed: number;
  /** Arrived today and due today — nobody planned for it. */
  readonly unexpected: number;
  /** Was due today and is not finished. */
  readonly unfinished: number;
  /** Was due BEFORE today and is still not finished. */
  readonly carriedForward: number;
}

const CLOSED = new Set(['done', 'cancelled']);

export function dayAccount(tasks: readonly DayLike[], day: string): DayAccount {
  const out: DayAccount = { planned: 0, completed: 0, unexpected: 0, unfinished: 0, carriedForward: 0 };
  const acc = { ...out };
  for (const t of tasks) {
    const closed = CLOSED.has(t.status);
    if (t.completedOn === day) acc.completed += 1;
    if (t.dueDate === day) {
      /* ⚠️ "Unexpected" is work that ARRIVED today for today. A task created
         last week and due today was planned; one raised this morning for this
         afternoon was not, and the difference is the whole point of the
         column — it is what a person points at when the day went sideways. */
      const arrived = t.assignedOn ?? t.createdOn;
      if (arrived === day) acc.unexpected += 1;
      else acc.planned += 1;
      if (!closed) acc.unfinished += 1;
    } else if (t.dueDate !== null && t.dueDate < day && !closed) {
      acc.carriedForward += 1;
    }
  }
  return acc;
}

/* ==========================================================================
 * ON TIME
 * ==========================================================================
 * ⚠️ ONLY TASKS THAT HAD A DEADLINE COUNT. Undated work cannot be late, and
 * counting it as on-time would let somebody raise ten undated tasks and appear
 * perfect. `of` carries how many were actually judgeable. */

export function onTime(
  tasks: ReadonlyArray<{ dueDate: string | null; status: string; completedOn: string | null }>,
): { onTime: number; late: number; judged: number } {
  let ok = 0;
  let late = 0;
  for (const t of tasks) {
    if (!t.dueDate || t.status !== 'done' || !t.completedOn) continue;
    if (t.completedOn <= t.dueDate) ok += 1;
    else late += 1;
  }
  return { onTime: ok, late, judged: ok + late };
}

/* ==========================================================================
 * PROGRESS OVER TIME
 * ==========================================================================
 * Owner's table: *"This week versus last week, monthly trends, recurring
 * problems, and evidence of improvement."* */

export interface Trend {
  readonly now: number;
  readonly before: number;
  /** Percent change, or null when there is nothing to compare against. */
  readonly changePct: number | null;
}

export function trend(now: number, before: number): Trend {
  /* ⚠️ NO PERCENTAGE FROM ZERO. "Up 100%" from a week nobody worked is a
     number that means nothing and reads as an achievement — the +1640% bug this
     codebase already learned from. */
  if (before <= 0) return { now, before, changePct: null };
  return { now, before, changePct: Math.round(((now - before) / before) * 100) };
}

/* ==========================================================================
 * WHAT NEEDS SOMEBODY TODAY
 * ==========================================================================
 * The reference's "Work requiring attention" panel. Each row says what is
 * wrong and what the next step is — a list that only says "late" is a list
 * nobody acts on. */

export type AttentionKind = 'awaiting_review' | 'blocked' | 'overdue' | 'due_today' | 'unassigned';

export interface Attention {
  readonly kind: AttentionKind;
  readonly text: string;
  readonly nextAction: string;
  readonly hours?: number;
}

export function attentionFor(
  task: {
    status: string;
    dueDate: string | null;
    assigneeId: string | null;
    blockedReason?: string | null;
    statusSince?: string | null;
  },
  nowMs: number,
  today: string,
): Attention | null {
  const hoursSince = task.statusSince
    ? Math.floor((nowMs - Date.parse(task.statusSince)) / 3_600_000)
    : null;

  if (task.status === 'in_review') {
    /* 48 hours is the reference's own threshold, and it is the number a
       reviewer is judged by — so it is stated on the row rather than implied. */
    if (hoursSince !== null && hoursSince >= 48) {
      return {
        kind: 'awaiting_review',
        text: `Awaiting reviewer · ${hoursSince}h`,
        nextAction: 'Review work',
        hours: hoursSince,
      };
    }
    return null;
  }
  if (task.status === 'blocked') {
    return {
      kind: 'blocked',
      text: task.blockedReason ? `Blocked · ${task.blockedReason}` : 'Blocked',
      nextAction: 'Assign follow-up',
    };
  }
  if (CLOSED.has(task.status)) return null;
  if (task.dueDate && task.dueDate < today) {
    return { kind: 'overdue', text: 'Overdue', nextAction: 'Open tasks' };
  }
  if (task.dueDate === today) {
    return { kind: 'due_today', text: 'Due today', nextAction: 'Open tasks' };
  }
  if (!task.assigneeId) {
    return { kind: 'unassigned', text: 'Nobody has picked this up', nextAction: 'Assign task' };
  }
  return null;
}
