'use server';

import { requireRole, requireUser } from '@/lib/auth/current-user';
import {
  completedInWindow,
  performanceBoard,
  personDetail,
  type PersonDetail,
  type PersonStat,
} from '@/lib/db/queries/performance';
import { writeNarrative, type Narrative } from '@/lib/ai/narrative';
import {
  dayAccount,
  deadlineMoves,
  isSlip,
  onTime,
  qualityOfWork,
  rate,
  trend,
  type Move,
} from '@/lib/domain/performance';
import { isoDateIn, nowMs } from '@/lib/now';

/* ============================================================================
 * TEAM PERFORMANCE — the writes and the asks
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-23: *"Plus here I also want AI assessments. By giving all this
 * information to AI … ask them to give an analysis or a report-type analysis …
 * how it is going, how it should be, and what things it should do next."*
 *
 * ── ⚠️ THE MODEL IS GIVEN THE FIGURES; IT NEVER COMPUTES THEM ─────────────
 * Everything below hands `writeNarrative` a fact sheet that is already totalled,
 * and that module's own rules forbid arithmetic and report any number in the
 * reply that is not in the sheet (`unverifiedFigures`). That matters more here
 * than on the CEO report: this page is read as a judgement about a named person,
 * and a fluent wrong number would end up in a conversation about their work.
 *
 * ── ⚠️ AND IT SAYS WHAT IS NOT MEASURED ───────────────────────────────────
 * The fact sheet states the gaps in the data — no logged hours, no leave
 * recorded, no rework recorded — so the model describes them rather than
 * quietly treating a missing number as a zero. A performance page that implies
 * somebody did nothing because nothing was recorded is the worst failure this
 * screen can have.
 * ========================================================================= */

export interface PerformanceInsight {
  readonly ok: boolean;
  readonly error?: string;
  readonly narrative?: Narrative;
  /** The sheet the model was given, so a reader can check its working. */
  readonly factSheet?: string;
}

export interface InsightScope {
  readonly from: string;
  readonly to: string;
  /** A named person, or null for the whole team. */
  readonly personId?: string | null;
  /**
   * What the manager typed into the ask box, or one of the four quick prompts.
   *
   * ⚠️ IT IS APPENDED TO THE FACT SHEET, NOT SENT AS A SECOND TURN. The sheet
   * is the only thing `verifyFigures` reads the reply back against, so a
   * question carried outside it would let the model answer with a figure this
   * page could not check. It is also truncated: the box is a question, not a
   * channel for pasting a prompt at somebody else's model.
   */
  readonly question?: string | null;
}

export async function performanceInsightAction(scope: InsightScope): Promise<PerformanceInsight> {
  const { user } = await requireRoleAndUser();
  try {
    const sheet = await buildFactSheet(user.id, scope);
    const narrative = await writeNarrative(sheet);
    return { ok: true, narrative, factSheet: sheet };
  } catch (error) {
    console.error('[performance] insight failed', error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message.includes('CHATGPT_API_KEY')
          ? 'The AI key is not configured, so the written assessment is unavailable. Every figure on this page is still read from the database.'
          : 'The written assessment could not be produced. Every figure on this page is still read from the database.',
    };
  }
}

async function requireRoleAndUser() {
  /* ⚠️ A COORDINATOR'S FLOOR, and RLS decides the rest. Somebody below that has
     no business reading a page about other people's work; what a Coordinator
     then sees inside it is narrowed by the same policies the task board uses. */
  await requireRole('team_coordinator');
  const user = await requireUser();
  return { user };
}

/**
 * Everything the model is allowed to know, in plain sentences.
 *
 * ⚠️ WRITTEN AS PROSE, NOT JSON. `verifyFigures` reads the reply back against
 * this text, so a figure that appears here as "24" is verifiable and one hidden
 * inside a nested object is not.
 */
async function buildFactSheet(actorId: string, scope: InsightScope): Promise<string> {
  const today = isoDateIn();
  const period = { from: scope.from, to: scope.to, today };
  const previous = previousWindow(scope.from, scope.to);

  const [board, before, detail] = await Promise.all([
    performanceBoard(actorId, period),
    completedInWindow(actorId, previous, scope.personId ?? null),
    scope.personId ? personDetail(actorId, scope.personId, period) : Promise.resolve(null),
  ]);

  const lines: string[] = [];
  lines.push(`PERIOD: ${scope.from} to ${scope.to} (Asia/Karachi). Today is ${today}.`);

  if (scope.personId && detail) {
    const person = board.find((p) => p.id === scope.personId);
    lines.push(...personSheet(person, detail, scope, before));
  } else {
    lines.push(...teamSheet(board, before));
  }

  /* ── ⚠️ THE GAPS, STATED — see the header ─────────────────────────────── */
  lines.push('');
  lines.push('NOT RECORDED IN THIS SYSTEM (do not treat any of these as zero):');
  lines.push('- Hours worked. No timer entries exist, so effort is measured in estimate points and attendance days only.');
  lines.push('- Leave and availability. Nothing is recorded, so absence cannot be distinguished from a quiet week.');
  lines.push('- Reasons for a missed deadline. Deadline CHANGES are recorded with who made them; the cause is not.');
  lines.push('- Written review feedback. Almost no comments exist, so quality cannot be judged from what reviewers said.');

  const question = (scope.question ?? '').trim().slice(0, 400);
  if (question) {
    lines.push('');
    lines.push(`THE MANAGER ASKS: ${question}`);
    lines.push(
      'Answer that question directly in headline and summary, using only the figures above. ' +
        'If the fact sheet does not contain what the question needs, say plainly that it is not recorded. ' +
        'Fill strengths, risks and recommendations as usual.',
    );
  }

  return lines.join('\n');
}

function teamSheet(board: readonly PersonStat[], before: number): string[] {
  const completed = board.reduce((n, p) => n + p.completed, 0);
  const reviewed = board.reduce((n, p) => n + p.reviewed, 0);
  const onTimeCount = board.reduce((n, p) => n + p.onTime, 0);
  const judged = board.reduce((n, p) => n + p.judged, 0);
  const overdue = board.reduce((n, p) => n + p.overdue, 0);
  const awaiting = board.reduce((n, p) => n + p.awaitingReview, 0);
  const t = trend(completed, before);
  const otRate = rate(onTimeCount, judged);

  const lines = [
    '',
    'THE TEAM IN THIS PERIOD:',
    `- Tasks completed: ${completed}.`,
    `- Of those, ${reviewed} went through review; ${completed - reviewed} were closed by the person who did them.`,
    judged > 0
      ? `- On time: ${onTimeCount} of ${judged} tasks that had a deadline (${otRate.value}%). Tasks with no deadline are not judged.`
      : '- On time: no completed task in this period had a deadline, so on-time delivery is not measurable.',
    `- Open and past their due date right now: ${overdue}.`,
    `- Waiting on a reviewer right now: ${awaiting}.`,
    t.changePct === null
      ? `- The previous period completed ${before}, so no percentage change is meaningful.`
      : `- The previous period completed ${before}; the change is ${t.changePct}%.`,
    '',
    'BY PERSON (completed, reviewed, on time of judged, overdue now):',
  ];
  for (const p of board) {
    if (p.completed === 0 && p.openNow === 0) continue;
    lines.push(
      `- ${p.name}${p.roleTitle ? ` (${p.roleTitle})` : ''}: completed ${p.completed}, reviewed ${p.reviewed}, on time ${p.onTime} of ${p.judged}, overdue ${p.overdue}, open ${p.openNow}.`,
    );
  }
  return lines;
}

function personSheet(
  person: PersonStat | undefined,
  detail: PersonDetail,
  scope: InsightScope,
  before: number,
): string[] {
  const name = person?.name ?? 'This person';
  /* ⚠️ Narrowed to the tasks in this period — see the same note in
     components/performance/person-drawer.tsx. The fact sheet must not hand the
     model two denominators from two different periods. */
  const inPeriod = new Set(detail.tasks.map((t) => t.id));
  const byTask = new Map<string, Move[]>();
  for (const m of detail.moves) {
    if (!inPeriod.has(m.taskId)) continue;
    const list = byTask.get(m.taskId) ?? [];
    list.push(m);
    byTask.set(m.taskId, list);
  }
  const quality = qualityOfWork(byTask);
  const timing = onTime(detail.tasks);
  const moves = deadlineMoves(
    detail.history.map((h) => ({
      taskId: h.taskId ?? '',
      action: h.action,
      actorId: null,
      at: h.at,
      before: h.before,
      after: h.after,
    })),
  );
  const slips = moves.filter(isSlip).length;
  const t = trend(person?.completed ?? 0, before);
  const today = isoDateIn();
  const day = dayAccount(
    detail.tasks.map((x) => ({
      dueDate: x.dueDate,
      status: x.status,
      completedOn: x.completedOn,
      createdOn: x.createdOn,
      assignedOn: null,
    })),
    today,
  );

  return [
    '',
    `THE PERSON: ${name}${person?.roleTitle ? `, ${person.roleTitle}` : ''}.`,
    `- Tasks completed in the period: ${person?.completed ?? 0}.`,
    `- Open right now: ${person?.openNow ?? 0}, of which ${person?.overdue ?? 0} are past their due date.`,
    timing.judged > 0
      ? `- On time: ${timing.onTime} of ${timing.judged} tasks that had a deadline; ${timing.late} were late.`
      : '- On time: none of their completed tasks had a deadline, so on-time delivery is not measurable.',
    `- Went through review: ${quality.reviewed} of ${quality.completed} completed tasks.`,
    quality.reviewed > 0
      ? `- Approved on the first submission: ${quality.firstPass}. Sent back for changes: ${quality.sentBack}. Submitted more than once: ${quality.resubmitted}. Reopened after being closed: ${quality.reopened}.`
      : '- No task of theirs went through review in this period, so first-pass approval cannot be measured.',
    `- Deadlines moved on their work: ${moves.length}, of which ${slips} gave the work more time.`,
    `- Recorded actions in the log: ${detail.history.length}. Attendance days present: ${detail.daysPresent}.`,
    `- Today (${today}): ${day.planned} planned, ${day.unexpected} arrived today, ${day.completed} finished, ${day.unfinished} still open, ${day.carriedForward} carried over from earlier days.`,
    t.changePct === null
      ? `- The previous period completed ${before}, so no percentage change is meaningful.`
      : `- The previous period completed ${before}; the change is ${t.changePct}%.`,
    `- Effort points completed: ${person?.effortPoints ?? 0}, against a weekly capacity of ${person?.weeklyCapacityPoints ?? 0} points.`,
  ];
}

/** The window of the same length immediately before this one. */
function previousWindow(from: string, to: string): { from: string; to: string } {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const span = Math.max(b - a, 0) + 86_400_000;
  return {
    from: new Date(a - span).toISOString().slice(0, 10),
    to: new Date(b - span).toISOString().slice(0, 10),
  };
}

/* ── The person drawer's own read, so opening somebody is one round trip ── */

export interface PersonPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly detail?: PersonDetail;
  readonly previousCompleted?: number;
}

export async function personPerformanceAction(
  personId: string,
  period: { from: string; to: string },
): Promise<PersonPayload> {
  const { user } = await requireRoleAndUser();
  try {
    const [detail, previousCompleted] = await Promise.all([
      personDetail(user.id, personId, period),
      completedInWindow(user.id, previousWindow(period.from, period.to), personId),
    ]);
    return { ok: true, detail, previousCompleted };
  } catch (error) {
    console.error('[performance] person read failed', error);
    return { ok: false, error: 'That person’s record could not be read.' };
  }
}

/** So the clock is the server's — `nowMs` is not importable from a client file. */
export async function performanceNowAction(): Promise<{ nowMs: number; today: string }> {
  await requireRoleAndUser();
  return { nowMs: nowMs(), today: isoDateIn() };
}
