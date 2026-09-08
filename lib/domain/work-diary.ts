import { CONTENT_KIND_NAME, STATUS_META, type TaskStatus } from './constants';
import type { Cell, Report, ReportPeriod, ReportTask, TaskLink } from './reports';

/* ============================================================================
 * THE WORK DIARY — a table per person (or per project), a row per day
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-08:
 *
 *   *"if I say 'data on the basis of member,' then you say that it's Abdul
 *   Moiz's member and it's tasks start from the first date, whatever date I
 *   select, from that date till today's date… on 1 September he did this, on
 *   the second he did this, on the third he did this, and that way I can read
 *   all of the report. This whole report will be generated member by member:
 *   first member's table, then the next member's name and that's their table."*
 *
 * and, on the other arrangement:
 *
 *   *"if someone selects 'Sorted by Project' then the project name, in the same
 *   way, the task will be sorted on the basis of dates… 2 September: all
 *   persons' tasks."*
 *
 * So one shape, two groupings. The group is a person or a project; inside it the
 * days run in ascending order; inside a day sit that day's tasks, each showing
 * the OTHER dimension — a member's table names the project, a project's table
 * names the person.
 *
 * ── ⚠️ WHY THIS IS NOT `work-report.ts` WITH A SORT ─────────────────────────
 * That module produces one row per project-and-person pairing with the tasks
 * folded inside it, which answers "how much is each pairing carrying". This
 * answers "what happened, day by day" — the rows are DAYS, and a day with
 * nothing in it is a fact worth printing rather than a row that does not exist.
 * A sort cannot turn one into the other: sorting reorders rows, and these are
 * different rows.
 *
 * ── ⚠️ EVERY DAY IN THE RANGE APPEARS, INCLUDING THE EMPTY ONES ─────────────
 * *"I want to see that on every day and the day increases properly in proper
 * ascending order."* A diary that silently skips 3 September reads as though
 * nothing was asked of that day; one that prints it empty says plainly that
 * nothing was recorded. For a report used to assess who did what, the gap is
 * the point — leaving it out would flatter every member equally.
 *
 * ── ⚠️ WHICH DAY A TASK BELONGS TO ─────────────────────────────────────────
 * Three candidates, in this order, and the order is a decision:
 *
 *   1. `publishedOn` — the day an asset actually went live. Migration 055 exists
 *      because every report once read `completedAt` here: a reel finished Monday
 *      and posted Friday belongs to FRIDAY, and this is the same rule.
 *   2. `completedAt` — for work that is not a post, the day it was finished.
 *   3. `dueDate` — for work still open, the day it was meant for.
 *
 * A task with none of the three cannot be placed on any day, so it is collected
 * into `undated` rather than dropped. Dropping it would make the diary quietly
 * disagree with every other report over the same period.
 * ========================================================================= */

export const DIARY_GROUPINGS = ['member', 'project'] as const;
export type DiaryGrouping = (typeof DIARY_GROUPINGS)[number];

export const DIARY_GROUPING_LABEL: Readonly<Record<DiaryGrouping, string>> = {
  member: 'By member',
  project: 'By project',
};

/** One task as it appears on a day. */
export interface DiaryEntry {
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  /** The dimension this table is NOT grouped by: the project, or the person. */
  readonly counterpart: string;
  /** "Static post", "Reel", or "Task" for work that is not a deliverable. */
  readonly category: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  /** Which of the three dates put this task on this day — printed as a caption
   *  so a reader is never left guessing why a task is filed where it is. */
  readonly dateBasis: 'published' | 'completed' | 'due';
  readonly links: readonly TaskLink[];
}

export interface DiaryDay {
  /** `yyyy-mm-dd`. */
  readonly date: string;
  readonly entries: readonly DiaryEntry[];
}

export interface DiaryGroup {
  readonly key: string;
  /** The person's or the project's name — the table's heading. */
  readonly title: string;
  /** A person's picture. Null for a project group, and for a missing photo. */
  readonly avatarUrl: string | null;
  readonly days: readonly DiaryDay[];
  /** Tasks with no date at all — see the header. */
  readonly undated: readonly DiaryEntry[];
  readonly tasksAssigned: number;
  readonly tasksDone: number;
  /** How many of the range's days have anything on them. */
  readonly activeDays: number;
}

export interface WorkDiary {
  readonly grouping: DiaryGrouping;
  readonly from: string;
  readonly to: string;
  readonly groups: readonly DiaryGroup[];
}

/* ==========================================================================
 * BUILDING IT
 * ========================================================================== */

/** Every date from `from` to `to` inclusive, ascending. */
export function daysInRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  /* ⚠️ CAPPED. A custom range is whatever somebody typed, and a mistyped year
     would otherwise ask this function for three hundred thousand rows and hang
     the page. A year of days is already far more than anybody reads. */
  const MAX_DAYS = 400;

  const out: string[] = [];
  for (let at = start; at <= end && out.length < MAX_DAYS; at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10));
  }
  return out;
}

/** Which day a task is filed under, and why. See the header. */
export function dayFor(
  task: ReportTask,
): { readonly date: string; readonly basis: DiaryEntry['dateBasis'] } | null {
  if (task.publishedOn) return { date: task.publishedOn, basis: 'published' };
  if (task.completedAt) return { date: task.completedAt.slice(0, 10), basis: 'completed' };
  if (task.dueDate) return { date: task.dueDate, basis: 'due' };
  return null;
}

function categoryOf(task: ReportTask): string {
  return task.contentKind ? CONTENT_KIND_NAME[task.contentKind] : 'Task';
}

function isDone(status: TaskStatus): boolean {
  return STATUS_META[status].category === 'done';
}

export function buildWorkDiary(input: {
  readonly tasks: readonly ReportTask[];
  readonly period: ReportPeriod;
  readonly grouping: DiaryGrouping;
}): WorkDiary {
  const { tasks, period, grouping } = input;
  const dates = daysInRange(period.start, period.end);
  const inRange = new Set(dates);

  interface Bucket {
    key: string;
    title: string;
    avatarUrl: string | null;
    byDay: Map<string, DiaryEntry[]>;
    undated: DiaryEntry[];
    assigned: number;
    done: number;
  }

  const buckets = new Map<string, Bucket>();

  const bucketFor = (task: ReportTask): Bucket => {
    /* ⚠️ AN UNASSIGNED TASK IS ITS OWN GROUP, NOT A CRASH AND NOT A SILENT
       DROP. Work nobody owns is exactly what a manager reading this report is
       looking for, so it gets a heading that says so. */
    const key =
      grouping === 'member' ? (task.assigneeId ?? 'unassigned') : task.projectId;
    const title =
      grouping === 'member'
        ? (task.assigneeName ?? 'Unassigned')
        : task.projectName;

    const existing = buckets.get(key);
    if (existing) return existing;

    const made: Bucket = {
      key,
      title,
      avatarUrl: grouping === 'member' ? task.assigneeAvatarUrl : null,
      byDay: new Map(),
      undated: [],
      assigned: 0,
      done: 0,
    };
    buckets.set(key, made);
    return made;
  };

  for (const task of tasks) {
    const bucket = bucketFor(task);
    bucket.assigned += 1;
    if (isDone(task.status)) bucket.done += 1;

    const entry: DiaryEntry = {
      reference: task.reference,
      title: task.title,
      description: task.description,
      counterpart:
        grouping === 'member' ? task.projectName : (task.assigneeName ?? 'Unassigned'),
      category: categoryOf(task),
      status: task.status,
      statusLabel: STATUS_META[task.status].label,
      dateBasis: 'due',
      links: task.links,
    };

    const placed = dayFor(task);
    if (!placed) {
      bucket.undated.push(entry);
      continue;
    }

    /* ⚠️ A task whose date falls OUTSIDE the range still belongs to this report
       — `taskInPeriod` already decided it does — but it has no row to sit on.
       Filing it under `undated` keeps it visible instead of vanishing between
       the two rules. */
    if (!inRange.has(placed.date)) {
      bucket.undated.push({ ...entry, dateBasis: placed.basis });
      continue;
    }

    const day = bucket.byDay.get(placed.date) ?? [];
    day.push({ ...entry, dateBasis: placed.basis });
    bucket.byDay.set(placed.date, day);
  }

  const groups: DiaryGroup[] = [...buckets.values()]
    .map((bucket) => ({
      key: bucket.key,
      title: bucket.title,
      avatarUrl: bucket.avatarUrl,
      days: dates.map((date) => ({
        date,
        /* ⚠️ Sorted inside the day so two people reading the same report see the
           same order. A Map preserves insertion order, which is the order the
           task list happened to arrive in. */
        entries: [...(bucket.byDay.get(date) ?? [])].sort((a, b) =>
          a.reference.localeCompare(b.reference),
        ),
      })),
      undated: [...bucket.undated].sort((a, b) => a.reference.localeCompare(b.reference)),
      tasksAssigned: bucket.assigned,
      tasksDone: bucket.done,
      activeDays: dates.filter((date) => (bucket.byDay.get(date)?.length ?? 0) > 0).length,
    }))
    /* Alphabetical, so the same report twice running puts the same person
       first. Ordering by volume would move somebody up the page for having had
       a busy week, which makes two printouts hard to compare. */
    .sort((a, b) => a.title.localeCompare(b.title));

  return { grouping, from: period.start, to: period.end, groups };
}

/* ==========================================================================
 * THE SAME THING AS A TYPED-CELL REPORT, FOR THE EXPORTS
 * ==========================================================================
 * ⚠️ DERIVED, NOT RE-COMPUTED. The CSV, .xlsx and PDF writers already speak
 * `Report`; converting here means the file and the screen cannot disagree about
 * what happened on 3 September, because one is built from the other. Same
 * reasoning as `work-report.ts`'s own `toReport`.
 * ========================================================================== */

export function diaryToReport(diary: WorkDiary, period: ReportPeriod): Report {
  const rows: Cell[][] = [];

  for (const group of diary.groups) {
    for (const day of group.days) {
      /* ⚠️ EMPTY DAYS ARE IN THE EXPORT TOO. A spreadsheet that skips them
         cannot be read as a diary — the gap is what somebody is looking for. */
      if (day.entries.length === 0) {
        rows.push([
          { kind: 'text', value: group.title },
          { kind: 'date', value: day.date },
          { kind: 'text', value: '—' },
          { kind: 'text', value: '—' },
          { kind: 'text', value: '' },
          { kind: 'text', value: '—' },
        ]);
        continue;
      }

      for (const entry of day.entries) {
        rows.push([
          { kind: 'text', value: group.title },
          { kind: 'date', value: day.date },
          { kind: 'text', value: entry.counterpart },
          { kind: 'text', value: entry.title },
          { kind: 'text', value: entry.description ?? '' },
          { kind: 'text', value: entry.statusLabel },
        ]);
      }
    }

    for (const entry of group.undated) {
      rows.push([
        { kind: 'text', value: group.title },
        { kind: 'text', value: 'No date' },
        { kind: 'text', value: entry.counterpart },
        { kind: 'text', value: entry.title },
        { kind: 'text', value: entry.description ?? '' },
        { kind: 'text', value: entry.statusLabel },
      ]);
    }
  }

  const byWhat = diary.grouping === 'member' ? 'Member' : 'Project';

  const assigned = diary.groups.reduce((sum, g) => sum + g.tasksAssigned, 0);
  const done = diary.groups.reduce((sum, g) => sum + g.tasksDone, 0);

  return {
    type: 'completion',
    title: `Work report — ${diary.grouping === 'member' ? 'by member' : 'by project'}`,
    /* ⚠️ Built from the dates rather than a label, because this module's
       `ReportPeriod` is the narrow `{ start, end }` in reports.ts and not the
       richer one in report-periods.ts. Two types, one name — worth knowing
       before reaching for `period.label` here. */
    subtitle: `${period.start} to ${period.end}, day by day`,
    period,
    columns: [
      { key: 'group', label: byWhat, kind: 'text', width: 16 },
      { key: 'date', label: 'Date', kind: 'date', width: 12 },
      { key: 'counterpart', label: diary.grouping === 'member' ? 'Project' : 'Person', kind: 'text', width: 16 },
      { key: 'task', label: 'Task', kind: 'text', width: 22 },
      /* ⚠️ THE COLUMN THE OWNER CALLED "the most important thing". Widest on
         the sheet, because a description is a sentence and everything else here
         is a word. */
      { key: 'description', label: 'Description', kind: 'text', width: 24 },
      { key: 'status', label: 'Status', kind: 'text', width: 10 },
    ],
    rows,
    figures: [
      { label: `${byWhat}s`, value: { kind: 'number', value: diary.groups.length } },
      { label: 'Tasks assigned', value: { kind: 'number', value: assigned } },
      { label: 'Tasks done', value: { kind: 'number', value: done } },
    ],
    notes: [
      'Every day in the period is listed, including days with nothing recorded.',
      'A task is filed under the day it was published, or completed, or was due — in that order.',
    ],
  };
}
