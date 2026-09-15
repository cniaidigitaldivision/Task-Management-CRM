'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import type { CrmLeadRow } from '@/lib/db/queries/crm-leads';
import { displayPhone } from '@/lib/domain/phone';
import { stageLabel, stageToken } from '@/lib/domain/crm-stages';

/* ============================================================================
 * THE DRAWER, BEFORE THE SERVER HAS ANSWERED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"if I click on a row, the drawer should open instantly
 * instead of it rendering… These are just UI clicks to view the same data in
 * detail, which is already loaded."*
 *
 * The second half of that sentence is the important one, and it is true. The row
 * that was just clicked already carries the name, the project, the stage, the
 * phone, the email, the city, the next action and the last message. Every one of
 * those was serialised into this page minutes ago. Waiting for Singapore to send
 * them a second time before drawing a panel is work nobody asked for.
 *
 * ⚠️ SO THIS OPENS IN THE CLICK'S OWN FRAME, from the row. What it genuinely
 * cannot know — the notes, the full message thread, the activity log, the
 * related quotations and appointments — is the only thing that waits, and it
 * waits inside an open panel rather than behind a blank screen.
 *
 * ⚠️ AND IT IS THE SAME FRAME, TO THE PIXEL, AS `LeadDrawer`. Identical width,
 * border, header layout and spacing — so when the real one replaces it nothing
 * jumps. A skeleton that resizes on arrival is worse than no skeleton: it draws
 * the eye to exactly the moment you wanted to hide.
 * ========================================================================= */

export function LeadDrawerShell({
  row,
  onClose,
}: {
  row: CrmLeadRow;
  onClose: () => void;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const phone = displayPhone(row.phoneE164, row.phone);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.fullName ?? 'Lead'} — details`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[36rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-body font-semibold text-text-primary">
                {row.fullName ?? 'Unnamed lead'}
              </h2>
              <p className="mt-0.5 truncate text-caption text-text-secondary">
                {[row.projectName, row.city].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg border px-2 py-0.5 text-caption font-medium"
              style={{
                borderColor: `var(--${stageToken(row.stage)})`,
                color: `var(--${stageToken(row.stage)})`,
                backgroundColor: `color-mix(in oklab, var(--${stageToken(row.stage)}) 12%, transparent)`,
              }}
            >
              {stageLabel(row.stage)}
            </span>
            {phone !== '—' && (
              <span className="text-caption text-text-secondary">{phone}</span>
            )}
            {row.email && (
              <span className="truncate text-caption text-text-secondary">{row.email}</span>
            )}
          </div>
        </div>

        {/* ⚠️ THE PART THAT GENUINELY HAS TO WAIT, and it says so rather than
            pretending to be content. Bars sized like the rows that will replace
            them, so the panel does not reflow when they arrive. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-busy="true">
          <p className="text-caption text-text-tertiary">Loading the full record…</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-bg-subtle" />
              <div className="h-3 w-full rounded bg-bg-subtle" />
              <div className="h-3 w-4/5 rounded bg-bg-subtle" />
            </div>
          ))}
          <span className="sr-only">Loading the full record for {row.fullName ?? 'this lead'}</span>
        </div>
      </div>
    </div>
  );
}
