import 'server-only';

import { sql } from '@/lib/db/client';

/* ============================================================================
 * THE REPEATING SERIES THE NIGHTLY RUNNER HAS TO CONSIDER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"if I say that he create a task and make it to a daily…
 * then set a tracker… exactly 12 AM on every day that task will be generated
 * and put in their backlog or in a to do."*
 *
 * ── ⚠️ WHY THIS READ IS ELEVATED, AND WHAT THAT DOES NOT BUY ────────────────
 * A cron request has no session and never will, so there is no `app.user_id`
 * for RLS to filter by and every policy would be false — the read would come
 * back empty and the runner would silently do nothing every night. So this uses
 * the pooled connection directly, exactly as `listSchedulableProjects` does.
 *
 * It buys a READ of series metadata and nothing else. Every INSERT the runner
 * makes goes through `withUser(createdById)` and is admitted by `tasks_insert`
 * on its own merits, so a bug here cannot write a task somebody could not have
 * written themselves.
 * ========================================================================= */

/**
 * A `date` column as 'YYYY-MM-DD'.
 *
 * ── ⚠️ WHY THIS EXISTS RATHER THAN `String(value).slice(0, 10)` ─────────────
 * That is what this file did first, and it broke the runner completely without
 * erroring. postgres.js hands a `date` column back as a JS **Date** at UTC
 * midnight, so `String(date)` is `'Wed Sep 02 2026 05:00:00 GMT+0500…'` and
 * slicing ten characters gives `'Wed Sep 02'`. `occursOn` cannot parse that, so
 * it answered "not one of this series' days" for every series on every night —
 * caught only by calling the live endpoint and reading the response, because
 * nothing threw and nothing was logged.
 *
 * `toISOString()`, never `toLocaleDateString`: the value is already UTC
 * midnight and formatting it in a zone behind UTC moves it to the previous day.
 * Same helper and same reasoning as `dateOnly` in ./attendance.ts.
 */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export interface RepeatingSeries {
  readonly seriesId: string;
  /** The most recent instance — what the next one is copied from. */
  readonly latestTaskId: string;
  readonly recurrenceRule: string;
  /** The anchor the rule is walked forward from. */
  readonly anchorDate: string | null;
  readonly startDate: string | null;

  readonly title: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly otherDescription: string | null;
  readonly contentKind: string | null;
  readonly assigneeId: string | null;
  /** Whose identity the insert runs as. */
  readonly createdById: string;
  readonly priority: string;
  readonly effortSize: string | null;
  readonly effortPoints: number;
  readonly timeLimitMinutes: number | null;

  /** Instances still open. The runaway guard reads this. */
  readonly outstanding: number;
  /** True when the day being generated already has an instance — cron is
   *  at-least-once, so this is what makes a second run a no-op. */
  readonly hasInstanceOnDay: boolean;
}

/**
 * Every live repeating series, with the state the runner needs to decide.
 *
 * ⚠️ `distinct on (recurrence_series_id)` ordered by due date descending picks
 * the LATEST instance per series in one pass. Ordering by `created_at` instead
 * would pick whichever row was inserted last, which is not the same thing the
 * moment somebody back-dates or edits an instance.
 */
export async function listRepeatingSeries(day: string): Promise<RepeatingSeries[]> {
  const rows = await sql`
    with latest as (
      select distinct on (t.recurrence_series_id)
             t.recurrence_series_id, t.id, t.recurrence_rule, t.title, t.description,
             t.project_id, t.other_description, t.content_kind, t.assignee_id,
             t.created_by_id, t.priority, t.effort_size, t.effort_points,
             t.start_date, t.due_date, t.time_limit_minutes
        from public.tasks t
        join public.users u on u.id = t.created_by_id
        join public.projects p on p.id = t.project_id
       where t.recurrence_series_id is not null
         and t.recurrence_rule is not null
         and not t.is_deleted
         /* A creator who cannot write would fail one insert at a time. Skipping
            them here makes it a visible absence rather than a run of errors —
            the same call listSchedulableProjects makes about project owners. */
         and u.is_active = true
         and p.status = 'active'
       order by t.recurrence_series_id, t.due_date desc nulls last, t.created_at desc
    )
    select l.*,
           (select count(*) from public.tasks o
             where o.recurrence_series_id = l.recurrence_series_id
               and not o.is_deleted
               and o.status not in ('done', 'cancelled'))::int as outstanding,
           exists (select 1 from public.tasks d
                    where d.recurrence_series_id = l.recurrence_series_id
                      and not d.is_deleted
                      and d.due_date = ${day}::date) as has_instance_on_day
      from latest l
     order by l.title
  `;

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    seriesId: row.recurrence_series_id as string,
    latestTaskId: row.id as string,
    recurrenceRule: row.recurrence_rule as string,
    anchorDate: dateOnly(row.due_date),
    startDate: dateOnly(row.start_date),
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    projectId: row.project_id as string,
    otherDescription: (row.other_description as string | null) ?? null,
    contentKind: (row.content_kind as string | null) ?? null,
    assigneeId: (row.assignee_id as string | null) ?? null,
    createdById: row.created_by_id as string,
    priority: (row.priority as string) ?? 'medium',
    effortSize: (row.effort_size as string | null) ?? null,
    /* `numeric`/`int` can arrive as a string from postgres.js — the same trap
       `toolBoard` documents. Converted once, here. */
    effortPoints: Number(row.effort_points ?? 0),
    timeLimitMinutes:
      row.time_limit_minutes === null || row.time_limit_minutes === undefined
        ? null
        : Number(row.time_limit_minutes),
    outstanding: Number(row.outstanding ?? 0),
    hasInstanceOnDay: row.has_instance_on_day === true,
  }));
}
