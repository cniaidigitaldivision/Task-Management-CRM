import 'server-only';

import type { Priority, TaskStatus } from '@/lib/domain/constants';

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
  readonly startDate: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly projectName: string;
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
  range: { from: string; to: string },
): Promise<CalendarTask[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.status, t.priority,
           t.due_date, t.start_date, t.assignee_id,
           u.full_name as assignee_name, p.name as project_name
      from public.tasks t
      join public.projects p on p.id = t.project_id
      left join public.users u on u.id = t.assignee_id
     where not t.is_deleted
       and t.due_date is not null
       and t.due_date >= ${range.from}::date
       and t.due_date <= ${range.to}::date
     order by t.due_date, t.priority desc
  `);

  return rows.map((row) => ({
    id: row.id as string,
    reference: row.reference as string,
    title: row.title as string,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    dueDate: String(row.due_date).slice(0, 10),
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    assigneeId: (row.assignee_id as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    projectName: row.project_name as string,
  }));
}
