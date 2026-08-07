import type { Metadata } from 'next';

import { ProjectsWorkspace } from '@/components/project/projects-workspace';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { ProgressBar } from '@/components/ui/progress';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { PROJECT_TYPE_META, type ProjectType } from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import { Package } from 'lucide-react';
import { getSettings } from '@/lib/settings/current';

export const metadata: Metadata = { title: 'Projects' };

/* ============================================================================
 * PROJECTS — doc 15, ADR-006
 * ----------------------------------------------------------------------------
 * Every task belongs to exactly one project (BR-011), and the project's type
 * decides both what the form asks for and the reference prefix its tasks carry.
 *
 * ── THE "OTHER" AUDIT IS THE POINT OF THIS SCREEN ────────────────────────────
 * Doc 15 exists because ad-hoc favours were invisible: they consumed real days
 * and appeared in no plan. Making Other a *mandatory category with a written
 * explanation* turns that into a number, and the number belongs here where
 * somebody will see it — above 15% of committed effort it is a warning, not a
 * curiosity (doc 15 §6, the otherWorkWarningPct setting).
 * ========================================================================= */

export default async function ProjectsPage() {
  const user = await requireUser();

  const [projects, people] = await Promise.all([
    listProjects(user.id, { includeArchived: true }),
    listAssignablepeople(user.id),
  ]);

  const byType = new Map<ProjectType, { count: number; points: number }>();
  for (const project of projects) {
    const entry = byType.get(project.type) ?? { count: 0, points: 0 };
    entry.count += 1;
    entry.points += project.effortPoints;
    byType.set(project.type, entry);
  }

  const totalPoints = projects.reduce((sum, p) => sum + p.effortPoints, 0);
  const otherPoints = byType.get('other')?.points ?? 0;
  const otherPct = totalPoints > 0 ? Math.round((otherPoints / totalPoints) * 100) : 0;
  const otherWarningPct = Number((await getSettings()).otherWorkWarningPct);
  const otherHigh = otherPct > otherWarningPct;

  const canManage = can({ role: user.role, id: user.id }, 'project.create');

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="Event · Client · Business · Self-Promotion · Other"
        title="Projects"
        description={
          <>
            <span className="tabular font-semibold text-text-primary">{projects.length}</span>{' '}
            projects holding <span className="tabular font-semibold text-text-primary">{totalPoints}</span>{' '}
            points of open effort. The type changes the form and sets the reference prefix, so{' '}
            <span className="font-mono text-micro">EVT-142</span> says what kind of work it is
            before anybody opens it.
          </>
        }
      />

      {/* ---- The Other audit (doc 15 §6) ---- */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
          <IconTile
            icon={Package}
            token={otherHigh ? 'load-warning' : 'project-other'}
            size="xl"
          />
          <div className="min-w-[13rem] flex-1">
            <p className="text-caption font-semibold text-text-secondary">Ad-hoc work</p>
            <p
              className="tabular text-h1 font-semibold"
              style={{ color: otherHigh ? 'var(--load-warning)' : 'var(--text-primary)' }}
            >
              {otherPct}%
            </p>
            <p className="text-caption text-text-secondary">
              <span className="tabular">{otherPoints}</span> of{' '}
              <span className="tabular">{totalPoints}</span> committed points sit in Other projects
            </p>
          </div>
          <div className="min-w-[15rem] flex-1">
            <ProgressBar
              value={Math.min(otherPct, 100)}
              token={otherHigh ? 'load-warning' : 'project-other'}
              size="lg"
              label={`Ad-hoc work: ${otherPct}% of committed effort`}
            />
            <p className="mt-2 text-micro text-text-tertiary">
              {otherHigh ? (
                <>
                  Above the {otherWarningPct}% line. This is real capacity going
                  to work nobody planned — worth deciding whether it should become a project or stop.
                </>
              ) : (
                <>
                  Under the {otherWarningPct}% line. Every Other task carries a
                  written explanation, which is what keeps this figure honest (BR-012).
                </>
              )}
            </p>
          </div>
        </CardBody>
      </Card>

      {/* ---- The mix ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(PROJECT_TYPE_META) as ProjectType[]).map((type) => {
          const meta = PROJECT_TYPE_META[type];
          const entry = byType.get(type);
          return (
            <div
              key={type}
              className="rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3"
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--${meta.token})` }}
                />
                <span className="truncate text-micro font-semibold text-text-secondary">
                  {meta.label}
                </span>
              </div>
              <p className="tabular mt-1 text-h2 font-semibold text-text-primary">
                {entry?.count ?? 0}
              </p>
              <p className="tabular text-micro text-text-tertiary">{entry?.points ?? 0} pts open</p>
            </div>
          );
        })}
      </div>

      <PageSection
        step={1}
        title="Every project"
        description="Ordered by status, with the catch-all last — it is where work with no home lands, not something anybody planned."
      >
        <ProjectsWorkspace
          projects={projects}
          people={people.map((p) => ({ id: p.id, name: p.fullName }))}
          canManage={canManage}
        />
      </PageSection>
    </div>
  );
}
