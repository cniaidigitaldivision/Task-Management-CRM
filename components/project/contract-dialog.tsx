'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/* ============================================================================
 * WHAT WAS SOLD, IN FULL — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"the View Contract button should, on click, pop up and display the package main
 * summary: how many platforms, how much this and that."*
 *
 * ── ⚠️ TWO COLUMNS, AND THEY CAN DISAGREE ─────────────────────────────────────
 * The package's LISTED terms and what this project actually AGREED are different
 * facts, and this dialog shows both side by side rather than picking one.
 *
 * That is the whole reason it is worth opening. Migration 033's rule is that the
 * project snapshots what was promised, so editing STARTER next year must not rewrite
 * an existing client's deal — which means a project can legitimately sit above or
 * below its own package. A summary that showed only the package would describe a
 * document nobody signed; one that showed only the project would hide that an add-on
 * was sold. Where the two differ the row says so.
 * ========================================================================= */

export interface PackageDetail {
  readonly name: string;
  readonly tagline: string | null;
  readonly monthlyFeePkr: number | null;
  readonly feeIsFrom: boolean;
  readonly platformCount: number | null;
  readonly assetsMin: number | null;
  readonly assetsMax: number | null;
  readonly reelsMin: number | null;
  readonly includesWebsite: boolean;
  readonly websiteNote: string | null;
  readonly includesCrm: boolean;
  readonly crmNote: string | null;
  readonly automationNote: string | null;
  readonly reportingCadence: string | null;
  readonly freeBenefit: string | null;
  readonly bestFor: string | null;
}

function money(pkr: number | null, isFrom = false): string {
  if (pkr === null) return 'Custom';
  /* Locale passed explicitly — an argless `toLocaleString()` differs between the
     server and the browser and React reports it as a hydration mismatch. */
  return `${isFrom ? 'from ' : ''}PKR ${pkr.toLocaleString('en-PK')}`;
}

/** "14–16", "up to 75", "14", or "—". Keeps null and 0 distinct throughout. */
function range(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  if (min === null) return `up to ${max}`;
  if (max === null || max === min) return String(min);
  return `${min}–${max}`;
}

export function ContractDialog({
  open,
  onClose,
  projectName,
  detail,
  agreed,
  platforms,
  canSeeFinance,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  /** Null when the project is on a customised arrangement rather than a listed one. */
  detail: PackageDetail | null;
  agreed: {
    monthlyFeePkr: number | null;
    assetsTargetMin: number | null;
    assetsTargetMax: number | null;
    reelsTargetMin: number | null;
    staticPostsPerDay: number | null;
    reelsPerWeek: number | null;
    startDate: string | null;
  };
  platforms: readonly { id: string; name: string; slug: string }[];
  /** `project.view_finance`. Every money row is behind this. */
  canSeeFinance: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={detail ? `${detail.name} — what was sold` : 'Customised arrangement'}
      description={
        detail?.tagline ??
        `${projectName} is not on a listed package. These are the terms recorded against it.`
      }
      size="md"
      footer={
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        {/* ---- The platforms, with their marks ---- */}
        <section className="space-y-2">
          <h3 className="text-caption font-semibold text-text-primary">
            Platforms
            {detail?.platformCount != null && (
              <span className="ml-2 font-normal text-text-tertiary">
                {platforms.length} of {detail.platformCount} the package covers
              </span>
            )}
          </h3>

          {platforms.length === 0 ? (
            <p className="text-micro text-text-secondary">None chosen yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {platforms.map((platform) => (
                <span
                  key={platform.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-bg-subtle px-2 py-1"
                >
                  <PlatformIcon slug={platform.slug} size={18} />
                  <span className="text-micro font-semibold text-text-secondary">
                    {platform.name}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* ⚠️ Stated rather than refused, the same way the project form does it:
              over-ticking usually means an add-on was sold, and hiding the mismatch
              would make the CRM unable to record something that genuinely happened. */}
          {detail?.platformCount != null && platforms.length > detail.platformCount && (
            <p className="text-micro" style={{ color: 'var(--feedback-warning)' }}>
              {platforms.length} ticked but {detail.name} covers {detail.platformCount}. Fine if an
              add-on was sold — worth checking the fee.
            </p>
          )}
        </section>

        {/* ---- Listed vs agreed ---- */}
        <section className="space-y-2">
          <h3 className="text-caption font-semibold text-text-primary">The numbers</h3>

          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-surface-sunken">
                  <th className="px-3 py-1.5 text-left text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    &nbsp;
                  </th>
                  <th className="px-3 py-1.5 text-right text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    {detail ? detail.name : 'Listed'}
                  </th>
                  <th className="px-3 py-1.5 text-right text-micro font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    Agreed here
                  </th>
                </tr>
              </thead>
              <tbody>
                <Row
                  label="Assets a month"
                  listed={detail ? range(detail.assetsMin, detail.assetsMax) : '—'}
                  agreedValue={range(agreed.assetsTargetMin, agreed.assetsTargetMax)}
                />
                <Row
                  label="Reels a month"
                  listed={detail?.reelsMin != null ? String(detail.reelsMin) : '—'}
                  agreedValue={agreed.reelsTargetMin != null ? String(agreed.reelsTargetMin) : '—'}
                />
                {canSeeFinance && (
                  <Row
                    label="Monthly fee"
                    listed={detail ? money(detail.monthlyFeePkr, detail.feeIsFrom) : '—'}
                    agreedValue={money(agreed.monthlyFeePkr)}
                  />
                )}
                <Row
                  label="Rhythm"
                  listed="—"
                  agreedValue={
                    [
                      agreed.staticPostsPerDay !== null
                        ? `${agreed.staticPostsPerDay} a day`
                        : null,
                      agreed.reelsPerWeek !== null
                        ? `${agreed.reelsPerWeek} reel${agreed.reelsPerWeek === 1 ? '' : 's'}/wk`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'
                  }
                />
                <Row label="Started" listed="—" agreedValue={agreed.startDate ?? '—'} />
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- What the package bundles ---- */}
        {detail && (
          <section className="space-y-2">
            <h3 className="text-caption font-semibold text-text-primary">Included</h3>
            <ul className="space-y-1.5">
              {/* ⚠️ The label says "No CRM" when it is excluded, rather than "CRM"
                  beside a cross. The cross alone reads as a checkbox somebody forgot to
                  tick — and a package's exclusions are terms, not omissions. Found by a
                  check that expected the words and got the glyph. */}
              <Includes
                on={detail.includesWebsite}
                label={
                  detail.includesWebsite ? (detail.websiteNote ?? 'Website') : 'No website'
                }
              />
              <Includes
                on={detail.includesCrm}
                label={detail.includesCrm ? (detail.crmNote ?? 'CRM') : 'No CRM'}
              />
              {detail.automationNote && <Includes on label={detail.automationNote} />}
              {detail.reportingCadence && (
                <Includes on label={`${detail.reportingCadence} reporting`} />
              )}
              {detail.freeBenefit && <Includes on label={detail.freeBenefit} />}
            </ul>
            {detail.bestFor && (
              <p className="text-micro text-text-tertiary">Best for: {detail.bestFor}</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** ⚠️ Highlights a row where the two columns disagree, rather than leaving the reader
 *  to compare two strings. A project above or below its package is legitimate — it is
 *  just the thing somebody opened this dialog to find out. */
function Row({
  label,
  listed,
  agreedValue,
}: {
  label: string;
  listed: string;
  agreedValue: string;
}) {
  const differs = listed !== '—' && agreedValue !== '—' && listed !== agreedValue;

  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="px-3 py-1.5 text-caption text-text-secondary">{label}</td>
      <td className="px-3 py-1.5 text-right text-caption tabular-nums text-text-tertiary">
        {listed}
      </td>
      <td
        className="px-3 py-1.5 text-right text-caption font-semibold tabular-nums"
        style={{ color: differs ? 'var(--feedback-warning)' : 'var(--text-primary)' }}
        title={differs ? 'Differs from the package — an add-on or a negotiated change' : undefined}
      >
        {agreedValue}
      </td>
    </tr>
  );
}

function Includes({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2 text-caption text-text-secondary">
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px]"
        style={
          on
            ? { backgroundColor: 'var(--feedback-success)' }
            : { border: '1px solid var(--border-strong)' }
        }
      >
        {on ? (
          <Check className="h-3 w-3" strokeWidth={3.5} style={{ color: '#fff' }} />
        ) : (
          <X className="h-3 w-3" strokeWidth={3} style={{ color: 'var(--text-tertiary)' }} />
        )}
      </span>
      {label}
    </li>
  );
}
