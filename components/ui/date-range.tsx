'use client';

import * as React from 'react';
import { CalendarDays, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { ToolbarGroup, ToolbarLabel } from '@/components/ui/toolbar';

/* ============================================================================
 * A DUE-DATE RANGE, FOR A TOOLBAR
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23: *"I don't want that type of filter. I want a date range. I
 * hope you know the date range from when to when, right, so I can select the
 * date."*
 *
 * ── ⚠️ WHY THE "NEXT N DAYS" DROPDOWN IT REPLACES WAS WRONG ─────────────────
 * That control could only look FORWARD from today. So the question somebody
 * actually asks before writing a client report — "what went out between the 1st
 * and the 15th" — could not be expressed at all, and neither could "last week".
 * It answered the easy half of the question and hid the other half behind a
 * control that looked like it covered both.
 *
 * ── EITHER END MAY BE EMPTY ─────────────────────────────────────────────────
 * An empty box means unbounded on that side, so "everything from the 1st
 * onwards" is one date rather than a date plus a far-future one. Two empties is
 * no filter, which is the resting state.
 *
 * ── THE SHORTCUTS ARE NOT THE OLD DROPDOWN COMING BACK ──────────────────────
 * Today / This week / This month set BOTH ends of the same range the person can
 * then adjust. They are a faster way to type two dates, not a separate mode with
 * its own rules — which is what made the previous control unable to look
 * backwards.
 * ========================================================================= */

export function DateRange({
  from,
  to,
  today,
  onFrom,
  onTo,
  onClear,
}: {
  from: string;
  to: string;
  /** Resolved on the server, in the division's zone — see `isoDateIn`. */
  today: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onClear: () => void;
}) {
  const active = Boolean(from || to);

  const shortcut = (start: string, end: string) => {
    onFrom(start);
    onTo(end);
  };

  return (
    <ToolbarGroup>
      <ToolbarLabel>Due between</ToolbarLabel>

      <span className="inline-flex items-center gap-1">
        <CalendarDays className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <Input
          type="date"
          aria-label="Due on or after"
          value={from}
          max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
          className="h-8 w-[8.75rem] text-caption"
        />
        <span className="text-micro text-text-tertiary">to</span>
        <Input
          type="date"
          aria-label="Due on or before"
          value={to}
          min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
          className="h-8 w-[8.75rem] text-caption"
        />

        {active && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear the date range"
            title="Clear the date range"
            className="inline-flex size-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </span>

      <span className="flex items-center gap-1">
        <Shortcut label="Today" onClick={() => shortcut(today, today)} />
        <Shortcut label="This week" onClick={() => shortcut(weekStart(today), weekEnd(today))} />
        <Shortcut label="This month" onClick={() => shortcut(monthStart(today), monthEnd(today))} />
      </span>
    </ToolbarGroup>
  );
}

function Shortcut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-border-subtle px-1.5 py-0.5 text-micro text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
    >
      {label}
    </button>
  );
}

/* ── Date arithmetic on ISO strings, via Date.UTC ────────────────────────────
   These are date-only values with no instant behind them, so UTC is exact and a
   DST boundary cannot shift them — the trap `lib/domain/cadence.ts` documents.
   The division's week runs Monday to Sunday. */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function weekStart(todayIso: string): string {
  const at = parse(todayIso);
  /* getUTCDay: 0 = Sunday. Monday-first means Sunday is 6 days into the week. */
  const back = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - back);
  return iso(at);
}

function weekEnd(todayIso: string): string {
  const at = parse(weekStart(todayIso));
  at.setUTCDate(at.getUTCDate() + 6);
  return iso(at);
}

function monthStart(todayIso: string): string {
  return `${todayIso.slice(0, 7)}-01`;
}

function monthEnd(todayIso: string): string {
  const [y, m] = todayIso.split('-').map(Number);
  /* Day 0 of the next month is the last day of this one. */
  return iso(new Date(Date.UTC(y, m, 0)));
}
