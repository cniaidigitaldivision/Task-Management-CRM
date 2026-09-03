import type { ReportKind } from './report-periods';

/* ============================================================================
 * WHAT A REPORT SAYS — the content contract
 * ----------------------------------------------------------------------------
 * Every figure and sentence a report page carries, computed from the database and
 * settled before anything is drawn. Two renderers consume it:
 *
 *   · `lib/pdf/report-poster.ts`  draws the page itself, with real type
 *   · `lib/ai/report-image.ts`    hands it to `gpt-image-1` as a summary
 *
 * ── ⚠️ WHY THIS IS A DOMAIN TYPE AND NOT A RENDERER'S INPUT ────────────────────
 * It is STORED. A row in `project_reports` keeps the content it was built from, so the
 * PDF can be rebuilt later without re-querying a database whose tasks have since moved
 * on. That makes this shape a persistence format: adding a required field breaks reading
 * back every report generated before today, which is why `parseReportContent` treats
 * everything as optional and fills gaps rather than throwing.
 *
 * ── ⚠️ NO PERFORMANCE CLAIMS ─────────────────────────────────────────────────
 * The owner's reference layouts show lines like *"Reels outperformed static posts in
 * reach and engagement."* Reach and engagement live inside Meta and TikTok; this system
 * does not read them. There is deliberately no field here to carry such a claim, so it
 * cannot be added by accident to a document a client sees.
 * ========================================================================= */

/* ── ⚠️ ONE ROW PER TASK, NOT PER PLACEMENT — CHANGED 2026-09-03 ───────────
   Owner, looking at the generated PDF: *"if today's post should mention who did
   this post, what the post task name is… if I say that task one is the category,
   the task name, and their status, and if it's a static post then their URL."*

   It listed placements: platform, content type, time, link. Two posts
   cross-posted to three platforms produced SIX rows that repeated the same work
   six times and named neither the task nor the person who did it. A row is a
   piece of work now, and the platforms it went to are a column on it. */
export interface PublishedRow {
  /** The task's own name — what somebody actually made. */
  readonly task: string;
  /** 'CLI-1568', so a row can be found on the board it came from. */
  readonly reference: string;
  /** Static Post, Reel, Carousel… the owner's "category". */
  readonly contentType: string;
  /** Who did it. Falls back to whoever raised it, then to a dash. */
  readonly person: string;
  /** Done, In Review, To Do — where it had got to when the report was run. */
  readonly status: string;
  /** Every platform it went to, joined — "Facebook, Instagram, TikTok". */
  readonly platform: string;
  /* ── ⚠️ THE SLUGS AS WELL, FOR THE BRAND MARKS ────────────────────────────
     Owner, 2026-09-03: the PDF should draw the Facebook, Instagram and TikTok
     icons rather than write their names. `PLATFORM_MARKS` is keyed on the SLUG,
     and a lookup on the display name would fall back to a grey initial the day
     "X (Twitter)" is reworded again — which has already happened once.

     Both are stored: the names for the screen and the .xlsx export, the slugs
     for the marks. A stored report from before today has no `platformSlugs`,
     so the parser defaults it to empty and the PDF falls back to the text. */
  readonly platformSlugs: readonly string[];
  /** 'HH:MM' or ''. Only the daily layouts have a column for it. */
  readonly time: string;
  /** The live link, or '' where none was recorded. */
  readonly url: string;
}

/** What one person did in the period — the owner's "what each person did". */
export interface PersonRow {
  readonly name: string;
  readonly posts: number;
  readonly done: number;
}

export interface PlatformSummaryRow {
  readonly platform: string;
  readonly summary: string;
  readonly posts: number;
  /** Share of the period's placements, as a whole number. */
  readonly sharePct: number;
}

export interface BreakdownRow {
  readonly label: string;
  readonly staticPosts: number;
  readonly reels: number;
  readonly total: number;
  readonly target: number;
  readonly isOff: boolean;
}

export interface HeadlineFigure {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

export interface ReportContent {
  readonly kind: ReportKind;
  readonly projectName: string;
  readonly projectCode: string;
  /** "23 Aug 2026", "17 Aug – 23 Aug 2026", "August 2026". */
  readonly periodLabel: string;
  /** "WEEKLY REPORT" — the badge in the top-right. */
  readonly kindLabel: string;
  /** The introduction sentences, assembled from real columns. */
  readonly introduction: readonly string[];
  /** Target / Achieved / Remaining, and their sub-labels. */
  readonly headline: readonly HeadlineFigure[];
  /** Platform display names, in the order they are shown. */
  readonly platforms: readonly string[];
  /** The breakdown table: seven days for a week, weeks for a month, months for a year. */
  readonly rows: readonly BreakdownRow[];
  /** The daily layouts' "PUBLISHED TODAY" table. Empty for week/month/year. */
  readonly published: readonly PublishedRow[];
  /** "WHO DID WHAT" — one line per person who published in the period. */
  readonly people: readonly PersonRow[];
  /** The "WHERE IT WENT" / "PLATFORM DISTRIBUTION" panel. */
  readonly platformSummaries: readonly PlatformSummaryRow[];
  /** The "AT A GLANCE" / "INSIGHTS" ticks. Facts only — see the header. */
  readonly glance: readonly string[];
  readonly notes: readonly string[];
  /** The one big number in the activity panel, and the sentence under it. */
  readonly activityTotal: string;
  readonly activityCaption: string;
  readonly footer: string;
}

/** True for the two layouts that list individual posts with times and links. */
export function isDailyLayout(kind: ReportKind): boolean {
  return kind === 'today' || kind === 'yesterday';
}

/** The heading over the breakdown table, per layout. */
export function breakdownTitle(kind: ReportKind): string {
  switch (kind) {
    case 'week':
      return 'DAY BY DAY';
    case 'month':
      return 'WEEK BY WEEK';
    case 'year':
      return 'MONTH BY MONTH';
    default:
      return 'PUBLISHED';
  }
}

/** The label on the breakdown table's total row. */
export function breakdownTotalLabel(kind: ReportKind): string {
  switch (kind) {
    case 'week':
      return 'WEEK TOTAL';
    case 'month':
      return 'MONTH TOTAL';
    case 'year':
      return 'YEAR TOTAL';
    default:
      return 'TOTAL';
  }
}

/** The heading over the activity panel, per layout. */
export function activityTitle(kind: ReportKind): string {
  switch (kind) {
    case 'today':
      return "TODAY'S ACTIVITY";
    case 'yesterday':
      return "YESTERDAY'S ACTIVITY";
    case 'week':
      return 'ACTIVITY THIS WEEK';
    case 'month':
      return 'ACTIVITY THIS MONTH';
    case 'year':
      return 'ACTIVITY THIS YEAR';
  }
}

/** The heading over the ticks panel, per layout. */
export function glanceTitle(kind: ReportKind): string {
  switch (kind) {
    case 'today':
      return 'TODAY AT A GLANCE';
    case 'yesterday':
      return 'AT A GLANCE';
    case 'week':
      return 'WEEKLY INSIGHTS';
    case 'month':
      return 'MONTHLY INSIGHTS';
    case 'year':
      return 'ANNUAL INSIGHTS';
  }
}

/* ============================================================================
 * READING A STORED CONTENT BLOB
 * ----------------------------------------------------------------------------
 * ⚠️ Tolerant on purpose. This parses a `jsonb` column written by an earlier version of
 * this file, so a missing field must produce a slightly plainer page — never a 500 on a
 * report somebody already sent to a client. Every branch has a defined fallback and
 * nothing throws.
 * ========================================================================= */

const KINDS: readonly ReportKind[] = ['today', 'yesterday', 'week', 'month', 'year'];

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === 'string');
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Parse a stored content blob. Returns `null` only when the value is not an object at
 * all — at which point there is nothing to render and the caller should say so.
 */
export function parseReportContent(value: unknown): ReportContent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const kindValue = str(raw.kind);
  const kind = (KINDS as readonly string[]).includes(kindValue)
    ? (kindValue as ReportKind)
    : 'month';

  return {
    kind,
    projectName: str(raw.projectName, 'Project'),
    projectCode: str(raw.projectCode),
    periodLabel: str(raw.periodLabel),
    kindLabel: str(raw.kindLabel, 'REPORT'),
    introduction: strings(raw.introduction),
    headline: list(raw.headline).map((entry) => {
      const figure = record(entry);
      return {
        label: str(figure.label),
        value: str(figure.value, '0'),
        sub: str(figure.sub),
      };
    }),
    platforms: strings(raw.platforms),
    rows: list(raw.rows).map((entry) => {
      const row = record(entry);
      return {
        label: str(row.label),
        staticPosts: num(row.staticPosts),
        reels: num(row.reels),
        total: num(row.total),
        target: num(row.target),
        isOff: row.isOff === true,
      };
    }),
    published: list(raw.published).map((entry) => {
      const row = record(entry);
      return {
        task: str(row.task),
        reference: str(row.reference),
        contentType: str(row.contentType),
        person: str(row.person),
        status: str(row.status),
        platform: str(row.platform),
        platformSlugs: list(row.platformSlugs).map((slug) => str(slug)),
        time: str(row.time),
        url: str(row.url),
      };
    }),
    /* ⚠️ Parsed defensively like everything else here: a stored report from
       before 2026-09-03 has no `people` key, and the PDF for it must still
       render rather than throw. An empty list simply draws no panel. */
    people: list(raw.people).map((entry) => {
      const row = record(entry);
      return {
        name: str(row.name),
        posts: Number(row.posts ?? 0),
        done: Number(row.done ?? 0),
      };
    }),
    platformSummaries: list(raw.platformSummaries).map((entry) => {
      const row = record(entry);
      return {
        platform: str(row.platform),
        summary: str(row.summary),
        posts: num(row.posts),
        sharePct: num(row.sharePct),
      };
    }),
    glance: strings(raw.glance),
    notes: strings(raw.notes),
    activityTotal: str(raw.activityTotal, '0'),
    activityCaption: str(raw.activityCaption),
    footer: str(raw.footer),
  };
}
