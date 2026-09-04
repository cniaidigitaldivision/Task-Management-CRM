'use client';

import { Info, Lock } from 'lucide-react';

import { BarChart, DonutChart } from '@/components/ui/chart';
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
const SAMPLE_COUNTRIES = [
  { label: 'Pakistan', value: 45 },
  { label: 'United Arab Emirates', value: 20 },
  { label: 'United Kingdom', value: 15 },
  { label: 'Saudi Arabia', value: 12 },
  { label: 'Other', value: 8 },
];

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

      {/* Signal 4 — dimmed and desaturated against every neighbouring panel. */}
      <div className="relative grid gap-4 opacity-55 saturate-50 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Top locations (sample)
          </p>
          <BarChart
            caption="Sample audience by country — placeholder figures, not this account's data"
            format="percent"
            max={100}
            showNotes={false}
            bars={SAMPLE_COUNTRIES.map((c, i) => ({
              ...c,
              token: ['accent-primary', 'chart-2', 'chart-3', 'chart-4', 'chart-5'][i % 5],
            }))}
          />
        </div>

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
