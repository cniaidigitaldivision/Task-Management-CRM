'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlarmClock,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Gauge,
  PlayCircle,
  Send,
  Users,
} from 'lucide-react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE BENTO SURFACE
 * ----------------------------------------------------------------------------
 * The dashboard's tile vocabulary: a glass panel that leans towards the cursor,
 * lights up where the pointer is, and arrives in a choreographed sequence.
 *
 * ── ⚠️ ONE POINTER LISTENER FOR THE WHOLE GRID, NOT ONE PER TILE ────────────
 * Twelve tiles each with their own `pointermove` handler is twelve handlers
 * firing on every mouse movement, each doing its own `getBoundingClientRect`
 * — and a rect read forces layout. This wrapper listens once and writes the
 * tilt to whichever tile the pointer is actually over.
 *
 * ── ⚠️ WRITTEN TO THE NODE, NOT THROUGH STATE ───────────────────────────────
 * Pointer moves fire faster than a render loop should run. `setState` here
 * would re-render a tile's whole subtree — counters, charts and all — per
 * mouse movement. The transform is written straight to `style` inside a
 * requestAnimationFrame, one write per frame, and React never knows. That is
 * normally two owners of one property and forbidden; it is safe because nothing
 * else writes these two custom properties.
 * ========================================================================= */

/** Degrees of lean at the very corner. Small on purpose: at 12° the type
 *  smears and the tile reads as a novelty rather than as a surface. */
const MAX_TILT = 4.5;

/* ── ⚠️ AN ICON IS A NAME HERE, NEVER A COMPONENT ───────────────────────────
   This file is a Client Component and the dashboard page is a Server one. A
   lucide icon is a FUNCTION, and React cannot serialise a function across that
   boundary: it compiles, it lints, and it fails at runtime with *"Functions
   cannot be passed directly to Client Components"* — which is exactly what it
   did, four errors, one per metric tile, and the whole page fell back to its
   error state.

   The page names an icon; this map resolves it on the client side. An unknown
   name falls back rather than throwing, because a missing glyph must never take
   the dashboard down. Same rule the chart kit's `format` prop documents. */
const TILE_ICONS = {
  tasks: ClipboardList,
  progress: PlayCircle,
  done: CheckCircle2,
  overdue: AlarmClock,
  capacity: Gauge,
  published: Send,
  team: Users,
} as const;

export type TileIcon = keyof typeof TILE_ICONS;

export function BentoGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const raf = React.useRef(0);

  React.useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;

    let pending: { tile: HTMLElement; x: number; y: number } | null = null;

    const onMove = (event: PointerEvent) => {
      /* On a touch screen `pointermove` fires while a finger drags — mid-scroll
         that would wobble every tile the thumb passes over. */
      if (event.pointerType !== 'mouse') return;
      const tile = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tilt]');
      if (!tile) return;
      pending = { tile, x: event.clientX, y: event.clientY };

      if (raf.current) return;
      raf.current = window.requestAnimationFrame(() => {
        raf.current = 0;
        if (!pending) return;
        const { tile: target, x, y } = pending;
        const box = target.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        const fx = (x - box.left) / box.width - 0.5;
        const fy = (y - box.top) / box.height - 0.5;
        /* Leans TOWARDS the pointer: rotateX is positive when the pointer is
           high. A tile that tips away reads as recoiling. */
        target.style.setProperty('--tilt-x', `${(-fy * MAX_TILT).toFixed(2)}deg`);
        target.style.setProperty('--tilt-y', `${(fx * MAX_TILT).toFixed(2)}deg`);
        /* Where the sheen sits, as a percentage of the tile. */
        target.style.setProperty('--gleam-x', `${((x - box.left) / box.width) * 100}%`);
        target.style.setProperty('--gleam-y', `${((y - box.top) / box.height) * 100}%`);
      });
    };

    const onOut = (event: PointerEvent) => {
      const tile = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tilt]');
      if (!tile) return;
      /* Cleared, not zeroed: an identity transform still creates a containing
         block, and the tile's own hover lift should be free to work at rest. */
      tile.style.removeProperty('--tilt-x');
      tile.style.removeProperty('--tilt-y');
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerout', onOut);
    return () => {
      window.cancelAnimationFrame(raf.current);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerout', onOut);
    };
  }, []);

  return (
    <div ref={root} className={cn('grid gap-3', className)}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * A tile
 * ------------------------------------------------------------------------- */

export function Tile({
  title,
  eyebrow,
  action,
  index = 0,
  glow,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  eyebrow?: string;
  action?: { href: string; label: string };
  /** Position in the entrance sequence. */
  index?: number;
  /** A token name without the `--`; tints the tile's own light. */
  glow?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-tilt=""
      className={cn('bento-tile group', className)}
      style={
        {
          '--tile-index': index,
          ...(glow ? { '--tile-glow': `var(--${glow})` } : {}),
        } as React.CSSProperties
      }
    >
      {/* The sheen that follows the pointer. Painted above the surface and
          below the content, and inert so it can never eat a click. */}
      <span aria-hidden="true" className="bento-gleam" />

      {(title || action) && (
        <header className="relative flex items-start justify-between gap-3 px-3.5 pt-3 pb-1.5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-micro font-semibold tracking-[0.12em] text-text-tertiary uppercase">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="truncate text-body font-semibold text-text-primary">{title}</h2>
            )}
          </div>
          {action && (
            <Link
              href={action.href as never}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-semibold text-text-brand transition-colors hover:bg-bg-hover"
            >
              {action.label}
              <ArrowUpRight className="size-3" strokeWidth={2.5} aria-hidden="true" />
            </Link>
          )}
        </header>
      )}

      <div className={cn('relative min-h-0 flex-1 px-3.5 pb-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * The metric tile
 * ------------------------------------------------------------------------- */

export function MetricTile({
  label,
  value,
  icon,
  tone,
  delta,
  foot,
  series,
  index = 0,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** A NAME, not a component — see the note on `TILE_ICONS`. */
  icon: TileIcon;
  /** A token name without the `--`. */
  tone: string;
  delta?: { text: string; good: boolean };
  foot?: React.ReactNode;
  /**
   * The figure's own history, oldest first — drawn as a coloured trace.
   *
   * ⚠️ ONLY where the past is real. A line under a number is read as that
   * number's history, so a modelled one is a lie told in ink. The In Progress
   * tile passes nothing, because this product keeps no status history to
   * reconstruct it from — see `weeklyTaskShape`.
   */
  series?: readonly number[];
  index?: number;
  className?: string;
}) {
  const Icon = TILE_ICONS[icon] ?? ClipboardList;
  const ink = `var(--${tone})`;
  return (
    <section
      data-tilt=""
      className={cn('bento-tile group justify-between', className)}
      style={{ '--tile-index': index, '--tile-glow': ink } as React.CSSProperties}
    >
      <span aria-hidden="true" className="bento-gleam" />

      <div className="relative flex items-start justify-between gap-3 p-3.5 pb-1.5">
        <div className="min-w-0">
          <p className="truncate text-micro font-semibold tracking-[0.1em] text-text-tertiary uppercase">
            {label}
          </p>
          <p className="tabular mt-1.5 text-[1.75rem] leading-none font-bold text-text-primary">
            {value}
          </p>
        </div>
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(145deg, color-mix(in oklab, ${ink} 82%, white), ${ink})`,
            boxShadow: `0 8px 18px -8px color-mix(in oklab, ${ink} 70%, transparent)`,
          }}
        >
          <Icon className="size-[1.1rem]" strokeWidth={2.25} style={{ color: '#fff' }} aria-hidden="true" />
        </span>
      </div>

      {/* ── The trace ────────────────────────────────────────────────────────
          Owner, 2026-08-26: *"there are colored lines which are showing the
          progress. Also add them in my cards."* Full-bleed across the tile's
          foot and tinted with the tile's own tone, so a glance down the column
          reads as four different measures rather than four copies of one. */}
      {series && series.length > 1 && (
        <div className="relative -mb-1 px-3.5">
          <MiniTrace points={series} ink={ink} />
        </div>
      )}

      <div className="relative flex items-end justify-between gap-2 px-3.5 pb-3">
        {delta ? (
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold"
            style={{
              backgroundColor: `color-mix(in oklab, var(--${delta.good ? 'feedback-success' : 'feedback-error'}) 14%, transparent)`,
              color: `var(--${delta.good ? 'feedback-success' : 'feedback-error'})`,
            }}
          >
            {delta.text}
          </span>
        ) : (
          <span />
        )}
        {foot}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * MiniTrace — a metric's own history, in its own colour
 * ------------------------------------------------------------------------
 * ⚠️ NOT `Sparkline` from the metric kit. That one is a fixed-width SVG with a
 * flat fill, sized in pixels — right under a KPI number in a card of known
 * width, wrong stretched across a tile that resizes with the grid. This is a
 * 0–100 viewBox with `preserveAspectRatio="none"`, so it fills whatever width
 * the tile has without measuring anything.
 *
 * ⚠️ `vectorEffect="non-scaling-stroke"` is what stops the anisotropic viewBox
 * drawing a fat line on a wide tile and a hairline on a narrow one — the stroke
 * is in screen pixels while the path stretches.
 * ------------------------------------------------------------------------- */

function MiniTrace({ points, ink }: { points: readonly number[]; ink: string }) {
  const clean = points.filter((n) => Number.isFinite(n));
  if (clean.length < 2) return null;

  const max = Math.max(...clean);
  const min = Math.min(...clean);
  /* ⚠️ Never zero. A flat series would divide by nothing and put every vertex
     at NaN, which renders as no path at all — a silently missing line. */
  const span = max - min || 1;

  const at = (v: number, i: number) => ({
    x: (i / (clean.length - 1)) * 100,
    /* 12% of headroom top and bottom so a peak is not clipped by the frame. */
    y: 88 - ((v - min) / span) * 76,
  });

  const line = clean
    .map((v, i) => {
      const p = at(v, i);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-8 w-full overflow-visible"
      aria-hidden="true"
    >
      <path d={`${line} L 100 100 L 0 100 Z`} fill={`color-mix(in oklab, ${ink} 14%, transparent)`} />
      <path
        d={line}
        fill="none"
        stroke={ink}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
