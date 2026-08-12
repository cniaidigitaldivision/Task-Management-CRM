import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { SettingsWorkspace } from '@/components/settings/settings-workspace';
import { SkillsLibrary } from '@/components/settings/skills-library';

import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { effectiveSettings, listAllSkills } from '@/lib/db/queries/settings';
import {
  DEFAULT_WORKING_DAYS,
  EFFORT_LABEL,
  EFFORT_POINTS,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_WEIGHT,
  STATUS_META,
  SYSTEM_DEFAULTS,
  TASK_STATUSES,
} from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import { SETTING_DEFINITIONS } from '@/lib/domain/settings';

export const metadata: Metadata = { title: 'Settings' };

/* ============================================================================
 * SETTINGS — FR-057, doc 19 §5
 * ----------------------------------------------------------------------------
 * ── OVERRIDES ONLY, WHICH IS WHY THE DEFAULTS STAY HONEST ────────────────────
 * `system_settings` holds only the values somebody has deliberately changed. An
 * unset key falls back to SYSTEM_DEFAULTS in lib/domain/constants.ts (registry
 * C-16 §9a), so the shipped defaults remain a single source of truth rather than
 * a copy that has to be seeded and then kept in step forever.
 *
 * Resetting therefore deletes the row. It does not write today's default back —
 * that would freeze the current number into the database and quietly ignore any
 * later change to it.
 *
 * ── THREE TABLES ARE FIXED, AND THE PAGE SAYS WHY ────────────────────────────
 * Effort points, priority weight and status weight are shown but not editable.
 * Every `effort_points` already stored was computed from them, so changing one
 * would restate the cost of work estimated months ago. Section 3 explains that
 * on screen instead of offering a control that would corrupt history.
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

  const [{ values, overrides }, skills] = await Promise.all([
    effectiveSettings(user.id),
    listAllSkills(user.id),
  ]);

  const actor = { role: user.role, id: user.id };
  const editableKeys = SETTING_DEFINITIONS.filter((d) => can(actor, d.permission)).map((d) => d.key);
  const canEditSkills = can(actor, 'settings.skills_library');
  const readOnlyCount = SETTING_DEFINITIONS.length - editableKeys.length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description={
          <>
            Everything the engine is using right now, and the{' '}
            <span className="font-semibold text-text-primary">live values</span> — changing one here
            changes what the next capacity calculation and the next recommendation do. Only the
            values somebody has deliberately changed are stored; the rest fall back to the shipped
            defaults, so resetting a field genuinely restores it rather than pinning today&rsquo;s
            number.
          </>
        }
      />

      {/* CHANGE-PLAN 6.4: the numbered steps are gone. They implied an order —
          "do 1, then 2, then 3" — which was never true of a settings screen you
          dip into to change one threshold. Sections now say what they are. */}
      <PageSection
        title="What the engine uses"
        description={
          readOnlyCount > 0
            ? `Each field saves on its own. ${readOnlyCount} of ${SETTING_DEFINITIONS.length} are shown but not editable by your role (doc 03 §3.6). Some combinations are refused even when every number is in range by itself — a soft threshold above the hard one means the warning never fires before the block.`
            : 'Each field saves on its own. Some combinations are refused even when every number is in range by itself — a soft threshold above the hard one means the warning never fires before the block.'
        }
      >
        <SettingsWorkspace
          values={values}
          overriddenKeys={[...overrides.keys()]}
          editableKeys={editableKeys}
        />
      </PageSection>

      <PageSection
        title="Skills library"
        description={`${skills.filter((s) => s.isActive).length} active. Retired rather than deleted — anybody already rated keeps their rating, and that history is what the matching engine reads (FR-017).`}
      >
        <SkillsLibrary skills={skills} canEdit={canEditSkills} />
      </PageSection>

      <PageSection
        title="Fixed by design"
        description="Shown because the arithmetic behind every capacity figure should be visible. Not editable, for the reason below."
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
                  <span className="truncate text-micro text-text-tertiary">{EFFORT_LABEL[size]}</span>
                </div>
              ))}
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
                Priority multiplies the cost — urgent work genuinely takes more attention. It is not
                a sort key (doc 05 §4).
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
            </CardBody>
          </Card>
        </div>

        <Card className="mt-4">
          <CardBody className="flex flex-wrap items-start gap-3 p-4">
            <IconTile icon={Sparkles} token="accent-gold" size="md" />
            <p className="min-w-[16rem] flex-1 text-caption text-text-secondary">
              <span className="font-semibold text-text-primary">Why these three are fixed.</span>{' '}
              Every <span className="font-mono text-micro">effort_points</span> already stored was
              computed from that first table. Changing XS from 1 to 2 would silently restate the cost
              of work estimated months ago, and every historical capacity figure with it. That needs
              a migration of the existing values, not a text box — so it is honestly fixed rather
              than dishonestly offered.
            </p>
          </CardBody>
        </Card>
      </PageSection>

      <PageSection title="Working calendar">
        <Card>
          <Row label="Timezone" value={SYSTEM_DEFAULTS.teamTimezone} />
          <Row
            label="Working days"
            value={DEFAULT_WORKING_DAYS.map((d) => d[0].toUpperCase() + d.slice(1)).join(' · ')}
            note="Sunday is the weekend, so a Sunday holiday reduces nobody's capacity"
          />
          <Row
            label="Working hours"
            value={`${SYSTEM_DEFAULTS.workingHoursStart} – ${SYSTEM_DEFAULTS.workingHoursEnd}`}
            note="Timers pause outside these (FR-174)"
          />
        </Card>
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
