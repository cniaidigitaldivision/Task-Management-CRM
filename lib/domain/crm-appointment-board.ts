/* ============================================================================
 * THE APPOINTMENTS PAGE'S RULES — pure, so every card and filter is testable
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: cards for Today / Upcoming / Awaiting confirmation /
 * Completed this week, filters (type, status, date range, project, search),
 * saved views, and a status on every row.
 *
 * ⚠️ WHAT A STATUS MEANS, decided once here:
 *   · needs_recording — its time has passed and nobody recorded it (the
 *                       commonest way a lead goes quiet — it leads the list);
 *   · confirmed       — the client tapped Confirm (222);
 *   · awaiting        — the confirmation went and the client has not answered;
 *   · scheduled       — booked, nothing asked of the client yet;
 *   · completed / cancelled / no_show (old rows only; 235 retired the button).
 *
 * ⚠️ KARACHI DAYS (UTC+5, no daylight saving). "Today" and "this week" are the
 * division's, not the browser's (karachi-not-utc).
 * ========================================================================= */

export interface BoardRowLike {
  readonly id: string;
  readonly refNo: number;
  readonly leadName: string | null;
  readonly projectName: string | null;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly confirmationSent: boolean;
  readonly propertyCode: string | null;
  readonly quotationNumber: string | null;
  readonly location: string | null;
}

export type DisplayStatus =
  | 'needs_recording'
  | 'confirmed'
  | 'awaiting'
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type Tone = 'green' | 'amber' | 'blue' | 'grey' | 'red' | 'gold';

export const STATUS_LOOK: Readonly<Record<DisplayStatus, { label: string; tone: Tone }>> = {
  needs_recording: { label: 'Needs recording', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'green' },
  awaiting: { label: 'Client confirmation needed', tone: 'amber' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  completed: { label: 'Completed', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  no_show: { label: 'Did not come', tone: 'red' },
};

const KARACHI_MS = 5 * 3_600_000;
const DAY = 86_400_000;

export const apptRef = (refNo: number) => `APPT-${refNo}`;

/** "2026-09-21" — the Karachi day of an instant. */
export function karachiDay(ms: number): string {
  return new Date(ms + KARACHI_MS).toISOString().slice(0, 10);
}

/** Monday and Sunday of the Karachi week containing this day. */
export function weekOf(day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const from = new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + (6 - dow) * DAY).toISOString().slice(0, 10);
  return { from, to };
}

export function displayStatus(a: BoardRowLike, nowMs: number): DisplayStatus {
  if (a.status === 'completed') return 'completed';
  if (a.status === 'cancelled') return 'cancelled';
  if (a.status === 'no_show') return 'no_show';
  if (Date.parse(a.scheduledAt) <= nowMs) return 'needs_recording';
  if (a.status === 'confirmed') return 'confirmed';
  return a.confirmationSent ? 'awaiting' : 'scheduled';
}

const open = (s: DisplayStatus) => s === 'confirmed' || s === 'awaiting' || s === 'scheduled';

export interface CardCounts {
  readonly today: number;
  readonly upcoming: number;
  readonly awaiting: number;
  readonly completedThisWeek: number;
  readonly needsRecording: number;
}

export function cardCounts(rows: readonly BoardRowLike[], nowMs: number): CardCounts {
  const today = karachiDay(nowMs);
  const week = weekOf(today);
  let t = 0, up = 0, aw = 0, done = 0, owed = 0;
  for (const a of rows) {
    const s = displayStatus(a, nowMs);
    const day = karachiDay(Date.parse(a.scheduledAt));
    if (day === today && s !== 'cancelled') t++;
    if (open(s)) up++;
    if (s === 'awaiting') aw++;
    if (s === 'completed' && day >= week.from && day <= week.to) done++;
    if (s === 'needs_recording') owed++;
  }
  return { today: t, upcoming: up, awaiting: aw, completedThisWeek: done, needsRecording: owed };
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

export type StatusFilter = 'all' | 'upcoming' | DisplayStatus;

export interface BoardFilters {
  readonly q: string;
  readonly kind: 'all' | 'site_visit' | 'office_visit' | 'meeting' | 'call';
  readonly status: StatusFilter;
  /** "YYYY-MM-DD", Karachi — empty means open on that side. */
  readonly from: string;
  readonly to: string;
  readonly project: string;
}

export const NO_FILTERS: BoardFilters = { q: '', kind: 'all', status: 'all', from: '', to: '', project: 'all' };

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'needs_recording', label: 'Needs recording' },
  { value: 'awaiting', label: 'Client confirmation needed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** The list's own title, true to what it is showing. */
export function listTitle(status: StatusFilter): string {
  switch (status) {
    case 'upcoming':
      return 'Upcoming appointments';
    case 'all':
      return 'All appointments';
    default:
      return `${STATUS_LOOK[status].label} appointments`.replace('Client confirmation needed appointments', 'Awaiting confirmation');
  }
}

export function applyFilters<T extends BoardRowLike>(rows: readonly T[], f: BoardFilters, nowMs: number): T[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((a) => {
    const s = displayStatus(a, nowMs);
    if (f.kind !== 'all' && a.kind !== f.kind) return false;
    if (f.status === 'upcoming' ? !open(s) : f.status !== 'all' && s !== f.status) return false;
    if (f.project !== 'all' && (a.projectName ?? '') !== f.project) return false;
    const day = karachiDay(Date.parse(a.scheduledAt));
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (words.length) {
      const hay = [apptRef(a.refNo), a.leadName, a.projectName, a.propertyCode, a.quotationNumber, a.location]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/**
 * The list's order: what is owed first (oldest first), then what is coming
 * (soonest first), then the past (most recent first).
 */
export function sortForList<T extends BoardRowLike>(rows: readonly T[], nowMs: number): T[] {
  const rank = (a: T) => {
    const s = displayStatus(a, nowMs);
    return s === 'needs_recording' ? 0 : open(s) ? 1 : 2;
  };
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const ta = Date.parse(a.scheduledAt);
    const tb = Date.parse(b.scheduledAt);
    return rank(a) === 2 ? tb - ta : ta - tb;
  });
}

/* ── Words for the details panel ─────────────────────────────────────────── */

const clock = (ms: number) => {
  const d = new Date(ms + KARACHI_MS);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const meridiem = (ms: number) => (new Date(ms + KARACHI_MS).getUTCHours() < 12 ? 'AM' : 'PM');

/** "19 September 2026, 11:00 – 11:30 AM PKT" (or "11:30 AM – 1:00 PM PKT" across noon). */
export function timeRange(scheduledAt: string, minutes: number): string {
  const start = Date.parse(scheduledAt);
  const end = start + minutes * 60_000;
  const day = new Date(start + KARACHI_MS).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const same = meridiem(start) === meridiem(end);
  return `${day}, ${clock(start)}${same ? '' : ` ${meridiem(start)}`} – ${clock(end)} ${meridiem(end)} PKT`;
}

/* ⚠️ FIXED NAMES, NOT toLocaleDateString. ICU spells September "Sept" in one
   version and "Sep" in another, and the server and the browser disagreeing is a
   hydration error. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(ms: number): string {
  const d = new Date(ms + KARACHI_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The row's date line: "Today" / "Tomorrow" / "19 Sep 2026", and "11:00 AM". */
export function dateLines(scheduledAt: string, nowMs: number): { day: string; time: string } {
  const ms = Date.parse(scheduledAt);
  const day = karachiDay(ms);
  const today = karachiDay(nowMs);
  const tomorrow = karachiDay(nowMs + DAY);
  const yesterday = karachiDay(nowMs - DAY);
  const label =
    day === today
      ? 'Today'
      : day === tomorrow
        ? 'Tomorrow'
        : day === yesterday
          ? 'Yesterday'
          : shortDate(ms);
  return { day: label, time: `${clock(ms)} ${meridiem(ms)}` };
}

/** "WhatsApp · 2 hours before · Scheduled" — or why there is none. */
export function reminderLine(
  scheduledAt: string,
  reminderStatus: string | null,
  reminderAt: string | null,
): string {
  if (!reminderStatus || !reminderAt) return 'No reminder';
  const mins = Math.round((Date.parse(scheduledAt) - Date.parse(reminderAt)) / 60_000);
  /* ⚠️ ROUNDED THE WAY A PERSON SAYS IT. A reminder queued a couple of minutes
     after the booking reads "118 minutes before" to the minute (owner's
     screenshot, 2026-09-21) — it was set as two hours. */
  const days = Math.round(mins / 1440);
  const hours = Math.round(mins / 60);
  const before =
    days >= 1 && Math.abs(mins - days * 1440) <= 30
      ? `${days} day${days === 1 ? '' : 's'} before`
      : hours >= 1 && Math.abs(mins - hours * 60) <= 5
        ? `${hours} hour${hours === 1 ? '' : 's'} before`
        : `${mins} minutes before`;
  const state =
    reminderStatus === 'done'
      ? 'Sent'
      : reminderStatus === 'planned' || reminderStatus === 'due'
        ? 'Scheduled'
        : reminderStatus === 'failed'
          ? 'Could not be sent'
          : 'Not sent';
  return `WhatsApp · ${before} · ${state}`;
}

/* ── Saved views ─────────────────────────────────────────────────────────── */

export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: BoardFilters;
}

/** The views every salesperson starts with; their own are added beside them. */
export function presetViews(nowMs: number): SavedView[] {
  const today = karachiDay(nowMs);
  const week = weekOf(today);
  return [
    { id: 'all', name: 'Everything', filters: NO_FILTERS },
    { id: 'today', name: 'Today', filters: { ...NO_FILTERS, from: today, to: today } },
    { id: 'week', name: 'This week', filters: { ...NO_FILTERS, from: week.from, to: week.to } },
    { id: 'owed', name: 'Needs recording', filters: { ...NO_FILTERS, status: 'needs_recording' } },
    { id: 'awaiting', name: 'Awaiting confirmation', filters: { ...NO_FILTERS, status: 'awaiting' } },
    { id: 'visits', name: 'Site visits ahead', filters: { ...NO_FILTERS, kind: 'site_visit', status: 'upcoming' } },
  ];
}

export const sameFilters = (a: BoardFilters, b: BoardFilters) =>
  a.q === b.q && a.kind === b.kind && a.status === b.status && a.from === b.from && a.to === b.to && a.project === b.project;
