import type { ContentKind, TaskStatus } from './constants';

/* ============================================================================
 * THE CONTENT PIPELINE — owner's mockup, 2026-08-20
 * ----------------------------------------------------------------------------
 * The project page is to show a five-stage pipeline (Ideas · Design · Review ·
 * Scheduled · Published) plus a KPI row counting the same work, and a week strip.
 *
 * Pure by contract: tasks in, stages out. No clock — "today" is passed — so the
 * boundary between Scheduled and Published can be tested at a fixed date rather than
 * only being right on the day somebody runs it.
 *
 * ── ⚠️ NO NEW STATUS COLUMN. THE STAGES ARE DERIVED ───────────────────────────
 * The temptation is to add a `pipeline_stage` enum to `tasks`. That would be a second
 * record of where work has got to, free to disagree with `status` — and the board, the
 * task drawer and every report already read `status`. So the stages are a VIEW of
 * what is already there:
 *
 *   Ideas      status = backlog
 *   Design     status in (todo, in_progress, blocked)
 *   Review     status in (in_review, revisions)
 *   Scheduled  published_on is set and still in the future
 *   Published  published_on is set and today or earlier
 *
 * ── ⚠️ WHY published_on AND NOT status = 'done' ───────────────────────────────
 * A reel can be finished on Monday and go out on Friday. `status = 'done'` says the
 * work is finished; `published_on` says it is live. The client is paying for live, and
 * every report in this system already counts on `published_on` (migration 033). Using
 * `done` here would put finished-but-unpublished work in the Published column and
 * overstate delivery — the exact error the card's old task-completion bar made.
 *
 * ── THE ORDER OF THE TESTS MATTERS ───────────────────────────────────────────
 * `published_on` is checked FIRST. A task can be `in_review` and also carry a
 * publish date, and once a date is set the schedule is the more useful truth. Checking
 * status first would leave scheduled work sitting in Review for ever.
 * ========================================================================= */

export const PIPELINE_STAGES = ['ideas', 'design', 'review', 'scheduled', 'published'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = {
  ideas: 'Ideas',
  design: 'Design',
  review: 'Review',
  scheduled: 'Scheduled',
  published: 'Published',
};

/** Each stage's colour token, so the columns and the KPI cards agree. */
export const STAGE_TOKEN: Readonly<Record<PipelineStage, string>> = {
  ideas: 'text-tertiary',
  design: 'accent-primary',
  review: 'feedback-warning',
  scheduled: 'feedback-info',
  published: 'feedback-success',
};

/** The minimum a card needs. Deliberately narrower than `TaskRow` so this module
 *  can be tested with literals and cannot quietly start depending on more. */
export interface PipelineTask {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly contentKind: ContentKind | null;
  readonly publishedOn: string | null;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  readonly assigneeName: string | null;
}

/**
 * Which column a task belongs in, or null if it does not belong in the pipeline
 * at all.
 *
 * ⚠️ Returns null for a task with no `contentKind`. A coordinator's admin task is real
 * work but was never part of what the client was promised, so it must not appear in a
 * pipeline the client's delivery is judged by. Same rule as the Content tab and the
 * monthly report.
 *
 * ⚠️ Also null for `cancelled` and `done`-without-a-publish-date. Cancelled work is
 * not in flight, and "done but never published" is a real state that would be a lie in
 * either the Scheduled or the Published column — it shows in the Content tab instead.
 */
export function stageOf(task: PipelineTask, today: string): PipelineStage | null {
  if (task.contentKind === null) return null;
  if (task.status === 'cancelled') return null;

  /* Publish date first — see the header. String comparison is safe and exact for
     ISO dates, and avoids constructing a Date only to compare two days. */
  if (task.publishedOn !== null) {
    return task.publishedOn <= today ? 'published' : 'scheduled';
  }

  switch (task.status) {
    case 'backlog':
      return 'ideas';
    case 'todo':
    case 'in_progress':
    case 'blocked':
      return 'design';
    case 'in_review':
    case 'revisions':
      return 'review';
    case 'done':
      /* Finished, never given a publish date. Not Published — that would overstate
         delivery — and not Scheduled either, because nothing is scheduled. */
      return null;
    default:
      return null;
  }
}

export interface StageBucket {
  readonly stage: PipelineStage;
  readonly label: string;
  readonly token: string;
  readonly tasks: readonly PipelineTask[];
  readonly count: number;
}

/** Every stage, always — including the empty ones. A pipeline that hid its empty
 *  columns would change shape as work moved through it, and the reader would lose
 *  the ability to see at a glance where the gap is. */
export function pipeline(
  tasks: readonly PipelineTask[],
  today: string,
): readonly StageBucket[] {
  const buckets = new Map<PipelineStage, PipelineTask[]>(
    PIPELINE_STAGES.map((stage) => [stage, []]),
  );

  for (const task of tasks) {
    const stage = stageOf(task, today);
    if (stage) buckets.get(stage)!.push(task);
  }

  return PIPELINE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    token: STAGE_TOKEN[stage],
    tasks: buckets.get(stage)!,
    count: buckets.get(stage)!.length,
  }));
}

/* ----------------------------------------------------------------------------
 * THE KPI ROW
 * ------------------------------------------------------------------------- */

export interface DeliveryCounts {
  /** The agreed minimum. Null when nothing was agreed — not 0. */
  readonly target: number | null;
  readonly published: number;
  readonly inReview: number;
  readonly scheduled: number;
  /** How much of the target is still to come. 0 once met; null with no target. */
  readonly remaining: number | null;
}

/**
 * The five figures across the top.
 *
 * ⚠️ `published` counts THIS MONTH; the pipeline's Published column counts everything
 * ever. They are different questions and will legitimately differ, which is why the
 * card is labelled "Assets this month" and the column is not.
 */
export function deliveryCounts(
  tasks: readonly PipelineTask[],
  target: number | null,
  monthStart: string,
  today: string,
): DeliveryCounts {
  const monthEnd = nextMonthStart(monthStart);

  let published = 0;
  let inReview = 0;
  let scheduled = 0;

  for (const task of tasks) {
    const stage = stageOf(task, today);
    if (stage === 'review') inReview += 1;
    if (stage === 'scheduled') scheduled += 1;
    if (
      stage === 'published' &&
      task.publishedOn !== null &&
      task.publishedOn >= monthStart &&
      task.publishedOn < monthEnd
    ) {
      published += 1;
    }
  }

  return {
    target,
    published,
    inReview,
    scheduled,
    /* ⚠️ Null, not 0, when there is no target. "Nothing left to do" and "nothing was
       agreed" are different, and `projectProgress` rule 2 depends on the difference. */
    remaining: target === null ? null : Math.max(0, target - published),
  };
}

/** 'YYYY-MM-01' → the first of the following month, as a bound to compare against.
 *  Built from parts rather than by mutating a Date, so December rolls the year. */
function nextMonthStart(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/* ----------------------------------------------------------------------------
 * THIS WEEK
 * ------------------------------------------------------------------------- */

export interface WeekDay {
  /** 'YYYY-MM-DD'. */
  readonly date: string;
  /** 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  readonly isToday: boolean;
  readonly tasks: readonly PipelineTask[];
}

/**
 * Monday to Sunday around a given date, with each day's content on it.
 *
 * ⚠️ A task lands on its `publishedOn` where it has one, and its `dueDate` otherwise.
 * That is the honest answer to "what is happening this week": scheduled work sits on
 * the day it goes out, and unscheduled work sits on the day it is due. Using only
 * `dueDate` would leave every scheduled post off the strip.
 */
export function weekOf(
  tasks: readonly PipelineTask[],
  today: string,
  /** How many days to show. Six matches the owner's mockup (Mon–Sat). */
  dayCount = 7,
): readonly WeekDay[] {
  const monday = mondayOf(today);
  const days: WeekDay[] = [];

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDays(monday, offset);
    days.push({
      date,
      weekday: offset + 1,
      isToday: date === today,
      tasks: tasks.filter((task) => {
        if (task.contentKind === null) return false;
        if (task.status === 'cancelled') return false;
        return (task.publishedOn ?? task.dueDate) === date;
      }),
    });
  }

  return days;
}

/** The Monday of the ISO week containing `date`. UTC parts throughout — local parts
 *  would put the week boundary in a different place depending on where this runs. */
export function mondayOf(date: string): string {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  const jsDay = new Date(ms).getUTCDay(); // 0 = Sunday
  const iso = jsDay === 0 ? 7 : jsDay;
  return toIso(ms - (iso - 1) * 86_400_000);
}

function addDays(date: string, days: number): string {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return toIso(ms + days * 86_400_000);
}

function toIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* ----------------------------------------------------------------------------
 * WHAT NEEDS ATTENTION
 * ------------------------------------------------------------------------- */

export interface AttentionItem {
  readonly key: string;
  readonly count: number;
  readonly label: string;
  readonly token: string;
}

/**
 * The right-hand "Attention Needed" list.
 *
 * ⚠️ Only rows with a non-zero count are returned. A panel headed "Attention Needed"
 * listing "0 overdue items" is telling you to attend to nothing, which is worse than
 * saying nothing — and the owner's standing objection is to text that does not inform.
 */
export function attention(
  tasks: readonly PipelineTask[],
  today: string,
): readonly AttentionItem[] {
  const stages = tasks.map((task) => ({ task, stage: stageOf(task, today) }));

  const overdue = tasks.filter(
    (task) =>
      task.contentKind !== null &&
      task.status !== 'done' &&
      task.status !== 'cancelled' &&
      task.publishedOn === null &&
      task.dueDate !== null &&
      task.dueDate < today,
  ).length;

  const awaitingApproval = stages.filter((s) => s.stage === 'review').length;

  /* "Missing asset": a deliverable due or scheduled with no finished file attached.
     That is the thing that actually blocks a post going out on time. */
  const scheduledThisWeek = stages.filter(
    (s) =>
      s.stage === 'scheduled' &&
      s.task.publishedOn !== null &&
      s.task.publishedOn <= addDays(today, 7),
  ).length;

  return [
    { key: 'overdue', count: overdue, label: 'overdue items', token: 'feedback-error' },
    {
      key: 'approval',
      count: awaitingApproval,
      label: 'awaiting approval',
      token: 'feedback-warning',
    },
    {
      key: 'scheduled',
      count: scheduledThisWeek,
      label: 'scheduled this week',
      token: 'feedback-info',
    },
  ].filter((item) => item.count > 0);
}
