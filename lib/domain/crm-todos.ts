/* ============================================================================
 * TO-DOS — turning six kinds of owed work into one list somebody can clear
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock of its own, no React.
 *
 * Owner, 2026-09-16: *"For the sales team you have to clear your to-dos, then
 * you can leave today."* That sentence is the whole specification, and it only
 * works if the list is (a) finishable and (b) true. Finishable means bounded.
 * True means every row is derived from real state — see `crmMyTodos`, which has
 * no table behind it on purpose.
 * ========================================================================= */

export const TODO_KINDS = [
  'first_contact',
  'next_action',
  'appointment',
  'record_visit',
  'approve_quotation',
  'send_quotation',
] as const;

export type TodoKind = (typeof TODO_KINDS)[number];

/* ⚠️ INSTRUCTIONS, NOT NOUNS. "Quotation" is a thing; "Send the quotation" is
   something somebody can finish. A to-do list of nouns is a list of topics. */
const LABEL: Record<TodoKind, string> = {
  first_contact: 'Make first contact',
  next_action: 'Do what you planned',
  appointment: 'Be there',
  record_visit: 'Write up what happened',
  approve_quotation: 'Approve or refuse a discount',
  send_quotation: 'Send the approved quotation',
};

/* Design tokens, not colours. ⚠️ `first_contact` is the only one that ever wears
   the error token, and only when it is late — a list where everything shouts is
   a list where nothing does. */
const TOKEN: Record<TodoKind, string> = {
  first_contact: 'accent-primary',
  next_action: 'accent-primary',
  appointment: 'feedback-success',
  record_visit: 'gold-700',
  approve_quotation: 'gold-700',
  send_quotation: 'feedback-success',
};

export function todoLabel(kind: string): string {
  /* An unrecognised kind shows itself rather than "Task" — a value added and
     forgotten here should look odd on screen, not vanish. Same rule as
     `stageLabel` and `appointmentStatusLabel`. */
  return LABEL[kind as TodoKind] ?? kind;
}

export function todoToken(kind: string): string {
  return TOKEN[kind as TodoKind] ?? 'neutral-500';
}

/**
 * ⚠️ WHICH ONES CANNOT WAIT UNTIL TOMORROW.
 *
 * `first_contact` and `record_visit` are the two where delay is the damage
 * itself: a lead's intent decays by the hour, and a visit nobody wrote up is
 * forgotten by the next morning. The rest are work that is merely scheduled.
 */
export function todoIsUrgent(kind: string): boolean {
  return kind === 'first_contact' || kind === 'record_visit';
}

export interface Groupable {
  readonly kind: string;
  readonly dueAt: string | null;
}

export interface TodoGroups<T extends Groupable> {
  /** Past their moment. Oldest first — the longest-ignored is the worst. */
  readonly overdue: readonly T[];
  /** Today, in Karachi. */
  readonly today: readonly T[];
  /** Ahead, soonest first. */
  readonly later: readonly T[];
}

const karachiDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/**
 * Split by when, in the division's own zone.
 *
 * ⚠️ KARACHI, NOT THE BROWSER'S. `current_date` is a different day here for five
 * hours every evening, and a to-do list that disagreed with the rest of the
 * product about which day it was would be worse than no grouping at all.
 *
 * ⚠️ AND A ROW WITH NO DATE IS OVERDUE, NOT "LATER". A lead with no owner-set
 * deadline is not work scheduled for the future — it is work nobody has planned,
 * which is precisely the thing this page exists to surface. Filing it under
 * `later` would hide the 640 leads that have no next action at all.
 */
export function groupTodos<T extends Groupable>(todos: readonly T[], nowMs: number): TodoGroups<T> {
  const today = karachiDay(nowMs);
  const overdue: T[] = [];
  const dueToday: T[] = [];
  const later: T[] = [];

  for (const t of todos) {
    if (!t.dueAt) {
      overdue.push(t);
      continue;
    }
    const at = Date.parse(t.dueAt);
    const day = karachiDay(at);
    if (day < today) overdue.push(t);
    else if (day === today) dueToday.push(t);
    else later.push(t);
  }

  const by = (a: T, b: T) => {
    /* Undated first inside `overdue` — they have been waiting longest by
       definition, since nobody ever gave them a moment at all. */
    if (!a.dueAt) return -1;
    if (!b.dueAt) return 1;
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  };

  overdue.sort(by);
  dueToday.sort(by);
  later.sort(by);

  return { overdue, today: dueToday, later };
}

/**
 * The sentence at the top of the page.
 *
 * ⚠️ IT NAMES THE WORST THING, NOT THE TOTAL. "23 to-dos" is a statistic
 * somebody scrolls past; "4 leads have never been contacted" is a decision about
 * the next ten minutes. And a finished list says so plainly, because the owner's
 * rule is that clearing it means you can go home.
 */
export function todoSummary<T extends Groupable>(
  groups: TodoGroups<T>,
  firstContactCount: number,
): string {
  if (groups.overdue.length === 0 && groups.today.length === 0) {
    return 'Nothing owed today. Anything below is scheduled ahead.';
  }
  if (firstContactCount > 0) {
    return `${firstContactCount} ${firstContactCount === 1 ? 'lead has' : 'leads have'} never been contacted.`;
  }
  if (groups.overdue.length > 0) {
    return `${groups.overdue.length} overdue, ${groups.today.length} due today.`;
  }
  return `${groups.today.length} due today.`;
}
