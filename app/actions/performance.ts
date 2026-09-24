'use server';

import { requireRole, requireUser } from '@/lib/auth/current-user';
import {
  completedInWindow,
  dailyTaskForms,
  taskLedgerDetail,
  type LedgerDetail,
  performanceBoard,
  personDetail,
  type FormTaskRow,
  type PersonDetail,
  type PersonStat,
} from '@/lib/db/queries/performance';
import { companyLetterhead } from '@/lib/db/queries/invoices';
import {
  composeTaskAssignmentForms,
  type FormRow,
  type TaskFormSheet,
} from '@/lib/pdf/task-assignment-form';
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
    const sheet = await buildFactSheet(user.id, allowedScope(scope, user));
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

/**
 * Who is asking, and how wide their answer may be.
 *
 * ⚠️ A MEMBER MAY ASK, BUT ONLY ABOUT THEMSELVES. Owner, 2026-09-23: *"all
 * the other team members can view their own performance only."* Their scope is
 * overwritten with their own id here, so a crafted `personId` naming somebody
 * else is ignored — a server action is a public endpoint, and the page hiding a
 * dropdown protects nothing on its own.
 */
async function requireRoleAndUser() {
  const user = await requireUser();
  if (user.role !== 'member') await requireRole('team_coordinator');
  return { user, ownOnly: user.role === 'member' };
}

/** The scope this caller is allowed, whatever they asked for. */
function allowedScope<T extends { personId?: string | null }>(
  scope: T,
  user: { id: string; role: string },
): T {
  return user.role === 'member' ? { ...scope, personId: user.id } : scope;
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
  const { user, ownOnly } = await requireRoleAndUser();
  /* ⚠️ A MEMBER OPENS THEMSELVES, whichever id arrived. */
  const who = ownOnly ? user.id : personId;
  try {
    const [detail, previousCompleted] = await Promise.all([
      personDetail(user.id, who, period),
      completedInWindow(user.id, previousWindow(period.from, period.to), who),
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


/* ============================================================================
 * THE DAILY TASK ASSIGNMENT FORM — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"Every person can download or export their daily task in this template from
 * the performance page ... you will show that today's tasks are: these ones are
 * completed, these are left, these are overdue."*
 *
 * ── ⚠️ THE SCOPE IS THE CALLER'S, NOT THE ARGUMENT'S ─────────────────────
 * A Member exports themselves whatever the request says — the same override the
 * page applies, repeated here because a server action is a public endpoint.
 * ========================================================================= */

export interface FormExport {
  readonly ok: boolean;
  readonly error?: string;
  readonly base64?: string;
  readonly sheets?: number;
  readonly fileName?: string;
}

/** The paper form offers three boxes; the system has four priorities. */
const PRIORITY_BOX: Record<string, 'High' | 'Medium' | 'Low'> = {
  urgent: 'High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_WORD: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * How a row reads in "Progress on Task".
 *
 * ⚠️ OVERDUE IS A FACT ABOUT THE DAY, NOT A STATUS. Nothing in the database is
 * "overdue" — it is open with a due date that has passed, judged against the
 * day the sheet is for. The owner asked for that word on the sheet, so it is
 * computed here rather than looked up.
 */
function progressOf(row: FormTaskRow, day: string): { progress: string; tone: FormRow['tone'] } {
  if (row.status === 'done') {
    return { progress: row.completedOn === day ? 'Completed today' : 'Completed', tone: 'green' };
  }
  if (row.status === 'cancelled') return { progress: 'Cancelled', tone: 'grey' };
  if (row.dueDate && row.dueDate < day) return { progress: 'Overdue', tone: 'red' };
  if (row.status === 'blocked') return { progress: 'Blocked', tone: 'red' };
  if (row.status === 'in_review') return { progress: 'In review', tone: 'amber' };
  if (row.status === 'in_progress') return { progress: 'In progress', tone: 'amber' };
  if (row.status === 'revisions') return { progress: 'In revision', tone: 'amber' };
  return { progress: 'Not started', tone: 'amber' };
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const shortDay = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      })
    : '-';

/** A whole month of sheets for sixteen people is already ~500 pages. */
const MAX_DAYS = 31;

export async function exportTaskFormsAction(scope: {
  from: string;
  to: string;
  personId?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
}): Promise<FormExport> {
  const { user, ownOnly } = await requireRoleAndUser();

  const from = scope.from;
  const span = Math.round(
    (Date.parse(`${scope.to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(span) || span < 0) {
    return { ok: false, error: 'That date range is not valid.' };
  }
  if (span + 1 > MAX_DAYS) {
    return {
      ok: false,
      error: `That range is ${span + 1} days. Export up to ${MAX_DAYS} days at a time — a longer range makes a document nobody can read.`,
    };
  }

  try {
    const [forms, company] = await Promise.all([
      dailyTaskForms(
        user.id,
        { from, to: scope.to },
        {
          personId: ownOnly ? user.id : (scope.personId ?? null),
          departmentId: ownOnly ? null : (scope.departmentId ?? null),
          projectId: scope.projectId ?? null,
        },
      ),
      companyLetterhead(user.id),
    ]);

    /* ⚠️ A PERSON-DAY WITH NO TASKS GETS NO SHEET. `dailyTaskForms` only returns
       days that have rows, so an empty Sunday is absent rather than printed as
       a blank form somebody has to throw away. */
    const sheets: TaskFormSheet[] = forms.map((f) => {
      const rows: FormRow[] = f.rows.map((r) => {
        const p = progressOf(r, f.day);
        return {
          reference: `${r.reference}  ·  ${r.projectName}`,
          description: r.title,
          /* One task has exactly one assigner — the owner's point. When that is
             the person themselves, say so instead of printing their own name. */
          assignedBy: r.selfRaised ? 'Self' : (r.assignedByName ?? '-'),
          priority: PRIORITY_WORD[r.priority] ?? r.priority,
          startDate: shortDay(r.startDate),
          endDate: shortDay(r.dueDate),
          progress: p.progress,
          tone: p.tone,
        };
      });

      const given = f.rows.filter((r) => !r.selfRaised && r.assignedByName);
      const names = [...new Set(given.map((r) => r.assignedByName as string))];
      /* The header's single "Assigned By" holds when a day came from one person;
         when it did not, the rows carry it and the header says so. */
      const assignedBy =
        names.length === 1
          ? names[0]
          : names.length === 0
            ? 'Self-raised'
            : `Various (${names.length} people - see rows)`;

      const boxes = [...new Set(f.rows.map((r) => PRIORITY_BOX[r.priority]).filter(Boolean))];
      const order: Array<'High' | 'Medium' | 'Low'> = ['High', 'Medium', 'Low'];
      const priority = order.find((b) => boxes.includes(b)) ?? null;

      const completed = f.rows.filter((r) => r.status === 'done').length;
      const overdue = f.rows.filter(
        (r) => r.status !== 'done' && r.status !== 'cancelled' && r.dueDate && r.dueDate < f.day,
      ).length;
      const remaining = f.rows.filter(
        (r) => r.status !== 'done' && r.status !== 'cancelled',
      ).length;

      return {
        name: f.personName,
        department: f.department ?? '-',
        designation: f.designation ?? '-',
        assignedBy,
        assignedDate: dayLabel(f.day),
        priority,
        dayLabel: dayLabel(f.day),
        rows,
        completed,
        remaining,
        overdue,
      };
    });

    if (sheets.length === 0) {
      return {
        ok: false,
        error: 'Nothing was due, completed or outstanding in that range, so there is no form to print.',
      };
    }

    const bytes = await composeTaskAssignmentForms({
      company,
      generatedFor: user.fullName,
      generatedAt: new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date()),
      sheets,
    });

    const one = sheets.length === 1 ? `-${sheets[0].name.replace(/\s+/g, '-')}` : '';
    return {
      ok: true,
      base64: Buffer.from(bytes).toString('base64'),
      sheets: sheets.length,
      fileName: `task-assignment-form${one}-${from}${from === scope.to ? '' : `_to_${scope.to}`}.pdf`,
    };
  } catch (error) {
    console.error('[performance] task form export failed', error);
    return { ok: false, error: 'The form could not be made. Nothing was changed.' };
  }
}


/* ── One task, for the ledger's right-hand panel ─────────────────────────── */

export interface LedgerDetailPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly detail?: LedgerDetail;
}

/**
 * The timeline, files and comments for one task.
 *
 * ⚠️ THE ONLY THING THE LEDGER FETCHES ON A CLICK. Everything the row shows is
 * already on the page; this is the part a row genuinely could not know (Rule
 * Zero, law 3). RLS decides whether the caller may see the task at all, so a
 * crafted id returns somebody else's task only if they could already open it.
 */
export async function taskLedgerDetailAction(taskId: string): Promise<LedgerDetailPayload> {
  const { user } = await requireRoleAndUser();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return { ok: false, error: 'That task id is not valid.' };
  }
  try {
    return { ok: true, detail: await taskLedgerDetail(user.id, taskId) };
  } catch (error) {
    console.error('[performance] ledger detail failed', error);
    return { ok: false, error: 'That task could not be read.' };
  }
}
