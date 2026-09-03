'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clapperboard,
  ImageIcon,
  Link2,
  ListChecks,
  Printer,
  Target,
} from 'lucide-react';

import { LogoMark } from '@/components/brand/logo';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { ProgressBar } from '@/components/ui/progress';
import type { ProjectRow } from '@/lib/db/queries/types';
import type { ReportAsset } from '@/lib/db/queries/project-report';
import type { ProjectReport } from '@/lib/domain/project-report';
import {
  APP_NAME,
  CONTENT_KIND_LABEL,
  DIVISION_NAME,
  STATUS_META,
  type ContentKind,
  type TaskStatus,
} from '@/lib/domain/constants';
import { REPORT_KIND_LABEL, dayTitle } from '@/lib/domain/report-periods';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PROJECT REPORT SHEET — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"In each report make sure there is a little introduction at the top and always use
 * this AI and Digital DIVA icon in a proper format, like the logo. Use a proper
 * Daniyal Marketing introduction. Show these platforms and their icons… This is the
 * whole month or this week's target. This is achieved. This is remaining."*
 *
 * ── ⚠️ ONE SHEET FOR ALL FIVE KINDS ───────────────────────────────────────────
 * Today, yesterday, week, month and year differ only in their range and their
 * breakdown rows, and `reportPeriod` has already decided both. Five templates would
 * be five places for the branding and the arithmetic to drift — and the owner's own
 * descriptions differ only in what the rows are called ("Monday…", "Week 1…",
 * "August 2026"), which is exactly a bucket label.
 *
 * ── ⚠️ WHY THE FIGURES ARE NOT DRAWN BY AN IMAGE MODEL ────────────────────────
 * The owner asked for the report to be generated as images by the ChatGPT image API.
 * Image models render digits unreliably: a plausible, professional-looking sheet with
 * 22 rendered as 23 is worse than no report, because a client reads a PDF and nobody
 * re-checks it. So every number, table and bar here is rendered from the database by
 * `buildProjectReport` (17 tests). The concern was put to the owner in writing; if
 * they still want the model to draw the figures, this is the file that changes.
 *
 * ── PRINT IS THE PDF ────────────────────────────────────────────────────────
 * `globals.css §PRINT` already drops the chrome, forces ink-on-white and repeats table
 * headers across sheets. So "Save as PDF" in the print dialogue produces a real PDF of
 * exactly this page, with nothing to drift from it.
 * ========================================================================= */

export function ProjectReportSheet({
  project,
  report,
  assets,
  canSeeFinance,
  generatedOn,
  generatedBy,
}: {
  project: ProjectRow;
  report: ProjectReport;
  assets: readonly ReportAsset[];
  canSeeFinance: boolean;
  generatedOn: string;
  generatedBy: string;
}) {
  const { period } = report;
  const achievedPct =
    report.target > 0 ? Math.round((report.totalAssets / report.target) * 100) : null;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      {/* Controls — `print:hidden`, because a printed sheet with a Print button on it
          is obviously wrong and the stylesheet cannot know which elements are chrome. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 text-caption text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
          Back to {project.name}
        </Link>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-semibold text-text-on-brand shadow-[var(--shadow-brand-glow)]"
          style={{ backgroundImage: 'var(--gradient-brand)' }}
        >
          <Printer className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          Print or save as PDF
        </button>
      </div>

      {/* ══ THE SHEET ═══════════════════════════════════════════════════════ */}
      <article className="space-y-5 rounded-2xl border border-border-default bg-bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        {/* ---- Masthead ----
            The division's own mark, its name, and the period. Owner: *"always use this
            AI and Digital DIVA icon in a proper format, like the logo."* `LogoMark` is
            the existing brand component rather than a copy, so a rebrand reaches this
            sheet without anybody remembering it exists. */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border-default pb-4">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div>
              {/* ── ⚠️ `APP_NAME`, AND THIS REVERSES A DECISION FROM 2026-08-23 ──
                  The note beside `APP_NAME` in constants.ts says the organisation
                  constants "still label reports, which are sent to clients and must
                  carry the company's name, not the tool's" — and warns that changing
                  the wrong one would put "Taskly" on a client-facing document.

                  Owner, 2026-08-24, looking at exactly that: *"the Crescent Nova
                  International is written at the top of the report… instead of
                  writing this: my tool name, Taskly, over there. AI Digital Division
                  is fine."* So the earlier reasoning was mine, the reversal is
                  theirs, and it is deliberate rather than the mistake that note was
                  guarding against. `ORGANISATION_NAME` itself is untouched — the
                  sign-in page and the emails still carry it. */}
              <p className="text-body font-semibold leading-tight text-text-primary">
                {APP_NAME}
              </p>
              <p className="text-caption text-text-secondary">{DIVISION_NAME}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-micro font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              {REPORT_KIND_LABEL[period.kind]}
            </p>
            <p className="text-h3 font-semibold leading-tight text-text-primary">
              {period.label}
            </p>
          </div>
        </header>

        {/* ---- The introduction the owner asked for ---- */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h1 className="text-h2 font-semibold text-text-primary">{project.name}</h1>
            <span className="font-mono text-caption font-semibold text-text-tertiary">
              {project.code}
            </span>
          </div>

          {/* ⚠️ Assembled from the project's own facts, not written by a model. Every
              clause is a column, so it cannot describe a package that was not sold or a
              rhythm nobody agreed. */}
          <p className="max-w-[60rem] text-caption leading-relaxed text-text-secondary">
            {introduction(project, report, canSeeFinance)}
          </p>

          {project.platforms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {project.platforms.map((platform) => (
                <span
                  key={platform.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle py-1 pl-1 pr-2"
                >
                  <PlatformIcon slug={platform.slug} size={18} />
                  <span className="text-micro font-semibold text-text-secondary">
                    {platform.handle ?? platform.name}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ---- Target · achieved · remaining ---- */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Figure
            icon={Target}
            token="kpi-target"
            label="Target for this period"
            value={report.target}
            hint={
              report.offDays > 0
                ? `${report.offDays} off ${report.offDays === 1 ? 'day' : 'days'} excluded`
                : 'from the agreed rhythm'
            }
          />
          <Figure
            icon={ImageIcon}
            token="kpi-published"
            label="Achieved"
            value={report.totalAssets}
            hint={`${report.totalStatic} static · ${report.totalReels} reels`}
          />
          <Figure
            icon={Clapperboard}
            token="kpi-remaining"
            label="Remaining"
            value={report.remaining}
            hint={
              achievedPct === null
                ? 'no rhythm agreed'
                : `${achievedPct}% of the target met`
            }
          />
        </section>

        {achievedPct !== null && (
          <ProgressBar
            value={Math.min(achievedPct, 100)}
            token={achievedPct >= 100 ? 'kpi-published' : 'kpi-review'}
            size="lg"
            markerAt={100}
            label={`${achievedPct}% of the target for ${period.label}`}
          />
        )}

        {/* ---- The breakdown the owner described per kind ---- */}
        <section className="space-y-2">
          <h2 className="text-body-sm font-semibold text-text-primary">
            {period.granularity === 'day'
              ? 'Day by day'
              : period.granularity === 'week'
                ? 'Week by week'
                : 'Month by month'}
          </h2>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className={TH}>
                  {period.granularity === 'day'
                    ? 'Day'
                    : period.granularity === 'week'
                      ? 'Week'
                      : 'Month'}
                </th>
                <th className={TH_R}>Static</th>
                <th className={TH_R}>Reels</th>
                <th className={TH_R}>Total</th>
                <th className={TH_R}>Target</th>
                <th className={TH}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {report.buckets.map((bucket) => {
                const short = bucket.assets < bucket.target;
                const allOff = bucket.target === 0 && bucket.offDays > 0;

                return (
                  <tr key={bucket.key} className="border-b border-border-subtle last:border-0">
                    <td className={TD}>{bucket.label}</td>
                    <td className={TD_R}>{bucket.staticPosts}</td>
                    <td className={TD_R}>{bucket.reels}</td>
                    <td className={cn(TD_R, 'font-semibold text-text-primary')}>
                      {bucket.assets}
                    </td>
                    <td className={TD_R}>{bucket.target}</td>
                    <td className={TD}>
                      {/* ⚠️ An off day says so rather than showing a red 0-of-0. The
                          owner's standing rule: a Sunday with nothing on it must be
                          identifiable as a rest day, not as a miss. */}
                      {allOff ? (
                        <span className="text-micro text-text-tertiary">off</span>
                      ) : short ? (
                        <span
                          className="text-micro font-semibold"
                          style={{ color: 'var(--feedback-warning)' }}
                        >
                          {bucket.target - bucket.assets} short
                        </span>
                      ) : bucket.target > 0 ? (
                        <span
                          className="text-micro font-semibold"
                          style={{ color: 'var(--feedback-success)' }}
                        >
                          met
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* ---- Reach per platform ---- */}
        <section className="space-y-2">
          <h2 className="text-body-sm font-semibold text-text-primary">Where it went</h2>

          {report.platforms.length === 0 ? (
            <p className="text-caption text-text-secondary">
              No placements were recorded in this period.
            </p>
          ) : (
            <>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className={TH}>Platform</th>
                    <th className={TH_R}>Posts</th>
                    <th className={TH_R}>With a live link</th>
                  </tr>
                </thead>
                <tbody>
                  {report.platforms.map((platform) => (
                    <tr
                      key={platform.platformId}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className={TD}>
                        <span className="inline-flex items-center gap-2">
                          <PlatformIcon slug={platform.slug} size={18} />
                          <span className="font-semibold text-text-primary">
                            {platform.name}
                          </span>
                        </span>
                      </td>
                      <td className={TD_R}>{platform.placements}</td>
                      <td className={TD_R}>{platform.withLinks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="flex items-start gap-1.5 text-micro text-text-tertiary">
                <Link2 className="mt-px h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                One asset cross-posted to three platforms is one asset and three posts here,
                which is why these do not sum to the total above.
              </p>
            </>
          )}
        </section>

        {/* ---- Every asset, where the period is short enough to list them ----
            A day or a week is a readable list; a year of assets is not a report, it is
            a data dump, and the breakdown table above is the answer for those. */}
        {assets.length > 0 && assets.length <= 60 && (
          <section className="space-y-2">
            <h2 className="text-body-sm font-semibold text-text-primary">
              What went out
              <span className="ml-2 font-normal text-text-tertiary">{assets.length}</span>
            </h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-default">
                  <th className={TH}>Date</th>
                  <th className={TH}>Asset</th>
                  <th className={TH}>Kind</th>
                  <th className={TH}>By</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className="border-b border-border-subtle last:border-0">
                    <td className={cn(TD, 'whitespace-nowrap')}>{asset.publishedOn}</td>
                    <td className={cn(TD, 'font-medium text-text-primary')}>{asset.title}</td>
                    <td className={TD}>{asset.contentKind}</td>
                    <td className={TD}>{asset.assigneeName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* == ACTIVITY - WHAT WAS WORKED ON ==================================
            Owner, 2026-09-03: *"you will tell me how many tasks were created
            today, who created them, what task name, what their description is,
            what their category is, whether they are done or pending."*

            Everything above this line is DELIVERY - what went out, measured
            against the package. This is ACTIVITY, and the two are not the same
            report: a week where the team worked hard on things not yet
            published looks empty above and busy here, and both are true. */}
        <section className="space-y-2">
          <h2 className="text-body-sm font-semibold text-text-primary">
            Tasks raised
            <span className="ml-2 font-normal text-text-tertiary">{report.tasksCreated}</span>
          </h2>

          {report.tasksCreated === 0 ? (
            <p className="text-caption text-text-tertiary">
              No task was raised on this project during {period.label.toLowerCase()}.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {/* The sheet's own Figure, so these three read as the same kind
                    of thing as the delivery figures above rather than as a second
                    design that happens to sit on the same page. */}
                <Figure
                  icon={ListChecks}
                  token="text-brand"
                  label="Raised"
                  value={report.tasksCreated}
                  hint="in this period"
                />
                <Figure
                  icon={CheckCircle2}
                  token="feedback-success"
                  label="Done"
                  value={report.tasksDone}
                  hint="closed and signed off"
                />
                <Figure
                  icon={CircleDot}
                  token={report.tasksOpen > 0 ? 'feedback-warning' : 'text-brand'}
                  label="Still open"
                  value={report.tasksOpen}
                  hint={
                    report.tasksCancelled > 0
                      ? `${report.tasksCancelled} cancelled`
                      : 'nothing cancelled'
                  }
                />
              </div>

              {/* -- GROUPED BY THE PERIOD'S OWN BUCKETS --
                  Owner: *"what task has been done in this whole week, Monday,
                  Tuesday, Wednesday, and who does which task."* The grouping
                  reuses `period.buckets`, so a week reads Monday-to-Sunday and a
                  month reads week-by-week without this component knowing which it
                  is looking at. A day report has one bucket and reads as a plain
                  list, which is correct rather than a special case. */}
              <div className="space-y-3">
                {report.taskDays
                  .filter((day) => day.tasks.length > 0)
                  .map((day) => (
                    <div key={day.key} className="space-y-1.5">
                      <p className="flex flex-wrap items-baseline gap-2 text-caption font-semibold text-text-primary">
                        {day.label}
                        <span className="font-normal text-text-tertiary">
                          {day.tasks.length} raised &middot; {day.done} done &middot; {day.open} open
                        </span>
                      </p>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-border-default">
                            <th className={TH}>Task</th>
                            <th className={TH}>Category</th>
                            <th className={TH}>Raised by</th>
                            <th className={TH}>Doing it</th>
                            <th className={TH}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {day.tasks.map((task) => (
                            <tr
                              key={task.id}
                              className="border-b border-border-subtle last:border-0"
                            >
                              <td className={TD}>
                                <span className="font-medium text-text-primary">{task.title}</span>
                                <span className="ml-2 font-mono text-micro text-text-tertiary">
                                  {task.reference}
                                </span>
                                {task.description && (
                                  /* Truncated rather than dropped. A description is
                                     often the only place the actual brief is
                                     written, and a report that omitted it would
                                     send the reader back to the board. */
                                  <span className="mt-0.5 block max-w-[28rem] truncate text-micro text-text-secondary">
                                    {task.description}
                                  </span>
                                )}
                              </td>
                              <td className={TD}>
                                {task.contentKind
                                  ? CONTENT_KIND_LABEL[task.contentKind as ContentKind]
                                  : 'General work'}
                              </td>
                              <td className={TD}>{task.createdByName ?? '—'}</td>
                              <td className={TD}>{task.assigneeName ?? 'Unassigned'}</td>
                              <td className={TD}>
                                <StatusPill status={task.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </div>
            </>
          )}
        </section>

        {/* == THE READING ====================================================
            Owner: *"the target is this one: achieve this one, left this one, you
            are lagging, you are completing your own time, you are progressing.
            Any suggestion should be mentioned below."*

            Last on the sheet on purpose: a conclusion belongs after its
            evidence, and a reader who disagrees with it has just passed every
            figure it was drawn from. */}
        <section
          className="space-y-2 rounded-xl border p-4"
          style={{
            borderColor: `color-mix(in oklab, var(--${VERDICT_TOKEN[report.verdict.tone]}) 35%, transparent)`,
            backgroundColor: `color-mix(in oklab, var(--${VERDICT_TOKEN[report.verdict.tone]}) var(--tint-soft), var(--bg-surface))`,
          }}
        >
          <p
            className="text-body-sm font-semibold"
            style={{
              color: `color-mix(in oklab, var(--${VERDICT_TOKEN[report.verdict.tone]}) 84%, var(--text-primary))`,
            }}
          >
            {report.verdict.headline}
          </p>

          {report.monthlyPromise !== null && (
            <p className="text-caption text-text-secondary">
              The agreed monthly promise for {project.name} is{' '}
              <span className="font-semibold text-text-primary">
                {report.monthlyPromise} assets
              </span>
              . This period&rsquo;s share of it is {report.target}.
            </p>
          )}

          {report.verdict.suggestions.length > 0 && (
            <ul className="space-y-1 pt-1">
              {report.verdict.suggestions.map((line) => (
                <li key={line} className="flex items-start gap-2 text-caption text-text-secondary">
                  <span
                    aria-hidden="true"
                    className="mt-[0.45em] size-1 shrink-0 rounded-full bg-current"
                  />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Provenance ---- */}
        <footer className="space-y-1 border-t border-border-subtle pt-4 text-micro text-text-tertiary">
          <p>
            Generated on {dayTitle(generatedOn)} by {generatedBy} from{' '}
            {DIVISION_NAME}&rsquo;s own records. An asset counts in the period it was{' '}
            <em>published</em>, not the period it was finished. Reels are counted inside
            the asset total rather than on top of it. The target is calculated from the
            agreed posting rhythm across the days this period actually contains, so rest
            days carry no target.
          </p>
        </footer>
      </article>
    </div>
  );
}

/**
 * The introduction, assembled from the project's own columns.
 *
 * ⚠️ Not written by a language model. Every clause here is a database value, so the
 * paragraph cannot describe a package that was not sold, a platform the project does
 * not manage, or a rhythm nobody agreed. A model could phrase it more warmly and would
 * occasionally phrase it wrongly, on a page a client reads.
 */
function introduction(
  project: ProjectRow,
  report: ProjectReport,
  canSeeFinance: boolean,
): string {
  const parts: string[] = [];

  parts.push(
    `${project.name} is ${
      project.clientKind === 'internal'
        ? 'an internal engagement within the Attari Group'
        : project.clientKind === 'external'
          ? 'an external client engagement'
          : 'a project'
    }${project.packageName ? ` on the ${project.packageName} package` : ''}${
      project.clientName ? `, for ${project.clientName}` : ''
    }.`,
  );

  if (project.platforms.length > 0) {
    parts.push(
      `The division manages ${project.platforms.length} ${
        project.platforms.length === 1 ? 'platform' : 'platforms'
      } for it — ${project.platforms.map((p) => p.name).join(', ')}.`,
    );
  }

  const rhythm: string[] = [];
  if (project.staticPostsPerDay !== null) {
    rhythm.push(
      project.staticPostsPerDay === 0
        ? 'no daily posts'
        : `${project.staticPostsPerDay} static ${project.staticPostsPerDay === 1 ? 'post' : 'posts'} a day`,
    );
  }
  if (project.reelsPerWeek !== null && project.reelsPerWeek > 0) {
    rhythm.push(`${project.reelsPerWeek} ${project.reelsPerWeek === 1 ? 'reel' : 'reels'} a week`);
  }
  if (rhythm.length > 0) parts.push(`The agreed rhythm is ${rhythm.join(' and ')}.`);

  if (canSeeFinance && project.monthlyFeePkr !== null) {
    parts.push(`The recurring monthly fee is PKR ${project.monthlyFeePkr.toLocaleString('en-PK')}.`);
  }

  parts.push(
    report.isEmpty
      ? `Nothing was published in ${report.period.label}.`
      : `${report.totalAssets} ${report.totalAssets === 1 ? 'asset' : 'assets'} went out in ${report.period.label} against a target of ${report.target}.`,
  );

  return parts.join(' ');
}

function Figure({
  icon: Icon,
  token,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  token: string;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border-subtle p-3.5">
      <p className="flex items-center gap-1.5 text-micro font-semibold text-text-secondary">
        <Icon
          className="h-3.5 w-3.5 shrink-0"
          strokeWidth={2.25}
          aria-hidden="true"
        />
        {label}
      </p>
      <p
        className="mt-0.5 tabular-nums text-h1 font-semibold leading-tight"
        style={{ color: `var(--${token})` }}
      >
        {value}
      </p>
      <p className="text-micro text-text-tertiary">{hint}</p>
    </div>
  );
}

const TH =
  'px-2.5 py-2 text-left text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary';
const TH_R = `${TH} text-right`;
/* ⚠️ `align-middle`, not `align-top`. Every cell in these tables is one line, and
   top-aligning single-line content in a taller row leaves the numbers floating
   above the label they belong to — which is half of why the rows read as
   congested even after the padding grew. */
const TD = 'px-2.5 py-2.5 align-middle text-caption text-text-secondary';
const TD_R = `${TD} text-right tabular-nums`;

/* ----------------------------------------------------------------------------
 * THE VERDICT'S COLOUR
 * ----------------------------------------------------------------------------
 * Semantic tokens, not literal colours, so the panel means the same thing in
 * both themes and moves with the palette. `untargeted` is deliberately NEUTRAL:
 * a project with no agreed rhythm is neither passing nor failing, and painting
 * it amber would invent a problem the client never signed up to.
 * ------------------------------------------------------------------------- */
const VERDICT_TOKEN: Readonly<Record<string, string>> = {
  ahead: 'feedback-success',
  on_track: 'feedback-success',
  behind: 'feedback-warning',
  untargeted: 'border-default',
};

/** A task's status, in the same colours the boards use for it. */
function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status as TaskStatus];
  if (!meta) return <span className="text-text-tertiary">{status}</span>;

  return (
    <span
      className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${meta.token}) var(--tint-medium), var(--bg-surface))`,
        color: `color-mix(in oklab, var(--${meta.token}) 84%, var(--text-primary))`,
      }}
    >
      {meta.label}
    </span>
  );
}
