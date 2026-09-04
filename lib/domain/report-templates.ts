import { REPORT_KIND_LABEL, type ReportKind } from './report-periods';

/* ============================================================================
 * REPORT TEMPLATES — the Studio's Reports & Exports tab, owner 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Everything should be working and live data will be added. Put everything in
 * logically and make it work."*
 *
 * Pure. No database, no React — the whole file is testable, and the tests are
 * what hold the two claims below honest.
 *
 * ── ⚠️ WHAT "SECTIONS INCLUDED" IS, AND WHAT IT IS NOT ──────────────────────
 * The reference drawer shows section names beside ticks, which reads as a set of
 * choices. They are not choices, and this is not a shortcut taken to save work:
 * `composeReportSheet` and `composeReportPdf` draw the owner's layouts at FIXED
 * geometry, panel by measured panel, because that is what took three rounds of
 * screenshots to get right. Dropping a panel would leave a hole rather than
 * reflow the page.
 *
 * So `templateSections` DESCRIBES the layout as built. Every entry below was
 * read off the composer that draws it, and `describes` names that composer so a
 * future change to one is caught here rather than discovered by a client.
 *
 * ── ⚠️ TWO FORMATS, NOT THE REFERENCE'S FIVE ────────────────────────────────
 * The reference's drawer offers PDF · Excel · PPT · CSV · Google Slides in one
 * even row of five. This system writes PDF (pdf-lib) and CSV, and has no writer
 * for the other three. They are listed — somebody asked for them, and hiding
 * them makes the page look arbitrarily short of the design — but each carries
 * the reason it is unavailable, and `availableFormats` is what the buttons use.
 * ========================================================================= */

export const TEMPLATE_ENGINES = [
  'project_report',
  'tasks_csv',
  'workload_csv',
  'meta_metrics_csv',
  'meta_posts_csv',
] as const;
export type TemplateEngine = (typeof TEMPLATE_ENGINES)[number];

export const TEMPLATE_CATEGORIES = [
  'performance',
  'content',
  'delivery',
  'audience',
  'executive',
  'data',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_LABEL: Readonly<Record<TemplateCategory, string>> = {
  performance: 'Performance',
  content: 'Content',
  delivery: 'Delivery',
  audience: 'Audience',
  executive: 'Executive',
  data: 'Raw data',
};

/** The chart token each category is drawn in, so a card's tint means something. */
export const CATEGORY_TOKEN: Readonly<Record<TemplateCategory, string>> = {
  performance: 'chart-1',
  content: 'chart-2',
  delivery: 'chart-3',
  audience: 'chart-4',
  executive: 'chart-6',
  data: 'chart-5',
};

/**
 * ⚠️ AN ICON *KEY*, NOT A COMPONENT, and every icon in this file is the same.
 * No other file in `lib/domain` imports React or lucide, and the reason is not
 * only tidiness: a component cannot cross the server/client boundary, so a
 * domain function returning one would work in a client component and throw
 * the moment a server page called it. `components/studio/reports-exports.tsx`
 * holds the single map from these keys to marks.
 */
export const CATEGORY_ICON: Readonly<Record<TemplateCategory, string>> = {
  performance: 'chart',
  content: 'image',
  delivery: 'checks',
  audience: 'users',
  executive: 'signature',
  data: 'table',
};

/**
 * The period as a template CARD says it.
 *
 * ⚠️ NOT `REPORT_KIND_LABEL`, and the first version of this used it and read
 * "Executive · This month · PDF" on the card. Those labels are written for the
 * period PICKER on /reports, where "This month" is the right words for a thing
 * you are about to choose. On a template — a standing preset that will be run
 * again next month — the cadence is the fact, and these are the same words the
 * PDF prints in its own badge (see BADGE in app/actions/project-report.ts).
 */
export const PERIOD_TAG: Readonly<Record<ReportKind, string>> = {
  today: 'Daily',
  yesterday: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Annual',
};

export interface ReportTemplate {
  readonly id: string;
  readonly slug: string | null;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly engine: TemplateEngine;
  readonly kind: ReportKind | null;
  readonly format: 'pdf' | 'csv';
  readonly isBuiltin: boolean;
  readonly createdById: string | null;
  readonly createdByName: string | null;
  readonly usageCount: number;
  readonly lastUsedAt: string | null;
  readonly updatedAt: string;
  /** Whether the person looking at the page has starred it. */
  readonly isFavourite: boolean;
  /** Ordered section keys — migration 098. The drawer's checklist. */
  readonly sections: readonly string[];
  /** The format marks the drawer offers. `format` is what the engine writes. */
  readonly formats: readonly string[];
  /** A chart-palette token for the card's chip. */
  readonly accent: string;
  /** An icon key, resolved to a mark by the client. */
  readonly icon: string;
}

/* ---- Sections ------------------------------------------------------------ */

export interface TemplateSection {
  readonly key: string;
  readonly label: string;
  readonly note: string;
  /** An icon key — see CATEGORY_ICON. */
  readonly icon: string;
}

export interface SectionSummary {
  readonly heading: string;
  /** Which file draws or writes these — named so a change there is traceable. */
  readonly describes: string;
  readonly sections: readonly TemplateSection[];
}

/**
 * What a template's output actually contains.
 *
 * ⚠️ READ OFF THE COMPOSERS, NOT INVENTED. The PDF list follows
 * `lib/pdf/report-sheet.ts` (`composeReportSheet`), which is the DEFAULT
 * renderer at `/api/project-report/[id]` — the drawn poster in
 * `report-poster.ts` is the `?layout=poster` variant. The CSV lists are the
 * literal header arrays in `app/actions/export.ts` and the Meta writers.
 */
export function templateSections(
  template: Pick<ReportTemplate, 'engine' | 'kind' | 'format'>,
): SectionSummary {
  if (template.engine === 'project_report') {
    const kind = template.kind ?? 'month';
    const daily = kind === 'today' || kind === 'yesterday';

    return {
      heading: 'Sections included',
      describes: 'lib/pdf/report-sheet.ts',
      sections: [
        {
          key: 'masthead',
          label: 'Division masthead',
          note: 'Letterhead, the project name in bold, and the rhythm agreed with the client beneath it.',
          icon: 'signature',
        },
        {
          key: 'figures',
          label: 'Figure cards',
          note: 'Target, achieved and remaining for the period, against the monthly promise.',
          icon: 'target',
        },
        {
          key: 'table',
          label: daily ? 'Published posts' : breakdownHeading(kind),
          note: daily
            ? 'One row per post published, with its time, category, status and platform.'
            : `One row per ${kind === 'week' ? 'day' : kind === 'month' ? 'week' : 'month'}, with a total row beneath.`,
          icon: daily ? 'checks' : 'calendar',
        },
        {
          key: 'marks',
          label: 'Platform marks',
          note: 'The brand icon for each platform rather than the words — asked for on 2026-09-03.',
          icon: 'marks',
        },
        /* ⚠️ ONLY THE DAILY LAYOUTS CARRY LINKS, because only they list
           individual posts. Claiming a clickable link column on the monthly
           sheet would be describing a column that is not there. */
        ...(daily
          ? [
              {
                key: 'links',
                label: 'Clickable post links',
                note: 'The live placement address in the last column, clickable in the PDF itself.',
                icon: 'link',
              },
            ]
          : []),
        {
          key: 'notes',
          label: 'What this report counts',
          note: 'The definitions behind every figure, so two readers cannot disagree about what "achieved" means.',
          icon: 'notes',
        },
      ],
    };
  }

  const columns: Readonly<Record<Exclude<TemplateEngine, 'project_report'>, readonly string[]>> = {
    tasks_csv: [
      'Reference, Title, Project, Project type',
      'Status, Priority, Effort, Effort points',
      'Assignee, Raised by',
      'Start date, Due date, Completed',
      'Time limit, Time spent',
      'Subtasks, Comments, Files',
    ],
    workload_csv: [
      'Name, Role',
      'Week starting, Week ending',
      'Load points, Capacity points, Utilisation %',
      'Band, Active tasks, Concurrent limit',
      'Ad-hoc work %',
    ],
    meta_metrics_csv: [
      'Date, Account, Platform',
      'Metric key, Metric label',
      'Value',
    ],
    meta_posts_csv: [
      'Published at, Account, Platform',
      'Surface, Media type',
      'Caption, Permalink',
      'Reach, Views, Likes, Comments, Shares, Saves',
      'Engagement rate',
    ],
  };

  return {
    heading: 'Columns included',
    describes:
      template.engine === 'tasks_csv' || template.engine === 'workload_csv'
        ? 'app/actions/export.ts'
        : 'app/actions/report-templates.ts',
    sections: columns[template.engine].map((group, i) => ({
      key: `col-${i}`,
      label: group,
      note: '',
      icon: 'table',
    })),
  };
}

function breakdownHeading(kind: ReportKind): string {
  switch (kind) {
    case 'week':
      return 'Day by day';
    case 'month':
      return 'Week by week';
    case 'year':
      return 'Month by month';
    default:
      return 'Published';
  }
}

/** "Monthly · PDF" — the line under a card's title. */
export function templateMeta(template: ReportTemplate): string {
  const period = template.kind ? PERIOD_TAG[template.kind] : 'Chosen range';
  return `${period} · ${template.format.toUpperCase()}`;
}

/**
 * The tags on a template card.
 *
 * ⚠️ EVERY TAG IS A FACT ABOUT THE ROW — category, period, format, authorship.
 * The reference's cards carry free-text tags, which would mean a tag column
 * somebody has to curate and nobody will, going stale the first time a template
 * changes. These cannot go stale: they are the row.
 */
export function templateTags(template: ReportTemplate): readonly string[] {
  return [
    CATEGORY_LABEL[template.category],
    template.kind ? PERIOD_TAG[template.kind] : 'Any range',
    template.format.toUpperCase(),
    template.isBuiltin ? 'Built-in' : 'Custom',
  ];
}

/* ---- Formats ------------------------------------------------------------- */

export interface ExportFormat {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly available: boolean;
  /** Why not, when not. Shown on the disabled button rather than hidden. */
  readonly reason: string;
}

/**
 * ⚠️ THE THREE UNAVAILABLE ONES CARRY THEIR REASON AND STAY VISIBLE. A greyed
 * button that explains itself is information; a missing one just looks like the
 * page is unfinished, and a live one that produces nothing is the only genuinely
 * bad option of the three.
 */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    key: 'pdf',
    label: 'PDF',
    icon: 'pdf',
    available: true,
    reason: 'Drawn server-side with real type — every glyph typeset, identical every time.',
  },
  {
    key: 'csv',
    label: 'CSV',
    icon: 'sheet',
    available: true,
    reason: 'Opens in Excel, Sheets or Numbers.',
  },
  {
    key: 'xlsx',
    label: 'Excel',
    icon: 'sheet',
    available: false,
    reason: 'No writer for .xlsx yet. CSV opens in Excel and carries the same rows.',
  },
  {
    key: 'pptx',
    label: 'PowerPoint',
    icon: 'layers',
    available: false,
    reason: 'No writer for .pptx. The PDF is the presentable form.',
  },
  {
    key: 'gslides',
    label: 'Google Slides',
    icon: 'layers',
    available: false,
    reason: 'Needs a Google Workspace connection, which is not set up.',
  },
];

export function availableFormats(): readonly ExportFormat[] {
  return EXPORT_FORMATS.filter((f) => f.available);
}

/* ---- Filtering ----------------------------------------------------------- */

export interface TemplateFilter {
  readonly query: string;
  readonly category: TemplateCategory | 'all';
  readonly format: 'all' | 'pdf' | 'csv';
  readonly origin: 'all' | 'builtin' | 'custom';
  readonly favouritesOnly: boolean;
}

export const EMPTY_FILTER: TemplateFilter = {
  query: '',
  category: 'all',
  format: 'all',
  origin: 'all',
  favouritesOnly: false,
};

export function filterActive(filter: TemplateFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.category !== 'all' ||
    filter.format !== 'all' ||
    filter.origin !== 'all' ||
    filter.favouritesOnly
  );
}

/**
 * ⚠️ THE SEARCH READS THE DESCRIPTION TOO, and that is the difference between a
 * search box that works and one that only rewards knowing the exact name.
 * Somebody looking for a client sheet types "client"; only one template has that
 * word in its NAME, but the description of the annual review has it as well.
 */
export function filterTemplates(
  templates: readonly ReportTemplate[],
  filter: TemplateFilter,
): readonly ReportTemplate[] {
  const q = filter.query.trim().toLowerCase();

  return templates.filter((t) => {
    if (filter.favouritesOnly && !t.isFavourite) return false;
    if (filter.category !== 'all' && t.category !== filter.category) return false;
    if (filter.format !== 'all' && t.format !== filter.format) return false;
    if (filter.origin === 'builtin' && !t.isBuiltin) return false;
    if (filter.origin === 'custom' && t.isBuiltin) return false;
    if (q === '') return true;

    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      CATEGORY_LABEL[t.category].toLowerCase().includes(q) ||
      /* Both period vocabularies, because somebody may type either — the
         card says "Monthly" and the /reports picker says "This month". */
      (t.kind
        ? PERIOD_TAG[t.kind].toLowerCase().includes(q) ||
          REPORT_KIND_LABEL[t.kind].toLowerCase().includes(q)
        : false)
    );
  });
}

/** Favourites first, then most used, then alphabetical — a stable order. */
export function sortTemplates(
  templates: readonly ReportTemplate[],
): readonly ReportTemplate[] {
  return [...templates].sort((a, b) => {
    if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    return a.name.localeCompare(b.name);
  });
}

/* ---- The six figures ----------------------------------------------------- */

export interface TemplateKpi {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly icon: string;
  readonly token: string;
  readonly footnote: string;
}

/**
 * The six figures above the grid, in the reference's order.
 *
 * ── ⚠️ TWO OF THE SIX DISAGREE WITH THE MOCKUP, AND BOTH ARE COUNTS ────────
 *
 *   "AI Summary Blocks 42" reads 20 here.
 *       It counts `INSIGHT_SECTIONS` across the library — the reference's own
 *       footnote says "Across all templates", so that is exactly what it is a
 *       count of. Twenty is what the twenty-four templates declare. Hard-coding
 *       42 would make the one card nobody can check also the only one that is
 *       wrong, and the figure moves on its own as templates are added.
 *
 *   The deltas — "+3 this month", "+2 this month", "In the last 7 days" —
 *       are computed from `updatedAt`, so they are real or they are absent. A
 *       library seeded in one migration honestly has every template "updated
 *       this week", and it will read that way until the dates spread out.
 *
 * "Supported Formats 5" is genuinely 5: the library offers five, and the
 * footnote names which two have a writer today. Offered and writable are
 * different facts and the card shows both rather than picking one.
 */
export function templateKpis(input: {
  readonly templates: readonly ReportTemplate[];
  readonly nowMs: number;
}): readonly TemplateKpi[] {
  const { templates, nowMs } = input;

  const custom = templates.filter((t) => !t.isBuiltin);

  const mostUsed = templates.reduce<ReportTemplate | null>(
    (best, t) => (t.usageCount > 0 && (!best || t.usageCount > best.usageCount) ? t : best),
    null,
  );

  const WEEK = 7 * 24 * 3_600_000;
  const MONTH = 30 * 24 * 3_600_000;
  const since = (ms: number, list: readonly ReportTemplate[]) =>
    list.filter((t) => nowMs - Date.parse(t.updatedAt) < ms).length;

  const recent = since(WEEK, templates);
  const newThisMonth = since(MONTH, templates);
  const newCustomThisMonth = since(MONTH, custom);

  /* Distinct formats the library OFFERS, and the subset something can write. */
  const offered = new Set<string>();
  for (const t of templates) for (const f of t.formats) offered.add(f);
  const writable = availableFormats();

  /* ⚠️ A delta is omitted when it is zero rather than printed as "+0", which
     reads as a measurement rather than as the absence of one. */
  const delta = (n: number, unit: string) => (n > 0 ? `+${n} ${unit}` : undefined);

  return [
    {
      key: 'total',
      label: 'Total templates',
      value: String(templates.length),
      icon: 'document',
      token: 'chart-3',
      footnote: delta(newThisMonth, 'this month') ?? `${templates.length - custom.length} built-in`,
    },
    {
      key: 'most-used',
      /* ⚠️ A NAME, NOT A COUNT — which is what the reference shows too, and the
         more useful thing to see. The count is the footnote. */
      label: 'Most used template',
      value: mostUsed?.name ?? 'None yet',
      icon: 'trophy',
      token: 'chart-6',
      footnote: mostUsed
        ? `Used ${mostUsed.usageCount} ${mostUsed.usageCount === 1 ? 'time' : 'times'}`
        : 'No template has been run yet',
    },
    {
      key: 'custom',
      label: 'Custom templates',
      value: String(custom.length),
      icon: 'edit',
      token: 'chart-2',
      footnote: delta(newCustomThisMonth, 'this month') ?? 'Built by the division',
    },
    {
      key: 'formats',
      label: 'Supported formats',
      value: String(offered.size),
      icon: 'file',
      token: 'chart-1',
      /* Offered and writable are different facts; the card carries both. */
      footnote: `${writable.map((f) => f.label).join(' and ')} write today`,
    },
    {
      key: 'ai-blocks',
      label: 'AI summary blocks',
      value: String(insightBlockCount(templates)),
      icon: 'sparkles',
      token: 'chart-5',
      footnote: 'Across all templates',
    },
    {
      key: 'recent',
      label: 'Recently updated',
      value: String(recent),
      icon: 'clock',
      token: 'chart-8',
      footnote: 'In the last 7 days',
    },
  ];
}

/* ---- Schedules ----------------------------------------------------------- */

export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABEL: Readonly<Record<Cadence, string>> = {
  daily: 'Every day',
  weekly: 'Every Monday',
  monthly: 'The 1st of each month',
};

/**
 * The next date a cadence is due, from a Karachi date.
 *
 * ⚠️ TAKES AND RETURNS `YYYY-MM-DD` STRINGS AND NEVER A `Date`. Every date
 * boundary in this system is Asia/Karachi (UTC+5), and a `Date` here would be
 * built in the server's zone — which is five hours behind, so for five hours
 * each evening it names YESTERDAY. That exact confusion has already made a
 * correct answer look wrong once. String arithmetic cannot drift.
 */
export function nextRunOn(cadence: Cadence, fromDate: string): string {
  const [y, m, d] = fromDate.split('-').map(Number);

  if (cadence === 'daily') return addDays(fromDate, 1);

  if (cadence === 'weekly') {
    /* Monday. `Date.UTC` is safe here — it is used only to read a weekday from a
       date that carries no time, never to decide what "today" is. */
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
    const ahead = (8 - (dow === 0 ? 7 : dow)) % 7 || 7;
    return addDays(fromDate, ahead);
  }

  /* The 1st of next month. */
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export interface ReportSchedule {
  readonly id: string;
  readonly projectId: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly format: 'pdf' | 'csv';
  readonly cadence: Cadence;
  readonly nextRunOn: string;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
  readonly isActive: boolean;
  readonly createdByName: string | null;
}

/**
 * How a schedule is doing.
 *
 * ⚠️ "OVERDUE" IS A REAL STATE AND IT IS SHOWN. A schedule whose due date has
 * passed without a run means the cron is not reaching this project — which is
 * exactly what is true on this branch today, because the schedule runner is
 * registered in `vercel.json` and this branch is not deployed. Reporting every
 * schedule as "Active" would hide that.
 */
export function scheduleState(
  schedule: Pick<ReportSchedule, 'isActive' | 'nextRunOn' | 'lastError'>,
  todayKarachi: string,
): { readonly label: string; readonly token: string; readonly detail: string } {
  if (!schedule.isActive) {
    return { label: 'Paused', token: 'text-tertiary', detail: 'Will not run until resumed.' };
  }
  if (schedule.lastError) {
    return {
      label: 'Failed',
      token: 'feedback-error',
      detail: schedule.lastError,
    };
  }
  if (schedule.nextRunOn < todayKarachi) {
    return {
      label: 'Overdue',
      token: 'feedback-warning',
      detail: `Was due ${schedule.nextRunOn} and has not run. The scheduler is not reaching this project.`,
    };
  }
  return {
    label: 'Active',
    token: 'feedback-success',
    detail: `Next report files on ${schedule.nextRunOn}.`,
  };
}

/* ---- Export history ------------------------------------------------------ */

export interface ExportRecord {
  readonly id: string;
  /**
   * Which template produced it, when that template still exists.
   *
   * ⚠️ NULLABLE, because 096 keeps the history when a custom template is
   * deleted — `on delete set null` — and `templateName` is stored verbatim for
   * exactly that case. The drawer uses this to find a template's last report;
   * the table shows the name whether or not the row survives.
   */
  readonly templateId: string | null;
  readonly templateName: string;
  readonly format: 'pdf' | 'csv';
  readonly fileName: string;
  readonly byteSize: number | null;
  readonly rowCount: number | null;
  readonly status: 'ready' | 'failed';
  readonly error: string | null;
  readonly reportId: string | null;
  readonly requestedByName: string | null;
  readonly createdAt: string;
}

/** "12.4 KB". Null size is a dash, never "0 B" — they mean different things. */
export function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ============================================================================
 * THE SECTION VOCABULARY — migration 098
 * ----------------------------------------------------------------------------
 * ⚠️ THE KEYS ARE THE CONTRACT AND THE MIGRATION ASSERTS THEM. 098's self-check
 * refuses to commit a template carrying a key that is not in its whitelist,
 * because an unknown key does not fail loudly here — it silently drops a tick
 * off a checklist somebody is reading before sending a client a report. Add a
 * key in both places or in neither.
 * ========================================================================= */

export const SECTION_LABEL: Readonly<Record<string, string>> = {
  masthead: 'Division masthead',
  'top-line-metrics': 'Top line metrics',
  'performance-overview': 'Performance overview',
  'channel-breakdown': 'Channel breakdown',
  'published-posts': 'Published posts',
  'who-did-what': 'Who did what',
  'platform-distribution': 'Platform distribution',
  notes: 'What this report counts',
  'key-insights': 'Key insights',
  recommendations: 'Recommendations',
  'executive-narrative': 'Executive narrative',
  'trends-comparisons': 'Trends & comparisons',
  'top-campaigns': 'Top campaigns',
  'top-posts': 'Top performing posts',
  'content-mix': 'Content mix',
  'engagement-rate': 'Engagement rate',
  'follower-growth': 'Follower growth',
  'audience-mix': 'Audience breakdown',
  'top-locations': 'Top locations',
  'best-times': 'Best times to post',
  'delivery-vs-promise': 'Delivery vs promise',
  'account-health': 'Account health',
  'sync-status': 'Sync status',
  'task-columns': 'Task columns',
  'workload-columns': 'Workload columns',
  'metric-columns': 'Daily metric columns',
  'post-columns': 'Post performance columns',
};

/**
 * The sections whose content has to be WRITTEN rather than tabulated.
 *
 * ⚠️ THIS IS WHAT THE "AI SUMMARY BLOCKS" FIGURE COUNTS, and the count is real:
 * the reference's own footnote reads "Across all templates", so the card is a
 * total of these across the library. The reference prints 42 and the library
 * currently holds 20 — the figure is data, and inflating it to match a mockup
 * would make the one card on the page that cannot be checked also the one that
 * is wrong.
 *
 * ⚠️ AND NOTHING WRITES THEM YET. `ReportContent`'s glance ticks are computed
 * from columns and are commented "Facts only", because the single AI pass this
 * feature ever had returned the client's name as "NAYA MARKITING". These keys
 * are the brief for that work, not a claim that it is done.
 */
export const INSIGHT_SECTIONS: readonly string[] = [
  'key-insights',
  'recommendations',
  'executive-narrative',
];

export function isInsightSection(key: string): boolean {
  return INSIGHT_SECTIONS.includes(key);
}

export function sectionLabel(key: string): string {
  /* Falls back to the key rather than to nothing: a missing label is a bug to
     see, not a blank line to wonder about. */
  return SECTION_LABEL[key] ?? key;
}

/** How many insight-written blocks the whole library declares. */
export function insightBlockCount(templates: readonly ReportTemplate[]): number {
  return templates.reduce(
    (n, t) => n + t.sections.filter((s) => isInsightSection(s)).length,
    0,
  );
}

/* ---- The sample thumbnails ----------------------------------------------- */

/**
 * Which of the drawer's three preview tiles a template shows.
 *
 * ⚠️ CHOSEN FROM THE TEMPLATE'S OWN SECTIONS, so the thumbnails preview what the
 * report will actually contain. The reference draws the same three tiles for
 * every template, which would mean a CSV of task columns previewing a donut of
 * channel share — a picture of a document that does not exist.
 */
export type PreviewBlock = 'overview' | 'channels' | 'campaigns' | 'growth' | 'columns';

export function previewBlocks(template: ReportTemplate): readonly PreviewBlock[] {
  const has = (k: string) => template.sections.includes(k);
  const blocks: PreviewBlock[] = [];

  if (has('performance-overview') || has('top-line-metrics')) blocks.push('overview');
  if (has('channel-breakdown') || has('content-mix') || has('platform-distribution')) {
    blocks.push('channels');
  }
  if (has('top-campaigns') || has('top-posts') || has('published-posts')) {
    blocks.push('campaigns');
  }
  if (has('follower-growth') || has('trends-comparisons') || has('engagement-rate')) {
    blocks.push('growth');
  }
  if (blocks.length === 0) blocks.push('columns');

  return blocks.slice(0, 3);
}
