import type { Metadata } from 'next';

import { AddLead } from '@/components/crm/add-lead';
import { LeadDrawer } from '@/components/crm/lead-drawer';
import { RecordOutcome } from '@/components/crm/record-outcome';
import { MyLeadsDesk } from '@/components/crm/my-leads-desk';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmAddLeadProjects,
  crmLeadRelated,
  crmLeadThread,
  crmMyCounts,
  crmOwnerOptions,
  crmProjectProperties,
  getCrmLead,
  listCrmLeads,
  listCrmProjects,
} from '@/lib/db/queries/crm-leads';
import { isStage } from '@/lib/domain/crm-stages';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'My leads' };

/* ============================================================================
 * MY LEADS — the sales consultant's own list
 * ----------------------------------------------------------------------------
 * Owner's specification, 2026-09-14: *"Only return leads assigned to the
 * authenticated salesperson."*
 *
 * ── ⚠️ `mine` IS NOT THE SAME AS RLS, AND BOTH ARE NEEDED ──────────────────
 * `crm_leads_select` already stops a salesperson reading anybody else's lead.
 * It does NOT stop a MANAGER reading the whole department — which is correct for
 * their desk and wrong for this page. So the query carries `mine: true`, which
 * adds `owner_id = app.current_user_id()`.
 *
 * Belt and braces, deliberately: RLS is the security boundary and `mine` is the
 * page's meaning. If either were removed the other would still hold for a
 * salesperson, and the failure mode for a manager is a page that shows too much
 * rather than a page that leaks.
 *
 * ── ⚠️ ACROSS EVERY PROJECT, NOT ONE ───────────────────────────────────────
 * A salesperson works whatever they have been given; scoping this to a single
 * project would hide half their day behind a dropdown. The project picker
 * narrows it, it does not define it.
 *
 * ── ⚠️ AND THE OLD `/my-leads` IS GONE, ON THE OWNER'S INSTRUCTION ─────────
 * It showed `app.crm_my_day` (migration 136) — a daily summary rather than a
 * workable list. That reader is untouched and is what the future "My sales desk"
 * will be built from; this route is now the row-wise list the design asks for.
 * ========================================================================= */

export default async function MyLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmAccess();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const PER_PAGE = 10;

  const filters = {
    /* ⚠️ Validated, never passed through — `stage` reaches SQL as an enum
       comparison, where an unknown value is a 500 rather than an empty list. */
    stage: params.stage && isStage(params.stage) ? params.stage : null,
    ownerId: null,
    temperature: params.temp ?? null,
    formId: params.form ?? null,
    search: params.q ?? null,
    from: null,
    to: null,
    due: ['overdue', 'today', 'no-plan', 'waiting', 'upcoming', 'closed'].includes(
      params.due ?? '',
    )
      ? (params.due ?? null)
      : null,
    view: null,
    /* ⚠️ HARD TRUE, never read from the URL. The owner's rule: *"Only leads
       assigned to me must be permanently enabled and locked for salespeople."*
       Taking it from a parameter would make it a suggestion. */
    mine: true,
  };

  const projectId = params.project && params.project !== 'all' ? params.project : null;

  const [projects, data, counts, owners] = await Promise.all([
    listCrmProjects(user.id),
    listCrmLeads(user.id, projectId, filters, PER_PAGE, (page - 1) * PER_PAGE),
    /* ⚠️ The cards count MY leads, not the project's. `crmMyCounts` is the same
       arithmetic as `crmDueCounts` with the owner clause — one definition of
       "overdue", so the card and the tab can never disagree. */
    crmMyCounts(user.id, projectId),
    crmOwnerOptions(user.id, projectId),
  ]);

  /* ── The drawer ────────────────────────────────────────────────────────
     ⚠️ FETCHED ON THE SERVER, BESIDE THE LIST, NOT INSIDE THE PANEL. A client
     fetch on open would blank the drawer for a round trip to Singapore every
     time somebody clicked a row — and the list is already being rendered, so
     this costs one wave rather than a wave per click.

     ⚠️ AND `getCrmLead` RETURNS NULL FOR "NOT YOURS" AND FOR "NO SUCH LEAD",
     deliberately and identically. A drawer that behaved differently for the two
     would let somebody probe which ids exist. Null simply renders no drawer. */
  const wanted = params.lead ?? null;
  const tab = (['overview', 'conversations', 'followups', 'related', 'activity'] as const).includes(
    (params.tab ?? '') as never,
  )
    ? ((params.tab ?? 'overview') as 'overview')
    : 'overview';

  const record = wanted ? await getCrmLead(user.id, wanted) : null;
  const [thread, related] = record
    ? await Promise.all([crmLeadThread(user.id, wanted!), crmLeadRelated(user.id, wanted!)])
    : [[], null];

  /* ⚠️ THE FORM WINS OVER THE DRAWER when both are asked for. They are two
     panels on one screen and stacking them would leave the drawer visible and
     unreachable behind a dialog. */
  const wantsOutcome = params.action === 'outcome' && record !== null;

  /* ── Add a lead ────────────────────────────────────────────────────────
     ⚠️ THE PICKER ASKS THE SAME QUESTION THE WRITE WILL. `crmAddLeadProjects`
     lists only the projects this person may actually add to — offering one the
     creator then refuses (CRM02) would be a form that lies about its own
     choices.

     ⚠️ AND THE CATALOGUE FOLLOWS THE URL, NOT THE FORM'S OWN DROPDOWN. Loading
     every project's units would be a query per project on a page that mostly
     does not open the form at all; the units for the project already in view
     cover the ordinary case, and the field simply does not appear otherwise. */
  const wantsAdd = params.action === 'add';
  const [addProjects, addProperties] = wantsAdd
    ? await Promise.all([
        crmAddLeadProjects(user.id),
        projectId ? crmProjectProperties(user.id, projectId) : Promise.resolve([]),
      ])
    : [[], []];

  return (
    <>
      {wantsAdd && (
        <AddLead
          projects={addProjects}
          properties={addProperties}
          defaultProjectId={projectId}
        />
      )}
      {!wantsAdd && wantsOutcome && record && (
        <RecordOutcome
          leadId={record.lead.id}
          leadName={record.lead.fullName ?? 'this lead'}
          /* The stage the row's dropdown was set to, if it carried one. */
          currentStage={
            params.stage && isStage(params.stage) ? params.stage : record.lead.stage
          }
        />
      )}
      {!wantsAdd && !wantsOutcome && record && related && (
        <LeadDrawer
          lead={record.lead}
          notes={record.notes}
          activity={record.activity}
          messages={thread}
          related={related}
          tab={tab}
          viewerName={user.fullName}
          nowMs={nowMs()}
        />
      )}
    <MyLeadsDesk
      projects={projects}
      selectedProjectId={projectId}
      rows={data.rows}
      total={data.total}
      stageCounts={data.stageCounts}
      counts={counts}
      owners={owners}
      page={page}
      perPage={PER_PAGE}
      filters={filters}
      firstName={user.fullName.split(' ')[0] ?? user.fullName}
      fullName={user.fullName}
      nowMs={nowMs()}
    />
    </>
  );
}
