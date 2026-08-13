import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { ThemeSetting } from '@/components/brand/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ControlGallery } from '@/components/ui/control-gallery';
import { SkeletonGallery, TextureGallery } from '@/components/ui/texture-gallery';
import {
  EFFORT_POINTS,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
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

export const metadata: Metadata = {
  title: 'Design system',
};

/* ============================================================================
 * DESIGN SYSTEM REFERENCE
 * ----------------------------------------------------------------------------
 * An internal reference sheet, not a product screen. Every value is read from
 * the canonical sources — styles/tokens.css and lib/domain/constants.ts — so
 * drift shows up here rather than in production.
 * ========================================================================= */

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
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-h2 text-text-primary">{title}</h2>
        {description && <p className="max-w-2xl text-body-sm text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const weightTotal = sumScoreWeights(SCORE_WEIGHTS);

  return (
    <div className="min-h-full flex-1 bg-bg-base">
      <header className="sticky top-0 z-50 border-b border-border-default bg-bg-base/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-4 px-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-body-sm text-text-secondary hover:text-text-primary focus-visible:outline-none"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Back to CRM
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-caption text-text-tertiary sm:inline">Design system</span>
            {/* Removed with the topbar control — the theme lives in
                Profile → Appearance now, and a second one here would be a
                second place to keep in step. */}
            <span className="text-caption text-text-tertiary">
              Set the theme in Profile → Appearance.
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-12 px-6 py-10">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border-default bg-bg-surface px-6 py-10 text-center shadow-sm">
          <Logo width={260} priority />
          <div className="space-y-2">
            <h1 className="text-h1 text-text-primary">CNI CRM design system</h1>
            <p className="mx-auto max-w-xl text-body-sm text-text-secondary">
              Every colour resolves from a semantic token and every constant is read from the
              canonical source, so nothing here can drift from the specification.
            </p>
          </div>
        </div>

        <Section
          title="Controls"
          description="Every interactive element, at every size, over a ruled guide. Each row's controls must touch both dashed lines — a control that sets its own height instead of importing from components/ui/control.ts breaks the line here, where it is obvious, rather than on a product screen, where it merely looks untidy."
        >
          <ControlGallery />
        </Section>

        <Section
          title="Texture, glass and skeletons"
          description="From the reference folder, on our palette — teal and gold, never the references' purple. Glass is chrome only: blur behind small text costs legibility and every glass surface is another compositing layer a long board pays for on each scroll. Grain and the orbit ring must paint ABOVE their parent's background; the first version used a negative z-index inside an isolated stacking context and both were invisible on every opaque panel."
        >
          <TextureGallery />
        </Section>

        <Section
          title="Structured loading"
          description="Owner instruction: a page that is loading shows the shape of what is coming. Not a grey box — the same arrangement as the real screen, so the wait is spent orienting. Every composite matches its real component's padding, radius and height, because a skeleton a few pixels short makes the page jump at the moment somebody starts reading. The sweep stops under prefers-reduced-motion and the shape stays."
        >
          <SkeletonGallery />
        </Section>

        <Section
          title="Theming"
          description="FR-201 — every role can switch theme from their profile. Resolved before first paint, so a dark-theme user never sees a white flash."
        >
          <Card>
            <CardBody>
              <ThemeSetting />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Brand palette"
          description="Deep teal carries the interface; gold marks what matters. Gold is brand chrome only — it never conveys a status, priority, warning or workload band (BR-024)."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Primary · Deep Teal</CardTitle>
              </CardHeader>
              <CardBody className="grid gap-3 sm:grid-cols-2">
                <Swatch token="teal-700" label="Core brand" note="light primary" />
                <Swatch token="teal-400" label="Dark primary" note="dark primary" />
                <Swatch token="teal-800" label="Deep facet" />
                <Swatch token="teal-100" label="Tinted surface" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Accent · Gold</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Swatch token="gold-500" label="Core brand" note="chrome only" />
                  <Swatch token="gold-400" label="Dark accent" />
                  <Swatch token="gold-800" label="Safe for text" note="5.4:1 on white" />
                  <Swatch token="gold-100" label="Tinted surface" />
                </div>
                <p className="rounded-lg border border-border-default bg-bg-subtle p-3 text-caption text-text-secondary">
                  <strong className="font-medium text-text-primary">Contrast constraint:</strong>{' '}
                  gold-500 on white is 2.1:1 and fails WCAG for text at any size. In light theme{' '}
                  <code className="font-mono text-micro">--text-gold</code> resolves to gold-800; in
                  dark theme to gold-400, where it reaches 9.8:1.
                </p>
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="Semantic surfaces" description="The only layer components may reference.">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Swatch token="bg-base" label="Page" />
              <Swatch token="bg-surface" label="Card" />
              <Swatch token="bg-subtle" label="Subtle" />
              <Swatch token="bg-hover" label="Hover" />
              <Swatch token="sidebar-bg" label="Sidebar" />
              <Swatch token="border-default" label="Border" />
              <Swatch token="text-primary" label="Text primary" />
              <Swatch token="text-secondary" label="Text secondary" />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Task statuses"
          description="In Progress moved from amber to violet and In Review from purple to pink — the original amber collided with brand gold (C-01)."
        >
          <Card>
            <CardBody className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {TASK_STATUSES.map((status) => (
                  <Badge key={status} token={STATUS_META[status].token}>
                    {STATUS_META[status].label}
                  </Badge>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-border-default">
                      {['Status', 'Category', 'Load weight', 'Timer'].map((h, i) => (
                        <th
                          key={h}
                          className={`pb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary ${i > 1 ? 'text-right' : ''}`}
                        >
                          {h}
                        </th>
                      ))}
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
            </CardBody>
          </Card>
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Priority" description="Priority multiplies capacity cost.">
            <Card>
              <CardBody className="space-y-3">
                {PRIORITIES.map((priority) => (
                  <div key={priority} className="flex items-center justify-between gap-4">
                    <Badge token={PRIORITY_TOKEN[priority]}>{PRIORITY_LABEL[priority]}</Badge>
                    <span className="tabular text-body-sm text-text-secondary">
                      ×{PRIORITY_WEIGHT[priority].toFixed(2)}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </Section>

          <Section title="Project types" description="Every task belongs to exactly one project.">
            <Card>
              <CardBody className="space-y-3">
                {PROJECT_TYPES.map((type) => {
                  const meta = PROJECT_TYPE_META[type];
                  return (
                    <div key={type} className="flex items-center justify-between gap-4">
                      <Badge token={meta.token}>{meta.label}</Badge>
                      <span className="font-mono text-caption text-text-tertiary">{meta.code}</span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          </Section>
        </div>

        <Section
          title="Workload bands"
          description={`Weighted points, not task count. Default ${SYSTEM_DEFAULTS.defaultWeeklyCapacity} pts/week — 75% of 48 nominal hours, because attendance is not output.`}
        >
          <Card>
            <CardBody className="space-y-4">
              {WORKLOAD_BANDS.map((band) => {
                const meta = WORKLOAD_BAND_META[band];
                const pct =
                  band === 'available' ? 45 : band === 'healthy' ? 72 : band === 'warning' ? 93 : 108;
                return (
                  <div key={band} className="flex items-center gap-4">
                    <span className="w-24 shrink-0 text-body-sm text-text-secondary">
                      {meta.label}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
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
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Integrity check"
          description="Read live from lib/domain/constants.ts. If a value drifts from the specification it shows here rather than in production."
        >
          <Card>
            <CardBody className="space-y-5">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Weekly capacity', `${SYSTEM_DEFAULTS.defaultWeeklyCapacity} pts`],
                  ['Soft threshold', `${SYSTEM_DEFAULTS.softThresholdPct}%`],
                  ['Hard threshold', `${SYSTEM_DEFAULTS.hardThresholdPct}%`],
                  ['Max concurrent', `${SYSTEM_DEFAULTS.defaultMaxConcurrentTasks} tasks`],
                  ['Failed logins to lock', `${SYSTEM_DEFAULTS.failedLoginsToLock}`],
                  ['Minutes per point', `${SYSTEM_DEFAULTS.minutesPerEffortPoint}`],
                  ['Working week', `${SYSTEM_DEFAULTS.workingDays.length} days (Mon–Sat)`],
                  [
                    'Working hours',
                    `${SYSTEM_DEFAULTS.workingHoursStart}–${SYSTEM_DEFAULTS.workingHoursEnd}`,
                  ],
                  ['Timezone', SYSTEM_DEFAULTS.teamTimezone],
                  [
                    'Effort points',
                    EFFORT_SIZES.map((s) => `${s}=${EFFORT_POINTS[s]}`).join(' · '),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="space-y-0.5">
                    <dt className="text-micro uppercase tracking-wide text-text-tertiary">
                      {label}
                    </dt>
                    <dd className="tabular text-body-sm text-text-primary">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex items-start gap-3 rounded-lg border border-border-default bg-bg-subtle p-4">
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
                    skill {SCORE_WEIGHTS.skill} · availability {SCORE_WEIGHTS.availability} ·
                    deadline {SCORE_WEIGHTS.deadlineFit} · fairness {SCORE_WEIGHTS.fairness} ·
                    performance {SCORE_WEIGHTS.performance} · familiarity{' '}
                    {SCORE_WEIGHTS.projectFamiliarity}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </Section>
      </main>
    </div>
  );
}
