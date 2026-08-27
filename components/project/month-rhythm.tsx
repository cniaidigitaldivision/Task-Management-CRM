/* ⚠️ CURRENTLY UNREFERENCED — 2026-08-24.
 *
 * The project Calendar tab used to render this for its "Posting month" view and now
 * renders `posting-calendar.tsx` instead: the owner asked for a grid that lists each
 * day's actual posts as chips, which one tint per day cannot do.
 *
 * Kept rather than deleted, deliberately and against the usual rule. This is a
 * FEATURE — the plan-only view of an agreed cadence — not a redundant calculation,
 * and it is a plausible third tab rather than something superseded. `monthPlan`, the
 * domain function it is built on, is still very much in use: the new calendar calls it
 * to mark a day the rhythm wanted and which has nothing filed.
 *
 * If it is not wanted back, delete the file — nothing imports it.
 */
'use client';

import * as React from 'react';

import {
  WEEKDAY_LABEL,
  monthPlan,
  type Cadence,
  type Weekday,
} from '@/lib/domain/cadence';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE MONTH, AS THE RHYTHM LAYS IT OUT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Tanayar Marketing has a daily post, a static post, and a reel post… you can say
 * in a chart where checkboxes appear and where everything will appear."*
 * *"If that task is not completed, make it empty, like a Sunday for example: there is
 * no post. Mention that this is Sunday or, as a Friday, today is off, that's why no
 * post today."*
 *
 * ── ⚠️ THIS SHOWS THE PLAN, NOT THE TASKS ─────────────────────────────────────
 * Every square is what the CADENCE says should go out on that date, computed by
 * `monthPlan`. It is deliberately NOT a view of the task table, and the distinction
 * matters: this grid renders correctly the moment a rhythm is agreed, before a single
 * task exists. Once the schedule generator is built it will overlay what was actually
 * published on top of this, and the difference between the two IS the progress. Wiring
 * it to tasks now would leave a project showing an empty month until somebody pressed
 * a button, which reads as "nothing is planned" rather than "nothing is generated".
 *
 * ── OFF DAYS ARE DRAWN, NOT OMITTED ──────────────────────────────────────────
 * A Sunday with nothing on it looks identical to a Sunday somebody forgot. So an off
 * day gets its own hatched, muted square and says so on hover — the owner asked for
 * the reason to be visible, not for the gap to be tidy.
 * ========================================================================= */

/** Monday-first column order, matching the ISO weekday numbers we store. */
const COLUMNS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function MonthRhythm({
  cadence,
  monthStart,
  /** Today, as 'YYYY-MM-DD', so the current day can be marked. Passed in rather
   *  than read here — a component that reads the clock is not a pure render, and
   *  the server and the browser can disagree about the date across midnight. */
  today,
  actual,
}: {
  cadence: Cadence;
  monthStart: string;
  today: string;
  /**
   * What actually happened on each date, keyed 'YYYY-MM-DD'.
   *
   * ── ⚠️ WHY THE CALENDAR NEEDED THIS ─────────────────────────────────────
   * Owner, 2026-08-22: *"for the same task you have to represent it on a
   * calendar. That's not a different thing."*
   *
   * Until now this grid drew the PLAN and only the plan — every posting day
   * looked identical whether it had gone out, was still waiting, or had been
   * missed entirely. A month of teal squares says what was promised and nothing
   * about what was delivered, which is the one thing somebody opens a calendar
   * to find out.
   *
   * Optional, so the grid still works as a pure planning view where no tasks
   * exist yet — a project being set up, or a future month.
   */
  actual?: ReadonlyMap<string, DayActual>;
}) {
  const plan = React.useMemo(() => monthPlan(cadence, monthStart), [cadence, monthStart]);

  /* Counted across the days the calendar is showing, not across the project —
     the legend has to agree with the squares above it. */
  const actualTotals = React.useMemo(() => {
    let done = 0;
    let missed = 0;
    if (actual) {
      for (const day of plan.days) {
        const real = actual.get(day.date);
        if (!real) continue;
        done += real.done;
        if (real.done === 0) missed += real.missed;
      }
    }
    return { done, missed };
  }, [actual, plan]);

  const nothingAgreed =
    cadence.staticPostsPerDay === null && cadence.reelsPerWeek === null;

  if (nothingAgreed) {
    return (
      <p className="text-caption text-text-secondary">
        No posting rhythm agreed yet. Set one on the project and the month fills in here.
      </p>
    );
  }

  /* Blank cells before the 1st, so the columns line up with the weekday headings.
     `plan.days[0]` always exists — a month has at least 28 days. */
  const lead = plan.days[0]!.weekday - 1;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {COLUMNS.map((day) => (
          <div
            key={day}
            className={cn(
              'pb-0.5 text-center text-micro font-semibold',
              cadence.postingDays.includes(day)
                ? 'text-text-secondary'
                : 'text-text-disabled',
            )}
          >
            {WEEKDAY_LABEL[day]}
          </div>
        ))}

        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden="true" />
        ))}

        {plan.days.map((day) => {
          const isToday = day.date === today;
          const dayNumber = Number(day.date.slice(8));
          const hasReel = day.reels > 0;

          /* ── WHAT ACTUALLY HAPPENED BEATS WHAT WAS PLANNED ──────────────────
             A day carries one of four appearances, and the ORDER matters: a day
             that went out is green whatever it was planned to be, a day that was
             missed is red, and only a day with nothing decided yet falls back to
             the plan's teal or gold. Painting the plan on top of a missed day
             would hide the one thing worth seeing. */
          const real = actual?.get(day.date);
          const delivered = (real?.done ?? 0) > 0;
          const blank = !delivered && (real?.missed ?? 0) > 0;

          const tone = day.isOff
            ? 'off'
            : delivered
              ? 'done'
              : blank
                ? 'missed'
                : hasReel
                  ? 'reel'
                  : 'planned';

          const title = day.isOff
            ? `${day.date} — off day, nothing scheduled`
            : delivered
              ? `${day.date} — ${real?.done} published`
              : blank
                ? `${day.date} — nothing went out, blank day`
                : `${day.date} — ${day.staticPosts} static${hasReel ? ' + 1 reel' : ''} planned`;

          return (
            <div
              key={day.date}
              title={title}
              aria-label={title}
              className={cn(
                'relative flex aspect-square flex-col items-center justify-center rounded-md border',
                'text-micro tabular-nums transition-transform duration-[140ms] hover:scale-[1.06]',
                day.isOff ? 'border-border-subtle' : 'border-transparent',
                isToday && 'ring-2 ring-offset-1',
              )}
              style={{
                /* An off day is a hatch rather than a fill, so it reads as "closed"
                   instead of as another category of work. */
                background:
                  tone === 'off'
                    ? 'repeating-linear-gradient(135deg, var(--bg-surface-sunken) 0 3px, transparent 3px 6px)'
                    : `color-mix(in oklab, var(${TONE_VAR[tone]}) var(${TONE_TINT[tone]}), var(--bg-surface))`,
                color: day.isOff ? 'var(--text-disabled)' : 'var(--text-primary)',
                boxShadow:
                  tone === 'off'
                    ? undefined
                    : `inset 0 0 0 1px color-mix(in oklab, var(${TONE_VAR[tone]}) 40%, transparent)`,
                ...(isToday
                  ? ({ '--tw-ring-color': 'var(--focus-ring)' } as React.CSSProperties)
                  : {}),
              }}
            >
              <span className={cn('leading-none', isToday && 'font-bold')}>{dayNumber}</span>

              {/* The dots say WHAT goes out, without a number to read. Two static
                  posts on a day is two dots. */}
              {!day.isOff && (
                <span aria-hidden="true" className="mt-0.5 flex items-center gap-[2px]">
                  {Array.from({ length: Math.min(day.staticPosts, 3) }, (_, i) => (
                    <span
                      key={i}
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: 'var(--accent-primary)' }}
                    />
                  ))}
                  {hasReel && (
                    <span
                      className="h-1 w-2 rounded-full"
                      style={{ backgroundColor: 'var(--accent-gold)' }}
                    />
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-text-tertiary">
        {/* The delivered/blank keys appear only once there is something real to
            explain — on a future month they would be a legend for two colours
            that are not on screen. */}
        {actual && actualTotals.done > 0 && (
          <Key colour="var(--feedback-success)" label={`${actualTotals.done} published`} />
        )}
        {actual && actualTotals.missed > 0 && (
          <Key colour="var(--feedback-error)" label={`${actualTotals.missed} blank`} />
        )}
        <Key colour="var(--accent-primary)" label={`${plan.staticPosts} static posts`} />
        <Key colour="var(--accent-gold)" label={`${plan.reels} reels`} />
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[3px] border border-border-subtle"
            style={{
              background:
                'repeating-linear-gradient(135deg, var(--bg-surface-sunken) 0 3px, transparent 3px 6px)',
            }}
          />
          {plan.offDayCount} off {plan.offDayCount === 1 ? 'day' : 'days'}
        </span>
        <span className="ml-auto font-semibold text-text-secondary">
          {plan.assets} planned this month
        </span>
      </div>
    </div>
  );
}

/** One day's real outcome, as the calendar needs it. */
export interface DayActual {
  readonly done: number;
  readonly missed: number;
  readonly pending: number;
}

/* The four fills. Kept as a table rather than a chain of ternaries in the style
   attribute — five nested conditionals inside a template literal is where the
   wrong colour hides. */
const TONE_VAR = {
  done: '--feedback-success',
  missed: '--feedback-error',
  reel: '--accent-gold',
  planned: '--accent-primary',
  off: '--bg-surface-sunken',
} as const;

const TONE_TINT = {
  done: '--tint-strong',
  missed: '--tint-medium',
  reel: '--tint-strong',
  planned: '--tint-medium',
  off: '--tint-soft',
} as const;

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-[3px]"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
