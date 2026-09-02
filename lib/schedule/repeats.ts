import 'server-only';

import { listRepeatingSeries, type RepeatingSeries } from '@/lib/db/queries/repeats';
import { createTask } from '@/lib/db/queries/tasks';
import { occursOn, parseRecurrence } from '@/lib/domain/recurrence';
import type { ContentKind } from '@/lib/domain/constants';

/* ============================================================================
 * THE NIGHTLY REPEAT RUNNER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03, on what should replace the bulk month:
 *
 *   *"I'm not saying that we say that generate this task daily then you will
 *   create all these task of a month and put them in a database and make the
 *   database heavy. I don't want that. I want that to put a tracker… and on
 *   daily basis on a 12 AM that task will auto generate and put in their
 *   backlog or in a to do. And next morning when he go to the office he will
 *   see that now yeah this is my task."*
 *
 * So: one instance, on the night it is due, assigned to the same person.
 *
 * ── ⚠️ THIS REPLACES SPAWN-ON-CLOSE, WHICH WAS A DELIBERATE DESIGN ──────────
 * `spawnNextOccurrence` created the next instance when the current one CLOSED,
 * and its comment argued the case: *"the series can never outrun the person
 * doing it: a weekly report three weeks late is ONE task three weeks old, which
 * is the truth, rather than four tasks implying four separate pieces of work —
 * and four tasks' worth of capacity load nobody owes."*
 *
 * That argument is sound and the owner overruled it on 2026-09-03, having been
 * shown the consequence, choosing *"always generate, even if behind"* — because
 * a person arriving in the morning needs to see today's work whether or not
 * they finished yesterday's. Recorded here so it stays a decision rather than
 * becoming folklore, and so whoever reads the retired comment knows it was
 * answered rather than forgotten.
 *
 * The cost is real and worth stating plainly: N open copies of one job report N
 * times the capacity load on /workload, because effort points are per row. If
 * that misleads in practice, the fix is `OUTSTANDING_LIMIT = 1`.
 *
 * ── IT IS SAFE TO CALL TWICE, AND THAT IS LOAD-BEARING ──────────────────────
 * Cron delivery is at-least-once. `hasInstanceOnDay` is checked per series, so
 * a second run the same night creates nothing. Without that the team would find
 * two of everything after any retry.
 *
 * ── IT DOES NOT BACKFILL ────────────────────────────────────────────────────
 * Only the day it is asked about. Filling days that have already passed
 * manufactures overdue work nobody was asked to do — the rule the retired
 * schedule generator held too.
 * ========================================================================= */

/* ⚠️ A RUNAWAY GUARD, NOT A POLICY. The owner chose to keep generating while a
   person is behind, so this is deliberately far above any sane backlog: two
   working weeks of a daily series. It exists for the case nobody intends — a
   repeat left on a deactivated project, a series nobody has opened for a month
   — where the alternative is a table filling one row a night, unnoticed.
   Anybody working normally will never reach it. */
const OUTSTANDING_LIMIT = 14;

export interface RepeatOutcome {
  readonly seriesId: string;
  readonly title: string;
  /** The task created, if one was. */
  readonly createdTaskId: string | null;
  /** Why nothing was created. Absent when something was. */
  readonly skipped?: string;
}

/** One series' decision, kept pure so the branches can be read at a glance. */
function decide(series: RepeatingSeries, day: string): { create: true } | { create: false; why: string } {
  if (series.hasInstanceOnDay) {
    return { create: false, why: 'already generated for this day' };
  }

  const parsed = parseRecurrence(series.recurrenceRule);
  if (!parsed.ok) {
    /* A rule that no longer parses is a data problem, not a reason to guess.
       Reported so it can be fixed rather than silently skipped for ever. */
    return { create: false, why: `unreadable repeat rule: ${parsed.message}` };
  }

  const anchor = series.anchorDate ?? series.startDate;
  if (!anchor) {
    return { create: false, why: 'the series has no date to count from' };
  }

  if (!occursOn(parsed.rule, anchor, day)) {
    return { create: false, why: 'not one of this series’ days' };
  }

  if (series.outstanding >= OUTSTANDING_LIMIT) {
    return {
      create: false,
      why: `${series.outstanding} instances already open — runaway guard`,
    };
  }

  return { create: true };
}

/**
 * Generate each repeating series' instance for `day`.
 *
 * ⚠️ Every insert runs as the series' CREATOR, through `withUser` inside
 * `createTask` — never as an elevated identity. So `tasks_insert` admits the row
 * on its own merits, and a bug here cannot create a task that person could not
 * have created themselves. The read above it is elevated; the write is not.
 */
export async function runRepeatsFor(day: string): Promise<RepeatOutcome[]> {
  const series = await listRepeatingSeries(day);
  const outcomes: RepeatOutcome[] = [];

  for (const item of series) {
    const verdict = decide(item, day);

    if (!verdict.create) {
      outcomes.push({
        seriesId: item.seriesId,
        title: item.title,
        createdTaskId: null,
        skipped: verdict.why,
      });
      continue;
    }

    try {
      /* ⚠️ The assignee is carried over, which is the owner's whole point:
         *"that task will automatically created daily and automatically create
         assign to that person daily."* An unassigned series stays unassigned. */
      const created = await createTask(item.createdById, {
        title: item.title,
        description: item.description,
        projectId: item.projectId,
        otherDescription: item.otherDescription,
        assigneeId: item.assigneeId,
        /* Backlog, not To Do. The owner said *"put in their backlog or in a to
           do"* and left the choice open; Backlog is the honest one — nobody has
           committed to today's copy yet, and moving it to To Do is how a person
           says they have. */
        status: 'backlog',
        priority: item.priority as 'low' | 'medium' | 'high' | 'urgent',
        /* Upper case — the enum is XS/S/M/L/XL, checked rather than guessed
           after tsc caught the lower-case spelling. */
        effortSize: item.effortSize as 'XS' | 'S' | 'M' | 'L' | 'XL' | null,
        effortPoints: item.effortPoints,
        dueDate: day,
        timeLimitMinutes: item.timeLimitMinutes,
        contentKind: item.contentKind as ContentKind | null,
        /* Both carried, so the chain continues and the series keeps its
           identity however many instances it runs to. */
        recurrenceRule: item.recurrenceRule,
        recurrenceSeriesId: item.seriesId,
      });

      outcomes.push({ seriesId: item.seriesId, title: item.title, createdTaskId: created.id });
    } catch (error) {
      /* ⚠️ One series' failure must not abandon the rest — the same call
         app/api/schedule/route.ts already made about one project's failure.
         Reported in the response body so it is visible rather than silent. */
      console.error('[repeats] series failed', item.seriesId, error);
      outcomes.push({
        seriesId: item.seriesId,
        title: item.title,
        createdTaskId: null,
        skipped: 'failed to create',
      });
    }
  }

  return outcomes;
}
