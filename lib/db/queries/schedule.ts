import 'server-only';

import { sql, withUser } from '../client';

import type { DayTally } from '@/lib/domain/schedule';

/* ============================================================================
 * WHAT A PROJECT'S CALENDAR ALREADY HOLDS
 * ----------------------------------------------------------------------------
 * The read half of the schedule generator. `lib/domain/schedule.ts` decides
 * what is missing; this tells it what is already there.
 *
 * ⛔ LAYER 1. Goes through `withUser`, so row-level security applies: a person
 *    who cannot see the project cannot count its tasks, and the generator they
 *    then run would find nothing to do rather than quietly filling somebody
 *    else's calendar.
 * ========================================================================= */

/**
 * How many static posts and reels each date in the window already carries.
 *
 * Dates with nothing on them are simply absent from the result — the domain
 * layer treats a missing date as a zero tally, so there is no reason to return
 * a row of zeros for every off day in the month.
 *
 * ── ⚠️ WHAT COUNTS, AND THE ONE DISTINCTION THAT MATTERS ─────────────────────
 * Soft-DELETED tasks do not count. Deleting a task says it should not exist, so
 * the generator is right to put it back on the next run — that is what somebody
 * who deleted one by accident expects.
 *
 * CANCELLED tasks DO count. Cancelling is a deliberate decision about a
 * specific piece of work ("we are not posting on Eid"), and a generator that
 * resurrected it every night would be arguing with the person who cancelled it.
 * The two look similar in the interface and mean opposite things here.
 */
export async function tallyContentTasks(
  actorId: string,
  projectId: string,
  from: string,
  to: string,
): Promise<DayTally[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select to_char(t.due_date, 'YYYY-MM-DD')                             as date,
           count(*) filter (where t.content_kind = 'static')::int        as static_posts,
           count(*) filter (where t.content_kind = 'reel')::int          as reels
      from public.tasks t
     where t.project_id = ${projectId}
       and t.is_deleted = false
       and t.due_date between ${from}::date and ${to}::date
       and t.content_kind in ('static', 'reel')
     group by t.due_date
     order by t.due_date
  `);

  return rows.map((row) => ({
    date: row.date as string,
    staticPosts: Number(row.static_posts),
    reels: Number(row.reels),
  }));
}

/* ============================================================================
 * WHICH PROJECTS THE NIGHTLY JOB SHOULD TOP UP
 * ----------------------------------------------------------------------------
 * ── ⚠️ RAW `sql`, DELIBERATELY, AND ONLY FOR THE LIST ────────────────────────
 * Every other read in this file goes through `withUser` so row-level security
 * decides what comes back. This one cannot: a cron request has no session, so
 * `app.current_user_id()` is null and every policy correctly returns nothing.
 *
 * The same problem, and the same answer, as `app/api/digest/route.ts:81`, which
 * enumerates its recipients this way. The rule being followed is that the
 * ELEVATED read returns identifiers only — ids, names and an owner — and every
 * subsequent write happens inside `withUser(ownerId)` where RLS applies again.
 * Nothing here reads task content, and nothing here writes.
 * ========================================================================= */

export interface SchedulableProject {
  readonly id: string;
  readonly name: string;
  /** Whose identity the generator will act as. */
  readonly ownerId: string;
}

/**
 * Active, non-draft projects that have a posting rhythm to generate from.
 *
 * A project with neither a static rate nor a weekly reel count has agreed no
 * rhythm — a one-off build, say — and there is nothing to create for it. It is
 * excluded here rather than skipped later so the job's own log is a list of
 * projects it actually acted on.
 */
export async function listSchedulableProjects(): Promise<SchedulableProject[]> {
  const rows = await sql`
    select p.id, p.name, p.owner_id
      from public.projects p
      join public.users u on u.id = p.owner_id
     where p.status = 'active'
       and p.is_draft = false
       and (p.static_posts_per_day is not null or p.reels_per_week is not null)
       /* An owner who has been deactivated cannot write, so their inserts would
          fail one at a time. Excluding them makes that a visible skip rather
          than a run of errors. */
       and u.is_active = true
     order by p.name
  `;

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    ownerId: row.owner_id as string,
  }));
}
