'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, PhoneOff, Clock, UserX, Moon } from 'lucide-react';

import { SalesTeamPanel } from '@/components/crm/sales-team';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendChart } from '@/components/ui/chart';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import type {
  CrmArrival,
  CrmAttention,
  CrmProjectOption,
  CrmSalesPerson,
} from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE MANAGER'S LIVE OVERVIEW — step 4
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY NUMBER HERE IS A LINK. A count somebody cannot act on is a fact
 * about the past; the same count that opens the rows behind it is a piece of
 * work. Each tile carries the filter that produces exactly its own rows, so
 * "627 never contacted" is one click from the 627.
 *
 * ⚠️ AND NOTHING ON THIS PAGE IS STORED. `/lead-reports` is frozen on purpose —
 * a report is a statement made on a date. This answers "what is wrong right
 * now", where a snapshot would be correct and out of date, which is worse than
 * either. The 25-second pulse keeps it current without a refresh.
 * ========================================================================= */

export function LeadOverview({
  projects,
  selected,
  attention,
  arrivals,
  team,
  nowMs,
}: {
  projects: readonly CrmProjectOption[];
  selected: CrmProjectOption | null;
  /** Null when the viewer does not manage this project — see the layout. */
  attention: CrmAttention | null;
  arrivals: readonly CrmArrival[];
  team: readonly CrmSalesPerson[];
  nowMs: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pickProject(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set('project', id);
    router.push(`/lead-overview?${next.toString()}` as Route);
  }

  if (!selected) {
    return (
      <>
        <PageHeader title="Live overview" description="What needs attention right now." />
        <p className="text-body text-text-secondary">No projects are visible to you yet.</p>
      </>
    );
  }

  const totalArrived = arrivals.reduce((sum, d) => sum + d.arrived, 0);
  const totalAnswered = arrivals.reduce((sum, d) => sum + d.contacted, 0);

  return (
    <>
      <PageHeader
        title="Live overview"
        description="What needs attention right now. Every figure is live, and every one of them is a link."
      />

      <div className="mb-4 max-w-sm">
        <Select
          aria-label="Project"
          size="md"
          value={selected.id}
          onChange={(e) => pickProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.leads > 0 ? ` — ${p.leads}` : ''}
            </option>
          ))}
        </Select>
      </div>

      {attention === null ? (
        /* ⚠️ SAID OUT LOUD, not rendered as zeros. The database returns NO ROW
           to somebody who does not manage this project (migration 135's
           `having`), precisely so this can say whose screen it is rather than
           report a reassuring nothing. */
        <Card>
          <CardBody>
            <p className="text-body text-text-secondary">
              These are whole-team figures, so they are the manager&rsquo;s. Your own leads are on{' '}
              <Link href="/leads" className="underline">the desk</Link>.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile
              label="Never contacted"
              value={attention.neverContacted}
              href={`/leads?project=${selected.id}&due=never` as Route}
              icon={PhoneOff}
              /* ⚠️ THE LOUD ONE, AND IT IS FIRST. A lead nobody has ever rung is
                 a different failure from a follow-up that slipped, and folding
                 the two into one "overdue" is how 553 untouched leads hid inside
                 a number that looked like ordinary backlog. */
              tone={attention.neverContacted > 0 ? 'alert' : 'calm'}
            />
            <Tile
              label="Overdue"
              value={attention.overdue}
              href={`/leads?project=${selected.id}&due=overdue` as Route}
              icon={AlertTriangle}
              tone={attention.overdue > 0 ? 'warn' : 'calm'}
            />
            <Tile
              label="Due today"
              value={attention.dueToday}
              href={`/leads?project=${selected.id}&due=today` as Route}
              icon={Clock}
              tone="calm"
            />
            <Tile
              label="Nobody owns"
              value={attention.unassigned}
              href={`/leads?project=${selected.id}&owner=unassigned` as Route}
              icon={UserX}
              tone={attention.unassigned > 0 ? 'warn' : 'calm'}
            />
            <Tile
              label="Gone quiet"
              value={attention.goneQuiet}
              href={`/leads?project=${selected.id}` as Route}
              icon={Moon}
              hint="Held, untouched 5 days"
              tone={attention.goneQuiet > 0 ? 'warn' : 'calm'}
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Arriving, and answered</CardTitle>
              <p className="mt-1 text-caption text-text-secondary">
                {totalArrived === 0
                  ? 'Nothing has arrived in the last fortnight.'
                  : `${totalArrived} arrived in 14 days · ${totalAnswered} of them have ever been answered.`}
              </p>
            </CardHeader>
            <CardBody>
              {/* ⚠️ TWO SERIES ON ONE AXIS, never two scales. Both count leads,
                  so they are directly comparable and the gap between the lines
                  IS the finding — "leads are up" is only good news if somebody
                  rang them. `fill` off, as the component itself advises for two
                  or more series, because the washes would muddy. */}
              <TrendChart
                caption="Leads arriving each day, and how many of that day's intake was ever contacted"
                labels={arrivals.map((d) => d.date.slice(5))}
                fill={false}
                series={[
                  { label: 'Arrived', token: 'chart-1', points: arrivals.map((d) => d.arrived) },
                  { label: 'Ever answered', token: 'chart-3', points: arrivals.map((d) => d.contacted) },
                ]}
              />
            </CardBody>
          </Card>

          <div className="mt-6">
            <SalesTeamPanel team={team} nowMs={nowMs} />
          </div>
        </>
      )}
    </>
  );
}

/* ── One number, and the rows behind it ──────────────────────────────────── */
function Tile({
  label,
  value,
  href,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number;
  /* ⚠️ `Route`, not `string` — typedRoutes is on, so a plain string is refused
     at the Link. The cast happens ONCE here, at the boundary where the filter
     is built, rather than at each of the five call sites. */
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  /** ⚠️ Tone is chosen by the VALUE, not by the label — a zero is never loud.
   *  A page where every tile shouts is a page somebody stops reading. */
  tone: 'alert' | 'warn' | 'calm';
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group rounded-xl border bg-bg-surface p-4 transition-colors',
        tone === 'alert'
          ? 'border-[color-mix(in_oklab,var(--feedback-error)_40%,transparent)]'
          : tone === 'warn'
            ? 'border-[color-mix(in_oklab,var(--feedback-warning)_40%,transparent)]'
            : 'border-border-subtle hover:border-border-default',
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon
          className="size-3.5"
          /* ⚠️ The icon carries the tone, the NUMBER does not. `feedback-*`
             hues are fills: measured at 3.77:1 as small ink in light theme,
             against a 4.5 floor. The figure stays in text ink and passes in
             both themes — the same correction Step 7b's panel already took. */
        />
        <span className="text-caption text-text-secondary">{label}</span>
      </span>
      <span className="mt-1 block text-h3 font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      {hint && <span className="text-caption text-text-tertiary">{hint}</span>}
    </Link>
  );
}
