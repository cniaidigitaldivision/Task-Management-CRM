'use client';

import { Info, Lock } from 'lucide-react';

import { DonutChart } from '@/components/ui/chart';
import type { StudioAccount } from '@/lib/db/queries/meta-studio';

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
  { label: '25–34', value: 40, token: 'accent-primary' },
  { label: '18–24', value: 25, token: 'chart-2' },
  { label: '35–44', value: 20, token: 'chart-3' },
  { label: '45+', value: 15, token: 'chart-4' },
];

export function AudienceSample({ accounts }: { accounts: readonly StudioAccount[] }) {
  /* The largest connected account decides — demographics unlock per account, and
     the nearest one to the threshold is the useful thing to report. */
  const best = accounts.reduce<number>((max, a) => Math.max(max, a.followers ?? 0), 0);
  const unlocked = best >= DEMOGRAPHICS_THRESHOLD;
  const remaining = Math.max(0, DEMOGRAPHICS_THRESHOLD - best);

  /* ⚠️ When the threshold IS passed, this component must stop inventing and
     start reading. It cannot yet — the sync does not collect demographics — so
     it says exactly that rather than continuing to show a sample that has become
     indistinguishable from a real one. */
  if (unlocked) {
    return (
      <section className="rounded-2xl border border-border-default bg-bg-surface p-4">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-body-sm font-semibold text-text-primary">Audience</h2>
        </header>
        <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-caption text-text-tertiary">
          This account has passed {DEMOGRAPHICS_THRESHOLD} followers, so Meta will now report
          audience demographics. Collecting them is the next piece of work — no sample is shown
          here, because at this point a placeholder would be indistinguishable from the real thing.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-dashed border-border-default bg-bg-surface p-4">
      {/* Signal 5 — a hatch no real panel has. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, var(--text-primary) 0 1px, transparent 1px 9px)',
        }}
      />

      <header className="relative mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-body-sm font-semibold text-text-primary">
          Audience — <span className="italic">sample only</span>
        </h2>

        {/* Signal 2 */}
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 18%, transparent)',
            color: 'var(--feedback-warning)',
          }}
        >
          <Lock className="size-3" aria-hidden="true" />
          Sample data — not real
        </span>
      </header>

      {/* Signal 3 */}
      <p className="relative mb-3 flex items-start gap-1.5 text-caption text-text-secondary">
        <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span>
          Meta only reports audience demographics once an account passes{' '}
          <strong className="font-semibold text-text-primary">
            {DEMOGRAPHICS_THRESHOLD} followers
          </strong>
          — a privacy floor, not a setting. The largest connected account has{' '}
          <strong className="font-semibold text-text-primary">{best}</strong>, so these two charts
          show <strong className="font-semibold text-text-primary">invented placeholder figures</strong>{' '}
          to show the layout. They will be replaced with the real audience automatically once{' '}
          {remaining} more {remaining === 1 ? 'follower joins' : 'followers join'}.
        </span>
      </p>

      {/* ⚠️ TOP LOCATIONS MOVED OUT on 2026-09-04 — it has its own panel beside
          the gauge now, where the reference puts it. Keeping a second copy here
          would have shown one client the same invented figures twice on one
          screen, which makes them look corroborated. */}

      {/* Signal 4 — dimmed and desaturated against every neighbouring panel. */}
      <div className="relative grid gap-4 opacity-55 saturate-50 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Age &amp; gender (sample)
          </p>
          <DonutChart
            slices={SAMPLE_AGES}
            centreLabel="Sample"
            centreValue="—"
            format="percent"
            size={148}
            caption="Sample audience by age — placeholder figures, not this account's data"
          />
        </div>
      </div>
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
      className={`flex min-w-0 flex-col rounded-xl border border-dashed border-border-default bg-bg-surface p-3.5 shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] ${className ?? ''}`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-1.5">
        <h2 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          Top Locations
        </h2>
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 18%, transparent)',
            color: 'var(--feedback-warning)',
          }}
        >
          <Lock className="size-2.5" aria-hidden="true" />
          Sample
        </span>
      </header>

      {/* One row, one line: chip · name · bar · share · value. The previous
          two-line arrangement wrapped the bar under the name and made five rows
          taller than the chart beside them. */}
      <ul className="space-y-2">
        {SAMPLE_LOCATIONS.map((c, i) => {
          const token = LOCATION_TOKENS[i % LOCATION_TOKENS.length];
          return (
            <li key={c.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid h-4 w-6 shrink-0 place-items-center rounded-[3px] text-[0.6rem] font-bold tracking-tight"
                style={{ backgroundColor: `var(--${token}-wash)`, color: `var(--${token})` }}
              >
                {c.key}
              </span>
              <span className="w-[4.5rem] shrink-0 truncate text-micro text-text-primary" title={c.label}>
                {c.label}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                <span
                  className="block h-full origin-left rounded-full motion-safe:animate-[studio-grow_650ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
                  style={{
                    width: `${c.share * 100}%`,
                    backgroundColor: `var(--${token})`,
                    animationDelay: `${i * 70}ms`,
                  }}
                />
              </span>
              <span className="w-7 shrink-0 text-right text-micro tabular-nums text-text-secondary">
                {Math.round(c.share * 100)}%
              </span>
              <span className="w-10 shrink-0 text-right text-micro font-semibold tabular-nums text-text-primary">
                {c.value}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-auto flex items-start gap-1.5 pt-2.5 text-[0.62rem] leading-snug text-text-tertiary">
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          Placeholder figures. Meta reports audience only above{' '}
          <strong className="font-semibold text-text-secondary">
            {DEMOGRAPHICS_THRESHOLD} followers
          </strong>{' '}
          — {remaining} more to go.
        </span>
      </p>
    </section>
  );
}
