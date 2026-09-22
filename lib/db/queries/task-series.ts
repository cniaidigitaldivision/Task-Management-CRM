import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * A REPEATING TASK, AS A THING THAT CAN BE STOPPED (migrations 250, 251)
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"if someone accidentally creates a task and doesn't notice
 * that it's a daily creation, there's no button to stop that daily creation of
 * tasks."*
 *
 * ── ⚠️ EVERY CALL HERE GOES THROUGH A `SECURITY DEFINER` FUNCTION ──────────
 * `public.task_series` has row level security on and **no policies**, so
 * `cni_app` cannot touch it directly at all. That was not the intended design:
 * `CREATE POLICY` could not run on 2026-09-22 (see 250's note and T-07), so
 * authorisation lives in the functions instead — each one asks the same
 * question a policy would have: does this person see all work, did they raise
 * this series, or is it assigned to them.
 *
 * The consequence worth knowing: adding a column here is not enough to expose
 * it; the function has to return it.
 * ========================================================================= */

export interface TaskSeries {
  readonly id: string;
  readonly rule: string;
  readonly title: string;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly createdById: string;
  readonly createdByName: string;
  readonly oneOpenCopy: boolean;
  readonly statusOnCreate: string;
  readonly stoppedAt: string | null;
  readonly stoppedByName: string | null;
  /** Copies still open — what a person is actually carrying. */
  readonly openCopies: number;
  /** Copies nobody has touched: still as created, nothing logged or said. */
  readonly untouchedCopies: number;
  readonly canManage: boolean;
}

/**
 * A `date` column as 'YYYY-MM-DD'.
 *
 * ⚠️ NOT `String(value).slice(0, 10)`. postgres.js hands a `date` back as a JS
 * **Date** at UTC midnight, so `String(date)` is `'Tue Sep 22 2026 05:00:00
 * GMT+0500…'` and ten characters of that is `'Tue Sep 22'`. It parses as
 * nothing, so "next copy" silently disappeared from every row of the Repeating
 * tasks page — caught by looking at the page, not by a test. Same helper and
 * same reasoning as `dateOnly` in ./repeats.ts.
 */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toSeries(row: Record<string, unknown>): TaskSeries {
  return {
    id: String(row.id),
    rule: String(row.recurrence_rule),
    title: String(row.title),
    assigneeId: (row.assignee_id as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name ?? 'Somebody'),
    oneOpenCopy: row.one_open_copy === true,
    statusOnCreate: String(row.status_on_create ?? 'backlog'),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at as string).toISOString() : null,
    stoppedByName: (row.stopped_by_name as string | null) ?? null,
    openCopies: Number(row.open_copies ?? 0),
    untouchedCopies: Number(row.untouched_copies ?? 0),
    canManage: row.can_manage === true,
  };
}

/** The series one task belongs to — for the task in front of somebody. */
export async function seriesOfTask(actorId: string, taskId: string): Promise<TaskSeries | null> {
  const rows = await withUser(actorId, (tx) => tx`select * from app.task_series_of_task(${taskId})`);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? toSeries(row) : null;
}

export interface SeriesCard extends TaskSeries {
  readonly projectId: string;
  readonly projectName: string;
  readonly priority: string;
  readonly effortPoints: number;
  readonly anchorDate: string | null;
  readonly lastGeneratedOn: string | null;
}

/** Every series this person may see — the Repeating tasks view. */
export async function listTaskSeries(actorId: string): Promise<SeriesCard[]> {
  const rows = await withUser(actorId, (tx) => tx`select * from app.task_series_board()`);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    ...toSeries(row),
    /* `task_series_board` reports counts but not `can_manage`; a series it
       returned is one this person may see, and the same three-way test decides
       both — so it is answered here rather than by a second round trip. */
    canManage: true,
    projectId: String(row.project_id),
    projectName: String(row.project_name),
    priority: String(row.priority ?? 'medium'),
    effortPoints: Number(row.effort_points ?? 0),
    anchorDate: dateOnly(row.anchor_date),
    lastGeneratedOn: dateOnly(row.last_generated_on),
  }));
}

export interface SaveSeriesInput {
  readonly seriesId?: string | null;
  readonly rule: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly otherDescription: string | null;
  readonly contentKind: string | null;
  readonly assigneeId: string | null;
  readonly priority: string;
  readonly effortSize: string | null;
  readonly effortPoints: number;
  readonly timeLimitMinutes: number | null;
  /** The day the rule is counted from — the first copy's due date. */
  readonly anchorDate: string | null;
}

/** Create the definition (or restart a stopped one). Returns the series id. */
export async function saveTaskSeries(actorId: string, input: SaveSeriesInput): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    select app.save_task_series(
      ${input.seriesId ?? null}::uuid, ${input.rule}, ${input.title}, ${input.description},
      ${input.projectId}::uuid, ${input.otherDescription}, ${input.contentKind},
      ${input.assigneeId}::uuid, ${input.priority}, ${input.effortSize},
      ${input.effortPoints}, ${input.timeLimitMinutes}, ${input.anchorDate}::date
    ) as id
  `);
  return String((rows as Array<Record<string, unknown>>)[0].id);
}

/** Change the repeat, and only the repeat (251). */
export async function setSeriesRule(actorId: string, seriesId: string, rule: string): Promise<void> {
  await withUser(actorId, (tx) => tx`select app.set_task_series_rule(${seriesId}::uuid, ${rule})`);
}

/**
 * Stop it, for ever, from any copy.
 *
 * ⚠️ `removeUntouched` deletes only copies nobody has touched — still in the
 * status they were created in, nothing logged, nothing said. Anything somebody
 * started, finished or commented on is their record of that day.
 */
export async function stopTaskSeries(
  actorId: string,
  seriesId: string,
  options: { reason?: string | null; removeUntouched?: boolean } = {},
): Promise<{ removed: number }> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.stop_task_series(
      ${seriesId}::uuid, ${options.reason ?? null}, ${options.removeUntouched ?? false}
    )
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return { removed: Number(row?.removed ?? 0) };
}
