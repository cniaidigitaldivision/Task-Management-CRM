'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * THE STUDIO'S SHARED FURNITURE
 * ----------------------------------------------------------------------------
 * Built to the owner's reference design, 2026-09-04: *"I need this UI to be
 * exactly the same: same colors, same positions, same sleekness."*
 *
 * ── ⚠️ THE PANEL IS TIGHTER THAN THE REST OF THE APPLICATION, DELIBERATELY ──
 * Owner: *"there should be no white space anywhere in the performance matrix."*
 * The reference packs eleven panels into one screen, so padding here is 14px
 * rather than the 16–20px a page like /reports uses, headings are `text-caption`
 * rather than `text-body-sm`, and the grid gap is 12px. That is a considered
 * departure for this page only — it is not a new house style, and copying these
 * numbers onto a reading page would make it feel cramped.
 * ========================================================================= */

/** Panel heading with the reference's small ⓘ affordance. */
export function Panel({
  title,
  info,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** The tooltip behind the ⓘ. Omitted when there is nothing worth saying. */
  info?: string;
  /** A dropdown or link, right-aligned in the header row. */
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border-subtle bg-bg-surface p-3.5',
        'shadow-[0_1px_2px_rgb(6_35_42_/_0.04)]',
        className,
      )}
    >
      <header className="mb-3 flex min-h-[1.6rem] items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 truncate text-caption font-semibold text-text-primary">
          {title}
          {info && (
            <span
              title={info}
              aria-label={info}
              className="grid size-3.5 shrink-0 cursor-help place-items-center rounded-full border border-border-default text-[0.55rem] font-bold text-text-tertiary"
            >
              i
            </span>
          )}
        </h2>
        {action}
      </header>
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/** The pill group the reference uses for Daily / Weekly / Monthly. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-micro transition-all duration-200',
            value === o.value
              ? 'bg-bg-surface font-semibold text-text-primary shadow-[0_1px_2px_rgb(6_35_42_/_0.08)]'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small select styled like the reference's "Countries ▾" / "By Engagement ▾". */
export function MiniSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-micro text-text-secondary transition-colors hover:border-border-default"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** The bottom-of-panel link — "View all posts →". */
export function PanelLink({ children, href }: { children: React.ReactNode; href?: string }) {
  const inner = (
    <>
      {children}
      <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </>
  );
  const cls =
    'group mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent py-1.5 text-micro font-medium text-text-brand transition-colors hover:border-border-subtle hover:bg-bg-subtle';

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <span className={cn(cls, 'cursor-default opacity-70')}>{inner}</span>
  );
}

/* ---- The KPI card -------------------------------------------------------- */

export interface KpiCardData {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly icon: LucideIcon;
  /** A chart-palette token name: `chart-1` … `chart-8`. */
  readonly token: string;
  readonly deltaText?: string | null;
  readonly deltaDirection?: 'up' | 'down' | 'flat';
  readonly footnote?: string;
  /** 0–1. Draws the reference's thin progress bar under the value. */
  readonly progress?: number;
  readonly progressNote?: string;
}

export function KpiCard({ data, index }: { data: KpiCardData; index: number }) {
  const Icon = data.icon;

  return (
    <div
      /* ⚠️ Staggered by index so the row assembles left to right rather than
         flashing in as one block. `backwards` keeps each card invisible during
         its own delay — without it every card paints immediately and then jumps,
         which reads as a glitch rather than an entrance. */
      className="motion-safe:animate-[studio-rise_420ms_cubic-bezier(0.16,1,0.3,1)_backwards] rounded-xl border border-border-subtle bg-bg-surface p-4 shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-shadow hover:shadow-[0_2px_10px_rgb(6_35_42_/_0.07)]"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      {/* ── ⚠️ THE ICON TILE IS 38px WITH A 19px GLYPH ────────────────────────
          Owner, holding the reference beside the build: *"our icons are very
          small right now. I want exact icons."* The first pass used a 28px tile
          with a 14px glyph, which measured about half the reference and made the
          row read as text with decoration rather than as cards. Measured off the
          reference: the tile is a little over a third of the card's height and
          the glyph fills half the tile. */}
      <div className="flex items-center gap-2.5">
        <span
          className="grid size-[38px] shrink-0 place-items-center rounded-[11px]"
          style={{ backgroundColor: `var(--${data.token}-wash)` }}
        >
          <Icon
            className="size-[19px]"
            strokeWidth={2.1}
            style={{ color: `var(--${data.token})` }}
            aria-hidden="true"
          />
        </span>
        <p className="min-w-0 flex-1 truncate text-caption font-semibold text-text-secondary">
          {data.label}
        </p>
      </div>

      <p className="mt-2.5 flex items-baseline gap-1.5">
        <span className="text-[1.75rem] font-bold leading-none tracking-tight tabular-nums text-text-primary">
          {data.value}
        </span>
        {data.unit && (
          <span className="text-caption font-medium text-text-tertiary">{data.unit}</span>
        )}
      </p>

      {data.progress !== undefined ? (
        <div className="mt-2.5">
          {data.footnote && (
            <p className="mb-1.5 text-micro text-text-secondary">{data.footnote}</p>
          )}
          <div className="h-[5px] overflow-hidden rounded-full bg-bg-subtle">
            <div
              className="h-full origin-left rounded-full motion-safe:animate-[studio-grow_700ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
              style={{
                width: `${Math.min(100, Math.max(0, data.progress * 100))}%`,
                backgroundColor: `var(--${data.token})`,
                animationDelay: `${index * 55 + 200}ms`,
              }}
            />
          </div>
          {data.progressNote && (
            <p className="mt-1.5 text-right text-micro text-text-tertiary">{data.progressNote}</p>
          )}
        </div>
      ) : (
        <div className="mt-2.5 flex min-h-[1rem] flex-wrap items-center gap-1.5">
          {data.deltaText && (
            <span
              className="inline-flex items-center gap-0.5 text-micro font-semibold"
              style={{
                color:
                  data.deltaDirection === 'up'
                    ? 'var(--feedback-success)'
                    : data.deltaDirection === 'down'
                      ? 'var(--feedback-error)'
                      : 'var(--text-tertiary)',
              }}
            >
              <span aria-hidden="true" className="text-[0.6rem]">
                {data.deltaDirection === 'up' ? '▲' : data.deltaDirection === 'down' ? '▼' : '•'}
              </span>
              {data.deltaText}
            </span>
          )}
          {data.footnote && (
            <span className="truncate text-micro text-text-tertiary">{data.footnote}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Empty state --------------------------------------------------------- */

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-[7rem] place-items-center rounded-lg border border-dashed border-border-subtle px-3 py-5 text-center">
      <p className="text-micro text-text-tertiary">{children}</p>
    </div>
  );
}
