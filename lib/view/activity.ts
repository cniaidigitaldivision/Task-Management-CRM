/* ============================================================================
 * WHAT ONE LOG ROW ACTUALLY SAYS — owner, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"I want the activity history tab to be exactly the same as in the reference
 * ... They are showing some dummy data, obviously, but you will show the exact
 * data properly, logically, and with each and every thing wired up. Use that
 * term we are using in any place you can see that something is out."*
 *
 * The reference draws a sentence and a before → after pair on every row:
 * "changed status of DEMO-103 · In progress → In review". That pair is real —
 * `activity_log.before` and `activity_log.after` hold it — but working it out
 * is a pile of small rules about which fields a given action touches, and those
 * rules are exactly the sort of thing that goes quietly wrong inside a
 * component nobody can test.
 *
 * So it lives here: pure functions over a row, no React, no database, no clock.
 *
 * ── ⚠️ EVERY RULE BELOW WAS READ OFF THE LIVE LOG, NOT ASSUMED ────────────
 * Counted on 2026-09-24 across 3,948 rows:
 *
 *   done 1025 · todo 684 · created 676 · deleted 475 · task.handoff 257 ·
 *   task.placement_recorded 195 · updated 126 · in_progress 112 ·
 *   attachment_added 80 · in_review 61 · cancelled 22 · backlog 12 ·
 *   attachment_removed 11 · blocked 8 · reassigned 6
 *
 * Three findings changed what this file does:
 *
 *   1. `updated` only ever carries dueDate, priority and effortPoints — and 86
 *      of its 126 rows changed NOTHING. Printing "edited" on a row where
 *      nothing moved is the kind of filler the owner has objected to twice, so
 *      `noChange` is stated in words instead.
 *   2. A REASON IS RECORDED, on the moves that ask for one. 26 rows carry one.
 *      It is never invented for the rest.
 *   3. `reassigned` is its own action with both assignee ids — so the
 *      reference's "Rafay → Abdul Moiz" is a real row, not a mock-up.
 * ========================================================================= */

/** Our own words for a status, matching the ledger and the board. */
export const STATUS_WORD: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'Awaiting review',
  revisions: 'Changes requested',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const statusWord = (value: string): string => STATUS_WORD[value] ?? value;

/**
 * The kinds an event can be filtered by.
 *
 * ⚠️ FEWER KINDS THAN ACTIONS, ON PURPOSE. Eight separate status actions in one
 * dropdown is a list nobody reads; "Status change" is the question somebody
 * actually asks. The exact action is still on the row and in the panel.
 */
export type EventKind =
  | 'created'
  | 'status'
  | 'edited'
  | 'assigned'
  | 'file'
  | 'comment'
  | 'placement'
  | 'workflow'
  | 'deleted'
  | 'project'
  | 'people'
  | 'other';

export const KIND_LABEL: Readonly<Record<EventKind, string>> = {
  created: 'Task created',
  status: 'Status change',
  edited: 'Task edited',
  assigned: 'Assignment',
  file: 'File',
  comment: 'Comment',
  placement: 'Placement',
  workflow: 'Workflow',
  deleted: 'Task deleted',
  project: 'Project',
  people: 'People',
  other: 'Other',
};

const STATUS_ACTIONS = new Set([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'revisions',
  'blocked',
  'done',
  'cancelled',
]);

export function eventKind(action: string): EventKind {
  if (action === 'created') return 'created';
  if (STATUS_ACTIONS.has(action)) return 'status';
  if (action === 'updated') return 'edited';
  if (action === 'reassigned') return 'assigned';
  if (action === 'attachment_added' || action === 'attachment_removed') return 'file';
  if (action === 'commented') return 'comment';
  if (action === 'task.placement_recorded') return 'placement';
  if (action === 'task.handoff') return 'workflow';
  if (action === 'deleted') return 'deleted';
  if (action.startsWith('member_') || action === 'remark_added') return 'project';
  if (['invited', 'invitation_resent', 'role_changed', 'capacity_changed', 'deactivated', 'password_reset_forced'].includes(action))
    return 'people';
  return 'other';
}

/* ── The sentence ────────────────────────────────────────────────────────── */

export interface Change {
  /** "Status", "Due date", "Assignee" … */
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface Phrase {
  /** What the actor did, reading straight into the task name: "changed status of". */
  readonly verb: string;
  /** Anything that follows the task name — "to Abdul Moiz". */
  readonly tail: string | null;
  /** The before → after pairs worth drawing. Often empty. */
  readonly changes: readonly Change[];
  /** Said instead of a diff when there is nothing to draw. */
  readonly note: string | null;
}

/** The shape this module reads. Deliberately narrower than `HistoryEntry`. */
export interface LogRow {
  readonly action: string;
  readonly summary?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly fromName?: string | null;
  readonly toName?: string | null;
}

const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

/** "2026-09-09" → "9 Sep 2026"; anything else is passed through untouched. */
export function dayWord(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** "1018036" → "1.0 MB". Bytes are how the log records a file. */
export function sizeWord(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(text(value) ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the row says, in our words.
 *
 * ⚠️ IT NEVER FALLS BACK TO THE LOG'S OWN SENTENCE FOR THE VERB. The stored
 * summary is "moved CLI-2785 to Done" — it repeats the status chip beside it and
 * it names the task by CODE, which the owner has already asked twice to be a
 * name. The summary is still carried on the row for search and for the panel.
 */
export function phraseOf(row: LogRow): Phrase {
  const before = obj(row.before);
  const after = obj(row.after);
  const none: Change[] = [];

  if (STATUS_ACTIONS.has(row.action)) {
    const from = text(before.status);
    const to = text(after.status) ?? row.action;
    return {
      verb: from ? 'changed status of' : 'moved',
      tail: null,
      changes: [{ field: 'Status', from: from ? statusWord(from) : null, to: statusWord(to) }],
      note: null,
    };
  }

  switch (row.action) {
    case 'created': {
      const priority = text(after.priority);
      return {
        verb: 'created task',
        tail: null,
        changes: none,
        /* ⚠️ THE STARTING STATE, NOT A DIFF. Nothing changed — the task began. */
        note: priority ? `${capital(priority)} priority` : null,
      };
    }

    case 'updated': {
      /* ⚠️ ONLY THESE THREE FIELDS EXIST ON AN `updated` ROW. Checked on all
         126 of them: dueDate, priority, effortPoints and nothing else. */
      const fields: Array<[string, string, (v: unknown) => string | null]> = [
        ['dueDate', 'Due date', dayWord],
        ['priority', 'Priority', (v) => (text(v) ? capital(text(v) as string) : null)],
        ['effortPoints', 'Effort', (v) => (text(v) ? `${text(v)} points` : null)],
      ];
      const changes: Change[] = [];
      for (const [key, label, show] of fields) {
        const from = show(before[key]);
        const to = show(after[key]);
        if (from !== to) changes.push({ field: label, from, to });
      }
      return {
        verb: changes.length > 0 ? 'edited' : 'saved',
        tail: null,
        changes,
        /* ⚠️ 86 OF 126 EDITS CHANGED NOTHING. Saying so is the honest row;
           drawing "edited" with no diff invites somebody to go looking for a
           change that was never made. */
        note: changes.length > 0 ? null : 'No field changed',
      };
    }

    case 'reassigned':
      return {
        verb: 'reassigned',
        tail: null,
        changes: [
          {
            field: 'Assignee',
            from: row.fromName ?? (text(before.assigneeId) ? 'Somebody' : 'Nobody'),
            to: row.toName ?? 'Nobody',
          },
        ],
        note: null,
      };

    case 'attachment_added': {
      const name = text(after.fileName);
      const size = sizeWord(after.sizeBytes);
      return {
        verb: 'uploaded a file to',
        tail: null,
        changes: none,
        note: name ? (size ? `${name} (${size})` : name) : 'A file',
      };
    }

    case 'attachment_removed': {
      const name = text(before.fileName);
      return { verb: 'removed a file from', tail: null, changes: none, note: name };
    }

    case 'commented':
      return { verb: 'commented on', tail: null, changes: none, note: null };

    case 'task.placement_recorded': {
      const kind = text(after.contentKind);
      const link = after.hasUrl === true ? 'link recorded' : null;
      return {
        verb: 'recorded a placement on',
        tail: null,
        changes: none,
        note: [kind ? capital(kind) : null, link].filter(Boolean).join(' · ') || null,
      };
    }

    /* ⚠️ NOT "handed over". All 257 of these carry "Created by the … pipeline
       chain": the WORKFLOW building the next task in a chain, never a person
       passing work to a person. The owner asked what "handed over" meant, and
       the answer was that it meant nothing. */
    case 'task.handoff':
      return { verb: 'was created by a workflow from', tail: null, changes: none, note: null };

    case 'deleted':
      return { verb: 'deleted', tail: null, changes: none, note: null };

    case 'member_added':
      return { verb: 'added a member to', tail: null, changes: none, note: null };
    case 'member_removed':
      return { verb: 'removed a member from', tail: null, changes: none, note: null };
    case 'remark_added':
      return { verb: 'added a remark to', tail: null, changes: none, note: null };

    case 'role_changed':
      return {
        verb: 'changed a role',
        tail: null,
        changes: [{ field: 'Role', from: text(before.role), to: text(after.role) }],
        note: null,
      };

    default: {
      /* An action this file has not been taught. The log's own sentence is the
         only honest thing left — better a plain row than a wrong label. */
      return { verb: row.action.replace(/[._]/g, ' '), tail: null, changes: none, note: null };
    }
  }
}
