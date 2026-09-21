'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, Mail, MapPin, Pencil, Phone, X } from 'lucide-react';

import { LeadOverviewTab } from '@/components/crm/lead-overview-tab';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type { CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import { stageLabel, stageToken, temperatureLabel } from '@/lib/domain/crm-stages';
import { displayPhone } from '@/lib/domain/phone';

/* ============================================================================
 * A LEAD, IN A PROPER MODAL — opened from the Appointments page
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"When I click on a view lead, that modal and its
 * background are not appropriate… pop up a proper modal. All details of that
 * lead will be displayed properly in a sleek way."*
 *
 * ⚠️ PORTALLED TO <body>. The page column (`<main class="reveal-children">`)
 * gives each child a transform, and a transform becomes the containing block
 * for anything `fixed` inside it — so the old panel dimmed only the content
 * area and hung off the bottom of the screen. Rendered at the body, the
 * backdrop covers the whole window and the card sits in its centre.
 *
 * The body is the SAME overview the lead drawer shows (lifecycle, details, next
 * action, notes, activity) — one definition of what a lead's overview is.
 * ========================================================================= */

export function LeadDetailsModal({
  leadId,
  bundle,
  fallbackName,
  viewerName,
  nowMs,
  onClose,
  onEdit,
  onRelated,
  onElsewhere,
}: {
  leadId: string;
  bundle: CrmLeadBundle | null;
  fallbackName: string;
  viewerName: string;
  nowMs: number;
  onClose: () => void;
  onEdit: () => void;
  onRelated: () => void;
  onElsewhere: (href: string) => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    /* The page behind does not scroll while the modal is up. */
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = was;
    };
  }, [onClose]);

  const lead = bundle?.record.lead ?? null;
  const name = lead?.fullName ?? fallbackName;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const stageInk = lead ? `var(--${stageToken(lead.stage)})` : 'var(--text-secondary)';

  return createPortal(
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[min(50rem,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        {/* ── Who, at a glance ─────────────────────────────────────────── */}
        <header className="shrink-0 border-b border-border-subtle bg-[color-mix(in_oklab,var(--accent-primary)_5%,var(--bg-surface))] px-6 py-4">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-primary text-body font-bold text-white">
              {initials || '?'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-h3 font-bold text-text-primary">{name}</h2>
                {lead && (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-caption font-semibold"
                    style={{ background: `color-mix(in oklab, ${stageInk} 14%, var(--bg-surface))`, color: `color-mix(in oklab, ${stageInk} 75%, var(--text-primary))` }}
                  >
                    {stageLabel(lead.stage)}
                  </span>
                )}
                {lead?.temperature && (
                  <span className="rounded-full border border-border-default px-2.5 py-0.5 text-caption font-medium text-text-secondary">
                    {temperatureLabel(lead.temperature)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-secondary">
                {lead?.projectName && <span>{lead.projectName}</span>}
                {lead?.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden="true" /> {lead.city}
                  </span>
                )}
                {lead?.phoneE164 && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3.5" aria-hidden="true" /> {displayPhone(lead.phoneE164)}
                  </span>
                )}
                {lead?.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3.5" aria-hidden="true" /> {lead.email}
                  </span>
                )}
                {lead?.ownerName && <span>Owner · {lead.ownerName}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/conversations?lead=${leadId}` as Route}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
              >
                <span style={{ color: WA_GREEN }}>
                  <WhatsAppMark className="size-4" />
                </span>
                WhatsApp
              </Link>
              <button
                type="button"
                onClick={onEdit}
                disabled={!lead}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40"
              >
                <Pencil className="size-3.5" aria-hidden="true" /> Edit details
              </button>
              <Link
                href={`/my-leads?lead=${leadId}` as Route}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white transition-opacity hover:opacity-90"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" /> Full record
              </Link>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {/* ── The overview — the drawer's own ──────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {bundle && lead ? (
            <LeadOverviewTab
              lead={lead}
              notes={bundle.record.notes}
              activity={bundle.record.activity}
              related={bundle.related}
              phone={lead.phoneE164 ?? ''}
              viewerName={viewerName}
              nowMs={nowMs}
              onTab={(tab) => {
                if (tab === 'related') onRelated();
                else if (tab === 'conversations') onElsewhere(`/conversations?lead=${leadId}`);
                else onElsewhere(`/my-leads?lead=${leadId}`);
              }}
            />
          ) : (
            <p className="flex items-center gap-2 text-body-sm text-text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the lead…
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
