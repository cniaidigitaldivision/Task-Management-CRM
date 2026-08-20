'use client';

import * as React from 'react';
import { Building, Handshake, Layers, Megaphone, Package, Tent } from 'lucide-react';

import { PROJECT_TYPE_META, type ProjectType } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CARDS AT THE TOP, WHICH ARE ALSO THE FILTER — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"You can say these cards are fine. It should be at the top of the screen but use
 * a good interactive UI. Use colors beautifully so that it can be a very interactive
 * UI."* And: *"I want all filters, whether it's project-wise. I want to see events,
 * clients, promotion, anything."*
 *
 * ── ⚠️ ONE CONTROL, NOT A DISPLAY PLUS A DROPDOWN ─────────────────────────────
 * The five type cards and the "Type" dropdown were two separate things showing the
 * same taxonomy — the cards counted the projects and the dropdown filtered them, and
 * neither told you what the other was doing. Clicking a card that shows "3 Events"
 * and having nothing happen is the specific way that felt broken.
 *
 * So the cards ARE the filter. The count on the face of the card is now also the
 * size of the result you get by pressing it, which makes the number worth reading.
 *
 * ── WHY BUTTONS AND NOT A RADIO GROUP ────────────────────────────────────────
 * A filter is not a form field — it is not submitted, and "All" is a real state
 * rather than an empty one. `aria-pressed` on a toggle button is the honest role for
 * something that turns a view on and off, and it lets a second press clear it.
 * ========================================================================= */

const TYPE_ICONS: Record<
  ProjectType,
  React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
> = {
  client: Handshake,
  event: Tent,
  business: Building,
  self_promotion: Megaphone,
  other: Package,
};

export interface TypeMix {
  readonly type: ProjectType;
  readonly count: number;
  readonly points: number;
}

export function ProjectFilterCards({
  mix,
  active,
  onPick,
  total,
  otherPct,
  otherIsHigh,
  otherWarningPct,
}: {
  mix: readonly TypeMix[];
  active: ProjectType | 'all';
  onPick: (next: ProjectType | 'all') => void;
  total: number;
  /** Share of committed effort in Other projects — doc 15 §6. */
  otherPct: number;
  otherIsHigh: boolean;
  otherWarningPct: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <FilterCard
        label="All projects"
        icon={Layers}
        token="accent-primary"
        count={total}
        sub="everything"
        on={active === 'all'}
        onClick={() => onPick('all')}
      />

      {mix.map(({ type, count, points }) => {
        const meta = PROJECT_TYPE_META[type];
        return (
          <FilterCard
            key={type}
            label={meta.label}
            icon={TYPE_ICONS[type]}
            token={meta.token}
            count={count}
            /* ⚠️ The ad-hoc proportion lives HERE now, as the Other card's own
               subtitle, rather than in the large card that used to sit above this row
               and that the owner could not identify. Same figure (doc 15 §6), beside
               the thing it is a proportion of. */
            sub={
              type === 'other'
                ? `${otherPct}% of all effort`
                : `${points} pts`
            }
            warn={type === 'other' && otherIsHigh}
            title={
              type === 'other' && otherIsHigh
                ? `Above the ${otherWarningPct}% line — capacity going to work nobody planned`
                : undefined
            }
            on={active === type}
            onClick={() => onPick(active === type ? 'all' : type)}
          />
        );
      })}
    </div>
  );
}

function FilterCard({
  label,
  icon: Icon,
  token,
  count,
  sub,
  on,
  onClick,
  warn,
  title,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  token: string;
  count: number;
  sub: string;
  on: boolean;
  onClick: () => void;
  warn?: boolean;
  title?: string;
}) {
  /* A warning overrides the type's own colour: an Other card above the line has to
     read as a problem, not as the amber it always is. */
  const accent = warn ? 'var(--load-warning)' : `var(--${token})`;
  const empty = count === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn(
        'group relative overflow-hidden rounded-xl border p-3 text-left',
        'transition-[border-color,box-shadow,transform,background-color] duration-[160ms]',
        'hover:-translate-y-px hover:shadow-md',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        on ? 'border-transparent' : 'border-border-subtle hover:border-border-strong',
        /* An empty category is still pressable — pressing it and seeing "none of
           those" is a legitimate answer — but it should not compete for attention
           with the ones that have work in them. */
        empty && !on && 'opacity-60',
      )}
      style={{
        outlineColor: 'var(--focus-ring)',
        backgroundColor: on
          ? `color-mix(in oklab, ${accent} var(--tint-medium), var(--bg-surface))`
          : 'var(--bg-surface)',
        boxShadow: on ? `inset 0 0 0 1.5px color-mix(in oklab, ${accent} 62%, transparent)` : undefined,
      }}
    >
      {/* A radial wash of the card's own colour, falling off from the top-right, so a
          row of six reads as six categories before a word is parsed. Same device as
          the dashboard's KPI cards — see StatCard. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-[160ms]',
          on ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
        )}
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, ${accent} 18%, transparent) 0%, transparent 70%)`,
        }}
      />

      <span className="relative flex items-center gap-1.5">
        <Icon
          className="h-3.5 w-3.5 shrink-0"
          strokeWidth={2.25}
          aria-hidden="true"
          style={{ color: accent }}
        />
        <span className="truncate text-micro font-semibold text-text-secondary">{label}</span>
      </span>

      <span className="relative mt-0.5 block tabular-nums text-h2 font-semibold text-text-primary">
        {count}
      </span>

      <span
        className="relative block truncate text-micro"
        style={{ color: warn ? accent : 'var(--text-tertiary)' }}
      >
        {sub}
      </span>
    </button>
  );
}
