import { PRIORITY_LABEL, STATUS_META, type Priority, type TaskStatus } from './constants';

/* ============================================================================
 * THE DAILY DIGEST — FR-081
 * ----------------------------------------------------------------------------
 * What one person needs to know this morning, composed from rows handed in.
 *
 * ── IT SENDS NOTHING WHEN THERE IS NOTHING ───────────────────────────────────
 * The single most important rule here. A digest that arrives every morning
 * saying "0 overdue, 0 due today, nothing waiting on you" trains people to
 * delete it unread within a fortnight — and then the one that matters is
 * deleted too. `isWorthSending` is what stops that, and it is checked before a
 * message is even composed.
 *
 * ── IT IS ORDERED BY WHAT WILL GO WRONG SOONEST ──────────────────────────────
 * Overdue, then due today, then blocked, then waiting on you, then due this
 * week. Not by project, not alphabetically, not by when it was created. The
 * point of a morning email is the first three lines.
 * ========================================================================= */

export interface DigestTask {
  readonly reference: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate: string | null;
  readonly projectName: string;
}

export interface DigestInput {
  readonly fullName: string;
  /** `YYYY-MM-DD` in the team's timezone, decided by the caller. */
  readonly today: string;
  readonly assigned: readonly DigestTask[];
  /** Things in review that this person is expected to look at. */
  readonly awaitingYourReview: readonly DigestTask[];
  /** Extension requests waiting on this person. Admins only. */
  readonly pendingExtensions: number;
  /** Their projected utilisation for the week, if they may see it. */
  readonly utilisationPct: number | null;
}

export interface Digest {
  readonly overdue: readonly DigestTask[];
  readonly dueToday: readonly DigestTask[];
  readonly blocked: readonly DigestTask[];
  readonly awaitingYourReview: readonly DigestTask[];
  readonly dueThisWeek: readonly DigestTask[];
  readonly pendingExtensions: number;
  readonly utilisationPct: number | null;
  /** The one-line summary, and the email's subject. */
  readonly headline: string;
  readonly isWorthSending: boolean;
}

const OPEN: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'revisions',
]);

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

export function buildDigest(input: DigestInput): Digest {
  const open = input.assigned.filter((task) => OPEN.has(task.status));

  const overdue = open.filter(
    (task) => task.dueDate !== null && daysBetween(input.today, task.dueDate) < 0,
  );
  const dueToday = open.filter((task) => task.dueDate === input.today);

  /* Blocked tasks that are also overdue appear once, in the overdue list. The
     same task in three sections makes a short digest look long and a long one
     unreadable. */
  const counted = new Set([...overdue, ...dueToday].map((task) => task.reference));

  const blocked = open.filter(
    (task) => task.status === 'blocked' && !counted.has(task.reference),
  );
  for (const task of blocked) counted.add(task.reference);

  const dueThisWeek = open.filter((task) => {
    if (task.dueDate === null || counted.has(task.reference)) return false;
    const days = daysBetween(input.today, task.dueDate);
    return days > 0 && days <= 7;
  });

  const total =
    overdue.length +
    dueToday.length +
    blocked.length +
    input.awaitingYourReview.length +
    input.pendingExtensions;

  return {
    overdue: sort(overdue),
    dueToday: sort(dueToday),
    blocked: sort(blocked),
    awaitingYourReview: sort(input.awaitingYourReview),
    dueThisWeek: sort(dueThisWeek),
    pendingExtensions: input.pendingExtensions,
    utilisationPct: input.utilisationPct,
    headline: headline({
      overdue: overdue.length,
      dueToday: dueToday.length,
      blocked: blocked.length,
      reviews: input.awaitingYourReview.length,
      extensions: input.pendingExtensions,
      thisWeek: dueThisWeek.length,
    }),
    /* `dueThisWeek` alone is not worth an email. Something due on Friday is not
       news on Monday, and it will be news on Thursday. */
    isWorthSending: total > 0,
  };
}

/** Urgent first, then by due date, then by reference so the order is stable. */
function sort(tasks: readonly DigestTask[]): DigestTask[] {
  const rank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return [...tasks].sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.reference.localeCompare(b.reference),
  );
}

function headline(counts: {
  overdue: number;
  dueToday: number;
  blocked: number;
  reviews: number;
  extensions: number;
  thisWeek: number;
}): string {
  /* Named in the order they will hurt. The subject line is most of what gets
     read, so it says the worst thing first rather than summing everything into
     an undifferentiated "6 items". */
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
  if (counts.dueToday > 0) parts.push(`${counts.dueToday} due today`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.reviews > 0) parts.push(`${counts.reviews} to review`);
  if (counts.extensions > 0) {
    parts.push(`${counts.extensions} extension request${counts.extensions === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return counts.thisWeek > 0 ? `${counts.thisWeek} due this week` : 'Nothing needs you';
  }
  return parts.join(' · ');
}

/* ==========================================================================
 * PLAIN TEXT
 * ========================================================================== */

/**
 * The text body, used as the email's plain alternative.
 *
 * Composed here rather than in the template so it can be tested without a mail
 * provider, and so the HTML and the text cannot say different things — they are
 * generated from the same digest object.
 */
export function digestText(digest: Digest, fullName: string, appUrl: string): string {
  const lines: string[] = [`Morning ${fullName.split(' ')[0]},`, ''];

  const section = (title: string, tasks: readonly DigestTask[]) => {
    if (tasks.length === 0) return;
    lines.push(`${title.toUpperCase()} (${tasks.length})`);
    for (const task of tasks) {
      lines.push(
        `  ${task.reference}  ${task.title}` +
          `${task.dueDate ? `  — due ${task.dueDate}` : ''}` +
          `  [${PRIORITY_LABEL[task.priority]} · ${STATUS_META[task.status].label}]`,
      );
    }
    lines.push('');
  };

  section('Overdue', digest.overdue);
  section('Due today', digest.dueToday);
  section('Blocked', digest.blocked);
  section('Waiting for your review', digest.awaitingYourReview);
  section('Due this week', digest.dueThisWeek);

  if (digest.pendingExtensions > 0) {
    lines.push(
      `${digest.pendingExtensions} extension request${digest.pendingExtensions === 1 ? '' : 's'} waiting on you.`,
      '',
    );
  }

  if (digest.utilisationPct !== null) {
    lines.push(`You are at ${digest.utilisationPct}% of your capacity this week.`, '');
  }

  lines.push(appUrl, '', 'Turn this off under Profile → What reaches you.');
  return lines.join('\n');
}
