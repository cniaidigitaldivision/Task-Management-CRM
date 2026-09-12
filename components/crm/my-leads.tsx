'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarClock, PhoneOff, Moon, Trophy, Timer } from 'lucide-react';

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { responseTime } from '@/lib/domain/crm-stages';
import type { CrmMyDay, CrmProjectOption } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * MY LEADS — step 5
 * ----------------------------------------------------------------------------
 * ⚠️ THE SAME DEFINITIONS AS THE MANAGER'S SCREEN, NOT A SECOND SET. Overdue
 * means what it means on `/lead-overview`; `gone quiet` is still five days and
 * still ignores `imported`. The person most likely to notice two screens
 * disagreeing is the one being measured by them.
 *
 * ⚠️ AND IT SHOWS THEM THEIR OWN RESPONSE TIME. That is the figure their
 * manager is looking at, and somebody who cannot see the measure applied to
 * them cannot improve it.
 * ========================================================================= */

export function MyLeads({
  projects,
  selected,
  day,
  firstName,
}: {
  projects: readonly CrmProjectOption[];
  selected: CrmProjectOption | null;
  day: CrmMyDay | null;
  firstName: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pickProject(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set('project', id);
    router.push(`/my-leads?${next.toString()}` as Route);
  }

  if (!selected || !day) {
    return (
      <>
        <PageHeader title="My leads" description="What is yours today." />
        <p className="text-body text-text-secondary">No leads are yours yet.</p>
      </>
    );
  }

  const p = `?project=${selected.id}`;
  /* ⚠️ `responseTime` RETURNS NULL ON PURPOSE so a missing figure cannot be
     formatted by accident. "No calls yet" is the wording Step 7b settled on —
     never "0m", which would tell somebody who has rung nobody that they answer
     instantly. */
  const answers = responseTime(day.medianMinutes) ?? 'No calls yet';

  /* ⚠️ THE HEADLINE IS CHOSEN BY WHAT IS WRONG, not fixed. A page that opens
     with the same sentence every morning stops being read by the second week —
     `feed.ts` already records what that costs. Order matters: never-contacted
     outranks overdue, because a lead nobody has ever rung is a worse failure
     than a follow-up that slipped. */
  const headline =
    day.openTotal === 0
      ? 'Nothing is on your desk right now.'
      : day.neverContacted > 0
        ? `${day.neverContacted} of your leads have never been contacted.`
        : day.overdue > 0
          ? `${day.overdue} ${day.overdue === 1 ? 'lead is' : 'leads are'} overdue.`
          : day.dueToday > 0
            ? `${day.dueToday} ${day.dueToday === 1 ? 'lead needs' : 'leads need'} you today.`
            : 'Nothing is owed today. Good place to be.';

  return (
    <>
      <PageHeader title={`Good day, ${firstName}`} description={headline} />

      <div className="mb-4 max-w-sm">
        <Select
          aria-label="Project"
          size="md"
          value={selected.id}
          onChange={(e) => pickProject(e.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </div>

      {/* ⚠️ Each tile opens the desk ALREADY FILTERED to its own rows, so a
          count is a starting point rather than a statistic. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Never contacted"
          value={day.neverContacted}
          href={`/leads${p}&due=never` as Route}
          icon={PhoneOff}
          loud={day.neverContacted > 0}
        />
        <Tile
          label="Overdue"
          value={day.overdue}
          href={`/leads${p}&due=overdue` as Route}
          icon={AlertTriangle}
          loud={day.overdue > 0}
        />
        <Tile
          label="Due today"
          value={day.dueToday}
          href={`/leads${p}&due=today` as Route}
          icon={CalendarClock}
          loud={false}
        />
        <Tile
          label="Gone quiet"
          value={day.goneQuiet}
          href={`/leads${p}` as Route}
          icon={Moon}
          hint="Yours, untouched 5 days"
          loud={day.goneQuiet > 0}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>How you are doing</CardTitle>
          <p className="mt-1 text-caption text-text-secondary">
            The same figures your manager sees.
          </p>
        </CardHeader>
        <CardBody>
          <div className="grid gap-6 sm:grid-cols-3">
            <Figure icon={Timer} label="You usually answer in" value={answers} />
            <Figure icon={Trophy} label="Won" value={String(day.wonTotal)} />
            <Figure
              icon={CalendarClock}
              label="Open on your desk"
              value={String(day.openTotal)}
            />
          </div>

          {/* ⚠️ SAID PLAINLY RATHER THAN LEFT TO A DASH. "No calls yet" with no
              explanation reads as a broken figure; naming why it is empty is
              the difference between an absent number and an unexplained one. */}
          {day.medianMinutes === null && day.openTotal > 0 && (
            <p className="mt-4 text-caption text-text-secondary">
              Your response time appears once you log your first call. It is measured from when
              the lead <em>arrived</em>, not from when you opened it.
            </p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function Tile({
  label,
  value,
  href,
  icon: Icon,
  loud,
  hint,
}: {
  label: string;
  value: number;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  /** ⚠️ Chosen by the VALUE, never the label — a zero is never loud. */
  loud: boolean;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-xl border bg-bg-surface p-4 transition-colors',
        loud
          ? 'border-[color-mix(in_oklab,var(--feedback-warning)_40%,transparent)]'
          : 'border-border-subtle hover:border-border-default',
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="size-3.5" />
        <span className="text-caption text-text-secondary">{label}</span>
      </span>
      {/* ⚠️ Text ink, not a feedback hue. Those measure 3.77:1 as small ink in
          light theme against a 4.5 floor — they are fills. Only the icon and the
          border carry the tone. */}
      <span className="mt-1 block text-h3 font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      {hint && <span className="text-caption text-text-tertiary">{hint}</span>}
    </Link>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-caption text-text-secondary">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="mt-1 block text-h3 font-semibold tabular-nums text-text-primary">
        {value}
      </span>
    </div>
  );
}
