'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useInView } from './use-in-view';

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
  /* ⚠️ EVERY PANEL IS A REVEAL BOUNDARY. The gate is a class on the section, so
     one observer per panel holds everything inside it — charts, bars, rows — at
     its first frame until the panel is scrolled to. See styles/tokens.css. */
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      ref={ref}
      className={cn(
        'studio-reveal flex min-w-0 flex-col rounded-xl border border-border-subtle bg-bg-surface p-3.5',
        'shadow-[0_1px_2px_rgb(6_35_42_/_0.04)]',
        inView && 'is-visible',
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
      {/* ⚠️ `flex-1` WITHOUT `flex`, AND THE DIFFERENCE MATTERED. Making this a
          flex column let a list inside it distribute across the panel's height,
          which fixed the white space — and it also imposed a column on cards
          whose contents are a ROW. The Audience card's donut-and-legend pair got
          stacked and then wrapped into two columns, printing every percentage
          twice with a stray dot beside it.

          So the body only grows; the cards that want their child to fill it say
          so themselves with `bodyClassName="flex flex-col"`. A container should
          not decide the axis of contents it knows nothing about. */}
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
  /**
   * The card's own daily series, for the sparkline.
   *
   * ⚠️ REAL DATA OR NOTHING. Owner: *"is there any way to add a small graph
   * which will move upward?"* — and the answer is yes, from the same series the
   * big chart draws, so the shape here agrees with the panel below. A
   * decorative squiggle on a card of measured figures would be a lie the size
   * of the card.
   */
  readonly spark?: readonly (number | null)[];
  /**
   * The value is WORDS, not a figure.
   *
   * ⚠️ TWO CARDS NOW HOLD A PHRASE — "Most used: Monthly Client Report" and
   * "Sync health: Needs attention" — and at the numeric size they set their own
   * card three lines tall and left the whole KPI row ragged. A phrase also must
   * not count up: watching "Needs attention" tick from 0 would be absurd, and
   * `useCountUp` is skipped for it rather than left to no-op by accident.
   */
  readonly textValue?: boolean;
  /**
   * Paint the VALUE in a token, not just the icon.
   *
   * ⚠️ For the one card whose value is a verdict rather than a quantity. In the
   * owner's reference "Excellent" is green, and the colour is doing real work —
   * it is the only thing on the card that distinguishes a healthy fleet from a
   * broken one at a glance, because both read as one short phrase.
   */
  readonly valueToken?: string;
}

/**
 * Counts up to a target on mount.
 *
 * ⚠️ ONE rAF LOOP, and it lands EXACTLY on the target rather than wherever the
 * last frame fell — a card that settles on 47 when the figure is 48 is worse
 * than one that never animated. Honours prefers-reduced-motion by starting at
 * the target, because the global CSS guard cannot reach a JS animation.
 */
function useCountUp(target: number, duration = 1400, delay = 0, active = true): number {
  const [value, setValue] = React.useState(target);

  React.useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    /* ⚠️ A CSS class cannot pause a JavaScript animation, so the count-up is
       gated on the same `inView` flag explicitly. Without this the digits would
       have finished counting before the card was ever on screen. */
    if (!active) return;

    if (reduced || !Number.isFinite(target)) {
      const settle = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(settle);
    }

    let raf = 0;
    const started = performance.now() + delay;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);

    const frame = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - started) / duration));
      setValue(target * ease(t));
      if (t < 1) raf = requestAnimationFrame(frame);
      else setValue(target);
    };

    /* ⚠️ Scheduled, not called from the effect body — React's
       `set-state-in-effect` rule refuses the synchronous form, and rightly: a
       setState during the effect pass forces a second render before the browser
       has painted the first. Starting from zero inside the first frame costs
       nothing and reads identically. */
    raf = requestAnimationFrame((now) => {
      setValue(0);
      frame(now);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay, active]);

  return value;
}

/** The card's series as a filled line, ~34px tall. */
export function Sparkline({ points, token }: { points: readonly (number | null)[]; token: string }) {
  const real = points.filter((p): p is number => p !== null && Number.isFinite(p));
  if (real.length < 2) return null;

  const W = 100;
  const H = 26;
  const max = Math.max(...real);
  const min = Math.min(...real);
  const span = max - min || 1;

  /* ⚠️ The pen lifts on a gap, as it does in the big chart — a sparkline that
     bridges a missing week shows a trend that did not happen. */
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p === null || !Number.isFinite(p)) {
      pen = false;
      return;
    }
    const x = (i / Math.max(1, points.length - 1)) * W;
    const y = H - ((p - min) / span) * (H - 3) - 1.5;
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  });

  const last = points.reduce<{ x: number; y: number } | null>((acc, p, i) => {
    if (p === null || !Number.isFinite(p)) return acc;
    return {
      x: (i / Math.max(1, points.length - 1)) * W,
      y: H - ((p - min) / span) * (H - 3) - 1.5,
    };
  }, null);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-[26px] w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${token}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(--${token})`} stopOpacity="0.28" />
          <stop offset="100%" stopColor={`var(--${token})`} stopOpacity="0" />
        </linearGradient>
      </defs>

      {d && (
        <>
          <path d={`${d}L${W} ${H} L0 ${H} Z`} fill={`url(#spark-${token})`} />
          <path
            d={d}
            fill="none"
            stroke={`var(--${token})`}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            style={
              {
                '--line-length': 1,
                strokeDashoffset: 1,
                strokeDasharray: 1,
                animation: 'line-draw 1400ms cubic-bezier(0.4,0,0.2,1) 260ms forwards',
              } as React.CSSProperties
            }
          />
          {last && (
            <circle
              cx={last.x}
              cy={last.y}
              r="2"
              fill={`var(--${token})`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </>
      )}
    </svg>
  );
}

export function KpiCard({ data, index }: { data: KpiCardData; index: number }) {
  const Icon = data.icon;
  /* Its own boundary — the cards sit directly in the grid, not in a Panel. */
  const { ref, inView } = useInView<HTMLDivElement>();

  /* ⚠️ COUNTS THE NUMBER, NOT THE STRING. The value arrives formatted ("230K",
     "0.14%") because the caller knows how to write it; the digits are parsed out
     to animate and the ORIGINAL string is what lands at the end, so the settled
     card always reads exactly what the caller intended. */
  const numeric = Number.parseFloat(String(data.value).replace(/[^0-9.-]/g, ''));
  const counted = useCountUp(
    Number.isFinite(numeric) ? numeric : 0,
    1400,
    index * 80,
    /* A phrase never counts — see `textValue`. */
    inView && !data.textValue,
  );
  const settled = Math.abs(counted - numeric) < 0.01;

  const shown =
    data.textValue || settled
      ? data.value
      : String(data.value).replace(
          /[\d.,]+/,
          counted >= 100 ? String(Math.round(counted)) : counted.toFixed(2),
        );

  return (
    <div
      /* ⚠️ A TINTED TOP EDGE RATHER THAN A HEAVIER SHADOW. Owner: *"add some box
         shadow or some gradient of a box shadow so it will look beautiful."* A
         deeper drop shadow on seven cards in a row reads as clutter; a 2px band
         of the card's own hue at the top ties the figure to its icon and costs
         no height — which matters, because the same instruction asked for these
         to be SHORTER. */
      ref={ref}
      className={`studio-reveal group relative overflow-hidden rounded-xl border border-border-subtle bg-bg-surface px-3 pb-2.5 pt-3 shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.09)] motion-safe:animate-[studio-rise_620ms_cubic-bezier(0.16,1,0.3,1)_backwards] ${inView ? 'is-visible' : ''}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, var(--${data.token}), color-mix(in oklab, var(--${data.token}) 25%, transparent))`,
        }}
      />

      <div className="flex items-center gap-2">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px] transition-transform duration-300 group-hover:scale-105"
          /* ⚠️ A FALLBACK, BECAUSE `-wash` ONLY EXISTS FOR THE CHART TOKENS.
             `--chart-1-wash` is a real declared token; `--feedback-success-wash`
             is NOT, and the Sync Health card asked for exactly that — so its
             icon chip painted with an undefined variable and came out
             transparent. The icon sat on nothing, which is what the owner saw.

             `var(--x, fallback)` uses the fallback only when `--x` is
             undeclared, so every existing card keeps its hand-tuned wash (0.12
             light / 0.18 dark) byte for byte and only the feedback tokens
             derive one. */
          style={{
            backgroundColor: `var(--${data.token}-wash, color-mix(in oklab, var(--${data.token}) 14%, transparent))`,
          }}
        >
          <Icon
            className="size-[17px]"
            strokeWidth={2.1}
            style={{ color: `var(--${data.token})` }}
            aria-hidden="true"
          />
        </span>
        <p className="min-w-0 flex-1 truncate text-micro font-semibold text-text-secondary">
          {data.label}
        </p>
      </div>

      <p className="mt-1.5 flex items-baseline gap-1">
        <span
          className={
            data.textValue
              ? /* ⚠️ `min-h` MATCHES THE NUMERIC LINE so a phrase card is exactly
                   as tall as the figures beside it. Without it the row's cards
                   settle at two different heights and the grid looks broken. */
                'line-clamp-2 flex min-h-[1.6rem] items-center text-body-sm font-bold leading-tight text-text-primary'
              : 'text-[1.6rem] font-bold leading-none tracking-tight tabular-nums text-text-primary'
          }
          style={data.valueToken ? { color: `var(--${data.valueToken})` } : undefined}
          title={data.textValue ? String(data.value) : undefined}
        >
          {shown}
        </span>
        {data.unit && <span className="text-micro text-text-tertiary">{data.unit}</span>}
      </p>

      {data.spark && data.spark.length > 1 ? (
        <Sparkline points={data.spark} token={data.token} />
      ) : data.progress !== undefined ? (
        <div className="mt-2">
          <div className="h-[4px] overflow-hidden rounded-full bg-bg-subtle">
            <div
              className="h-full origin-left rounded-full motion-safe:animate-[studio-grow_1100ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
              style={{
                width: `${Math.min(100, Math.max(0, data.progress * 100))}%`,
                backgroundColor: `var(--${data.token})`,
                animationDelay: `${index * 80 + 280}ms`,
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-1.5 flex min-h-[0.95rem] flex-wrap items-center gap-x-1.5">
        {data.deltaText && (
          <span
            className="inline-flex items-center gap-0.5 text-[0.62rem] font-bold"
            style={{
              color:
                data.deltaDirection === 'up'
                  ? 'var(--feedback-success)'
                  : data.deltaDirection === 'down'
                    ? 'var(--feedback-error)'
                    : 'var(--text-tertiary)',
            }}
          >
            <span aria-hidden="true" className="text-[0.55rem]">
              {data.deltaDirection === 'up' ? '\u25B2' : data.deltaDirection === 'down' ? '\u25BC' : '\u2022'}
            </span>
            {data.deltaText}
          </span>
        )}
        {(data.progressNote ?? data.footnote) && (
          <span className="truncate text-[0.62rem] text-text-tertiary">
            {data.progressNote ?? data.footnote}
          </span>
        )}
      </div>
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
