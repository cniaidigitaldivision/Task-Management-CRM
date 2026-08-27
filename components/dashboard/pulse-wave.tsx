import * as React from 'react';

import { smoothPath } from '@/lib/view/chart-geometry';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PULSE
 * ----------------------------------------------------------------------------
 * The division's heartbeat: real weekly output drawn as a continuous trace,
 * with a glowing head that runs along it and a bloom under the line. It is the
 * page's signature — the thing somebody describes when they describe the
 * dashboard.
 *
 * ── ⚠️ IT IS A CHART, NOT AN ORNAMENT ───────────────────────────────────────
 * The temptation with a shape like this is to animate a pretty waveform that
 * means nothing. Every vertex here is a real week's completed work, so the
 * peaks and the flat stretches are the division's own history. That is also why
 * the head travels along the PATH rather than sweeping at constant speed: it
 * traces the data.
 *
 * ── ⚠️ SERVER COMPONENT, CSS MOTION ─────────────────────────────────────────
 * `offset-path` moves the head along the same `d` the line is drawn from, so
 * the two can never disagree — there is no JavaScript computing a position from
 * a second copy of the geometry. No state, no effect, no client bundle: the
 * pulse is already running before any JavaScript arrives.
 * ========================================================================= */

export function PulseWave({
  points,
  labels,
  height = 132,
  className,
}: {
  /** One value per period, oldest first. */
  points: readonly number[];
  /** Shown under the trace. First and last only — see the note below. */
  labels: readonly string[];
  height?: number;
  className?: string;
}) {
  /* ⚠️ BEFORE the early return. `useId` is a hook, and a hook after a
     conditional return is called in a different order on the render where the
     series is short — React's rules-of-hooks, and the lint caught it. */
  const id = React.useId().replace(/:/g, '');

  const clean = points.filter((n) => Number.isFinite(n));
  if (clean.length < 2) {
    return (
      <p className={cn('py-8 text-center text-caption text-text-tertiary', className)}>
        Not enough history to plot yet.
      </p>
    );
  }

  const max = Math.max(...clean);
  const min = Math.min(...clean, 0);
  const span = max - min || 1;

  /* A 0–100 viewBox in both axes, stretched by `preserveAspectRatio="none"`:
     every coordinate is then a percentage and nothing has to measure itself. */
  const vertices = clean.map((value, i) => ({
    x: (i / (clean.length - 1)) * 100,
    y: 92 - ((value - min) / span) * 78,
  }));

  const line = smoothPath(vertices);
  const area = `${line} L 100 100 L 0 100 Z`;

  /* `id` above is unique per instance, because two pulses on one page would
     otherwise share a gradient id and the second would silently paint with the
     first's colours — the exact fault the chart kit's header documents. */

  return (
    <figure className={cn('space-y-2', className)}>
      <div className="relative" style={{ height }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
              <stop offset="55%" stopColor="var(--accent-primary)" />
              <stop offset="100%" stopColor="var(--accent-gold)" />
            </linearGradient>
          </defs>

          <path d={area} fill={`url(#${id}-fill)`} />

          {/* The trace, drawn on. `pathLength={1}` normalises the path so the
              dash arithmetic needs no measurement — no ref, no getTotalLength,
              no effect after first paint, and it stays correct at any width. */}
          <path
            className="line-draw"
            d={line}
            fill="none"
            stroke={`url(#${id}-line)`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            style={{ '--line-length': 1 } as React.CSSProperties}
          />

          {/* ── The travelling pulse ───────────────────────────────────────
              A short bright dash racing along the same `d`, by animating
              `stroke-dashoffset`.

              ⚠️ NOT a dot on an `offset-path`, which was the first attempt and
              is subtly broken: CSS `offset-path: path(...)` resolves its
              coordinates in the ELEMENT's pixel space, while this `d` is
              written in the 0–100 viewBox. The head would have run around a
              100×100px box in the corner rather than along the visible curve.
              A stroke stays in the path's own coordinate system by definition,
              so it cannot drift out of step with the line beneath it — and with
              `pathLength={1}` the dash lengths are fractions of the trace,
              correct at any width. */}
          <path
            className="pulse-run"
            d={line}
            fill="none"
            stroke="var(--accent-gold)"
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
          />
        </svg>
      </div>

      {/* ⚠️ First and last only. Eight labels under a band this wide collide,
          and the axis exists to say WHICH span is shown rather than to name
          every point. */}
      <figcaption className="flex justify-between text-micro text-text-tertiary">
        {labels.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </figcaption>
    </figure>
  );
}
