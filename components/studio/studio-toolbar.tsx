'use client';

import * as React from 'react';
import { CalendarDays, ChevronDown, Download, SlidersHorizontal } from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE TOOLBAR ABOVE THE CARDS
 * ----------------------------------------------------------------------------
 * Owner, against the reference, 2026-09-04: *"There is a filter above, which is
 * the calendar, with the range of days selected. The other filters are also
 * available."*
 *
 * ── ⚠️ THE RANGE PRESETS STOP AT 30 DAYS, AND THAT IS NOT AN OVERSIGHT ─────
 * Meta returns roughly a month of history and refuses any single request wider
 * than 30 days — verified, see docs/meta-integration/01-VERIFIED-API-FACTS.md.
 * Offering "Last 90 days" would draw a chart that is two-thirds empty and read
 * as broken data rather than as an absent window. The list widens on its own as
 * the daily snapshots accumulate, because from then on the history is OURS.
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

/** "Sep 1 – Sep 28, 2026", as the reference prints it. */
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

export function StudioToolbar({
  from,
  to,
  platform,
  onRange,
  onPlatform,
  onExport,
}: {
  from: string;
  to: string;
  platform: 'all' | 'facebook' | 'instagram';
  onRange: (days: number) => void;
  onPlatform: (p: string) => void;
  onExport: () => void;
}) {
  const [openMenu, setOpenMenu] = React.useState<'range' | 'filters' | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  /* Close on an outside click or Escape — a menu that only closes by reselecting
     is the kind of thing people report as "it got stuck". */
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
      {/* ── The calendar range ─────────────────────────────────────────── */}
      <div className="relative">
        <ToolbarButton
          active={openMenu === 'range'}
          onClick={() => setOpenMenu(openMenu === 'range' ? null : 'range')}
        >
          <CalendarDays className="size-4 text-text-tertiary" aria-hidden="true" />
          <span className="tabular-nums">{formatRange(from, to)}</span>
          <ChevronDown
            className={cn('size-3.5 text-text-tertiary transition-transform', openMenu === 'range' && 'rotate-180')}
            aria-hidden="true"
          />
        </ToolbarButton>

        {openMenu === 'range' && (
          <Menu>
            {RANGE_PRESETS.map((p) => (
              <MenuItem
                key={p.key}
                selected={days === p.days}
                onClick={() => {
                  onRange(p.days);
                  setOpenMenu(null);
                }}
              >
                {p.label}
              </MenuItem>
            ))}
            <p className="border-t border-border-subtle px-3 pb-1 pt-2 text-[0.65rem] leading-snug text-text-tertiary">
              Meta keeps about a month of history. Longer ranges become available
              as we collect our own.
            </p>
          </Menu>
        )}
      </div>

      {/* ── Filters — the platform switch lives here ────────────────────── */}
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
            className={cn('size-3.5 text-text-tertiary transition-transform', openMenu === 'filters' && 'rotate-180')}
            aria-hidden="true"
          />
        </ToolbarButton>

        {openMenu === 'filters' && (
          <Menu>
            <p className="px-3 pb-1 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-text-tertiary">
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

      {/* ── Export ─────────────────────────────────────────────────────── */}
      <ToolbarButton onClick={onExport}>
        <Download className="size-4 text-text-tertiary" aria-hidden="true" />
        Export
      </ToolbarButton>
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
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border bg-bg-surface px-3 py-[7px] text-micro font-medium text-text-primary transition-colors',
        active ? 'border-border-strong' : 'border-border-subtle hover:border-border-default',
      )}
    >
      {children}
    </button>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="menu"
      className="absolute right-0 z-30 mt-1.5 min-w-[13rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[0_8px_28px_rgb(6_35_42_/_0.14)] motion-safe:animate-[studio-rise_160ms_ease-out]"
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
