/* ============================================================================
 * ATTENDANCE — WHAT A DAY MEANS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: check-in at 10am, check-out at 6pm, two offices with
 * different days off, and *"we will also note whether today he checked in or not.
 * That will be counted as leave or, you can say, absent."*
 *
 * ── ⚠️ EVERY STATUS IS DERIVED HERE, AND NOWHERE ELSE ───────────────────────
 * `attendance_days` stores two timestamps and nothing else — no status column, on
 * purpose (see migration 060). "Present", "Late", "Absent", "On leave" and "Off"
 * are all computed from those two timestamps, the person's office, and the
 * `availability` table. One derivation, one set of tests, one answer: the table,
 * the charts, the export and the 9pm sweep cannot disagree about who was late.
 *
 * ── ⚠️ NO COMPONENT AND NO QUERY MAY READ THE CLOCK ─────────────────────────
 * Everything here takes `nowMs` and a `today` explicitly, the same rule as
 * lib/now.ts. A status that depends on when the render happened is a status that
 * changes between the server and the browser, which is a hydration mismatch on a
 * page people will use to argue about pay.
 *
 * ── ⚠️ KARACHI, ALWAYS ──────────────────────────────────────────────────────
 * A check-in is a `timestamptz`, so "was it before 10:30" is only a question about
 * Karachi local time. `localMinutes` does that conversion in one place. Reading
 * `.getHours()` anywhere in this feature would be right on the owner's laptop and
 * wrong on the server, which runs in UTC.
 * ========================================================================= */

export const ATTENDANCE_TIMEZONE = 'Asia/Karachi';

/** Minutes after local midnight. 10:00 → 600. */
export const CHECK_IN_MINUTES = 10 * 60;
/** 18:00. The end of the working day, and the point an absence is settled. */
export const CHECK_OUT_MINUTES = 18 * 60;
/**
 * 10:30. Owner's choice, offered 10:00 / 10:15 / 10:30.
 *
 * ⚠️ INCLUSIVE: 10:30:00 is on time, 10:30:01 is late. A boundary that punishes
 * the person who arrived exactly on the stated deadline is the wrong way round.
 */
export const LATE_AFTER_MINUTES = 10 * 60 + 30;
/**
 * 21:00. When the sweep starts chasing people who never checked out.
 *
 * Owner: *"Definitely all the team is working. 1 and 2 are late sitting. That's
 * normal but after 9 pm, it should show a notification."* So this is deliberately
 * three hours after the end of the day.
 */
export const CHASE_AFTER_MINUTES = 21 * 60;
/** How many late arrivals in one calendar month before the person is told. */
export const LATE_STRIKES_BEFORE_NOTICE = 3;

/* ---------------------------------------------------------------------------
 * The two offices
 * ------------------------------------------------------------------------- */

export type OfficeTeam = 'blue_area' | 'wah';

export interface OfficeTeamMeta {
  readonly key: OfficeTeam;
  readonly label: string;
  readonly where: string;
  /** ISO weekdays worked. 1 = Monday … 7 = Sunday, matching Postgres `isodow`. */
  readonly workingDays: readonly number[];
  /** How the day off reads in a sentence. */
  readonly restDay: string;
  readonly days: string;
}

/**
 * ⚠️ The two teams differ ONLY in which day they rest. Owner: *"The timings of
 * both teams are the same."* If that ever stops being true, the hours move onto
 * this record — not into a second constant somewhere else.
 */
export const OFFICE_TEAMS: Readonly<Record<OfficeTeam, OfficeTeamMeta>> = {
  blue_area: {
    key: 'blue_area',
    label: 'Blue Area',
    where: 'Islamabad',
    /* Monday–Saturday. */
    workingDays: [1, 2, 3, 4, 5, 6],
    restDay: 'Sunday off',
    days: 'Monday to Saturday',
  },
  wah: {
    key: 'wah',
    label: 'Wah',
    where: 'Headquarters',
    /* ⚠️ Monday–Thursday, then Saturday and Sunday. FRIDAY is the day off, which
       is the whole reason this team exists as a separate record — a Friday with no
       check-in is an absence for Blue Area and nothing at all here. */
    workingDays: [1, 2, 3, 4, 6, 7],
    restDay: 'Friday off',
    days: 'Monday to Thursday, Saturday and Sunday',
  },
};

export const OFFICE_TEAM_KEYS = ['blue_area', 'wah'] as const;

export function officeTeam(value: string | null | undefined): OfficeTeamMeta {
  return OFFICE_TEAMS[(value ?? 'blue_area') as OfficeTeam] ?? OFFICE_TEAMS.blue_area;
}

/* ---------------------------------------------------------------------------
 * Dates and times, in Karachi
 * ------------------------------------------------------------------------- */

/**
 * ISO weekday of a `YYYY-MM-DD` string. 1 = Monday … 7 = Sunday.
 *
 * ⚠️ Parsed as UTC on purpose. `new Date('2026-08-25')` is midnight UTC, and
 * asking it for `getDay()` shifts the answer by the reader's own offset — west of
 * Greenwich that returns the previous day, so a Monday reads as Sunday and the
 * whole team looks like it has the day off.
 */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const at = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const dow = new Date(at).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATTENDANCE_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATTENDANCE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Minutes after Karachi midnight for an instant. Null for an unparseable one. */
export function localMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const [hh, mm] = HHMM.format(new Date(at)).split(':').map(Number);
  return hh * 60 + mm;
}

/** The Karachi calendar date of an instant, as `YYYY-MM-DD`. */
export function localDate(msOrIso: number | string): string {
  const at = typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  if (Number.isNaN(at)) return '';
  /* `en-CA` formats as YYYY-MM-DD, which is the one locale that gives an ISO date
     without assembling it from parts. */
  return YMD.format(new Date(at));
}

/** `10:04 AM`, for display. One formatter, so the table and the PDF agree. */
export function clockLabel(iso: string | null): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  return new Date(at)
    .toLocaleTimeString('en-GB', {
      timeZone: ATTENDANCE_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .toUpperCase();
}

/** `7h 53m`, or a dash. Minutes only — seconds are noise on a timesheet. */
export function durationLabel(minutes: number | null): string {
  if (minutes === null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/* ---------------------------------------------------------------------------
 * One day, one person
 * ------------------------------------------------------------------------- */

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'on_leave' | 'expected' | 'off';

export const ATTENDANCE_STATUS_META: Readonly<
  Record<AttendanceStatus, { label: string; token: string }>
> = {
  present: { label: 'Present', token: 'feedback-success' },
  late: { label: 'Late', token: 'feedback-warning' },
  absent: { label: 'Absent', token: 'feedback-error' },
  on_leave: { label: 'On leave', token: 'accent-gold' },
  expected: { label: 'Not in yet', token: 'text-tertiary' },
  off: { label: 'Day off', token: 'text-disabled' },
};

export interface AttendanceDay {
  readonly userId: string;
  readonly onDate: string;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  readonly editedByName?: string | null;
}

export interface DayContext {
  readonly team: OfficeTeam | string | null;
  readonly onDate: string;
  readonly checkedInAt: string | null;
  /** ⚠️ Approved leave from `availability`, decided by the caller. */
  readonly onLeave?: boolean;
  /** Karachi date of "now", from the server. Never read here. */
  readonly today: string;
  /** Minutes after Karachi midnight, from the server. */
  readonly nowMinutes: number;
}

/**
 * What one day means for one person.
 *
 * ── ⚠️ WHY "NOT IN YET" IS A SEPARATE STATE FROM "ABSENT" ───────────────────
 * At 11am, somebody who has not checked in is not absent — they might be on their
 * way. Calling that Absent puts a red mark against a person who then arrives at
 * 11:15, and an attendance page that cries wolf by lunchtime gets ignored. So
 * today stays `expected` until 18:00, the end of the working day, and only then
 * settles into `absent`.
 *
 * Past days settle immediately: a working day that has been and gone with no
 * check-in is an absence, and that is the number the owner asked to see.
 */
export function dayStatus(input: DayContext): AttendanceStatus {
  const meta = officeTeam(typeof input.team === 'string' ? input.team : null);

  if (!meta.workingDays.includes(isoWeekday(input.onDate))) return 'off';
  if (input.onLeave) return 'on_leave';

  if (input.checkedInAt) {
    const minutes = localMinutes(input.checkedInAt);
    /* An unparseable timestamp counts as present rather than late: the record says
       they were here, and only the minute is in doubt. */
    if (minutes === null) return 'present';
    return minutes > LATE_AFTER_MINUTES ? 'late' : 'present';
  }

  if (input.onDate > input.today) return 'expected';
  if (input.onDate < input.today) return 'absent';
  return input.nowMinutes >= CHECK_OUT_MINUTES ? 'absent' : 'expected';
}

/**
 * How many minutes past 10:30 somebody arrived, or null if they did not.
 *
 * ── ⚠️ MEASURED FROM THE LATE LINE, NOT FROM 10:00 ──────────────────────────
 * Arriving at 10:20 is on time by the owner's own rule, so it is not "20 minutes
 * late" — it is not late at all. Measuring from `CHECK_IN_MINUTES` would put a
 * number against every single person who did not arrive exactly on the hour, and
 * the late-arrivals list would then disagree with the status pill beside it.
 *
 * Returns null rather than 0 for an on-time arrival, so a caller cannot print
 * "0m late" against somebody who was punctual.
 */
export function minutesLate(checkedInAt: string | null): number | null {
  const minutes = localMinutes(checkedInAt);
  if (minutes === null) return null;
  const over = minutes - LATE_AFTER_MINUTES;
  return over > 0 ? over : null;
}

/**
 * Whether a day's status can still change.
 *
 * ⚠️ The attendance RATE is computed over settled days only. Including today
 * before it has finished divides by a day nobody has had the chance to attend, so
 * the rate reads low every morning and recovers by evening — which looks like a
 * bug and gets reported as one.
 */
export function isSettled(input: {
  onDate: string;
  today: string;
  nowMinutes: number;
}): boolean {
  if (input.onDate < input.today) return true;
  if (input.onDate > input.today) return false;
  return input.nowMinutes >= CHECK_OUT_MINUTES;
}

/** Minutes between check-in and check-out. Null while the day is open. */
export function minutesWorked(day: {
  checkedInAt: string | null;
  checkedOutAt: string | null;
}): number | null {
  if (!day.checkedInAt || !day.checkedOutAt) return null;
  const from = Date.parse(day.checkedInAt);
  const to = Date.parse(day.checkedOutAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 60_000);
}

/**
 * Minutes beyond the eight-hour day, or null when there are none.
 *
 * ⚠️ Measured from 10:00–18:00 as a LENGTH, not from the check-out clock time.
 * Somebody who arrives at 11 and leaves at 7 worked eight hours and is not owed
 * overtime for the hour they were late.
 */
export function overtimeMinutes(day: {
  checkedInAt: string | null;
  checkedOutAt: string | null;
}): number | null {
  const worked = minutesWorked(day);
  if (worked === null) return null;
  const over = worked - (CHECK_OUT_MINUTES - CHECK_IN_MINUTES);
  return over > 0 ? over : null;
}

/**
 * Whether somebody should be chased for not checking out.
 *
 * ⚠️ Only for a day they DID check into, only once it is past 9pm, and never for a
 * day already closed. A reminder to check out of a day you never checked into is
 * noise, and it is the one that would go to the whole team every morning.
 */
export function needsCheckoutChase(input: {
  onDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  today: string;
  nowMinutes: number;
}): boolean {
  if (!input.checkedInAt || input.checkedOutAt) return false;
  if (input.onDate < input.today) return true;
  if (input.onDate > input.today) return false;
  return input.nowMinutes >= CHASE_AFTER_MINUTES;
}

/* ---------------------------------------------------------------------------
 * Many days, one page
 * ------------------------------------------------------------------------- */

export interface AttendanceSummary {
  readonly present: number;
  readonly late: number;
  readonly absent: number;
  readonly onLeave: number;
  readonly expected: number;
  readonly off: number;
  /** Days whose status has settled — the denominator for `rate`. */
  readonly settled: number;
  /** Percent, 0–100, to one decimal. Null when nothing has settled yet. */
  readonly rate: number | null;
  /** Mean minutes worked across days with both a check-in and a check-out. */
  readonly averageMinutes: number | null;
  readonly totalMinutes: number;
}

export interface StatusedDay {
  readonly status: AttendanceStatus;
  readonly settled: boolean;
  readonly minutes: number | null;
}

/**
 * Roll up a set of already-classified days.
 *
 * ⚠️ Takes statuses rather than raw rows so the caller classifies ONCE and the
 * table, the chart and the cards all count the same objects. An earlier shape had
 * this recomputing `dayStatus` per call and the cards disagreed with the rows
 * beneath them by one, on the day somebody was on leave.
 */
export function summarise(days: readonly StatusedDay[]): AttendanceSummary {
  let present = 0;
  let late = 0;
  let absent = 0;
  let onLeave = 0;
  let expected = 0;
  let off = 0;
  let settled = 0;
  let totalMinutes = 0;
  let withHours = 0;

  for (const day of days) {
    switch (day.status) {
      case 'present':
        present += 1;
        break;
      case 'late':
        late += 1;
        break;
      case 'absent':
        absent += 1;
        break;
      case 'on_leave':
        onLeave += 1;
        break;
      case 'expected':
        expected += 1;
        break;
      default:
        off += 1;
    }

    /* ⚠️ A day off is never in the denominator. Sunday is not a 0% attendance
       day for Blue Area, and Friday is not one for Wah — that was the whole point
       of giving the two teams different working days. Leave is excluded too: it
       was granted, so counting it against the rate punishes the approval. */
    if (day.settled && day.status !== 'off' && day.status !== 'on_leave') settled += 1;

    if (day.minutes !== null) {
      totalMinutes += day.minutes;
      withHours += 1;
    }
  }

  const attended = present + late;
  return {
    present,
    late,
    absent,
    onLeave,
    expected,
    off,
    settled,
    rate: settled === 0 ? null : Math.round((attended / settled) * 1000) / 10,
    averageMinutes: withHours === 0 ? null : Math.round(totalMinutes / withHours),
    totalMinutes,
  };
}

/**
 * How many times somebody was late within one calendar month.
 *
 * ⚠️ CALENDAR MONTH, resetting on the 1st — the owner's choice, so that the count
 * in the notification is the same number the monthly page shows. A rolling window
 * would be steadier and would never match what anybody could see, which makes it
 * impossible to explain to the person receiving the message.
 */
export function lateCountInMonth(
  days: readonly { onDate: string; status: AttendanceStatus }[],
  month: string,
): number {
  return days.filter((d) => d.status === 'late' && d.onDate.startsWith(month)).length;
}

/** `2026-08` for a date or an instant. The key the month view and the sweep share. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Whether somebody's late count has reached the point of telling them.
 *
 * Owner: *"If someone is coming late for the third time, there must be a
 * notification."*
 *
 * ── ⚠️ AT LEAST THREE, NOT EXACTLY THREE ────────────────────────────────────
 * This was `=== 3`, to avoid sending a message on the fourth, fifth and sixth
 * late as well. But the sweep that calls it runs nightly, so `=== 3` means anybody
 * whose third late fell on a night the sweep did not run is never told at all —
 * and the same is true for the whole team on the day the feature ships mid-month.
 * A rule that silently skips people is worse than one that needs a second guard.
 *
 * The anti-nag lives where it belongs instead: the sweep sends this ONCE per
 * person per calendar month, which it knows from the notifications table. So the
 * count can keep rising and nothing more is sent.
 */
export function reachedLateStrike(lateCount: number): boolean {
  return lateCount >= LATE_STRIKES_BEFORE_NOTICE;
}

/** Every date in a month, as `YYYY-MM-DD`. For the month grid and the seed. */
export function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    out.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/** Every date from `from` to `to`, inclusive. Both `YYYY-MM-DD`. */
export function datesBetween(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  let at = Date.UTC(fy, fm - 1, fd);
  const end = (() => {
    const [ty, tm, td] = to.split('-').map(Number);
    return Date.UTC(ty, tm - 1, td);
  })();
  while (at <= end) {
    out.push(new Date(at).toISOString().slice(0, 10));
    at += 86_400_000;
  }
  return out;
}
