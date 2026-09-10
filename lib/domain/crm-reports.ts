import type { Cell, Report, ReportFigure } from './reports';
import { stageLabel, STAGE_ORDER } from './crm-stages';

/* ============================================================================
 * SHAPING A CRM REPORT — Step 10, LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React. Raw aggregate rows in, a `Report` out —
 * the same `Report` the CSV and XLSX writers already take, so nothing here
 * needs a file format of its own.
 *
 * ── ⚠️ EVERY REPORT CARRIES ITS OWN DEFINITIONS ────────────────────────────
 * `notes` is not documentation, it is part of the figure. `lib/domain/reports.ts`
 * puts it plainly: *"a number without its definition is how two people read the
 * same report and disagree."* So each builder below states what it counted, what
 * it excluded, and — where it matters most — what it cannot yet say.
 *
 * ── ⚠️ AND NOTHING HERE INVENTS A RATE ─────────────────────────────────────
 * A win rate arrives as `null` from the database while nothing has closed, and
 * it stays null through to the page. Rendering it as 0% would read as a fact
 * about the campaign when it is a fact about the calendar.
 * ========================================================================= */

/* ── ⚠️ THE VOCABULARY LIVES HERE, NOT IN THE QUERY MODULE ─────────────────
   It was in `lib/db/queries/crm-reports.ts`, which is `server-only`, and the
   reports page is a Client Component that needs the labels for its dropdown.
   Importing a VALUE from a server-only module type-checks and then breaks the
   production build — `design-tokens.test.ts` guards exactly this and caught it.
   Pure vocabulary belongs in `lib/domain/` (doc 20 §1), and this is pure. */
export const REPORT_KINDS = ['funnel', 'ageing', 'sources', 'people'] as const;

export type CrmReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABEL: Readonly<Record<CrmReportKind, string>> = {
  funnel: 'Lead funnel',
  ageing: 'How long leads have been waiting',
  sources: 'Where the leads came from',
  people: 'How the team is doing',
};

export function isReportKind(value: string): value is CrmReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

/** ⚠️ Ageing takes no period — it is a snapshot of now. */
export function reportNeedsPeriod(kind: CrmReportKind): boolean {
  return kind !== 'ageing';
}

const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number): Cell => ({ kind: 'number', value });
const pct = (value: number): Cell => ({ kind: 'percent', value });

/**
 * A number the database could not compute yet.
 *
 * ⚠️ A DASH, NOT A ZERO, and it is a text cell rather than a number one on
 * purpose: a spreadsheet averaging a column of win rates must not be handed a
 * zero that nobody measured. `—` is excluded from an average; `0` drags it down.
 */
const notYet = (): Cell => ({ kind: 'text', value: '—' });

export interface FunnelRow {
  readonly stage: string;
  readonly leads: number;
  readonly share: number | null;
}

export interface AgeingRow {
  readonly bucket: string;
  readonly sortOrder: number;
  readonly leads: number;
  readonly oldestDays: number;
}

export interface SourceRow {
  readonly source: string;
  readonly leads: number;
  readonly contacted: number;
  readonly won: number;
  readonly lost: number;
  readonly winRate: number | null;
}

export interface PersonRow {
  readonly person: string;
  readonly leads: number;
  readonly contacted: number;
  readonly won: number;
  readonly lost: number;
  readonly stillOpen: number;
  readonly medianMinutes: number | null;
}

export interface ReportContext {
  readonly projectName: string;
  readonly from: string;
  readonly to: string;
}

/* ---- The funnel ---------------------------------------------------------- */

/**
 * ⚠️ EVERY STAGE, INCLUDING THE EMPTY ONES, IN PIPELINE ORDER. The database
 * returns only the stages that hold leads; a funnel whose middle is missing
 * looks like a complete funnel with a narrow waist. The shape is carried by the
 * gaps as much as by the numbers — the same reasoning as the desk's stage strip.
 */
export function buildFunnelReport(rows: readonly FunnelRow[], ctx: ReportContext): Report {
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  const total = rows.reduce((sum, r) => sum + r.leads, 0);

  const body = STAGE_ORDER.map((stage) => {
    const row = byStage.get(stage);
    const leads = row?.leads ?? 0;
    return [
      text(stageLabel(stage)),
      num(leads),
      total === 0 ? notYet() : pct(Math.round((leads / total) * 1000) / 10),
    ];
  });

  const open = STAGE_ORDER.filter((s) => s !== 'won' && s !== 'lost').reduce(
    (sum, s) => sum + (byStage.get(s)?.leads ?? 0),
    0,
  );
  const won = byStage.get('won')?.leads ?? 0;
  const lost = byStage.get('lost')?.leads ?? 0;

  const figures: ReportFigure[] = [
    { label: 'Leads in the period', value: num(total) },
    { label: 'Still open', value: num(open), hint: 'Not won and not lost' },
    { label: 'Won', value: num(won) },
    { label: 'Lost', value: num(lost) },
  ];

  const notes = [
    'Counted by the date the lead was submitted, in Asia/Karachi.',
    'Won and lost are exits rather than stages — a lost lead has not progressed further than one in negotiation.',
  ];

  /* ⚠️ SAYS SO WHEN THE FUNNEL IS ONE COLUMN. 615 leads all sitting at New is
     not a funnel, and a reader who is not told will take the 100% as a result. */
  if (total > 0 && won === 0 && lost === 0) {
    notes.push(
      'Nothing has been won or lost yet, so this is a snapshot of a pipeline rather than a measure of one. The shares describe where leads are sitting, not how they converted.',
    );
  }

  return {
    type: 'project',
    title: 'Lead funnel',
    subtitle: ctx.projectName,
    period: { start: ctx.from, end: ctx.to },
    columns: [
      { key: 'stage', label: 'Stage', kind: 'text', width: 22 },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'share', label: 'Share', kind: 'percent' },
    ],
    rows: body,
    figures,
    notes,
  };
}

/* ---- Ageing -------------------------------------------------------------- */

/**
 * How long the open leads have been waiting.
 *
 * ⚠️ THE ONE REPORT WITH REAL SIGNAL TODAY, and the note is the point of it.
 * Meta deletes lead data at 90 days from submission; anything in the last bucket
 * is past that, so our copy is the only one that exists. A reader has to be told
 * that, because it changes what they do this afternoon.
 */
export function buildAgeingReport(rows: readonly AgeingRow[], ctx: ReportContext): Report {
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = ordered.reduce((sum, r) => sum + r.leads, 0);
  const oldest = ordered.reduce((max, r) => Math.max(max, r.oldestDays), 0);
  const overAMonth = ordered
    .filter((r) => r.sortOrder >= 4)
    .reduce((sum, r) => sum + r.leads, 0);

  const figures: ReportFigure[] = [
    { label: 'Open leads', value: num(total) },
    {
      label: 'Over a month old',
      value: num(overAMonth),
      hint: total === 0 ? undefined : `${Math.round((overAMonth / total) * 100)}% of them`,
    },
    { label: 'Oldest', value: num(oldest), hint: 'Days since they enquired' },
  ];

  const notes = [
    'Open leads only — won and lost are excluded, because neither is waiting for anybody.',
    'Age is counted from when the person submitted the form, not from when we imported them.',
  ];

  if (oldest >= 90) {
    notes.push(
      'Meta deletes lead data 90 days after submission. Anything in the last bucket no longer exists on their side, so our copy is the only one.',
    );
  }

  return {
    type: 'project',
    title: 'How long leads have been waiting',
    subtitle: ctx.projectName,
    /* ⚠️ A snapshot, so both ends are today rather than the period the caller
       asked for — ageing filtered by arrival date answers a different question. */
    period: { start: ctx.to, end: ctx.to },
    columns: [
      { key: 'bucket', label: 'Waiting', kind: 'text', width: 24 },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'share', label: 'Share', kind: 'percent' },
      { key: 'oldest', label: 'Oldest in days', kind: 'number' },
    ],
    rows: ordered.map((r) => [
      text(r.bucket),
      num(r.leads),
      total === 0 ? notYet() : pct(Math.round((r.leads / total) * 1000) / 10),
      num(r.oldestDays),
    ]),
    figures,
    notes,
  };
}

/* ---- Sources ------------------------------------------------------------- */

/**
 * Which form brought them in, and what became of them.
 *
 * ⚠️ "CAME FROM", NOT "CAMPAIGN", AND THE NOTE SAYS WHY. `campaign_name` comes
 * back empty on every lead because the page and its ad account sit in different
 * Meta portfolios. A column headed Campaign over form names is how spend gets
 * judged by the wrong figure — so the report names what it actually has and
 * states the gap.
 */
export function buildSourcesReport(rows: readonly SourceRow[], ctx: ReportContext): Report {
  const ordered = [...rows].sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
  const total = ordered.reduce((sum, r) => sum + r.leads, 0);
  const contacted = ordered.reduce((sum, r) => sum + r.contacted, 0);
  const won = ordered.reduce((sum, r) => sum + r.won, 0);

  const figures: ReportFigure[] = [
    { label: 'Leads in the period', value: num(total) },
    {
      label: 'Ever contacted',
      value: num(contacted),
      hint: total === 0 ? undefined : `${Math.round((contacted / total) * 100)}% of them`,
    },
    { label: 'Won', value: won === 0 ? notYet() : num(won) },
  ];

  const notes = [
    'Grouped by the lead FORM, which is what Meta returns on every lead.',
    'Contacted means somebody logged a call, a message or an email against the lead — not that the lead replied.',
  ];

  /* ⚠️ THE HONEST HEADLINE, and it is a number nobody would otherwise see:
     leads arriving and nobody ringing them is a different problem from leads
     arriving and not converting, and only one of them is the campaign's fault. */
  if (total > 0 && contacted === 0) {
    notes.push(
      'Nobody has been contacted at all, so nothing here says anything about which source is worth the money. It says the leads have not been worked yet.',
    );
  }

  notes.push(
    'The campaign that paid for each lead is not shown, because Meta returns it empty: the page and the ad account running its campaigns are in different portfolios. One permission change in Meta would fill this in.',
  );

  return {
    type: 'project',
    title: 'Where the leads came from',
    subtitle: ctx.projectName,
    period: { start: ctx.from, end: ctx.to },
    columns: [
      { key: 'source', label: 'Came from', kind: 'text', width: 34 },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'contacted', label: 'Contacted', kind: 'number' },
      { key: 'won', label: 'Won', kind: 'number' },
      { key: 'lost', label: 'Lost', kind: 'number' },
      { key: 'rate', label: 'Win rate', kind: 'percent' },
    ],
    rows: ordered.map((r) => [
      text(r.source),
      num(r.leads),
      num(r.contacted),
      num(r.won),
      num(r.lost),
      /* ⚠️ Null all the way through from SQL. See `notYet`. */
      r.winRate === null ? notYet() : pct(r.winRate),
    ]),
    figures,
    notes,
  };
}

/* ---- People -------------------------------------------------------------- */

/**
 * Per person: what they hold, how fast they answer, what they closed.
 *
 * ⚠️ THIS IS HALF OF THE OWNER'S HEADLINE QUESTION — *"6,000 leads and not one
 * closed: is it the staff or the campaign?"* — and the note says so, along with
 * how to read it beside the sources report. A comparison nobody can reconstruct
 * gets ignored the first time it disagrees with somebody's gut.
 */
export function buildPeopleReport(rows: readonly PersonRow[], ctx: ReportContext): Report {
  const ordered = [...rows].sort((a, b) => b.leads - a.leads || a.person.localeCompare(b.person));

  const figures: ReportFigure[] = [
    { label: 'People holding leads', value: num(ordered.length) },
    { label: 'Leads between them', value: num(ordered.reduce((s, r) => s + r.leads, 0)) },
    {
      label: 'Won',
      value: (() => {
        const won = ordered.reduce((s, r) => s + r.won, 0);
        return won === 0 ? notYet() : num(won);
      })(),
    },
  ];

  const notes = [
    'Counted by who holds the lead now, not by who held it when it arrived.',
    'Response time is the median from the person submitting the form to the first logged contact. Half of their leads were answered faster than this, half slower.',
    'A blank response time means nobody has logged a call on any of their leads yet — it is not a zero.',
  ];

  if (ordered.length === 0) {
    notes.push(
      'Nobody holds a lead yet, so there is nothing to compare. Leads are shared out from the desk, and this fills in once they are.',
    );
  } else {
    notes.push(
      'Read beside "Where the leads came from": the same source with different people means it is the person; the same person across different sources means it is the source.',
    );
  }

  return {
    type: 'project',
    title: 'How the team is doing',
    subtitle: ctx.projectName,
    period: { start: ctx.from, end: ctx.to },
    columns: [
      { key: 'person', label: 'Who', kind: 'text', width: 24 },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'contacted', label: 'Contacted', kind: 'number' },
      { key: 'open', label: 'Still open', kind: 'number' },
      { key: 'won', label: 'Won', kind: 'number' },
      { key: 'lost', label: 'Lost', kind: 'number' },
      { key: 'response', label: 'Usually answers in', kind: 'duration' },
    ],
    rows: ordered.map((r) => [
      text(r.person),
      num(r.leads),
      num(r.contacted),
      num(r.stillOpen),
      num(r.won),
      num(r.lost),
      /* ⚠️ A DURATION IN MINUTES, so the spreadsheet formats it. Null becomes a
         dash rather than 0m — see `notYet`. */
      r.medianMinutes === null
        ? notYet()
        : { kind: 'duration', value: Math.round(r.medianMinutes) },
    ]),
    figures,
    notes,
  };
}
