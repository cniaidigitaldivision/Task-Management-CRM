import 'server-only';

import { withAppRole } from '@/lib/db/client';
import { recordExport, recordTemplateUse } from '@/lib/db/queries/report-templates';
import type { Role } from '@/lib/domain/constants';
import { nextRunOn, type Cadence } from '@/lib/domain/report-templates';
import { isoDateIn, nowMs } from '@/lib/now';

import { generateProjectReport, type ReportActor } from './generate';

/* ============================================================================
 * THE SCHEDULE RUNNER — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * The Studio's Reports & Exports tab says, in as many words, that a scheduled
 * report *"files itself into the Reports tab on its due date"*. This is the code
 * that makes that sentence true. Without it, scheduling would store an intention
 * and the page would be lying.
 *
 * ── ⚠️ IT RUNS AS THE PERSON WHO SET THE SCHEDULE UP ────────────────────────
 * Not as a service account, and not with RLS bypassed. The actor comes off the
 * schedule row, so `getProject`, `projectReportData` and `insertProjectReport`
 * all run under that person's own visibility — a schedule cannot outlive its
 * author's access and quietly keep producing reports on a project they were
 * removed from.
 *
 * The one thing that must NOT run under a session is finding the due schedules,
 * because a cron has none. That read goes through `app.report_schedules_due`
 * (migration 097), for the same reason `runMetaSync` reads through 094: a direct
 * select under RLS with no session returns ZERO ROWS AND NO ERROR, and the job
 * then reports a clean success having done nothing. That has already happened
 * twice on this feature.
 *
 * ── ⚠️ ONLY THE PDF ENGINE IS SCHEDULABLE, AND IT IS ENFORCED HERE ──────────
 * A CSV is streamed to a browser; there is nowhere for an unattended one to go.
 * Scheduling one would file a row in the history pointing at a file that was
 * never written. So a CSV schedule is recorded as a failure with that sentence
 * rather than silently skipped — a skipped schedule looks "Active" forever with
 * nothing anywhere explaining why nothing arrives.
 * ========================================================================= */

export interface ScheduleOutcome {
  readonly scheduleId: string;
  readonly templateName: string;
  readonly outcome: 'ok' | 'failed' | 'skipped';
  readonly reportId?: string;
  readonly error?: string;
  readonly nextRunOn: string;
}

interface DueRow {
  readonly scheduleId: string;
  readonly projectId: string;
  readonly templateId: string;
  readonly cadence: Cadence;
  readonly templateName: string;
  readonly engine: string;
  readonly kind: string | null;
  readonly actor: ReportActor | null;
}

async function dueSchedules(today: string): Promise<DueRow[]> {
  const rows = await withAppRole((tx) => tx`
    select * from app.report_schedules_due(${today}::date)
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    scheduleId: String(r.schedule_id),
    projectId: String(r.project_id),
    templateId: String(r.template_id),
    cadence: String(r.cadence) as Cadence,
    templateName: String(r.template_name),
    engine: String(r.engine),
    kind: r.kind === null || r.kind === undefined ? null : String(r.kind),
    /* ⚠️ NULL WHEN THE AUTHOR IS GONE, and the reader returns the row anyway on
       purpose — see its note in 097. A schedule whose author was deactivated
       must say so rather than sit there looking healthy. */
    actor:
      r.actor_id === null || r.actor_id === undefined
        ? null
        : {
            id: String(r.actor_id),
            email: String(r.actor_email),
            fullName: String(r.actor_name),
            role: String(r.actor_role) as Role,
          },
  }));
}

async function record(scheduleId: string, next: string, error: string | null): Promise<void> {
  await withAppRole((tx) => tx`
    select app.record_schedule_run(${scheduleId}::uuid, ${next}::date, ${error})
  `);
}

/**
 * Run every schedule that is due.
 *
 * ⚠️ SEQUENTIAL, AND PER-SCHEDULE ISOLATED. Each report is a handful of queries
 * and a PDF's worth of composition; running twenty at once would spike the
 * connection pool the whole application shares, for a job nobody is waiting on.
 * And one project's failure must not stop the rest — a client who revoked
 * something, or a project somebody was removed from, would otherwise silently
 * cost every other client their report.
 */
export async function runDueSchedules(): Promise<ScheduleOutcome[]> {
  /* ⚠️ THE KARACHI DATE. `current_date` on this server is a different day for
     five hours each evening; a schedule due "today" would fire a day late all
     evening and the team would see yesterday's date on a fresh report. */
  const today = isoDateIn(nowMs());
  const rows = await dueSchedules(today);
  const outcomes: ScheduleOutcome[] = [];

  for (const row of rows) {
    /* Computed from TODAY rather than from the missed due date: a schedule that
       was overdue by a fortnight should next run at its next natural time, not
       thirteen more times catching up. */
    const next = nextRunOn(row.cadence, today);

    if (row.engine !== 'project_report') {
      const error =
        'Only a PDF report can run unattended. A CSV is streamed to the browser, so there is nowhere for a scheduled one to be delivered.';
      await record(row.scheduleId, next, error);
      outcomes.push({
        scheduleId: row.scheduleId,
        templateName: row.templateName,
        outcome: 'skipped',
        error,
        nextRunOn: next,
      });
      continue;
    }

    if (!row.actor) {
      const error =
        'The person who set this schedule up no longer has an active account, so there is nobody to generate it as. Recreate it.';
      await record(row.scheduleId, next, error);
      outcomes.push({
        scheduleId: row.scheduleId,
        templateName: row.templateName,
        outcome: 'failed',
        error,
        nextRunOn: next,
      });
      continue;
    }

    try {
      const result = await generateProjectReport(
        row.actor,
        row.projectId,
        row.kind ?? 'month',
      );

      await record(row.scheduleId, next, result.ok ? null : (result.error ?? 'unknown'));

      /* The same history the tab's Export History reads, so a scheduled report
         and a pressed one appear side by side — which is the point of having a
         history at all. */
      await recordExport(row.actor.id, {
        projectId: row.projectId,
        templateId: row.templateId,
        templateName: row.templateName,
        reportId: result.ok ? (result.reportId ?? null) : null,
        format: 'pdf',
        fileName: `${row.templateName}.pdf`,
        byteSize: null,
        rowCount: null,
        status: result.ok ? 'ready' : 'failed',
        error: result.ok ? null : (result.error ?? 'The scheduled report failed.'),
      }).catch(() => {
        console.error('[schedule-runner] could not record the export');
      });

      /* ⚠️ A SCHEDULED RUN IS A USE. Found by verification, not by reasoning:
         the first version bumped the counter only on the button, so a template
         that files itself every month forever read "Never used" on its card and
         could never become "Most used" — the two figures would have been quietly
         describing button presses while calling themselves usage. */
      if (result.ok) {
        await recordTemplateUse(row.actor.id, row.templateId).catch(() => {
          console.error('[schedule-runner] could not bump the usage counter');
        });
      }

      outcomes.push({
        scheduleId: row.scheduleId,
        templateName: row.templateName,
        outcome: result.ok ? 'ok' : 'failed',
        reportId: result.reportId,
        error: result.ok ? undefined : result.error,
        nextRunOn: next,
      });
    } catch (error) {
      /* ⚠️ A THROW IS RECORDED AND SWALLOWED, not propagated. One schedule
         throwing must not abandon the schedules after it in the loop. */
      const message = error instanceof Error ? error.message : 'The scheduled report threw.';
      await record(row.scheduleId, next, message).catch(() => {
        console.error('[schedule-runner] could not record a failure');
      });
      outcomes.push({
        scheduleId: row.scheduleId,
        templateName: row.templateName,
        outcome: 'failed',
        error: message,
        nextRunOn: next,
      });
    }
  }

  return outcomes;
}
