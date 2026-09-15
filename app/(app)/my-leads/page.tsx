import type { Metadata } from 'next';

import { MyLeadsDesk } from '@/components/crm/my-leads-desk';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmMyCounts,
  crmOwnerOptions,
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

  return (
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
  );
}
