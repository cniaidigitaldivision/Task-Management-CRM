'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  FileText,
  Layers,
  Link2,
  Printer,
  Sparkles,
  Users,
} from 'lucide-react';

import { ceoNarrativeAction, ceoReportAction } from '@/app/actions/ceo-report';
import type { Narrative } from '@/lib/ai/narrative';
import {
  monthLabel,
  pkr,
  type ReportModel,
} from '@/lib/domain/ceo-report';
import { VERDICT_LABEL, VERDICT_TOKEN } from '@/lib/domain/project-progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { LabelledSelect } from '@/components/ui/select';
import { ProgressBar, SegmentedBar, SegmentLegend, type Segment } from '@/components/ui/progress';
import { StatCard } from '@/components/ui/metric';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CEO REPORT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Compute a report, send it to ChatGPT to make it presentable, and give me a PDF
 * I can download."*
 *
 * ── ⚠️ WHO WROTE WHAT, AND WHY THE PAGE SAYS SO ───────────────────────────────
 * Every figure, table and bar on this page is computed from the database by
 * `lib/domain/ceo-report.ts`. The only thing the language model contributes is the
 * prose in the Analysis card, and that card is labelled as such.
 *
 * The reader is the CEO, and this page will be forwarded to clients. Somebody
 * looking at it has to be able to tell which parts are arithmetic and which are a
 * machine's opinion — otherwise the opinion inherits the authority of the
 * arithmetic. Hence the provenance note at the foot, and hence the model never
 * being asked for a number.
 *
 * ── AND WHY NO GENERATED IMAGE ────────────────────────────────────────────────
 * An image model was the obvious reading of "make it presentable", and it is the
 * wrong one: image models render digits unreliably, so a generated dashboard would
 * look finished and be wrong in the one way nobody would check. The charts here are
 * SVG driven by the real values.
 *
 * ── THE PDF IS THE BROWSER'S ─────────────────────────────────────────────────
 * Same decision as the rest of `/reports` (globals.css §PRINT): the print
 * stylesheet already turns this page into ink-on-white, drops the chrome, repeats
 * table headers across sheets and refuses to split rows. "Save as PDF" in the print
 * dialogue is therefore a real PDF of the real page, with no second renderer to
 * drift from this one and no PDF engine to carry.
 * ========================================================================= */

export function CeoReportWorkspace({
  initialReport,
  months,
  canAnalyse,
}: {
  initialReport: ReportModel;
  months: readonly string[];
  /** False when no OpenAI key is set — the button explains itself rather than
   *  being offered and then failing. */
  canAnalyse: boolean;
}) {
  const [report, setReport] = React.useState(initialReport);
  const [month, setMonth] = React.useState(initialReport.monthStart);
  const [narrative, setNarrative] = React.useState<Narrative | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingFigures, startFigures] = React.useTransition();
  const [composing, setComposing] = React.useState(false);

  function chooseMonth(next: string) {
    setMonth(next);
    setError(null);
    /* ⚠️ The commentary is dropped the moment the period changes. Leaving last
       month's prose above this month's figures would be the worst possible
       failure of this screen: an analysis that reads as current and describes
       something else. */
    setNarrative(null);

    startFigures(async () => {
      const result = await ceoReportAction(next);
      if (result.ok) setReport(result.report);
      else setError(result.error);
    });
  }

  async function compose() {
    setComposing(true);
    setError(null);
    try {
      const result = await ceoNarrativeAction(report.monthStart);
      if (result.ok) setNarrative(result.narrative);
      else setError(result.error);
    } finally {
      setComposing(false);
    }
  }

  const { totals, byVerdict } = report;

  /* The verdict mix, as one bar. Ordered best to worst so the shape of the month
     is readable before any label is. */
  const segments: Segment[] = (
    [
      ['met', 'On target'],
      ['exceeded', 'Over ceiling'],
      ['untargeted', 'No target'],
      ['short_on_reels', 'Short on reels'],
      ['behind', 'Behind'],
    ] as const
  )
    .map(([key, label]) => ({
      key,
      label,
      value: byVerdict[key],
      token: VERDICT_TOKEN[key],
    }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      {/* ── Controls. `print:hidden` because a paper report with a dropdown on it
             is obviously wrong, and the print stylesheet cannot know which
             elements are controls. ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <LabelledSelect
          caption="Period"
          id="ceo-report-month"
          aria-label="Reporting month"
          value={month}
          disabled={loadingFigures}
          onChange={(event) => chooseMonth(event.target.value)}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
        />

        <span className="flex-1" />

        <Button
          type="button"
          variant="primary"
          onClick={compose}
          disabled={!canAnalyse || composing || loadingFigures || report.isEmpty}
          title={
            canAnalyse
              ? 'Send the computed figures to OpenAI and get the written analysis back'
              : 'Set CHATGPT_API_KEY to enable the written analysis'
          }
        >
          <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {composing
            ? 'Composing…'
            : narrative
              ? 'Compose again'
              : 'Compose the written analysis'}
        </Button>

        <Button type="button" variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Print or save as PDF
        </Button>
      </div>

      {error && (
        <Card>
          <CardBody className="flex items-start gap-3 p-4">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--feedback-warning)]"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <p className="text-caption text-text-secondary">{error}</p>
          </CardBody>
        </Card>
      )}

      {/* ── The title block. On paper this is the report's masthead, which is why
             it is not in the page header that print removes. ─────────────────── */}
      <div className="space-y-1 border-b border-border-subtle pb-4">
        <p className="text-micro font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          Crescent Nova International · AI &amp; Digital Division
        </p>
        <h2 className="text-h2 font-semibold text-text-primary">
          Monthly performance report — {report.monthLabel}
        </h2>
      </div>

      {report.isEmpty ? (
        <Card>
          <CardBody className="px-6 py-12 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              No active projects in {report.monthLabel}
            </p>
            <p className="mx-auto mt-1 max-w-[36rem] text-caption text-text-secondary">
              Nothing was running in this period, so there is nothing to report. Archived and
              cancelled projects are left out on purpose — a report about work that stopped is a
              different question.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <section
            className={cn(
              'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
              loadingFigures && 'opacity-60',
            )}
          >
            <StatCard
              label="Active projects"
              value={totals.projectCount}
              icon={Building2}
              token="accent-primary"
              /* ⚠️ The unclassified count is shown, not hidden. Seven projects
                 above "0 internal · 1 external" reads as a broken report; six of
                 them simply had no client kind recorded, and saying so is both
                 true and the prompt to go and fix it. */
              hint={
                totals.unclassifiedCount > 0
                  ? `${totals.internalCount} internal · ${totals.externalCount} external · ${totals.unclassifiedCount} unclassified`
                  : `${totals.internalCount} internal · ${totals.externalCount} external`
              }
            />
            <StatCard
              label="Assets published"
              value={totals.assetsPublished}
              icon={Layers}
              token="accent-gold"
              hint={
                totals.projectsWithTargets > 0
                  ? `${totals.reelsPublished} reels · ${totals.assetsCommitted} committed across ${totals.projectsWithTargets} project${totals.projectsWithTargets === 1 ? '' : 's'}`
                  : `${totals.reelsPublished} reels · no contracted minimums recorded`
              }
            />
            <StatCard
              label="Placements with live links"
              value={totals.liveLinks}
              icon={Link2}
              token="feedback-info"
              /* The owner's stated reason for placements existing at all: *"he can
                 click on that link and directly go to that exact post."* So the
                 figure that matters is how much of it is actually verifiable. */
              hint={`of ${totals.placements} total placements`}
            />
            <StatCard
              label="Recurring monthly fees"
              value={pkr(totals.monthlyRevenuePkr)}
              icon={FileText}
              token="feedback-success"
              hint={
                totals.projectsWithoutFee > 0
                  ? `${totals.projectsWithoutFee} project${totals.projectsWithoutFee === 1 ? '' : 's'} with no fee recorded, excluded`
                  : 'every active project has a fee recorded'
              }
            />
          </section>

          {segments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Where the projects stand</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 p-4 pt-0">
                <SegmentedBar segments={segments} height="h-3" />
                <SegmentLegend segments={segments} />
                <p className="text-micro text-text-tertiary">
                  A project on an &ldquo;up to N&rdquo; package has no monthly floor, so it is
                  shown as having no target rather than as behind — it cannot miss something it
                  was never promised.
                </p>
              </CardBody>
            </Card>
          )}

          {/* ── The model's contribution, clearly fenced ────────────────────── */}
          <NarrativeCard
            narrative={narrative}
            composing={composing}
            canAnalyse={canAnalyse}
          />

          {report.attention.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Needs a decision</CardTitle>
              </CardHeader>
              <CardBody className="p-4 pt-0">
                <ul className="space-y-2">
                  {report.attention.map(({ project, progress }) => (
                    <li
                      key={project.id}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-subtle pb-2 last:border-0 last:pb-0"
                    >
                      <span className="text-body-sm font-semibold text-text-primary">
                        {project.name}
                      </span>
                      <Badge token={VERDICT_TOKEN[progress.verdict]} size="sm" variant="outline">
                        {VERDICT_LABEL[progress.verdict]}
                      </Badge>
                      <span className="text-caption text-text-secondary">{progress.summary}</span>
                      {project.ownerName && (
                        <span className="text-micro text-text-tertiary">
                          owner: {project.ownerName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <ProjectTable report={report} />

          <div className="grid gap-4 lg:grid-cols-2">
            <PeopleTable report={report} />
            <PlatformTable report={report} />
          </div>

          <Provenance report={report} narrative={narrative} />
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * THE ANALYSIS
 * ----------------------------------------------------------------------------
 * ⚠️ Fenced and labelled on purpose. Everything else on the page is arithmetic;
 * this is a model's reading of it. Presenting the two identically would lend the
 * reading the authority of the arithmetic, and this page gets forwarded.
 * ------------------------------------------------------------------------- */
function NarrativeCard({
  narrative,
  composing,
  canAnalyse,
}: {
  narrative: Narrative | null;
  composing: boolean;
  canAnalyse: boolean;
}) {
  if (composing) {
    return (
      <Card>
        <CardBody className="p-4">
          <p className="text-caption text-text-secondary">
            Composing the analysis from the figures above…
          </p>
          <div className="mt-3 space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-bg-active"
                style={{ width: `${92 - i * 14}%` }}
              />
            ))}
          </div>
        </CardBody>
      </Card>
    );
  }

  /* Not yet asked for. The card is still rendered, so the page does not visibly
     rearrange itself when the analysis arrives — and on paper it explains its own
     absence rather than leaving a gap. */
  if (!narrative) {
    return (
      <Card>
        <CardBody className="p-4">
          <p className="text-body-sm font-semibold text-text-primary">Written analysis</p>
          <p className="mt-1 max-w-[52rem] text-caption text-text-secondary">
            {canAnalyse
              ? 'Not composed yet. The figures on this page are complete without it — the analysis adds a written reading of them, generated from these same totals.'
              : 'Unavailable: no OpenAI key is configured. Every figure on this page is computed here and is unaffected.'}
          </p>
        </CardBody>
      </Card>
    );
  }

  const section = (title: string, items: readonly string[]) =>
    items.length > 0 && (
      <div className="space-y-1.5">
        <h4 className="text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          {title}
        </h4>
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-caption text-text-secondary">
              <span aria-hidden="true" className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Written analysis
          <Badge token="accent-gold" size="sm" variant="outline">
            generated by {narrative.model}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4 p-4 pt-0">
        <p className="text-body-sm font-semibold text-text-primary">{narrative.headline}</p>

        {narrative.summary.map((paragraph, i) => (
          <p key={i} className="max-w-[58rem] text-caption leading-relaxed text-text-secondary">
            {paragraph}
          </p>
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          {section('Going well', narrative.strengths)}
          {section('Risks', narrative.risks)}
          {section('Recommended', narrative.recommendations)}
        </div>

        {/* ── ⚠️ The check that makes the rest of this card safe to read ──────
               The prompt tells the model not to compute. `verifyFigures()` reads
               the prose back and reports any figure that is not in the fact sheet.
               When it finds one, the reader is told rather than the warning being
               kept in a log they will never see. */}
        {narrative.unverifiedFigures.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--feedback-warning)] bg-bg-subtle p-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--feedback-warning)]"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <p className="text-caption text-text-secondary">
              <span className="font-semibold text-text-primary">
                Check these figures before sending this on:
              </span>{' '}
              the analysis mentions {narrative.unverifiedFigures.join(', ')}, which does not appear
              in the computed totals. The model was asked not to calculate anything; treat any
              sentence containing those as unverified. The tables on this page are unaffected.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-micro text-text-tertiary">
            <BadgeCheck
              className="h-3.5 w-3.5 shrink-0 text-[var(--feedback-success)]"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            Every figure in this analysis was checked against the computed totals.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------------------
 * THE TABLES
 * ------------------------------------------------------------------------- */
const TH =
  'px-3 py-2 text-left text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary';
const TD = 'px-3 py-2 align-top text-caption text-text-secondary';

function ProjectTable({ report }: { report: ReportModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Every project this period</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {/* ⚠️ The scroller is on this wrapper, not on `main`. An `overflow` on an
            ancestor makes it the containing block for any `position: fixed`
            descendant — which is what broke the task board's drag ghost. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className={TH}>Project</th>
                <th className={TH}>Client</th>
                <th className={TH}>Package</th>
                <th className={TH}>Published</th>
                <th className={TH}>Target</th>
                <th className={TH}>Progress</th>
                <th className={TH}>Team</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map(({ project, progress }) => (
                <tr key={project.id} className="border-b border-border-subtle last:border-0">
                  <td className={TD}>
                    <span className="font-semibold text-text-primary">{project.name}</span>
                    <span className="ml-1.5 text-micro text-text-tertiary">{project.code}</span>
                    {project.platforms.length > 0 && (
                      <p className="mt-0.5 text-micro text-text-tertiary">
                        {project.platforms.join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className={TD}>
                    {project.clientName ?? (
                      <span className="text-text-tertiary">
                        {project.clientKind === 'internal' ? 'Internal' : '—'}
                      </span>
                    )}
                  </td>
                  <td className={TD}>{project.packageName ?? <span className="text-text-tertiary">—</span>}</td>
                  <td className={cn(TD, 'whitespace-nowrap')}>
                    <span className="font-semibold text-text-primary">{project.assetsPublished}</span>
                    <span className="text-text-tertiary"> assets</span>
                    <p className="text-micro text-text-tertiary">{project.reelsPublished} reels</p>
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap')}>
                    {/* ⚠️ null and 0 are different answers and must read
                        differently: "none agreed" is not "agreed to zero". */}
                    {project.assetsTargetMin === null
                      ? project.assetsTargetMax === null
                        ? '—'
                        : `up to ${project.assetsTargetMax}`
                      : project.assetsTargetMax !== null &&
                          project.assetsTargetMax !== project.assetsTargetMin
                        ? `${project.assetsTargetMin}–${project.assetsTargetMax}`
                        : `${project.assetsTargetMin}`}
                    {project.reelsTargetMin !== null && project.reelsTargetMin > 0 && (
                      <p className="text-micro text-text-tertiary">
                        incl. {project.reelsTargetMin} reels
                      </p>
                    )}
                  </td>
                  <td className={cn(TD, 'min-w-[12rem]')}>
                    <div className="flex items-center gap-2">
                      <Badge token={VERDICT_TOKEN[progress.verdict]} size="sm" variant="outline">
                        {VERDICT_LABEL[progress.verdict]}
                      </Badge>
                    </div>
                    {progress.assetsPercent !== null && (
                      <ProgressBar
                        value={progress.assetsPercent}
                        token={VERDICT_TOKEN[progress.verdict]}
                        size="sm"
                        className="mt-1.5"
                        label={progress.summary}
                      />
                    )}
                    <p className="mt-1 text-micro text-text-tertiary">{progress.summary}</p>
                  </td>
                  <td className={TD}>
                    {project.team.length > 0 ? (
                      project.team.join(', ')
                    ) : (
                      <span className="text-text-tertiary">nobody assigned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function PeopleTable({ report }: { report: ReportModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          Who published it
        </CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {report.people.length === 0 ? (
          <p className="px-4 pb-4 text-caption text-text-secondary">
            Nothing was published in this period.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className={TH}>Person</th>
                <th className={TH}>Assets</th>
                <th className={TH}>Reels</th>
                <th className={TH}>Projects</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((person) => (
                <tr key={person.name} className="border-b border-border-subtle last:border-0">
                  <td className={cn(TD, 'font-semibold text-text-primary')}>{person.name}</td>
                  <td className={TD}>{person.assetsPublished}</td>
                  <td className={TD}>{person.reelsPublished}</td>
                  <td className={TD}>{person.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function PlatformTable({ report }: { report: ReportModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          Where it went
        </CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {report.platforms.length === 0 ? (
          <p className="px-4 pb-4 text-caption text-text-secondary">
            No placements were recorded in this period.
          </p>
        ) : (
          <>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-default">
                  <th className={TH}>Platform</th>
                  <th className={TH}>Placements</th>
                  <th className={TH}>With a live link</th>
                </tr>
              </thead>
              <tbody>
                {report.platforms.map((platform) => (
                  <tr key={platform.name} className="border-b border-border-subtle last:border-0">
                    <td className={cn(TD, 'font-semibold text-text-primary')}>{platform.name}</td>
                    <td className={TD}>{platform.placements}</td>
                    <td className={TD}>{platform.withLinks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-micro text-text-tertiary">
              One asset cross-posted to four platforms is one asset and four placements, which is
              why these do not sum to the asset total.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------------------
 * PROVENANCE
 * ----------------------------------------------------------------------------
 * On paper this is the part that lets a reader trust the sheet, so it prints. It
 * states which counting rules were used, because every one of them is a decision
 * somebody could reasonably have made differently.
 * ------------------------------------------------------------------------- */
function Provenance({
  report,
  narrative,
}: {
  report: ReportModel;
  narrative: Narrative | null;
}) {
  return (
    <div className="space-y-1 border-t border-border-subtle pt-4 text-micro text-text-tertiary">
      <p className="font-semibold text-text-secondary">How these figures were counted</p>
      <p>
        Everything above is computed from the CRM&rsquo;s own records for {report.monthLabel}. An
        asset counts in the month it was <em>published</em>, not the month it was finished, so a
        reel shot in July and posted in August belongs to August. Reels are counted inside the
        asset total rather than on top of it. Archived and cancelled projects are excluded.
        Contracted minimums are summed only over the projects that have one, and{' '}
        {report.totals.projectsWithTargets} of {report.totals.projectCount} do.
      </p>
      <p>
        Figures reflect the records visible to the person who generated this report, which is the
        same scope as the rest of the application.
      </p>
      {narrative ? (
        <p>
          The written analysis was composed by {narrative.model} from these totals. The model was
          given the figures already calculated and asked not to perform any arithmetic; the prose
          was then checked back against them
          {narrative.unverifiedFigures.length > 0
            ? `, and ${narrative.unverifiedFigures.length} figure${narrative.unverifiedFigures.length === 1 ? '' : 's'} could not be matched — flagged above.`
            : ', and every figure matched.'}
        </p>
      ) : (
        <p>No written analysis was generated for this copy.</p>
      )}
    </div>
  );
}
