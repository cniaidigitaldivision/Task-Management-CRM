'use client';

import * as React from 'react';
import { FileDown, Loader2 } from 'lucide-react';

import { generateReportAction } from '@/app/actions/crm-reports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { CrmProjectOption } from '@/lib/db/queries/crm-leads';
import type { StoredReport } from '@/lib/db/queries/crm-reports';
/* ⚠️ THE VOCABULARY COMES FROM `lib/domain/`, NOT FROM THE QUERY MODULE. That
   module is `server-only`, and importing a VALUE from one into a Client
   Component type-checks and then breaks the production build.
   `design-tokens.test.ts` guards it and caught this. Types are fine — they are
   erased — which is why `StoredReport` above stays where it is. */
import {
  REPORT_KINDS,
  REPORT_LABEL,
  reportNeedsPeriod,
  type CrmReportKind,
} from '@/lib/domain/crm-reports';
import { DIVISION_NAME } from '@/lib/domain/constants';
import { cellText, type Cell, type Report } from '@/lib/domain/reports';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * LEAD REPORTS — Step 10 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * Owner's rule, 2026-09-09: *"first save in a database and always fetch from the
 * database."*
 *
 * ── ⚠️ WHAT IS ON SCREEN IS THE FROZEN COPY, NOT A LIVE QUERY ──────────────
 * Pressing Generate computes once and stores the result; everything shown after
 * that is read back from storage. So a report opened in December says what it
 * said in September, even though the same query today would legitimately give
 * different numbers — leads get reassigned and stages move. The date it was
 * taken is on every row of the list, because a frozen figure without its date is
 * indistinguishable from a wrong one.
 *
 * ── ⚠️ AND THE NOTES ARE NOT FOOTNOTES ─────────────────────────────────────
 * `lib/domain/reports.ts`: *"a number without its definition is how two people
 * read the same report and disagree."* They are rendered with the figures rather
 * than under the table, because the reader who most needs them is the one who
 * looked at the big number and stopped.
 * ========================================================================= */

export function LeadReports({
  projects,
  selected,
  reports,
  open,
  canGenerate,
  defaultFrom,
  defaultTo,
  nowMs,
}: {
  projects: readonly CrmProjectOption[];
  selected: CrmProjectOption | null;
  reports: readonly StoredReport[];
  /** The one being read, already loaded from storage. */
  open: { report: Report; stored: StoredReport } | null;
  canGenerate: boolean;
  /* ⚠️ THE DATES ARE COMPUTED ON THE SERVER, and that is a rule rather than a
     preference. `react-hooks/purity` refuses `Date.now()` in a component body,
     correctly: a render that reads the clock is not a pure function of its
     props, so server and browser can disagree and React reports it as a
     hydration mismatch rather than as the clock problem it is.
     `lib/view/relative-age.ts` documents the same lesson at length. */
  defaultFrom: string;
  defaultTo: string;
  nowMs: number;
}) {
  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4 pb-16">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Lead reports"
        description="Computed once and kept, so a figure you quoted in September still reads the same in December."
      />

      {selected === null ? (
        <Card>
          <CardBody>
            <p className="text-body-sm leading-relaxed text-text-secondary">
              No project&rsquo;s leads are routed to you, so there is nothing to report on.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {canGenerate && (
            <Generate
              projects={projects}
              selected={selected}
              defaultFrom={defaultFrom}
              defaultTo={defaultTo}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <History reports={reports} openId={open?.stored.id ?? null} nowMs={nowMs} />
            {open ? (
              <Frozen report={open.report} stored={open.stored} nowMs={nowMs} />
            ) : (
              <Card>
                <CardBody>
                  <p className="text-body-sm leading-relaxed text-text-secondary">
                    {reports.length === 0
                      ? 'Nothing has been reported on yet. Generating one computes it from the leads as they are right now and keeps that copy.'
                      : 'Pick a report on the left to read it as it was taken.'}
                  </p>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---- Generating ---------------------------------------------------------- */

/**
 * ⚠️ THE PERIOD DEFAULTS TO THE LAST 90 DAYS, NOT TO THIS MONTH. The oldest
 * lead is 90 days old and Meta deletes at 90; a report defaulting to "September"
 * would silently exclude the leads closest to being gone, which are the ones
 * somebody opening this page most needs to see.
 */
function Generate({
  projects,
  selected,
  defaultFrom,
  defaultTo,
}: {
  projects: readonly CrmProjectOption[];
  selected: CrmProjectOption;
  defaultFrom: string;
  defaultTo: string;
}) {
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [kind, setKind] = React.useState<CrmReportKind>('ageing');
  const [from, setFrom] = React.useState(defaultFrom);
  const [to, setTo] = React.useState(defaultTo);

  const project = projects.find((p) => p.id === selected.id) ?? selected;
  const needsPeriod = reportNeedsPeriod(kind);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Take a report</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Report">
            <Select
              label="Which report"
              value={kind}
              onChange={(e) => setKind(e.target.value as CrmReportKind)}
            >
              {REPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REPORT_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>

          {needsPeriod ? (
            <>
              <Field label="From">
                <DateBox value={from} onChange={setFrom} label="Period start" />
              </Field>
              <Field label="To">
                <DateBox value={to} onChange={setTo} label="Period end" />
              </Field>
            </>
          ) : (
            <p className="pb-1.5 text-caption text-text-secondary">
              A snapshot of right now — no period to choose.
            </p>
          )}

          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await generateReportAction(
                  kind,
                  project.id,
                  project.name,
                  from,
                  to,
                );
                if (!result.ok) {
                  toast({ tone: 'error', text: result.error ?? 'That report was not taken.' });
                  return;
                }
                toast({
                  tone: 'ok',
                  strong: REPORT_LABEL[kind],
                  text: 'taken and kept. It will read the same whenever you open it.',
                });
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Taking…' : 'Generate'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---- The history --------------------------------------------------------- */

/**
 * ⚠️ EVERY REPORT EVER TAKEN, INCLUDING THE EMPTY ONES. "We looked in September
 * and there was nothing" is a finding, and a list that hid it would leave no
 * record that anybody looked. Append-only in the database, so nothing here can
 * be tidied away either.
 */
function History({
  reports,
  openId,
  nowMs,
}: {
  reports: readonly StoredReport[];
  openId: string | null;
  nowMs: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Taken so far</CardTitle>
      </CardHeader>
      <CardBody>
        {reports.length === 0 ? (
          <p className="text-caption leading-relaxed text-text-secondary">
            Nothing yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {reports.map((r) => (
              <li key={r.id}>
                <a
                  href={`?report=${r.id}`}
                  className={cn(
                    'block rounded-lg border px-3 py-2 transition-colors',
                    r.id === openId
                      ? 'border-border-strong bg-bg-subtle'
                      : 'border-transparent hover:border-border-default hover:bg-bg-subtle',
                  )}
                >
                  <span className="block truncate text-body-sm font-medium text-text-primary">
                    {REPORT_LABEL[r.kind] ?? r.title}
                  </span>
                  <span className="mt-0.5 block text-caption text-text-secondary">
                    {r.periodFrom && r.periodTo
                      ? `${r.periodFrom} to ${r.periodTo}`
                      : 'Snapshot'}
                    {' · '}
                    {r.rowCount} {r.rowCount === 1 ? 'row' : 'rows'}
                  </span>
                  <span className="mt-0.5 block text-micro text-text-secondary">
                    {/* ⚠️ WHEN IT WAS TAKEN IS NOT OPTIONAL. A frozen figure
                        without its date is indistinguishable from a wrong one. */}
                    Taken {relativeAge(r.generatedAt, nowMs)}
                    {r.generatedBy ? ` by ${r.generatedBy}` : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- Reading a frozen one ------------------------------------------------ */

function Frozen({
  report,
  stored,
  nowMs,
}: {
  report: Report;
  stored: StoredReport;
  nowMs: number;
}) {
  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-1 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <CardTitle>{report.title}</CardTitle>
          <p className="mt-0.5 text-caption text-text-secondary">
            {report.subtitle}
            {stored.periodFrom && stored.periodTo
              ? ` · ${stored.periodFrom} to ${stored.periodTo}`
              : ''}
          </p>
        </div>
        {/* ⚠️ THE BADGE SAYS THIS IS NOT LIVE. Somebody arriving at a page of
            numbers assumes they are current unless told otherwise, and acting on
            a three-month-old figure believing it is today's is the one failure
            this whole design exists to prevent. */}
        <Badge token="status-backlog" size="sm" dot={false}>
          As taken {relativeAge(stored.generatedAt, nowMs)}
        </Badge>
      </CardHeader>

      <CardBody className="space-y-5">
        {report.figures.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {report.figures.map((figure) => (
              <div key={figure.label} className="min-w-[8rem]">
                <p className="text-caption text-text-secondary">{figure.label}</p>
                <p className="text-h3 font-semibold tabular-nums text-text-primary">
                  {cellText(figure.value)}
                </p>
                {figure.hint && (
                  <p className="text-micro text-text-secondary">{figure.hint}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {report.rows.length === 0 ? (
          <p className="text-body-sm leading-relaxed text-text-secondary">
            Nothing matched this period. That is a finding rather than a failure — the notes
            below say what was counted.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-default">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border-default bg-bg-subtle">
                  {report.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn(
                        'px-3 py-2 text-caption font-medium text-text-secondary',
                        c.kind !== 'text' && 'text-right',
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-b-0">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={cn(
                          'px-3 py-2 text-body-sm text-text-primary',
                          report.columns[j]?.kind !== 'text' && 'text-right tabular-nums',
                        )}
                      >
                        {cellText(cell as Cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report.notes.length > 0 && (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-3">
            <p className="mb-1.5 text-caption font-medium text-text-primary">
              What this counted
            </p>
            <ul className="space-y-1 pl-4">
              {report.notes.map((note) => (
                <li
                  key={note}
                  className="list-disc text-caption leading-relaxed text-text-secondary"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ⚠️ A LINK, NOT A BUTTON, and it downloads the FROZEN payload — the
            export writers take a Report, and the stored one is a Report. */}
        <a
          href={`/api/crm/report/${stored.id}?format=csv`}
          className="inline-flex min-h-[2.2rem] items-center gap-1.5 rounded-lg border border-border-subtle px-3 text-caption font-medium text-text-primary transition-colors hover:border-border-default hover:bg-bg-subtle"
        >
          <FileDown className="size-3.5" aria-hidden="true" />
          Download as CSV
        </a>
      </CardBody>
    </Card>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function DateBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <input
      type="date"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[2rem] rounded-lg border border-border-subtle bg-bg-surface px-2 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
    />
  );
}
