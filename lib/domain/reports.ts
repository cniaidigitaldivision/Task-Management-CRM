import {
  EFFORT_POINTS,
  PROJECT_TYPE_META,
  STATUS_META,
  type ContentKind,
  type ProjectType,
  type TaskStatus,
} from './constants';

/* ============================================================================
 * REPORTS — CHANGE-PLAN 5.1, doc 10 §8, ADR-003
 * ----------------------------------------------------------------------------
 * Owner: *"Reports should have types — I can select which kind of report I
 * want."* Four types (decision 5), each for **one person or everybody**, over a
 * period the reader chooses.
 *
 * ── THIS FILE IS PURE, AND THAT IS THE POINT ─────────────────────────────────
 * No database, no clock, no framework — doc 20 §1. A report is the most
 * arithmetic-dense thing in the system and the easiest place to be quietly
 * wrong: an on-time rate that counts undated tasks as successes looks completely
 * plausible and is a lie. Pure means every figure here can be tested against
 * hand-worked numbers, which is the only way to know.
 *
 * ── ONE DEFINITION, THREE OUTPUTS ────────────────────────────────────────────
 * A report is **typed cells**, not strings. That single decision is what stops
 * this batch turning into three parallel implementations:
 *
 *     Report  →  the screen      (renders each kind its own way)
 *             →  CSV            (text, with the formula guard)
 *             →  .xlsx          (real numbers, real dates, real booleans)
 *
 * If rows were pre-formatted strings, the spreadsheet would receive "83%" and
 * "2h 15m" as text, which cannot be summed or charted — and a spreadsheet you
 * cannot sum is a worse CSV. So the report says `{kind:'percent', value:83}` and
 * each writer decides how that looks.
 *
 * ── SCOPE HERE IS PRESENTATION, NOT SECURITY ─────────────────────────────────
 * `subjectId` narrows a report to one person. It is **not** what stops a Member
 * reading the division's figures — row-level security already did that before
 * these rows existed, so a Member's "everybody" is themselves and nothing more
 * (ADR-003). Filtering here is convenience for somebody who can already see
 * everything. Any check that mattered would not live in a pure function.
 * ========================================================================= */

export const REPORT_TYPES = ['completion', 'workload', 'project_status', 'time'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_META: Readonly<
  Record<ReportType, { readonly label: string; readonly question: string }>
> = {
  completion: {
    label: 'Completion',
    question: 'Are we finishing what we said we would, on time?',
  },
  workload: {
    label: 'Workload & capacity',
    question: 'Who is over capacity, and who has room?',
  },
  project_status: {
    label: 'Project status',
    question: 'Where does each project stand?',
  },
  time: {
    label: 'Time & overrun',
    question: 'Where is time going past what was allowed?',
  },
};

/** Inclusive ISO dates, `yyyy-mm-dd`. */
export interface ReportPeriod {
  readonly start: string;
  readonly end: string;
}

export type Cell =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  /** 0–100. Stored as the number, so a spreadsheet can average a column. */
  | { readonly kind: 'percent'; readonly value: number }
  | { readonly kind: 'date'; readonly value: string | null }
  /** Minutes. The writers format; nothing stores "2h 15m". */
  | { readonly kind: 'duration'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean };

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: Cell['kind'];
  /** Wider columns for names and titles, so the spreadsheet opens readable. */
  readonly width?: number;
}

export interface ReportFigure {
  readonly label: string;
  readonly value: Cell;
  readonly hint?: string;
}

export interface Report {
  /**
   * ⚠️ WIDER THAN `REPORT_TYPES`, deliberately. Attendance, finance and now the
   * per-project report each build a Report so they can reuse the print sheet in
   * lib/pdf/report-sheet.ts — the owner asked for exactly that THREE times:
   * *"the PDF template should be the same as on the report page"* (2026-08-25),
   * *"make sure the report template is the same as the report pages' PDF
   * template"* (2026-08-26) and, with the export open beside it, *"I want this
   * template of the PDF that I have here with you as a screenshot"*
   * (2026-09-03) — but none is one of the four analytical reports, and none must
   * appear in the Reports page's type dropdown, which is driven by
   * `REPORT_TYPES`.
   *
   * Adding them to that array instead would put tabs on a page whose builder
   * cannot produce them. Only `reportFileStem` reads this field.
   */
  readonly type: ReportType | 'attendance' | 'finance' | 'project';
  readonly title: string;
  readonly subtitle: string;
  readonly period: ReportPeriod;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly (readonly Cell[])[];
  readonly figures: readonly ReportFigure[];
  /**
   * What this report does and does not count. Rendered on screen, written into
   * the export, and printed — because a number without its definition is how two
   * people read the same report and disagree.
   */
  readonly notes: readonly string[];
}

/* ==========================================================================
 * INPUTS — deliberately the narrowest shape each report needs
 * ==========================================================================
 * Not `TaskRow`. A report needs eleven of that type's forty fields, and taking
 * the whole row would tie this pure module to the database's shape and make
 * every test build a forty-field fixture to assert on one number.
 * ========================================================================== */

export interface ReportTask {
  readonly reference: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: ProjectType;
  readonly projectCode: string;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly status: TaskStatus;
  readonly effortPoints: number;
  readonly dueDate: string | null;
  /** ISO timestamp, or null while it is unfinished. */
  readonly completedAt: string | null;
  readonly timeLimitMinutes: number | null;
  readonly timeSpentMinutes: number;
  readonly extensionMinutesGranted: number;
  /**
   * What kind of deliverable this is, or null for work that is not content.
   *
   * ⚠️ NULL IS A REAL ANSWER, not missing data. Oversight work — a client call, a
   * spend review — is work, and it is deliberately not a post. Every posting
   * figure in this system keys off this column being non-null, so a filter on it
   * is the difference between "what did we publish" and "what did we do".
   */
  readonly contentKind: ContentKind | null;
  /**
   * Platform slugs this task was placed on. Empty for anything unpublished or
   * not a post.
   *
   * A LIST, not one value, because one asset goes to several platforms — that is
   * the entire reason `task_placements` is its own table. A task filtered to
   * "Instagram" therefore matches if Instagram is among its platforms; it is not
   * removed for also having gone to Facebook.
   */
  readonly platforms: readonly string[];
  /**
   * The date the asset went live, or null.
   *
   * ⚠️ NOT `completedAt`. Migration 033 was explicit that these are different
   * dates and migration 055 exists because every report was reading the wrong one:
   * a reel finished on Monday and posted on Friday counts against Friday. "Posts
   * published" is measured on THIS column and nothing else.
   */
  readonly publishedOn: string | null;
  /** For the avatar in the work report. Null falls back to initials. */
  readonly assigneeAvatarUrl: string | null;
  /** ISO timestamp of the last change, for "Last active". */
  readonly updatedAt: string;
}

export interface ReportPerson {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly loadPoints: number;
  readonly capacityPoints: number;
  readonly utilisationPct: number;
  readonly bandLabel: string;
  readonly activeTaskCount: number;
  readonly maxConcurrentTasks: number;
  readonly otherWorkPct: number;
}

export interface ReportProject {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly type: ProjectType;
  readonly status: string;
}

/* ==========================================================================
 * FILTERS — every one of them optional, and empty means "no opinion"
 * ==========================================================================
 * Owner: *"I want a proper filter and each and everything should properly
 * implement the filters."*
 *
 * ── ⚠️ EMPTY ARRAY MEANS ALL, AND THAT IS NOT THE SAME AS AN ARRAY OF ALL ───
 * A filter holding every project reads identically to no filter today, and stops
 * doing so the moment somebody adds a project — the saved filter would silently
 * exclude it. So "no opinion" is the empty array, and it is checked with
 * `length === 0` before anything else. This is the difference between a filter
 * that ages well and one that quietly goes stale.
 *
 * ── WHY THESE FIVE AND NOT A GENERIC PREDICATE ──────────────────────────────
 * Each of the five answers a question the owner named for the monthly meeting:
 * which project, who, what state, which platform, what kind of content. A
 * generic predicate would be shorter here and impossible to put in a URL, an
 * audit row, or a PDF header — all three of which have to say what was filtered.
 * ========================================================================== */

export interface ReportFilters {
  /** Project ids. Empty for every project the reader can see. */
  readonly projectIds: readonly string[];
  readonly statuses: readonly TaskStatus[];
  /** Platform slugs, matched against a task's placements. */
  readonly platforms: readonly string[];
  /**
   * Content kinds. `'none'` selects work with NO content kind — the oversight
   * items — which no list of real kinds could ever express.
   */
  readonly contentKinds: readonly (ContentKind | 'none')[];
}

export const EMPTY_FILTERS: ReportFilters = {
  projectIds: [],
  statuses: [],
  platforms: [],
  contentKinds: [],
};

/** True when nothing is filtered — used to label the report honestly. */
export function noFilters(filters: ReportFilters): boolean {
  return (
    filters.projectIds.length === 0 &&
    filters.statuses.length === 0 &&
    filters.platforms.length === 0 &&
    filters.contentKinds.length === 0
  );
}

/**
 * Which column to order the table by, and which way.
 *
 * ── WHY A COLUMN KEY AND NOT A SORT FUNCTION ────────────────────────────────
 * The four report types have different columns, so a shared enum of sort modes
 * would be wrong for three of them. A column KEY is the one thing every report
 * already publishes, it survives being put in a URL, and it means the control on
 * screen can be built from `report.columns` rather than from a second list that
 * has to be kept in step with the first.
 *
 * An empty key means the report's own natural order — which is chosen per type
 * and is usually the most useful one (utilisation descending for workload,
 * alphabetical for completion). "Default" has to remain expressible.
 */
export interface ReportSort {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

export const NATURAL_SORT: ReportSort = { key: '', direction: 'asc' };

export interface ReportInput {
  readonly type: ReportType;
  readonly period: ReportPeriod;
  /** One person, or null for everybody the reader can see. */
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  /**
   * Today, as `yyyy-mm-dd`. Passed in rather than read from a clock, because
   * this module is pure — and needed because **"overdue" is measured against
   * today, not against the end of the period**.
   *
   * That distinction is not pedantry. Ask for August's report on the 12th and
   * measuring against the period end would report everything due later in the
   * month as already overdue — a page of red for work that is not late at all.
   * Ask for July's report in August and today is the right measure anyway,
   * because anything still open from July genuinely is late.
   */
  readonly today: string;
  readonly tasks: readonly ReportTask[];
  readonly people: readonly ReportPerson[];
  readonly projects: readonly ReportProject[];
  readonly filters: ReportFilters;
  readonly sort: ReportSort;
}

/* ==========================================================================
 * THE PERIOD RULE — defined once, used by every report
 * ==========================================================================
 * A task belongs to a period if it was **completed inside it**, or if it is
 * **still open and due inside it**.
 *
 * Both halves are needed and each excludes something worth excluding:
 *
 *   completed inside it   what actually got delivered in the window
 *   open and due inside   what was promised for the window and has not landed
 *
 * A task completed last month is not this month's work even if it is still
 * being talked about; a task due next quarter is not this month's failure. And
 * an open task with no due date belongs to no period at all — it was never
 * promised for one. Counting those somewhere would make every report's
 * denominator depend on how disciplined people are about setting dates.
 * ========================================================================== */

function withinPeriod(isoDate: string | null, period: ReportPeriod): boolean {
  if (!isoDate) return false;
  const day = isoDate.slice(0, 10);
  return day >= period.start && day <= period.end;
}

export function taskInPeriod(task: ReportTask, period: ReportPeriod): boolean {
  if (isClosed(task.status)) return withinPeriod(task.completedAt, period);
  return withinPeriod(task.dueDate, period);
}

function isClosed(status: TaskStatus): boolean {
  const category = STATUS_META[status].category;
  return category === 'done' || category === 'cancelled';
}

/** Whole and part weeks, so a fortnight's capacity is twice a week's. */
export function weeksInPeriod(period: ReportPeriod): number {
  const days = daysBetween(period.start, period.end) + 1;
  return Math.max(0, Math.round((days / 7) * 100) / 100);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * How late, in whole days. Negative means early, which is deliberately kept
 * rather than clamped: an average that floors early deliveries at zero reports a
 * team that is habitually early as merely punctual.
 */
export function daysLate(task: ReportTask): number | null {
  if (!task.completedAt || !task.dueDate) return null;
  return daysBetween(task.dueDate, task.completedAt.slice(0, 10));
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number): Cell => ({ kind: 'number', value });
const percent = (value: number): Cell => ({ kind: 'percent', value });
const duration = (value: number): Cell => ({ kind: 'duration', value });

/* ==========================================================================
 * THE ENTRY POINT
 * ========================================================================== */

export function buildReport(input: ReportInput): Report {
  return sortRows(byType(input), input.sort);
}

function byType(input: ReportInput): Report {
  switch (input.type) {
    case 'completion':
      return completionReport(input);
    case 'workload':
      return workloadReport(input);
    case 'project_status':
      return projectStatusReport(input);
    case 'time':
      return timeReport(input);
  }
}

function subtitleFor(input: ReportInput): string {
  const who = input.subjectName ?? 'Everybody';
  return input.period.start === input.period.end
    ? `${who} · ${input.period.start}`
    : `${who} · ${input.period.start} to ${input.period.end}`;
}

/**
 * Every narrowing, in one function.
 *
 * ── ⚠️ ONE PLACE, SO A FILTER CANNOT BE HONOURED BY THREE REPORTS AND NOT THE
 *    FOURTH ────────────────────────────────────────────────────────────────
 * All four report builders call this. That is the only reason it is safe to add a
 * filter without auditing four call sites — and the failure it prevents is the
 * quiet kind: a Platform filter that visibly works on the completion report and
 * is ignored by the project one produces two numbers that disagree, on the same
 * screen, with no indication which is answering the question that was asked.
 *
 * Order is deliberate: period first, because it is the cheapest and removes the
 * most rows; then the person; then the four filters.
 */
function scopedTasks(input: ReportInput): ReportTask[] {
  const { filters } = input;
  let tasks = input.tasks.filter((t) => taskInPeriod(t, input.period));

  if (input.subjectId) tasks = tasks.filter((t) => t.assigneeId === input.subjectId);

  if (filters.projectIds.length > 0) {
    const wanted = new Set(filters.projectIds);
    tasks = tasks.filter((t) => wanted.has(t.projectId));
  }

  if (filters.statuses.length > 0) {
    const wanted = new Set<TaskStatus>(filters.statuses);
    tasks = tasks.filter((t) => wanted.has(t.status));
  }

  if (filters.platforms.length > 0) {
    /* ANY, not ALL. One asset goes to several platforms, so "Instagram" must mean
       "reached Instagram", not "reached Instagram and nowhere else" — the second
       reading would report almost nothing for a division that cross-posts. */
    const wanted = new Set(filters.platforms);
    tasks = tasks.filter((t) => t.platforms.some((slug) => wanted.has(slug)));
  }

  if (filters.contentKinds.length > 0) {
    const wanted = new Set(filters.contentKinds);
    /* `'none'` is how non-content work is selected. See ReportFilters. */
    tasks = tasks.filter((t) => wanted.has(t.contentKind ?? 'none'));
  }

  return tasks;
}

/**
 * The people a report covers.
 *
 * ── ⚠️ A PROJECT FILTER NARROWS WHO IS LISTED, NOT WHAT THEY ARE CARRYING ───
 * Capacity is a property of a person, not of a project: somebody at 120%
 * utilisation is over capacity because of everything on them, and re-stating that
 * as "40% within this project" would invent a number that means nothing — you
 * cannot plan against a fraction of a person's load.
 *
 * So filtering by project changes which people APPEAR (those with work in it) and
 * leaves each person's figures whole. The report says so in its notes, because a
 * reader who filtered to one project and saw a full load would otherwise
 * reasonably assume the filter had failed.
 */
function scopedPeople(input: ReportInput): ReportPerson[] {
  let people = input.subjectId
    ? input.people.filter((p) => p.userId === input.subjectId)
    : [...input.people];

  if (!noFilters(input.filters)) {
    const present = new Set(scopedTasks(input).map((t) => t.assigneeId).filter(Boolean));
    people = people.filter((p) => present.has(p.userId));
  }

  return people;
}

/* ==========================================================================
 * SORTING — generic, because the columns are typed
 * ==========================================================================
 * The report already publishes a `kind` per column, so one comparator serves all
 * four types and there is no per-report sort code to keep in step.
 *
 * ⚠️ APPLIED AFTER the builder and NOT to the charts. A chart's order carries
 * meaning — a trend is chronological, a donut is largest-first — and re-ordering
 * it to match a table the reader sorted by name would turn a time series into
 * nonsense. Tables are sorted; charts keep their own order.
 * ========================================================================== */

function compareCells(a: Cell, b: Cell): number {
  if (a.kind === 'text' && b.kind === 'text') return a.value.localeCompare(b.value);
  if (a.kind === 'bool' && b.kind === 'bool') return Number(a.value) - Number(b.value);
  if (a.kind === 'date' && b.kind === 'date') {
    /* Undated last in ascending order, whichever way the column is pointed —
       a blank is not "earlier than 1970", it is the absence of an answer. */
    if (a.value === b.value) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return a.value.localeCompare(b.value);
  }
  if ('value' in a && 'value' in b && typeof a.value === 'number' && typeof b.value === 'number') {
    return a.value - b.value;
  }
  return 0;
}

function sortRows(report: Report, sort: ReportSort): Report {
  if (sort.key === '') return report;
  const index = report.columns.findIndex((c) => c.key === sort.key);
  /* An unknown key is the natural order, not an error. A saved link whose column
     was renamed should still render the report. */
  if (index < 0) return report;

  const sign = sort.direction === 'desc' ? -1 : 1;
  const rows = [...report.rows].sort((a, b) => sign * compareCells(a[index], b[index]));
  return { ...report, rows };
}

/* ---- 1 · COMPLETION ------------------------------------------------------ */

function completionReport(input: ReportInput): Report {
  const tasks = scopedTasks(input);

  /* Grouped by the person the work was ON, not by who reported it. Unassigned
     work is its own row rather than dropped: a division with twelve unassigned
     overdue tasks should see that, and hiding it under a name nobody owns is
     how it stays unnoticed. */
  const groups = new Map<string, { name: string; tasks: ReportTask[] }>();
  for (const task of tasks) {
    const key = task.assigneeId ?? '@unassigned';
    const group = groups.get(key) ?? {
      name: task.assigneeName ?? 'Unassigned',
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(key, group);
  }

  const rows = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, tasks: mine }) => {
      const done = mine.filter((t) => STATUS_META[t.status].category === 'done');
      const cancelled = mine.filter((t) => STATUS_META[t.status].category === 'cancelled');
      const missed = mine.filter((t) => !isClosed(t.status));

      /* Only DATED completions can be judged on time. An undated one is excluded
         from both halves rather than counted as a success — the whole reason this
         file is pure and tested. */
      const judged = done.map(daysLate).filter((d): d is number => d !== null);
      const onTime = judged.filter((d) => d <= 0);
      const late = judged.filter((d) => d > 0);

      return [
        text(name),
        num(done.length),
        num(missed.length),
        num(cancelled.length),
        num(onTime.length),
        num(late.length),
        percent(pct(onTime.length, judged.length)),
        num(late.length > 0 ? mean(late) : 0),
        num(done.reduce((sum, t) => sum + t.effortPoints, 0)),
      ] as const;
    });

  const allDone = tasks.filter((t) => STATUS_META[t.status].category === 'done');
  const allJudged = allDone.map(daysLate).filter((d): d is number => d !== null);
  const allLate = allJudged.filter((d) => d > 0);

  return {
    type: 'completion',
    title: 'Completion',
    subtitle: subtitleFor(input),
    period: input.period,
    columns: [
      { key: 'person', label: 'Person', kind: 'text', width: 24 },
      { key: 'done', label: 'Completed', kind: 'number' },
      { key: 'missed', label: 'Still open', kind: 'number' },
      { key: 'cancelled', label: 'Cancelled', kind: 'number' },
      { key: 'onTime', label: 'On time', kind: 'number' },
      { key: 'late', label: 'Late', kind: 'number' },
      { key: 'onTimePct', label: 'On-time %', kind: 'percent' },
      { key: 'avgDaysLate', label: 'Avg days late', kind: 'number' },
      { key: 'points', label: 'Points delivered', kind: 'number' },
    ],
    rows,
    figures: [
      { label: 'Completed', value: num(allDone.length) },
      {
        label: 'On-time rate',
        value: percent(pct(allJudged.length - allLate.length, allJudged.length)),
        hint: `${allJudged.length} of ${allDone.length} completed tasks had a due date to judge`,
      },
      {
        label: 'Average days late',
        value: num(allLate.length > 0 ? mean(allLate) : 0),
        hint: allLate.length > 0 ? `across ${allLate.length} late tasks` : 'nothing was late',
      },
      {
        label: 'Still open',
        value: num(tasks.filter((t) => !isClosed(t.status)).length),
        hint: 'due in this period and not finished',
      },
    ],
    notes: [
      'A task counts toward this period if it was completed inside it, or if it is still open and was due inside it.',
      'On-time means completed on or before the due date. A completed task with no due date cannot be judged, so it is left out of the on-time figures entirely rather than counted as a success.',
      'Cancelled work is reported separately and never counts as either a success or a failure.',
    ],
  };
}

/* ---- 2 · WORKLOAD & CAPACITY -------------------------------------------- */

function workloadReport(input: ReportInput): Report {
  const people = scopedPeople(input);
  const weeks = weeksInPeriod(input.period);

  const rows = people
    .slice()
    .sort((a, b) => b.utilisationPct - a.utilisationPct)
    .map((p) => [
      text(p.name),
      text(p.roleTitle ?? p.role),
      num(p.loadPoints),
      num(p.capacityPoints),
      percent(p.utilisationPct),
      text(p.bandLabel),
      num(p.activeTaskCount),
      num(p.maxConcurrentTasks),
      percent(p.otherWorkPct),
    ] as const);

  const over = people.filter((p) => p.utilisationPct > 100);
  const totalLoad = Math.round(people.reduce((s, p) => s + p.loadPoints, 0) * 100) / 100;
  const totalCapacity = people.reduce((s, p) => s + p.capacityPoints, 0);

  return {
    type: 'workload',
    title: 'Workload & capacity',
    subtitle: subtitleFor(input),
    period: input.period,
    columns: [
      { key: 'person', label: 'Person', kind: 'text', width: 24 },
      { key: 'role', label: 'Role', kind: 'text', width: 22 },
      { key: 'load', label: 'Load points', kind: 'number' },
      { key: 'capacity', label: 'Capacity points', kind: 'number' },
      { key: 'utilisation', label: 'Utilisation %', kind: 'percent' },
      { key: 'band', label: 'Band', kind: 'text', width: 14 },
      { key: 'active', label: 'Active tasks', kind: 'number' },
      { key: 'limit', label: 'Concurrent limit', kind: 'number' },
      { key: 'other', label: 'Ad-hoc work %', kind: 'percent' },
    ],
    rows,
    figures: [
      { label: 'People', value: num(people.length) },
      {
        label: 'Team utilisation',
        value: percent(pct(totalLoad, totalCapacity)),
        hint: `${totalLoad} of ${totalCapacity} points`,
      },
      {
        label: 'Over capacity',
        value: num(over.length),
        hint: over.length > 0 ? over.map((p) => p.name).join(', ') : 'nobody',
      },
      {
        label: 'Weeks in period',
        value: num(weeks),
        hint: 'capacity is defined per week (ADR-004)',
      },
    ],
    notes: [
      'Capacity is a weekly figure (ADR-004), scaled to the length of the period shown. A fortnight allows twice a week’s points.',
      'Load counts a task if it is due inside the period, or if it is in progress and overlaps it — the same rule the Workload screen uses, so the two never disagree.',
      'Somebody on leave for the whole period has an effective capacity of zero. That is reported as 0% with the band saying so, not as 100% utilised — the question does not apply (BR-005).',
      'Ad-hoc work is the share of open effort sitting in the catch-all project rather than a planned one (doc 15 §6).',
    ],
  };
}

/* ---- 3 · PROJECT STATUS -------------------------------------------------- */

function projectStatusReport(input: ReportInput): Report {
  const tasks = scopedTasks(input);

  const byProject = new Map<string, ReportTask[]>();
  for (const task of tasks) {
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }

  /* Every project the reader can see appears, including ones with no activity in
     the period. A project that has gone quiet is exactly what a status report is
     for, and omitting empty rows would hide it. */
  const rows = input.projects
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => {
      const mine = byProject.get(project.id) ?? [];
      const done = mine.filter((t) => STATUS_META[t.status].category === 'done');
      const open = mine.filter((t) => !isClosed(t.status));
      const overdue = open.filter(
        (t) => isOverdue(t, input.today),
      );
      const people = new Set(mine.map((t) => t.assigneeId).filter(Boolean));

      return [
        text(project.name),
        text(project.code),
        text(PROJECT_TYPE_META[project.type].label),
        text(project.status.replace(/_/g, ' ')),
        num(mine.length),
        num(done.length),
        num(open.length),
        num(overdue.length),
        percent(pct(done.length, mine.length)),
        num(mine.reduce((s, t) => s + t.effortPoints, 0)),
        duration(mine.reduce((s, t) => s + t.timeSpentMinutes, 0)),
        num(people.size),
      ] as const;
    });

  const allOpen = tasks.filter((t) => !isClosed(t.status));

  return {
    type: 'project_status',
    title: 'Project status',
    subtitle: subtitleFor(input),
    period: input.period,
    columns: [
      { key: 'project', label: 'Project', kind: 'text', width: 28 },
      { key: 'code', label: 'Code', kind: 'text', width: 12 },
      { key: 'type', label: 'Type', kind: 'text', width: 18 },
      { key: 'status', label: 'Status', kind: 'text', width: 14 },
      { key: 'tasks', label: 'Tasks', kind: 'number' },
      { key: 'done', label: 'Done', kind: 'number' },
      { key: 'open', label: 'Open', kind: 'number' },
      { key: 'overdue', label: 'Overdue', kind: 'number' },
      { key: 'donePct', label: 'Complete %', kind: 'percent' },
      { key: 'points', label: 'Effort points', kind: 'number' },
      { key: 'spent', label: 'Time spent', kind: 'duration' },
      { key: 'people', label: 'People', kind: 'number' },
    ],
    rows,
    figures: [
      { label: 'Projects', value: num(input.projects.length) },
      { label: 'Tasks in period', value: num(tasks.length) },
      { label: 'Still open', value: num(allOpen.length) },
      {
        label: 'Overdue',
        value: num(allOpen.filter((t) => isOverdue(t, input.today)).length),
        hint: 'open, and past their due date',
      },
    ],
    notes: [
      'Every project you can see is listed, including those with no activity in the period — a project that has gone quiet is what this report is for.',
      'Task counts cover the period only, so a long-running project shows this window’s work rather than its lifetime.',
      'Overdue means open and already past its due date **as of today** — not as of the end of the period. Asking for this month’s report mid-month therefore does not report work due later in the month as late.',
      'Time spent is what the timers recorded, not an estimate.',
    ],
  };
}

/* ---- 4 · TIME & OVERRUN -------------------------------------------------- */

function timeReport(input: ReportInput): Report {
  /* Only tasks with a limit can overrun, and only tasks with time logged are
     worth a row. Everything else would be a page of zeroes. */
  const tasks = scopedTasks(input).filter(
    (t) => t.timeSpentMinutes > 0 || (t.timeLimitMinutes ?? 0) > 0,
  );

  const rows = tasks
    .slice()
    .sort((a, b) => overrun(b) - overrun(a))
    .map((t) => {
      const limit = t.timeLimitMinutes ?? 0;
      return [
        text(t.reference),
        text(t.title),
        text(t.projectName),
        text(t.assigneeName ?? 'Unassigned'),
        text(STATUS_META[t.status].label),
        duration(limit),
        duration(t.timeSpentMinutes),
        duration(t.extensionMinutesGranted),
        duration(Math.max(0, overrun(t))),
        percent(limit > 0 ? pct(t.timeSpentMinutes, limit) : 0),
      ] as const;
    });

  const over = tasks.filter((t) => overrun(t) > 0);
  const totalOverrun = over.reduce((s, t) => s + overrun(t), 0);
  const withLimit = tasks.filter((t) => (t.timeLimitMinutes ?? 0) > 0);

  return {
    type: 'time',
    title: 'Time & overrun',
    subtitle: subtitleFor(input),
    period: input.period,
    columns: [
      { key: 'reference', label: 'Reference', kind: 'text', width: 14 },
      { key: 'title', label: 'Task', kind: 'text', width: 38 },
      { key: 'project', label: 'Project', kind: 'text', width: 24 },
      { key: 'assignee', label: 'Assignee', kind: 'text', width: 22 },
      { key: 'status', label: 'Status', kind: 'text', width: 14 },
      { key: 'limit', label: 'Allowed', kind: 'duration' },
      { key: 'spent', label: 'Spent', kind: 'duration' },
      { key: 'extension', label: 'Extension granted', kind: 'duration' },
      { key: 'overrun', label: 'Over by', kind: 'duration' },
      { key: 'usedPct', label: 'Used %', kind: 'percent' },
    ],
    rows,
    figures: [
      {
        label: 'Over the limit',
        value: num(over.length),
        hint: `of ${withLimit.length} tasks that had one`,
      },
      { label: 'Total overrun', value: duration(totalOverrun) },
      {
        label: 'Time logged',
        value: duration(tasks.reduce((s, t) => s + t.timeSpentMinutes, 0)),
      },
      {
        label: 'Extensions granted',
        value: duration(tasks.reduce((s, t) => s + t.extensionMinutesGranted, 0)),
        hint: 'already included in the allowance',
      },
    ],
    notes: [
      'Only tasks with time logged or a limit set appear — the rest would be a page of zeroes.',
      'The allowance includes any extension that was granted, so a task with an approved extension is not reported as overrunning on account of it.',
      'A task with no limit set can never overrun, and is excluded from the “over the limit” count rather than treated as within budget.',
      'Time comes from the timers, so a task worked on without one running shows less than the effort it took.',
    ],
  };
}

/**
 * Open, and past its due date **as of today** — not as of the period's end.
 *
 * See the note on `ReportInput.today`. An undated open task is never overdue: it
 * was never promised for a day, so there is no day it is late against.
 */
function isOverdue(task: ReportTask, today: string): boolean {
  if (isClosed(task.status)) return false;
  return task.dueDate !== null && task.dueDate < today;
}

/** Spent beyond the allowance. The allowance already contains any extension. */
function overrun(task: ReportTask): number {
  const limit = task.timeLimitMinutes ?? 0;
  if (limit <= 0) return 0;
  return task.timeSpentMinutes - limit;
}

/* ==========================================================================
 * PRESETS — the periods people actually ask for
 * ==========================================================================
 * Computed from a passed-in `now`, never `Date.now()`: this module is pure, and
 * a report whose period depends on the machine's clock cannot be tested.
 * ========================================================================== */

export const PERIOD_PRESETS = ['this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'this_year'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABEL: Readonly<Record<PeriodPreset, string>> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
};

export function presetPeriod(preset: PeriodPreset, nowMs: number): ReportPeriod {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();

  switch (preset) {
    case 'this_week':
      return weekOf(nowMs, 0);
    case 'last_week':
      return weekOf(nowMs, -7);
    case 'this_month':
      return { start: iso(Date.UTC(y, m, 1)), end: iso(Date.UTC(y, m + 1, 0)) };
    case 'last_month':
      return { start: iso(Date.UTC(y, m - 1, 1)), end: iso(Date.UTC(y, m, 0)) };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { start: iso(Date.UTC(y, q, 1)), end: iso(Date.UTC(y, q + 3, 0)) };
    }
    case 'this_year':
      return { start: iso(Date.UTC(y, 0, 1)), end: iso(Date.UTC(y, 11, 31)) };
  }
}

/**
 * Monday to Sunday, matching `weekWindow` in lib/domain/workload.ts so the
 * workload report's week is the same week the Workload screen shows.
 */
function weekOf(nowMs: number, offsetDays: number): ReportPeriod {
  const d = new Date(nowMs + offsetDays * 86_400_000);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday);
  return { start: iso(start), end: iso(start + 6 * 86_400_000) };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `cni-completion-2026-08-01-to-2026-08-31`. Dated, because exports pile up. */
export function reportFileStem(report: Report): string {
  const type = report.type.replace(/_/g, '-');
  return report.period.start === report.period.end
    ? `cni-${type}-${report.period.start}`
    : `cni-${type}-${report.period.start}-to-${report.period.end}`;
}

/** Minutes as `2h 15m`, for the screen, the CSV and the print sheet alike. */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  if (minutes === 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Cell → display string. One place, so screen and CSV cannot drift apart. */
export function cellText(cell: Cell): string {
  switch (cell.kind) {
    case 'text':
      return cell.value;
    case 'number':
      return String(cell.value);
    case 'percent':
      return `${cell.value}%`;
    case 'date':
      return cell.value ?? '';
    case 'duration':
      return formatMinutes(cell.value);
    case 'bool':
      return cell.value ? 'Yes' : 'No';
  }
}

/* `EFFORT_POINTS` is re-exported so an export can carry the point scale beside
   the figures it produced — a spreadsheet that cannot reconstruct the maths is
   a screenshot. */
export { EFFORT_POINTS };
