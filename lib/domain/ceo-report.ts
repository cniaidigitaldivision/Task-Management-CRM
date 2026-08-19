import { projectProgress, type Progress, type ProgressVerdict } from './project-progress';

/* ============================================================================
 * THE CEO REPORT, SHAPED — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Compute a report, send it to ChatGPT to make it presentable, and give me a
 * PDF I can download."*
 *
 * Pure by contract: no clock, no database, no network. Figures in, a finished
 * report model out. Which is what makes the arithmetic testable, and what lets the
 * fact sheet sent to the model be asserted on in a test rather than hoped about.
 *
 * ── ⚠️ THE DIVISION OF LABOUR WITH THE MODEL ──────────────────────────────────
 * This module computes EVERY number. The language model receives them already
 * totalled, in `factSheet`, and is asked for prose only. It is never asked to add,
 * subtract, rank or average anything.
 *
 * That is not fussiness. An LLM asked to total a column is occasionally wrong and
 * always fluent, so the error arrives wearing the same confident voice as the
 * truth. On a page the CEO forwards to a client, an invented figure is worse than
 * no report. The model is a writer here, not an accountant.
 *
 * The same reasoning rules out having an image model DRAW the report: image models
 * render digits unreliably, so a generated "dashboard" would show plausible,
 * wrong numbers in a form nobody would think to check. The figures and charts are
 * rendered by us, from these values.
 *
 * ── WHY A FACT SHEET RATHER THAN THE RAW ROWS ─────────────────────────────────
 * Handing over JSON invites the model to re-derive things — to re-count, re-rank,
 * and to mention a field we never meant to publish. The fact sheet is a closed
 * account of what is true, written as sentences, so the model's job collapses to
 * interpretation. It also keeps the prompt small and free of ids.
 * ========================================================================= */

export interface ReportProject {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly clientKind: 'internal' | 'external' | null;
  readonly clientName: string | null;
  readonly packageName: string | null;
  readonly ownerName: string | null;
  readonly monthlyFeePkr: number | null;
  readonly assetsTargetMin: number | null;
  readonly assetsTargetMax: number | null;
  readonly reelsTargetMin: number | null;
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  readonly team: readonly string[];
  readonly platforms: readonly string[];
  readonly liveLinks: number;
}

export interface ReportPerson {
  readonly name: string;
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  readonly projectCount: number;
}

export interface ReportPlatform {
  readonly name: string;
  readonly placements: number;
  readonly withLinks: number;
}

export interface ReportInput {
  readonly monthStart: string;
  readonly projects: readonly ReportProject[];
  readonly people: readonly ReportPerson[];
  readonly platforms: readonly ReportPlatform[];
}

/** A project with its verdict attached. */
export interface ReportLine {
  readonly project: ReportProject;
  readonly progress: Progress;
}

export interface ReportTotals
{
  readonly projectCount: number;
  readonly internalCount: number;
  readonly externalCount: number;
  /**
   * Projects with no `client_kind` recorded.
   *
   * ⚠️ Reported rather than folded into either side. Found on real data: 7 active
   * projects showed a hint of "0 internal · 1 external", because six had never been
   * classified — the two figures were each correct and together they described less
   * than the total, which reads as a bug in the report. Defaulting the unknowns to
   * external would have been worse: it would state something about a client
   * relationship that nobody recorded.
   */
  readonly unclassifiedCount: number;
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  /** Summed minimums, over projects that HAVE one. See the note below. */
  readonly assetsCommitted: number;
  /** How many projects contributed to `assetsCommitted`. Without this the
   *  committed figure is unreadable — 40 committed across 3 of 9 projects is a
   *  different story from 40 across all 9. */
  readonly projectsWithTargets: number;
  readonly monthlyRevenuePkr: number;
  /** Projects with no fee recorded, so a revenue total can say what it omits. */
  readonly projectsWithoutFee: number;
  readonly liveLinks: number;
  readonly placements: number;
  readonly peopleActive: number;
}

export interface ReportModel {
  readonly monthStart: string;
  readonly monthLabel: string;
  readonly lines: readonly ReportLine[];
  readonly totals: ReportTotals;
  readonly byVerdict: Readonly<Record<ProgressVerdict, number>>;
  /** Projects needing attention, worst first — the CEO's actual reading list. */
  readonly attention: readonly ReportLine[];
  readonly people: readonly ReportPerson[];
  readonly platforms: readonly ReportPlatform[];
  /** Exactly what the language model is told. Nothing else reaches it. */
  readonly factSheet: string;
  /** True when there is nothing to report on, so the page can say so plainly
   *  instead of rendering a wall of zeroes and asking a model to explain them. */
  readonly isEmpty: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * 'YYYY-MM-01' → 'August 2026'.
 *
 * ⚠️ Parsed by hand rather than with `new Date(s)`. A date-only string is treated
 * as UTC midnight, so in any timezone behind UTC `getMonth()` returns the PREVIOUS
 * month and the report would be titled July while containing August. `lib/now.ts`
 * documents this trap; this is the same one.
 */
export function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split('-');
  const index = Number(m) - 1;
  return index >= 0 && index < 12 ? `${MONTHS[index]} ${y}` : monthStart;
}

/* ----------------------------------------------------------------------------
 * WHICH MONTH
 * ----------------------------------------------------------------------------
 * `now` is passed in, never read — doc 20 §5 forbids a clock in `lib/domain/`, and
 * it is what makes these testable against a fixed instant.
 *
 * These live here rather than beside the server action for a second reason as
 * well: a `'use server'` module may only export async functions, so a synchronous
 * helper exported from one fails the build. The month picker is a client component
 * and needs them, which is the same rule as `lib/domain/library.ts`.
 * ------------------------------------------------------------------------- */

/**
 * The month we are in, as 'YYYY-MM-01'.
 *
 * ⚠️ UTC parts, deliberately. Local parts would make the default month depend on
 * where the server happens to run — a click at 01:00 on the 1st in Karachi would
 * report a different month than the same click on a US host. The SQL compares
 * against `date` columns, which have no timezone either.
 */
export function currentMonthStart(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-01`;
}

/** The last `count` months, newest first, for the period picker. */
export function recentMonths(now: number, count = 12): string[] {
  const date = new Date(now);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth(); // 0-based

  const months: string[] = [];
  for (let i = 0; i < count; i += 1) {
    months.push(`${year}-${String(month + 1).padStart(2, '0')}-01`);
    /* Walked back a month at a time rather than with date arithmetic: setting a
       Date back one month from the 31st lands in the wrong month entirely, and
       this only ever needs the year and the month. */
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return months;
}

/** Guards the value coming back from the picker before it reaches a query. */
export const MONTH_START_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** Worst first. Ordered by how much explaining the CEO will have to do. */
const ATTENTION_ORDER: Readonly<Record<ProgressVerdict, number>> = {
  behind: 0,
  short_on_reels: 1,
  exceeded: 2,
  untargeted: 3,
  met: 4,
};

export function buildReport(input: ReportInput): ReportModel {
  const lines: ReportLine[] = input.projects.map((project) => ({
    project,
    progress: projectProgress({
      assetsPublished: project.assetsPublished,
      reelsPublished: project.reelsPublished,
      assetsTargetMin: project.assetsTargetMin,
      assetsTargetMax: project.assetsTargetMax,
      reelsTargetMin: project.reelsTargetMin,
    }),
  }));

  const byVerdict: Record<ProgressVerdict, number> = {
    untargeted: 0, met: 0, exceeded: 0, short_on_reels: 0, behind: 0,
  };
  for (const line of lines) byVerdict[line.progress.verdict] += 1;

  /* ⚠️ Only projects WITH a minimum contribute to the committed total. Counting a
     null minimum as 0 would quietly inflate the delivery rate: a PERFORMANCE
     project on "up to 75, no floor" would appear to have met a commitment of
     nothing, which is true and useless. */
  const targeted = lines.filter((l) => l.project.assetsTargetMin !== null);

  const totals: ReportTotals = {
    projectCount: lines.length,
    internalCount: lines.filter((l) => l.project.clientKind === 'internal').length,
    externalCount: lines.filter((l) => l.project.clientKind === 'external').length,
    unclassifiedCount: lines.filter((l) => l.project.clientKind === null).length,
    assetsPublished: sum(lines, (l) => l.project.assetsPublished),
    reelsPublished: sum(lines, (l) => l.project.reelsPublished),
    assetsCommitted: sum(targeted, (l) => l.project.assetsTargetMin ?? 0),
    projectsWithTargets: targeted.length,
    monthlyRevenuePkr: sum(lines, (l) => l.project.monthlyFeePkr ?? 0),
    projectsWithoutFee: lines.filter((l) => l.project.monthlyFeePkr === null).length,
    liveLinks: sum(lines, (l) => l.project.liveLinks),
    placements: input.platforms.reduce((t, p) => t + p.placements, 0),
    peopleActive: input.people.length,
  };

  const attention = lines
    .filter((l) => l.progress.verdict === 'behind' || l.progress.verdict === 'short_on_reels')
    .sort((a, b) => {
      const order = ATTENTION_ORDER[a.progress.verdict] - ATTENTION_ORDER[b.progress.verdict];
      if (order !== 0) return order;
      /* Then by how far behind, so the biggest gap leads. */
      return (
        b.progress.assetsRemaining + b.progress.reelsRemaining -
        (a.progress.assetsRemaining + a.progress.reelsRemaining)
      );
    });

  const label = monthLabel(input.monthStart);

  return {
    monthStart: input.monthStart,
    monthLabel: label,
    lines,
    totals,
    byVerdict,
    attention,
    people: input.people,
    platforms: input.platforms,
    factSheet: factSheet(label, lines, totals, attention, input),
    isEmpty: lines.length === 0,
  };
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/** PKR, grouped, no decimals — fees are whole rupees. Locale passed explicitly:
 *  an argless `toLocaleString()` renders differently on the server and the client
 *  and React reports a hydration mismatch. */
export function pkr(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK')}`;
}

/* ----------------------------------------------------------------------------
 * THE FACT SHEET
 * ----------------------------------------------------------------------------
 * Every figure the model may refer to, already computed, in sentences. Written
 * here rather than in the API module so a test can assert that a project which is
 * behind is described as behind, without a network call.
 * ------------------------------------------------------------------------- */
function factSheet(
  label: string,
  lines: readonly ReportLine[],
  totals: ReportTotals,
  attention: readonly ReportLine[],
  input: ReportInput,
): string {
  const out: string[] = [];

  out.push(`REPORTING PERIOD: ${label}`);
  out.push('');
  out.push('DIVISION TOTALS');
  out.push(
    `- Active projects: ${totals.projectCount} (${totals.internalCount} internal, ${totals.externalCount} external client work` +
      (totals.unclassifiedCount > 0
        ? `, ${totals.unclassifiedCount} not yet classified as either)`
        : ')'),
  );
  out.push(`- Content assets published: ${totals.assetsPublished}, of which ${totals.reelsPublished} were reels`);
  out.push(
    totals.projectsWithTargets > 0
      ? `- Contracted minimum across the ${totals.projectsWithTargets} project(s) that have one: ${totals.assetsCommitted} assets`
      : '- No project has a contracted monthly minimum recorded',
  );
  out.push(`- Individual platform placements: ${totals.placements}, of which ${totals.liveLinks} carry a verifiable live link`);
  out.push(
    totals.projectsWithoutFee > 0
      ? `- Recurring monthly fees: ${pkr(totals.monthlyRevenuePkr)} (${totals.projectsWithoutFee} project(s) have no fee recorded and are excluded)`
      : `- Recurring monthly fees: ${pkr(totals.monthlyRevenuePkr)}`,
  );
  out.push(`- Team members who published something: ${totals.peopleActive}`);
  out.push('');

  out.push('PER PROJECT');
  if (lines.length === 0) {
    out.push('- No active projects.');
  }
  for (const { project, progress } of lines) {
    const bits: string[] = [];
    bits.push(`- ${project.name} (${project.code})`);
    /* ⚠️ THREE cases, not two. `clientKind === 'internal' ? 'internal' : 'external'`
       was here first and labelled every UNCLASSIFIED project as external — so a
       division with one real client and six unclassified projects described itself
       to the model as seven external client engagements. Caught on real data, where
       the totals line said "6 not yet classified" while every project line beneath
       it said "external". The model is entitled to trust this sheet; a default that
       invents a client relationship is the worst kind of thing to put in it. */
    bits.push(
      project.clientKind === 'internal'
        ? 'internal'
        : project.clientKind === 'external'
          ? 'external'
          : 'internal or external not recorded',
    );
    if (project.clientName) bits.push(`client: ${project.clientName}`);
    if (project.packageName) bits.push(`package: ${project.packageName}`);
    if (project.ownerName) bits.push(`owned by ${project.ownerName}`);
    bits.push(`published ${project.assetsPublished} assets (${project.reelsPublished} reels)`);
    bits.push(`status: ${progress.verdict.replace(/_/g, ' ')} — ${progress.summary}`);
    if (project.platforms.length > 0) bits.push(`platforms: ${project.platforms.join(', ')}`);
    if (project.team.length > 0) bits.push(`team: ${project.team.join(', ')}`);
    out.push(bits.join(' | '));
  }
  out.push('');

  out.push('NEEDS ATTENTION (already ranked worst first — keep this order)');
  if (attention.length === 0) {
    out.push('- Nothing is behind this period.');
  }
  for (const { project, progress } of attention) {
    out.push(`- ${project.name}: ${progress.summary}`);
  }
  out.push('');

  out.push('PER PERSON (already ranked by volume — keep this order)');
  if (input.people.length === 0) out.push('- Nobody published anything in this period.');
  for (const p of input.people) {
    out.push(`- ${p.name}: ${p.assetsPublished} assets (${p.reelsPublished} reels) across ${p.projectCount} project(s)`);
  }
  out.push('');

  out.push('PER PLATFORM (already ranked — keep this order)');
  if (input.platforms.length === 0) out.push('- No placements recorded in this period.');
  for (const p of input.platforms) {
    out.push(`- ${p.name}: ${p.placements} placements, ${p.withLinks} with live links`);
  }

  return out.join('\n');
}
