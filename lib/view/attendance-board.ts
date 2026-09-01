import type { AttendanceSource, ScanMethod } from '@/lib/domain/attendance-device';
import {
  type AttendanceStatus,
  type StatusedDay,
  dayStatus,
  datesBetween,
  isSettled,
  isoWeekday,
  lateCountInMonth,
  minutesWorked,
  monthOf,
  officeTeam,
  overtimeMinutes,
  summarise,
} from '@/lib/domain/attendance';

/* ============================================================================
 * THE ATTENDANCE PAGE, ASSEMBLED
 * ----------------------------------------------------------------------------
 * Everything the screen shows, computed once from the people, the recorded days
 * and the approved leave.
 *
 * ── ⚠️ WHY THIS IS NOT DONE IN THE COMPONENT ────────────────────────────────
 * The page shows the same facts five times: five counters, a column per day, a
 * donut, a row per person, and an export. Every one of those is a different
 * projection of one classification, and computing the classification five times
 * is how a card ends up disagreeing with the table beneath it — which already
 * happened once on the reports page and took a regression test to settle.
 *
 * So the classification happens HERE, once, and each view is a projection of the
 * same array. If the table says somebody was late, the counter counted them.
 *
 * ── ⚠️ A MISSING ROW IS A REAL STATUS ──────────────────────────────────────
 * `attendance_days` only holds days somebody touched, so an absence is the absence
 * of a row. The grid is therefore built from PEOPLE × DATES and filled in from the
 * records — never iterated from the records, which would show a perfect month for
 * anybody who never checked in at all.
 * ========================================================================= */

export interface BoardPerson {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly avatarUrl: string | null;
  readonly officeTeam: string;
}

export interface BoardRecord {
  readonly userId: string;
  readonly onDate: string;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  /* Owner, 2026-09-01: the table has to say whether a time came from the wall or
     from the button. Optional so a caller that does not have them — a test
     fixture, an older shape — still type-checks; the cell defaults to `self`. */
  readonly checkInSource?: AttendanceSource;
  readonly checkOutSource?: AttendanceSource;
  readonly checkInMethod?: ScanMethod | null;
  readonly checkOutMethod?: ScanMethod | null;
  readonly editedByName: string | null;
  readonly editNote: string | null;
}

export interface BoardLeave {
  readonly userId: string;
  readonly from: string;
  readonly to: string;
}

export interface BoardInput {
  readonly people: readonly BoardPerson[];
  readonly records: readonly BoardRecord[];
  readonly leave: readonly BoardLeave[];
  readonly from: string;
  readonly to: string;
  /** The server's Karachi date and minute. Never read from a clock here. */
  readonly today: string;
  readonly nowMinutes: number;
}

/** One person on one day — the atom every view below is projected from. */
export interface BoardCell {
  readonly userId: string;
  readonly onDate: string;
  readonly status: AttendanceStatus;
  readonly settled: boolean;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  /* Where each time came from, and how the terminal recognised them. Owner,
     2026-09-01 — see AttendanceDayRow. */
  readonly checkInSource: AttendanceSource;
  readonly checkOutSource: AttendanceSource;
  readonly checkInMethod: ScanMethod | null;
  readonly checkOutMethod: ScanMethod | null;
  readonly minutes: number | null;
  readonly overtime: number | null;
  readonly editedByName: string | null;
  readonly editNote: string | null;
}

/** One row of the records table: a person's day, with who they are attached. */
export interface BoardRow extends BoardCell {
  readonly name: string;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
  readonly officeTeam: string;
  readonly teamLabel: string;
  /** How many times this person has been late in this day's calendar month. */
  readonly lateThisMonth: number;
}

export interface DayColumn {
  readonly onDate: string;
  /** `Mon`, and the day of the month — the reference labels both. */
  readonly weekday: string;
  readonly dayLabel: string;
  readonly present: number;
  readonly absent: number;
  readonly late: number;
  readonly onLeave: number;
  /** Everybody expected in that day: present + late + absent. Excludes days off. */
  readonly expectedIn: number;
}

export interface AttendanceBoard {
  readonly cells: readonly BoardCell[];
  readonly rows: readonly BoardRow[];
  readonly days: readonly DayColumn[];
  readonly summary: ReturnType<typeof summarise>;
  /** Today only — the five counters at the top of the reference. */
  readonly todaySummary: ReturnType<typeof summarise>;
  readonly headcount: number;
  /** Per person, for the "who is late a lot" view. */
  readonly perPerson: readonly PersonTotals[];
}

export interface PersonTotals {
  readonly person: BoardPerson;
  readonly teamLabel: string;
  readonly present: number;
  readonly late: number;
  readonly absent: number;
  readonly onLeave: number;
  readonly rate: number | null;
  readonly averageMinutes: number | null;
  readonly totalMinutes: number;
  /** ⚠️ Late count in the month the range ENDS in — the notification's number. */
  readonly lateThisMonth: number;
}

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `2026-08-25` → `25 Aug`. Assembled, never formatted — see lib/now.ts. */
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}`.trim();
}

export function buildAttendanceBoard(input: BoardInput): AttendanceBoard {
  const dates = datesBetween(input.from, input.to);

  /* Two lookups built once. The alternative — `records.find(…)` inside the
     people × dates loop — is O(people × dates × records), which for a month of
     six people is small and for a year of forty is not. */
  const byKey = new Map<string, BoardRecord>();
  for (const record of input.records) {
    byKey.set(`${record.userId}|${record.onDate}`, record);
  }

  const leaveByPerson = new Map<string, BoardLeave[]>();
  for (const period of input.leave) {
    const list = leaveByPerson.get(period.userId) ?? [];
    list.push(period);
    leaveByPerson.set(period.userId, list);
  }
  const onLeave = (userId: string, date: string): boolean =>
    (leaveByPerson.get(userId) ?? []).some((p) => date >= p.from && date <= p.to);

  /* ── Classify once ─────────────────────────────────────────────────────── */
  const cells: BoardCell[] = [];
  for (const person of input.people) {
    for (const date of dates) {
      const record = byKey.get(`${person.id}|${date}`) ?? null;
      const status = dayStatus({
        team: person.officeTeam,
        onDate: date,
        checkedInAt: record?.checkedInAt ?? null,
        onLeave: onLeave(person.id, date),
        today: input.today,
        nowMinutes: input.nowMinutes,
      });

      cells.push({
        userId: person.id,
        onDate: date,
        status,
        settled: isSettled({ onDate: date, today: input.today, nowMinutes: input.nowMinutes }),
        checkedInAt: record?.checkedInAt ?? null,
        checkedOutAt: record?.checkedOutAt ?? null,
        /* ⚠️ Defaults to `self` where there is no record, and that is the honest
           reading: a day nobody recorded came from nothing, and the button is
           what every existing row was. It is never shown for an empty cell. */
        checkInSource: record?.checkInSource ?? 'self',
        checkOutSource: record?.checkOutSource ?? 'self',
        checkInMethod: record?.checkInMethod ?? null,
        checkOutMethod: record?.checkOutMethod ?? null,
        minutes: record ? minutesWorked(record) : null,
        overtime: record ? overtimeMinutes(record) : null,
        editedByName: record?.editedByName ?? null,
        editNote: record?.editNote ?? null,
      });
    }
  }

  const statused = (list: readonly BoardCell[]): StatusedDay[] =>
    list.map((c) => ({ status: c.status, settled: c.settled, minutes: c.minutes }));

  /* ── Per person ────────────────────────────────────────────────────────── */
  const endMonth = monthOf(input.to);
  const byPerson = new Map<string, BoardCell[]>();
  for (const cell of cells) {
    const list = byPerson.get(cell.userId) ?? [];
    list.push(cell);
    byPerson.set(cell.userId, list);
  }

  const perPerson: PersonTotals[] = input.people.map((person) => {
    const mine = byPerson.get(person.id) ?? [];
    const totals = summarise(statused(mine));
    return {
      person,
      teamLabel: officeTeam(person.officeTeam).label,
      present: totals.present,
      late: totals.late,
      absent: totals.absent,
      onLeave: totals.onLeave,
      rate: totals.rate,
      averageMinutes: totals.averageMinutes,
      totalMinutes: totals.totalMinutes,
      lateThisMonth: lateCountInMonth(mine, endMonth),
    };
  });

  const lateByPerson = new Map(perPerson.map((p) => [p.person.id, p.lateThisMonth]));
  const peopleById = new Map(input.people.map((p) => [p.id, p]));

  /* ── The records table ─────────────────────────────────────────────────── */
  /* ⚠️ Days off are LEFT OUT of the table but stay in `cells`. A Sunday row per
     person is thirty rows of "Day off" a month, which buries the six rows
     somebody opened the page to find — but the counters still need those days to
     know they are not absences. */
  const rows: BoardRow[] = cells
    .filter((cell) => cell.status !== 'off')
    .map((cell) => {
      const person = peopleById.get(cell.userId);
      return {
        ...cell,
        name: person?.name ?? 'Somebody',
        roleTitle: person?.roleTitle ?? null,
        avatarUrl: person?.avatarUrl ?? null,
        officeTeam: person?.officeTeam ?? 'blue_area',
        teamLabel: officeTeam(person?.officeTeam).label,
        lateThisMonth: lateByPerson.get(cell.userId) ?? 0,
      };
    })
    /* Newest day first, then by name — the order somebody scanning for "who was
       late today" needs, without touching a control. */
    .sort((a, b) => (a.onDate === b.onDate ? a.name.localeCompare(b.name) : b.onDate < a.onDate ? -1 : 1));

  /* ── A column per day ──────────────────────────────────────────────────── */
  const days: DayColumn[] = dates.map((date) => {
    const mine = cells.filter((c) => c.onDate === date);
    const count = (status: AttendanceStatus) => mine.filter((c) => c.status === status).length;
    const present = count('present');
    const late = count('late');
    const absent = count('absent');
    return {
      onDate: date,
      weekday: WEEKDAY_NAMES[isoWeekday(date)] ?? '',
      dayLabel: shortDate(date),
      /* ⚠️ Late people are PRESENT in the column chart. The reference draws
         Present against Absent, and somebody who arrived at 11 is not absent —
         the lateness is a separate counter and a separate colour in the table. */
      present: present + late,
      late,
      absent,
      onLeave: count('on_leave'),
      expectedIn: present + late + absent,
    };
  });

  const todayCells = cells.filter((c) => c.onDate === input.today);

  return {
    cells,
    rows,
    days,
    summary: summarise(statused(cells)),
    todaySummary: summarise(statused(todayCells)),
    headcount: input.people.length,
    perPerson,
  };
}

/* ---------------------------------------------------------------------------
 * Ranges
 * ------------------------------------------------------------------------- */

export type RangeKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'last_7'
  | 'last_30'
  /** Two dates the reader chose. Carried in the URL, not derived from today. */
  | 'custom';

export interface Range {
  readonly key: RangeKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Turn a range key into two dates, relative to a given today.
 *
 * ⚠️ `today` is a parameter. Every other option — a `new Date()` in here, a
 * default argument that reads the clock — makes this untestable and makes the page
 * disagree with itself across midnight.
 *
 * ⚠️ THE WEEK STARTS ON MONDAY. Both offices work Monday-first weeks and the
 * reference's chart runs Mon→Sun. A Sunday-first week would put Blue Area's day
 * off at the start of its own week.
 */
export function resolveRange(key: RangeKey, today: string): Range {
  const [y, m, d] = today.split('-').map(Number);
  const at = Date.UTC(y, m - 1, d);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const day = 86_400_000;

  switch (key) {
    /* ⚠️ A single day is a range whose ends are equal, not a special case. Owner:
       *"I can select a single day also."* Keeping it in the same shape means the
       chart, the table, the counters and the export all handle it without knowing
       it is one day — a separate "day mode" would be four more branches. */
    case 'today':
      return { key, label: 'Today', from: today, to: today };
    case 'yesterday': {
      const day = iso(at - 86_400_000);
      return { key, label: 'Yesterday', from: day, to: day };
    }
    case 'this_week': {
      const back = (isoWeekday(today) - 1) * day;
      return {
        key,
        label: 'This week',
        from: iso(at - back),
        /* ⚠️ Ends on Sunday, not today. A week chart that stops at Wednesday makes
           Thursday look like a day nobody came in. Future days classify as
           `expected`, which is drawn as nothing. */
        to: iso(at - back + 6 * day),
      };
    }
    case 'last_7':
      return { key, label: 'Last 7 days', from: iso(at - 6 * day), to: today };
    case 'last_30':
      return { key, label: 'Last 30 days', from: iso(at - 29 * day), to: today };
    case 'last_month': {
      const first = Date.UTC(y, m - 2, 1);
      const last = Date.UTC(y, m - 1, 0);
      return { key, label: 'Last month', from: iso(first), to: iso(last) };
    }
    default: {
      const first = Date.UTC(y, m - 1, 1);
      const last = Date.UTC(y, m, 0);
      return { key, label: 'This month', from: iso(first), to: iso(last) };
    }
  }
}

/** ⚠️ `custom` is absent: it is not a preset anybody picks from a list, it is
 *  what the two date fields produce. Offering it as an option would be a control
 *  that does nothing until two other controls are used. */
export const RANGE_KEYS: readonly RangeKey[] = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_month',
  'last_7',
  'last_30',
];

/**
 * A range from two dates the reader typed.
 *
 * ⚠️ Ordered, not trusted. Somebody who picks the end before the start means the
 * span between them; returning nothing would look like a page with no data.
 * Anything unparseable falls back to the month, because an empty page is a worse
 * answer to a typo than a sensible default.
 */
export function customRange(from: string, to: string, today: string): Range {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!valid(from) || !valid(to)) return resolveRange('this_month', today);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return {
    key: 'custom',
    label: start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`,
    from: start,
    to: end,
  };
}

/** `1 Aug – 31 Aug 2026`, for the range chip. */
export function rangeLabel(range: { from: string; to: string }): string {
  const year = range.to.slice(0, 4);
  return `${shortDate(range.from)} – ${shortDate(range.to)} ${year}`;
}

/* ---------------------------------------------------------------------------
 * How the columns are grouped
 * ------------------------------------------------------------------------- */

export type Granularity = 'daily' | 'weekly' | 'monthly';

export const GRANULARITIES: readonly Granularity[] = ['daily', 'weekly', 'monthly'];

export const GRANULARITY_LABEL: Readonly<Record<Granularity, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/**
 * Which grouping the overview chart should open on for a given period.
 *
 * ── ⚠️ WHY THIS IS DERIVED AND NOT A CONSTANT ───────────────────────────────
 * Owner, 2026-08-25: *"by default when this page is open, the range should be
 * equal to this month and in the attendance overview automatically select
 * weekly."* The page already opens on this month, and a month is 31 columns at
 * about 12px each — the unreadable chart the owner reported first. So this month
 * must open Weekly.
 *
 * Hard-coding `'weekly'` would satisfy that sentence and break the next click:
 * "Today" would draw one fat column labelled "Week of 24 Aug" containing a single
 * day, which is a chart that misstates its own contents. The rule the owner
 * actually wants is "group it so the chart is readable", so the span decides:
 *
 *   up to a fortnight   daily     — 14 columns still read, and a week MUST stay
 *                                   daily or Mon–Sun collapses into one bar
 *   up to four months   weekly    — this month and last month land here
 *   longer              monthly   — a year is 12 columns, not 52
 *
 * ⚠️ A pure function of two date strings, so the server and the browser cannot
 * disagree about which grouping a page opened on.
 */
export function defaultGranularity(range: { from: string; to: string }): Granularity {
  const days = countRangeDays(range);
  if (days <= 14) return 'daily';
  if (days <= 120) return 'weekly';
  return 'monthly';
}

/**
 * How many days a range covers, both ends included.
 *
 * ⚠️ Falls back to 1 for anything unparseable rather than propagating NaN — a NaN
 * here would flow into `defaultGranularity`'s comparisons, which are all false for
 * NaN, and silently pick the LAST branch. A typo in a URL would then open a
 * month-grouped chart of one day.
 */
export function countRangeDays(range: { from: string; to: string }): number {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 1;
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

/**
 * Fold a column per day into columns per day, week or month.
 *
 * ── ⚠️ WHY THIS EXISTS ──────────────────────────────────────────────────────
 * A month is 31 columns. At the width of the overview card that is a 12px slot
 * per day, and the owner saw the result: *"my bar graph, this line of this bar
 * chart, is not properly implemented"* — the labels had collapsed to "1. S." and
 * the bars to hairlines. Weekly folds the same month into five readable columns.
 *
 * ⚠️ The counts are SUMMED, not averaged. A week's column is "days attended
 * across the team that week", which is the same unit as a day's column and stacks
 * against absence the same way. Averaging would make the two granularities read
 * on different scales, and nobody would notice which they were looking at.
 *
 * ⚠️ Weeks are labelled by the Monday that starts them, because both offices work
 * Monday-first weeks — see `resolveRange`.
 */
export function groupColumns(
  days: readonly DayColumn[],
  granularity: Granularity,
): DayColumn[] {
  if (granularity === 'daily' || days.length === 0) return [...days];

  const buckets = new Map<string, DayColumn[]>();
  for (const day of days) {
    const key =
      granularity === 'monthly' ? day.onDate.slice(0, 7) : mondayOf(day.onDate);
    const list = buckets.get(key) ?? [];
    list.push(day);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, group]) => {
      const sum = (pick: (d: DayColumn) => number) => group.reduce((a, d) => a + pick(d), 0);
      return {
        onDate: group[0].onDate,
        weekday:
          granularity === 'monthly'
            ? `${group.length} days`
            : `${shortDate(group[0].onDate)}–${shortDate(group[group.length - 1].onDate)}`,
        dayLabel: granularity === 'monthly' ? monthName(key) : `Week of ${shortDate(key)}`,
        present: sum((d) => d.present),
        late: sum((d) => d.late),
        absent: sum((d) => d.absent),
        onLeave: sum((d) => d.onLeave),
        expectedIn: sum((d) => d.expectedIn),
      };
    });
}

/** The Monday of the week a date falls in, as `YYYY-MM-DD`. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = Date.UTC(y, m - 1, d);
  const back = (isoWeekday(date) - 1) * 86_400_000;
  return new Date(at - back).toISOString().slice(0, 10);
}

function monthName(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m)] ?? ''} ${year.slice(2)}`.trim();
}

/* ---------------------------------------------------------------------------
 * The table's filters
 * ------------------------------------------------------------------------- */

export interface RowFilters {
  /** `all`, `blue_area` or `wah`. */
  readonly team: string;
  /** `all` or an `AttendanceStatus`. */
  readonly status: string;
  /** Matched against the person's name, case-insensitively. */
  readonly query: string;
  /** A single `YYYY-MM-DD`, or `''` for every day in the range. */
  readonly onDate: string;
}

export const NO_FILTERS: RowFilters = { team: 'all', status: 'all', query: '', onDate: '' };

/**
 * Narrow the table.
 *
 * ── ⚠️ SHARED WITH THE EXPORT, ON PURPOSE ───────────────────────────────────
 * Owner: *"The same filter that is applied should be applied the same way during
 * export."* The export rebuilds the board on the server rather than trusting rows
 * posted back from the browser — a client-supplied report could claim any figures —
 * so the filtering has to happen twice, in two processes. Two copies of "does this
 * row match" is how a PDF ends up containing rows the screen was hiding, so there
 * is one copy and both call it.
 */
export function filterAttendanceRows(
  rows: readonly BoardRow[],
  filters: RowFilters,
): BoardRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.team !== 'all' && row.officeTeam !== filters.team) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.onDate !== '' && row.onDate !== filters.onDate) return false;
    if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}
