import {
  CONTENT_KIND_LABEL,
  STATUS_META,
  type ContentKind,
  type TaskStatus,
} from './constants';
import { daysLate, taskInPeriod, type ReportInput, type ReportPeriod, type ReportTask } from './reports';

/* ============================================================================
 * THE ANALYTICAL VIEW — charts, as data
 * ----------------------------------------------------------------------------
 * Owner: *"if I say that there should be an option for a graphical
 * representation… meaning an analytical presentation showing the project's tasks
 * in graph form. Make it a very high-level advanced type of report page."*
 *
 * And the reason it has to be advanced, in the owner's own words: *"At the end of
 * the month… every meeting is held in which we put a report on the front of the
 * table. We see which project has how much posting, which person is doing which
 * task, which project is progressively improving… or everyone is engaging in
 * something or a productive task."* Five questions. Every chart below answers one
 * of them and is captioned with which.
 *
 * ── ⚠️ WHY THIS IS A SEPARATE MODULE AND NOT A FIELD ON `Report` ─────────────
 * The first attempt added `charts` to `Report`. It works, and it drags the whole
 * export layer along with it: `Report` is the type the CSV writer, the .xlsx
 * writer and every one of their tests already speak, and none of them has any use
 * for a chart. Worse, `buildReport` calling into a chart module while the chart
 * module needs `ReportInput` back is a runtime import cycle for no benefit.
 *
 * So charts are computed from the SAME `ReportInput`, alongside the report rather
 * than inside it. One extra call at the one call site that wants them, no cycle,
 * and `Report` keeps meaning exactly what it meant.
 *
 * ── ⚠️ THE CHARTS AND THE TABLE MUST NOT DISAGREE ───────────────────────────
 * Both start from `ReportInput` and both apply the same period, person and filter
 * rules — because they have to. A chart showing 47 published while the table under
 * it totals 45 is the single worst thing a reporting page can do: it makes the
 * reader distrust every other number on the page, including the correct ones.
 *
 * The rule that keeps them honest is that `scopedTasks` in reports.ts is the only
 * definition of "the rows this report is about", and this module calls the same
 * exported predicate (`taskInPeriod`) plus the same filters. It deliberately does
 * NOT re-derive its own idea of scope.
 *
 * ── SPECS, NOT COMPONENTS ────────────────────────────────────────────────────
 * A `ChartSpec` is data: `{kind:'bars', bars:[{label, value, token}]}`. Three
 * things draw it — the SVG kit on screen, pdf-lib in the export, and the hidden
 * `<table>` each chart publishes for a screen reader. A component could only ever
 * serve the first, and the PDF is the artefact that goes on the meeting table.
 *
 * Tokens are theme token NAMES (`status-done`), never colours, so one spec is
 * correct in both themes and the PDF can map them to print inks.
 * ========================================================================= */

export type ChartFormat = 'integer' | 'percent' | 'decimal' | 'hours' | 'points';

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
  /** A theme token name without the `--`, e.g. `status-done`. */
  readonly token: string;
  /** A short aside shown beside the value — "18 of 23 on time". */
  readonly note?: string;
}

export type ChartSpec =
  | {
      readonly kind: 'trend';
      readonly title: string;
      readonly question: string;
      /** One label per point. */
      readonly labels: readonly string[];
      readonly series: readonly {
        readonly label: string;
        readonly token: string;
        readonly points: readonly number[];
      }[];
      readonly format: ChartFormat;
    }
  | {
      readonly kind: 'donut';
      readonly title: string;
      readonly question: string;
      readonly slices: readonly ChartDatum[];
      readonly centreLabel: string;
      readonly centreValue: string;
    }
  | {
      readonly kind: 'bars';
      readonly title: string;
      readonly question: string;
      readonly bars: readonly ChartDatum[];
      readonly format: ChartFormat;
    };

/**
 * Colours for things with no semantic colour of their own — projects, platforms,
 * people.
 *
 * ⚠️ Existing theme tokens, and a fixed rotation rather than a hash of the label.
 * A hash gives each name a stable colour and lets two ADJACENT slices collide,
 * which defeats the one thing a categorical palette exists for. Ordered so
 * consecutive entries are far apart in hue.
 */
const CATEGORICAL: readonly string[] = [
  'accent-primary',
  'accent-gold',
  'status-progress',
  'status-review',
  'feedback-info',
  'status-revisions',
  'status-done',
  'status-blocked',
];

const hue = (index: number): string => CATEGORICAL[index % CATEGORICAL.length];

/**
 * How many bars before a chart stops being readable.
 *
 * ⚠️ The remainder is SUMMED INTO a final "everyone else" bar, never dropped. A
 * top-ten that silently discards the eleventh reports a division total that does
 * not match the sum of what is drawn, and the owner expects to grow well past ten
 * projects: *"Right now we have just 13 businesses but later on definitely we want
 * to grab more."*
 */
const MAX_BARS = 10;

/* ==========================================================================
 * TIME BUCKETS — the x-axis of every trend
 * ==========================================================================
 * ⚠️ THE GRANULARITY IS CHOSEN FROM THE SPAN, never fixed. A week reported per
 * month is a single point and says nothing about a trend; a year reported per day
 * is 365 points across 600 pixels, which is a smear. Neither answers "is this
 * improving", which is the only reason the chart is there.
 *
 * Up to a fortnight reads per day, up to a quarter per week, longer per month —
 * keeping the point count roughly between 4 and 31 at every period the page
 * offers.
 * ========================================================================== */

export interface PeriodBucket {
  readonly label: string;
  readonly start: string;
  readonly end: string;
}

/** ⚠️ No `Intl` and no locale anywhere in this file. A pure module that formats
 *  with a locale renders one string on the server and another in the browser,
 *  which is a hydration mismatch — see lib/now.ts for the same rule on clocks. */
const MONTH_ABBR: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${MONTH_ABBR[Number(month) - 1] ?? ''}`.trim();
}

function monthLabel(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTH_ABBR[Number(month) - 1] ?? ''} ${year.slice(2)}`;
}

export function bucketsFor(period: ReportPeriod): PeriodBucket[] {
  const span = daysBetween(period.start, period.end) + 1;
  if (span <= 0) return [];

  if (span <= 14) {
    const out: PeriodBucket[] = [];
    for (let i = 0; i < span; i += 1) {
      const day = addDays(period.start, i);
      out.push({ label: dayLabel(day), start: day, end: day });
    }
    return out;
  }

  if (span <= 92) {
    const out: PeriodBucket[] = [];
    for (let i = 0; i < span; i += 7) {
      const start = addDays(period.start, i);
      /* ⚠️ Clamped to the period end, so the last bucket is a short week rather
         than reaching past the range and counting work from outside it. */
      const rawEnd = addDays(start, 6);
      out.push({ label: dayLabel(start), start, end: rawEnd > period.end ? period.end : rawEnd });
    }
    return out;
  }

  const out: PeriodBucket[] = [];
  let cursor = `${period.start.slice(0, 7)}-01`;
  /* Guarded rather than `while (true)`: a malformed period must not spin. */
  for (let guard = 0; guard < 120 && cursor <= period.end; guard += 1) {
    const [year, month] = cursor.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = `${cursor.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
    out.push({
      label: monthLabel(cursor),
      /* The first bucket starts where the PERIOD does, not where its month does —
         otherwise a report for 10–31 August would count the first nine days. */
      start: cursor < period.start ? period.start : cursor,
      end: monthEnd > period.end ? period.end : monthEnd,
    });
    cursor = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  }
  return out;
}

/* ==========================================================================
 * SCOPE — the same rules the table uses, applied to the same input
 * ==========================================================================
 * ⚠️ This duplicates `scopedTasks` in reports.ts, and that is a real cost. The
 * alternative is exporting it, which would make the shape of every report's
 * internal filtering part of this module's contract — and the duplication is
 * three `if`s over a shared, exported period predicate, checked by a test that
 * asserts the two agree. If a sixth filter is ever added, that test fails here
 * first, which is the point of having it.
 * ========================================================================== */

function scoped(input: ReportInput): ReportTask[] {
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
    const wanted = new Set(filters.platforms);
    tasks = tasks.filter((t) => t.platforms.some((slug) => wanted.has(slug)));
  }
  if (filters.contentKinds.length > 0) {
    const wanted = new Set(filters.contentKinds);
    tasks = tasks.filter((t) => wanted.has(t.contentKind ?? 'none'));
  }

  return tasks;
}

const isDone = (t: ReportTask): boolean => STATUS_META[t.status].category === 'done';
const isClosed = (t: ReportTask): boolean => {
  const category = STATUS_META[t.status].category;
  return category === 'done' || category === 'cancelled';
};

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Largest first, capped, with the remainder gathered rather than dropped.
 *
 * See MAX_BARS. The gathered bar is deliberately grey (`status-backlog`) so it
 * does not read as a category of its own.
 */
function topBars(data: ChartDatum[], max = MAX_BARS): ChartDatum[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;

  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  const rest = tail.reduce((sum, d) => sum + d.value, 0);
  return [
    ...head,
    {
      label: `${tail.length} others`,
      value: rest,
      token: 'status-backlog',
      note: 'combined',
    },
  ];
}

/** Group by a key, keeping a display label per group. */
function groupBy(
  tasks: readonly ReportTask[],
  key: (t: ReportTask) => string | null,
  label: (t: ReportTask) => string,
): Map<string, { label: string; tasks: ReportTask[] }> {
  const out = new Map<string, { label: string; tasks: ReportTask[] }>();
  for (const task of tasks) {
    const id = key(task) ?? '@none';
    const bucket = out.get(id) ?? { label: label(task), tasks: [] };
    bucket.tasks.push(task);
    out.set(id, bucket);
  }
  return out;
}

/* ==========================================================================
 * THE ENTRY POINT
 * ==========================================================================
 * One chart set per report type, because the questions differ. What does NOT
 * differ: every set opens with the trend, since "is this getting better or worse"
 * is the question the owner described the meeting as being for, and a reader
 * scanning a page reads the first thing first.
 * ========================================================================== */

export function chartsFor(input: ReportInput): ChartSpec[] {
  switch (input.type) {
    case 'completion':
      return completionCharts(input);
    case 'workload':
      return workloadCharts(input);
    case 'project_status':
      return projectCharts(input);
    case 'time':
      return timeCharts(input);
  }
}

/* ---- 1 · COMPLETION ------------------------------------------------------ */

function completionCharts(input: ReportInput): ChartSpec[] {
  const tasks = scoped(input);
  const buckets = bucketsFor(input.period);

  /* Two COUNT series on one axis, not a count against a percentage. Mixing a
     scale of 0–30 with one of 0–100 makes the smaller line hug the floor and
     look like a failure — the on-time share is legible as the gap between two
     lines, and it cannot be misread as a volume. */
  const completed = buckets.map((b) => tasks.filter((t) => taskInBucket(t, b) && isDone(t)).length);
  const onTime = buckets.map(
    (b) =>
      tasks.filter((t) => {
        if (!taskInBucket(t, b) || !isDone(t)) return false;
        const late = daysLate(t);
        /* ⚠️ Undated completions are excluded, exactly as the table excludes them.
           Counting them as on time here while the table leaves them out is how a
           chart and its table come to disagree. */
        return late !== null && late <= 0;
      }).length,
  );

  const byPerson = groupBy(
    tasks,
    (t) => t.assigneeId,
    (t) => t.assigneeName ?? 'Unassigned',
  );

  const statusSlices = statusMix(tasks);

  return [
    {
      kind: 'trend',
      title: 'Delivery over time',
      question: 'Are we finishing more, and finishing it on time?',
      labels: buckets.map((b) => b.label),
      series: [
        { label: 'Completed', token: 'accent-primary', points: completed },
        { label: 'On time', token: 'status-done', points: onTime },
      ],
      format: 'integer',
    },
    {
      kind: 'bars',
      title: 'Delivered per person',
      question: 'Is everyone engaged, and who is carrying the most?',
      bars: topBars(
        [...byPerson.values()].map((group, index) => {
          const done = group.tasks.filter(isDone);
          const judged = done.map(daysLate).filter((d): d is number => d !== null);
          const punctual = judged.filter((d) => d <= 0).length;
          return {
            label: group.label,
            value: done.length,
            token: hue(index),
            note: judged.length > 0 ? `${pct(punctual, judged.length)}% on time` : undefined,
          };
        }),
      ),
      format: 'integer',
    },
    {
      kind: 'donut',
      title: 'Where the work stands',
      question: 'What is still open, and what is stuck?',
      slices: statusSlices,
      centreLabel: 'Tasks',
      centreValue: String(tasks.length),
    },
  ];
}

/* ---- 2 · WORKLOAD ------------------------------------------------------- */

function workloadCharts(input: ReportInput): ChartSpec[] {
  const people = input.subjectId
    ? input.people.filter((p) => p.userId === input.subjectId)
    : input.people;

  /* ⚠️ Coloured by whether the person is over capacity, NOT from the categorical
     palette. Utilisation is the one figure on this page with a right and a wrong
     end, and a chart that paints 130% the same green as 60% has thrown away the
     only thing the reader is looking for. */
  const bars = people.map((p) => ({
    label: p.name,
    value: p.utilisationPct,
    token:
      p.utilisationPct > 100
        ? 'feedback-error'
        : p.utilisationPct >= 85
          ? 'feedback-warning'
          : 'status-done',
    note: `${p.loadPoints} of ${p.capacityPoints} pts`,
  }));

  return [
    {
      kind: 'bars',
      title: 'Utilisation',
      question: 'Who is over capacity, and who has room?',
      /* Descending, and NOT capped: the whole team belongs on a capacity chart.
         Hiding the eleventh person behind an "others" bar would hide the one who
         is drowning. */
      bars: [...bars].sort((a, b) => b.value - a.value),
      format: 'percent',
    },
    {
      kind: 'donut',
      title: 'Share of the load',
      question: 'Is the work spread, or concentrated on a few people?',
      slices: topBars(
        people.map((p, index) => ({
          label: p.name,
          value: p.loadPoints,
          token: hue(index),
        })),
      ),
      centreLabel: 'Points',
      centreValue: String(people.reduce((sum, p) => sum + p.loadPoints, 0)),
    },
  ];
}

/* ---- 3 · PROJECT STATUS ------------------------------------------------- */

function projectCharts(input: ReportInput): ChartSpec[] {
  const tasks = scoped(input);
  const buckets = bucketsFor(input.period);

  const byProject = groupBy(
    tasks,
    (t) => t.projectId,
    (t) => t.projectName,
  );

  /* The owner's first question, in their words: *"which project has how much
     posting"*. Published deliverables, not all tasks — an oversight item is work
     and is not posting, and `contentKind` is what separates them. */
  const publishedBars = topBars(
    [...byProject.values()].map((group, index) => {
      const content = group.tasks.filter((t) => t.contentKind !== null);
      const published = content.filter(isDone);
      return {
        label: group.label,
        value: published.length,
        token: hue(index),
        note: content.length > 0 ? `of ${content.length} planned` : 'no content planned',
      };
    }),
  );

  /* *"which project is progressively improving"* — the completion share per
     bucket for the three busiest projects. Three, because six lines on one axis
     is a thicket and the busiest are the ones a meeting is about. */
  const busiest = [...byProject.entries()]
    .sort((a, b) => b[1].tasks.length - a[1].tasks.length)
    .slice(0, 3);

  const trendSeries = busiest.map(([, group], index) => ({
    label: group.label,
    token: hue(index),
    points: buckets.map((bucket) => {
      const inBucket = group.tasks.filter((t) => taskInBucket(t, bucket));
      /* ⚠️ A bucket with nothing planned is 0, not a gap. The chart kit draws a
         continuous line, and there is no null in the series type — so a quiet
         week reads as a dip, which for "are they posting regularly" is the honest
         answer rather than a misleading interpolation across it. */
      return pct(inBucket.filter(isDone).length, inBucket.length);
    }),
  }));

  const charts: ChartSpec[] = [
    {
      kind: 'trend',
      title: 'Completion rate over time',
      question: 'Which projects are improving, and which are slipping?',
      labels: buckets.map((b) => b.label),
      series: trendSeries,
      format: 'percent',
    },
    {
      kind: 'bars',
      title: 'Published per project',
      question: 'Which project is posting how much?',
      bars: publishedBars,
      format: 'integer',
    },
  ];

  /* Platform and content mix only when there is something to show. An empty
     donut with a "0" in the middle is a chart that looks broken; leaving it out
     says the same thing without the doubt. */
  const platformSlices = platformMix(tasks);
  if (platformSlices.length > 0) {
    charts.push({
      kind: 'donut',
      title: 'Platform mix',
      question: 'Where is the work actually going out?',
      slices: platformSlices,
      centreLabel: 'Placements',
      centreValue: String(platformSlices.reduce((sum, s) => sum + s.value, 0)),
    });
  }

  const kindSlices = contentMix(tasks);
  if (kindSlices.length > 0) {
    charts.push({
      kind: 'donut',
      title: 'Content mix',
      question: 'What kind of work is this — and how much is not content at all?',
      slices: kindSlices,
      centreLabel: 'Tasks',
      centreValue: String(kindSlices.reduce((sum, s) => sum + s.value, 0)),
    });
  }

  return charts;
}

/* ---- 4 · TIME ----------------------------------------------------------- */

function timeCharts(input: ReportInput): ChartSpec[] {
  const tasks = scoped(input);

  /* Only tasks with a limit can overrun. One without a limit is not "on budget",
     it has no budget — the same distinction the time report itself draws. */
  const limited = tasks.filter((t) => t.timeLimitMinutes !== null);
  const allowed = (t: ReportTask) => (t.timeLimitMinutes ?? 0) + t.extensionMinutesGranted;
  const over = limited.filter((t) => t.timeSpentMinutes > allowed(t));

  const byPerson = groupBy(
    limited,
    (t) => t.assigneeId,
    (t) => t.assigneeName ?? 'Unassigned',
  );

  return [
    {
      kind: 'bars',
      title: 'Time over the allowance',
      question: 'Where is time going past what was allowed?',
      bars: topBars(
        [...byPerson.values()].map((group, index) => {
          const minutes = group.tasks.reduce(
            (sum, t) => sum + Math.max(0, t.timeSpentMinutes - allowed(t)),
            0,
          );
          return {
            label: group.label,
            /* Hours, because a bar labelled 1470 minutes is a number nobody
               converts in their head during a meeting. */
            value: Math.round((minutes / 60) * 10) / 10,
            token: hue(index),
            note: `${group.tasks.length} timed task${group.tasks.length === 1 ? '' : 's'}`,
          };
        }).filter((d) => d.value > 0),
      ),
      format: 'hours',
    },
    {
      kind: 'donut',
      title: 'Within the allowance',
      question: 'How much of the timed work stayed inside its budget?',
      slices: [
        {
          label: 'Within allowance',
          value: limited.length - over.length,
          token: 'status-done',
        },
        { label: 'Over allowance', value: over.length, token: 'feedback-error' },
      ].filter((s) => s.value > 0),
      centreLabel: 'Timed tasks',
      centreValue: String(limited.length),
    },
  ];
}

/* ==========================================================================
 * SHARED MIXES
 * ========================================================================== */

function taskInBucket(task: ReportTask, bucket: PeriodBucket): boolean {
  return taskInPeriod(task, { start: bucket.start, end: bucket.end });
}

/** Status composition, in the status order the rest of the system uses. */
function statusMix(tasks: readonly ReportTask[]): ChartDatum[] {
  const counts = new Map<TaskStatus, number>();
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => STATUS_META[a[0]].sortOrder - STATUS_META[b[0]].sortOrder)
    .map(([status, value]) => ({
      label: STATUS_META[status].label,
      value,
      /* Each status already owns a colour everywhere else in the product. Using
         the categorical palette here would give "Done" a different colour on this
         chart than on every board and badge in the system. */
      token: STATUS_META[status].token,
    }));
}

/**
 * Placements per platform.
 *
 * ⚠️ THIS COUNTS PLACEMENTS, NOT ASSETS, and the total therefore exceeds the task
 * count whenever anything is cross-posted. That is correct for "where is the work
 * going out" and would be wrong for "how much did we make" — which is why the
 * centre reads "Placements" rather than a task count. `lib/db/queries/placements.ts`
 * carries the same warning for the same reason.
 */
function platformMix(tasks: readonly ReportTask[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const slug of task.platforms) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  return topBars(
    [...counts.entries()].map(([slug, value], index) => ({
      /* The slug capitalised, not a lookup: platforms are rows in a table, so a
         hard-coded label map here would go stale the moment one is added. */
      label: slug.charAt(0).toUpperCase() + slug.slice(1),
      value,
      token: hue(index),
    })),
  );
}

/** Content kinds, with non-content work named rather than omitted. */
function contentMix(tasks: readonly ReportTask[]): ChartDatum[] {
  const counts = new Map<ContentKind | 'none', number>();
  for (const task of tasks) {
    const key = task.contentKind ?? 'none';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return topBars(
    [...counts.entries()].map(([kind, value], index) => ({
      /* ⚠️ Named, not dropped. Oversight work — reviews, client calls — is the
         only thing the executives on this team are assigned, so a chart that
         silently omitted it would show them doing nothing at all. */
      label: kind === 'none' ? 'Not content' : CONTENT_KIND_LABEL[kind],
      value,
      token: kind === 'none' ? 'status-backlog' : hue(index),
    })),
  );
}

/** Exported for the test that asserts the charts and the table agree. */
export const __testing = { scoped, topBars, statusMix, platformMix, contentMix, isClosed };
