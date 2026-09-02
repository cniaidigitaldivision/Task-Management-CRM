import { COUNTS_AS_ASSET, type ContentKind } from './constants';

/* ============================================================================
 * THE DAILY BOARD — ONE DAY'S POSTS, AND WHETHER THEY WENT OUT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-22, on how a social media manager actually works:
 *
 *   *"he has a whole day to update the status. Once 12 pm has gone, that task
 *   or that thing would be considered incomplete and marked as incomplete. If it
 *   is not posted on that day, that blank day will be done."*
 *
 *   *"nobody can undo it… if they have some URL issue they can update only that;
 *   other than that, other things are not editable and the status would not be
 *   changed once it's done."*
 *
 * Pure by contract: no clock, no database (doc 20 §5). `today` is always passed.
 *
 * ── ⚠️ "MISSED" IS DERIVED, NOT STORED, AND THAT IS DELIBERATE ───────────────
 * The obvious build is a new `missed` status and a nightly job that sweeps
 * yesterday's unfilled posts into it. That is a migration, a second cron, and a
 * value that is wrong for however long the job is late or fails.
 *
 * A daily post is missed if its day has passed and it is not done. That is
 * knowable from the row itself at any moment, cannot drift, needs no job, and
 * corrects itself if somebody legitimately backfills the day. The rule below is
 * the only definition of it in the system.
 *
 * ── ⚠️ THE END OF THE DAY IS MIDNIGHT, NOT NOON ─────────────────────────────
 * The owner wrote "12 pm" and described it as "till the next night", which is
 * midnight. Recorded here because the two readings differ by twelve hours and
 * the wrong one would mark a whole afternoon's work as missed.
 * ========================================================================= */

/** Where one dated deliverable stands today. */
export type DailyState =
  /** Its day is today and it has not gone out yet. Fillable. */
  | 'pending'
  /** Posted. Final — the status can never move off this. */
  | 'done'
  /* ── ⚠️ PUBLISHED AND WAITING FOR A REVIEWER, ADDED 2026-09-02 ────────────
     Owner: *"when it is marked as published it should automatically move to in
     review. Then I review it."* Publishing no longer closes a post, so there is
     now a real state between the two and the board has to name it.

     Without this the submitted post falls through to `pending` — its status is
     not `done`, its day is today — and reappears under "to post today" with a
     publish button that cannot fire, which is precisely the dead control this
     change set was raised to fix. */
  | 'submitted'
  /** Its day has passed with nothing posted. A blank day; no longer fillable. */
  | 'missed'
  /** Its day has not arrived. Visible, not yet actionable. */
  | 'upcoming';

export interface DailyTask {
  readonly id: string;
  readonly status: string;
  /** 'YYYY-MM-DD'. A deliverable without one is not on any day's board. */
  readonly dueDate: string | null;
  readonly contentKind: ContentKind | null;
}

/**
 * Is this row one of the dated deliverables the daily board is about?
 *
 * Website work, reports and untyped tasks are real work and are NOT daily posts
 * — they have no publishing day and nothing to paste a link against. Keeping
 * them off this board is what stops it becoming the task list again.
 */
export function isDailyDeliverable(task: DailyTask): boolean {
  if (!task.dueDate) return false;
  if (!task.contentKind) return false;
  return (COUNTS_AS_ASSET as readonly string[]).includes(task.contentKind);
}

/**
 * Where this deliverable stands, given the day it is being looked at.
 *
 * ISO dates compare correctly as strings — 'YYYY-MM-DD' is ordered by
 * construction, which is the reason the format is used throughout.
 */
export function dailyState(task: DailyTask, today: string): DailyState {
  if (task.status === 'done') return 'done';
  /* ⚠️ Before the date checks, like `done`, and for the same reason: it has
     already gone out. A post submitted at 11pm and reviewed tomorrow was not a
     blank day, and calling it missed would understate delivery to a client. */
  if (task.status === 'in_review') return 'submitted';
  if (!task.dueDate) return 'upcoming';
  if (task.dueDate > today) return 'upcoming';
  if (task.dueDate < today) return 'missed';
  return 'pending';
}

/**
 * May this be marked as posted right now?
 *
 * False once the day has passed, which is the owner's rule made enforceable
 * rather than merely displayed — without it, "missed" would be a label somebody
 * could clear by ticking the box a week later, and the monthly figures would
 * quietly stop meaning anything.
 *
 * ⚠️ Also false when it is already done. Marking done twice is not idempotent
 * here: the second one would overwrite the first person's name and timestamp.
 */
export function canComplete(task: DailyTask, today: string): boolean {
  return dailyState(task, today) === 'pending';
}

/**
 * Once posted, what may still be corrected?
 *
 * Owner: *"if they have some URL issue they can update only that."* So the
 * links stay editable — a wrong URL in a client report is worth fixing — and
 * nothing else does. In particular the status cannot move off `done`, by anyone,
 * which is why this returns a set rather than a boolean.
 */
export function editableFieldsAfterDone(): readonly string[] {
  return ['placementUrl'];
}

/** Can the status still change? Never, once done. Not by the author, not by an
 *  Admin — the owner was asked directly and said nobody. */
export function canChangeStatus(task: DailyTask): boolean {
  return task.status !== 'done';
}

export interface DailyBoard {
  readonly pending: readonly DailyTask[];
  /** Published, waiting for a reviewer to approve. */
  readonly submitted: readonly DailyTask[];
  readonly done: readonly DailyTask[];
  readonly missed: readonly DailyTask[];
}

/**
 * Split a project's deliverables into the columns the daily view shows.
 *
 * `missed` deliberately reaches BACK beyond today — a manager arriving on
 * Wednesday needs to see that Monday was blank, not just that today is empty.
 * Bounded by `missedSince` so the list does not grow without limit.
 */
export function dailyBoard(
  tasks: readonly DailyTask[],
  today: string,
  missedSince: string,
): DailyBoard {
  const pending: DailyTask[] = [];
  const submitted: DailyTask[] = [];
  const done: DailyTask[] = [];
  const missed: DailyTask[] = [];

  for (const task of tasks) {
    if (!isDailyDeliverable(task)) continue;

    switch (dailyState(task, today)) {
      case 'pending':
        pending.push(task);
        break;
      case 'submitted':
        /* Not date-bounded like `done`: a post still awaiting review is
           outstanding work whatever day it went out on, and dropping it after
           midnight would leave it approved by nobody and visible to nobody. */
        submitted.push(task);
        break;
      case 'done':
        /* Only today's, or the board becomes an archive of every post ever. */
        if (task.dueDate === today) done.push(task);
        break;
      case 'missed':
        if ((task.dueDate ?? '') >= missedSince) missed.push(task);
        break;
      case 'upcoming':
        break;
    }
  }

  return { pending, submitted, done, missed };
}
