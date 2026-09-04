'use client';

import { ChevronDown, Info, Lock } from 'lucide-react';

import { DonutChart } from '@/components/ui/chart';
import type { StudioAccount } from '@/lib/db/queries/meta-studio';

import { Flag } from './flags';

/* ============================================================================
 * AUDIENCE — TOP LOCATIONS AND AGE & GENDER
 * ----------------------------------------------------------------------------
 * Owner asked for both panels from the screenshots, and then for this exact
 * treatment once told they cannot be filled yet, 2026-09-04:
 *
 *   *"Please create this part and show this information or this message that
 *   this is coming or this will start showing when the followers are 100…
 *   Add some dummy data just for good UI and show that this is just dummy and
 *   it will be converted to a real demographic server when the followers are
 *   100."*
 *
 * ── ⚠️ WHY THE PANELS ARE EMPTY, VERIFIED NOT ASSUMED ───────────────────────
 * `follower_demographics` returns `{"data": []}` — EMPTY, not an error — for an
 * account below 100 followers. Meta's privacy floor. The connected account has
 * 16. Tested against the live API on 2026-09-04; see
 * docs/meta-integration/01-VERIFIED-API-FACTS.md §5.
 *
 * ── ⚠️ THE SAMPLE LABELLING IS THE WHOLE DESIGN PROBLEM HERE ────────────────
 * Placeholder numbers that later read as real is the one failure mode that
 * matters, and it is not hypothetical: these panels sit beside six cards of
 * genuine figures, and somebody screenshotting this page for a client would have
 * no reason to suspect two of them are invented. So the marking is deliberately
 * redundant — five separate signals, any one of which is enough:
 *
 *   1. The heading itself says "Sample".
 *   2. A badge on the panel, in the warning colour, reading SAMPLE DATA.
 *   3. A sentence naming the real follower count and the 100 threshold.
 *   4. The whole panel is dimmed and desaturated against its neighbours.
 *   5. A diagonal hatch behind the charts that no real panel has.
 *
 * ⚠️ DO NOT "TIDY" THESE AWAY. A future session reducing this to one subtle
 * badge would be removing the thing that stops invented numbers being read as a
 * client's real audience.
 * ========================================================================= */

/** Meta's own privacy floor for follower demographics. */
const DEMOGRAPHICS_THRESHOLD = 100;

/* ⚠️ INVENTED, AND DELIBERATELY NOT PLAUSIBLE-LOOKING AS THIS CLIENT'S DATA.
   Round numbers rather than realistic ones, so that even stripped of every label
   these read as a placeholder rather than as a measurement. */
const SAMPLE_AGES = [
  { label: '25–34', value: 40, token: 'chart-1' },
  { label: '18–24', value: 25, token: 'chart-2' },
  { label: '35–44', value: 20, token: 'chart-3' },
  { label: '45+', value: 15, token: 'chart-4' },
];

export function AudienceSample({
  accounts,
  className,
}: {
  accounts: readonly StudioAccount[];
  className?: string;
}) {
  /* The largest connected account decides — demographics unlock per account, and
     the nearest one to the threshold is the useful thing to report. */
  const best = accounts.reduce<number>((max, a) => Math.max(max, a.followers ?? 0), 0);
  const unlocked = best >= DEMOGRAPHICS_THRESHOLD;
  const remaining = Math.max(0, DEMOGRAPHICS_THRESHOLD - best);

  /* ⚠️ Once past the threshold this must stop inventing and start reading. It
     cannot yet — the sync does not collect demographics — so it says exactly
     that rather than showing a sample that has become indistinguishable from a
     real one. */
  if (unlocked) {
    return (
      <section
        className={`flex min-w-0 flex-col rounded-xl border border-border-subtle bg-bg-surface p-3.5 ${className ?? ''}`}
      >
        <h2 className="mb-3 text-caption font-semibold text-text-primary">Audience</h2>
        <p className="grid flex-1 place-items-center rounded-lg border border-dashed border-border-subtle px-3 py-5 text-center text-micro text-text-tertiary">
          Past {DEMOGRAPHICS_THRESHOLD} followers, so Meta will now report audience
          demographics. Collecting them is the next piece of work.
        </p>
      </section>
    );
  }

  const total = SAMPLE_AGES.reduce((n, a) => n + a.value, 0);

  return (
    <section
      /* ⚠️ THE DASHED BORDER AND THE BADGE STAY. This card sits between two
         panels of measured figures, and it is the only one on the page whose
         numbers are invented. Every signal that says so is load-bearing. */
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-dashed border-border-default bg-bg-surface p-3.5 ${className ?? ''}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, var(--text-primary) 0 1px, transparent 1px 9px)',
        }}
      />

      <header className="relative mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          Audience
          <span
            title="Age and gender split of this account's followers. Sample figures until the account passes 100 followers."
            className="grid size-3.5 shrink-0 cursor-help place-items-center rounded-full border border-border-default text-[0.55rem] font-bold text-text-tertiary"
          >
            i
          </span>
        </h2>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 18%, transparent)',
            color: 'var(--feedback-warning)',
          }}
        >
          <Lock className="size-2.5" aria-hidden="true" />
          Sample
        </span>
      </header>

      <div className="relative flex flex-1 items-center gap-3 opacity-70">
        <DonutChart
          slices={SAMPLE_AGES}
          centreLabel="Age"
          centreValue="—"
          size={104}
          thickness={11}
          format="percent"
          caption="Sample audience by age — placeholder figures, not this account's data"
        />
        <ul className="min-w-0 flex-1 space-y-1.5">
          {SAMPLE_AGES.map((a) => (
            <li key={a.label} className="flex items-center gap-2 text-micro">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--${a.token})` }}
              />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{a.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-text-primary">
                {Math.round((a.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative mt-auto flex items-start gap-1.5 pt-3 text-[0.62rem] leading-snug text-text-tertiary">
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold" style={{ color: 'var(--feedback-warning)' }}>
            Sample figures.
          </strong>{' '}
          Meta reports audience only above {DEMOGRAPHICS_THRESHOLD} followers — {remaining} more
          to go.
        </span>
      </p>
    </section>
  );
}

/* ============================================================================
 * TOP LOCATIONS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04: *"For the top location countries, whether it's dummy data,
 * you still have to show the exact UI over here. You can just mention it's dummy
 * data or just a small figure. Definitely I will tell everyone that it's not
 * really implemented."*
 *
 * ⚠️ SO THE SHAPE IS THE REFERENCE'S AND THE NUMBERS ARE NOT REAL, and the panel
 * says so in its own heading rather than only in a footnote. Meta returns
 * `follower_demographics` as EMPTY below 100 followers — verified, not assumed —
 * and the connected account has 16.
 *
 * The owner is right that a panel present in sample form is more useful than a
 * gap: it fixes the layout, and everyone reviewing it can see what the finished
 * thing will look like. The risk is only that somebody later forgets. That is
 * what the badge and the dashed border are for, and they are not decoration to
 * be tidied away.
 * ========================================================================= */

/* ⚠️ COUNTRY CODES IN A TINTED CHIP, NOT FLAG EMOJI. The first version used 🇵🇰
   and friends, and the owner's screenshot showed bare "PK", "IN", "BD" — Windows
   ships no glyphs for regional-indicator pairs, so the browser falls back to the
   two letters with none of the styling. Rather than depend on a font the reader
   may not have, the code IS the mark: a tinted rounded chip that renders
   identically everywhere and reads at 11px. */
const SAMPLE_LOCATIONS = [
  { key: 'PK', label: 'Pakistan', share: 0.45, value: '23.6K' },
  { key: 'IN', label: 'India', share: 0.2, value: '10.5K' },
  { key: 'BD', label: 'Bangladesh', share: 0.12, value: '6.3K' },
  { key: 'US', label: 'United States', share: 0.08, value: '4.2K' },
  { key: 'GB', label: 'United Kingdom', share: 0.05, value: '2.6K' },
];

const LOCATION_TOKENS = ['chart-3', 'chart-1', 'chart-4', 'chart-2', 'chart-5'];

export function TopLocations({
  accounts,
  className,
}: {
  accounts: readonly StudioAccount[];
  className?: string;
}) {
  const best = accounts.reduce<number>((max, a) => Math.max(max, a.followers ?? 0), 0);
  const remaining = Math.max(0, DEMOGRAPHICS_THRESHOLD - best);

  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-border-subtle bg-bg-surface p-3.5 shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] ${className ?? ''}`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          Top Locations
          <span
            title="Where this account's audience is. Sample figures until the account passes 100 followers."
            className="grid size-3.5 shrink-0 cursor-help place-items-center rounded-full border border-border-default text-[0.55rem] font-bold text-text-tertiary"
          >
            i
          </span>
        </h2>

        {/* The reference's "Countries ▾". Only one grouping exists today —
            Meta also reports city and country — so it is present and inert
            rather than absent, which keeps the header's shape. */}
        <span className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-micro text-text-secondary">
          Countries
          <ChevronDown className="size-3 text-text-tertiary" aria-hidden="true" />
        </span>
      </header>

      {/* ── ⚠️ THE RULE UNDER EACH ROW IS THE BAR ────────────────────────────
          Measured off the reference rather than guessed: it is not a divider
          with a separate bar above it. It is ONE full-width hairline whose left
          portion is coloured to the country's share, so the row's separator and
          its data are the same three pixels. That is what keeps five rows this
          compact — a bar on its own line would make the card half as tall
          again. */}
      <ul className="space-y-0">
        {SAMPLE_LOCATIONS.map((c, i) => (
          <li key={c.key} className="pt-2 first:pt-0">
            <div className="flex items-center gap-2.5">
              <Flag code={c.key} />
              <span className="min-w-0 flex-1 truncate text-micro text-text-primary" title={c.label}>
                {c.label}
              </span>
              <span className="shrink-0 text-micro tabular-nums text-text-secondary">
                {Math.round(c.share * 100)}%
              </span>
              <span className="w-11 shrink-0 text-right text-micro font-semibold tabular-nums text-text-primary">
                {c.value}
              </span>
            </div>

            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="h-full origin-left rounded-full motion-safe:animate-[studio-grow_650ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
                style={{
                  width: `${Math.max(3, c.share * 100)}%`,
                  backgroundColor: `var(--${LOCATION_TOKENS[i % LOCATION_TOKENS.length]})`,
                  animationDelay: `${i * 70}ms`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled
        title="Arrives with the Analytics & Insights tab"
        className="group mt-3 inline-flex items-center gap-1.5 self-start text-micro font-medium text-text-brand opacity-70"
      >
        View all locations
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </button>

      {/* ⚠️ THE SAMPLE NOTE STAYS, and stays last. The owner asked for the
          reference's exact card, and the reference's card does not carry this
          line — but its numbers are real and these are not. Everything above is
          the reference; this is the one addition, and it is the difference
          between a mock-up and a lie. */}
      <p className="mt-auto flex items-start gap-1.5 pt-3 text-[0.62rem] leading-snug text-text-tertiary">
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold" style={{ color: 'var(--feedback-warning)' }}>
            Sample figures.
          </strong>{' '}
          Meta reports audience only above {DEMOGRAPHICS_THRESHOLD} followers — {remaining} more
          to go.
        </span>
      </p>
    </section>
  );
}
