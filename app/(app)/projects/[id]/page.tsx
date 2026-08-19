import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProjectDetailWorkspace } from '@/components/project/project-detail-workspace';
import { requireUser } from '@/lib/auth/current-user';
import { listCredentials } from '@/lib/db/queries/credentials';
import { listDocuments } from '@/lib/db/queries/documents';
import { getProject, listProjectMembers } from '@/lib/db/queries/projects';
import { listTasks } from '@/lib/db/queries/tasks';
import { listPeople } from '@/lib/db/queries/people';
import { can } from '@/lib/domain/permissions';

export const metadata: Metadata = { title: 'Project' };

/* ============================================================================
 * ONE PROJECT, ONE SCREEN — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"When I select the project, it shows up, or it brings me to some page where I
 * can see all the information… We do not have to scroll too much down to see
 * anything like that… switch here, see this, switch there, see this."*
 *
 * Until now there was NO project page at all. Clicking a project did nothing;
 * everything a project knew was spread across a card, the Vault and Documents.
 *
 * ── WHY A ROUTE AND NOT A DRAWER ─────────────────────────────────────────────
 * Tasks open in a drawer, deliberately — opening a task must not lose the board's
 * filters and scroll position. A project is the opposite: it is a destination you
 * send somebody to. "Look at Chitral Royal Homes" needs a URL that survives being
 * pasted into WhatsApp, and a report that links per project needs one too.
 *
 * ── EVERYTHING IS FETCHED HERE, IN PARALLEL ──────────────────────────────────
 * Six reads, one round of latency. The database is in Singapore and this office
 * is not, so six sequential awaits would be six times 102ms before anything
 * renders — measured, not assumed (SESSION-STATE.md).
 * ========================================================================= */

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const project = await getProject(user.id, id);

  /* ⚠️ 404 for both "no such project" and "not yours". `getProject` runs under
     RLS, so an invisible project already comes back null — and distinguishing
     the two would tell somebody that a project they may not see exists. */
  if (!project) notFound();

  const [members, tasks, credentials, documents, people] = await Promise.all([
    listProjectMembers(user.id, id),
    listTasks(user.id, { projectId: id, includeClosed: true }),
    listCredentials(user.id),
    listDocuments(user.id),
    can(actor, 'project.edit') ? listPeople(user.id, {}) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <ProjectDetailWorkspace
        project={project}
        members={members}
        tasks={tasks}
        /* Filtered here rather than in SQL because both lists are already scoped
           by RLS to what this person may see, and both are small. If either grows
           past a few hundred rows this becomes a per-project query. */
        credentials={credentials.filter((c) => c.projectId === id)}
        documents={documents.filter((d) => d.projectId === id)}
        people={people
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.fullName, role: p.role }))}
        canManage={can(actor, 'project.edit')}
      />
    </div>
  );
}
