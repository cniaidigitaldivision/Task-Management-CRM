/* ============================================================================
 * RECURRING TASKS
 * ----------------------------------------------------------------------------
 * ── THE NEXT ONE IS CREATED WHEN THIS ONE CLOSES ─────────────────────────────
 * Not by a scheduler. There is no cron in this system, and adding one to create
 * tasks nobody asked for at 3am is a large amount of infrastructure for a
 * feature whose failure mode is a queue full of unfinished weekly reports.
 *
 * Spawn-on-complete has a property a scheduler does not: the recurrence cannot
 * outrun the person doing it. If the weekly report is three weeks late there is
 * one task, three weeks old — which is the truth — rather than four tasks
 * implying four separate pieces of work. It also means an unfinished recurring
 * task never silently duplicates capacity load.
 *
 * The cost, stated plainly: cancelling the current instance ends the series
 * unless it is cancelled deliberately as "done for this period". That is why
 * `nextOccurrence` is exported and the action decides — the rule is here, the
 * policy is at the call site.
 *
 * ── THE RULE IS A SUBSET OF RFC 5545 ─────────────────────────────────────────
 * `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH` — a real standard's syntax rather than a
 * private dialect, so an export or a calendar integration later reads it
 * without a translation layer. Only the parts used are supported, and anything
 * else is rejected on the way in rather than silently ignored.
 * ========================================================================= */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** Sunday-first, matching `Date.getDay()`. */
export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export const WEEKDAY_LABEL: Record<WeekdayCode, string> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
};

export interface RecurrenceRule {
  readonly freq: Frequency;
  /** Every N periods. 1 = every week, 2 = every other week. */
  readonly interval: number;
  /** WEEKLY only. Empty means "the same weekday as the task it came from". */
  readonly byDay: readonly WeekdayCode[];
  /** MONTHLY only. 1–31, or null for "the same day of the month". */
  readonly byMonthDay: number | null;
}

export const MAX_INTERVAL = 52;

export type ParseResult =
  | { readonly ok: true; readonly rule: RecurrenceRule }
  | { readonly ok: false; readonly message: string };

export function parseRecurrence(raw: string | null | undefined): ParseResult {
  const text = (raw ?? '').trim().toUpperCase();
  if (!text) return { ok: false, message: 'No repeat rule.' };

  const parts = new Map<string, string>();
  for (const chunk of text.split(';')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    if (eq < 1) return { ok: false, message: `“${chunk}” is not a name=value pair.` };
    parts.set(chunk.slice(0, eq), chunk.slice(eq + 1));
  }

  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    return { ok: false, message: 'A repeat has to be daily, weekly or monthly.' };
  }

  const rawInterval = parts.get('INTERVAL') ?? '1';
  const interval = Number(rawInterval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    return { ok: false, message: `Repeat every N has to be a whole number from 1 to ${MAX_INTERVAL}.` };
  }

  let byDay: WeekdayCode[] = [];
  const rawByDay = parts.get('BYDAY');
  if (rawByDay) {
    if (freq !== 'WEEKLY') {
      return { ok: false, message: 'Particular weekdays only make sense on a weekly repeat.' };
    }
    for (const code of rawByDay.split(',')) {
      if (!WEEKDAY_CODES.includes(code as WeekdayCode)) {
        return { ok: false, message: `“${code}” is not a weekday.` };
      }
      if (!byDay.includes(code as WeekdayCode)) byDay.push(code as WeekdayCode);
    }
    byDay = byDay.sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b));
  }

  let byMonthDay: number | null = null;
  const rawMonthDay = parts.get('BYMONTHDAY');
  if (rawMonthDay) {
    if (freq !== 'MONTHLY') {
      return { ok: false, message: 'A day of the month only makes sense on a monthly repeat.' };
    }
    byMonthDay = Number(rawMonthDay);
    if (!Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31) {
      return { ok: false, message: 'The day of the month has to be between 1 and 31.' };
    }
  }

  return { ok: true, rule: { freq, interval, byDay, byMonthDay } };
}

export function formatRecurrence(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.freq === 'MONTHLY' && rule.byMonthDay !== null) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  }
  return parts.join(';');
}

/** For a screen. "Every 2 weeks on Monday and Thursday". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const every =
    rule.interval === 1
      ? { DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month' }[rule.freq]
      : `Every ${rule.interval} ${{ DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months' }[rule.freq]}`;

  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    const names = rule.byDay.map((d) => WEEKDAY_LABEL[d]);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${every} on ${list}`;
  }

  if (rule.freq === 'MONTHLY' && rule.byMonthDay !== null) {
    return `${every} on day ${rule.byMonthDay}`;
  }

  return every;
}

/* ==========================================================================
 * THE NEXT DATE
 * ========================================================================== */

/** `YYYY-MM-DD` in and out — a task's dates are days, not instants. */
function toParts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The next date after `fromIso` that the rule lands on.
 *
 * ── UTC THROUGHOUT, AND THAT IS DELIBERATE ───────────────────────────────────
 * `new Date('2026-03-29')` is midnight UTC, but `getDay()` on it answers in the
 * local zone. In a zone behind UTC that is the previous day, so "every Monday"
 * quietly becomes every Sunday for half the world. Every read and write here is
 * UTC, and the value never leaves as anything but a date string.
 *
 * ── MONTHLY OVERFLOW CLAMPS ──────────────────────────────────────────────────
 * The 31st in a 30-day month becomes the 30th, not the 1st of the next. Rolling
 * forward would drift the whole series by a day every short month, and a
 * monthly task that arrives on the 1st when it was set for the 31st looks like
 * a bug to the person receiving it.
 */
export function nextOccurrence(rule: RecurrenceRule, fromIso: string): string | null {
  const parts = toParts(fromIso);
  if (!parts) return null;

  const from = Date.UTC(parts.y, parts.m - 1, parts.d);

  if (rule.freq === 'DAILY') {
    const next = new Date(from + rule.interval * 86_400_000);
    return toIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }

  if (rule.freq === 'WEEKLY') {
    if (rule.byDay.length === 0) {
      const next = new Date(from + rule.interval * 7 * 86_400_000);
      return toIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    }

    /* Within the current week, the next selected weekday. Otherwise jump
       `interval` weeks to that week's first selected day — so "every other
       Monday and Thursday" means Mon, Thu, then a fortnight later, not
       Mon, Thu, Mon+14. */
    const wanted = rule.byDay.map((d) => WEEKDAY_CODES.indexOf(d)).sort((a, b) => a - b);
    const currentDow = new Date(from).getUTCDay();

    const laterThisWeek = wanted.find((dow) => dow > currentDow);
    if (laterThisWeek !== undefined) {
      const next = new Date(from + (laterThisWeek - currentDow) * 86_400_000);
      return toIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    }

    const startOfWeek = from - currentDow * 86_400_000;
    const target = startOfWeek + rule.interval * 7 * 86_400_000 + wanted[0] * 86_400_000;
    const next = new Date(target);
    return toIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }

  /* MONTHLY */
  const wantedDay = rule.byMonthDay ?? parts.d;
  let y = parts.y;
  let m = parts.m + rule.interval;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return toIso(y, m, Math.min(wantedDay, daysInMonth(y, m)));
}

/* ⚠️ A daily series anchored two years back needs ~730 steps to walk forward.
   800 is comfortably past that and still trivial to compute; a series older
   than that has stopped being a series anybody is running. The cap exists so a
   corrupt anchor cannot spin the nightly runner forever. */
const MAX_WALK_STEPS = 800;

/**
 * Does `target` fall on an occurrence of this rule, walking forward from
 * `anchor`?
 *
 * ── WHY THE RUNNER NEEDS THIS AND `nextOccurrence` IS NOT ENOUGH ─────────────
 * Owner, 2026-09-03: *"exactly 12 AM on every day that task will be
 * generated."* The nightly runner holds a series' most recent instance and asks
 * one question — is TODAY one of this series' days? `nextOccurrence` answers
 * "what comes after this date", which is the same question only when the last
 * instance is exactly one step behind. It usually is not: a weekly Monday /
 * Thursday series looked at on a Wednesday is two steps from its last instance,
 * and a series nobody has touched for a week is seven.
 *
 * So this walks. It does NOT backfill: the runner creates today and only today,
 * because filling days that have already passed manufactures overdue work
 * nobody was asked to do — the same rule the retired schedule generator held.
 *
 * `target` on or before `anchor` is false: the anchor is an instance that
 * already exists, not a day still owed.
 */
export function occursOn(rule: RecurrenceRule, anchorIso: string, targetIso: string): boolean {
  if (!toParts(anchorIso) || !toParts(targetIso)) return false;
  if (targetIso <= anchorIso) return false;

  let cursor = anchorIso;
  for (let step = 0; step < MAX_WALK_STEPS; step += 1) {
    const next = nextOccurrence(rule, cursor);
    /* An unparseable cursor or a rule that cannot advance: refuse rather than
       loop. Returning false means "no task tonight", which is recoverable;
       spinning is not. */
    if (!next || next <= cursor) return false;
    if (next === targetIso) return true;
    if (next > targetIso) return false;
    cursor = next;
  }
  return false;
}

/**
 * The dates for the next instance of a task that has just been completed.
 *
 * Both dates move by the same number of days, so a task planned to start on
 * Monday and finish on Wednesday keeps its two-day shape. Anchoring off the due
 * date rather than "today" is what stops a series drifting later every time
 * somebody closes an instance a day late.
 */
export function nextInstanceDates(
  rule: RecurrenceRule,
  current: { startDate: string | null; dueDate: string | null },
): { startDate: string | null; dueDate: string | null } | null {
  const anchor = current.dueDate ?? current.startDate;
  if (!anchor) return null;

  const nextAnchor = nextOccurrence(rule, anchor);
  if (!nextAnchor) return null;

  const shiftDays = Math.round(
    (Date.parse(`${nextAnchor}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000,
  );

  const shift = (iso: string | null): string | null => {
    if (!iso) return null;
    const moved = new Date(Date.parse(`${iso}T00:00:00Z`) + shiftDays * 86_400_000);
    return toIso(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
  };

  return {
    startDate: shift(current.startDate),
    dueDate: current.dueDate ? nextAnchor : shift(current.startDate),
  };
}
