'use client';

import * as React from 'react';

import type { StudioPost } from '@/lib/domain/meta-studio';
import { POST_MEASURE_LABEL, measureOf, type PostMeasure } from '@/lib/domain/meta-analytics';

/* ============================================================================
 * THE ENGAGEMENT HEATMAP
 * ----------------------------------------------------------------------------
 * Owner's reference, 2026-09-04: seven rows of hours, blue by intensity, with a
 * low-to-high legend beneath.
 *
 * ── ⚠️ IT IS ENGAGEMENT BY *PUBLISHING* TIME, AND THE TOOLTIP SAYS SO ───────
 * The reference implies "when your audience is active", which is a different and
 * more valuable thing. We cannot draw that: Meta reports engagement DAILY in the
 * metrics this system collects, with no hour attached, and there is no hourly
 * series to be had for the asking.
 *
 * What we do have is every post's exact `posted_at` and its engagement. So each
 * cell is: the engagement earned by posts PUBLISHED in that weekday-and-hour
 * slot. That answers a real question a coordinator actually has — "what time of
 * day do our posts do best?" — and it answers it from measured data.
 *
 * Labelling it "when your audience is online" would be a guess wearing a
 * measurement's clothes, so it is labelled as what it is.
 *
 * ── ⚠️ TWO-HOUR BUCKETS, NOT TWENTY-FOUR COLUMNS ───────────────────────────
 * 7 × 24 is 168 cells and this account has 50 posts, so a per-hour grid would be
 * 97% empty and read as broken. Twelve two-hour columns keeps the reference's
 * shape and its 12AM/4AM/8AM/12PM/4PM/8PM labels while giving each cell a
 * plausible chance of holding something.
 * ========================================================================= */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const BUCKETS = 12; // two hours each
const HOUR_LABELS = ['12AM', '4AM', '8AM', '12PM', '4PM', '8PM'];

export function EngagementHeatmap({
  posts,
  measure = 'engagements',
}: {
  posts: readonly StudioPost[];
  /* ⚠️ THE SAME MEASURE VOCABULARY AS THE WEEKDAY BARS BESIDE IT, from
     `measureOf` — two charts on one row reading the same word differently is
     the kind of quiet inconsistency nobody reports and everybody misreads. */
  measure?: PostMeasure;
}) {
  const [hover, setHover] = React.useState<{ d: number; b: number } | null>(null);

  const { grid, peak, total } = React.useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array<number>(BUCKETS).fill(0));
    let max = 0;
    let sum = 0;

    for (const p of posts) {
      const at = new Date(p.postedAt);
      /* ⚠️ Karachi, not the server's clock and not the reader's. Every other
         date boundary in this system is the division's own day; a heatmap that
         silently used UTC would put a 2am Karachi post in the previous evening. */
      const local = new Date(at.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
      const dow = (local.getDay() + 6) % 7; // Monday first
      const bucket = Math.min(BUCKETS - 1, Math.floor(local.getHours() / 2));

      const value = measureOf(p, measure);
      g[dow][bucket] += value;
      sum += value;
      if (g[dow][bucket] > max) max = g[dow][bucket];
    }

    return { grid: g, peak: max, total: sum };
  }, [posts, measure]);

  if (total === 0) {
    return (
      <div className="grid h-full min-h-[7rem] place-items-center rounded-lg border border-dashed border-border-subtle">
        <p className="text-micro text-text-tertiary">
          No posts with {POST_MEASURE_LABEL[measure].toLowerCase()} in this period.
        </p>
      </div>
    );
  }

  /* ⚠️ A SQUARE-ROOT SCALE, not linear. One viral post can be fifty times any
     other cell, and on a linear ramp that leaves every other slot the palest
     shade — a map showing one square. The root keeps the peak distinct while
     letting the ordinary slots separate from each other. */
  const shade = (v: number) => (peak <= 0 ? 0 : Math.sqrt(v / peak));

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 gap-1.5">
        {/* Day labels */}
        <div className="flex shrink-0 flex-col justify-between py-px">
          {DAYS.map((d) => (
            <span key={d} className="text-[0.56rem] leading-none text-text-tertiary">
              {d}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${BUCKETS}, 1fr)` }}>
            {grid.map((row, d) =>
              row.map((v, b) => {
                const t = shade(v);
                const on = hover?.d === d && hover?.b === b;
                return (
                  <button
                    key={`${d}-${b}`}
                    type="button"
                    aria-label={`${DAYS[d]} ${formatHour(b)}: ${v} engagements`}
                    onMouseEnter={() => setHover({ d, b })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ d, b })}
                    onBlur={() => setHover(null)}
                    /* ⚠️ NOT `aspect-square`. Twelve square cells across a
                       third-width panel force a grid taller than the reference's
                       whole card; a fixed 13px row keeps seven days compact and
                       still leaves each cell comfortably clickable. */
                    className="h-[13px] w-full rounded-[3px] transition-transform motion-safe:animate-[studio-rise_520ms_ease-out_backwards]"
                    style={{
                      backgroundColor:
                        v === 0
                          ? 'var(--bg-subtle)'
                          : `color-mix(in oklab, var(--chart-4) ${Math.round(14 + t * 86)}%, var(--bg-surface))`,
                      outline: on ? '2px solid var(--chart-4)' : 'none',
                      outlineOffset: '1px',
                      animationDelay: `${(d * BUCKETS + b) * 9}ms`,
                    }}
                  />
                );
              }),
            )}
          </div>

          {/* Hour labels, every second bucket, as the reference sets them. */}
          <div
            className="mt-1 grid text-[0.56rem] text-text-tertiary"
            style={{ gridTemplateColumns: `repeat(${BUCKETS / 2}, 1fr)` }}
          >
            {HOUR_LABELS.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>
      </div>

      {/* The readout replaces the grid's own tooltip — at this cell size a
          floating box covers the neighbours you are comparing against. */}
      <p className="mt-1.5 min-h-[0.9rem] text-[0.58rem] text-text-secondary">
        {hover ? (
          <>
            <strong className="font-semibold text-text-primary">
              {DAYS[hover.d]} {formatHour(hover.b)}
            </strong>{' '}
            — {grid[hover.d][hover.b].toLocaleString()}{' '}
            {POST_MEASURE_LABEL[measure].toLowerCase()} from posts published then
          </>
        ) : (
          <span className="text-text-tertiary">Hover a cell for its total.</span>
        )}
      </p>

      {/* Legend */}
      <div className="mt-auto flex items-center gap-1.5 pt-2">
        <span className="text-[0.6rem] text-text-tertiary">Low</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="h-2.5 flex-1 rounded-[2px]"
            style={{
              backgroundColor: `color-mix(in oklab, var(--chart-4) ${Math.round(14 + t * 86)}%, var(--bg-surface))`,
            }}
          />
        ))}
        <span className="text-[0.6rem] text-text-tertiary">High</span>
      </div>
    </div>
  );
}

function formatHour(bucket: number): string {
  const start = bucket * 2;
  const label = (h: number) => (h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`);
  return `${label(start)}–${label((start + 2) % 24)}`;
}
