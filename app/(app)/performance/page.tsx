import type { Metadata } from 'next';

import { PerformanceBoard } from '@/components/performance/performance-board';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import {
  completedInWindow,
  performanceBoard,
  workNeedingAttention,
} from '@/lib/db/queries/performance';
import { isoDateIn, nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Team performance' };

/* ============================================================================
 * TEAM PERFORMANCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"I want to create a team performance page where I can see
 * … a single person's performance: his whole history, what he has done today
 * and yesterday, how his performance is going … every chitta-batta."*
 *
 * ── ⚠️ THE EXISTING REPORTS PAGE IS UNTOUCHED ────────────────────────────
 * *"For right now I don't want to change the export of the report page."* So
 * `/reports` and its CSV / Excel / PDF exports are exactly as they were; this is
 * a new screen beside it. The two answer different questions — Reports produces
 * a document, this one answers "how is this person doing".
 *
 * ── ⚠️ NO INVENTED FIGURES, AND THAT IS NOT A STYLE CHOICE HERE ──────────
 * The reference image carries a "Sample data" badge. This page never will:
 * every figure is read from `tasks`, `activity_log`, `attendance_days` and
 * `attachments`, and where nothing is recorded the screen says so instead of
 * drawing a zero. A number nobody can trace, on a page read as a judgement
 * about a named person, is the worst bug this screen could ship with.
 *
 * ── SCOPE IS ROW-LEVEL SECURITY ──────────────────────────────────────────
 * `requireRole('team_coordinator')` is the floor for seeing a page about other
 * people's work at all; what a reader then sees inside it is decided by the
 * same policies the task board uses (ADR-003).
 * ========================================================================= */

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_30', label: 'Last 30 days' },
] as const;

type Preset = (typeof PRESETS)[number]['value'];

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  /* ⚠️ ONE WAVE — Rule Zero, law 4. */
  const [user, params] = await Promise.all([requireRole('team_coordinator'), searchParams]);

  const today = isoDateIn();
  const preset: Preset = (PRESETS.find((p) => p.value === params.period)?.value ?? 'this_week') as Preset;
  const period = resolvePeriod(preset, today);

  const [board, attention, previousCompleted] = await Promise.all([
    performanceBoard(user.id, { ...period, today }),
    workNeedingAttention(user.id, today),
    completedInWindow(user.id, previousWindow(period)),
  ]);

  const anyMeasured = board.some((p) => p.judged > 0);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <PageHeader
        eyebrow="Team"
        title="Team performance"
        description={
          <>
            Understand the work. See the evidence. Decide the next step.{' '}
            {anyMeasured ? (
              <>Every figure here is read from the record — nothing is estimated.</>
            ) : (
              <>
                Nothing in this period had a deadline, so on-time delivery is not measurable — the
                page says that rather than showing a zero.
              </>
            )}
          </>
        }
      />
      <PerformanceBoard
        board={board}
        attention={attention}
        period={{ ...period, preset, label: labelFor(period) }}
        today={today}
        /* The server's clock, so "waiting 52 hours" is not computed against a
           browser that may be on another day. */
        nowMs={nowMs()}
        previousCompleted={previousCompleted}
        presets={[...PRESETS]}
      />
    </div>
  );
}

/**
 * The period, in the division's own days.
 *
 * ⚠️ KARACHI, NOT UTC. `today` arrives from `isoDateIn()`, which is the
 * division's date — for five hours every evening the server's date is already
 * tomorrow, and a week computed from that would report Monday's work as
 * Tuesday's.
 */
function resolvePeriod(preset: Preset, today: string): { from: string; to: string } {
  const day = (iso: string, delta: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

  if (preset === 'today') return { from: today, to: today };
  if (preset === 'last_30') return { from: day(today, -29), to: today };

  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  /* Monday-first: the division's week, and the one the reports already use. */
  const mondayOffset = dow === 0 ? -6 : 1 - dow;

  if (preset === 'this_week') return { from: day(today, mondayOffset), to: today };
  if (preset === 'last_week') {
    const lastMonday = day(today, mondayOffset - 7);
    return { from: lastMonday, to: day(lastMonday, 6) };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The window of the same length immediately before it — for the comparison. */
function previousWindow(period: { from: string; to: string }): { from: string; to: string } {
  const a = Date.parse(`${period.from}T00:00:00Z`);
  const b = Date.parse(`${period.to}T00:00:00Z`);
  const span = Math.max(b - a, 0) + 86_400_000;
  return {
    from: new Date(a - span).toISOString().slice(0, 10),
    to: new Date(b - span).toISOString().slice(0, 10),
  };
}

function labelFor(period: { from: string; to: string }): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    });
  return period.from === period.to ? fmt(period.from) : `${fmt(period.from)} – ${fmt(period.to)}`;
}
