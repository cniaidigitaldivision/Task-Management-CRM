/* ============================================================================
 * WHEN THE AGENT MAY BOOK — free times in the salesperson's own diary
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"make the build agent booking start with demo and visit.
 * Call is not working but demo, or you can say visit, will be working."*
 *
 * The agent offers times and books one, so every time it offers must be one
 * the salesperson can actually keep. The model is shown only these, and the
 * code refuses a booking outside them (agent-brain.ts) — a model that invents
 * "Sunday at 9 PM" books nothing.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *   · office hours: 10 AM – 6 PM, Monday to Saturday (the booking screen's own
 *     OFFICE), and the appointment must END by closing time;
 *   · at least two hours from now, and no more than seven days ahead;
 *   · on the half hour;
 *   · never overlapping anything already in the salesperson's diary.
 *
 * ⚠️ KARACHI, FIXED AT UTC+5. Pakistan has no daylight saving, so wall-clock
 * arithmetic is an offset, not a time-zone library — and "today" is Karachi's
 * today (karachi-not-utc).
 *
 * Pure: no clock, no database. `nowMs` and the diary come in as arguments.
 * ========================================================================= */

import { OFFICE } from '@/lib/domain/crm-office-hours';

export type AgentBookingKind = 'meeting' | 'site_visit';

/** How long each kind is booked for — the booking screen's own defaults. */
export const AGENT_MINUTES: Readonly<Record<AgentBookingKind, number>> = {
  meeting: 45,
  site_visit: 90,
};

export const AGENT_SLOT_RULES = {
  office: OFFICE,
  minNoticeMinutes: 120,
  horizonDays: 7,
  stepMinutes: 30,
} as const;

export interface Busy {
  readonly startMs: number;
  readonly minutes: number;
}

const KARACHI_MS = 5 * 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** "2026-09-23T15:00" in Karachi → the instant. Null when it is not that shape. */
export function parseKarachiLocal(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - KARACHI_MS;
  /* Date.UTC rolls 31 September into October; that is not what was written. */
  const back = new Date(ms + KARACHI_MS);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
  return ms;
}

/** The instant → "2026-09-23T15:00" in Karachi. */
export function toKarachiLocal(ms: number): string {
  return new Date(ms + KARACHI_MS).toISOString().slice(0, 16);
}

/** Every start time the rules allow for an appointment this long. */
export function freeStarts(
  nowMs: number,
  busy: readonly Busy[],
  minutes: number,
  rules: typeof AGENT_SLOT_RULES = AGENT_SLOT_RULES,
): number[] {
  const out: number[] = [];
  const earliest = nowMs + rules.minNoticeMinutes * MINUTE;
  const localToday = Math.floor((nowMs + KARACHI_MS) / DAY) * DAY; // Karachi midnight, as a "local" ms

  for (let day = 0; day <= rules.horizonDays; day++) {
    const localMidnight = localToday + day * DAY;
    const weekday = new Date(localMidnight).getUTCDay();
    if (!(rules.office.days as readonly number[]).includes(weekday)) continue;

    const open = localMidnight + rules.office.from * 3_600_000 - KARACHI_MS;
    const close = localMidnight + rules.office.to * 3_600_000 - KARACHI_MS;
    for (let start = open; start + minutes * MINUTE <= close; start += rules.stepMinutes * MINUTE) {
      if (start < earliest) continue;
      const end = start + minutes * MINUTE;
      const clash = busy.some((b) => start < b.startMs + b.minutes * MINUTE && b.startMs < end);
      if (!clash) out.push(start);
    }
  }
  return out;
}

/** Whether this exact start is one the rules allow. */
export function isFreeStart(
  atMs: number,
  nowMs: number,
  busy: readonly Busy[],
  minutes: number,
  rules: typeof AGENT_SLOT_RULES = AGENT_SLOT_RULES,
): boolean {
  return freeStarts(nowMs, busy, minutes, rules).includes(atMs);
}

const clock = (ms: number) => {
  const d = new Date(ms + KARACHI_MS);
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Wednesday 23 September at 3:00 PM" — an instant the way a client says it. */
export function describeKarachi(ms: number): string {
  const day = new Date(ms + KARACHI_MS).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${day} at ${clock(ms)}`;
}

/** "Monday 21 September 2026, 3:55 PM" — today, for a model that has no clock. */
export function describeToday(nowMs: number): string {
  const day = new Date(nowMs + KARACHI_MS).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const d = new Date(nowMs + KARACHI_MS);
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  return `${day}, ${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The free starts as lines a model can read and a client would say:
 * "Wednesday 23 September (2026-09-23): any half hour from 10:00 AM to 12:30 PM; 3:00 PM only".
 */
export function availabilityLines(starts: readonly number[], stepMinutes: number = AGENT_SLOT_RULES.stepMinutes): string[] {
  const byDay = new Map<string, number[]>();
  for (const s of starts) {
    const key = toKarachiLocal(s).slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  const lines: string[] = [];
  for (const [key, list] of byDay) {
    const ranges: Array<[number, number]> = [];
    for (const s of list) {
      const last = ranges[ranges.length - 1];
      if (last && s - last[1] === stepMinutes * MINUTE) last[1] = s;
      else ranges.push([s, s]);
    }
    const label = new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    /* ⚠️ "ANY HALF HOUR FROM … TO …", SPELLED OUT. Written as "10:00 AM to
       4:30 PM", the model read a client's "Saturday 12 baje" as outside it and
       offered 11:30 or 12:30 instead (dry run, 2026-09-21). */
    lines.push(
      `${label} (${key}): ${ranges
        .map(([a, b]) => (a === b ? `${clock(a)} only` : `any half hour from ${clock(a)} to ${clock(b)}`))
        .join('; ')}`,
    );
  }
  return lines;
}
