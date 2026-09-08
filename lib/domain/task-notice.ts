import type { TaskStatus } from './constants';

/* ============================================================================
 * WHAT A TASK NOTIFICATION SAYS
 * ----------------------------------------------------------------------------
 * LAYER 2. Pure: no database, no clock, no framework.
 *
 * ── ⚠️ NO REFERENCE CODES — owner, 2026-09-08 ───────────────────────────────
 *   *"The notification should mention the task name. I don't understand that
 *   code… Don't mention those codes to the team, super admin, or admin. We
 *   should only know the project name. We only know the task relevant to any
 *   project."*
 *
 * Every notification used to lead with `CLI-091` or `BIZ-017`. The code is a
 * database convenience — a stable handle for a row — and it was leaking into
 * the one place in the product read by people who have no reason to know it. A
 * notification is read in two seconds, out of context, often on a phone; "BIZ-17
 * — In Review" asks the reader to translate before they can care.
 *
 * So a notice is built from two things people already hold in their heads: WHAT
 * the task is called, and WHICH project it belongs to. The code stays in the
 * database, on the task page and in the activity log, where it is doing a job.
 *
 * ── WHY THIS IS A MODULE AND NOT NINE TEMPLATE LITERALS AT THE CALL SITES ───
 * They were nine literals, spread across three actions, and they had already
 * drifted — some led with the code, one led with the status, one said "is ready
 * for review" while the button said "Submit". Copy that varies by call site
 * reads as a different system each time. Gathering them here also means the "no
 * codes" rule can be TESTED rather than remembered, which is what
 * __tests__/task-notice.test.ts does.
 *
 * ── THE SHAPE: A TITLE THAT NAMES THE TASK, A BODY THAT PLACES IT ───────────
 * The bell renders the title bold on one line and the body underneath in
 * smaller type, both truncated. So the title carries the task and what happened
 * to it — the part that decides whether to open it — and the body carries the
 * project and the person, which is context rather than the point.
 * ========================================================================= */

/** Who and what a notice is about. Everything here is human-readable. */
export interface NoticeSubject {
  readonly taskId: string;
  readonly taskTitle: string;
  /** The project's NAME. Never its code — see the header. */
  readonly projectName: string;
  /** The person whose action caused the notice. */
  readonly actorName: string;
}

export type NoticeEvent =
  | { readonly event: 'assigned' }
  | { readonly event: 'reassigned' }
  /** The doer wants the requester to look before it is called finished. */
  | { readonly event: 'review_requested' }
  /** The doer judged it finished and closed it themselves. */
  | { readonly event: 'completed' }
  /** A reviewer approved work that was submitted to them. */
  | { readonly event: 'approved' }
  | { readonly event: 'revisions'; readonly reason: string | null }
  | { readonly event: 'blocked'; readonly reason: string | null }
  | { readonly event: 'moved'; readonly statusLabel: string }
  | { readonly event: 'commented'; readonly excerpt: string };

export interface Notice {
  readonly title: string;
  readonly body: string;
  readonly linkTo: string;
}

/**
 * Where a notification goes when it is clicked.
 *
 * ── ⚠️ THE TASK ITSELF, NOT THE BOARD IT SITS ON ────────────────────────────
 * These used to link to `/my-work` or `/tasks` — the right *page*, and then a
 * hunt through it. Owner, 2026-09-08: *"When I click on some row, it will bring
 * me to that specific task."* `/tasks?task=<id>` is the deep link the board
 * already understands; the toast after creating a task has used it for weeks.
 */
export function taskLink(taskId: string): string {
  return `/tasks?task=${taskId}`;
}

/* ── ⚠️ THE BODY ALWAYS OPENS WITH THE PROJECT ─────────────────────────────
   Owner: *"We should only know the project name. We only know the task relevant
   to any project."* The project is the reader's index — it is how they decide
   whether this concerns them before reading another word — so it goes first,
   where a truncated line still shows it.

   A first draft gave the body wholly to the reason on a revision and to the
   excerpt on a comment, on the argument that the brief matters more than the
   context. A test written against every event caught it: a comment notification
   named no project at all. Both fit, in that order. */

/** The second line, when the useful part is who did it. */
function place(subject: NoticeSubject, verb: string): string {
  return `${subject.projectName} · ${verb} ${subject.actorName}`;
}

/** The second line, when the useful part is what somebody wrote. */
function inProject(subject: NoticeSubject, tail: string): string {
  return `${subject.projectName} · ${tail}`;
}

/**
 * The sentence a person reads in the bell.
 *
 * ⚠️ A trimmed-empty task title still has to produce something readable — a
 * title is required at creation, but nothing stops an edit from being submitted
 * against an older row, and "— waiting for your review" with nothing in front of
 * it is a notification about nothing.
 */
export function taskNotice(subject: NoticeSubject, notice: NoticeEvent): Notice {
  const name = subject.taskTitle.trim() || 'Untitled task';
  const linkTo = taskLink(subject.taskId);

  switch (notice.event) {
    case 'assigned':
      return {
        title: `${name} — assigned to you`,
        body: place(subject, 'raised by'),
        linkTo,
      };

    case 'reassigned':
      return {
        title: `${name} — now yours`,
        body: place(subject, 'moved to you by'),
        linkTo,
      };

    /* ⚠️ THE WORDING THE OWNER ASKED FOR, ALMOST VERBATIM: *"The task is in
       review and waiting for your review… waiting to be done and your review is
       needed."* It says what is wanted FROM THE READER, which is the only
       reason this notification exists — "is ready for review" described the
       task's state and left the reader to work out that they were the one being
       asked. */
    case 'review_requested':
      return {
        title: `${name} — waiting for your review`,
        body: place(subject, 'submitted by'),
        linkTo,
      };

    /* Owner: *"if the member moves that task, then the notification should be
       sent to the super admin or admin who assigned that task… mention that the
       task that you have assigned is done."* */
    case 'completed':
      return {
        title: `${name} — done`,
        body: place(subject, 'completed by'),
        linkTo,
      };

    case 'approved':
      return {
        title: `${name} — approved`,
        body: place(subject, 'approved by'),
        linkTo,
      };

    /* The reason IS the brief, so it follows the project rather than being
       replaced by it: "changes requested" without saying what to change sends
       the reader looking. */
    case 'revisions':
      return {
        title: `${name} — changes requested`,
        body: notice.reason?.trim()
          ? inProject(subject, notice.reason.trim())
          : place(subject, 'sent back by'),
        linkTo,
      };

    case 'blocked':
      return {
        title: `${name} — blocked`,
        body: notice.reason?.trim()
          ? inProject(subject, notice.reason.trim())
          : place(subject, 'blocked by'),
        linkTo,
      };

    case 'moved':
      return {
        title: `${name} — ${notice.statusLabel}`,
        body: place(subject, 'moved by'),
        linkTo,
      };

    case 'commented':
      return {
        title: `${subject.actorName} commented on ${name}`,
        body: notice.excerpt.trim()
          ? inProject(subject, notice.excerpt.trim())
          : subject.projectName,
        linkTo,
      };

    default: {
      /* An unhandled event means somebody added one and did not write its copy.
         Exhaustiveness is checked at compile time; this is the runtime floor. */
      const never: never = notice;
      void never;
      return { title: name, body: subject.projectName, linkTo };
    }
  }
}

/**
 * Which notice a status change produces for the person who is NOT moving it.
 *
 * Kept beside the copy because the two decisions are the same decision: the
 * event chosen here is the sentence written above, and splitting them across
 * files is how "done" ends up reading "approved" to the person who did the work.
 */
export function noticeForStatus(
  to: TaskStatus,
  reason: string | null,
  statusLabel: string,
): NoticeEvent {
  switch (to) {
    case 'revisions':
      return { event: 'revisions', reason };
    case 'blocked':
      return { event: 'blocked', reason };
    case 'done':
      return { event: 'approved' };
    default:
      return { event: 'moved', statusLabel };
  }
}

/* ==========================================================================
 * WHERE A NOTIFICATION GOES WHEN IT IS CLICKED
 * ========================================================================== */

/**
 * The notification kinds that are about a task.
 *
 * ⚠️ AN ALLOWLIST, NOT "everything except three". `entity_id` holds whatever
 * the notification is about — a task for most kinds, a PROJECT for
 * `project_status_changed`, the person themselves for `capacity_warning`.
 * Linking those to `/tasks?task=<project id>` would open a board filtered to a
 * task that does not exist, which looks like data loss rather than a wrong
 * link. A new kind is therefore not a task kind until it is written here.
 */
const TASK_KINDS: ReadonlySet<string> = new Set([
  'task_assigned',
  'task_reassigned',
  'task_status_changed',
  'task_blocked',
  'task_due_soon',
  'task_overdue',
  'task_comment',
  'task_mention',
  'review_requested',
  'review_approved',
  'revisions_requested',
  'time_limit_warning',
  /* ⚠️ `time_extension_requested` IS DELIBERATELY ABSENT. Its `entity_id` is
     the EXTENSION REQUEST's id, not a task's, so deriving a task link from it
     would open the board filtered to a row that does not exist. That
     notification carries a real deep link in `link_to` instead, which is the
     fallback below. `time_extension_decided` is here because its entity IS the
     task — the two look symmetrical and are not. */
  'time_extension_decided',
]);

/**
 * Open the thing the notification is about.
 *
 * Prefers the deep link over the stored one, which is what makes the rows
 * written before 2026-09-08 useful: they carry `/my-work` or `/tasks` as their
 * link and the task's id beside it, so the id wins wherever it can be trusted.
 */
export function notificationHref(row: {
  readonly kind: string;
  readonly linkTo: string | null;
  readonly entityId: string | null;
}): string {
  if (row.entityId && TASK_KINDS.has(row.kind)) return taskLink(row.entityId);
  return row.linkTo ?? '/tasks';
}
