'use client';

import * as React from 'react';
import { Building2, Handshake, HelpCircle, Info, Sparkles } from 'lucide-react';

import { projectCatalogueAction } from '@/app/actions/projects';
import type { PackageRow, PlatformRow } from '@/lib/db/queries/catalogue';
import { ChoiceCards, type Choice } from '@/components/ui/choice-card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { PlatformPicker } from './platform-picker';

/* ============================================================================
 * PACKAGE → PLATFORMS → TARGETS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: *"the package should appear in the field. Definitely by
 * default the package has that value but we can adjust those values at the time
 * of creation of a project. We can put how many reels, how many static posts."*
 *
 * So the package is a TEMPLATE. Choosing it fills the boxes; the boxes are then
 * yours. Nothing here is read-only.
 *
 * ── ⚠️ WHY THE PREFILL ONLY OVERWRITES ON AN ACTUAL CHANGE ───────────────────
 * The obvious implementation syncs the targets to the package on every render.
 * That would silently revert an edit: type 20 into assets, blur, and any re-render
 * puts 16 back. So the package's numbers are copied exactly once per package
 * change — and never when editing an existing project, whose numbers are the
 * AGREED ones and outrank whatever the package says today.
 *
 * That is the same principle as the schema: the project holds what was agreed,
 * the package only suggests. Editing SPARK next year must not rewrite history.
 *
 * ── THE REDESIGN (owner request 2026-08-19) ──────────────────────────────────
 * *"The form just looks like plain blank paper."*
 *
 * Two dropdowns became card grids, and not for decoration. A `<select>` shows one
 * option at a time, which meant choosing "GROWTH" committed the division to a fee,
 * an asset range and a platform allowance that the control never displayed — the
 * form asked for a commercial decision while hiding the commercial terms. The cards
 * put the money on the face of the thing you are clicking.
 *
 * The platform ticks moved to `platform-picker.tsx`, which carries the real brand
 * marks. See its header for why they are squares and not radios.
 * ========================================================================= */

/** PKR, grouped. Locale passed explicitly — an argless `toLocaleString()` renders
 *  differently on server and client and React reports a hydration mismatch. */
function fee(amount: number | null, isFrom: boolean): string {
  if (amount === null) return 'Custom';
  const rounded = amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(amount);
  return `${isFrom ? 'from ' : ''}PKR ${rounded}`;
}

/** "14–16 assets", "up to 75 assets", or nothing where the package states neither. */
function assetsLine(pkg: PackageRow): string | null {
  const { assetsMin, assetsMax } = pkg;
  /* ⚠️ null and 0 are different claims and must read differently — the same rule
     the target columns and every report follow. */
  if (assetsMin === null && assetsMax === null) return null;
  if (assetsMin === null) return `up to ${assetsMax} assets`;
  if (assetsMax === null || assetsMax === assetsMin) return `${assetsMin} assets`;
  return `${assetsMin}–${assetsMax} assets`;
}

export function PackageFields({
  initial,
}: {
  initial: {
    clientKind: 'internal' | 'external' | null;
    clientId: string | null;
    packageId: string | null;
    monthlyFeePkr: number | null;
    assetsTargetMin: number | null;
    assetsTargetMax: number | null;
    reelsTargetMin: number | null;
    renewsOn: string | null;
    platformIds: readonly string[];
  };
}) {
  const [clientKind, setClientKind] = React.useState(initial.clientKind ?? '');
  const [packageId, setPackageId] = React.useState(initial.packageId ?? '');
  const [feeValue, setFeeValue] = React.useState(initial.monthlyFeePkr?.toString() ?? '');
  const [assetsMin, setAssetsMin] = React.useState(initial.assetsTargetMin?.toString() ?? '');
  const [assetsMax, setAssetsMax] = React.useState(initial.assetsTargetMax?.toString() ?? '');
  const [reelsMin, setReelsMin] = React.useState(initial.reelsTargetMin?.toString() ?? '');
  const [chosen, setChosen] = React.useState<readonly string[]>(initial.platformIds);

  /* ── The catalogue, fetched when the form opens ────────────────────────────
     Not passed in: `AppShell` also renders this dialog, so props would mean
     loading packages in the root layout and every page paying for it. See
     `projectCatalogueAction`. */
  const [packages, setPackages] = React.useState<readonly PackageRow[]>([]);
  const [platforms, setPlatforms] = React.useState<readonly PlatformRow[]>([]);
  const [clients, setClients] = React.useState<
    readonly { id: string; name: string; isInternal: boolean }[]
  >([]);

  React.useEffect(() => {
    let cancelled = false;
    void projectCatalogueAction().then((data) => {
      if (cancelled) return;
      setPackages(data.packages);
      setPlatforms(data.platforms);
      setClients(data.clients);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chosenPackage = packages.find((p) => p.id === packageId) ?? null;

  /** Applied on a real change only — see the header. */
  const applyPackage = (nextId: string) => {
    setPackageId(nextId);
    const next = packages.find((p) => p.id === nextId);

    /* "No package — services only" clears the suggestion rather than leaving the
       previous package's numbers behind as though they were agreed. */
    if (!next) {
      setFeeValue('');
      setAssetsMin('');
      setAssetsMax('');
      setReelsMin('');
      return;
    }

    setFeeValue(next.monthlyFeePkr?.toString() ?? '');
    setAssetsMin(next.assetsMin?.toString() ?? '');
    setAssetsMax(next.assetsMax?.toString() ?? '');
    setReelsMin(next.reelsMin?.toString() ?? '');

    /* The package's own named platforms, where it names them. SPARK says Facebook
       and Instagram; GROWTH upward give a count and leave the choice open, so the
       ticks are left as they are rather than cleared. */
    if (next.defaultPlatformIds.length > 0) setChosen(next.defaultPlatformIds);
  };

  const packageChoices: readonly Choice[] = [
    {
      value: '',
      label: 'No package',
      hint: 'Services only, or nothing sold yet',
      token: 'text-tertiary',
    },
    ...packages.map((p) => ({
      value: p.id,
      label: p.name,
      meta: fee(p.monthlyFeePkr, p.feeIsFrom),
      hint:
        [assetsLine(p), p.platformCount !== null ? `${p.platformCount} platforms` : null]
          .filter(Boolean)
          .join(' · ') || (p.bestFor ?? undefined),
      token: 'accent-primary',
    })),
  ];

  return (
    <div className="space-y-5">
      {/* ---- Internal or external, and who for ---- */}
      <div className="space-y-2">
        <p className="text-caption font-semibold text-text-primary">Who is this for?</p>
        <ChoiceCards
          ariaLabel="Internal or external"
          name="clientKind"
          value={clientKind}
          onChange={setClientKind}
          choices={[
            {
              value: 'internal',
              label: 'Internal',
              hint: 'Another Attari Group company',
              icon: Building2,
              token: 'accent-gold',
            },
            {
              value: 'external',
              label: 'External client',
              hint: 'A paying client outside the group',
              icon: Handshake,
              token: 'accent-primary',
            },
            /* ⚠️ A third card, not an omission. Radios cannot be un-picked, so
               without this the answer is one-way: an editor who ticked the wrong one
               could never get back to "not recorded", which the old `<Select>`
               offered as "Not set". It also stops a guess being the cheapest way out
               — and the monthly report already had to grow an "unclassified" figure
               because six projects were never classified, so a deliberate "not yet"
               is worth more here than a coerced answer. */
            {
              value: '',
              label: 'Not yet',
              hint: 'Decide later — reports will show it as unclassified',
              icon: HelpCircle,
              token: 'text-tertiary',
            },
          ]}
          columns={3}
        />

        <Field
          label="Client"
          htmlFor="clientId"
          hint={
            clients.length === 0
              ? 'No clients recorded yet. This can be left blank.'
              : 'Groups every project for the same client in reports.'
          }
        >
          <Select
            size="md"
            id="clientId"
            name="clientId"
            defaultValue={initial.clientId ?? ''}
            options={[
              { value: '', label: 'Not linked to a client' },
              ...clients.map((c) => ({
                value: c.id,
                label: `${c.name}${c.isInternal ? ' · internal' : ''}`,
              })),
            ]}
          />
        </Field>
      </div>

      {/* ---- The package ---- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-caption font-semibold text-text-primary">What was sold</p>
          <p className="text-micro text-text-tertiary">
            Picking one fills the targets below — they stay editable
          </p>
        </div>

        {packages.length === 0 ? (
          <div className="grid gap-2 sm:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[62px] animate-pulse rounded-xl bg-bg-active" />
            ))}
          </div>
        ) : (
          <ChoiceCards
            ariaLabel="Package"
            name="packageId"
            value={packageId}
            onChange={applyPackage}
            choices={packageChoices}
            columns={3}
          />
        )}

        {chosenPackage && (
          <p className="flex items-start gap-2 text-micro text-text-secondary">
            <Info
              className="mt-px h-3.5 w-3.5 shrink-0"
              strokeWidth={2.25}
              aria-hidden="true"
              style={{ color: 'var(--feedback-info)' }}
            />
            <span>
              {chosenPackage.includesWebsite
                ? (chosenPackage.websiteNote ?? 'Website included')
                : 'No website'}{' '}
              ·{' '}
              {chosenPackage.includesCrm ? (chosenPackage.crmNote ?? 'CRM included') : 'No CRM'}
              {chosenPackage.reportingCadence && ` · ${chosenPackage.reportingCadence} reporting`}
              {chosenPackage.freeBenefit && ` · ${chosenPackage.freeBenefit}`}
            </span>
          </p>
        )}
      </div>

      {/* ---- What was actually agreed ----
          Tinted, because these four numbers are the ones every report and every
          progress bar is judged against. They arrive suggested and leave agreed. */}
      <div
        className="space-y-3 rounded-xl p-3.5"
        style={{
          backgroundColor:
            'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
          border: '1px solid color-mix(in oklab, var(--accent-primary) 22%, transparent)',
        }}
      >
        <p className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <Sparkles
            className="h-3.5 w-3.5"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--accent-primary)' }}
          />
          What we promised them
          {chosenPackage && (
            <span className="font-normal text-text-tertiary">
              — suggested by {chosenPackage.name}, adjust freely
            </span>
          )}
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Assets a month"
            htmlFor="assetsTargetMin"
            hint="The minimum. Hitting it is the target met."
          >
            <Input
              id="assetsTargetMin"
              name="assetsTargetMin"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="14"
              value={assetsMin}
              onChange={(event) => setAssetsMin(event.target.value)}
            />
          </Field>

          <Field label="…up to" htmlFor="assetsTargetMax" hint="Above the minimum is bonus.">
            <Input
              id="assetsTargetMax"
              name="assetsTargetMax"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="16"
              value={assetsMax}
              onChange={(event) => setAssetsMax(event.target.value)}
            />
          </Field>

          <Field
            label="Reels a month"
            htmlFor="reelsTargetMin"
            hint="Counted inside the asset total, not on top."
          >
            <Input
              id="reelsTargetMin"
              name="reelsTargetMin"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="2"
              value={reelsMin}
              onChange={(event) => setReelsMin(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Monthly fee (PKR)"
            htmlFor="monthlyFeePkr"
            hint="What was agreed, not the list price."
          >
            <Input
              id="monthlyFeePkr"
              name="monthlyFeePkr"
              type="number"
              min="0"
              inputMode="numeric"
              value={feeValue}
              onChange={(event) => setFeeValue(event.target.value)}
            />
          </Field>

          <Field label="Renews on" htmlFor="renewsOn" hint="For a retainer that rolls forward.">
            <Input
              id="renewsOn"
              name="renewsOn"
              type="date"
              defaultValue={initial.renewsOn ?? ''}
            />
          </Field>
        </div>
      </div>

      {/* ---- Platforms, with their real app icons ---- */}
      <PlatformPicker
        platforms={platforms}
        chosen={chosen}
        onChange={setChosen}
        limit={chosenPackage?.platformCount ?? null}
        packageName={chosenPackage?.name ?? null}
      />
    </div>
  );
}
