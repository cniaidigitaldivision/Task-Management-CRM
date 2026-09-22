import 'server-only';

import { sql } from '@/lib/db/client';

/* ============================================================================
 * THE REPEATING SERIES THE NIGHTLY RUNNER HAS TO CONSIDER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"if I say that he create a task and make it to a daily…
 * then set a tracker… exactly 12 AM on every day that task will be generated
 * and put in their backlog or in a to do."*
 *
 * ── ⚠️ IT READS `task_series` NOW, NOT THE LAST COPY (migration 250) ───────
 * This file used to reconstruct a series every night: find the newest task that
 * still carried a rule, and copy it. Three things followed, and the team hit all
 * three — clearing the rule on a copy did nothing (it fell back to an older
 * one), deleting a copy did nothing, cancelling did nothing. Measured on
 * 2026-09-22: 13 series had been switched off by hand and were still running;
 * 19–23 generated tasks were being deleted every day and coming back.
 *
 * A series is a row now. It can be stopped, and stopped means stopped.
 *
 * ── ⚠️ WHY THIS READ IS ELEVATED, AND WHAT THAT DOES NOT BUY ────────────────
 * A cron request has no session and never will, so there is no `app.user_id`
 * for RLS to filter by. This uses the pooled connection, exactly as
 * `listSchedulableProjects` does.
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
  readonly recurrenceRule: string;
  /** The day the rule is walked forward from: the last copy made, else the anchor. */
  readonly anchorDate: string | null;

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
  readonly statusOnCreate: string;

  /** ⚠️ True by default: do not make another copy while one is still open. */
  readonly oneOpenCopy: boolean;
  /** Copies still open. The runaway guard and `oneOpenCopy` both read this. */
  readonly outstanding: number;
  /**
   * True when this day already has a copy — **deleted and cancelled ones
   * included**. A day somebody dealt with is a day that has happened.
   */
  readonly hasInstanceOnDay: boolean;
}

/**
 * Every live series, with the state the runner needs to decide.
 *
 * ⚠️ `stopped_at is null` is the whole point of migration 250. A stopped series
 * is not read, not walked and not counted.
 */
export async function listRepeatingSeries(day: string): Promise<RepeatingSeries[]> {
  const rows = await sql`
    select s.id, s.recurrence_rule, s.title, s.description, s.project_id,
           s.other_description, s.content_kind, s.assignee_id, s.created_by_id,
           s.priority, s.effort_size, s.effort_points, s.time_limit_minutes,
           s.status_on_create, s.one_open_copy,
           coalesce(s.last_generated_on, s.anchor_date) as anchor_date,
           (select count(*) from public.tasks o
             where o.recurrence_series_id = s.id
               and not o.is_deleted
               and o.status not in ('done', 'cancelled'))::int as outstanding,
           /* ⚠️ NOT filtered by is_deleted -- a backtick here would end the
              template literal (see memory: backticks break SQL literals).
              Deleting today's copy used to make the runner produce it again;
              a deleted day is a day that happened. */
           exists (select 1 from public.tasks d
                    where d.recurrence_series_id = s.id
                      and d.due_date = ${day}::date) as has_instance_on_day
      from public.task_series s
      join public.users u on u.id = s.created_by_id
      join public.projects p on p.id = s.project_id
     where s.stopped_at is null
       /* A creator who cannot write would fail one insert at a time. Skipping
          them here makes it a visible absence rather than a run of errors —
          the same call listSchedulableProjects makes about project owners. */
       and u.is_active = true
       and p.status = 'active'
     order by s.title
  `;

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    seriesId: row.id as string,
    recurrenceRule: row.recurrence_rule as string,
    anchorDate: dateOnly(row.anchor_date),
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
    statusOnCreate: (row.status_on_create as string) ?? 'backlog',
    oneOpenCopy: row.one_open_copy === true,
    outstanding: Number(row.outstanding ?? 0),
    hasInstanceOnDay: row.has_instance_on_day === true,
  }));
}

/**
 * Remember that a copy was made for this day.
 *
 * ⚠️ Called after the insert, as the owner connection. It is what makes
 * "delete it and it is back in the morning" stop happening: the day is recorded
 * as generated whatever later becomes of the copy.
 */
export async function markSeriesGenerated(seriesId: string, day: string): Promise<void> {
  await sql`
    update public.task_series
       set last_generated_on = greatest(coalesce(last_generated_on, ${day}::date), ${day}::date),
           updated_at = now()
     where id = ${seriesId}
  `;
}
