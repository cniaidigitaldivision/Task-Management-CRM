import 'server-only';

import { dateOnly } from '../row-values';

import type { ProjectStatus, ProjectType } from '@/lib/domain/constants';

import { withUser } from '../client';
import type { ProjectRow } from './types';

/* ============================================================================
 * PROJECT QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * The aggregates come back with the row. A project card shows its task count,
 * how much is open, how much is late and the total effort committed — four
 * numbers that would otherwise be four queries per card, or one query and a
 * pile of client-side counting that a member's RLS view would then quietly
 * make wrong.
 *
 * Note what the counts are NOT wrapped in: any visibility condition. The
 * subqueries read `tasks`, so a member's counts already reflect only the tasks
 * they can see. That is the right answer — showing a member "18 tasks" for a
 * project where they can open two would be a leak dressed up as a statistic.
 * ========================================================================= */

function toProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as ProjectType,
    code: row.code as string,
    description: (row.description as string | null) ?? null,
    status: row.status as ProjectStatus,
    statusReason: (row.status_reason as string | null) ?? null,
    ownerId: row.owner_id as string,
    ownerName: (row.owner_name as string | null) ?? null,
    startDate: dateOnly(row.start_date),
    /* `time` arrives as 'HH:MM:SS'; the forms want 'HH:MM'. Migration 020. */
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    targetEndDate: dateOnly(row.target_end_date),
    targetEndTime: row.target_end_time ? String(row.target_end_time).slice(0, 5) : null,
    isPermanent: row.is_permanent as boolean,
    typeFields: (row.type_fields as Record<string, unknown>) ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    taskCount: Number(row.task_count ?? 0),
    openTaskCount: Number(row.open_task_count ?? 0),
    doneTaskCount: Number(row.done_task_count ?? 0),
    overdueTaskCount: Number(row.overdue_task_count ?? 0),
    effortPoints: Number(row.effort_points ?? 0),

    clientKind: (row.client_kind as 'internal' | 'external' | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    clientName: (row.client_name as string | null) ?? null,
    packageId: (row.package_id as string | null) ?? null,
    packageName: (row.package_name as string | null) ?? null,
    monthlyFeePkr: row.monthly_fee_pkr === null || row.monthly_fee_pkr === undefined
      ? null
      : Number(row.monthly_fee_pkr),
    assetsTargetMin: nullableInt(row.assets_target_min),
    assetsTargetMax: nullableInt(row.assets_target_max),
    reelsTargetMin: nullableInt(row.reels_target_min),
    renewsOn: dateOnly(row.renews_on),

    platforms: (row.platforms as { id: string; name: string }[] | null) ?? [],
    memberCount: Number(row.member_count ?? 0),

    assetsPublishedThisMonth: Number(row.assets_published_this_month ?? 0),
    reelsPublishedThisMonth: Number(row.reels_published_this_month ?? 0),
  };
}

/** `0` and `null` mean different things in every target on this row, so the
 *  usual `Number(x ?? 0)` would turn "no target agreed" into "target of zero". */
function nullableInt(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/* ── The commercial columns and the progress counts ──────────────────────────
   Shared by `listProjects` and `getProject` so the two cannot drift — the list
   and the detail page must agree about how far along a project is.

   ⚠️ Progress is counted on `published_on`, not `completed_at`. A reel finished
   on Monday and posted on Friday counts against Friday, which is what the
   client was promised and what the month's report has to reflect. */
const COMMERCIAL_SELECT = `
      c.name as client_name,
      pk.name as package_name,
      (select count(*) from public.project_members m where m.project_id = p.id)
        as member_count,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name)
                         order by pl.sort_order)
          from public.project_platforms ppl
          join public.platforms pl on pl.id = ppl.platform_id
         where ppl.project_id = p.id
      ), '[]'::jsonb) as platforms,
      (select count(*) from public.tasks t
        where t.project_id = p.id and not t.is_deleted
          and t.content_kind is not null
          and t.published_on >= date_trunc('month', current_date)::date
          and t.published_on <  (date_trunc('month', current_date) + interval '1 month')::date
      ) as assets_published_this_month,
      (select count(*) from public.tasks t
        where t.project_id = p.id and not t.is_deleted
          and t.content_kind = 'reel'
          and t.published_on >= date_trunc('month', current_date)::date
          and t.published_on <  (date_trunc('month', current_date) + interval '1 month')::date
      ) as reels_published_this_month`;

const COMMERCIAL_JOINS = `
    left join public.clients  c  on c.id  = p.client_id
    left join public.packages pk on pk.id = p.package_id`;

/* ⚠️ ONE SELECT, USED BY BOTH READERS. The list and the detail page must agree
   about how far along a project is — two copies of this arithmetic would
   eventually disagree, and the disagreement would show as a card saying one
   thing and the page it opens saying another.

   `tx.unsafe` rather than a tagged template because a template parameterises an
   interpolated string as a VALUE, so a shared SQL fragment cannot be spliced in.
   Every actual value still travels as a positional parameter. */
const PROJECT_SELECT = `
    select
      p.*, u.full_name as owner_name,
      (select count(*) from public.tasks t where t.project_id = p.id and not t.is_deleted) as task_count,
      (select count(*) from public.tasks t where t.project_id = p.id and not t.is_deleted
         and t.status not in ('done','cancelled')) as open_task_count,
      (select count(*) from public.tasks t where t.project_id = p.id and not t.is_deleted
         and t.status = 'done') as done_task_count,
      (select count(*) from public.tasks t where t.project_id = p.id and not t.is_deleted
         and t.status not in ('done','cancelled') and t.due_date < current_date) as overdue_task_count,
      (select coalesce(sum(t.effort_points), 0) from public.tasks t
        where t.project_id = p.id and not t.is_deleted
          and t.status not in ('done','cancelled')) as effort_points,
${COMMERCIAL_SELECT}
    from public.projects p
    left join public.users u on u.id = p.owner_id
${COMMERCIAL_JOINS}`;

export async function listProjects(
  actorId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectRow[]> {
  /* A boolean chosen in code, not a value from a request, so it cannot carry
     anything. Every user-supplied value in this module is still positional. */
  const where = options.includeArchived ? 'true' : `p.status <> 'archived'`;

  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${PROJECT_SELECT}
    where ${where}
    order by
      p.is_permanent,              -- the catch-all sits last; it is not a project anyone plans
      case p.status when 'active' then 0 when 'planning' then 1 when 'on_hold' then 2 else 3 end,
      p.name`),
  );
  return rows.map((r) => toProject(r as Record<string, unknown>));
}

export async function getProject(actorId: string, projectId: string): Promise<ProjectRow | null> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${PROJECT_SELECT} where p.id = $1`, [projectId]),
  );
  return rows[0] ? toProject(rows[0] as Record<string, unknown>) : null;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly type: ProjectType;
  readonly code: string;
  readonly description?: string | null;
  readonly status?: ProjectStatus;
  readonly statusReason?: string | null;
  readonly ownerId: string;
  readonly startDate?: string | null;
  /** 'HH:MM'. Optional companion to startDate — migration 020. */
  readonly startTime?: string | null;
  readonly targetEndDate?: string | null;
  readonly targetEndTime?: string | null;
  readonly typeFields?: Record<string, unknown>;
}

export async function createProject(
  actorId: string,
  input: CreateProjectInput,
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.projects (
      name, type, code, description, status, status_reason, owner_id,
      start_date, start_time, target_end_date, target_end_time, type_fields, created_by_id
    ) values (
      ${input.name.trim()},
      ${input.type}::public.project_type,
      ${input.code},
      ${input.description?.trim() || null},
      ${input.status ?? 'active'}::public.project_status,
      ${input.statusReason?.trim() || null},
      ${input.ownerId},
      ${input.startDate ?? null},
      ${input.startTime ?? null}::time,
      ${input.targetEndDate ?? null},
      ${input.targetEndTime ?? null}::time,
      ${tx.json((input.typeFields ?? {}) as never)},
      ${actorId}
    )
    returning id
  `);
  return rows[0].id as string;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: ProjectStatus;
  readonly statusReason?: string | null;
  readonly ownerId?: string;
  readonly startDate?: string | null;
  /** 'HH:MM'. Optional companion to startDate — migration 020. */
  readonly startTime?: string | null;
  readonly targetEndDate?: string | null;
  readonly targetEndTime?: string | null;
  readonly typeFields?: Record<string, unknown>;
}

export async function updateProject(
  actorId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<void> {
  const has = (k: keyof UpdateProjectInput) => Object.hasOwn(input, k);

  await withUser(actorId, (tx) => tx`
    update public.projects set
      name            = case when ${has('name')} then ${input.name ?? null} else name end,
      description     = case when ${has('description')} then ${input.description ?? null} else description end,
      status          = case when ${has('status')} then ${input.status ?? null}::public.project_status else status end,
      status_reason   = case when ${has('statusReason')} then ${input.statusReason ?? null} else status_reason end,
      owner_id        = case when ${has('ownerId')} then ${input.ownerId ?? null}::uuid else owner_id end,
      start_date      = case when ${has('startDate')} then ${input.startDate ?? null}::date else start_date end,
      target_end_date = case when ${has('targetEndDate')} then ${input.targetEndDate ?? null}::date else target_end_date end,
      start_time      = case when ${has('startTime')} then ${input.startTime ?? null}::time else start_time end,
      target_end_time = case when ${has('targetEndTime')} then ${input.targetEndTime ?? null}::time else target_end_time end,
      type_fields     = case when ${has('typeFields')} then ${tx.json((input.typeFields ?? {}) as never)} else type_fields end
    where id = ${projectId}
  `);
}

/**
 * Share of open effort sitting in "Other" projects, per person.
 *
 * doc 15 §6: ad-hoc work above 15% of someone's capacity is a warning sign, and
 * the entire reason the Other category is mandatory rather than optional. This is
 * the number that makes the invisible work visible — which is the point of the
 * whole category.
 */
export async function otherWorkShareByPerson(
  actorId: string,
): Promise<Array<{ userId: string; otherPoints: number; totalPoints: number }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.assignee_id as user_id,
           coalesce(sum(t.effort_points) filter (where p.type = 'other'), 0) as other_points,
           coalesce(sum(t.effort_points), 0) as total_points
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where not t.is_deleted
       and t.assignee_id is not null
       and t.status not in ('done', 'cancelled')
     group by t.assignee_id
  `);
  return rows.map((row) => ({
    userId: row.user_id as string,
    otherPoints: Number(row.other_points),
    totalPoints: Number(row.total_points),
  }));
}
