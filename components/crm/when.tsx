'use client';

import * as React from 'react';

/* ============================================================================
 * WHEN — Karachi wall-clock time, and the quick choices beside it
 * ----------------------------------------------------------------------------
 * ⚠️ KARACHI, NOT THE BROWSER'S ZONE. Every salesperson here works in it, and a
 * laptop set to UTC would otherwise book a 10 AM call at 3 PM. `karachi-not-utc`
 * in the memory notes is the bug this prevents: for five hours each evening the
 * date itself is different.
 *
 * Lived in `lead-followups-tab.tsx` until the New follow-up dialog needed the
 * same four choices — one copy, so "Tomorrow 10 AM" cannot mean two things.
 * ========================================================================= */

export const TZ = 'Asia/Karachi';
const KARACHI_OFFSET_H = 5;

export function karachiParts(ms: number) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/** A Karachi wall-clock moment, as an instant. */
export function karachiAt(y: number, m: number, d: number, h: number, mi = 0): number {
  return Date.UTC(y, m - 1, d, h - KARACHI_OFFSET_H, mi);
}

export function toInputValue(ms: number): string {
  const { y, m, d, h, mi } = karachiParts(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${y}-${two(m)}-${two(d)}T${two(h)}:${two(mi)}`;
}

export function fromInputValue(v: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!match) return null;
  const [, y, m, d, h, mi] = match.map(Number);
  return karachiAt(y, m, d, h, mi);
}

/** "Mon 14 Sep, 9:00 AM" — the reference's own form. */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
  const day = at.toLocaleDateString('en-GB', { day: 'numeric', timeZone: TZ });
  const month = at.toLocaleDateString('en-US', { month: 'short', timeZone: TZ });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return `${weekday} ${day} ${month}, ${time}`;
}

/** "Fri 19 Sep" — a day, with no time on it. */
export function formatDay(ms: number): string {
  const at = new Date(ms);
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
  const day = at.toLocaleDateString('en-GB', { day: 'numeric', timeZone: TZ });
  const month = at.toLocaleDateString('en-US', { month: 'short', timeZone: TZ });
  return `${weekday} ${day} ${month}`;
}

/** The quick choices, each computed at the moment it is pressed. */
export const QUICK_TIMES: ReadonlyArray<{ label: string; at: () => number }> = [
  { label: 'In 1 hour', at: () => Date.now() + 3_600_000 },
  {
    label: 'Tomorrow 10 AM',
    at: () => {
      const { y, m, d } = karachiParts(Date.now());
      return karachiAt(y, m, d + 1, 10);
    },
  },
  {
    label: 'In 3 days',
    at: () => {
      const { y, m, d } = karachiParts(Date.now());
      return karachiAt(y, m, d + 3, 10);
    },
  },
  {
    label: 'Next Monday',
    at: () => {
      const { y, m, d } = karachiParts(Date.now());
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return karachiAt(y, m, d + (((8 - dow) % 7) || 7), 10);
    },
  },
];

export function QuickTimes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {QUICK_TIMES.map((q) => (
        <button
          key={q.label}
          type="button"
          onClick={() => onChange(toInputValue(q.at()))}
          className="rounded-full border border-border-default px-2.5 py-1 text-caption text-text-primary transition-colors hover:bg-bg-subtle"
        >
          {q.label}
        </button>
      ))}
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Date and time"
        className="rounded-lg border border-border-default bg-bg-surface px-2.5 py-1 text-caption tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
      />
    </div>
  );
}
