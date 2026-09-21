/* ============================================================================
 * THE FOLLOW-UPS PAGE'S RULES — pure, so every card, tab and chip is testable
 * ----------------------------------------------------------------------------
 * Owner's design, 2026-09-22: Due today / Overdue / Reply needed / Active
 * sequences, a queue with four tabs, filters, and a details panel that suggests
 * a priority and says what would stop the sequence.
 *
 * ⚠️ KARACHI DAYS. "Today" and "overdue" are the division's, not the browser's
 * (karachi-not-utc).
 * ========================================================================= */

import type { Tone } from '@/lib/domain/crm-appointment-board';

export interface BoardRowLike {
  readonly id: string;
  readonly leadName: string | null;
  readonly projectName: string | null;
  readonly purpose: string;
  readonly channel: string;
  readonly mode: string;
  readonly status: string;
  readonly dueAt: string;
  readonly title: string;
  readonly quotationNumber: string | null;
  readonly quotationStatus: string | null;
  readonly appointmentRef: number | null;
  readonly sequenceRunId: string | null;
  readonly sequenceState: string | null;
  readonly stepNo: number | null;
  readonly stepTotal: number | null;
  readonly awaitingOurReply: boolean;
  readonly lastMessageAt: string | null;
}

export type DisplayStatus =
  | 'reply_needed'
  | 'waiting_approval'
  | 'overdue'
  | 'due_now'
  | 'scheduled'
  | 'sent'
  | 'stopped'
  | 'failed';

export const STATUS_LOOK: Readonly<Record<DisplayStatus, { label: string; tone: Tone }>> = {
  reply_needed: { label: 'Reply needed', tone: 'red' },
  waiting_approval: { label: 'Waiting approval', tone: 'amber' },
  overdue: { label: 'Overdue', tone: 'red' },
  due_now: { label: 'Due now', tone: 'red' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  sent: { label: 'Sent', tone: 'green' },
  stopped: { label: 'Stopped', tone: 'grey' },
  failed: { label: 'Could not send', tone: 'red' },
};

const KARACHI_MS = 5 * 3_600_000;
const DAY = 86_400_000;

export const karachiDay = (ms: number) => new Date(ms + KARACHI_MS).toISOString().slice(0, 10);

/** The open states — everything a person still owes. */
const OPEN = ['planned', 'due'];
export const isOpen = (r: BoardRowLike) => OPEN.includes(r.status);

export function displayStatus(r: BoardRowLike, nowMs: number): DisplayStatus {
  if (r.status === 'done') return 'sent';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'cancelled' || r.status === 'skipped') return 'stopped';

  /* ⚠️ THE CLIENT WRITING BEATS EVERY OTHER STATE. A queue that says "scheduled
     for Thursday" while somebody is waiting for an answer is a queue that reads
     the wrong way round. */
  if (r.awaitingOurReply) return 'reply_needed';
  /* A discount that a manager has not decided cannot be chased yet. */
  if (r.quotationStatus === 'pending_approval') return 'waiting_approval';

  const due = Date.parse(r.dueAt);
  if (due > nowMs) return 'scheduled';
  return karachiDay(due) < karachiDay(nowMs) ? 'overdue' : 'due_now';
}

export interface CardCounts {
  readonly dueToday: number;
  readonly overdue: number;
  readonly replyNeeded: number;
  readonly activeSequences: number;
}

export function cardCounts(rows: readonly BoardRowLike[], nowMs: number, sequences = 0): CardCounts {
  const today = karachiDay(nowMs);
  let dueToday = 0;
  let overdue = 0;
  let replyNeeded = 0;
  for (const r of rows) {
    if (!isOpen(r)) continue;
    const s = displayStatus(r, nowMs);
    if (s === 'reply_needed') replyNeeded += 1;
    if (s === 'overdue') overdue += 1;
    if (karachiDay(Date.parse(r.dueAt)) === today) dueToday += 1;
  }
  return { dueToday, overdue, replyNeeded, activeSequences: sequences };
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export type TabKey = 'queue' | 'scheduled' | 'sequences' | 'completed';

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'queue', label: 'My queue' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'completed', label: 'Completed' },
];

/**
 * ⚠️ "MY QUEUE" IS WHAT IS OWED NOW, not everything open. A step due next
 * Thursday belongs under Scheduled; putting it here would make the queue a list
 * nobody can finish.
 */
export function inTab(r: BoardRowLike, tab: TabKey, nowMs: number): boolean {
  const s = displayStatus(r, nowMs);
  switch (tab) {
    case 'queue':
      return isOpen(r) && (s === 'due_now' || s === 'overdue' || s === 'reply_needed' || s === 'waiting_approval');
    case 'scheduled':
      return isOpen(r) && s === 'scheduled';
    case 'completed':
      return !isOpen(r);
    case 'sequences':
      return isOpen(r) && r.sequenceRunId !== null;
  }
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

export interface BoardFilters {
  readonly q: string;
  readonly due: 'all' | 'overdue' | 'today' | 'tomorrow' | 'week';
  readonly purpose: string;
  readonly channel: string;
  readonly project: string;
}

export const NO_FILTERS: BoardFilters = { q: '', due: 'all', purpose: 'all', channel: 'all', project: 'all' };

export const DUE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'This week' },
] as const;

export const CHANNEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'task', label: 'Task' },
] as const;

export function applyFilters<T extends BoardRowLike>(rows: readonly T[], f: BoardFilters, nowMs: number): T[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const today = karachiDay(nowMs);
  const tomorrow = karachiDay(nowMs + DAY);
  const weekEnd = karachiDay(nowMs + 7 * DAY);
  return rows.filter((r) => {
    if (f.purpose !== 'all' && r.purpose !== f.purpose) return false;
    if (f.channel !== 'all' && r.channel !== f.channel) return false;
    if (f.project !== 'all' && (r.projectName ?? '') !== f.project) return false;

    if (f.due !== 'all') {
      const day = karachiDay(Date.parse(r.dueAt));
      if (f.due === 'today' && day !== today) return false;
      if (f.due === 'tomorrow' && day !== tomorrow) return false;
      if (f.due === 'week' && (day < today || day > weekEnd)) return false;
      if (f.due === 'overdue' && !(isOpen(r) && day < today)) return false;
    }

    if (words.length) {
      const hay = [r.leadName, r.projectName, r.title, r.purpose.replace(/_/g, ' '), r.quotationNumber,
        r.appointmentRef ? `APPT-${r.appointmentRef}` : null]
        .filter(Boolean).join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** What is owed first: reply needed, then overdue, then by when it is due. */
export function sortForQueue<T extends BoardRowLike>(rows: readonly T[], nowMs: number): T[] {
  const rank = (r: T) => {
    const s = displayStatus(r, nowMs);
    return s === 'reply_needed' ? 0 : s === 'overdue' ? 1 : s === 'due_now' ? 2 : s === 'waiting_approval' ? 3 : isOpen(r) ? 4 : 5;
  };
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const ta = Date.parse(a.dueAt);
    const tb = Date.parse(b.dueAt);
    return rank(a) === 5 ? tb - ta : ta - tb;
  });
}

/* ── Words ───────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clock = (ms: number) => {
  const d = new Date(ms + KARACHI_MS);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Today · 10:00 AM", "Tomorrow · 9:00 AM", "22 Sep · 11:00 AM" — or "Now". */
export function dueLine(dueAt: string, nowMs: number, status: DisplayStatus): { day: string; time: string } {
  if (status === 'reply_needed') return { day: 'Now', time: '' };
  const ms = Date.parse(dueAt);
  const day = karachiDay(ms);
  const d = new Date(ms + KARACHI_MS);
  const label =
    day === karachiDay(nowMs)
      ? 'Today'
      : day === karachiDay(nowMs + DAY)
        ? 'Tomorrow'
        : day === karachiDay(nowMs - DAY)
          ? 'Yesterday'
          : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return { day: label, time: clock(ms) };
}

/** "Step 1 of 3", "Manual", or why it is paused. */
export function sequenceLine(r: BoardRowLike): string {
  if (!r.sequenceRunId) return 'Manual';
  if (r.sequenceState === 'paused') return 'Paused on reply';
  if (r.stepNo && r.stepTotal) return `Step ${r.stepNo} of ${r.stepTotal}`;
  return 'In a sequence';
}

/** How long since the client last said anything — "no reply 20h". */
export function silenceFor(lastMessageAt: string | null, nowMs: number): string | null {
  if (!lastMessageAt) return null;
  const hours = Math.floor((nowMs - Date.parse(lastMessageAt)) / 3_600_000);
  if (hours < 1) return null;
  return hours < 48 ? `no reply ${hours}h` : `no reply ${Math.floor(hours / 24)}d`;
}

export interface Priority {
  readonly level: 'High' | 'Medium' | 'Low';
  readonly tone: Tone;
  readonly why: string;
}

/**
 * What the panel suggests, and why — never a number nobody can check.
 *
 * ⚠️ A SUGGESTION, NOT A SCORE. It says the facts it used ("due now · approved
 * quote · no reply 20h") so a salesperson can disagree with it on sight.
 */
export function priority(r: BoardRowLike & { lastMessageAt: string | null }, nowMs: number): Priority {
  const s = displayStatus(r, nowMs);
  const why: string[] = [];
  let score = 0;

  if (s === 'reply_needed') {
    why.push('the client replied');
    score += 3;
  } else if (s === 'overdue') {
    why.push('overdue');
    score += 3;
  } else if (s === 'due_now') {
    why.push('due now');
    score += 2;
  } else if (s === 'scheduled') {
    why.push('scheduled');
  }

  if (r.quotationStatus === 'approved' || r.quotationStatus === 'sent') {
    why.push(r.quotationStatus === 'approved' ? 'approved quote' : 'quotation sent');
    score += 2;
  }
  if (r.quotationStatus === 'pending_approval') why.push('quote awaiting approval');

  const silence = silenceFor(r.lastMessageAt, nowMs);
  if (silence) {
    why.push(silence);
    const hours = Math.floor((nowMs - Date.parse(r.lastMessageAt!)) / 3_600_000);
    if (hours >= 24) score += 1;
  }

  const level = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';
  return {
    level,
    tone: level === 'High' ? 'red' : level === 'Medium' ? 'amber' : 'grey',
    why: why.join(' · ') || 'nothing pressing',
  };
}

/** What the button on the row does, given what the row is. */
export type RowAction = 'review' | 'send' | 'reply' | 'approval' | 'preview' | 'done' | 'none';

export function rowAction(r: BoardRowLike, nowMs: number): RowAction {
  const s = displayStatus(r, nowMs);
  if (!isOpen(r)) return 'none';
  if (s === 'reply_needed') return 'reply';
  if (s === 'waiting_approval') return 'approval';
  /* ⚠️ ONLY `auto_send` IS SENT BY MACHINE. A call, a task, a reminder — and
     the legacy `review_first` rows 234 retired — are all waiting on a person,
     and offering Send on one would call a write that refuses it. The rest of
     the codebase groups them the same way (crm-followups.ts, crm-leads.ts). */
  if (r.channel === 'call' || r.channel === 'task' || r.mode !== 'auto_send') return 'done';
  return s === 'scheduled' ? 'preview' : 'review';
}
