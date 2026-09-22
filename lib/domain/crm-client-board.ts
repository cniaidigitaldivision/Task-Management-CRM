/* ============================================================================
 * CLIENTS — the rules behind the page (pure: no React, no SQL, no clock)
 * ----------------------------------------------------------------------------
 * Owner's design, 2026-09-22. Every number and every chip on the page is
 * decided here, from rows `app.crm_client_board()` returned, so a test can pin
 * what the screen will say.
 *
 * ── ⚠️ A STATUS IS PARTLY A PERSON'S AND PARTLY A FACT ─────────────────────
 * A person sets prospect · onboarding · active · dormant. Two things are then
 * computed on read, because they are facts nobody should have to remember to
 * record:
 *   · NEEDS ATTENTION — something is overdue, an invoice is past due, or the
 *     client wrote last and is waiting. It outranks the stored status, and the
 *     screen always says WHICH of those it is.
 *   · DORMANT — an "active" client nobody has spoken to in 45 days.
 * Archived outranks both: an archived client is out of the way on purpose.
 *
 * ── ⚠️ NO INVENTED FIGURE ──────────────────────────────────────────────────
 * A "from last month" comparison is shown only where last month can actually be
 * reconstructed: total clients and new clients, from creation and archive
 * dates. "Active", "needs attention" and "outstanding" have no history in the
 * data, so they carry a plain caption instead of a made-up trend.
 * ========================================================================= */

export type StoredStatus = 'prospect' | 'onboarding' | 'active' | 'dormant';
export type DisplayStatus = StoredStatus | 'attention' | 'archived';
export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'grey' | 'violet';

export interface ClientLike {
  readonly id: string;
  readonly refNo: number;
  readonly name: string;
  readonly company: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly source: string | null;
  readonly preferredChannel: 'whatsapp' | 'call' | 'email' | null;
  readonly status: StoredStatus;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly primaryProjectId: string | null;
  readonly primaryProjectName: string | null;
  readonly projectNames: readonly string[];
  readonly openDeals: number;
  readonly lastContactAt: string | null;
  readonly lastDirection: 'inbound' | 'outbound' | null;
  readonly nextAt: string | null;
  readonly nextKind: string | null;
  readonly nextLabel: string | null;
  readonly properties: number;
  readonly quotations: number;
  readonly appointments: number;
  readonly bookings: number;
  readonly invoices: number;
  readonly unpaidInvoices: number;
  readonly unpaidAmount: number;
  readonly overdueInvoices: number;
  readonly bookedValue: number;
  readonly quotedValue: number;
}

const KARACHI_MS = 5 * 3_600_000;
const DAY = 86_400_000;
export const DORMANT_AFTER_DAYS = 45;

export const karachiDay = (ms: number) => new Date(ms + KARACHI_MS).toISOString().slice(0, 10);
const daysBetween = (fromMs: number, toMs: number) =>
  Math.round((Date.parse(karachiDay(toMs)) - Date.parse(karachiDay(fromMs))) / DAY);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Sep" — built by hand, because ICU writes "Sept" in en-GB. */
export function shortDay(iso: string): string {
  const d = new Date(Date.parse(iso) + KARACHI_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* ── Status ─────────────────────────────────────────────────────────────── */

export const STATUS_LOOK: Record<DisplayStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'green' },
  prospect: { label: 'Prospect', tone: 'blue' },
  onboarding: { label: 'Onboarding', tone: 'violet' },
  attention: { label: 'Needs attention', tone: 'amber' },
  dormant: { label: 'Dormant', tone: 'grey' },
  archived: { label: 'Archived', tone: 'grey' },
};

export const STORED_STATUS_OPTIONS: ReadonlyArray<{ value: StoredStatus; label: string }> = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'active', label: 'Active' },
  { value: 'dormant', label: 'Dormant' },
];

export interface Attention {
  readonly because: 'overdue' | 'invoice' | 'waiting';
  readonly text: string;
}

/**
 * Why this client needs somebody now — or null.
 *
 * ⚠️ IN THIS ORDER: an overdue promise first, then money past due, then a
 * client waiting on us. The first one found is the sentence on the row.
 */
export function attention(c: ClientLike, nowMs: number): Attention | null {
  if (c.nextAt && c.nextKind !== 'appointment') {
    const late = daysBetween(Date.parse(c.nextAt), nowMs);
    if (late > 0) {
      return { because: 'overdue', text: `${kindWord(c.nextKind, c.nextLabel)} overdue · ${late} day${late === 1 ? '' : 's'}` };
    }
  }
  if (c.overdueInvoices > 0) {
    return { because: 'invoice', text: `Invoice overdue${c.overdueInvoices > 1 ? ` · ${c.overdueInvoices}` : ''}` };
  }
  if (c.lastDirection === 'inbound') {
    return { because: 'waiting', text: 'Waiting for your reply' };
  }
  return null;
}

export function displayStatus(c: ClientLike, nowMs: number): DisplayStatus {
  if (c.archivedAt) return 'archived';
  if (attention(c, nowMs)) return 'attention';
  if (c.status === 'dormant') return 'dormant';
  if (c.status === 'active' && quietDays(c, nowMs) >= DORMANT_AFTER_DAYS) return 'dormant';
  return c.status;
}

/** Days since anybody spoke — or since they were added, if nobody ever has. */
export function quietDays(c: ClientLike, nowMs: number): number {
  const since = Date.parse(c.lastContactAt ?? c.createdAt);
  return Math.max(0, daysBetween(since, nowMs));
}

const KIND_WORD: Record<string, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  site_visit: 'Site visit',
  task: 'Task',
  follow_up: 'Follow-up',
  appointment: 'Appointment',
};

function kindWord(kind: string | null, label: string | null): string {
  if (kind === 'task' && label) return label.length > 22 ? `${label.slice(0, 21)}…` : label;
  return KIND_WORD[kind ?? ''] ?? 'Follow-up';
}

/**
 * The "Next action" cell — the soonest thing owed, in a person's words.
 *
 * ⚠️ WHEN NOTHING IS OWED IT SAYS HOW QUIET IT IS, not "—". "No activity · 45
 * days" is the thing a manager scanning the list needs to see.
 */
export function nextLine(c: ClientLike, nowMs: number): { text: string; when: string | null; tone: Tone } {
  const a = attention(c, nowMs);
  if (a && a.because === 'overdue') return { text: a.text, when: null, tone: 'red' };
  if (c.nextAt) {
    const day = karachiDay(Date.parse(c.nextAt));
    const today = karachiDay(nowMs);
    const when = day === today ? 'Today' : day === karachiDay(nowMs + DAY) ? 'Tomorrow' : shortDay(c.nextAt);
    return { text: kindWord(c.nextKind, c.nextLabel), when, tone: day === today ? 'red' : 'grey' };
  }
  if (a) return { text: a.text, when: null, tone: 'amber' };
  const quiet = quietDays(c, nowMs);
  return { text: 'No activity', when: `${quiet} day${quiet === 1 ? '' : 's'}`, tone: 'grey' };
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

export type TabKey = 'all' | 'active' | 'prospect' | 'attention' | 'dormant' | 'archived';

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All clients' },
  { key: 'active', label: 'Active' },
  { key: 'prospect', label: 'Prospects' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'dormant', label: 'Dormant' },
  { key: 'archived', label: 'Archived' },
];

export function inTab(c: ClientLike, tab: TabKey, nowMs: number): boolean {
  const s = displayStatus(c, nowMs);
  if (tab === 'archived') return s === 'archived';
  if (s === 'archived') return false;
  if (tab === 'all') return true;
  /* ⚠️ Onboarding is an active relationship, just a new one. */
  if (tab === 'active') return s === 'active' || s === 'onboarding';
  return s === tab;
}

/* ── Filters ────────────────────────────────────────────────────────────── */

export interface Filters {
  readonly q: string;
  readonly project: string;
  readonly owner: string;
  readonly status: DisplayStatus | 'all';
  readonly source: string;
  readonly channel: string;
  readonly city: string;
  readonly unpaidOnly: boolean;
  readonly quietDays: number;
}

export const NO_FILTERS: Filters = {
  q: '',
  project: 'all',
  owner: 'all',
  status: 'all',
  source: 'all',
  channel: 'all',
  city: 'all',
  unpaidOnly: false,
  quietDays: 0,
};

/** How many of the "More filters" are set — the badge on the button. */
export function moreFilterCount(f: Filters): number {
  return (
    (f.source !== 'all' ? 1 : 0) +
    (f.channel !== 'all' ? 1 : 0) +
    (f.city !== 'all' ? 1 : 0) +
    (f.unpaidOnly ? 1 : 0) +
    (f.quietDays > 0 ? 1 : 0)
  );
}

const digits = (s: string) => s.replace(/\D/g, '');

export function applyFilters<T extends ClientLike>(rows: readonly T[], f: Filters, nowMs: number): T[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const qDigits = digits(f.q);
  return rows.filter((c) => {
    if (f.project !== 'all' && !c.projectNames.includes(f.project)) return false;
    if (f.owner !== 'all' && (f.owner === 'none' ? c.ownerId !== null : c.ownerId !== f.owner)) return false;
    if (f.status !== 'all' && displayStatus(c, nowMs) !== f.status) return false;
    if (f.source !== 'all' && (c.source ?? '') !== f.source) return false;
    if (f.channel !== 'all' && (c.preferredChannel ?? '') !== f.channel) return false;
    if (f.city !== 'all' && (c.city ?? '') !== f.city) return false;
    if (f.unpaidOnly && c.unpaidInvoices === 0) return false;
    if (f.quietDays > 0 && quietDays(c, nowMs) < f.quietDays) return false;
    if (words.length) {
      const hay = [c.name, c.company, c.email, c.city, ...c.projectNames, `cli-${String(c.refNo).padStart(5, '0')}`]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      /* A phone is matched on its digits, so "0300 123" finds "+92 300 123…". */
      const phoneHit = qDigits.length >= 4 && c.phoneE164 ? digits(c.phoneE164).includes(qDigits.replace(/^0/, '')) : false;
      if (!phoneHit && !words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** What needs somebody first, then what is owed soonest, then the most recent. */
export function sortClients<T extends ClientLike>(rows: readonly T[], nowMs: number): T[] {
  const rank = (c: T) => {
    const s = displayStatus(c, nowMs);
    return s === 'attention' ? 0 : s === 'archived' ? 3 : s === 'dormant' ? 2 : 1;
  };
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    const an = a.nextAt ? Date.parse(a.nextAt) : Infinity;
    const bn = b.nextAt ? Date.parse(b.nextAt) : Infinity;
    if (an !== bn) return an - bn;
    return Date.parse(b.lastContactAt ?? b.createdAt) - Date.parse(a.lastContactAt ?? a.createdAt);
  });
}

/* ── The five cards ─────────────────────────────────────────────────────── */

export interface Card {
  readonly value: number;
  /** Percentage change on last month — only where last month can be rebuilt. */
  readonly delta: number | null;
  readonly caption: string;
}

export interface Cards {
  readonly total: Card;
  readonly active: Card;
  readonly fresh: Card;
  readonly attention: Card;
  readonly outstanding: Card;
}

function monthStart(nowMs: number): number {
  const d = new Date(nowMs + KARACHI_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - KARACHI_MS;
}
function prevMonthStart(nowMs: number): number {
  const d = new Date(nowMs + KARACHI_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) - KARACHI_MS;
}

const pct = (now: number, then: number): number | null => (then === 0 ? null : Math.round(((now - then) / then) * 100));

export function cards(rows: readonly ClientLike[], nowMs: number): Cards {
  const start = monthStart(nowMs);
  const prev = prevMonthStart(nowMs);
  const live = rows.filter((c) => !c.archivedAt);

  /* ⚠️ LAST MONTH REBUILT FROM DATES, not remembered: every client created
     before this month began, less those already archived by then. */
  const totalThen = rows.filter(
    (c) => Date.parse(c.createdAt) < start && (!c.archivedAt || Date.parse(c.archivedAt) >= start),
  ).length;
  const freshNow = live.filter((c) => Date.parse(c.createdAt) >= start).length;
  const freshThen = rows.filter((c) => {
    const t = Date.parse(c.createdAt);
    return t >= prev && t < start;
  }).length;

  let active = 0;
  let onboarding = 0;
  let needs = 0;
  let overdueCalls = 0;
  let overdueInvoices = 0;
  let waiting = 0;
  let owed = 0;
  let unpaid = 0;
  for (const c of live) {
    const s = displayStatus(c, nowMs);
    if (s === 'active') active += 1;
    if (s === 'onboarding') onboarding += 1;
    if (s === 'attention') {
      needs += 1;
      const a = attention(c, nowMs);
      if (a?.because === 'overdue') overdueCalls += 1;
      else if (a?.because === 'invoice') overdueInvoices += 1;
      else waiting += 1;
    }
    owed += c.unpaidAmount;
    unpaid += c.unpaidInvoices;
  }

  const parts = [
    overdueCalls ? `${overdueCalls} overdue` : null,
    overdueInvoices ? `${overdueInvoices} unpaid late` : null,
    waiting ? `${waiting} waiting` : null,
  ].filter(Boolean);

  return {
    /* ⚠️ WITH NO LAST MONTH, SAY SO. "from last month" beside no number read as
       a missing figure; when nothing existed then, the caption says that. */
    total: {
      value: live.length,
      delta: pct(live.length, totalThen),
      caption: totalThen === 0 ? (live.length ? 'all added this month' : 'none yet') : 'from last month',
    },
    active: {
      value: active + onboarding,
      delta: null,
      caption: onboarding ? `${onboarding} onboarding` : `of ${live.length} clients`,
    },
    fresh: {
      value: freshNow,
      delta: pct(freshNow, freshThen),
      caption: freshThen === 0 ? 'none last month' : 'from last month',
    },
    attention: { value: needs, delta: null, caption: parts.length ? parts.join(' · ') : 'nothing overdue' },
    outstanding: {
      value: owed,
      delta: null,
      caption: unpaid ? `${unpaid} unpaid invoice${unpaid === 1 ? '' : 's'}` : 'nothing owed',
    },
  };
}

/* ── Words for money, people and channels ───────────────────────────────── */

/** "PKR 4.5M" · "PKR 850K" · "PKR 1,200" — a column, not a ledger. */
export function money(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `PKR ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (Math.abs(v) >= 1_000) return `PKR ${Math.round(v / 1_000)}K`;
  return `PKR ${v.toLocaleString('en-US')}`;
}

/** Booked if there is any; otherwise what was quoted, marked as such. */
export function valueOf(c: ClientLike): { amount: number; kind: 'booked' | 'quoted' | 'none' } {
  if (c.bookedValue > 0) return { amount: c.bookedValue, kind: 'booked' };
  if (c.quotedValue > 0) return { amount: c.quotedValue, kind: 'quoted' };
  return { amount: 0, kind: 'none' };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

const AVATAR: readonly Tone[] = ['blue', 'violet', 'green', 'amber', 'red'];

/** Stable per client, so the same person keeps the same colour everywhere. */
export function avatarTone(id: string): Tone {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export const refLabel = (n: number) => `CLI-${String(n).padStart(5, '0')}`;

export const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', call: 'Phone call', email: 'Email' };

export const SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'manual', label: 'Added by hand' },
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Website' },
  { value: 'meta_lead_ad', label: 'Meta lead ad' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google', label: 'Google' },
  { value: 'linkedin', label: 'LinkedIn' },
];

export const sourceLabel = (s: string | null) => SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? (s ? s : '—');

/** "+92 300 123 8726" — spaced for reading; the value itself stays E.164. */
export function phoneLabel(e164: string | null): string {
  if (!e164) return '—';
  const m = /^\+92(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+92 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/* ── Export ─────────────────────────────────────────────────────────────── */

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  /* ⚠️ A LEADING = + - @ IS A FORMULA TO A SPREADSHEET. A client called
     "=HYPERLINK(…)" must arrive as text, not run. */
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: readonly ClientLike[], nowMs: number): string {
  const head = [
    'Client number', 'Name', 'Company', 'Phone', 'Email', 'City', 'Projects', 'Owner', 'Relationship',
    'Preferred channel', 'Source', 'Booked value (PKR)', 'Quoted value (PKR)', 'Open deals',
    'Unpaid invoices', 'Outstanding (PKR)', 'Last contact', 'Next action',
  ];
  const lines = [head.map(cell).join(',')];
  for (const c of rows) {
    const n = nextLine(c, nowMs);
    lines.push(
      [
        refLabel(c.refNo), c.name, c.company, c.phoneE164, c.email, c.city, c.projectNames.join('; '),
        c.ownerName, STATUS_LOOK[displayStatus(c, nowMs)].label,
        c.preferredChannel ? CHANNEL_LABEL[c.preferredChannel] : '', sourceLabel(c.source),
        Math.round(c.bookedValue), Math.round(c.quotedValue), c.openDeals, c.unpaidInvoices,
        Math.round(c.unpaidAmount), c.lastContactAt ? karachiDay(Date.parse(c.lastContactAt)) : '',
        n.when ? `${n.text} · ${n.when}` : n.text,
      ]
        .map(cell)
        .join(','),
    );
  }
  /* A BOM, so Excel opens Urdu names and "·" as UTF-8 instead of mojibake. */
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ── Import ─────────────────────────────────────────────────────────────── */

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) out.push(row);
  return out;
}

export type ImportField = 'name' | 'phone' | 'email' | 'company' | 'city' | 'source' | 'status' | 'channel' | 'notes';

const HEADER_WORDS: ReadonlyArray<[ImportField, RegExp]> = [
  ['name', /^(full ?name|name|client|client name|customer|contact)$/i],
  ['phone', /^(phone|mobile|cell|whatsapp|contact number|phone number|number)$/i],
  ['email', /^(e-?mail|email address)$/i],
  ['company', /^(company|organisation|organization|business|firm)$/i],
  ['city', /^(city|location|town|area)$/i],
  ['source', /^(source|lead source|channel source)$/i],
  ['status', /^(status|relationship|stage)$/i],
  ['channel', /^(preferred channel|channel|contact via)$/i],
  ['notes', /^(notes?|comments?|remarks?)$/i],
];

/** Which column is which, read from the header row. */
export function mapColumns(header: readonly string[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const t = h.trim();
    for (const [field, re] of HEADER_WORDS) {
      if (map[field] === undefined && re.test(t)) {
        map[field] = i;
        break;
      }
    }
  });
  return map;
}

export interface ImportRow {
  readonly line: number;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly company: string;
  readonly city: string;
  readonly source: string;
  readonly status: StoredStatus;
  readonly channel: 'whatsapp' | 'call' | 'email' | null;
  readonly notes: string;
  /** What is wrong with the row as it stands — empty means it can go in. */
  readonly problems: readonly string[];
}

const STATUS_WORDS: Record<string, StoredStatus> = {
  prospect: 'prospect',
  lead: 'prospect',
  onboarding: 'onboarding',
  new: 'onboarding',
  active: 'active',
  client: 'active',
  dormant: 'dormant',
  inactive: 'dormant',
};

export function importRows(table: readonly string[][]): { rows: ImportRow[]; missing: ImportField[] } {
  if (table.length === 0) return { rows: [], missing: ['name'] };
  const map = mapColumns(table[0]);
  const missing: ImportField[] = [];
  if (map.name === undefined) missing.push('name');
  if (map.phone === undefined && map.email === undefined) missing.push('phone');
  const get = (r: readonly string[], f: ImportField) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim());

  const rows = table.slice(1).map((r, i) => {
    const name = get(r, 'name');
    const phone = get(r, 'phone');
    const email = get(r, 'email').toLowerCase();
    const status = STATUS_WORDS[get(r, 'status').toLowerCase()] ?? 'active';
    const ch = get(r, 'channel').toLowerCase();
    const channel = ch.includes('whats') ? 'whatsapp' : ch.includes('mail') ? 'email' : ch.includes('call') || ch.includes('phone') ? 'call' : null;
    const src = get(r, 'source').toLowerCase().replace(/[\s-]+/g, '_');
    const source = SOURCE_OPTIONS.some((o) => o.value === src) ? src : 'manual';
    const problems: string[] = [];
    if (!name) problems.push('no name');
    if (!phone && !email) problems.push('no phone or email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('email looks wrong');
    return {
      line: i + 2,
      name,
      phone,
      email,
      company: get(r, 'company'),
      city: get(r, 'city'),
      source,
      status,
      channel,
      notes: get(r, 'notes'),
      problems,
    } satisfies ImportRow;
  });
  return { rows, missing };
}
