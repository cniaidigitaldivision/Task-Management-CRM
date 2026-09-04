'use client';

import * as React from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  SlidersHorizontal,
} from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE TOOLBAR ABOVE THE TABS
 * ----------------------------------------------------------------------------
 * Owner's reference, 2026-09-05: a project select, a chip per connected account
 * showing its name and state, and on the right a date range, filters and export
 * — each its own pill on the page background rather than a bar inside a card.
 *
 * ── ⚠️ THE PRESETS STOP AT 30 DAYS; THE CALENDAR DOES NOT ──────────────────
 * Meta returns roughly a month of history and refuses any single request wider
 * than 30 days — verified, see docs/meta-integration/01-VERIFIED-API-FACTS.md.
 * So the quick presets stop there, because a "Last 90 days" button would draw a
 * chart two-thirds empty and read as broken data rather than an absent window.
 *
 * The calendar allows any range, and instead of refusing the impossible it SHOWS
 * it: days before the first collected date are disabled, so the boundary of what
 * is knowable is visible rather than something you discover from an empty graph.
 * That boundary moves backwards on its own as the daily snapshots accumulate,
 * because from then on the history is ours.
 * ========================================================================= */

export interface RangePreset {
  readonly key: string;
  readonly label: string;
  readonly days: number;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '14', label: 'Last 14 days', days: 14 },
  { key: '30', label: 'Last 30 days', days: 30 },
];

/** "May 22 – Jun 4, 2026", as the reference prints it. */
export function formatRange(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const m = (d: Date) => d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const day = (d: Date) => d.getUTCDate();
  const year = t.getUTCFullYear();
  return f.getUTCMonth() === t.getUTCMonth()
    ? `${m(f)} ${day(f)} – ${day(t)}, ${year}`
    : `${m(f)} ${day(f)} – ${m(t)} ${day(t)}, ${year}`;
}

export interface ToolbarAccount {
  readonly id: string;
  readonly platform: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly permalink: string | null;
  readonly isFailing: boolean;
}

export function StudioToolbar({
  from,
  to,
  today,
  earliest,
  platform,
  accounts,
  onRange,
  onExactRange,
  onPlatform,
  onExport,
}: {
  from: string;
  to: string;
  /** Today in Karachi, from the server — the calendar's upper bound. */
  today: string;
  /** The first date any figure exists for, or null when nothing is collected. */
  earliest: string | null;
  platform: 'all' | 'facebook' | 'instagram';
  accounts: readonly ToolbarAccount[];
  onRange: (days: number) => void;
  onExactRange: (from: string, to: string) => void;
  onPlatform: (p: string) => void;
  onExport: () => void;
}) {
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  /* Close on an outside click or Escape — a menu that only closes by
     reselecting is the kind of thing people report as "it got stuck". */
  React.useEffect(() => {
    if (!openMenu) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [openMenu]);

  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1,
  );

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2">
      {/* ── A chip per connected account ────────────────────────────────── */}
      {accounts.map((a) => {
        const brand = PLATFORM_MARKS[a.platform];
        const open = openMenu === `acct-${a.id}`;
        return (
          <div key={a.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(open ? null : `acct-${a.id}`)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border bg-bg-surface py-1.5 pl-2 pr-2.5 text-left transition-colors',
                open ? 'border-border-strong' : 'border-border-subtle hover:border-border-default',
                /* The chip dims when the platform filter excludes it, so the
                   filter's effect is visible where the accounts are named. */
                platform !== 'all' && platform !== a.platform && 'opacity-45',
              )}
            >
              <PlatformIcon slug={a.platform} size={26} />
              <span className="min-w-0">
                <span className="block max-w-[7.5rem] truncate text-[0.68rem] font-semibold leading-tight text-text-primary">
                  {brand?.label ?? a.platform}
                </span>
                <span className="mt-0.5 flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{
                      backgroundColor: a.isFailing
                        ? 'var(--feedback-error)'
                        : 'var(--feedback-success)',
                    }}
                  />
                  <span
                    className="text-[0.58rem] leading-none"
                    style={{
                      color: a.isFailing ? 'var(--feedback-error)' : 'var(--feedback-success)',
                    }}
                  >
                    {a.isFailing ? 'Failing' : 'Connected'}
                  </span>
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-text-tertiary transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>

            {open && (
              <Menu align="left">
                <p className="truncate px-3 pb-1 pt-1.5 text-[0.62rem] text-text-tertiary">
                  {a.displayName ?? a.username ?? brand?.label ?? a.platform}
                </p>
                <MenuItem
                  selected={platform === a.platform}
                  onClick={() => {
                    /* Selecting the platform already shown clears the filter,
                       so the chip is a toggle rather than a one-way trip. */
                    onPlatform(platform === a.platform ? 'all' : a.platform);
                    setOpenMenu(null);
                  }}
                >
                  {platform === a.platform ? 'Show all platforms' : `Show only ${brand?.label ?? a.platform}`}
                </MenuItem>
                {a.permalink && (
                  <a
                    href={a.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-micro text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
                  >
                    Open on {brand?.label ?? a.platform}
                    <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
                  </a>
                )}
              </Menu>
            )}
          </div>
        );
      })}

      {/* ── The right-hand controls ─────────────────────────────────────── */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative">
          <ToolbarButton
            active={openMenu === 'range'}
            onClick={() => setOpenMenu(openMenu === 'range' ? null : 'range')}
          >
            <CalendarDays className="size-4 text-text-tertiary" aria-hidden="true" />
            <span className="tabular-nums">{formatRange(from, to)}</span>
            <ChevronDown
              className={cn(
                'size-3.5 text-text-tertiary transition-transform',
                openMenu === 'range' && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </ToolbarButton>

          {openMenu === 'range' && (
            <Menu wide>
              <div className="flex flex-wrap gap-1 px-2 pb-2 pt-1">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      onRange(p.days);
                      setOpenMenu(null);
                    }}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-[0.62rem] font-medium transition-colors',
                      days === p.days
                        ? 'text-accent-foreground'
                        : 'border border-border-subtle text-text-secondary hover:bg-bg-subtle',
                    )}
                    style={days === p.days ? { backgroundColor: 'var(--accent-primary)' } : undefined}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <RangeCalendar
                from={from}
                to={to}
                today={today}
                earliest={earliest}
                onApply={(a, b) => {
                  onExactRange(a, b);
                  setOpenMenu(null);
                }}
              />
            </Menu>
          )}
        </div>

        <div className="relative">
          <ToolbarButton
            active={openMenu === 'filters'}
            onClick={() => setOpenMenu(openMenu === 'filters' ? null : 'filters')}
          >
            <SlidersHorizontal className="size-4 text-text-tertiary" aria-hidden="true" />
            Filters
            {platform !== 'all' && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold"
                style={{ backgroundColor: 'var(--chart-1-wash)', color: 'var(--chart-1)' }}
              >
                1
              </span>
            )}
            <ChevronDown
              className={cn(
                'size-3.5 text-text-tertiary transition-transform',
                openMenu === 'filters' && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </ToolbarButton>

          {openMenu === 'filters' && (
            <Menu>
              <p className="px-3 pb-1 pt-1.5 text-[0.62rem] font-semibold uppercase tracking-wide text-text-tertiary">
                Platform
              </p>
              {(['all', 'facebook', 'instagram'] as const).map((p) => (
                <MenuItem
                  key={p}
                  selected={platform === p}
                  onClick={() => {
                    onPlatform(p);
                    setOpenMenu(null);
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {p !== 'all' && <PlatformIcon slug={p} size={14} />}
                    {p === 'all' ? 'All platforms' : (PLATFORM_MARKS[p]?.label ?? p)}
                  </span>
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>

        <ToolbarButton onClick={onExport}>
          <Download className="size-4 text-text-tertiary" aria-hidden="true" />
          Export
        </ToolbarButton>
      </div>
    </div>
  );
}

/* ---- The calendar -------------------------------------------------------- */

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * A two-click range picker.
 *
 * ⚠️ DATES WITH NO DATA ARE DISABLED, NOT MERELY UNHELPFUL. Meta serves about
 * thirty days, so anything before the first collected date can never be filled —
 * and a range reaching into it draws a chart that is mostly empty, which reads
 * as broken rather than as absent. Greying those days puts the boundary of what
 * is knowable on screen instead of leaving it to be discovered.
 *
 * ⚠️ AND THE MONTH GRID IS BUILT FROM UTC PARTS. `new Date(y, m, d)` is local
 * time, so on a machine west of Greenwich the first of the month lands on the
 * previous day and the whole grid shifts by one column — the calendar would
 * disagree with every date label on the page.
 */
function RangeCalendar({
  from,
  to,
  today,
  earliest,
  onApply,
}: {
  from: string;
  to: string;
  today: string;
  earliest: string | null;
  onApply: (from: string, to: string) => void;
}) {
  const [month, setMonth] = React.useState(() => from.slice(0, 7));
  const [start, setStart] = React.useState<string | null>(from);
  const [end, setEnd] = React.useState<string | null>(to);

  const [y, m] = month.split('-').map(Number);

  const grid = React.useMemo(() => {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= length; d += 1) {
      cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return cells;
  }, [y, m]);

  const shiftMonth = (by: number) => {
    const next = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(next.toISOString().slice(0, 7));
  };

  const pick = (iso: string) => {
    /* First click sets the start and clears the end; second completes it. A
       click before the current start restarts rather than making an inverted
       range — which the caller would otherwise have to guard against. */
    if (start === null || end !== null || iso < start) {
      setStart(iso);
      setEnd(null);
      return;
    }
    setEnd(iso);
  };

  const disabled = (iso: string) => iso > today || (earliest !== null && iso < earliest);
  const inRange = (iso: string) =>
    start !== null && end !== null && iso >= start && iso <= end;

  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="border-t border-border-subtle px-2 pb-2 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="grid size-6 place-items-center rounded-md text-text-secondary transition-colors hover:bg-bg-subtle"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="text-[0.65rem] font-semibold text-text-primary">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="grid size-6 place-items-center rounded-md text-text-secondary transition-colors hover:bg-bg-subtle"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {WEEK.map((d, i) => (
          <span
            key={i}
            className="grid h-5 place-items-center text-[0.55rem] font-medium text-text-tertiary"
          >
            {d}
          </span>
        ))}

        {grid.map((iso, i) =>
          iso === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={iso}
              type="button"
              disabled={disabled(iso)}
              onClick={() => pick(iso)}
              title={disabled(iso) && earliest !== null && iso < earliest
                ? 'Nothing was collected this far back'
                : undefined}
              className={cn(
                'grid h-6 place-items-center rounded-md text-[0.6rem] tabular-nums transition-colors',
                disabled(iso)
                  ? 'cursor-not-allowed text-text-disabled'
                  : iso === start || iso === end
                    ? 'font-bold text-accent-foreground'
                    : inRange(iso)
                      ? 'text-text-primary'
                      : 'text-text-secondary hover:bg-bg-subtle',
              )}
              style={
                iso === start || iso === end
                  ? { backgroundColor: 'var(--accent-primary)' }
                  : inRange(iso)
                    ? { backgroundColor: 'var(--chart-1-wash)' }
                    : undefined
              }
            >
              {Number(iso.slice(8))}
            </button>
          ),
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[0.58rem] text-text-tertiary">
          {start && end
            ? formatRange(start, end)
            : start
              ? 'Now pick the end date'
              : 'Pick a start date'}
        </p>
        <button
          type="button"
          disabled={!start || !end}
          onClick={() => start && end && onApply(start, end)}
          className="rounded-lg px-3 py-1 text-[0.62rem] font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          Apply
        </button>
      </div>

      {earliest && (
        <p className="mt-1.5 text-[0.55rem] leading-snug text-text-tertiary">
          Collected from {formatRange(earliest, today)}. Meta serves about a month; the range
          widens on its own as we keep our own history.
        </p>
      )}
    </div>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      /* ⚠️ `min-h` MATCHES THE ACCOUNT CHIPS' TWO LINES, so the row reads as one
         band of controls rather than as tall pills beside short ones. */
      className={cn(
        'inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border bg-bg-surface px-3 text-micro font-medium text-text-primary transition-colors',
        active ? 'border-border-strong' : 'border-border-subtle hover:border-border-default',
      )}
    >
      {children}
    </button>
  );
}

function Menu({
  children,
  align = 'right',
  wide,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  wide?: boolean;
}) {
  return (
    <div
      role="menu"
      className={cn(
        'absolute z-30 mt-1.5 overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[0_8px_28px_rgb(6_35_42_/_0.14)] motion-safe:animate-[studio-rise_160ms_ease-out]',
        align === 'right' ? 'right-0' : 'left-0',
        wide ? 'w-[16rem]' : 'min-w-[12rem]',
      )}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-micro transition-colors',
        selected
          ? 'font-semibold text-text-primary'
          : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
      )}
    >
      {children}
      {selected && <span aria-hidden="true" className="text-text-brand">✓</span>}
    </button>
  );
}
