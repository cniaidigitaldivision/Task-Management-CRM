import { LogoHorizontal, LogoStacked } from '@/components/brand/logo';
import { ThemeSetting, ThemeToggle } from '@/components/brand/theme-toggle';
import {
  EFFORT_POINTS,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_WEIGHT,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  SCORE_WEIGHTS,
  STATUS_META,
  SYSTEM_DEFAULTS,
  TASK_STATUSES,
  WORKLOAD_BANDS,
  WORKLOAD_BAND_META,
  sumScoreWeights,
} from '@/lib/domain/constants';

/* ============================================================================
 * PHASE 1 · STEP 1 — GATE 1 VERIFICATION
 * ----------------------------------------------------------------------------
 * A living reference for the design system. Every value shown here is read
 * from the canonical sources — styles/tokens.css and lib/domain/constants.ts —
 * so if a token or constant drifts, this page shows it immediately.
 *
 * This is scaffolding for the build, not a product screen. It is replaced by
 * the real application shell in Step 7.
 * ========================================================================= */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-h2 text-text-primary">{title}</h2>
        {description && <p className="max-w-2xl text-body-sm text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border-default bg-bg-surface p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** A swatch that names its token — the point is that no hex appears here. */
function Swatch({ token, label, note }: { token: string; label: string; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="h-9 w-9 shrink-0 rounded-lg border border-border-subtle shadow-sm"
        style={{ backgroundColor: `var(--${token})` }}
      />
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block truncate font-mono text-micro text-text-tertiary">--{token}</span>
        {note && <span className="block truncate text-micro text-text-tertiary">{note}</span>}
      </span>
    </div>
  );
}

/** Chip for statuses, priorities and project types.
 *  NFR-008 — every one carries a text label, never colour alone. */
function Chip({ token, label }: { token: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-default bg-bg-subtle py-1 pl-2 pr-3">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: `var(--${token})` }}
      />
      <span className="text-caption font-medium text-text-primary">{label}</span>
    </span>
  );
}

export default function DesignSystemPage() {
  const weightTotal = sumScoreWeights(SCORE_WEIGHTS);

  return (
    <div className="min-h-full flex-1 bg-bg-base">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-50 border-b border-border-default bg-bg-base/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-4 px-6">
          <LogoHorizontal />
          <div className="flex items-center gap-2">
            <span className="hidden text-caption text-text-tertiary sm:inline">
              Phase 1 · Step 1
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-16 px-6 py-14">
        {/* ---- Hero ---- */}
        <section className="flex flex-col items-center gap-8 py-10 text-center">
          <LogoStacked />
          <div className="space-y-3">
            <h1 className="text-display text-text-primary">CNI CRM</h1>
            <p className="mx-auto max-w-xl text-body text-text-secondary">
              Design system foundation. Every colour on this page resolves from a semantic token,
              and every constant is read from the canonical source — so nothing here can drift out
              of step with the specification.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-border-gold bg-bg-gold-subtle px-3 py-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-gold" />
              <span className="text-caption font-medium text-text-gold">
                Crescent Nova International
              </span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-border-default px-3 py-1.5">
              <span className="text-caption text-text-secondary">AI &amp; Digital Division</span>
            </span>
          </div>
        </section>

        {/* ---- Theme ---- */}
        <Section
          title="Theming"
          description="FR-201 — every role can switch theme from their profile. The preference is resolved before first paint, so a dark-theme user never sees a white flash."
        >
          <Panel>
            <ThemeSetting />
          </Panel>
        </Section>

        {/* ---- Brand ---- */}
        <Section
          title="Brand palette"
          description="Deep teal carries the interface; gold marks what matters. Gold is brand chrome only — it never conveys a status, priority, warning or workload band (BR-024)."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <Panel>
              <h3 className="text-h3 mb-4 text-text-primary">Primary · Deep Teal</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Swatch token="teal-700" label="Core brand" note="light theme primary" />
                <Swatch token="teal-400" label="Dark primary" note="dark theme primary" />
                <Swatch token="teal-800" label="Deep facet" />
                <Swatch token="teal-100" label="Tinted surface" />
              </div>
            </Panel>
            <Panel>
              <h3 className="text-h3 mb-4 text-text-primary">Accent · Gold</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Swatch token="gold-500" label="Core brand" note="chrome only" />
                <Swatch token="gold-400" label="Dark accent" />
                <Swatch token="gold-800" label="Safe for text" note="5.4:1 on white" />
                <Swatch token="gold-100" label="Tinted surface" />
              </div>
              <p className="mt-4 rounded-lg border border-border-default bg-bg-subtle p-3 text-caption text-text-secondary">
                <strong className="font-medium text-text-primary">Contrast constraint:</strong>{' '}
                gold-500 on white is 2.1:1 and fails WCAG for text at any size. In light theme{' '}
                <code className="font-mono text-micro">--text-gold</code> resolves to gold-800; in
                dark theme it resolves to gold-400, where it reaches 9.8:1.
              </p>
            </Panel>
          </div>
        </Section>

        {/* ---- Surfaces ---- */}
        <Section
          title="Semantic surfaces"
          description="The only layer components may reference. Switching theme swaps what these resolve to — no component knows which theme is active."
        >
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Swatch token="bg-base" label="Page" />
              <Swatch token="bg-subtle" label="Subtle" />
              <Swatch token="bg-surface" label="Card" />
              <Swatch token="bg-hover" label="Hover" />
              <Swatch token="border-default" label="Border" />
              <Swatch token="border-strong" label="Border strong" />
              <Swatch token="text-primary" label="Text primary" />
              <Swatch token="text-secondary" label="Text secondary" />
            </div>
          </Panel>
        </Section>

        {/* ---- Statuses ---- */}
        <Section
          title="Task statuses"
          description="Eight statuses. In Progress moved from amber to violet and In Review from purple to pink, because the original amber collided with brand gold (C-01)."
        >
          <Panel>
            <div className="mb-6 flex flex-wrap gap-2">
              {TASK_STATUSES.map((status) => (
                <Chip
                  key={status}
                  token={STATUS_META[status].token}
                  label={STATUS_META[status].label}
                />
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="pb-2 text-micro font-medium uppercase tracking-wide text-text-tertiary">
                      Status
                    </th>
                    <th className="pb-2 text-micro font-medium uppercase tracking-wide text-text-tertiary">
                      Category
                    </th>
                    <th className="pb-2 text-right text-micro font-medium uppercase tracking-wide text-text-tertiary">
                      Load weight
                    </th>
                    <th className="pb-2 text-right text-micro font-medium uppercase tracking-wide text-text-tertiary">
                      Timer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TASK_STATUSES.map((status) => {
                    const meta = STATUS_META[status];
                    return (
                      <tr key={status} className="border-b border-border-subtle last:border-0">
                        <td className="py-2.5 text-body-sm text-text-primary">{meta.label}</td>
                        <td className="py-2.5 font-mono text-caption text-text-secondary">
                          {meta.category}
                        </td>
                        <td className="tabular py-2.5 text-right text-body-sm text-text-primary">
                          {meta.loadWeight.toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right text-caption text-text-secondary">
                          {meta.timerRuns ? 'runs' : 'paused'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </Section>

        {/* ---- Workload ---- */}
        <Section
          title="Workload bands"
          description={`Capacity is measured in weighted points, not task count. Default ${SYSTEM_DEFAULTS.defaultWeeklyCapacity} points per week — 75% of 48 nominal hours, because attendance is not output.`}
        >
          <Panel>
            <div className="space-y-4">
              {WORKLOAD_BANDS.map((band) => {
                const meta = WORKLOAD_BAND_META[band];
                const pct =
                  band === 'available'
                    ? 45
                    : band === 'healthy'
                      ? 72
                      : band === 'warning'
                        ? 93
                        : 108;
                return (
                  <div key={band} className="flex items-center gap-4">
                    <span className="w-24 shrink-0 text-body-sm text-text-secondary">
                      {meta.label}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          backgroundColor: `var(--${meta.token})`,
                        }}
                      />
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-body-sm text-text-primary">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </Section>

        {/* ---- Priority & project types ---- */}
        <div className="grid gap-6 md:grid-cols-2">
          <Section
            title="Priority"
            description="Priority multiplies capacity cost — it is not merely a sort key."
          >
            <Panel>
              <div className="space-y-3">
                {PRIORITIES.map((priority) => (
                  <div key={priority} className="flex items-center justify-between gap-4">
                    <Chip token={`priority-${priority}`} label={PRIORITY_LABEL[priority]} />
                    <span className="tabular text-body-sm text-text-secondary">
                      ×{PRIORITY_WEIGHT[priority].toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </Section>

          <Section title="Project types" description="Every task belongs to exactly one project.">
            <Panel>
              <div className="space-y-3">
                {PROJECT_TYPES.map((type) => {
                  const meta = PROJECT_TYPE_META[type];
                  return (
                    <div key={type} className="flex items-center justify-between gap-4">
                      <Chip token={meta.token} label={meta.label} />
                      <span className="font-mono text-caption text-text-tertiary">{meta.code}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </Section>
        </div>

        {/* ---- Typography ---- */}
        <Section
          title="Typography"
          description="Serif for display, echoing the wordmark. Inter for interface. Tabular numerals wherever a value changes, so digits never jitter."
        >
          <Panel className="space-y-5">
            <p className="text-display text-text-primary">Display · Playfair Display</p>
            <p className="text-h1 text-text-primary">Heading 1 · Inter Semibold</p>
            <p className="text-h2 text-text-primary">Heading 2 · Inter Semibold</p>
            <p className="text-body text-text-primary">
              Body · Inter Regular. The quick brown fox jumps over the lazy dog.
            </p>
            <p className="text-caption text-text-secondary">
              Caption · supporting detail and timestamps.
            </p>
            <p className="font-mono text-body-sm text-text-brand">
              EVT-142 · CLI-088 · BIZ-031 · PRM-017 · OTH-205
            </p>
            <p className="tabular text-body text-text-primary">
              Tabular numerals · 3h 12m / 4h 00m · 00:00:00 · 11111 vs 00000
            </p>
          </Panel>
        </Section>

        {/* ---- Integrity check ---- */}
        <Section
          title="Integrity check"
          description="Values read live from lib/domain/constants.ts. If any drifts from the specification, it shows here rather than in production."
        >
          <Panel>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Weekly capacity', `${SYSTEM_DEFAULTS.defaultWeeklyCapacity} pts`],
                ['Soft threshold', `${SYSTEM_DEFAULTS.softThresholdPct}%`],
                ['Hard threshold', `${SYSTEM_DEFAULTS.hardThresholdPct}%`],
                ['Max concurrent', `${SYSTEM_DEFAULTS.defaultMaxConcurrentTasks} tasks`],
                ['Failed logins to lock', `${SYSTEM_DEFAULTS.failedLoginsToLock}`],
                ['Minutes per point', `${SYSTEM_DEFAULTS.minutesPerEffortPoint}`],
                ['Working days', `${SYSTEM_DEFAULTS.workingDays.length} (Mon–Sat)`],
                [
                  'Working hours',
                  `${SYSTEM_DEFAULTS.workingHoursStart}–${SYSTEM_DEFAULTS.workingHoursEnd}`,
                ],
                ['Timezone', SYSTEM_DEFAULTS.teamTimezone],
                [
                  'Effort points',
                  EFFORT_SIZES.map((size) => `${size}=${EFFORT_POINTS[size]}`).join(' · '),
                ],
              ].map(([label, value]) => (
                <div key={label} className="space-y-0.5">
                  <dt className="text-micro uppercase tracking-wide text-text-tertiary">{label}</dt>
                  <dd className="tabular text-body-sm text-text-primary">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex items-start gap-3 rounded-lg border border-border-default bg-bg-subtle p-4">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    weightTotal === 1 ? 'var(--feedback-success)' : 'var(--feedback-error)',
                }}
              />
              <div className="space-y-1">
                <p className="text-body-sm font-medium text-text-primary">
                  Assignment weights sum to {weightTotal.toFixed(2)}
                  {weightTotal === 1 ? ' — correct' : ' — INVALID'}
                </p>
                <p className="text-caption text-text-secondary">
                  skill {SCORE_WEIGHTS.skill} · availability {SCORE_WEIGHTS.availability} · deadline{' '}
                  {SCORE_WEIGHTS.deadlineFit} · fairness {SCORE_WEIGHTS.fairness} · performance{' '}
                  {SCORE_WEIGHTS.performance} · familiarity {SCORE_WEIGHTS.projectFamiliarity}
                </p>
              </div>
            </div>
          </Panel>
        </Section>
      </main>

      <footer className="border-t border-border-default py-8">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-caption text-text-tertiary">
            CNI CRM · Phase 1, Step 1 — scaffold, design tokens, theming, constants. This page is
            build scaffolding and is replaced by the application shell in Step 7.
          </p>
        </div>
      </footer>
    </div>
  );
}
