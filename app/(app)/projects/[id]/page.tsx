import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProjectDetailWorkspace } from '@/components/project/project-detail-workspace';
import { requireUser } from '@/lib/auth/current-user';
import { listCredentials } from '@/lib/db/queries/credentials';
import { listDocuments } from '@/lib/db/queries/documents';
import {
  getProject,
  listProjectMembers,
  platformsPublishedOn,
} from '@/lib/db/queries/projects';
import { listPackages } from '@/lib/db/queries/catalogue';
import { listTasks } from '@/lib/db/queries/tasks';
import { listPeople } from '@/lib/db/queries/people';
import { listProjectActivity } from '@/lib/db/queries/feed';
import { can } from '@/lib/domain/permissions';
import { redactOne } from '@/lib/view/project-finance';
import { nowMs } from '@/lib/now';
import { monthLabel as cadenceMonthLabel } from '@/lib/domain/ceo-report';
import { MONTH_START_PATTERN, recentMonths } from '@/lib/domain/ceo-report';

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const { month: requestedMonth } = await searchParams;
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const project = await getProject(user.id, id);

  /* ⚠️ 404 for both "no such project" and "not yours". `getProject` runs under
     RLS, so an invisible project already comes back null — and distinguishing
     the two would tell somebody that a project they may not see exists. */
  if (!project) notFound();

  const [members, tasks, credentials, documents, people, activity] = await Promise.all([
    listProjectMembers(user.id, id),
    listTasks(user.id, { projectId: id, includeClosed: true }),
    listCredentials(user.id),
    listDocuments(user.id),
    can(actor, 'project.edit') ? listPeople(user.id, {}) : Promise.resolve([]),
    /* Seven reads, still one round of latency — see the header. */
    listProjectActivity(user.id, id, 8),
  ]);

  const canSeeFinance = can(actor, 'project.view_finance');

  /* ⚠️ The month and today are resolved HERE and passed down. A client component that
     read the clock would not be a pure render, and the browser can disagree with the
     server about the date across midnight or a timezone — which would draw the month
     grid for the wrong month. UTC parts for the same reason `currentMonthStart` uses
     them: the answer must not depend on where the server runs. */
  const now = new Date(nowMs());
  const pad = (n: number) => String(n).padStart(2, '0');
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  /* Formatted here, not in the component: `toLocaleString` in a client component
     renders differently on the server and in the browser and React reports it as a
     hydration mismatch. `monthLabel` already solves this for the CEO report. */
  /* ⚠️ The requested month is VALIDATED, not trusted. It arrives in a URL, is
     compared against a date column, and a malformed value would produce an empty
     month — which reads as "a quiet month" rather than as the fault it is. */
  const monthStart =
    requestedMonth && MONTH_START_PATTERN.test(requestedMonth) ? requestedMonth : thisMonth;
  const monthLabel = cadenceMonthLabel(monthStart);
  const months = recentMonths(nowMs(), 12);

  /* The owner's picture. Read from the people list already fetched above rather than
     as a seventh query — and `?? null` because that list is EMPTY for a reader without
     `project.edit`, in which case the Avatar falls back to initials. */
  const ownerAvatar =
    people.find((person) => person.id === project.ownerId)?.avatarUrl ?? null;

  /* Two more reads, both cheap and both needed by the Overview.

     ⚠️ `platformsPublishedOn` is asked for TODAY specifically, not the selected month.
     The Today card answers "did today's post go out", and pointing it at a month the
     reader is browsing would make it answer a different question silently.

     The package is looked up from the full list rather than by id: it is eight rows,
     already cached by the catalogue query, and a dedicated getter would be a second
     place for the package shape to drift. */
  const [publishedTodayPlatformIds, packages] = await Promise.all([
    platformsPublishedOn(user.id, id, today),
    project.packageId ? listPackages(user.id) : Promise.resolve([]),
  ]);

  const chosenPackage = packages.find((pkg) => pkg.id === project.packageId) ?? null;
  const packageDetail = chosenPackage
    ? {
        name: chosenPackage.name,
        tagline: chosenPackage.tagline,
        monthlyFeePkr: chosenPackage.monthlyFeePkr,
        feeIsFrom: chosenPackage.feeIsFrom,
        platformCount: chosenPackage.platformCount,
        assetsMin: chosenPackage.assetsMin,
        assetsMax: chosenPackage.assetsMax,
        reelsMin: chosenPackage.reelsMin,
        includesWebsite: chosenPackage.includesWebsite,
        websiteNote: chosenPackage.websiteNote,
        includesCrm: chosenPackage.includesCrm,
        crmNote: chosenPackage.crmNote,
        automationNote: chosenPackage.automationNote,
        reportingCadence: chosenPackage.reportingCadence,
        freeBenefit: chosenPackage.freeBenefit,
        bestFor: chosenPackage.bestFor,
      }
    : null;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <ProjectDetailWorkspace
        /* Money stripped before it can reach the payload — see the projects list
           page for the leak this closes. */
        project={redactOne(project, canSeeFinance)}
        canSeeFinance={canSeeFinance}
        monthStart={monthStart}
        monthLabel={monthLabel}
        months={months}
        today={today}
        activity={activity}
        ownerAvatarUrl={ownerAvatar}
        publishedTodayPlatformIds={publishedTodayPlatformIds}
        packageDetail={packageDetail}
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
