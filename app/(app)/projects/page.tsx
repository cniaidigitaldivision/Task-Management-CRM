import type { Metadata } from 'next';

import { ProjectsWorkspace } from '@/components/project/projects-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { PROJECT_TYPE_META, type ProjectType } from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import { redactFinance } from '@/lib/view/project-finance';
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

  const [projects, people, settings] = await Promise.all([
    listProjects(user.id, { includeArchived: true }),
    listAssignablepeople(user.id),
    getSettings(),
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
  const otherWarningPct = Number(settings.otherWorkWarningPct);
  const otherHigh = otherPct > otherWarningPct;

  const canManage = can({ role: user.role, id: user.id }, 'project.create');
  /* Owner, 2026-08-19: money is Admin-and-above only. Asked as its own question so a
     future change to who may EDIT a project cannot quietly expose every fee. */
  const canSeeFinance = can({ role: user.role, id: user.id }, 'project.view_finance');

  /* ── ⚠️ WHAT WAS REMOVED FROM THIS PAGE, AND WHY ────────────────────────────
     Owner, 2026-08-19:

     · The eyebrow "Event · Client · Business · Self-Promotion · Other" —
       *"In Project, Event, Client, Business, Self Promotion, and Others, I think
       don't need it here."* It listed the five types above a page that already
       shows them as cards and as a filter. Three copies of one taxonomy.

     · "N projects holding N points of open effort…" — *"One Project Holding 0
       Brevet text: don't need it here."* The count is on the cards; the sentence
       about reference prefixes was teaching, not informing.

     · The whole Ad-hoc audit card — *"This whole card is useless, I think. I don't
       know the purpose of this whole card."* It was doc 15 §6's "Other work above
       15% is a warning sign", and the owner is the person that warning exists for.
       If they cannot tell what it is, it is not doing its job in that shape. The
       figure is not lost: it is now the Other card's own subtitle in the row below,
       where it sits beside the thing it is a proportion OF.

     Everything the cards need is computed above and still is. */
  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      {/* Short on purpose — owner: *"Try to use less information and less text."*
          The "New project" button lives in the workspace's own toolbar beside the
          filters, so it is not repeated here. */}
      <PageHeader title="Projects" description="Pick a card to filter. Click a project to open it." />

      <ProjectsWorkspace
        /* ⚠️ Stripped HERE, on the server. The workspace is a Client Component, so
           anything on the row is serialised into the RSC payload whether it is
           rendered or not — a check of the real response found the fee in the HTML
           of this page. See lib/view/project-finance.ts. */
        projects={redactFinance(projects, canSeeFinance)}
        people={people.map((p) => ({ id: p.id, name: p.fullName }))}
        canManage={canManage}
        canSeeFinance={canSeeFinance}
        /* The type mix, computed server-side so the filter cards arrive with their
           counts on them rather than flashing zeroes. `otherPct` travels with it
           because the ad-hoc proportion is now the Other card's subtitle. */
        mix={(Object.keys(PROJECT_TYPE_META) as ProjectType[]).map((type) => ({
          type,
          count: byType.get(type)?.count ?? 0,
          points: byType.get(type)?.points ?? 0,
        }))}
        otherPct={otherPct}
        otherIsHigh={otherHigh}
        otherWarningPct={otherWarningPct}
      />
    </div>
  );
}
