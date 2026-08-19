'use client';

import * as React from 'react';
import { Info } from 'lucide-react';

import { projectCatalogueAction } from '@/app/actions/projects';
import type { PackageRow, PlatformRow } from '@/lib/db/queries/catalogue';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

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
 * ========================================================================= */

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
  const [packageId, setPackageId] = React.useState(initial.packageId ?? '');
  const [fee, setFee] = React.useState(initial.monthlyFeePkr?.toString() ?? '');
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
    if (!next) return;

    setFee(next.monthlyFeePkr?.toString() ?? '');
    setAssetsMin(next.assetsMin?.toString() ?? '');
    setAssetsMax(next.assetsMax?.toString() ?? '');
    setReelsMin(next.reelsMin?.toString() ?? '');

    /* The package's own named platforms, where it names them. SPARK says
       Facebook and Instagram; GROWTH upward give a count and leave the choice
       open, so the ticks are left as they are rather than cleared. */
    if (next.defaultPlatformIds.length > 0) setChosen(next.defaultPlatformIds);
  };

  /* The package's limit, so over-ticking can be said out loud rather than
     silently accepted and then contradicted by an invoice. */
  const limit = chosenPackage?.platformCount ?? null;
  const overLimit = limit !== null && chosen.length > limit;

  return (
    <fieldset className="space-y-4 rounded-lg border border-border-subtle p-3">
      <legend className="px-1 text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
        What we sold them
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Internal or external"
          htmlFor="clientKind"
          hint="Inside the Attari Group, or a paying client."
        >
          <Select
            size="md"
            id="clientKind"
            name="clientKind"
            defaultValue={initial.clientKind ?? ''}
            options={[
              { value: '', label: 'Not set' },
              { value: 'internal', label: 'Internal — a group company' },
              { value: 'external', label: 'External — a paying client' },
            ]}
          />
        </Field>

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

      <Field
        label="Package"
        htmlFor="packageId"
        hint="Choosing one fills in the targets below. Change them freely — what you save is what this client was promised."
      >
        <Select
          size="md"
          id="packageId"
          name="packageId"
          value={packageId}
          onChange={(event) => applyPackage(event.target.value)}
          options={[
            { value: '', label: 'No package — services only' },
            ...packages.map((p) => ({
              value: p.id,
              label: `${p.name}${p.tagline ? ` — ${p.tagline}` : ''}`,
            })),
          ]}
        />
      </Field>

      {chosenPackage && (
        <p className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-micro text-text-secondary">
          <Info
            className="mt-px h-3.5 w-3.5 shrink-0"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--feedback-info)' }}
          />
          <span>
            {chosenPackage.name} lists{' '}
            {chosenPackage.platformCount ?? 'a custom number of'} platforms
            {chosenPackage.assetsMax !== null && (
              <>
                {' '}
                and{' '}
                {chosenPackage.assetsMin !== null && chosenPackage.assetsMin !== chosenPackage.assetsMax
                  ? `${chosenPackage.assetsMin}–${chosenPackage.assetsMax}`
                  : `up to ${chosenPackage.assetsMax}`}{' '}
                assets a month
              </>
            )}
            . {chosenPackage.includesWebsite ? chosenPackage.websiteNote ?? 'Website included' : 'No website'} ·{' '}
            {chosenPackage.includesCrm ? chosenPackage.crmNote ?? 'CRM included' : 'No CRM'}
          </span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Assets a month — minimum"
          htmlFor="assetsTargetMin"
          hint="The promise. Hitting this is the target met."
        >
          <Input
            id="assetsTargetMin"
            name="assetsTargetMin"
            type="number"
            min="0"
            value={assetsMin}
            onChange={(event) => setAssetsMin(event.target.value)}
          />
        </Field>

        <Field label="…and the ceiling" htmlFor="assetsTargetMax" hint="Anything above the minimum is bonus.">
          <Input
            id="assetsTargetMax"
            name="assetsTargetMax"
            type="number"
            min="0"
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
            value={reelsMin}
            onChange={(event) => setReelsMin(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monthly fee (PKR)" htmlFor="monthlyFeePkr" hint="What was agreed, not the list price.">
          <Input
            id="monthlyFeePkr"
            name="monthlyFeePkr"
            type="number"
            min="0"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
          />
        </Field>

        <Field label="Renews on" htmlFor="renewsOn" hint="For a retainer that rolls forward.">
          <Input id="renewsOn" name="renewsOn" type="date" defaultValue={initial.renewsOn ?? ''} />
        </Field>
      </div>

      {/* ---- Platforms ---- */}
      <div className="space-y-2">
        {/* Marks that the ticks WERE submitted. Without it the action cannot tell
            "no platforms chosen" from "this form never asked", and a status-only
            edit elsewhere would wipe the set. */}
        <input type="hidden" name="platformsSubmitted" value="1" />

        <p className="text-caption font-medium text-text-primary">
          Platforms
          {limit !== null && (
            <span className="ml-2 font-normal text-text-tertiary">
              {chosen.length} of {limit} in this package
            </span>
          )}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {platforms.map((platform) => {
            const on = chosen.includes(platform.id);
            return (
              <label
                key={platform.id}
                className={cn(
                  'cursor-pointer rounded-lg border px-2.5 py-1 text-micro font-semibold',
                  on
                    ? 'border-transparent bg-[image:var(--gradient-brand)] text-text-on-brand'
                    : 'border-border-subtle text-text-secondary hover:bg-bg-hover',
                )}
              >
                <input
                  type="checkbox"
                  name="platformIds"
                  value={platform.id}
                  checked={on}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, platform.id]
                        : current.filter((id) => id !== platform.id),
                    )
                  }
                  className="sr-only"
                />
                {platform.name}
              </label>
            );
          })}
        </div>

        {/* ⚠️ A WARNING, NOT A BLOCK. Over-ticking usually means an add-on was
            sold, and refusing it would make the form unable to record something
            that genuinely happened. The number is stated so the mismatch is a
            decision rather than an accident. */}
        {overLimit && (
          <p className="text-micro" style={{ color: 'var(--feedback-warning)' }}>
            {chosen.length} platforms ticked but {chosenPackage?.name} covers {limit}. Fine if an
            add-on was sold — worth checking the fee.
          </p>
        )}
      </div>
    </fieldset>
  );
}
