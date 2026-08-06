import * as React from 'react';

import { cn } from '@/lib/utils';

import { CountBadge } from './badge';
import {
  CONTROL_HEIGHT,
  CONTROL_ICON,
  CONTROL_PADDING,
  CONTROL_RADIUS,
  CONTROL_SURFACE,
  CONTROL_TEXT,
  type ControlSize,
} from './control';

/* ============================================================================
 * PAGE HEADER + VIEW TABS
 * ----------------------------------------------------------------------------
 * The topbar carries orientation and global actions. This carries the page's
 * own identity: what you are looking at, the one line of context that makes the
 * numbers mean something, and the actions that belong to this screen.
 *
 * Keeping them separate is what lets the topbar stay slim. Putting a 30px
 * heading in a sticky bar wastes the most valuable strip of the screen on every
 * page, forever.
 * ========================================================================= */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-micro font-semibold tracking-[0.09em] text-text-tertiary uppercase">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-1 text-h1 tracking-tight text-text-primary">{title}</h2>
          {description && (
            <p className="mt-1.5 max-w-2xl text-body-sm text-text-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * ViewTabs
 * ------------------------------------------------------------------------
 * Presentation only for now — the List/Board/Calendar views land in Phase 2
 * (FR-081, FR-082) and Phase 5 (FR-083). `disabled` renders a tab that is
 * visibly not yet available rather than one that looks live and does nothing,
 * which is the difference between "coming soon" and "broken".
 */

export interface ViewTab {
  key: string;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  disabled?: boolean;
}

export function ViewTabs({
  tabs,
  activeKey,
  onSelect,
  className,
}: {
  tabs: readonly ViewTab[];
  activeKey: string;
  /** Omit for a purely presentational strip; supply it to make the tabs switch. */
  onSelect?: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-1 border-b border-border-default', className)}
      role="tablist"
      aria-label="View"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            onClick={tab.disabled || !onSelect ? undefined : () => onSelect(tab.key)}
            title={tab.disabled ? `${tab.label} — arrives in a later phase` : undefined}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2',
              'text-body-sm font-medium transition-colors duration-[140ms] focus-visible:outline-none',
              isActive
                ? 'text-text-primary'
                : tab.disabled
                  ? 'cursor-not-allowed text-text-disabled'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.9} />}
            {tab.label}
            {tab.count !== undefined && (
              <CountBadge count={tab.count} tone={isActive ? 'brand' : 'neutral'} />
            )}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * FilterChip — read-only affordance until Phase 2 wires filtering
 * ------------------------------------------------------------------------ */

export function FilterChip({
  label,
  value,
  icon: Icon,
  size = 'md',
  className,
}: {
  label: string;
  value?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: ControlSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // Height and padding from the shared scale, so a chip standing beside a
        // Button in a header row lines up with it exactly.
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-text-secondary',
        CONTROL_HEIGHT[size],
        CONTROL_PADDING[size],
        CONTROL_TEXT[size],
        CONTROL_RADIUS,
        CONTROL_SURFACE,
        className,
      )}
    >
      {Icon && <Icon className={cn(CONTROL_ICON[size], 'text-text-tertiary')} strokeWidth={2} />}
      {label}
      {value && <span className="font-semibold text-text-primary">{value}</span>}
    </span>
  );
}
