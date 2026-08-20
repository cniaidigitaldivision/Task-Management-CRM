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
}: {
  cadence: Cadence;
  monthStart: string;
  today: string;
}) {
  const plan = React.useMemo(() => monthPlan(cadence, monthStart), [cadence, monthStart]);

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

          /* Three states, three appearances: a reel day carries the gold accent, an
             ordinary posting day the brand teal, an off day nothing but a hatch. */
          const title = day.isOff
            ? `${day.date} — off day, nothing scheduled`
            : `${day.date} — ${day.staticPosts} static${hasReel ? ' + 1 reel' : ''}`;

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
                background: day.isOff
                  ? 'repeating-linear-gradient(135deg, var(--bg-surface-sunken) 0 3px, transparent 3px 6px)'
                  : hasReel
                    ? 'color-mix(in oklab, var(--accent-gold) var(--tint-strong), var(--bg-surface))'
                    : 'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
                color: day.isOff ? 'var(--text-disabled)' : 'var(--text-primary)',
                boxShadow: day.isOff
                  ? undefined
                  : `inset 0 0 0 1px color-mix(in oklab, var(--${hasReel ? 'accent-gold' : 'accent-primary'}) 40%, transparent)`,
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
