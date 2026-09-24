'use server';

import { requireRole, requireUser } from '@/lib/auth/current-user';
import {
  addCheckin,
  addGoalComment,
  createGoal,
  goalActivity,
  goalsFor,
  setGoalStatus,
  updateGoal,
  type Goal,
  type GoalCheckin,
  type GoalComment,
  type GoalStatus,
} from '@/lib/db/queries/goals';
import {
  reviewCounts,
  reviewDetail,
  reviewQueue,
  setRevisionDue,
  type ReviewDetail,
} from '@/lib/db/queries/reviews';

/* ============================================================================
 * GOALS AND REVIEWS — the writes behind the two newest tabs
 * ----------------------------------------------------------------------------
 * ⚠️ THE SCOPE OVERRIDE IS REPEATED ON EVERY ACTION, as it is throughout
 * `app/actions/performance.ts`. A server action is a public endpoint and the
 * page hiding a control protects nothing on its own.
 *
 * ⚠️ AND WHERE THE RULE IS ABOUT WHO MAY WRITE RATHER THAN WHO MAY READ, it
 * is NOT expressed by forcing the subject to the caller. Forcing it would let
 * somebody set their own target, which is the one thing these tables exist to
 * prevent. Those actions refuse instead, and the policies refuse again.
 * ========================================================================= */

async function requireRoleAndUser() {
  const user = await requireUser();
  if (user.role !== 'member') await requireRole('team_coordinator');
  return { user, ownOnly: user.role === 'member' };
}

/** The database's own sentence where it wrote one, not a guessed cause. */
function say(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/goal|target|check-in|comment|does not exist/i.test(message)) return message;
  return fallback;
}

/* ── Goals ───────────────────────────────────────────────────────────────── */

export interface GoalsPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly goals?: readonly Goal[];
  readonly checkins?: readonly GoalCheckin[];
  readonly comments?: readonly GoalComment[];
}

/** Re-read after every write, so the page never guesses what the row now holds. */
async function goalsPayload(actorId: string, personId: string): Promise<GoalsPayload> {
  const [goals, activity] = await Promise.all([
    goalsFor(actorId, personId),
    goalActivity(actorId, personId),
  ]);
  return { ok: true, goals, checkins: activity.checkins, comments: activity.comments };
}

export async function goalsAction(personId: string): Promise<GoalsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  try {
    return await goalsPayload(user.id, ownOnly ? user.id : personId);
  } catch (error) {
    console.error('[goals] read failed', error);
    return { ok: false, error: 'Those goals could not be read.' };
  }
}

export interface GoalForm {
  readonly subjectId: string;
  readonly goalId?: string | null;
  readonly title: string;
  readonly baseline: number;
  readonly target: number;
  readonly unit: string;
  readonly measure: string;
  readonly dueDate: string | null;
  readonly nextCheckinOn: string | null;
  readonly actions: readonly string[];
  readonly projectId: string | null;
}

export async function saveGoalAction(form: GoalForm): Promise<GoalsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  if (ownOnly) {
    return { ok: false, error: 'Only a coordinator, admin or super admin sets a goal.' };
  }
  if (form.subjectId === user.id) {
    return { ok: false, error: 'A goal is agreed with somebody else, not set for yourself.' };
  }
  const title = form.title.trim();
  if (!title) return { ok: false, error: 'A goal needs a title.' };

  const tidy = {
    title: title.slice(0, 300),
    baseline: Number.isFinite(form.baseline) ? form.baseline : 0,
    target: Number.isFinite(form.target) ? form.target : 0,
    unit: form.unit.trim().slice(0, 16),
    measure: form.measure.trim().slice(0, 500),
    dueDate: form.dueDate || null,
    nextCheckinOn: form.nextCheckinOn || null,
    actions: form.actions.map((a) => a.trim()).filter(Boolean).slice(0, 12),
    projectId: form.projectId || null,
  };

  try {
    if (form.goalId) await updateGoal(user.id, form.goalId, tidy);
    else await createGoal(user.id, { ...tidy, subjectId: form.subjectId });
    return await goalsPayload(user.id, form.subjectId);
  } catch (error) {
    console.error('[goals] save failed', error);
    return { ok: false, error: say(error, 'That goal could not be saved.') };
  }
}

export async function setGoalStatusAction(
  goalId: string,
  status: GoalStatus,
  subjectId: string,
): Promise<GoalsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  if (ownOnly) {
    return { ok: false, error: 'Only a coordinator, admin or super admin moves a goal.' };
  }
  try {
    const moved = await setGoalStatus(user.id, goalId, status);
    if (!moved) return { ok: false, error: 'That goal could not be found.' };
    return await goalsPayload(user.id, subjectId);
  } catch (error) {
    console.error('[goals] status failed', error);
    return { ok: false, error: say(error, 'That goal could not be moved.') };
  }
}

/**
 * A check-in.
 *
 * ⚠️ THE PERSON DOING THE WORK MAY REPORT ON IT, which is why this one has no
 * rank check: the policy admits the subject and a manager and nobody else, and
 * the trigger forces the row onto the goal's own subject whatever is sent.
 */
export async function addCheckinAction(input: {
  goalId: string;
  subjectId: string;
  note: string;
  value: number | null;
  evidenceLabel: string;
  evidenceUrl: string;
  onDate: string | null;
}): Promise<GoalsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  const who = ownOnly ? user.id : input.subjectId;
  const note = input.note.trim();
  if (!note) return { ok: false, error: 'A check-in needs a progress note.' };

  try {
    await addCheckin(user.id, {
      goalId: input.goalId,
      note: note.slice(0, 2000),
      value: input.value !== null && Number.isFinite(input.value) ? input.value : null,
      evidenceLabel: input.evidenceLabel.trim().slice(0, 200),
      evidenceUrl: input.evidenceUrl.trim().slice(0, 2000),
      onDate: input.onDate || null,
    });
    return await goalsPayload(user.id, who);
  } catch (error) {
    console.error('[goals] check-in failed', error);
    return { ok: false, error: say(error, 'That check-in could not be saved.') };
  }
}

export async function addGoalCommentAction(input: {
  goalId: string;
  subjectId: string;
  body: string;
  parentId: string | null;
}): Promise<GoalsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  const who = ownOnly ? user.id : input.subjectId;
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'A comment needs something in it.' };

  try {
    await addGoalComment(user.id, input.goalId, body.slice(0, 4000), input.parentId);
    return await goalsPayload(user.id, who);
  } catch (error) {
    console.error('[goals] comment failed', error);
    return { ok: false, error: say(error, 'That comment could not be saved.') };
  }
}

/* ── Reviews ─────────────────────────────────────────────────────────────── */

export interface ReviewsPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly queue?: Awaited<ReturnType<typeof reviewQueue>>;
  readonly counts?: Awaited<ReturnType<typeof reviewCounts>>;
}

export async function reviewsAction(personId: string): Promise<ReviewsPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  const who = ownOnly ? user.id : personId;
  try {
    const [queue, counts] = await Promise.all([
      reviewQueue(user.id, who),
      reviewCounts(user.id, who),
    ]);
    return { ok: true, queue, counts };
  } catch (error) {
    console.error('[reviews] read failed', error);
    return { ok: false, error: 'That review queue could not be read.' };
  }
}

export interface ReviewDetailPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly detail?: ReviewDetail;
}

export async function reviewDetailAction(taskId: string): Promise<ReviewDetailPayload> {
  const { user } = await requireRoleAndUser();
  try {
    return { ok: true, detail: await reviewDetail(user.id, taskId) };
  } catch (error) {
    console.error('[reviews] detail failed', error);
    return { ok: false, error: 'That submission could not be read.' };
  }
}

/** The date the revised work is wanted by — the task's own due date. */
export async function setRevisionDueAction(
  taskId: string,
  dueDate: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { ownOnly } = await requireRoleAndUser();
  if (ownOnly) return { ok: false, error: 'Only a reviewer moves a revision date.' };
  try {
    const moved = await setRevisionDue((await requireUser()).id, taskId, dueDate || null);
    return moved ? { ok: true } : { ok: false, error: 'That task could not be found.' };
  } catch (error) {
    console.error('[reviews] revision date failed', error);
    return { ok: false, error: 'That date could not be saved.' };
  }
}
