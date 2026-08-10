'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './button';
import { cn } from '@/lib/utils';

/* ============================================================================
 * PAGINATION
 * ----------------------------------------------------------------------------
 * Owner instruction, CHANGE-PLAN 4.3: *"after every 12 or 13 rows it should add
 * another page, so I can select a page and move on to the next."*
 *
 * ── TABLES AND LISTS ONLY — NOT THE BOARD ────────────────────────────────────
 * Owner decision 3. A card cannot be dragged onto a task that is on another
 * page, so paging the board would break the thing Sessions 17–19 were spent
 * making work. The board keeps scrolling columns.
 *
 * ── IT PAGES IN THE BROWSER, NOT IN SQL ──────────────────────────────────────
 * Every screen this is used on already holds its full list: the queries are
 * bounded by row-level security, and a Member's Team screen is one row whatever
 * anybody asks for. Adding `limit`/`offset` to seven queries would mean seven
 * more round trips per page turn, and each of those screens also filters and
 * sorts client-side — so the server would be paginating a set the client is
 * about to re-slice anyway, and the page counts would disagree with the filters.
 *
 * If a table ever genuinely outgrows this — tens of thousands of audit rows —
 * the fix is a server-paged query for THAT table, not a change here. The audit
 * log already caps at 100 rows in its query for the same reason.
 *
 * ── WHY THE PAGE RESETS WHEN THE LIST CHANGES ────────────────────────────────
 * Filter down to four results while sitting on page 3 and, without this, the
 * screen shows an empty table with "Page 3 of 1" — which reads as a bug rather
 * than as an empty filter.
 * ========================================================================= */

/** Owner asked for "12 or 13". Twelve — it divides evenly and reads as a block. */
export const PAGE_SIZE = 12;

/**
 * Slice a list into the current page, and hand back what a footer needs.
 *
 * Returns `page` unclamped-but-corrected: the page number is held in state and
 * adjusted during render when the list shrinks under it, rather than in an
 * effect — an effect would paint the empty page once before fixing itself.
 */
export function usePagination<T>(
  items: readonly T[],
  pageSize: number = PAGE_SIZE,
): {
  readonly page: number;
  readonly pageCount: number;
  readonly visible: readonly T[];
  readonly setPage: (next: number) => void;
  /** First and last row numbers on this page, 1-indexed, for "13–24 of 37". */
  readonly from: number;
  readonly to: number;
  readonly total: number;
} {
  const [page, setPage] = React.useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  /* State adjustment during render, not an effect. See the note above. */
  const [lastCount, setLastCount] = React.useState(items.length);
  if (lastCount !== items.length) {
    setLastCount(items.length);
    if (page > Math.max(1, Math.ceil(items.length / pageSize))) setPage(1);
  }

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  return {
    page: safePage,
    pageCount,
    visible,
    setPage,
    from: items.length === 0 ? 0 : start + 1,
    to: start + visible.length,
    total: items.length,
  };
}

/**
 * The footer. Renders nothing when everything fits on one page — a pager that
 * says "Page 1 of 1" is furniture.
 */
export function Pagination({
  page,
  pageCount,
  onPage,
  from,
  to,
  total,
  label = 'rows',
  className,
}: {
  page: number;
  pageCount: number;
  onPage: (next: number) => void;
  from: number;
  to: number;
  total: number;
  /** What is being counted — "people", "tasks", "entries". */
  label?: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  /* A window of page numbers around the current one. Twenty numbered buttons
     is not navigation, it is a wall — so the ends are always reachable and the
     middle slides. */
  const window: number[] = [];
  const first = Math.max(1, Math.min(page - 2, pageCount - 4));
  const last = Math.min(pageCount, Math.max(page + 2, 5));
  for (let n = first; n <= last; n += 1) window.push(n);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3',
        className,
      )}
    >
      <p className="tabular text-micro text-text-tertiary">
        <span className="font-semibold text-text-secondary">
          {from}–{to}
        </span>{' '}
        of {total} {label}
      </p>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
          Back
        </Button>

        {window[0] > 1 && (
          <>
            <PageButton n={1} current={page} onPage={onPage} />
            {window[0] > 2 && (
              <span aria-hidden="true" className="px-1 text-micro text-text-disabled">
                …
              </span>
            )}
          </>
        )}

        {window.map((n) => (
          <PageButton key={n} n={n} current={page} onPage={onPage} />
        ))}

        {window[window.length - 1] < pageCount && (
          <>
            {window[window.length - 1] < pageCount - 1 && (
              <span aria-hidden="true" className="px-1 text-micro text-text-disabled">
                …
              </span>
            )}
            <PageButton n={pageCount} current={page} onPage={onPage} />
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

function PageButton({
  n,
  current,
  onPage,
}: {
  n: number;
  current: number;
  onPage: (next: number) => void;
}) {
  const isCurrent = n === current;
  return (
    <button
      type="button"
      onClick={() => onPage(n)}
      aria-label={`Page ${n}`}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'tabular inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2',
        'text-caption font-semibold transition-colors duration-[120ms]',
        'focus-visible:outline-none',
        isCurrent
          ? 'bg-bg-selected text-text-brand'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {n}
    </button>
  );
}
