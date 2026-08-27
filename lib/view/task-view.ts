import type { TaskRow } from '@/lib/db/queries/types';
import {
  EFFORT_POINTS,
  STATUS_META,
  SYSTEM_DEFAULTS,
  type ContentKind,
  type EffortSize,
  type Priority,
  type ProjectType,
  type TaskStatus,
} from '@/lib/domain/constants';

/* ============================================================================
 * TASK VIEW MODEL
 * ----------------------------------------------------------------------------
 * The shape the board and list render. Distinct from `TaskRow` (what the
 * database returns) for one reason that keeps paying off: a card needs "2 days
 * late", and a row has a `due_date`. Formatting that inside the card means every
 * card does date arithmetic on every render, and — worse — it means the server
 * and the client can disagree about what day it is, which React reports as a
 * hydration mismatch.
 *
 * So the label is computed once, on the server, from the server's clock.
 *
 * ── WHY `overdue` IS A FIELD AND NOT A COMPARISON ────────────────────────────
 * "Late" is not simply `dueDate < today`: a Done task that was finished late is
 * history, not a problem, and painting it red on the board would mean the board
 * never goes quiet. Closed work is never overdue here, and that judgement lives
 * in one place rather than in each of the three components that show it.
 * ========================================================================= */

export interface TaskView {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: ProjectType;
  readonly assigneeId: string | null;
  /** Display name, or 'Unassigned'. The grouping key is `assigneeId`. */
  readonly assignee: string;
  /** Their uploaded picture, or null for initials. CHANGE-PLAN 2.3. */
  readonly assigneeAvatarUrl: string | null;
  readonly createdById: string;
  readonly createdBy: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly effort: EffortSize;
  readonly effortPoints: number;
  readonly dueDate: string | null;
  readonly dueLabel: string;
  readonly overdue: boolean;
  readonly timeSpentMinutes: number;
  readonly timeLimitMinutes: number;
  readonly blockedReason?: string;
  readonly commentCount?: number;
  readonly attachmentCount?: number;
  readonly checklist?: { done: number; total: number };

  /* ── WHAT THE BOARD NEEDS TO REFUSE A DROP BEFORE IT HAPPENS ───────────────
     The publish gate lives in `evaluateTransition`, and the board asks it the
     same question the server does (see tasks-workspace's `canMove`). It can only
     ask honestly if the card knows what kind of deliverable it is and whether a
     link has been recorded — otherwise the drag succeeds optimistically, the
     server refuses, and the card snaps back with an error, which teaches people
     the board is unreliable rather than that the rule exists. */
  readonly contentKind: ContentKind | null;
  /** Placements carrying a URL — `TaskRow.placementLiveCount`, passed through. */
  readonly placementUrlCount: number;

  /* ── "CLOSED, BUT RECENTLY" — COMPUTED HERE, NEVER IN THE COMPONENT ────────
     The tasks board shows recent completions and hides older ones, so the Done
     column fills the moment somebody closes something without becoming an
     archive of every task ever (SYSTEM_DEFAULTS.closedVisibleDays).

     ⚠️ A BOOLEAN FROM THE SERVER'S CLOCK, NOT A DATE FOR THE CLIENT TO COMPARE.
     Exactly the reasoning `overdue` is a field: a client-side `Date.now()` here
     would put the server and the browser on different days at midnight and
     around any timezone difference, which React reports as a hydration mismatch.
     False for anything still open — an open task is not "recently closed", and
     the filter must not have to special-case that. */
  readonly recentlyClosed: boolean;
}

/** The nearest named size, for a task whose points were entered directly. */
function sizeFor(points: number, declared: EffortSize | null): EffortSize {
  if (declared) return declared;
  let best: EffortSize = 'M';
  let distance = Infinity;
  for (const [size, value] of Object.entries(EFFORT_POINTS) as Array<[EffortSize, number]>) {
    const d = Math.abs(value - points);
    if (d < distance) {
      distance = d;
      best = size;
    }
  }
  return best;
}

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * "Due today", "2 days late", "Due Fri" — the sentence a person reads.
 *
 * Named days only inside the coming week. Beyond that a weekday name is
 * ambiguous ("Due Fri" — which Friday?), so it switches to a date.
 */
export function dueLabelFor(
  dueDate: string | null,
  status: TaskStatus,
  completedAt: string | null,
  nowMs: number,
): { label: string; overdue: boolean } {
  const category = STATUS_META[status].category;

  if (category === 'cancelled') return { label: 'Cancelled', overdue: false };
  if (category === 'done') {
    if (!completedAt) return { label: 'Completed', overdue: false };
    const days = Math.round((startOfDay(nowMs) - startOfDay(new Date(completedAt).getTime())) / DAY);
    if (days <= 0) return { label: 'Completed today', overdue: false };
    if (days === 1) return { label: 'Completed yesterday', overdue: false };
    if (days < 7) return { label: `Completed ${days} days ago`, overdue: false };
    return { label: 'Completed', overdue: false };
  }

  if (!dueDate) return { label: 'No due date', overdue: false };

  const due = startOfDay(new Date(`${dueDate}T00:00:00Z`).getTime());
  const today = startOfDay(nowMs);
  const days = Math.round((due - today) / DAY);

  if (days < 0) {
    const late = Math.abs(days);
    return { label: late === 1 ? '1 day late' : `${late} days late`, overdue: true };
  }
  if (days === 0) return { label: 'Due today', overdue: false };
  if (days === 1) return { label: 'Due tomorrow', overdue: false };
  if (days <= 6) {
    const weekday = new Date(due).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    return { label: `Due ${weekday}`, overdue: false };
  }
  const label = new Date(due).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return { label: `Due ${label}`, overdue: false };
}

/**
 * Was this task closed recently enough to still belong on the board?
 *
 * ⚠️ TWO DIFFERENT TIMESTAMPS, BECAUSE THERE IS NO `cancelled_at`. Migration 012
 * constrains `completed_at is not null` to mean exactly `status = 'done'`, so a
 * cancelled task has no completion stamp at all and `updated_at` is the only
 * thing left to date it by. That is an approximation and worth naming: any edit
 * touches `updated_at`, so commenting on an old cancelled task can pull it back
 * onto the board for a fortnight. Accepted — cancelling is normally the last
 * thing that happens to a task, and the alternative is a migration to add a
 * column whose only reader would be this line.
 */
function closedRecently(row: TaskRow, nowMs: number): boolean {
  const category = STATUS_META[row.status].category;
  if (category !== 'done' && category !== 'cancelled') return false;

  const closedAt = row.completedAt ?? row.updatedAt;
  if (!closedAt) return false;

  const at = new Date(closedAt).getTime();
  /* An unparseable stamp must not hide finished work — the board erring toward
     showing something is recoverable, erring toward hiding it is the bug this
     whole field exists to fix. */
  if (Number.isNaN(at)) return true;

  return startOfDay(nowMs) - startOfDay(at) <= SYSTEM_DEFAULTS.closedVisibleDays * DAY;
}

export function toTaskView(row: TaskRow, nowMs: number): TaskView {
  const { label, overdue } = dueLabelFor(row.dueDate, row.status, row.completedAt, nowMs);

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    projectId: row.projectId,
    projectName: row.projectName,
    projectType: row.projectType,
    assigneeId: row.assigneeId,
    assignee: row.assigneeName ?? 'Unassigned',
    assigneeAvatarUrl: row.assigneeAvatarUrl,
    createdById: row.createdById,
    createdBy: row.createdByName ?? 'Unknown',
    status: row.status,
    priority: row.priority,
    effort: sizeFor(row.effortPoints, row.effortSize),
    effortPoints: row.effortPoints,
    dueDate: row.dueDate,
    dueLabel: label,
    overdue,
    timeSpentMinutes: row.timeSpentMinutes,
    /* The granted extension is added to the limit rather than shown separately:
       the question a card answers is "am I over the time I am allowed", and after
       an Admin grants two more hours the answer has genuinely changed (FR-184). */
    timeLimitMinutes: (row.timeLimitMinutes ?? 0) + row.extensionMinutesGranted,
    blockedReason: row.blockedReason ?? undefined,
    commentCount: row.commentCount || undefined,
    attachmentCount: row.attachmentCount || undefined,
    checklist: row.checklistTotal > 0
      ? { done: row.checklistDone, total: row.checklistTotal }
      : undefined,
    contentKind: row.contentKind,
    placementUrlCount: row.placementLiveCount,
    recentlyClosed: closedRecently(row, nowMs),
  };
}
