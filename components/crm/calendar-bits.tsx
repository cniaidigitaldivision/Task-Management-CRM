'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { karachiAt, karachiParts } from '@/components/crm/when';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CALENDAR, AND THE FIELDS BESIDE IT — one copy
 * ----------------------------------------------------------------------------
 * The owner's date-and-time design is now used in two places: the follow-up
 * wizard (*"you can see how beautifully you can choose the time and date"*) and
 * the Appointments tab (*"properly I can get time, date, and everything very
 * interactively"*).
 *
 * ⚠️ ONE MONTH GRID, NOT TWO. Two copies of "which day is today, which days are
 * past, where does the month start" drift, and they drift into booking a visit on
 * a day that has gone — the one bug in this area a client would notice. Karachi
 * decides all three, because `karachi-not-utc` means the date itself is different
 * for five hours every evening.
 * ========================================================================= */

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'] as const;

export function calendarCells(y: number, m: number): ReadonlyArray<number | null> {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

/** Before today in Karachi — the whole day, not the instant. */
export function isPastDay(y: number, m: number, d: number, nowMs: number): boolean {
  const today = karachiParts(nowMs);
  return karachiAt(y, m, d, 23, 59) < karachiAt(today.y, today.m, today.d, 0, 0);
}

export function sameMinute(a: number, b: number): boolean {
  return Math.abs(a - b) < 60_000;
}

export function hour12(h: number): string {
  const hour = h % 24;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:00 ${suffix}`;
}

/** Every half hour, which is as fine as anybody books a visit or a call. */
export function timeOptions(): ReadonlyArray<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const mi of [0, 30]) {
      const suffix = h < 12 ? 'AM' : 'PM';
      const shown = h % 12 === 0 ? 12 : h % 12;
      out.push({
        value: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
        label: `${shown}:${String(mi).padStart(2, '0')} ${suffix}`,
      });
    }
  }
  return out;
}

/** Which day of the week a Karachi date falls on. 0 = Sunday. */
export function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function MonthGrid({
  month,
  onMonth,
  selected,
  onPick,
  nowMs,
  /** Days of the week to mark as closed — shown faint, still choosable. */
  closedDays = [],
  /**
   * Nothing on or before this instant may be picked.
   *
   * ⚠️ A CALENDAR MUST NOT OFFER WHAT THE FORM WILL REFUSE. A sequence step has
   * to fall strictly after the one before it — `planProblem` has said so all
   * along, because 170's one-chase-a-day cap would otherwise push the second to
   * tomorrow and the plan on screen would not be the plan that ran. Letting
   * somebody click the day and then rejecting it on save is the same rule
   * enforced in the least helpful possible place.
   */
  notOnOrBefore = null,
}: {
  month: { y: number; m: number };
  onMonth: (next: { y: number; m: number }) => void;
  selected: { y: number; m: number; d: number };
  onPick: (y: number, m: number, d: number) => void;
  nowMs: number;
  closedDays?: readonly number[];
  notOnOrBefore?: number | null;
}) {
  const today = karachiParts(nowMs);
  return (
    <div className="rounded-xl border border-border-subtle p-3">
      <div className="flex items-center justify-between">
        <IconButton
          label="Previous month"
          onClick={() => onMonth(month.m === 1 ? { y: month.y - 1, m: 12 } : { ...month, m: month.m - 1 })}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <p className="text-body-sm font-semibold text-text-primary">
          {MONTH_NAMES[month.m - 1]} {month.y}
        </p>
        <IconButton
          label="Next month"
          onClick={() => onMonth(month.m === 12 ? { y: month.y + 1, m: 1 } : { ...month, m: month.m + 1 })}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {DAY_LABELS.map((d) => (
          <span key={d} className="py-1 text-caption text-text-secondary">
            {d}
          </span>
        ))}
        {calendarCells(month.y, month.m).map((cell, i) => {
          if (cell === null) return <span key={`x${i}`} className="rounded-lg bg-bg-subtle/40" />;
          const on = selected.y === month.y && selected.m === month.m && selected.d === cell;
          const past =
            isPastDay(month.y, month.m, cell, nowMs) ||
            (notOnOrBefore !== null && karachiAt(month.y, month.m, cell, 12) <= notOnOrBefore);
          const isToday = today.y === month.y && today.m === month.m && today.d === cell;
          const closed = closedDays.includes(dayOfWeek(month.y, month.m, cell));
          return (
            <button
              key={cell}
              type="button"
              onClick={() => onPick(month.y, month.m, cell)}
              aria-pressed={on}
              aria-label={`${cell} ${MONTH_NAMES[month.m - 1]} ${month.y}${closed ? ' — closed' : ''}`}
              disabled={past}
              className={cn(
                'relative rounded-lg py-2 text-body-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                on
                  ? 'bg-accent-primary font-semibold text-white'
                  : cn(
                      'hover:bg-bg-subtle',
                      closed ? 'text-text-tertiary' : 'text-text-primary',
                      isToday && 'font-semibold ring-1 ring-inset ring-[var(--pick-border)]',
                    ),
              )}
            >
              {cell}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-caption text-text-secondary">{label}</span>
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-2">
        <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{children}</span>
      </span>
    </label>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
    >
      {children}
    </button>
  );
}

/** The underlined tab the owner's design uses above the calendar. */
export function PickerTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        /* ⚠️ THE OPEN TAB HAS TO BE UNMISTAKABLE, AND THE TABS NEED AIR. Owner,
           2026-09-18: *"nothing shows which tab is open. The tab selection is not
           visible properly and the tabs are very congested with each other."* A
           2px underline in the same grey as its neighbours is not a selected
           state. So: the brand teal, semibold, a tinted ground, a 3px bar, and
           real space between them — the same treatment the Related items dialog
           got for the same complaint. */
        'relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-body-sm transition-colors',
        active
          ? 'font-semibold text-accent-primary'
          : 'font-medium text-text-secondary hover:bg-bg-subtle/60 hover:text-text-primary',
      )}
      style={
        active
          ? { background: 'color-mix(in oklab, var(--accent-primary) 8%, transparent)' }
          : undefined
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {children}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent-primary"
        />
      )}
    </button>
  );
}

/** The teal day chips under "office hours". */
export function DayChips({
  days,
  onToggle,
  ariaLabel,
}: {
  days: readonly number[];
  onToggle?: (day: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {DAY_LABELS.map((label, i) => {
        const on = days.includes(i);
        const Chip = onToggle ? 'button' : 'span';
        return (
          <Chip
            key={label}
            {...(onToggle
              ? { type: 'button' as const, onClick: () => onToggle(i), 'aria-pressed': on }
              : {})}
            className={cn(
              'min-w-14 rounded-lg px-3 py-1.5 text-center text-caption font-medium transition-colors',
              on
                ? 'bg-accent-primary text-white'
                : 'bg-bg-subtle text-text-secondary',
              onToggle && 'hover:opacity-90',
            )}
          >
            {label}
          </Chip>
        );
      })}
    </div>
  );
}
