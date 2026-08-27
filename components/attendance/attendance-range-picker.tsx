'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  RANGE_KEYS,
  countRangeDays,
  rangeLabel,
  resolveRange,
  shortDate,
  type RangeKey,
} from '@/lib/view/attendance-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PERIOD THIS PAGE IS SHOWING
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, on the reference's top-right chip: *"there is a dropdown in
 * which I can see the ranges. Plus I can select a single day also… There is a date
 * range where we can select a date range."*
 *
 * And later the same day, on the first build's two bare date fields: *"I want it
 * to show two calendars so I can select the range."* So the open panel is now a
 * preset rail beside TWO MONTH CALENDARS — click the first day, click the last
 * day, Apply. The presets stay: they were never the complaint, and "this month"
 * in one press is still faster than eight clicks on a grid.
 *
 * ── ⚠️ THE PERIOD LIVES IN THE URL ──────────────────────────────────────────
 * Not in React state. Every figure on the page is computed on the server from the
 * range, so changing it has to re-run that read — and putting it in the address
 * bar means "look at last month" is a link, survives a refresh, and comes back
 * from the browser's Back button. `replace` rather than `push`, so flicking
 * through five periods does not bury the page somebody came from under five
 * history entries.
 *
 * ── ⚠️ A SINGLE DAY IS NOT A MODE ───────────────────────────────────────────
 * It is a range whose two ends are equal. On the calendars that is the same day
 * clicked twice; everything downstream — the chart, the counters, the table, the
 * export — handles it without a branch.
 *
 * ── ⚠️ THE WEEKS START ON MONDAY ────────────────────────────────────────────
 * Both grids, because both offices work Monday-first weeks and every other
 * calendar in this product (the calendar page, the overview chart) already does.
 * A Sunday-first picker beside a Monday-first chart would misfile every weekend.
 *
 * ── WHY `<details>` AND NOT A LIBRARY POPOVER ───────────────────────────────
 * It brings keyboard toggling and Escape for nothing. The one thing it does not do
 * is close on an outside click, which is added below — the same pattern as
 * components/ui/people-picker.tsx.
 * ========================================================================= */

export interface AttendanceRangePickerProps {
  readonly range: { key: RangeKey; from: string; to: string; label: string };
  /** The server's Karachi date, so the presets and the "today" ring mean what they say. */
  readonly today: string;
}

export function AttendanceRangePicker({ range, today }: AttendanceRangePickerProps) {
  const router = useRouter();
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [from, setFrom] = React.useState(range.from);
  const [to, setTo] = React.useState(range.to);
  /* The left calendar's month; the right one always shows the month after. */
  const [month, setMonth] = React.useState(() => monthOf(range.from));

  /* Follows the server when the period changes elsewhere — a Back press, the
     preset rail, or the table's quick filter. Without this the calendars keep
     showing the old span. */
  const [seen, setSeen] = React.useState(`${range.from}|${range.to}`);
  if (seen !== `${range.from}|${range.to}`) {
    setSeen(`${range.from}|${range.to}`);
    setFrom(range.from);
    setTo(range.to);
    setMonth(monthOf(range.from));
  }

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const go = (query: string) => {
    ref.current?.removeAttribute('open');
    router.replace(`/attendance?${query}` as never);
  };

  /* First click starts a span, second click ends it. The same day twice is a
     single day; a click before the start moves the start rather than erroring. */
  const pick = (date: string) => {
    if (to !== '') {
      setFrom(date);
      setTo('');
      return;
    }
    if (date < from) {
      setFrom(date);
      return;
    }
    setTo(date);
  };

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Change the period"
        className={cn(
          'flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border-default px-3',
          'bg-bg-surface text-caption font-semibold text-text-primary',
          'marker:content-none hover:border-border-strong [&::-webkit-details-marker]:hidden',
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={2.25} aria-hidden="true" />
        {/* The dates, not the preset's name: "1 Aug – 31 Aug 2026" is the answer to
            "what am I looking at", and "This month" is only how it was chosen. */}
        <span className="whitespace-nowrap">{rangeLabel(range)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      {/* ⚠️ 43rem is not padding for its own sake: the rail must hold "Last 30
          days · 30 days ✓" on one line and the right side must hold TWO 14.25rem
          calendars abreast — any narrower and the second month wraps underneath,
          which is exactly the layout the owner rejected. */}
      <div className="absolute right-0 z-40 mt-1 w-[min(43rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-[var(--shadow-lg)]">
        <div className="grid sm:grid-cols-[11.5rem_1fr]">
          {/* ── The presets, one press each ──────────────────────────────── */}
          <div className="border-b border-border-subtle py-1 sm:border-b-0 sm:border-r">
            {RANGE_KEYS.map((key) => {
              const preset = resolveRange(key, today);
              const on = range.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => go(`range=${key}`)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-caption',
                    on ? 'text-text-primary' : 'text-text-secondary',
                    'hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <span className="whitespace-nowrap font-semibold">{preset.label}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="whitespace-nowrap text-micro text-text-tertiary">
                      {preset.from === preset.to ? '1 day' : `${countRangeDays(preset)} days`}
                    </span>
                    {on && <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Or the two calendars ─────────────────────────────────────── */}
          <div className="p-3">
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-3">
              <MonthCalendar
                ym={month}
                from={from}
                to={to}
                today={today}
                onPick={pick}
                onPrev={() => setMonth((ym) => addMonths(ym, -1))}
              />
              <MonthCalendar
                ym={addMonths(month, 1)}
                from={from}
                to={to}
                today={today}
                onPick={pick}
                onNext={() => setMonth((ym) => addMonths(ym, 1))}
              />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
              <p className="min-w-0 text-micro leading-relaxed text-text-tertiary">
                {to === ''
                  ? `${shortDate(from)} — now pick the last day, or the same day again for just that day.`
                  : from === to
                    ? `${shortDate(from)} only`
                    : `${shortDate(from)} – ${shortDate(to)}`}
              </p>
              <button
                type="button"
                disabled={to === ''}
                onClick={() => go(`range=custom&from=${from}&to=${to}`)}
                className={cn(
                  'h-8 shrink-0 rounded-lg bg-accent-primary px-4 text-caption font-semibold text-text-on-brand',
                  'hover:bg-accent-primary-hover disabled:opacity-45',
                )}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------------------
 * One month, as a grid of days
 * ------------------------------------------------------------------------- */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface Ym {
  readonly y: number;
  readonly m: number;
}

function MonthCalendar({
  ym,
  from,
  to,
  today,
  onPick,
  onPrev,
  onNext,
}: {
  ym: Ym;
  from: string;
  to: string;
  today: string;
  onPick: (date: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const total = daysInMonth(ym.y, ym.m);
  const leading = mondayIndex(ym.y, ym.m);

  return (
    <div className="w-[14.25rem]">
      <div className="flex items-center justify-between">
        {/* One pair of chevrons for both grids — the left one steps back, the
            right one steps forward, and the two months always stay adjacent. */}
        {onPrev ? (
          <NavButton label="Earlier month" icon={ChevronLeft} onClick={onPrev} />
        ) : (
          <span aria-hidden="true" className="size-7" />
        )}
        <span className="text-caption font-semibold text-text-primary">
          {MONTH_NAMES[ym.m - 1]} {ym.y}
        </span>
        {onNext ? (
          <NavButton label="Later month" icon={ChevronRight} onClick={onNext} />
        ) : (
          <span aria-hidden="true" className="size-7" />
        )}
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            aria-hidden="true"
            className="grid h-6 place-items-center text-micro font-semibold text-text-tertiary"
          >
            {day}
          </span>
        ))}

        {Array.from({ length: leading }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}

        {Array.from({ length: total }, (_, i) => {
          const date = isoDate(ym.y, ym.m, i + 1);
          /* While only the start is chosen, it is the whole selection. */
          const isEnd = date === from || (to !== '' && date === to);
          const inSpan = to !== '' && date > from && date < to;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              aria-label={`${i + 1} ${MONTH_NAMES[ym.m - 1]} ${ym.y}`}
              aria-pressed={isEnd || inSpan}
              className={cn(
                'grid h-8 place-items-center rounded-md text-caption tabular-nums',
                isEnd
                  ? 'bg-accent-primary font-semibold text-text-on-brand'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
              style={
                inSpan
                  ? { backgroundColor: 'color-mix(in oklab, var(--accent-primary) 13%, transparent)' }
                  : /* The server's today, ringed so "where am I" survives a flick
                       through past months. */
                    !isEnd && date === today
                    ? { boxShadow: 'inset 0 0 0 1px var(--accent-primary)' }
                    : undefined
              }
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof ChevronLeft;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Date arithmetic — from the passed-in strings, never from a clock
 * ------------------------------------------------------------------------- */

function monthOf(date: string): Ym {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}

function addMonths(ym: Ym, count: number): Ym {
  const total = ym.y * 12 + (ym.m - 1) + count;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** How many blanks before the 1st, in a Monday-first week. */
function mondayIndex(y: number, m: number): number {
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
