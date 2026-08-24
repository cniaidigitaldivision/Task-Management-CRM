import 'server-only';

import { dateOnly } from '../row-values';

import type { Priority, ProjectType, TaskStatus } from '@/lib/domain/constants';

import { withUser } from '../client';

/* ============================================================================
 * GLOBAL SEARCH — FR-085
 * ----------------------------------------------------------------------------
 * Tasks, projects and people in one answer.
 *
 * ── NOTHING HERE FILTERS BY VISIBILITY, AND THAT IS THE POINT ────────────────
 * Search is where a permission model usually leaks. The tempting shape is one
 * fast query over everything followed by a filter in TypeScript — and every
 * bug in that filter is a Member reading somebody else's work through a search
 * box. Every query below runs under `withUser`, so RLS has already removed the
 * rows before this file sees them. A Member searching "salary" gets their own
 * tasks or nothing.
 *
 * ── ILIKE, NOT FULL-TEXT ─────────────────────────────────────────────────────
 * Postgres full-text search would be faster and would rank better. It also
 * stems, which means searching `EVT-142` finds nothing because the tokeniser
 * splits it, and searching "edit" stops matching "editing" in a way people
 * cannot predict. For a division of seven with a few thousand rows, a
 * predictable substring match over an indexed prefix is the better trade — and
 * references are the single most common thing anybody searches for.
 * ========================================================================= */

export interface SearchHit {
  readonly kind: 'task' | 'project' | 'person';
  readonly id: string;
  /** `EVT-142`, a project code, or a role title. */
  readonly label: string;
  readonly title: string;
  readonly detail: string | null;
  readonly status: TaskStatus | null;
  readonly priority: Priority | null;
  readonly href: string;
}

export interface SearchResults {
  readonly tasks: SearchHit[];
  readonly projects: SearchHit[];
  readonly people: SearchHit[];
  readonly total: number;
  /** True when the term was too short to search on. */
  readonly tooShort: boolean;
}

const EMPTY: SearchResults = {
  tasks: [],
  projects: [],
  people: [],
  total: 0,
  tooShort: true,
};

/**
 * `%` and `_` are wildcards in LIKE, and a backslash escapes them.
 *
 * Without this, searching for `100%` matches every row in the table and
 * searching for `report_v2` matches `reportxv2`. Neither is a security problem
 * and both make the box look broken.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function search(actorId: string, rawTerm: string): Promise<SearchResults> {
  const term = rawTerm.trim();
  if (term.length < 2) return EMPTY;

  const pattern = `%${escapeLike(term)}%`;

  return withUser(actorId, async (tx) => {
    const [tasks, projects, people] = await Promise.all([
      tx`
        select t.id, t.reference, t.title, t.status, t.priority,
               p.name as project_name, u.full_name as assignee_name
          from public.tasks t
          join public.projects p on p.id = t.project_id
          left join public.users u on u.id = t.assignee_id
         where not t.is_deleted
           and (t.reference ilike ${pattern} or t.title ilike ${pattern}
                or t.description ilike ${pattern})
         order by
           /* An exact reference match is almost always what somebody meant.
              Without this it sorts by date and the thing they typed lands
              fourth. */
           (lower(t.reference) = lower(${term})) desc,
           t.updated_at desc
         limit 8
      `,
      tx`
        select id, code, name, type, status
          from public.projects
         where code ilike ${pattern} or name ilike ${pattern} or description ilike ${pattern}
         order by (lower(code) = lower(${term})) desc, name
         limit 5
      `,
      tx`
        select id, full_name, role_title, role
          from public.users
         where is_active
           and (full_name ilike ${pattern} or role_title ilike ${pattern})
         order by full_name
         limit 5
      `,
    ]);

    const taskHits: SearchHit[] = tasks.map((row) => ({
      kind: 'task',
      id: row.id as string,
      label: row.reference as string,
      title: row.title as string,
      detail: [row.project_name, row.assignee_name].filter(Boolean).join(' · ') || null,
      status: row.status as TaskStatus,
      priority: row.priority as Priority,
      href: `/tasks?task=${row.id as string}`,
    }));

    const projectHits: SearchHit[] = projects.map((row) => ({
      kind: 'project',
      id: row.id as string,
      label: row.code as string,
      title: row.name as string,
      detail: `${row.type as string} · ${row.status as string}`,
      status: null,
      priority: null,
      href: `/projects`,
    }));

    const peopleHits: SearchHit[] = people.map((row) => ({
      kind: 'person',
      id: row.id as string,
      label: (row.role_title as string | null) ?? (row.role as string),
      title: row.full_name as string,
      detail: null,
      status: null,
      priority: null,
      href: `/team`,
    }));

    return {
      tasks: taskHits,
      projects: projectHits,
      people: peopleHits,
      total: taskHits.length + projectHits.length + peopleHits.length,
      tooShort: false,
    };
  });
}

/* ==========================================================================
 * CALENDAR — FR-088
 * ========================================================================== */

export interface CalendarTask {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate: string;
  /**
   * `HH:MM`, or null for a day with no particular hour (migration 020).
   *
   * Added for the owner's calendar request: the grid sorts by it and shows it, so
   * a day reads in the order the work actually happens rather than by priority.
   */
  readonly dueTime: string | null;
  readonly startDate: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  /** So a day shows faces rather than a column of identical initials. */
  readonly assigneeAvatarUrl: string | null;
  readonly projectName: string;
  readonly projectType: ProjectType;
  /** Enough for the grid to say how big a piece of work it is. */
  readonly effortPoints: number;
}

/**
 * Everything due inside a date range.
 *
 * Closed tasks are included deliberately. A month view showing only open work
 * answers "what is left" but not "what happened", and the second question is
 * the one somebody asks when a client rings about last Tuesday.
 */
export async function tasksInRange(
  actorId: string,
  /* ⚠️ `projectId` added 2026-08-23. Owner, looking at a project's Calendar tab:
     *"the calendar is not working. It's not showing anything related to that
     project."* It was showing the posting RHYTHM — the plan — and no tasks at
     all, because nothing had ever asked this query for one project's work. */
  range: { from: string; to: string; projectId?: string },
): Promise<CalendarTask[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.status, t.priority,
           t.due_date, t.due_time, t.start_date, t.assignee_id, t.effort_points,
           u.full_name as assignee_name, u.avatar_url as assignee_avatar_url,
           p.name as project_name, p.type as project_type
      from public.tasks t
      join public.projects p on p.id = t.project_id
      left join public.users u on u.id = t.assignee_id
     where not t.is_deleted
       and t.due_date is not null
       and t.due_date >= ${range.from}::date
       and t.due_date <= ${range.to}::date
       ${range.projectId ? tx`and t.project_id = ${range.projectId}` : tx``}
     /* Time first, then priority. A day reads in the order the work happens; two
        things at the same hour are ordered by which matters more. Tasks with no
        time sort last within their day rather than first — an unscheduled task is
        not the first thing you do. */
     order by t.due_date, t.due_time asc nulls last, t.priority desc
  `);

  return rows.map((row) => ({
    id: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    dueDate: dateOnly(row.due_date) ?? '',
    /* Postgres `time` arrives as `HH:MM:SS`; the grid wants `HH:MM`. Same
       narrowing as `timeOnly()` in the task mapper. */
    dueTime: row.due_time ? String(row.due_time).slice(0, 5) : null,
    startDate: dateOnly(row.start_date),
    assigneeId: (row.assignee_id as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    assigneeAvatarUrl: (row.assignee_avatar_url as string | null) ?? null,
    projectName: row.project_name as string,
    projectType: row.project_type as ProjectType,
    effortPoints: Number(row.effort_points ?? 0),
  }));
}
