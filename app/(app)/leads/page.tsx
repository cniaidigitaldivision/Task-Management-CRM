import type { Metadata } from 'next';

import { LeadDesk } from '@/components/crm/lead-desk';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmFormOptions,
  crmOwnerOptions,
  crmDueCounts,
  crmProjectRoster,
  listCrmLeads,
  listCrmProjects,
  unassignedCount,
} from '@/lib/db/queries/crm-leads';
import { isStage } from '@/lib/domain/crm-stages';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Campaign & Lead Desk' };

/** Rows per page. Server-paged — see the note on `listCrmLeads`. */
const PER_PAGE = 25;

/* ============================================================================
 * CAMPAIGN & LEAD DESK — the list
 * ----------------------------------------------------------------------------
 * Step 4 of docs/crm/08-TWELVE-STEPS.md. Replaces the scaffold that stood here
 * from 2026-09-09, which existed to say "nothing is connected" honestly. One
 * project now is, so the page shows it.
 *
 * ── ⚠️ ONE PROJECT IS LIVE, AND THE OTHERS SAY SO ──────────────────────────
 * Owner, 2026-09-10: *"Just make it work on only one project, that is, the
 * Chitral Royal Homes. Everything else is not connected. Put that."*
 *
 * So every project stays in the dropdown and each carries its own state. The
 * tempting shortcut — list only Chitral — is the one that must not ship: a
 * dropdown with one entry reads as "this is all there is", and the next person
 * to add a client would have no idea where their project went. Naming the
 * projects that are NOT connected is what makes the scope visible instead of
 * mysterious.
 *
 * ⚠️ AND THE SCOPE IS DATA, NOT CODE. Nothing here names Chitral. The project is
 * live because it has rows; the second one becomes live the same way, with no
 * change to this file. The one place a project IS named is the cron trigger in
 * migration 113, where a uuid would have been unreadable — and that comment says
 * how to widen it.
 *
 * ── ⚠️ SALES, PLUS ADMIN AND SUPER ADMIN ───────────────────────────────────
 * A lead carries a stranger's phone number, and migration 118 decides who may
 * read one: the Sales department, plus the two accounts that run the company.
 * The queries rely on those policies rather than on any check here.
 *
 * ⚠️ A SALESPERSON SEES ONLY THEIR OWN LEADS, and today that is nobody's — so
 * the desk opens empty for them until Step 7 hands leads out. That is the honest
 * order: the door opens before the room is furnished, not after.
 * ========================================================================= */

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* ⚠️ Repeated from the layout on purpose: a page is reachable without its
     layout in some render paths, and a floor that exists in only one of the two
     is not a floor. Same pattern as the Studio. */
  const { user } = await requireCrmAccess();
  const params = await searchParams;

  const projects = await listCrmProjects(user.id);

  /* Default to the first project that actually holds leads — the list is ordered
     with those first, so this lands on something worth reading rather than on an
     alphabetical "not connected". */
  const selected =
    projects.find((p) => p.id === params.project) ??
    projects.find((p) => p.connection === 'live') ??
    projects[0] ??
    null;

  /* ⚠️ VALIDATED, NOT PASSED THROUGH. `stage` reaches SQL as an enum comparison;
     an unknown value there is a 500 rather than an empty list, and the URL is
     the one input a person can edit by hand. */
  const stage = params.stage && isStage(params.stage) ? params.stage : null;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const filters = {
    stage,
    ownerId: params.owner ?? null,
    temperature: params.temp ?? null,
    formId: params.form ?? null,
    search: params.q ?? null,
    from: params.from ?? null,
    to: params.to ?? null,
    /* ⚠️ Validated against the three the strip offers, not passed through. This
       reaches SQL as a branch rather than a value, so an unknown one simply
       falls through to "no filter" — but a typo silently showing everything is
       still worth refusing where it is cheap. */
    due: ['overdue', 'today', 'no-plan'].includes(params.due ?? '') ? (params.due ?? null) : null,
  };

  /* Nothing to fetch for a project with no leads — the desk shows its state
     instead, and three empty queries would be three wasted round trips. */
  const data =
    selected && selected.connection === 'live'
      ? await Promise.all([
          listCrmLeads(user.id, selected.id, filters, PER_PAGE, (page - 1) * PER_PAGE),
          crmOwnerOptions(user.id, selected.id),
          crmFormOptions(user.id, selected.id),
          unassignedCount(user.id, selected.id),
          /* ⚠️ EMPTY FOR A SALESPERSON, by migration 120's guard rather than by
             a check here — which is also how the page knows whether to draw the
             share-out control at all. */
          /* ⚠️ Per PROJECT since migration 124 — Chitral's team is Sales,
             the ERP project's is AI & Digital. */
          crmProjectRoster(user.id, selected.id),
          crmDueCounts(user.id, selected.id),
        ])
      : null;

  const roster = data?.[4] ?? [];

  return (
    <LeadDesk
      projects={projects}
      selected={selected}
      rows={data?.[0].rows ?? []}
      total={data?.[0].total ?? 0}
      stageCounts={data?.[0].stageCounts ?? {}}
      owners={data?.[1] ?? []}
      forms={data?.[2] ?? []}
      page={page}
      perPage={PER_PAGE}
      filters={filters}
      unassigned={data?.[3] ?? 0}
      due={data?.[5] ?? { overdue: 0, dueToday: 0, noPlan: 0 }}
      salesTeam={roster}
      canShareOut={roster.length > 0}
      /* ⚠️ The SERVER's clock, so "3d ago" is the same for everyone. Reading it
         in the browser would let a reader's own wrong system time age a lead
         that arrived this morning, and React would report the mismatch as a
         hydration error rather than as the clock problem it is. */
      nowMs={nowMs()}
    />
  );
}
