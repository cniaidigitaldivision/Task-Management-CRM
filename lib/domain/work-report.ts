import {
  CONTENT_KIND_LABEL,
  PROJECT_ROLE_LABEL,
  STATUS_META,
  type ContentKind,
} from './constants';
import { taskInPeriod, type Cell, type Report, type ReportInput, type ReportTask } from './reports';

/* ============================================================================
 * THE WORK REPORT — a row per person, per project
 * ----------------------------------------------------------------------------
 * The owner's mockup, and their words on being shown something else: *"I told you
 * that on this page I want the exact same layout that I have shared with you… All
 * this data in this table in a sleek way… but make sure that the data is according
 * to my database."*
 *
 * ── ⚠️ WHY THIS IS NOT ONE OF THE FOUR REPORTS IN `reports.ts` ──────────────
 * Those four each group by ONE thing — a person, a project, a status. This groups
 * by the PAIRING, and that is a different question: "what is Kashif doing on
 * Daniyal Marketing" cannot be read off a report grouped by person (it merges his
 * four projects) or by project (it merges its four people). Bending one of them
 * into this shape would have broken the report it already answers.
 *
 * So it is its own module, and the Report-type dropdown carries both: this is
 * "Work reports", the four analytical ones are still there beside it.
 *
 * ── ⚠️ IT STILL PRODUCES A `Report` ─────────────────────────────────────────
 * `toReport()` at the bottom converts these rows into the typed-cell shape the CSV
 * writer, the .xlsx writer and the PDF composer already speak. That is the whole
 * reason the export menu keeps working for this report without three new writers:
 * the screen gets the rich rows — avatars, brand marks, badges — and the exports
 * get the same numbers as cells. Two renderings, one computation, and they cannot
 * disagree because one is derived from the other.
 * ========================================================================= */

export type WorkStatus = 'active' | 'completed' | 'pending' | 'overdue';

export const WORK_STATUS_META: Readonly<
  Record<WorkStatus, { readonly label: string; readonly token: string }>
> = {
  /* ⚠️ Colours taken from the owner's drawing, which shows Completed in green,
     Pending in amber and Overdue in red — and they are the semantically right way
     round anyway. Completed is the good end of this scale, so it takes the green
     that "done" carries everywhere else in the product; Active is work in flight,
     so it takes the brand teal rather than competing with it. */
  active: { label: 'Active', token: 'accent-primary' },
  completed: { label: 'Completed', token: 'status-done' },
  pending: { label: 'Pending', token: 'status-revisions' },
  overdue: { label: 'Overdue', token: 'status-blocked' },
};

export interface WorkRow {
  readonly key: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly userId: string | null;
  readonly personName: string;
  readonly avatarUrl: string | null;
  /** The label, already resolved. Null where they hold no role on this project. */
  readonly role: string | null;
  readonly platforms: readonly string[];
  readonly tasksAssigned: number;
  readonly tasksDone: number;
  readonly tasksPending: number;
  readonly postsPublished: number;
  readonly contentTypes: readonly string[];
  /** "4 reels, 10 posts, 8 stories" — the mockup's Activity Summary column. */
  readonly activitySummary: string;
  readonly status: WorkStatus;
  /** ISO, or null. The screen turns it into "1h ago" with its own clock. */
  readonly lastActive: string | null;
}

export interface PosterRow {
  readonly userId: string | null;
  readonly personName: string;
  readonly avatarUrl: string | null;
  readonly projects: readonly string[];
  readonly totalPosts: number;
  readonly platforms: readonly string[];
  readonly mostUsedPlatform: string | null;
  readonly thisWeek: number;
}

export interface WorkReport {
  readonly rows: readonly WorkRow[];
  readonly posters: readonly PosterRow[];
  /**
   * Whose name carries the "Top poster" badge.
   *
   * ⚠️ ONE person across the whole report, not one per row. The mockup shows the
   * badge beside a single name in each table, and a badge that appeared on eight
   * rows would say nothing — "top" is a superlative or it is decoration.
   */
  readonly topPosterId: string | null;
}

export const WORK_SORTS = [
  'posts',
  'assigned',
  'done',
  'pending',
  'project',
  'person',
  'recent',
] as const;
export type WorkSort = (typeof WORK_SORTS)[number];

export const WORK_SORT_LABEL: Readonly<Record<WorkSort, string>> = {
  posts: 'Posts Published',
  assigned: 'Tasks Assigned',
  done: 'Tasks Done',
  pending: 'Tasks Pending',
  project: 'Project',
  person: 'Person',
  recent: 'Last Active',
};

/* ==========================================================================
 * SHORT PLURALS FOR THE ACTIVITY SUMMARY
 * ==========================================================================
 * ⚠️ Not `CONTENT_KIND_LABEL`. That reads "Reel / short video" and "Static post",
 * which are right in a dropdown where somebody is choosing, and unreadable strung
 * together: "4 Reel / short videos, 10 Static posts". The summary is prose in a
 * narrow column, so it gets prose words.
 * ========================================================================== */
const ACTIVITY_WORD: Readonly<Record<ContentKind, readonly [string, string]>> = {
  static: ['post', 'posts'],
  reel: ['reel', 'reels'],
  carousel: ['carousel', 'carousels'],
  story: ['story', 'stories'],
  video: ['video', 'videos'],
  website: ['website update', 'website updates'],
  ad: ['ad', 'ads'],
  report: ['report', 'reports'],
  other: ['item', 'items'],
};

const isDone = (t: ReportTask) => STATUS_META[t.status].category === 'done';
const isClosed = (t: ReportTask) => {
  const category = STATUS_META[t.status].category;
  return category === 'done' || category === 'cancelled';
};

/**
 * Scope — the same five narrowings the analytical reports apply.
 *
 * ⚠️ Duplicated from `reports.ts` for the same reason `report-charts.ts`
 * duplicates it, and checked by the same kind of test: exporting the private
 * helper would make one report's internals part of every other report's contract.
 */
function scoped(input: ReportInput): ReportTask[] {
  return withoutPeriod(input).filter((t) => taskInPeriod(t, input.period));
}

/**
 * Everything the reader narrowed to EXCEPT the period.
 *
 * ── ⚠️ WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 * The "This week" column is the only figure on the page that is deliberately not
 * about the chosen period — it is about right now. Computing it from the
 * period-scoped rows made it structurally zero whenever the period was anything
 * other than the current week, which is what the owner caught: *"if I select Last
 * Week then why is This Week 0?"*
 *
 * It was zero because "published last week" and "published this week" are
 * mutually exclusive by definition, so the column was answering a question that
 * could only ever have one answer. Its intent was always "how much has this person
 * put out in the last seven days, whatever period you happen to be reviewing" —
 * a freshness reading beside a historical one — and that needs the period lifted
 * and every other filter kept.
 */
function withoutPeriod(input: ReportInput): ReportTask[] {
  const { filters } = input;
  let tasks = [...input.tasks];

  if (input.subjectId) tasks = tasks.filter((t) => t.assigneeId === input.subjectId);

  if (filters.projectIds.length > 0) {
    const wanted = new Set(filters.projectIds);
    tasks = tasks.filter((t) => wanted.has(t.projectId));
  }
  if (filters.statuses.length > 0) {
    const wanted = new Set<string>(filters.statuses);
    tasks = tasks.filter((t) => wanted.has(t.status));
  }
  if (filters.platforms.length > 0) {
    const wanted = new Set(filters.platforms);
    tasks = tasks.filter((t) => t.platforms.some((slug) => wanted.has(slug)));
  }
  if (filters.contentKinds.length > 0) {
    const wanted = new Set<string>(filters.contentKinds);
    tasks = tasks.filter((t) => wanted.has(t.contentKind ?? 'none'));
  }

  return tasks;
}

/** Published since Monday, whatever period the report is showing. */
function publishedThisWeek(input: ReportInput, weekStart: string): ReportTask[] {
  return withoutPeriod(input).filter(
    (t) => t.contentKind !== null && t.publishedOn !== null && t.publishedOn >= weekStart,
  );
}

export interface WorkReportOptions {
  /** `projectId:userId` → project_role. From `projectRolesByPerson`. */
  readonly roles: ReadonlyMap<string, string>;
  readonly sort: WorkSort;
  readonly direction: 'asc' | 'desc';
  /** Start of the current week, `yyyy-mm-dd`, for the "This week" column. */
  readonly weekStart: string;
}

export function buildWorkReport(input: ReportInput, options: WorkReportOptions): WorkReport {
  const tasks = scoped(input);

  /* ── The pairing ────────────────────────────────────────────────────────
     Unassigned work gets its own row rather than being dropped. A division with
     twelve unassigned overdue tasks should see them; filed under a name nobody
     owns is how they stay unnoticed — the same rule the completion report uses. */
  const groups = new Map<string, ReportTask[]>();
  for (const task of tasks) {
    const key = `${task.projectId}:${task.assigneeId ?? '@unassigned'}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  const rows: WorkRow[] = [...groups.entries()].map(([key, mine]) => {
    const first = mine[0];
    const open = mine.filter((t) => !isClosed(t));
    const published = mine.filter((t) => t.contentKind !== null && t.publishedOn !== null);

    /* Platforms actually reached, de-duplicated. A task published to Facebook as
       both a post and a reel is one platform, not two. */
    const platforms = [...new Set(published.flatMap((t) => t.platforms))];

    const kinds = new Map<ContentKind, number>();
    for (const task of published) {
      if (task.contentKind) kinds.set(task.contentKind, (kinds.get(task.contentKind) ?? 0) + 1);
    }

    return {
      key,
      projectId: first.projectId,
      projectName: first.projectName,
      userId: first.assigneeId,
      personName: first.assigneeName ?? 'Unassigned',
      avatarUrl: first.assigneeAvatarUrl,
      role: first.assigneeId
        ? (PROJECT_ROLE_LABEL[options.roles.get(key) ?? ''] ?? null)
        : null,
      platforms,
      tasksAssigned: mine.length,
      tasksDone: mine.filter(isDone).length,
      tasksPending: open.length,
      postsPublished: published.length,
      contentTypes: [...kinds.keys()].map((k) => CONTENT_KIND_LABEL[k]),
      activitySummary: summarise(kinds),
      status: statusOf(open, input.today),
      lastActive: lastActiveOf(mine),
    };
  });

  /* ── Posting performance by member ──────────────────────────────────────
     Grouped by PERSON across projects, which is why it is a second table rather
     than a sort of the first: "who posts the most" and "who does what where" are
     different questions and the mockup asks both. */
  const byPerson = new Map<string, WorkRow[]>();
  for (const row of rows) {
    const id = row.userId ?? '@unassigned';
    const bucket = byPerson.get(id);
    if (bucket) bucket.push(row);
    else byPerson.set(id, [row]);
  }

  /* ⚠️ From `publishedThisWeek`, NOT from `tasks`. See the note on withoutPeriod:
     taking it from the period-scoped rows made this column read 0 for every period
     except the current week, which is a number that cannot tell you anything. */
  const weekTasks = publishedThisWeek(input, options.weekStart);

  const posters: PosterRow[] = [...byPerson.values()]
    .map((mine) => {
      const first = mine[0];
      const platformCounts = new Map<string, number>();
      for (const row of mine) {
        for (const slug of row.platforms) {
          platformCounts.set(slug, (platformCounts.get(slug) ?? 0) + row.postsPublished);
        }
      }

      const ranked = [...platformCounts.entries()].sort((a, b) => b[1] - a[1]);

      return {
        userId: first.userId,
        personName: first.personName,
        avatarUrl: first.avatarUrl,
        projects: mine.map((r) => r.projectName),
        totalPosts: mine.reduce((sum, r) => sum + r.postsPublished, 0),
        platforms: ranked.map(([slug]) => slug),
        mostUsedPlatform: ranked[0]?.[0] ?? null,
        thisWeek: weekTasks.filter((t) => (t.assigneeId ?? '@unassigned') === (first.userId ?? '@unassigned')).length,
      };
    })
    /* Always by posts, whatever the table above is sorted by. This table IS the
       ranking — re-ordering it alphabetically would leave it with no meaning. */
    .sort((a, b) => b.totalPosts - a.totalPosts);

  /* ⚠️ A tie means NOBODY is top. Two people on 22 posts and a badge on whichever
     the sort happened to put first is a claim the data does not support. */
  const best = posters[0];
  const tied = best !== undefined && posters.filter((p) => p.totalPosts === best.totalPosts).length > 1;
  const topPosterId = best && best.totalPosts > 0 && !tied ? best.userId : null;

  return { rows: sortRows(rows, options.sort, options.direction), posters, topPosterId };
}

/** "4 reels, 10 posts, 8 stories" — largest first, so the headline number leads. */
function summarise(kinds: ReadonlyMap<ContentKind, number>): string {
  const parts = [...kinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => {
      const [one, many] = ACTIVITY_WORD[kind];
      return `${count} ${count === 1 ? one : many}`;
    });
  return parts.join(', ');
}

/**
 * ── ⚠️ FOUR STATES, AND NONE OF THEM IS DERIVABLE FROM THE COUNTS ──────────
 * A reader looking at "8 assigned, 6 done, 2 pending" cannot tell whether those 2
 * are late, waiting on somebody, or being worked on right now — and those are
 * three very different conversations to have in a meeting. That is exactly what
 * this column is for, so it is computed from the open tasks themselves:
 *
 *   overdue    something open is already past its due date
 *   completed  nothing is open at all
 *   pending    open work exists but none of it is moving
 *   active     something is in progress
 *
 * Overdue is measured against TODAY, not the period end — see ReportInput.today.
 */
function statusOf(open: readonly ReportTask[], today: string): WorkStatus {
  if (open.length === 0) return 'completed';
  if (open.some((t) => t.dueDate !== null && t.dueDate < today)) return 'overdue';
  if (open.some((t) => STATUS_META[t.status].timerRuns)) return 'active';
  return 'pending';
}

/** The most recent thing that happened, whatever kind of thing it was. */
function lastActiveOf(tasks: readonly ReportTask[]): string | null {
  let latest: string | null = null;
  for (const task of tasks) {
    for (const stamp of [task.completedAt, task.updatedAt]) {
      if (stamp && (latest === null || stamp > latest)) latest = stamp;
    }
  }
  return latest;
}

function sortRows(rows: WorkRow[], sort: WorkSort, direction: 'asc' | 'desc'): WorkRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  const value = (row: WorkRow): number | string => {
    switch (sort) {
      case 'posts':
        return row.postsPublished;
      case 'assigned':
        return row.tasksAssigned;
      case 'done':
        return row.tasksDone;
      case 'pending':
        return row.tasksPending;
      case 'project':
        return row.projectName;
      case 'person':
        return row.personName;
      case 'recent':
        /* ⚠️ Never-active sorts as the empty string, which puts it FIRST
           ascending and last descending — the same place a zero would go, and
           the honest position for "nothing has happened here". */
        return row.lastActive ?? '';
    }
  };

  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (typeof left === 'string' && typeof right === 'string') {
      return sign * left.localeCompare(right);
    }
    return sign * (Number(left) - Number(right));
  });
}

/* ==========================================================================
 * THE EXPORT SHAPE
 * ==========================================================================
 * Converted into the same typed-cell `Report` the other four produce, so CSV,
 * .xlsx and the PDF composer all work on this report with no new writers. See the
 * header.
 * ========================================================================== */

const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number): Cell => ({ kind: 'number', value });

export function workReportToReport(
  work: WorkReport,
  input: ReportInput,
  nowIso: string,
): Report {
  const who = input.subjectName ?? 'Everybody';
  return {
    type: 'completion',
    title: 'Work report',
    subtitle:
      input.period.start === input.period.end
        ? `${who} · ${input.period.start}`
        : `${who} · ${input.period.start} to ${input.period.end}`,
    period: input.period,
    columns: [
      { key: 'project', label: 'Project', kind: 'text', width: 22 },
      { key: 'person', label: 'Person', kind: 'text', width: 20 },
      { key: 'role', label: 'Role', kind: 'text', width: 16 },
      { key: 'platform', label: 'Platform', kind: 'text', width: 18 },
      { key: 'assigned', label: 'Tasks Assigned', kind: 'number' },
      { key: 'done', label: 'Tasks Done', kind: 'number' },
      { key: 'pending', label: 'Tasks Pending', kind: 'number' },
      { key: 'posts', label: 'Posts Published', kind: 'number' },
      { key: 'contentType', label: 'Content Type', kind: 'text', width: 24 },
      { key: 'activity', label: 'Activity Summary', kind: 'text', width: 26 },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'lastActive', label: 'Last Active', kind: 'date' },
    ],
    rows: work.rows.map((row) => [
      text(row.projectName),
      text(row.personName),
      text(row.role ?? '—'),
      /* Slugs capitalised. The spreadsheet has no brand marks, so the column has
         to carry the same fact as words. */
      text(row.platforms.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')),
      num(row.tasksAssigned),
      num(row.tasksDone),
      num(row.tasksPending),
      num(row.postsPublished),
      text(row.contentTypes.join(', ')),
      text(row.activitySummary),
      text(WORK_STATUS_META[row.status].label),
      { kind: 'date', value: row.lastActive?.slice(0, 10) ?? null },
    ]),
    figures: [
      { label: 'Rows', value: num(work.rows.length), hint: 'project and person pairings' },
      {
        label: 'Posts published',
        value: num(work.rows.reduce((sum, r) => sum + r.postsPublished, 0)),
      },
      {
        label: 'Tasks done',
        value: num(work.rows.reduce((sum, r) => sum + r.tasksDone, 0)),
      },
      {
        label: 'Still open',
        value: num(work.rows.reduce((sum, r) => sum + r.tasksPending, 0)),
      },
    ],
    notes: [
      'One row per project and person. Somebody working on three projects appears three times, because "what is this person doing here" is a different question from "what is this person doing".',
      'Posts Published counts ASSETS that went live, measured on the published date rather than the completion date. One asset cross-posted to four platforms is one post, not four — the Platform column shows all four.',
      'Status is read from the open tasks, not from the counts: Overdue means something open is already past its due date, Pending means open work exists but none of it is moving, Active means something is in progress, and Completed means nothing is open.',
      `Last Active is the most recent change of any kind, as at ${nowIso.slice(0, 10)}.`,
    ],
  };
}
