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
import { listFolders } from '@/lib/db/queries/drive-folders';
import { listPlacementsForProject } from '@/lib/db/queries/placements';
import { tasksInRange } from '@/lib/db/queries/search';
import { can } from '@/lib/domain/permissions';
import { redactOne } from '@/lib/view/project-finance';
import { isoDateIn, isoMonthIn, nowMs } from '@/lib/now';
import { monthLabel as cadenceMonthLabel } from '@/lib/domain/ceo-report';
import { MONTH_START_PATTERN, recentMonths } from '@/lib/domain/ceo-report';

/** How far back the daily board looks for blank days. A fortnight is enough for
 *  somebody returning from a week away to see what was missed, and short enough
 *  that the list stays readable rather than becoming an archive. */
const DAILY_LOOKBACK_DAYS = 14;

/** Shift an ISO date by whole days. Built on Date.UTC so it cannot land on the
 *  wrong day across a DST boundary — the trap `lib/domain/cadence.ts` documents. */
function isoDaysFrom(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** Last date of the month a 'YYYY-MM-01' names. Day 0 of the next month, the
 *  same trick `cadence.ts` uses and for the same reason. */
function monthEnd(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthStart.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

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

  /* Generating a month creates work nobody volunteered for, which is planning —
     so it asks the same question as "may this person create a task that is not
     their own". Coordinator and above; a Member is refused. The action re-checks
     it server-side; this only decides whether the control is rendered. */
  const canGenerateSchedule = can(actor, 'task.create_for_other');

  /* ⚠️ The month and today are resolved HERE and passed down. A client component
     that read the clock would not be a pure render, and the browser can disagree
     with the server about the date — which would draw the month grid for the
     wrong month.

     ⚠️ And they are resolved in the DIVISION'S zone, not UTC. Pakistan is UTC+5,
     so between midnight and 5am local a UTC date is still yesterday — which made
     the Today view show the previous day's posts for five hours every night.
     Owner, 2026-08-23, at 00:12 local: *"the time limit does not end at 5 am."*
     See `isoDateIn`. */
  const today = isoDateIn();
  const thisMonth = isoMonthIn();
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

  /* ── THE DAILY BOARD'S OWN DATA ────────────────────────────────────────────
     Fetched here rather than inside the tab so the whole page is still one round
     of latency. Bounded to the last fortnight and the next week: the board shows
     today, plus the recent days that went blank, plus what is coming — it has no
     use for March, and an unbounded read would grow with the project. */
  const boardFrom = isoDaysFrom(today, -DAILY_LOOKBACK_DAYS);
  const boardTo = isoDaysFrom(today, 7);

  /* ── ⚠️ THE PROJECT'S OWN TASKS, FOR ITS CALENDAR TAB ─────────────────────
     Owner, 2026-08-23: *"on any project detail page, the calendar is not
     working. It's not showing anything related to that project."*

     It was drawing the posting RHYTHM — what the agreed cadence implies — and
     no tasks whatsoever. That is a useful picture and it is not what somebody
     opening a Calendar expects: they want the work, on the days it is due, with
     who is doing it. Both are shown now, the plan first and the actual work
     under it.

     Scoped to the visible month; the view fetches its own neighbours as you
     page, carrying the same project id. */
  const [placements, driveFolders, calendarTasks] = await Promise.all([
    listPlacementsForProject(user.id, id, boardFrom, boardTo),
    listFolders(user.id),
    tasksInRange(user.id, { from: monthStart, to: monthEnd(monthStart), projectId: id }),
  ]);

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
        canGenerateSchedule={canGenerateSchedule}
        /* So the Tasks tab can open the create form in place instead of sending
           somebody to /tasks to do it — owner, 2026-08-22: *"When I click Add
           Task, the form should pop up here. Don't bring me to that task table
           or task page."* */
        currentUser={{ id: user.id, role: user.role }}
        placements={placements}
        driveFolders={driveFolders}
        dailyLookbackFrom={boardFrom}
        calendarTasks={calendarTasks}
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
        /* `avatarUrl` is carried now for the Access tab's "who can see this"
           stack — a row of faces is only recognisable if it has faces in it.
           `role` was already here; both come off the same `listPeople` row, so
           this adds no query. */
        people={people
          .filter((p) => p.isActive)
          .map((p) => ({
            id: p.id,
            name: p.fullName,
            role: p.role,
            avatarUrl: p.avatarUrl,
          }))}
        /* ── ⚠️ THE CLOCK, READ ON THE SERVER, ONCE ────────────────────────────
           The Access list says "updated 3d ago" per row. `lib/now.ts` is explicit
           that a component may not read the clock — a render that does is not pure,
           and the server and browser can disagree across a midnight boundary — so
           the instant is passed in and `relativeAge` turns it into words. Same
           reason `today` and `monthStart` are props rather than computed below. */
        nowMs={nowMs()}
        canManage={can(actor, 'project.edit')}
        /* ── ⚠️ FILES ARE THEIR OWN TWO PERMISSIONS, ASKED HERE ───────────────
           Owner, 2026-08-24: *"only in the admin and team coordinator access…
           he can delete it, change the name of the file, view it."*

           `document.manage` is exactly that set (Super Admin, Admin, Team
           Coordinator; Member denied) and `document.approve` the same set asked
           about the queue. Read from the matrix rather than compared against
           `user.role` in the component: the actions check the same predicate, so
           the control and the boundary cannot come to disagree about who. */
        canManageDocuments={can(actor, 'document.manage')}
        canApproveDocuments={can(actor, 'document.approve')}
        /* ⚠️ NOT the same set as the three above. `credential.grant` is Admin and
           Super Admin only — a Coordinator may change a stored password but not
           hand it to a third person, because that one cannot be undone by undoing
           it. Owner, 2026-08-24: *"only admins and super admins can add someone
           and can delete someone from here."* */
        canGrantCredentials={can(actor, 'credential.grant')}
      />
    </div>
  );
}
