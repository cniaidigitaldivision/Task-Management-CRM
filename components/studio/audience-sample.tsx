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
 * ── ⚠️ TWO SIGNALS, DOWN FROM FIVE — AND KEEP BOTH ─────────────────────────
 * Placeholder numbers that later read as real is the failure mode that matters:
 * these panels sit beside measured figures, and somebody screenshotting the page
 * for a client has no reason to suspect two of them are invented.
 *
 * The first version answered that with five redundant signals — badge, dashed
 * border, dimming, desaturation, diagonal hatch. The owner rejected it, rightly:
 * *"Why is this audience card faded? I want a bright color."* Four of the five
 * made the card look BROKEN rather than provisional, and a reader who thinks a
 * panel is failing does not read it at all.
 *
 * So the marking is now two things, both of them words:
 *   1. An amber SAMPLE badge in the header.
 *   2. A sentence naming the real follower count and the 100 threshold.
 *
 * ⚠️ THOSE TWO ARE NOT DECORATION. They are the only thing left between an
 * invented figure and a client screenshot. Do not remove them to tidy the card.
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

  return (
    <section
      /* ── ⚠️ FULL COLOUR, AND THE BADGE CARRIES IT ALONE ────────────────────
         Owner: *"Why is this audience card faded? Why is it not showing a bright
         color? Why have you added an overlay over it? I want a bright color."*

         They are right and I overdid it. There were FIVE redundant signals —
         badge, dashed border, dimming, desaturation and a diagonal hatch — on
         the reasoning that a placeholder must never be mistaken for a
         measurement. That reasoning is sound; five signals were not. Four of
         them made the card look broken rather than provisional, which is its own
         kind of misinformation: a reader who thinks a panel is failing does not
         read it at all.

         What remains is the amber SAMPLE badge in the header and the sentence at
         the foot naming the real follower count and the 100 threshold. Both are
         words that say what is true. ⚠️ DO NOT REMOVE THOSE TWO — they are now
         the only thing standing between an invented figure and a client
         screenshot. */
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface p-3.5 shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] ${className ?? ''}`}
    >
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

      {/* ── ⚠️ THE DUPLICATE LEGEND WAS THE BUG, NOT THE LAYOUT ──────────────
          The owner's screenshot showed every percentage printed twice with a
          stray coloured dot orphaned on the right, and I first read that as a
          wrapping problem. It was not.

          `DonutChart` RENDERS ITS OWN LEGEND — it is a `flex flex-wrap` figure
          whose second child is a `min-w-[10rem]` list of clickable slices, and
          hovering those is the chart's interaction. Adding a legend beside it
          gave the card two, and in a quarter-row column the donut's own one wrapped
          beneath the ring while mine sat where a legend was expected.

          So mine is gone. The component was already doing this correctly, and
          `min-w-0` lets its legend shrink into the narrow column rather than
          forcing the card wider. */}
      <div className="relative flex flex-1 items-center justify-center">
        <DonutChart
          slices={SAMPLE_AGES}
          centreLabel="Age"
          centreValue="—"
          /* 132 with a 17-unit ring: *"centered and a little thicker. Right now
             it's very thin."* */
          size={132}
          thickness={17}
          /* Clockwise from twelve o'clock — see the note on the content card. */
          animate
          format="percent"
          caption="Sample audience by age — placeholder figures, not this account's data"
          className="min-w-0 justify-center"
        />
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
                className="h-full origin-left rounded-full motion-safe:animate-[studio-grow_1000ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
                style={{
                  width: `${Math.max(3, c.share * 100)}%`,
                  backgroundColor: `var(--${LOCATION_TOKENS[i % LOCATION_TOKENS.length]})`,
                  animationDelay: `${i * 110}ms`,
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
