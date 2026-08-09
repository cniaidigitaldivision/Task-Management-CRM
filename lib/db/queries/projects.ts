import 'server-only';

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
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    /* `time` arrives as 'HH:MM:SS'; the forms want 'HH:MM'. Migration 020. */
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    targetEndDate: row.target_end_date ? String(row.target_end_date).slice(0, 10) : null,
    targetEndTime: row.target_end_time ? String(row.target_end_time).slice(0, 5) : null,
    isPermanent: row.is_permanent as boolean,
    typeFields: (row.type_fields as Record<string, unknown>) ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    taskCount: Number(row.task_count ?? 0),
    openTaskCount: Number(row.open_task_count ?? 0),
    doneTaskCount: Number(row.done_task_count ?? 0),
    overdueTaskCount: Number(row.overdue_task_count ?? 0),
    effortPoints: Number(row.effort_points ?? 0),
  };
}

export async function listProjects(
  actorId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
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
          and t.status not in ('done','cancelled')) as effort_points
    from public.projects p
    left join public.users u on u.id = p.owner_id
    where ${options.includeArchived ? tx`true` : tx`p.status <> 'archived'`}
    order by
      p.is_permanent,              -- the catch-all sits last; it is not a project anyone plans
      case p.status when 'active' then 0 when 'planning' then 1 when 'on_hold' then 2 else 3 end,
      p.name
  `);
  return rows.map(toProject);
}

export async function getProject(actorId: string, projectId: string): Promise<ProjectRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
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
          and t.status not in ('done','cancelled')) as effort_points
    from public.projects p
    left join public.users u on u.id = p.owner_id
    where p.id = ${projectId}
  `);
  return rows[0] ? toProject(rows[0]) : null;
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
  readonly targetEndDate?: string | null;
  readonly typeFields?: Record<string, unknown>;
}

export async function createProject(
  actorId: string,
  input: CreateProjectInput,
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.projects (
      name, type, code, description, status, status_reason, owner_id,
      start_date, target_end_date, type_fields, created_by_id
    ) values (
      ${input.name.trim()},
      ${input.type}::public.project_type,
      ${input.code},
      ${input.description?.trim() || null},
      ${input.status ?? 'active'}::public.project_status,
      ${input.statusReason?.trim() || null},
      ${input.ownerId},
      ${input.startDate ?? null},
      ${input.targetEndDate ?? null},
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
  readonly targetEndDate?: string | null;
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
