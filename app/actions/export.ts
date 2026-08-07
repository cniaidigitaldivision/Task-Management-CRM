'use server';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { listTasks } from '@/lib/db/queries/tasks';
import { teamWorkload } from '@/lib/db/queries/workload';
import { EFFORT_POINTS, PRIORITY_LABEL, STATUS_META } from '@/lib/domain/constants';
import { exportFileName, toCsv } from '@/lib/domain/csv';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * CSV EXPORT — FR-091
 * ----------------------------------------------------------------------------
 * ── AN EXPORT IS A COPY THAT LEAVES THE BUILDING ─────────────────────────────
 * Once a file is in somebody's Downloads folder, every access control in this
 * system stops applying to it. So two things are true here that are not true of
 * an ordinary read:
 *
 *   1. The rows come from `listTasks` under `withUser`, so RLS decides the
 *      scope. A Member exporting gets their own work — the same rows they can
 *      already see — rather than everything with a filter applied afterwards.
 *   2. Every export is written to the audit trail with a row count. Not to
 *      catch anybody: so that when a spreadsheet of the division's work turns
 *      up somewhere it should not be, there is a record of when it left and
 *      who took it. Without that, the question is unanswerable.
 * ========================================================================= */

export interface ExportResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly fileName?: string;
  readonly csv?: string;
  readonly rowCount?: number;
}

export async function exportTasksAction(filter: {
  includeClosed?: boolean;
  projectId?: string;
  assigneeId?: string;
} = {}): Promise<ExportResult> {
  const user = await requireUser();

  const rows = await listTasks(user.id, {
    includeClosed: filter.includeClosed ?? true,
    projectId: filter.projectId,
    assigneeId: filter.assigneeId,
    limit: 5000,
  });

  const csv = toCsv(
    [
      'Reference',
      'Title',
      'Project',
      'Project type',
      'Status',
      'Priority',
      'Effort',
      'Effort points',
      'Assignee',
      'Raised by',
      'Start date',
      'Due date',
      'Completed',
      'Time limit (min)',
      'Time spent (min)',
      'Subtasks',
      'Comments',
      'Files',
    ],
    rows.map((task) => [
      task.reference,
      task.title,
      task.projectName,
      task.projectType,
      STATUS_META[task.status].label,
      PRIORITY_LABEL[task.priority],
      task.effortSize ?? '',
      task.effortPoints,
      task.assigneeName ?? 'Unassigned',
      task.createdByName ?? '',
      task.startDate ?? '',
      task.dueDate ?? '',
      task.completedAt ? task.completedAt.slice(0, 10) : '',
      task.timeLimitMinutes ?? '',
      task.timeSpentMinutes,
      task.subtaskCount,
      task.commentCount,
      task.attachmentCount,
    ]),
  );

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'task',
      entityId: null,
      action: 'export.tasks',
      after: { rowCount: rows.length, filter },
    }),
  ).catch(() => {
    /* The audit write must not swallow the export — but a failure here is worth
       knowing about, so it is deliberately not silent in the log. */
    console.error('[export] audit write failed for tasks export');
  });

  return {
    ok: true,
    fileName: exportFileName('cni-tasks', new Date(nowMs()).toISOString()),
    csv,
    rowCount: rows.length,
  };
}

/** The workload table, for anybody who has to put a number in a board pack. */
export async function exportWorkloadAction(): Promise<ExportResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'workload.view_team')) {
    return { ok: false, error: 'Only a Coordinator and above can export the team’s workload.' };
  }

  const { window, people } = await teamWorkload(user.id, nowMs());

  const csv = toCsv(
    [
      'Name',
      'Role',
      'Week starting',
      'Week ending',
      'Load points',
      'Capacity points',
      'Utilisation %',
      'Band',
      'Active tasks',
      'Concurrent limit',
      'Ad-hoc work %',
    ],
    people.map((person) => [
      person.name,
      person.roleTitle ?? person.role,
      window.start,
      window.end,
      person.workload.loadPoints,
      person.workload.capacityPoints,
      person.workload.utilisationPct,
      person.workload.band,
      person.workload.activeTaskCount,
      person.workload.maxConcurrentTasks,
      person.otherWorkPct,
    ]),
  );

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'user',
      entityId: null,
      action: 'export.workload',
      after: { rowCount: people.length, week: window },
    }),
  ).catch(() => {
    console.error('[export] audit write failed for workload export');
  });

  return {
    ok: true,
    fileName: exportFileName('cni-workload', new Date(nowMs()).toISOString()),
    csv,
    rowCount: people.length,
  };
}

/** Effort sizes, exported so a spreadsheet can reconstruct the point maths. */
export async function effortKeyAction(): Promise<Record<string, number>> {
  await requireUser();
  return { ...EFFORT_POINTS };
}
