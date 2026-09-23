'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PERFORMANCE PAGE'S OWN PARTS — the owner's reference, 2026-09-23
 * ----------------------------------------------------------------------------
 * *"I want this performance page UI to be exactly the same as you see in the
 * screenshot."*
 *
 * ── ⚠️ EVERY COLOUR IS A `--pf-*` TOKEN, SAMPLED FROM THE PNG ─────────────
 * This file used to mix each hue with the page's text colour through a shared
 * `ink()` helper. That is exactly what made the Clients page come out "mostly
 * green" when the design was multicoloured, and the same helper was in here.
 * It is gone. The palette lives in `.perf-ui` in styles/tokens.css and every
 * value there is the measured colour of a region of the reference image.
 *
 * ── ⚠️ A FIGURE NOBODY CAN TRACE DOES NOT GO ON THIS PAGE ─────────────────
 * This screen is read as a judgement about a named person. `Figure` therefore
 * refuses to draw a percentage computed from nothing: `null` renders as "Not
 * measured yet", never as 0%, because 0% reads as *bad* and "no data" reads as
 * *no data*. The two must never look alike here.
 * ========================================================================= */

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'slate';

/** Fill / ink pairs, straight from the sampled tokens. No mixing. */
const TONE: Record<Tone, { bg: string; ink: string }> = {
  green: { bg: 'var(--pf-green-bg)', ink: 'var(--pf-green)' },
  blue: { bg: 'var(--pf-blue-bg)', ink: 'var(--pf-blue)' },
  amber: { bg: 'var(--pf-amber-bg)', ink: 'var(--pf-amber)' },
  /* ⚠️ THE ALARM IS THE ONE THAT IS SOLID. In the reference the completed,
     on-time and review badges are pale discs with a coloured glyph; the overdue
     one is a SOLID red disc with a white glyph, sitting inside a pale red halo.
     That difference is the whole reason the eye lands on it first, so StatCard
     draws the inner disc rather than flattening all four to one shape. */
  red: { bg: 'var(--pf-red-bg)', ink: 'var(--pf-red-ink)' },
  violet: { bg: 'var(--pf-violet-card)', ink: 'var(--pf-violet)' },
  slate: { bg: 'var(--pf-strip)', ink: 'var(--pf-soft)' },
};

export const toneBg = (tone: Tone) => TONE[tone].bg;
export const toneInk = (tone: Tone) => TONE[tone].ink;

/* ── The row of four figures across the top ──────────────────────────────── */

export function StatCard({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone: Tone;
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
    strokeWidth?: number | string;
  }>;
}) {
  return (
    <div
      className="flex items-start gap-[1.11rem] rounded-[0.95rem] border px-[0.9rem] py-[1.4rem]"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <span
        className="grid size-[2.78rem] shrink-0 place-items-center rounded-full"
        style={{ background: toneBg(tone) }}
      >
        {tone === 'red' ? (
          <span
            className="grid size-[2.3rem] place-items-center rounded-full"
            style={{ background: 'var(--pf-red)' }}
          >
            <Icon
              className="size-[1.35rem]"
              strokeWidth={2.2}
              style={{ color: 'var(--pf-on-solid)' }}
              aria-hidden="true"
            />
          </span>
        ) : (
          <Icon
            className="size-[1.55rem]"
            /* ⚠️ HEAVIER THAN LUCIDE'S DEFAULT 2. The reference's glyphs are
               drawn thick enough to read as symbols rather than outlines, and at
               this size the 2px default looks like a different icon set. */
            strokeWidth={2.4}
            style={{ color: toneInk(tone) }}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-[0.845rem] font-semibold leading-[1.3]"
          style={{ color: 'var(--pf-label)' }}
        >
          {label}
        </span>
        <span
          /* ⚠️ EVERY FIGURE IS THE SAME NEAR-BLACK, INCLUDING THE OVERDUE ONE.
             Sampled from the reference: its "3" under Open overdue is #000017,
             the same ink as the other three. The alarm there is the SOLID red
             disc beside it, not a red number — and doing both would make an
             ordinary week look like an emergency. */
          className="mt-[0.15rem] block truncate text-[1.78rem] font-bold leading-[1.15] tabular-nums"
          style={{ color: 'var(--pf-ink)' }}
        >
          {value}
        </span>
        {/* ⚠️ NO `truncate` HERE. The reference's own sub-line only fits
            because its figures are one and two digits; ours run to three, and
            the owner has already caught this page's sibling cutting a value off
            ("each value should be displayed properly"). It wraps instead, and
            the grid keeps all four cards the same height. */}
        {sub && (
          <span
            className="mt-[0.3rem] block text-[0.79rem] leading-[1.35]"
            style={{ color: 'var(--pf-sub)' }}
          >
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * A measured figure, or an honest refusal.
 *
 * ⚠️ `null` IS NOT ZERO. A person with no deadline in the period has no on-time
 * rate — saying 0% would report them as having missed everything.
 */
export function Figure({
  value,
  suffix = '',
  of,
  whenEmpty = 'Not measured yet',
  className,
}: {
  value: number | null;
  suffix?: string;
  /** How many rows it came from. Shown so a 100% from one task reads honestly. */
  of?: number;
  whenEmpty?: string;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={cn('text-[0.87rem]', className)} style={{ color: 'var(--pf-mute)' }}>
        {whenEmpty}
      </span>
    );
  }
  return (
    <span className={cn('tabular-nums', className)}>
      {value}
      {suffix}
      {of !== undefined && of > 0 && (
        <span className="ml-1 text-[0.78rem]" style={{ color: 'var(--pf-mute)' }}>
          of {of}
        </span>
      )}
    </span>
  );
}

/** A small coloured word — the status of a row, or the kind of an event. */
export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-[0.6rem] py-[0.15rem] text-[0.78rem] font-medium"
      style={{ background: toneBg(tone), color: toneInk(tone) }}
    >
      {children}
    </span>
  );
}

/* ── The card every panel on this page sits in ───────────────────────────── */

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('overflow-hidden rounded-[0.95rem] border', className)}
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <div className="flex flex-wrap items-center gap-3 px-[1.22rem] pb-[0.95rem] pt-[1.15rem]">
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.25rem] font-bold leading-[1.25]" style={{ color: 'var(--pf-ink)' }}>
            {title}
          </h2>
          {description && (
            <p className="mt-[0.2rem] text-[0.88rem] leading-[1.35]" style={{ color: 'var(--pf-soft)' }}>
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Said when a panel has nothing in it.
 *
 * ⚠️ IT SAYS WHY, NOT JUST "NONE". "No data" on a performance page reads as an
 * accusation; "nothing was recorded, and here is what would record it" is the
 * truth and tells somebody what to do about it.
 */
export function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="border-t px-[1.22rem] py-[1.15rem] text-[0.88rem]"
      style={{ borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
    >
      {children}
    </p>
  );
}

/* ── The filter row ──────────────────────────────────────────────────────── */

/**
 * One of the four pills under the tabs.
 *
 * ⚠️ A REAL `<select>` UNDER THE PILL. The reference draws a custom control;
 * reproducing it with a listbox would cost keyboard support, the native picker
 * on a phone, and form semantics, for a chevron we can draw anyway. The select
 * is transparent and stretched over the pill, so the pill IS the hit target.
 */
export function FilterPill({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  title,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  title: string;
}) {
  return (
    <span
      className="relative inline-flex items-center gap-[0.55rem] rounded-[0.7rem] border py-[0.75rem] pl-[0.72rem] pr-[0.58rem]"
      style={{
        background: 'var(--pf-field)',
        borderColor: 'var(--pf-field-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <Icon className="size-[0.98rem] shrink-0" style={{ color: 'var(--pf-soft)' }} aria-hidden="true" />
      <span
        className="max-w-[11rem] truncate text-[0.83rem] leading-none"
        style={{ color: 'var(--pf-body)' }}
      >
        {label}
      </span>
      <ChevronDown className="size-[0.95rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
      <select
        aria-label={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
