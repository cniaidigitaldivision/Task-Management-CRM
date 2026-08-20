'use client';

import * as React from 'react';
import { ArrowRight, Check, Clapperboard, ImageIcon, Wallet, X } from 'lucide-react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { WEEKDAY_LABEL } from '@/lib/domain/cadence';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT WAS SOLD — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"the View Contract button should, on click, pop up and display the package main
 * summary: how many platforms, how much this and that."*
 * Then: *"this design is not looking good. Please redesign it more beautifully
 * according to the theme, with a properly organized and very sleek design. It is just
 * putting the things like that."*
 *
 * Fair. The first version was a heading, a bare HTML table and a bullet list — the
 * information was right and the presentation was a spreadsheet.
 *
 * ── ⚠️ WHAT DECIDES THE LAYOUT: THE COMPARISON IS THE POINT ───────────────────
 * The package's LISTED terms and what this project actually AGREED are different facts
 * and can legitimately differ — migration 033's rule is that a project snapshots what
 * was promised, so editing STARTER next year must not rewrite an existing client's
 * deal. A project may sit above its package because an add-on was sold, or below it
 * because something was negotiated.
 *
 * A table made the reader compare two columns of digits to notice that. So the numbers
 * are now three COMPARISON TILES — listed, an arrow, agreed — and a tile whose two
 * sides differ carries a delta badge saying by how much. The difference is the thing
 * somebody opened this dialog to find, so it is the thing the design points at.
 *
 * ── THE BAND AT THE TOP ──────────────────────────────────────────────────────
 * Brand gradient, package name, tagline and the fee. It exists so the dialog opens on
 * an identity rather than on a table header — and because the fee is the single figure
 * most readers came for, it belongs where the eye lands first rather than in row three.
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
    postingDays: readonly number[];
    startDate: string | null;
  };
  platforms: readonly { id: string; name: string; slug: string }[];
  /** `project.view_finance`. Every money row is behind this. */
  canSeeFinance: boolean;
}) {
  const overTicked =
    detail?.platformCount != null && platforms.length > detail.platformCount;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={detail ? `${detail.name} — the agreement` : 'Customised arrangement'}
      description={`What ${projectName} was sold, and what is recorded against it.`}
      size="md"
      footer={
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* ══ THE BAND ══════════════════════════════════════════════════════ */}
        <div
          className="relative overflow-hidden rounded-xl px-4 py-3.5"
          style={{
            backgroundImage: 'var(--gradient-brand)',
            color: 'var(--text-on-brand)',
          }}
        >
          {/* A soft highlight from the top-right, so the band reads as a lit plane
              rather than a flat fill — the same device the sidebar and StatCards use. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 120% at 100% 0%, rgb(255 255 255 / 0.18) 0%, transparent 60%)',
            }}
          />
          <div className="relative flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-h3 font-semibold leading-tight">
                {detail?.name ?? 'Customised'}
              </p>
              {detail?.tagline && (
                <p className="mt-0.5 text-caption opacity-85">{detail.tagline}</p>
              )}
            </div>

            {canSeeFinance && (
              <div className="shrink-0 text-right">
                <p className="text-micro uppercase tracking-[0.08em] opacity-75">Monthly fee</p>
                <p className="tabular-nums text-h3 font-semibold leading-tight">
                  {money(agreed.monthlyFeePkr)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ══ PLATFORMS ═════════════════════════════════════════════════════ */}
        <section>
          <Heading>
            Platforms
            {detail?.platformCount != null && (
              <span
                className="ml-2 rounded-full px-1.5 py-0.5 text-micro font-semibold"
                style={{
                  backgroundColor: overTicked
                    ? 'color-mix(in oklab, var(--feedback-warning) var(--tint-strong), var(--bg-surface))'
                    : 'var(--bg-subtle)',
                  color: overTicked
                    ? 'color-mix(in oklab, var(--feedback-warning) 84%, var(--text-primary))'
                    : 'var(--text-secondary)',
                }}
              >
                {platforms.length} of {detail.platformCount}
              </span>
            )}
          </Heading>

          {platforms.length === 0 ? (
            <p className="text-micro text-text-secondary">None chosen yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((platform) => (
                <span
                  key={platform.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface py-1 pl-1 pr-2"
                >
                  <PlatformIcon slug={platform.slug} size={18} />
                  <span className="text-micro font-semibold text-text-secondary">
                    {platform.name}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* ⚠️ Stated, not refused — over-ticking usually means an add-on was sold,
              and hiding it would make the CRM unable to record what happened. */}
          {overTicked && (
            <p className="mt-1.5 text-micro" style={{ color: 'var(--feedback-warning)' }}>
              More platforms than {detail?.name} covers. Fine if an add-on was sold — worth
              checking the fee.
            </p>
          )}
        </section>

        {/* ══ LISTED vs AGREED ══════════════════════════════════════════════ */}
        <section>
          <Heading>
            The numbers
            <span className="ml-2 text-micro font-normal text-text-tertiary">
              package → this project
            </span>
          </Heading>

          <div className="grid gap-2 sm:grid-cols-3">
            <Compare
              icon={ImageIcon}
              label="Assets a month"
              listed={detail ? range(detail.assetsMin, detail.assetsMax) : null}
              agreedValue={range(agreed.assetsTargetMin, agreed.assetsTargetMax)}
            />
            <Compare
              icon={Clapperboard}
              label="Reels a month"
              listed={detail?.reelsMin != null ? String(detail.reelsMin) : null}
              agreedValue={agreed.reelsTargetMin != null ? String(agreed.reelsTargetMin) : '—'}
            />
            {canSeeFinance ? (
              <Compare
                icon={Wallet}
                label="Monthly fee"
                listed={detail ? money(detail.monthlyFeePkr, detail.feeIsFrom) : null}
                agreedValue={money(agreed.monthlyFeePkr)}
              />
            ) : (
              /* The tile is not rendered empty for a Coordinator — a greyed-out money
                 box invites asking who can see it. The grid simply has two columns. */
              null
            )}
          </div>
        </section>

        {/* ══ THE RHYTHM ════════════════════════════════════════════════════ */}
        <section>
          <Heading>The rhythm</Heading>
          <div className="rounded-xl border border-border-subtle bg-bg-surface-sunken p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Fact
                label="Static posts"
                value={
                  agreed.staticPostsPerDay === null
                    ? '—'
                    : `${agreed.staticPostsPerDay} a day`
                }
              />
              <Fact
                label="Reels"
                value={
                  agreed.reelsPerWeek === null ? '—' : `${agreed.reelsPerWeek} a week`
                }
              />
              <Fact label="Started" value={agreed.startDate ?? '—'} />
            </div>

            {/* The working week, drawn. Owner's standing rule: an off day must be
                visible as an off day, not as a gap. */}
            <div className="mt-2.5 flex gap-1">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
                const on = agreed.postingDays.includes(day);
                return (
                  <span
                    key={day}
                    title={on ? `${WEEKDAY_LABEL[day]} — posting` : `${WEEKDAY_LABEL[day]} — off`}
                    className={cn(
                      'flex-1 rounded-md py-1 text-center text-micro font-semibold',
                      on ? 'text-text-on-brand' : 'text-text-disabled',
                    )}
                    style={
                      on
                        ? { backgroundColor: 'var(--accent-primary)' }
                        : {
                            background:
                              'repeating-linear-gradient(135deg, var(--bg-surface) 0 3px, transparent 3px 6px)',
                            boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
                          }
                    }
                  >
                    {WEEKDAY_LABEL[day]}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══ INCLUDED ══════════════════════════════════════════════════════ */}
        {detail && (
          <section>
            <Heading>Included</Heading>
            <div className="flex flex-wrap gap-1.5">
              <Includes
                on={detail.includesWebsite}
                label={detail.includesWebsite ? (detail.websiteNote ?? 'Website') : 'No website'}
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
            </div>
            {detail.bestFor && (
              <p className="mt-2 text-micro text-text-tertiary">Best for: {detail.bestFor}</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex flex-wrap items-center text-micro font-semibold uppercase tracking-[0.07em] text-text-tertiary">
      {children}
    </h3>
  );
}

/**
 * One comparison tile: what the package lists, an arrow, what this project agreed.
 *
 * ⚠️ The delta badge is the reason this is a tile and not a table row. A reader
 * scanning two columns of digits does not notice that 32 is not 22; a badge saying
 * "+10" does the noticing for them. `listed === null` means the project is on a
 * customised arrangement, so there is nothing to compare against and the tile shows
 * only the agreed figure rather than an invented baseline.
 */
function Compare({
  icon: Icon,
  label,
  listed,
  agreedValue,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  listed: string | null;
  agreedValue: string;
}) {
  const comparable = listed !== null && listed !== '—' && agreedValue !== '—';
  const differs = comparable && listed !== agreedValue;

  /* Only a difference between two plain integers can be expressed as a delta. A
     range ("22–25") or a formatted fee has no single number to subtract, so those
     get the highlight without a badge rather than a wrong one. */
  const listedNum = listed !== null && /^\d+$/.test(listed) ? Number(listed) : null;
  const agreedNum = /^\d+$/.test(agreedValue) ? Number(agreedValue) : null;
  const delta =
    listedNum !== null && agreedNum !== null && listedNum !== agreedNum
      ? agreedNum - listedNum
      : null;

  return (
    <div
      className="rounded-xl border p-2.5"
      style={{
        borderColor: differs
          ? 'color-mix(in oklab, var(--feedback-warning) 40%, transparent)'
          : 'var(--border-subtle)',
        backgroundColor: differs
          ? 'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))'
          : 'var(--bg-surface)',
      }}
    >
      <p className="flex items-center gap-1.5 text-micro text-text-tertiary">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>

      <div className="mt-1 flex items-baseline gap-1.5">
        {listed !== null && (
          <>
            <span className="tabular-nums text-caption text-text-tertiary line-through decoration-1">
              {listed}
            </span>
            <ArrowRight
              className="h-3 w-3 shrink-0 self-center text-text-tertiary"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </>
        )}
        <span className="tabular-nums text-body font-semibold text-text-primary">
          {agreedValue}
        </span>

        {delta !== null && (
          <span
            className="ml-auto shrink-0 rounded-full px-1.5 text-micro font-bold tabular-nums"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-warning) var(--tint-strong), var(--bg-surface))',
              color: 'color-mix(in oklab, var(--feedback-warning) 84%, var(--text-primary))',
            }}
            title="Differs from the package — an add-on or a negotiated change"
          >
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-micro text-text-tertiary">{label}</span>
      <span className="block truncate text-caption font-semibold text-text-primary">{value}</span>
    </span>
  );
}

function Includes({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-micro font-semibold"
      style={{
        backgroundColor: on
          ? 'color-mix(in oklab, var(--feedback-success) var(--tint-medium), var(--bg-surface))'
          : 'var(--bg-subtle)',
        color: on
          ? 'color-mix(in oklab, var(--feedback-success) 84%, var(--text-primary))'
          : 'var(--text-tertiary)',
      }}
    >
      {on ? (
        <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
      ) : (
        <X className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
