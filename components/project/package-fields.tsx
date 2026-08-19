'use client';

import * as React from 'react';
import { Building2, Check, Globe, Handshake, HelpCircle, LayoutDashboard, X } from 'lucide-react';

import { projectCatalogueAction } from '@/app/actions/projects';
import type { PackageRow, PlatformRow } from '@/lib/db/queries/catalogue';
import { suggestCadence, type Cadence } from '@/lib/domain/cadence';
import { ChoiceCards, type Choice } from '@/components/ui/choice-card';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { CadenceFields } from './cadence-fields';
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
  canSeeFinance,
}: {
  /** `project.view_finance` — Admin and above. Owner: money is theirs only. */
  canSeeFinance: boolean;
  initial: {
    staticPostsPerDay: number | null;
    reelsPerWeek: number | null;
    reelDays: readonly number[];
    postingDays: readonly number[];
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

  /**
   * The rhythm the cadence block starts from.
   *
   * ⚠️ On an EDIT this is what the project already agreed, never the package's
   * suggestion — migration 033's rule, and the reason `initial.staticPostsPerDay`
   * wins. On a new project with a package chosen it is `suggestCadence`, which is a
   * starting point rather than a translation: the packages were written as monthly
   * quantities and a month does not divide into whole weeks. See that function's
   * header — the derived figures are shown beside the package's own so any gap is
   * the reader's decision rather than a silent rounding.
   */
  const cadenceSeed: Cadence = React.useMemo(() => {
    const agreed =
      initial.staticPostsPerDay !== null ||
      initial.reelsPerWeek !== null ||
      initial.reelDays.length > 0;

    if (agreed) {
      return {
        staticPostsPerDay: initial.staticPostsPerDay,
        reelsPerWeek: initial.reelsPerWeek,
        reelDays: initial.reelDays as Cadence['reelDays'],
        postingDays: initial.postingDays as Cadence['postingDays'],
      };
    }

    if (chosenPackage) {
      return suggestCadence({
        assetsMin: chosenPackage.assetsMin,
        reelsMin: chosenPackage.reelsMin,
      });
    }

    return {
      staticPostsPerDay: null,
      reelsPerWeek: null,
      reelDays: [],
      postingDays: (initial.postingDays.length > 0
        ? initial.postingDays
        : [1, 2, 3, 4, 5, 6]) as Cadence['postingDays'],
    };
  }, [chosenPackage, initial]);

  /** Applied on a real change only — see the header. */
  const applyPackage = (nextId: string) => {
    setPackageId(nextId);
    const next = packages.find((p) => p.id === nextId);
    if (!next) return;

    /* The package's own named platforms, where it names them. SPARK says Facebook
       and Instagram; GROWTH upward give a count and leave the choice open, so the
       ticks are left as they are rather than cleared. */
    if (next.defaultPlatformIds.length > 0) setChosen(next.defaultPlatformIds);
  };

  const packageChoices: readonly Choice[] = [
    {
      /* ⚠️ "Customized package", not "No package". Owner, 2026-08-19: *"Instead of
         No Package say Customize Package. Definitely everyone has some customized
         package, especially the internal businesses have some customized package."*
         The stored value is still an empty `package_id` — this is about what the
         choice MEANS. "No package" read as an absence of any agreement, when in fact
         a bespoke arrangement is the normal case for internal work. */
      value: '',
      label: 'Customized package',
      hint: 'Bespoke — set the rhythm and fee yourself',
      token: 'accent-gold',
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

        {/* ── What the package includes, as ticks ────────────────────────────
            Owner, 2026-08-19: *"for website, also maintain or add a checkbox for
            website auto-check. This will be auto-checked. For CRM, that should be a
            name but the auto checkbox will be auto-checked because you have selected
            a package in which all the things are mentioned."*

            ⚠️ These are INDICATORS, not inputs — `includes_website` and
            `includes_crm` belong to the package, and a tick a human could change
            here would be a second, contradicting copy of a fact the catalogue
            already owns. So they show the package's answer, and they change when the
            package does. Choosing a different package is how you change them, which
            is what "auto-checked" has to mean if the figure is to stay true.
            Rendered as a real disabled checkbox rather than a ✓/✗ glyph so the
            distinction reads as "decided for you", not "you forgot to tick it". */}
        {chosenPackage && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
            <Included
              on={chosenPackage.includesWebsite}
              icon={Globe}
              label={
                chosenPackage.includesWebsite
                  ? (chosenPackage.websiteNote ?? 'Website')
                  : 'No website'
              }
            />
            <Included
              on={chosenPackage.includesCrm}
              icon={LayoutDashboard}
              label={chosenPackage.includesCrm ? (chosenPackage.crmNote ?? 'CRM') : 'No CRM'}
            />
            {chosenPackage.reportingCadence && (
              <span className="text-micro text-text-tertiary">
                {chosenPackage.reportingCadence} reporting
              </span>
            )}
            {chosenPackage.freeBenefit && (
              <span className="text-micro text-text-tertiary">{chosenPackage.freeBenefit}</span>
            )}
          </div>
        )}
      </div>

      {/* ---- The posting rhythm, and what it promises ----
          ⚠️ This replaced three monthly boxes — "assets a month minimum", "…and
          the ceiling" and "reels a month" — plus the fee and a "renews on" date.
          Owner, 2026-08-19: nobody agrees a month, they agree a rhythm; and
          *"Remove this field. We don't need it"* for the renewal date.

          The `key` on the package deliberately REMOUNTS the whole block when the
          package changes, which is what applies its suggested rhythm. That is the
          same "copy once per real change" rule the old prefill followed, and it is
          why the numbers can then be edited without a re-render reverting them.
          Editing SPARK next year still must not rewrite this project. */}
      <CadenceFields
        key={packageId || 'custom'}
        initial={cadenceSeed}
        canSeeFinance={canSeeFinance}
        monthlyFeePkr={initial.monthlyFeePkr}
      />

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

/* ----------------------------------------------------------------------------
 * A PACKAGE INCLUSION
 * ----------------------------------------------------------------------------
 * `disabled` and `readOnly`, because it reports the catalogue's answer rather than
 * collecting one — and no `name`, so it cannot post a value that would compete with
 * `package_id` as the record of what was sold.
 * ------------------------------------------------------------------------- */
function Included({
  on,
  icon: Icon,
  label,
}: {
  on: boolean;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-micro"
      style={{ color: on ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}
      title={on ? `${label} — included in this package` : label}
    >
      <span
        aria-hidden="true"
        className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border"
        style={
          on
            ? { backgroundColor: 'var(--feedback-success)', borderColor: 'transparent' }
            : { borderColor: 'var(--border-strong)' }
        }
      >
        {on ? (
          <Check className="h-[11px] w-[11px]" strokeWidth={3.5} style={{ color: '#fff' }} />
        ) : (
          <X className="h-[11px] w-[11px]" strokeWidth={3} style={{ color: 'var(--text-tertiary)' }} />
        )}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
