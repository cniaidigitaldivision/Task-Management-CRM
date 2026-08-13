import { DonutChart, GaugeArc, TrendChart } from './chart';

/* ============================================================================
 * CHART GALLERY — for /design-system
 * ----------------------------------------------------------------------------
 * A server component that hands fixed data to the client charts. The numbers are
 * deliberately awkward rather than tidy: a series that dips to zero, a donut with
 * an empty category in the middle of it, a gauge over its own ceiling. Pretty
 * sample data hides exactly the faults these charts can have.
 * ========================================================================= */

const WEEKS = ['Wk 24', 'Wk 25', 'Wk 26', 'Wk 27', 'Wk 28', 'Wk 29', 'Wk 30', 'Wk 31'] as const;

export function ChartGallery() {
  return (
    <div className="space-y-8">
      <div className="grain panel-lit rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-body font-semibold text-text-primary">
            One series, filled — move the cursor across it
          </h3>
          <p className="text-micro text-text-tertiary">
            The guide, the ring, the axis label and the card all snap to the nearest real point.
            Arrow keys scrub it; Home and End jump to the ends; Escape clears it.
          </p>
        </div>
        <TrendChart
          caption="Tasks completed per week"
          labels={WEEKS}
          series={[{ label: 'Completed', token: 'accent-primary', points: [12, 18, 9, 24, 21, 0, 27, 31] }]}
        />
      </div>

      <div className="grain panel-lit rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-body font-semibold text-text-primary">
            Three series, unfilled — one reading, three numbers
          </h3>
          <p className="text-micro text-text-tertiary">
            The fill is dropped above one series: three washes over each other are mud, and the
            card already gives the exact figures.
          </p>
        </div>
        <TrendChart
          caption="Tasks by state per week"
          labels={WEEKS}
          fill={false}
          height={200}
          series={[
            { label: 'Completed', token: 'status-done', points: [12, 18, 9, 24, 21, 19, 27, 31] },
            { label: 'In progress', token: 'status-progress', points: [8, 7, 11, 9, 14, 12, 10, 13] },
            { label: 'Blocked', token: 'status-blocked', points: [1, 0, 4, 2, 1, 5, 3, 1] },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grain rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
          <h3 className="mb-4 text-body font-semibold text-text-primary">
            Proportions — the legend is the control
          </h3>
          <DonutChart
            caption="Open tasks by state"
            centreLabel="open tasks"
            centreValue="64"
            slices={[
              { label: 'In progress', value: 21, token: 'status-progress' },
              { label: 'To do', value: 18, token: 'status-todo' },
              { label: 'In review', value: 0, token: 'status-review' },
              { label: 'Blocked', value: 9, token: 'status-blocked' },
              { label: 'Backlog', value: 16, token: 'status-backlog' },
            ]}
          />
          <p className="mt-3 text-micro text-text-tertiary">
            &ldquo;In review&rdquo; is empty on purpose. It keeps its place in the legend and draws
            no arc — dropping it would silently recolour every slice after it.
          </p>
        </div>

        <div className="grain rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
          <h3 className="mb-4 text-body font-semibold text-text-primary">
            One figure against its ceiling
          </h3>
          <div className="flex flex-wrap items-start justify-around gap-4">
            <GaugeArc value={26} max={40} label="Ayesha" hint="effort points this week" />
            <GaugeArc
              value={44}
              max={40}
              label="Bilal"
              hint="over capacity"
              token="feedback-warning"
            />
            <GaugeArc value={0} max={40} label="Zoya" hint="nothing assigned" />
          </div>
          <p className="mt-3 text-micro text-text-tertiary">
            240° rather than a full ring: a closed ring has no beginning, so nearly-full and
            nearly-empty look alike. Over capacity clamps the arc and keeps the true number.
          </p>
        </div>
      </div>
    </div>
  );
}
