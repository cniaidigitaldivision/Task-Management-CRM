import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { listSkills } from '@/lib/db/queries/people';
import {
  DEFAULT_WORKING_DAYS,
  EFFORT_LABEL,
  EFFORT_POINTS,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_WEIGHT,
  RECOMMENDATION_USABILITY_FLOOR,
  SCORE_WEIGHTS,
  STATUS_META,
  SYSTEM_DEFAULTS,
  TASK_STATUSES,
} from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';

export const metadata: Metadata = { title: 'Settings' };

/* ============================================================================
 * SETTINGS — doc 19 §5
 * ----------------------------------------------------------------------------
 * ── WHY THIS IS READ-ONLY, AND SAYS SO ───────────────────────────────────────
 * `system_settings` is deliberately EMPTY. It holds overrides only; an unset key
 * falls back to SYSTEM_DEFAULTS in lib/domain/constants.ts (registry C-16 §9a).
 * That is what makes the defaults a single source of truth rather than a copy
 * that has to be seeded and kept in step.
 *
 * Making these editable therefore means writing the override path *and* making
 * every consumer read through it — with the score weights validated to sum to
 * exactly 1.00 on the way in, because they were once 1.05 and every score was
 * silently inflated by 5% (C-06).
 *
 * So the page shows exactly what the system is using right now, names where each
 * value comes from, and does not pretend to a "Save" button that would quietly
 * do nothing. Editing lands in Phase 5 (FR-057).
 * ========================================================================= */

function Row({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border-subtle px-5 py-2.5 last:border-0">
      <div className="min-w-[12rem] flex-1">
        <p className="text-caption font-medium text-text-primary">{label}</p>
        {note && <p className="text-micro text-text-tertiary">{note}</p>}
      </div>
      <p className="tabular shrink-0 text-body-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}

export default async function SettingsPage() {
  // Workspace settings are Admin+. Hiding the nav item is convenience, not security (NFR-006).
  const user = await requireRole('admin');
  const skills = await listSkills(user.id);
  const canEditSkills = can({ role: user.role, id: user.id }, 'settings.skills_library');

  const byCategory = new Map<string, typeof skills>();
  for (const skill of skills) {
    const key = skill.category ?? 'Uncategorised';
    byCategory.set(key, [...(byCategory.get(key) ?? []), skill]);
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description={
          <>
            Everything the engine is using right now. These are the{' '}
            <span className="font-semibold text-text-primary">live values</span>, read from{' '}
            <span className="font-mono text-micro">lib/domain/constants.ts</span> —{' '}
            <span className="font-mono text-micro">system_settings</span> is intentionally empty and
            holds overrides only, so there is no second copy to drift.
          </>
        }
      />

      <div
        className="flex items-start gap-3 rounded-xl border px-4 py-3"
        style={{
          borderColor: 'color-mix(in oklab, var(--accent-gold) 35%, transparent)',
          backgroundColor: 'var(--bg-gold-subtle)',
        }}
      >
        <IconTile icon={Lock} token="accent-gold" size="sm" />
        <p className="text-caption text-text-secondary">
          <span className="font-semibold text-text-primary">Read-only for now.</span> Editing these
          needs the override path plus validation — the score weights in particular must sum to
          exactly 1.00, because they once totalled 1.05 and inflated every recommendation by 5%
          without anybody noticing. A Save button that quietly did nothing would be worse than this
          notice (FR-057, Phase 5).
        </p>
      </div>

      <PageSection
        step={1}
        title="Capacity and thresholds"
        description="The numbers that decide when the system warns and when it blocks."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardToolbar title="Capacity" />
            <Row
              label="Default weekly capacity"
              value={`${SYSTEM_DEFAULTS.defaultWeeklyCapacity} points`}
              note="75% of the 48 nominal hours — breaks, briefs, calls and render waits take the rest (ADR-004)"
            />
            <Row
              label="Concurrent task limit"
              value={`${SYSTEM_DEFAULTS.defaultMaxConcurrentTasks} tasks`}
              note="The secondary guard: attention, not volume"
            />
            <Row
              label="Soft threshold"
              value={`${SYSTEM_DEFAULTS.softThresholdPct}%`}
              note="Warns and proceeds (BR-004)"
            />
            <Row
              label="Hard threshold"
              value={`${SYSTEM_DEFAULTS.hardThresholdPct}%`}
              note="Blocks. Admin+ may override with a written, logged reason; a Coordinator cannot (BR-003)"
            />
            <Row
              label="Critical threshold"
              value={`${SYSTEM_DEFAULTS.criticalThresholdPct}%`}
              note="Alerts Admins without anybody attempting an assignment"
            />
            <Row
              label="Ad-hoc work warning"
              value={`${SYSTEM_DEFAULTS.otherWorkWarningPct}%`}
              note="Share of committed effort in Other projects before it is flagged (doc 15 §6)"
            />
          </Card>

          <Card>
            <CardToolbar title="Working calendar" />
            <Row label="Timezone" value={SYSTEM_DEFAULTS.teamTimezone} />
            <Row
              label="Working days"
              value={DEFAULT_WORKING_DAYS.map((d) => d[0].toUpperCase() + d.slice(1)).join(' · ')}
              note="Sunday is the weekend, so a Sunday holiday reduces nobody's capacity"
            />
            <Row
              label="Working hours"
              value={`${SYSTEM_DEFAULTS.workingHoursStart} – ${SYSTEM_DEFAULTS.workingHoursEnd}`}
              note="Timers pause outside these hours (FR-174)"
            />
            <Row label="Digest time" value={SYSTEM_DEFAULTS.digestTime} note="Phase 5" />
          </Card>
        </div>
      </PageSection>

      <PageSection
        step={2}
        title="How work is weighted"
        description="A task's cost to a person is effort × priority × status weight. These three tables are the whole of that arithmetic."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardToolbar title="Effort sizes" />
            <CardBody className="space-y-2 p-4">
              {EFFORT_SIZES.map((size) => (
                <div key={size} className="flex items-baseline gap-2">
                  <Badge token="accent-primary" size="sm" dot={false}>
                    {size}
                  </Badge>
                  <span className="tabular text-caption font-semibold text-text-primary">
                    {EFFORT_POINTS[size]} pts
                  </span>
                  <span className="truncate text-micro text-text-tertiary">
                    {EFFORT_LABEL[size]}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-micro text-text-tertiary">
                One point is roughly one working hour (doc 05 §5).
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardToolbar title="Priority weight" />
            <CardBody className="space-y-2 p-4">
              {PRIORITIES.map((priority) => (
                <div key={priority} className="flex items-baseline justify-between gap-2">
                  <span className="text-caption text-text-primary">{PRIORITY_LABEL[priority]}</span>
                  <span className="tabular text-caption font-semibold text-text-primary">
                    ×{PRIORITY_WEIGHT[priority]}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-micro text-text-tertiary">
                Priority multiplies the cost, it is not merely a sort key — urgent work genuinely
                consumes more attention (doc 05 §4).
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardToolbar title="Status weight" />
            <CardBody className="space-y-2 p-4">
              {TASK_STATUSES.map((status) => (
                <div key={status} className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-caption text-text-primary">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--${STATUS_META[status].token})` }}
                    />
                    {STATUS_META[status].label}
                  </span>
                  <span className="tabular text-caption font-semibold text-text-primary">
                    ×{STATUS_META[status].loadWeight}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-micro text-text-tertiary">
                Backlog counts at 25% — real but not imminent. In Review at 50% — out of your hands,
                but it may come back (doc 05 §1).
              </p>
            </CardBody>
          </Card>
        </div>
      </PageSection>

      <PageSection
        step={3}
        title="Assignment scoring"
        description="How the engine ranks who should take a task. The weights must sum to exactly 1.00, and a load-time assertion enforces it."
      >
        <Card>
          <CardBody className="space-y-3 p-5">
            {(Object.entries(SCORE_WEIGHTS) as Array<[string, number]>).map(([key, weight]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="min-w-[10rem] text-caption text-text-primary">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-active">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${weight * 100 * 2.6}%`,
                      backgroundColor: 'var(--accent-primary)',
                    }}
                  />
                </div>
                <span className="tabular w-12 text-right text-caption font-semibold text-text-primary">
                  {Math.round(weight * 100)}%
                </span>
              </div>
            ))}
            <p className="border-t border-border-subtle pt-3 text-micro text-text-tertiary">
              Below a score of {RECOMMENDATION_USABILITY_FLOOR} the engine stops recommending people and
              starts recommending actions instead — extend the deadline, split the task, rebalance
              (FR-054).
            </p>
          </CardBody>
        </Card>
      </PageSection>

      <PageSection
        step={4}
        title="Timers and time limits"
        description="ADR-010. A time limit is not a due date: it is how long the work is allowed to take."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardToolbar title="Timers" />
            <Row
              label="Minutes per effort point"
              value={`${SYSTEM_DEFAULTS.minutesPerEffortPoint} min`}
              note="Converts an estimate into a default time limit (FR-171)"
            />
            <Row
              label="Pause outside working hours"
              value={SYSTEM_DEFAULTS.timerAutoPauseOutsideHours ? 'Yes' : 'No'}
            />
            <Row
              label="Idle prompt"
              value={`${SYSTEM_DEFAULTS.timerIdlePromptMinutes} min`}
              note={`Auto-pause at ${SYSTEM_DEFAULTS.timerIdleAutoPauseMinutes} min`}
            />
            <Row
              label="Manual time needs a reason"
              value={SYSTEM_DEFAULTS.requireReasonForManualTime ? 'Always' : 'No'}
              note="A timer everyone quietly edits is worse than no timer (BR-020)"
            />
            <Row
              label="At the limit"
              value={SYSTEM_DEFAULTS.overLimitBehaviour.replace(/_/g, ' ')}
              note="A hard lock cannot stop somebody mid-render; it only pushes the work off the books (Q-041)"
            />
          </Card>

          <Card>
            <CardToolbar title="Security" />
            <Row
              label="Failed sign-ins before lock"
              value={String(SYSTEM_DEFAULTS.failedLoginsToLock)}
              note="Derived from an append-only ledger, never a counter anybody can reset (FR-155a)"
            />
            <Row
              label="Lock clears itself after"
              value={`${SYSTEM_DEFAULTS.accountLockAutoClearMinutes} min`}
            />
            <Row
              label="Password minimum"
              value={`${SYSTEM_DEFAULTS.passwordMinLength} characters`}
              note={`${SYSTEM_DEFAULTS.superAdminPasswordMinLength} for the Super Admin (SA-2)`}
            />
            <Row
              label="Password history kept"
              value={`${SYSTEM_DEFAULTS.passwordHistoryCount} hashes`}
            />
            <Row
              label="Activation token life"
              value={`${SYSTEM_DEFAULTS.activationTokenTtlHours} hours`}
              note="Single use, hash-stored — the raw token is never written (FR-142)"
            />
            <Row
              label="Recovery codes"
              value={String(SYSTEM_DEFAULTS.recoveryCodeCount)}
              note="Shown exactly once, at setup (SA-9)"
            />
          </Card>
        </div>
      </PageSection>

      <PageSection
        step={5}
        title="Skills library"
        description={`${skills.length} skills across ${byCategory.size} categories. Retired via a flag, never deleted while somebody still holds one (FR-017).`}
        actions={
          canEditSkills ? (
            <span className="text-caption text-text-tertiary">
              Editing the library arrives with Step 6
            </span>
          ) : undefined
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...byCategory.entries()].map(([category, list]) => (
            <Card key={category}>
              <CardToolbar title={category} />
              <CardBody className="flex flex-wrap gap-1.5 p-4">
                {list.map((skill) => (
                  <Badge key={skill.id} token="accent-secondary" size="sm" variant="outline">
                    {skill.label}
                  </Badge>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      </PageSection>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border-subtle bg-bg-surface-sunken px-4 py-3">
        <IconTile icon={Sparkles} token="accent-primary" size="sm" />
        <p className="flex-1 text-micro text-text-tertiary">
          Every token, control size and colour on these screens is defined once in{' '}
          <span className="font-mono">styles/tokens.css</span> and{' '}
          <span className="font-mono">components/ui/control.ts</span>.
        </p>
        <Link
          href="/design-system"
          className="text-caption font-semibold text-text-brand hover:underline"
        >
          Design system
        </Link>
      </div>
    </div>
  );
}
