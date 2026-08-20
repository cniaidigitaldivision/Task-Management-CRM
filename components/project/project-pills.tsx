'use client';

import * as React from 'react';
import { Building2, Globe, Handshake, LayoutDashboard } from 'lucide-react';

import type { ProjectStatus } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PILLS — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"The pills you are using for active and starter are not looking good. Make it
 * more interactive and more visible."*
 *
 * ── WHAT WAS WRONG WITH THEM ─────────────────────────────────────────────────
 * They were outline `Badge`s: a hairline border, small grey text, the same shape
 * whatever they said. Four of them in a row read as a line of noise rather than as
 * four facts, and the one that mattered — "on hold" — looked exactly like the one
 * that did not — "SPARK".
 *
 * So they are now SOLID and tinted with their own meaning, and a live status carries
 * a dot. The point is that the eye can sort them without reading: a coloured plate
 * is a state, a grey plate is a label.
 *
 * ── ⚠️ WHY THESE ARE NOT `<Badge>` ───────────────────────────────────────────
 * `Badge` is the application's general-purpose chip and is used in dozens of places.
 * Restyling it to fix this screen would restyle the task board, the audit log and the
 * workload table as a side effect. These are project-specific and stay here until
 * somebody decides the same treatment belongs everywhere.
 * ========================================================================= */

const STATUS: Readonly<
  Record<ProjectStatus, { label: string; token: string; live: boolean }>
> = {
  planning: { label: 'Planning', token: 'feedback-info', live: false },
  active: { label: 'Active', token: 'feedback-success', live: true },
  on_hold: { label: 'On hold', token: 'feedback-warning', live: false },
  completed: { label: 'Completed', token: 'accent-primary', live: false },
  archived: { label: 'Archived', token: 'text-tertiary', live: false },
  cancelled: { label: 'Cancelled', token: 'feedback-error', live: false },
};

/** The project's state. Solid, because this is the one pill that must be seen. */
export function StatusPill({
  status,
  size = 'md',
}: {
  status: ProjectStatus;
  size?: 'sm' | 'md';
}) {
  const meta = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-micro' : 'px-2.5 py-1 text-micro',
      )}
      style={{
        backgroundColor: `color-mix(in oklab, var(--${meta.token}) var(--tint-strong), var(--bg-surface))`,
        color: `color-mix(in oklab, var(--${meta.token}) 82%, var(--text-primary))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--${meta.token}) 34%, transparent)`,
      }}
    >
      {/* A dot only where the project is genuinely running. Putting one on every
          state would make it decoration; here it means "this is live now", and it
          pulses so a wall of cards shows at a glance which ones are moving. */}
      {meta.live && (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ backgroundColor: `var(--${meta.token})` }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: `var(--${meta.token})` }}
          />
        </span>
      )}
      {meta.label}
    </span>
  );
}

/**
 * Internal or external.
 *
 * ⚠️ Renders nothing for `null` rather than guessing. Six of the seven demo projects
 * had no client kind recorded, and defaulting them to "external" is exactly the bug
 * the monthly report's fact sheet had — it states a commercial relationship nobody
 * entered.
 */
export function KindPill({ kind }: { kind: 'internal' | 'external' | null }) {
  if (kind === null) return null;

  const internal = kind === 'internal';
  const token = internal ? 'accent-gold' : 'accent-primary';
  const Icon = internal ? Building2 : Handshake;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-medium), var(--bg-surface))`,
        color: `color-mix(in oklab, var(--${token}) 84%, var(--text-primary))`,
      }}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      {internal ? 'Internal' : 'Client'}
    </span>
  );
}

/** The package name. Deliberately the quietest pill — it is a label, not a state. */
export function PackagePill({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-bg-subtle px-2 py-0.5 text-micro font-semibold text-text-secondary">
      {name}
    </span>
  );
}

/**
 * Website / CRM, from the package.
 *
 * Only rendered when the package SAYS YES. A row of grey crosses telling you what a
 * project does not have is the "too much text" the owner is objecting to — absence
 * is adequately communicated by absence.
 */
export function IncludesPills({
  website,
  crm,
}: {
  website: boolean | null;
  crm: boolean | null;
}) {
  return (
    <>
      {website === true && <Includes icon={Globe} label="Website" />}
      {crm === true && <Includes icon={LayoutDashboard} label="CRM" />}
    </>
  );
}

function Includes({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor:
          'color-mix(in oklab, var(--feedback-success) var(--tint-medium), var(--bg-surface))',
        color: 'color-mix(in oklab, var(--feedback-success) 84%, var(--text-primary))',
      }}
      title={`${label} included in this package`}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      {label}
    </span>
  );
}
