'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PERFORMANCE PAGE'S OWN PARTS — the owner's design, 2026-09-23
 * ----------------------------------------------------------------------------
 * ── ⚠️ A FIGURE NOBODY CAN TRACE DOES NOT GO ON THIS PAGE ─────────────────
 * This screen is read as a judgement about a named person. `Figure` therefore
 * refuses to draw a percentage that was computed from nothing: `null` renders
 * as "not measured yet", never as 0%, because 0% reads as *bad* and "no data"
 * reads as *no data*. The two must never look alike here.
 * ========================================================================= */

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'slate';

const TONE: Record<Tone, { bg: string; ink: string }> = {
  green: { bg: 'var(--feedback-success)', ink: 'var(--feedback-success)' },
  blue: { bg: 'var(--accent-primary)', ink: 'var(--accent-primary)' },
  amber: { bg: 'var(--feedback-warning)', ink: 'var(--feedback-warning)' },
  red: { bg: 'var(--feedback-error)', ink: 'var(--feedback-error)' },
  violet: { bg: 'var(--accent-gold)', ink: 'var(--text-gold)' },
  slate: { bg: 'var(--text-tertiary)', ink: 'var(--text-secondary)' },
};

export const tint = (tone: Tone, pct = 12) =>
  `color-mix(in oklab, ${TONE[tone].bg} ${pct}%, var(--bg-surface))`;
export const ink = (tone: Tone) => TONE[tone].ink;

/** One of the four figures across the top. */
export function StatCard({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  alarm = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone: Tone;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Draw the figure in the tone, not the ink — for a number that is bad news. */
  alarm?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3 shadow-xs">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: tint(tone, 14) }}>
        <Icon className="size-[1.15rem]" style={{ color: ink(tone) }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-caption text-text-secondary">{label}</span>
        <span
          className="block truncate text-[1.6rem] font-semibold leading-tight tabular-nums"
          style={alarm ? { color: ink(tone) } : undefined}
        >
          {value}
        </span>
        {sub && <span className="mt-0.5 block truncate text-micro text-text-secondary">{sub}</span>}
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
    return <span className={cn('text-caption text-text-tertiary', className)}>{whenEmpty}</span>;
  }
  return (
    <span className={cn('tabular-nums', className)}>
      {value}
      {suffix}
      {of !== undefined && of > 0 && <span className="ml-1 text-micro text-text-tertiary">of {of}</span>}
    </span>
  );
}

/** A small coloured word — the status of a row, or the kind of an event. */
export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium"
      style={{ background: tint(tone, 14), color: ink(tone) }}
    >
      {children}
    </span>
  );
}

/** The card every panel on this page sits in. */
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
    <section className={cn('rounded-xl border border-border-subtle bg-bg-surface shadow-xs', className)}>
      <div className="flex flex-wrap items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-sm font-semibold text-text-primary">{title}</h2>
          {description && <p className="mt-0.5 text-caption text-text-secondary">{description}</p>}
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
  return <p className="px-4 pb-4 text-caption text-text-secondary">{children}</p>;
}
