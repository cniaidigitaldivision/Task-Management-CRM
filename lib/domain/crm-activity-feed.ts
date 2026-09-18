import {
  activityLabel,
  lostReasonLabel,
  stageLabel,
  temperatureLabel,
} from '@/lib/domain/crm-stages';
import { sourceLabel } from '@/lib/domain/lead-source';
import { appointmentKindLabel, appointmentStatusLabel } from '@/lib/domain/crm-appointments';
import { quotationStatusLabel } from '@/lib/domain/crm-quotations';
import { channelLabel } from '@/lib/domain/crm-followups';

/* ============================================================================
 * THE ACTIVITY FEED — one timeline out of five tables
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, with a reference image: *"I want that in the drawer where
 * the activity tab is, so make it exactly the same as on the reference image."*
 *
 * The reference draws a filtered timeline — All activity · Messages · Stage
 * changes · Follow-ups · Documents · Notes — grouped by day, each line a
 * coloured mark, a title, a grey detail, and a way into the record behind it.
 *
 * ── ⚠️ THE FILTERS NAME THINGS THIS DATABASE ACTUALLY HOLDS ────────────────
 * `screenshots-are-ideas-not-specs`: the layout comes from the mock-up, the
 * content from the schema. Our fourteen activity kinds are sorted into the
 * reference's five buckets below, and EVERY kind lands in exactly one — a row
 * no chip can reach is a row somebody will swear the system lost.
 *
 * "Documents" is the one bucket `crm_lead_activity` cannot fill by itself: a
 * quotation is not one of the kinds 116's trigger writes (raising one leaves a
 * NOTE, deliberately). So quotations, past appointments and finished follow-ups
 * are folded in from rows the drawer is already holding — no extra query, law
 * 3, and the chip means something.
 *
 * ── ⚠️ A TIMELINE IS HISTORY, SO NOTHING IN THE FUTURE JOINS IT ────────────
 * A visit booked for Saturday has not happened. It belongs to the Follow-ups
 * tab, which is about what is owed; putting it at the top of the feed under a
 * date that has not arrived makes a plan read as a fact.
 * ========================================================================= */

export type FeedGroup = 'messages' | 'stage' | 'followups' | 'documents' | 'notes';

/** Which mark the row wears. The component owns the icon and the colour. */
export type FeedMark =
  | 'whatsapp'
  | 'email'
  | 'call'
  | 'call_missed'
  | 'stage'
  | 'won'
  | 'lost'
  | 'temperature'
  | 'note'
  | 'next_action'
  | 'quotation'
  | 'appointment'
  | 'followup'
  | 'arrived'
  | 'assigned';

/** Where "View details" goes, or null when there is nothing further to show. */
export type FeedOpens = 'conversations' | 'followups' | 'quotations' | 'appointments' | null;

export interface FeedEntry {
  readonly id: string;
  /** The instant it happened, in milliseconds. */
  readonly at: number;
  readonly group: FeedGroup;
  readonly mark: FeedMark;
  readonly title: string;
  readonly detail: string | null;
  /** Who did it — already resolved, so the screen never prints a null. */
  readonly by: string;
  readonly opens: FeedOpens;
  /** A note the viewer has just written and the server has not confirmed yet. */
  readonly pending?: boolean;
}

/* ---- What the feed is built from ------------------------------------------
 * Structural shapes, not the query module's types: this file is tested on its
 * own and must not drag a database driver into the test runner. Every field
 * below exists on rows the drawer already has.
 */

export interface FeedEvent {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string | null;
  readonly occurredAt: string;
  readonly actorName: string | null;
  readonly detail?: Readonly<Record<string, unknown>> | null;
}

export interface FeedNote {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly authorName: string | null;
}

export interface FeedQuotation {
  readonly id: string;
  readonly number: string;
  readonly version: number;
  readonly status: string;
  readonly netAmount: number;
  readonly propertyLabel: string | null;
  readonly preparedByName: string | null;
  readonly createdAt: string;
}

export interface FeedAppointment {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly location: string | null;
  readonly outcome: string | null;
  readonly ownerName: string | null;
}

export interface FeedFollowUp {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly status: string;
  readonly dueAt: string;
  readonly doneAt: string | null;
  readonly outcomeNote: string | null;
  readonly doneByName: string | null;
}

export interface FeedInput {
  readonly activity: readonly FeedEvent[];
  readonly notes: readonly FeedNote[];
  readonly quotations?: readonly FeedQuotation[];
  readonly appointments?: readonly FeedAppointment[];
  readonly followUps?: readonly FeedFollowUp[];
  readonly nowMs: number;
}

/* ---- Small readers -------------------------------------------------------- */

const TZ = 'Asia/Karachi';

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const join = (...parts: ReadonlyArray<string | null>): string | null =>
  parts.filter((p): p is string => p !== null && p !== '').join(' · ') || null;

const money = (n: number): string => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

/**
 * ⚠️ A NULL ACTOR IS NOT A MISSING PERSON. Every `imported` row carries one,
 * because the cron that wrote it had no session, and printing "Unknown" would
 * suggest a name was lost. Anything else with no actor was written by the
 * product itself — the follow-up sender, a trigger — and says so.
 */
function actor(name: string | null, kind: string): string {
  if (name) return name;
  return kind === 'imported' || kind === 'created' ? 'The importer' : 'Automatic';
}

/** "9:05 AM" in Karachi — the clock every salesperson here reads. */
export function feedClock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}

/** "2026-09-18" in Karachi — `karachi-not-utc`: the day differs for five hours. */
function dayKey(at: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/**
 * "Sep", never "Sept".
 *
 * WARNING: en-GB SHORTENS SEPTEMBER TO FOUR LETTERS in ICU 72 and later, which
 * is why when.tsx already takes its day from en-GB and its month from en-US.
 * One month spelt differently from every other date in the product reads as two
 * systems disagreeing about the same day.
 */
function shortMonth(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'short', timeZone: TZ });
}

function dayNumber(at: number): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', timeZone: TZ });
}

/** "18 Sep 2026", or Today / Yesterday when it is one of those. */
function dayLabel(at: number, nowMs: number): string {
  const key = dayKey(at);
  if (key === dayKey(nowMs)) return 'Today';
  if (key === dayKey(nowMs - 86_400_000)) return 'Yesterday';
  const year = new Date(at).toLocaleDateString('en-GB', { year: 'numeric', timeZone: TZ });
  return `${dayNumber(at)} ${shortMonth(at)} ${year}`;
}

/** "Fri 18 Sep, 11:00 PM" — a whole moment, for a detail line. */
function whenText(iso: string): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const weekday = new Date(at).toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
  return `${weekday} ${dayNumber(at)} ${shortMonth(at)}, ${feedClock(at)}`;
}

/* ---- The chips ------------------------------------------------------------ */

export const FEED_FILTERS = [
  { key: 'all', label: 'All activity' },
  { key: 'messages', label: 'Messages' },
  { key: 'stage', label: 'Stage changes' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'documents', label: 'Documents' },
  { key: 'notes', label: 'Notes' },
] as const;

export type FeedFilter = (typeof FEED_FILTERS)[number]['key'];

/**
 * ⚠️ "Messages" MEANS EVERY ATTEMPT TO REACH THEM, calls included. The chip is
 * a filter, not a label: each row still says exactly what it was — "Called",
 * "No answer", "WhatsApp sent" — so nothing is mislabelled, and somebody
 * looking for "did we get hold of them" finds all of it in one place rather
 * than guessing which of two chips a phone call went under.
 */
const GROUP_OF: Record<string, FeedGroup> = {
  whatsapp_sent: 'messages',
  email_sent: 'messages',
  call_attempted: 'messages',
  call_connected: 'messages',
  call_no_answer: 'messages',
  stage_changed: 'stage',
  won: 'stage',
  lost: 'stage',
  temperature_set: 'stage',
  assigned: 'stage',
  imported: 'stage',
  created: 'stage',
  next_action_set: 'followups',
  note_added: 'notes',
};

/** Which chip a kind answers to. Exported so a test can prove none is orphaned. */
export function groupOfKind(kind: string): FeedGroup {
  return GROUP_OF[kind] ?? 'stage';
}

/* ---- Building it ---------------------------------------------------------- */

function fromEvent(e: FeedEvent, noteBody: (id: string | null) => string | null): FeedEntry {
  const at = Date.parse(e.occurredAt);
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const from = text(d.from);
  const to = text(d.to);
  const base = {
    id: e.id,
    at,
    group: groupOfKind(e.kind),
    by: actor(e.actorName, e.kind),
  };

  switch (e.kind) {
    case 'whatsapp_sent':
      return { ...base, mark: 'whatsapp', title: 'WhatsApp sent', detail: text(e.outcome), opens: 'conversations' };
    case 'email_sent':
      return { ...base, mark: 'email', title: 'Email sent', detail: text(e.outcome), opens: 'conversations' };
    case 'call_connected':
      return { ...base, mark: 'call', title: 'Spoke on the phone', detail: text(e.outcome), opens: null };
    case 'call_attempted':
      return { ...base, mark: 'call', title: 'Called', detail: text(e.outcome), opens: null };
    case 'call_no_answer':
      return { ...base, mark: 'call_missed', title: 'No answer', detail: text(e.outcome), opens: null };

    case 'stage_changed':
      return {
        ...base,
        mark: 'stage',
        title: 'Stage changed',
        detail: from && to ? `${stageLabel(from)} → ${stageLabel(to)}` : text(e.outcome),
        opens: null,
      };
    case 'won':
      return {
        ...base,
        mark: 'won',
        title: 'Marked won',
        detail: from ? `From ${stageLabel(from)}` : null,
        opens: null,
      };
    case 'lost':
      /* ⚠️ `outcome` HOLDS `lost_reason`, an enum value — "no_answer" is
         database vocabulary, not a sentence for a salesperson's screen. */
      return {
        ...base,
        mark: 'lost',
        title: 'Marked lost',
        detail: join(
          e.outcome ? lostReasonLabel(e.outcome) : null,
          from ? `From ${stageLabel(from)}` : null,
        ),
        opens: null,
      };
    case 'temperature_set': {
      const now = to ?? text(e.outcome);
      return {
        ...base,
        mark: 'temperature',
        title: now ? `Marked a ${temperatureLabel(now).toLowerCase()} lead` : 'Temperature set',
        detail: from ? `Was ${temperatureLabel(from).toLowerCase()}` : null,
        opens: null,
      };
    }

    case 'next_action_set': {
      const due = text(d.due);
      const when = due ? whenText(due) : null;
      return {
        ...base,
        mark: 'next_action',
        title: 'Next action set',
        detail: join(text(e.outcome), when ? `Due ${when}` : null),
        opens: 'followups',
      };
    }

    case 'note_added': {
      const body = noteBody(text(d.note_id));
      return {
        ...base,
        mark: 'note',
        title: 'Note added',
        /* ⚠️ THE ROW OUTLIVES THE NOTE, by design — `crm_lead_activity` has no
           delete policy at any rank, so withdrawing a note removes what was
           said and leaves the fact that something was said. The feed says so
           rather than showing an entry with nothing under it. */
        detail: body ?? 'This note was withdrawn.',
        opens: null,
      };
    }

    case 'created':
      return {
        ...base,
        mark: 'arrived',
        title: 'Lead created',
        detail: join(
          text(d.source) ? `Came in through ${sourceLabel(text(d.source))}` : null,
          text(d.detail),
        ),
        opens: null,
      };
    case 'imported':
      return {
        ...base,
        mark: 'arrived',
        title: 'Lead came in',
        detail: text(d.form) ? 'From a Meta lead form' : null,
        opens: null,
      };
    case 'assigned':
      return {
        ...base,
        mark: 'assigned',
        title: 'Assigned',
        detail: join(e.outcome ? `To ${e.outcome}` : null, text(d.why)),
        opens: null,
      };

    default:
      /* ⚠️ AN UNKNOWN KIND SHOWS ITSELF rather than vanishing — the rule
         `stageLabel` follows. A kind added to the enum and forgotten here
         should look odd on screen, not disappear from somebody's record. */
      return { ...base, mark: 'stage', title: activityLabel(e.kind), detail: text(e.outcome), opens: null };
  }
}

/**
 * Every recorded thing on one lead, newest first.
 *
 * ⚠️ NOTHING IS FETCHED HERE. Every argument is already in the drawer's hands
 * when the tab is clicked, so switching to Activity costs one render and no
 * round trip — Rule Zero, laws 1 and 3.
 */
export function buildActivityFeed(input: FeedInput): readonly FeedEntry[] {
  const byId = new Map(input.notes.map((n) => [n.id, n]));
  const used = new Set<string>();
  const noteBody = (id: string | null): string | null => {
    if (!id) return null;
    const note = byId.get(id);
    if (!note) return null;
    used.add(id);
    return note.body;
  };

  const out: FeedEntry[] = [];

  for (const e of input.activity) {
    if (Number.isNaN(Date.parse(e.occurredAt))) continue;
    out.push(fromEvent(e, noteBody));
  }

  /* ⚠️ A NOTE WITHOUT ITS TIMELINE ROW STILL SHOWS. 116's trigger writes one for
     every insert, so this should find nothing — but a note that exists and does
     not appear in the feed is the one failure nobody would report as a bug, and
     dropping it would hide what somebody actually wrote. */
  for (const n of input.notes) {
    if (used.has(n.id)) continue;
    const at = Date.parse(n.createdAt);
    if (Number.isNaN(at)) continue;
    out.push({
      id: `note:${n.id}`,
      at,
      group: 'notes',
      mark: 'note',
      title: 'Note added',
      detail: n.body,
      by: n.authorName ?? 'Automatic',
      opens: null,
    });
  }

  for (const q of input.quotations ?? []) {
    const at = Date.parse(q.createdAt);
    if (Number.isNaN(at)) continue;
    out.push({
      id: `quotation:${q.id}`,
      at,
      group: 'documents',
      mark: 'quotation',
      title: `Quotation ${q.number}${q.version > 1 ? ` · v${q.version}` : ''}`,
      detail: join(money(q.netAmount), q.propertyLabel, quotationStatusLabel(q.status)),
      by: q.preparedByName ?? 'Automatic',
      opens: 'quotations',
    });
  }

  for (const a of input.appointments ?? []) {
    const at = Date.parse(a.scheduledAt);
    /* History only — see the header. A booked Saturday visit is the Follow-ups
       tab's business until Saturday. */
    if (Number.isNaN(at) || at > input.nowMs) continue;
    out.push({
      id: `appointment:${a.id}`,
      at,
      group: 'followups',
      mark: 'appointment',
      title: appointmentKindLabel(a.kind),
      detail: join(appointmentStatusLabel(a.status), a.location, text(a.outcome)),
      by: a.ownerName ?? 'Automatic',
      opens: 'appointments',
    });
  }

  for (const f of input.followUps ?? []) {
    /* ⚠️ ONLY THE ONES THAT ARE OVER, and only at the hour they were finished.
       A pending follow-up has no moment in the past to sit at; dating it by
       `dueAt` would file tomorrow's chase under today. */
    if (!f.doneAt) continue;
    const at = Date.parse(f.doneAt);
    if (Number.isNaN(at)) continue;
    out.push({
      id: `followup:${f.id}`,
      at,
      group: 'followups',
      mark: 'followup',
      title: f.title,
      detail: join(`${channelLabel(f.channel)} follow-up`, text(f.outcomeNote)),
      by: f.doneByName ?? 'Automatic',
      opens: 'followups',
    });
  }

  /* Newest first, and ties broken by id so two things in the same second cannot
     swap places between one render and the next. */
  return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

export function feedCounts(entries: readonly FeedEntry[]): Readonly<Record<FeedFilter, number>> {
  const counts: Record<FeedFilter, number> = {
    all: entries.length,
    messages: 0,
    stage: 0,
    followups: 0,
    documents: 0,
    notes: 0,
  };
  for (const e of entries) counts[e.group] += 1;
  return counts;
}

export function filterFeed(
  entries: readonly FeedEntry[],
  filter: FeedFilter,
): readonly FeedEntry[] {
  return filter === 'all' ? entries : entries.filter((e) => e.group === filter);
}

export interface FeedDay {
  readonly key: string;
  readonly label: string;
  readonly entries: readonly FeedEntry[];
}

/** Today · Yesterday · 16 Sep 2026 — the reference's own headings. */
export function groupFeedByDay(entries: readonly FeedEntry[], nowMs: number): readonly FeedDay[] {
  const days: FeedDay[] = [];
  let current: { key: string; label: string; entries: FeedEntry[] } | null = null;
  for (const e of entries) {
    const key = dayKey(e.at);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(e.at, nowMs), entries: [] };
      days.push(current);
    }
    current.entries.push(e);
  }
  return days;
}
