'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { can } from '@/lib/domain/permissions';
import { isoDateIn } from '@/lib/now';
import { generateForProject } from '@/lib/schedule/run';

import type { ActionResult } from './tasks';

/* ============================================================================
 * GENERATE THE MONTH'S CONTENT TASKS — owner request 2026-08-22
 * ----------------------------------------------------------------------------
 * *"daily tasks should be automatically created, and these things should be
 * properly working."*
 *
 * The arithmetic is in `lib/domain/schedule.ts` and is pure. The work is in
 * `lib/schedule/run.ts` and is shared with the nightly route. What is left here
 * is the only thing unique to a person pressing a button: proving who they are
 * and that they are allowed.
 *
 * ── ⚠️ WHY A BUTTON EXISTS AT ALL, GIVEN THIS IS MEANT TO BE AUTOMATIC ───────
 * Because a Vercel cron cannot fire on a laptop. An automation that only ever
 * runs in production cannot be demonstrated, corrected or trusted before it is
 * deployed — the first time anyone would see its output is on the live system.
 *
 * ── PERMISSION: `task.create_for_other` ──────────────────────────────────────
 * Not `task.create_in_project`, which a Member holds inside their own projects.
 * Generating a month creates work nobody has volunteered for, which is planning
 * — the Coordinator's job (doc 03 §3.3). `task.create_for_other` already means
 * exactly "may create work that is not their own": allowed to Coordinator and
 * above, denied to Member. Reusing it keeps one answer to that question.
 * ========================================================================= */

const fail = (error: string): ActionResult => ({ ok: false, error });

/** Today in the division's own zone. Was UTC, which meant that between midnight
 *  and 5am local this button filled yesterday. See `isoDateIn`. */
const todayIso = () => isoDateIn();

/** Last date of the month a 'YYYY-MM-01' string names. Day 0 of the next month,
 *  the same trick `cadence.ts` uses, for the same reason. */
function monthEnd(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthStart.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export async function generateScheduleAction(
  projectId: string,
  monthStart: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (!can({ id: user.id, role: user.role }, 'task.create_for_other')) {
    return fail('Only a Coordinator or above can generate a schedule.');
  }

  const today = todayIso();
  const end = monthEnd(monthStart);

  /* Never backdate. See the note in lib/domain/schedule.ts: filling days that
     have already passed manufactures overdue work nobody was asked to do. For a
     future month `today` is earlier than the 1st, so the whole month fills. */
  const from = today > monthStart ? today : monthStart;

  if (from > end) {
    return fail('That month is already over — there is nothing left in it to schedule.');
  }

  const outcome = await generateForProject(user.id, projectId, from, end);

  if (outcome.skipped === 'not visible') {
    return fail('That project does not exist, or you cannot see it.');
  }
  if (outcome.skipped === 'no posting rhythm set') {
    return fail('This project has no posting rhythm set. Add one under Edit project first.');
  }
  if (outcome.skipped) {
    return fail(`The posting rhythm needs fixing first — ${outcome.skipped}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/tasks');
  revalidatePath('/my-work');

  return {
    ok: true,
    warning:
      outcome.created === 0
        ? 'Already up to date — nothing to add.'
        : `Added ${outcome.created} ${outcome.created === 1 ? 'task' : 'tasks'}.`,
  };
}
