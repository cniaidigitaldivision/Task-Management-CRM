import { cn } from '@/lib/utils';

/* ============================================================================
 * SKELETONS — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * *"I want full structured loading. If the page is loading and there is nothing
 * to view, just show the structure view so that someone who's waiting for the
 * screen to load understands that this kind of view is going to come."*
 *
 * ── THE POINT IS THE SHAPE, NOT THE SHIMMER ──────────────────────────────────
 * A generic grey box says "wait". A skeleton in the *same arrangement as the real
 * page* says "four figures, then a chart, then a list of what needs deciding" —
 * so the wait is spent orienting rather than wondering. That is the difference
 * the owner asked for, and it is why these are composites shaped to each screen
 * rather than one reusable blob.
 *
 * ── NOTHING MAY SHIFT WHEN THE DATA LANDS ────────────────────────────────────
 * Every composite matches the real component's padding, radius and height. A
 * skeleton that is a few pixels short is worse than none: the page jumps at the
 * exact moment somebody has started reading it. Where a real height is set by
 * content that cannot be known in advance, the skeleton uses the height of the
 * *typical* case and the container is allowed to grow — never the reverse.
 *
 * ── SERVER COMPONENTS, DELIBERATELY ──────────────────────────────────────────
 * No `'use client'`. These render on the server inside `loading.tsx`, so they
 * cost no JavaScript at all — which matters, because they exist precisely for the
 * moment when the page's own JavaScript has not arrived.
 *
 * The sweep is CSS (`.skeleton` in styles/tokens.css) and it stops under
 * `prefers-reduced-motion`, leaving the shape — which was the useful part.
 * ========================================================================= */

/**
 * One placeholder.
 *
 * `aria-hidden` throughout: a screen reader gains nothing from being told the
 * shape of what has not arrived. The announcement belongs on the region, once —
 * see `SkeletonPage`.
 */
export function Skeleton({
  className,
  rounded = 'md',
}: {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  const radius = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  }[rounded];

  return <span aria-hidden="true" className={cn('skeleton block', radius, className)} />;
}

/**
 * A line of text.
 *
 * Widths vary because real prose does. A stack of identical bars reads as a
 * loading graphic; three lines of 100%, 92% and 64% read as a paragraph.
 */
export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ['w-full', 'w-[92%]', 'w-[64%]', 'w-[88%]', 'w-[71%]'];

  return (
    <span aria-hidden="true" className={cn('block space-y-1.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} rounded="sm" className={cn('h-3', widths[i % widths.length])} />
      ))}
    </span>
  );
}

/**
 * The whole loading region.
 *
 * One `role="status"` with one polite label, wrapping everything. Announcing each
 * placeholder would produce a stream of nonsense; announcing nothing leaves a
 * screen-reader user on a silent page wondering whether it worked.
 */
export function SkeletonPage({
  children,
  label = 'Loading',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto max-w-[var(--content-max)] space-y-8"
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* ==========================================================================
 * COMPOSITES — each mirrors a real component
 * ========================================================================== */

/** Matches `PageHeader`: eyebrow, h1, two description lines. */
export function SkeletonHeader({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Skeleton rounded="sm" className="h-2.5 w-40" />
          {/* h-8 is `text-h1`'s line box. Getting this wrong is what makes the
              whole page jump when the real title arrives. */}
          <Skeleton className="mt-2 h-8 w-[18rem] max-w-full" />
          <SkeletonText lines={2} className="mt-2.5 max-w-2xl" />
        </div>
        {withActions && <Skeleton rounded="lg" className="h-9 w-32 shrink-0" />}
      </div>
    </div>
  );
}

/** Matches the `StatCard` row: four cards, each with a label, figure and hint. */
export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Skeleton rounded="sm" className="h-2.5 w-24" />
              <Skeleton className="mt-2.5 h-7 w-16" />
            </div>
            {/* The icon tile. Present because its absence would leave the card's
                text a tile-width too wide until the real one lands. */}
            <Skeleton rounded="lg" className="h-9 w-9 shrink-0" />
          </div>
          <Skeleton rounded="sm" className="mt-3 h-2.5 w-[80%]" />
        </div>
      ))}
    </div>
  );
}

/** Matches `Toolbar`: labelled controls on the left, actions on the right. */
export function SkeletonToolbar({ groups = 2, withAction = true }: { groups?: number; withAction?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-bg-surface px-3 py-2.5">
      {Array.from({ length: groups }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton rounded="sm" className="h-2.5 w-12" />
          <Skeleton rounded="lg" className="h-9 w-[9rem]" />
        </div>
      ))}
      <span className="flex-1" />
      {withAction && <Skeleton rounded="lg" className="h-9 w-28" />}
    </div>
  );
}

/** A titled panel with a block inside — charts, segmented bars, any single visual. */
export function SkeletonPanel({
  height = 'h-48',
  title = true,
}: {
  height?: string;
  title?: boolean;
}) {
  return (
    <div className="space-y-3">
      {title && (
        <div>
          <Skeleton className="h-5 w-52" />
          <SkeletonText lines={1} className="mt-2 max-w-xl" />
        </div>
      )}
      <div className="rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm">
        <Skeleton rounded="lg" className={height} />
      </div>
    </div>
  );
}

/**
 * A table: header row then body rows.
 *
 * `columns` sets how many cells per row, and the first is wider — every table in
 * this application leads with a name or a reference, so a row of equal cells
 * would not resemble any of them.
 */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
      <div className="border-b border-border-default bg-bg-surface-sunken px-3 py-2.5">
        <div className="flex items-center gap-3">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton
              key={i}
              rounded="sm"
              className={cn('h-2.5', i === 0 ? 'w-32 flex-1' : 'w-16')}
            />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <Skeleton rounded="sm" className="h-3 w-[60%]" />
              <Skeleton rounded="sm" className="mt-1.5 h-2.5 w-[38%]" />
            </div>
            {Array.from({ length: Math.max(0, columns - 1) }, (_, c) => (
              <Skeleton key={c} rounded="sm" className="h-3 w-16 shrink-0" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A grid of cards — projects, documents, anything card-shaped. */
export function SkeletonCardGrid({
  count = 6,
  columns = 'md:grid-cols-2 xl:grid-cols-3',
}: {
  count?: number;
  columns?: string;
}) {
  return (
    <div className={cn('grid gap-4', columns)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="space-y-3.5 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <Skeleton rounded="lg" className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-[70%]" />
              <div className="mt-2 flex gap-1.5">
                <Skeleton rounded="full" className="h-4 w-16" />
                <Skeleton rounded="full" className="h-4 w-12" />
              </div>
            </div>
          </div>
          <SkeletonText lines={2} />
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton rounded="sm" className="h-2.5 w-24" />
              <Skeleton rounded="sm" className="h-2.5 w-8" />
            </div>
            <Skeleton rounded="full" className="h-1.5 w-full" />
          </div>
          <div className="flex gap-3 border-t border-border-subtle pt-3">
            <Skeleton rounded="sm" className="h-2.5 w-16" />
            <Skeleton rounded="sm" className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of rows with a leading marker — activity feeds, task lists, queues. */
export function SkeletonList({ rows = 5, inCard = true }: { rows?: number; inCard?: boolean }) {
  const body = (
    <div className={cn(inCard ? 'divide-y divide-border-subtle' : 'space-y-2')}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-3',
            inCard
              ? 'px-4 py-3'
              : 'rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm',
          )}
        >
          <Skeleton rounded="full" className="h-2.5 w-2.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton rounded="sm" className="h-3 w-[55%]" />
            <div className="mt-1.5 flex gap-1.5">
              <Skeleton rounded="full" className="h-4 w-14" />
              <Skeleton rounded="full" className="h-4 w-20" />
            </div>
          </div>
          <Skeleton rounded="sm" className="h-2.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );

  if (!inCard) return body;
  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
      {body}
    </div>
  );
}

/**
 * The board — one column per status, cards stacked inside.
 *
 * Varying card counts per column on purpose: eight columns of three identical
 * cards is a pattern, and a pattern reads as a graphic rather than as work.
 */
export function SkeletonBoard({ columns = 6 }: { columns?: number }) {
  const perColumn = [3, 2, 4, 1, 2, 3, 2, 1];

  return (
    <div className="flex gap-3 overflow-x-hidden">
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="w-[17rem] shrink-0 space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-bg-surface-sunken px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Skeleton rounded="full" className="h-2 w-2" />
              <Skeleton rounded="sm" className="h-2.5 w-20" />
            </div>
            <Skeleton rounded="sm" className="h-2.5 w-6" />
          </div>
          {Array.from({ length: perColumn[c % perColumn.length] }, (_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-xl border border-border-default bg-bg-surface p-3 shadow-sm"
            >
              <Skeleton rounded="sm" className="h-2.5 w-16" />
              <SkeletonText lines={2} />
              <div className="flex items-center justify-between pt-1">
                <Skeleton rounded="full" className="h-4 w-14" />
                <Skeleton rounded="full" className="h-6 w-6" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The month grid: weekday headings then six weeks of day cells. */
export function SkeletonMonthGrid() {
  /* Fixed, not random. `Math.random()` here would make the server's HTML differ
     from the client's and produce a hydration mismatch — and it would also make
     the skeleton flicker into a new arrangement on every render. */
  const eventsPerDay = [0, 1, 0, 2, 1, 0, 0, 1, 3, 0, 1, 0, 2, 0, 0, 1, 0, 2, 1, 0, 0,
    1, 0, 0, 2, 1, 0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0, 0];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton rounded="lg" className="h-9 w-9" />
        <Skeleton className="h-6 w-40" />
        <Skeleton rounded="lg" className="h-9 w-9" />
        <Skeleton rounded="lg" className="ml-2 h-9 w-32" />
        <span className="flex-1" />
        <Skeleton rounded="lg" className="h-9 w-36" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border-default">
        <div className="grid grid-cols-7 gap-px bg-border-subtle">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="bg-bg-surface-sunken px-2 py-2">
              <Skeleton rounded="sm" className="mx-auto h-2.5 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border-subtle">
          {eventsPerDay.map((count, i) => (
            <div key={i} className="min-h-[5.5rem] bg-bg-surface p-1.5">
              <Skeleton rounded="sm" className="h-2.5 w-5" />
              <div className="mt-1.5 space-y-1">
                {Array.from({ length: count }, (_, e) => (
                  <Skeleton key={e} rounded="sm" className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Settings: the tab column beside its panel. */
export function SkeletonTabs({ tabs = 4, rows = 6 }: { tabs?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex shrink-0 gap-1 lg:w-[13.5rem] lg:flex-col">
        {Array.from({ length: tabs }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
            <Skeleton rounded="sm" className="h-3 w-28" />
            <Skeleton rounded="sm" className="h-2.5 w-4" />
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
        <div className="border-b border-border-subtle px-5 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="divide-y divide-border-subtle">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <Skeleton rounded="sm" className="h-3 w-[45%]" />
                <Skeleton rounded="sm" className="mt-1.5 h-2.5 w-[70%]" />
              </div>
              <Skeleton rounded="lg" className="h-9 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A section heading above its content — matches `PageSection`. */
export function SkeletonSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-5 w-48" />
        <SkeletonText lines={1} className="mt-2 max-w-2xl" />
      </div>
      {children}
    </div>
  );
}
