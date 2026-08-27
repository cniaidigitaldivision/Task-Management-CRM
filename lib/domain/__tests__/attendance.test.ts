import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_STATUS_META,
  CHASE_AFTER_MINUTES,
  CHECK_OUT_MINUTES,
  LATE_AFTER_MINUTES,
  OFFICE_TEAMS,
  clockLabel,
  dayStatus,
  datesBetween,
  datesInMonth,
  durationLabel,
  reachedLateStrike,
  isSettled,
  isoWeekday,
  lateCountInMonth,
  localDate,
  localMinutes,
  minutesLate,
  minutesWorked,
  needsCheckoutChase,
  officeTeam,
  overtimeMinutes,
  summarise,
  type AttendanceStatus,
} from '../attendance';

/* ============================================================================
 * ATTENDANCE
 * ----------------------------------------------------------------------------
 * The cases that matter are the ones where being wrong marks a person absent or
 * late when they were not — every one of those is an argument about pay.
 * ========================================================================= */

/** 2026-08-25 is a Tuesday. Every fixture below is anchored to that week. */
const TUE = '2026-08-25';
const FRI = '2026-08-28';
const SAT = '2026-08-29';
const SUN = '2026-08-30';

/** Karachi is UTC+5, so 10:04 local is 05:04 Zulu. Written out to stay honest. */
const at = (hhmm: string, date = TUE) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = h - 5;
  return `${date}T${String(utc).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
};

describe('the working week', () => {
  it('knows Blue Area rests on Sunday', () => {
    expect(OFFICE_TEAMS.blue_area.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(OFFICE_TEAMS.blue_area.workingDays).not.toContain(7);
  });

  it('knows Wah rests on Friday and works the weekend', () => {
    expect(OFFICE_TEAMS.wah.workingDays).toEqual([1, 2, 3, 4, 6, 7]);
    expect(OFFICE_TEAMS.wah.workingDays).not.toContain(5);
    expect(OFFICE_TEAMS.wah.workingDays).toContain(7);
  });

  it('both teams work six days', () => {
    /* Different days, same load — the owner said the timings are identical. */
    expect(OFFICE_TEAMS.blue_area.workingDays).toHaveLength(6);
    expect(OFFICE_TEAMS.wah.workingDays).toHaveLength(6);
  });

  it('falls back to Blue Area for an unknown or missing team', () => {
    expect(officeTeam(null).key).toBe('blue_area');
    expect(officeTeam('nonsense').key).toBe('blue_area');
  });
});

describe('isoWeekday', () => {
  it('numbers Monday to Sunday as 1 to 7', () => {
    expect(isoWeekday('2026-08-24')).toBe(1);
    expect(isoWeekday(TUE)).toBe(2);
    expect(isoWeekday(FRI)).toBe(5);
    expect(isoWeekday(SAT)).toBe(6);
    expect(isoWeekday(SUN)).toBe(7);
  });

  it('does not shift a date by the reader’s own offset', () => {
    /* ⚠️ The bug this guards: `new Date('2026-08-30').getDay()` is midnight UTC,
       which west of Greenwich is still the 29th — so a Sunday reads as Saturday
       and Blue Area's day off lands on the wrong day. */
    expect(isoWeekday('2026-01-01')).toBe(4);
    expect(isoWeekday('2026-12-31')).toBe(4);
  });
});

describe('localMinutes', () => {
  it('converts an instant to Karachi minutes after midnight', () => {
    expect(localMinutes(at('10:04'))).toBe(604);
    expect(localMinutes(at('18:15'))).toBe(1095);
  });

  it('handles a late-night instant that is the previous day in UTC', () => {
    /* 01:30 Karachi on the 26th is 20:30 UTC on the 25th. */
    expect(localMinutes('2026-08-25T20:30:00.000Z')).toBe(90);
  });

  it('returns null for nothing and for nonsense', () => {
    expect(localMinutes(null)).toBeNull();
    expect(localMinutes('not a date')).toBeNull();
  });
});

describe('localDate', () => {
  it('gives the Karachi calendar date, not the UTC one', () => {
    /* ⚠️ THE CASE THE WHOLE FEATURE TURNS ON. 20:30 UTC is already tomorrow in
       Karachi, so somebody checking out at 1:30am must not have it filed against
       yesterday — the owner says late sitting is normal. */
    expect(localDate('2026-08-25T20:30:00.000Z')).toBe('2026-08-26');
    expect(localDate('2026-08-25T05:04:00.000Z')).toBe('2026-08-25');
  });
});

describe('dayStatus', () => {
  const base = { today: TUE, nowMinutes: 12 * 60 };

  it('is present for an arrival before the cut-off', () => {
    expect(
      dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: at('09:58') }),
    ).toBe('present');
  });

  it('is present at exactly 10:30, and late one minute later', () => {
    /* ⚠️ The boundary the owner chose. Inclusive: punishing somebody who arrived
       at the stated deadline is the wrong way round. */
    expect(LATE_AFTER_MINUTES).toBe(630);
    expect(dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: at('10:30') })).toBe(
      'present',
    );
    expect(dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: at('10:31') })).toBe(
      'late',
    );
  });

  it('counts 10:27 as present, since the owner chose 10:30 over 10:15', () => {
    expect(dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: at('10:27') })).toBe(
      'present',
    );
  });

  it('is a day off on Sunday for Blue Area but a working day for Wah', () => {
    const sunday = { ...base, onDate: SUN, checkedInAt: null, today: '2026-08-31' };
    expect(dayStatus({ ...sunday, team: 'blue_area' })).toBe('off');
    expect(dayStatus({ ...sunday, team: 'wah' })).toBe('absent');
  });

  it('is a day off on Friday for Wah but a working day for Blue Area', () => {
    const friday = { ...base, onDate: FRI, checkedInAt: null, today: '2026-08-31' };
    expect(dayStatus({ ...friday, team: 'wah' })).toBe('off');
    expect(dayStatus({ ...friday, team: 'blue_area' })).toBe('absent');
  });

  it('does not mark somebody absent at lunchtime', () => {
    /* ⚠️ 11am with no check-in is "not in yet", not absent. Marking a red Absent
       against somebody who walks in at 11:15 makes the page untrustworthy by
       lunchtime. */
    expect(
      dayStatus({ team: 'blue_area', onDate: TUE, checkedInAt: null, today: TUE, nowMinutes: 660 }),
    ).toBe('expected');
  });

  it('settles into absent once the working day has ended', () => {
    expect(
      dayStatus({
        team: 'blue_area',
        onDate: TUE,
        checkedInAt: null,
        today: TUE,
        nowMinutes: CHECK_OUT_MINUTES,
      }),
    ).toBe('absent');
  });

  it('is absent for a past working day with no check-in', () => {
    expect(
      dayStatus({
        team: 'blue_area',
        onDate: '2026-08-24',
        checkedInAt: null,
        today: TUE,
        nowMinutes: 600,
      }),
    ).toBe('absent');
  });

  it('is expected, never absent, for a future working day', () => {
    expect(
      dayStatus({
        team: 'blue_area',
        onDate: '2026-08-27',
        checkedInAt: null,
        today: TUE,
        nowMinutes: 600,
      }),
    ).toBe('expected');
  });

  it('shows approved leave instead of an absence', () => {
    expect(
      dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: null, onLeave: true }),
    ).toBe('on_leave');
  });

  it('lets a day off beat leave, so a Sunday on leave is not counted twice', () => {
    expect(
      dayStatus({ ...base, team: 'blue_area', onDate: SUN, checkedInAt: null, onLeave: true }),
    ).toBe('off');
  });

  it('trusts an unparseable check-in as present rather than late', () => {
    /* The record says they were here; only the minute is in doubt. */
    expect(dayStatus({ ...base, team: 'blue_area', onDate: TUE, checkedInAt: 'garbage' })).toBe(
      'present',
    );
  });

  it('has a label and a colour for every status it can return', () => {
    const all: AttendanceStatus[] = ['present', 'late', 'absent', 'on_leave', 'expected', 'off'];
    for (const status of all) {
      expect(ATTENDANCE_STATUS_META[status].label).toBeTruthy();
      expect(ATTENDANCE_STATUS_META[status].token).toBeTruthy();
    }
  });
});

describe('isSettled', () => {
  it('is true for the past and false for the future', () => {
    expect(isSettled({ onDate: '2026-08-24', today: TUE, nowMinutes: 600 })).toBe(true);
    expect(isSettled({ onDate: '2026-08-26', today: TUE, nowMinutes: 600 })).toBe(false);
  });

  it('settles today only at the end of the working day', () => {
    expect(isSettled({ onDate: TUE, today: TUE, nowMinutes: 1079 })).toBe(false);
    expect(isSettled({ onDate: TUE, today: TUE, nowMinutes: CHECK_OUT_MINUTES })).toBe(true);
  });
});

describe('minutesWorked and overtime', () => {
  it('measures the gap between the two stamps', () => {
    expect(minutesWorked({ checkedInAt: at('10:12'), checkedOutAt: at('18:05') })).toBe(473);
    expect(durationLabel(473)).toBe('7h 53m');
  });

  it('is null while the day is still open', () => {
    expect(minutesWorked({ checkedInAt: at('10:00'), checkedOutAt: null })).toBeNull();
    expect(durationLabel(null)).toBe('—');
  });

  it('pays overtime on LENGTH, not on the clock', () => {
    /* ⚠️ Somebody who arrives at 11 and leaves at 7 worked eight hours and is owed
       nothing. Measuring from the 18:00 clock time would hand them an hour. */
    expect(overtimeMinutes({ checkedInAt: at('11:00'), checkedOutAt: at('19:00') })).toBeNull();
    expect(overtimeMinutes({ checkedInAt: at('10:00'), checkedOutAt: at('18:11') })).toBe(11);
  });

  it('refuses a check-out before the check-in rather than returning a negative', () => {
    expect(minutesWorked({ checkedInAt: at('18:00'), checkedOutAt: at('10:00') })).toBeNull();
  });

  it('formats a sub-hour day without a leading zero hour', () => {
    expect(durationLabel(45)).toBe('45m');
  });
});

describe('needsCheckoutChase', () => {
  const day = { onDate: TUE, checkedInAt: at('10:04'), checkedOutAt: null, today: TUE };

  it('says nothing before 9pm, however open the day is', () => {
    /* Owner: *"1 and 2 are late sitting. That's normal."* */
    expect(needsCheckoutChase({ ...day, nowMinutes: 19 * 60 })).toBe(false);
    expect(needsCheckoutChase({ ...day, nowMinutes: CHASE_AFTER_MINUTES - 1 })).toBe(false);
  });

  it('chases at 9pm', () => {
    expect(needsCheckoutChase({ ...day, nowMinutes: CHASE_AFTER_MINUTES })).toBe(true);
  });

  it('chases a previous day at any hour', () => {
    expect(
      needsCheckoutChase({
        onDate: '2026-08-24',
        checkedInAt: at('10:04', '2026-08-24'),
        checkedOutAt: null,
        today: TUE,
        nowMinutes: 60,
      }),
    ).toBe(true);
  });

  it('never chases somebody who never checked in', () => {
    /* ⚠️ Otherwise every absent person is told to check out — the one reminder
       that would go to half the team every single night. */
    expect(
      needsCheckoutChase({ ...day, checkedInAt: null, nowMinutes: 23 * 60 }),
    ).toBe(false);
  });

  it('never chases a closed day', () => {
    expect(
      needsCheckoutChase({ ...day, checkedOutAt: at('18:05'), nowMinutes: 23 * 60 }),
    ).toBe(false);
  });
});

describe('summarise', () => {
  const day = (status: AttendanceStatus, settled = true, minutes: number | null = null) => ({
    status,
    settled,
    minutes,
  });

  it('counts each status', () => {
    const s = summarise([
      day('present'),
      day('present'),
      day('late'),
      day('absent'),
      day('on_leave'),
      day('off'),
      day('expected', false),
    ]);
    expect(s).toMatchObject({ present: 2, late: 1, absent: 1, onLeave: 1, off: 1, expected: 1 });
  });

  it('keeps days off out of the rate', () => {
    /* ⚠️ Sunday is not a 0% attendance day. Counting rest days would make Blue
       Area and Wah look different at identical attendance. */
    const s = summarise([day('present'), day('off'), day('off')]);
    expect(s.settled).toBe(1);
    expect(s.rate).toBe(100);
  });

  it('keeps approved leave out of the rate', () => {
    /* Counting it would punish the approval. */
    const s = summarise([day('present'), day('on_leave')]);
    expect(s.settled).toBe(1);
    expect(s.rate).toBe(100);
  });

  it('counts a late arrival as attended', () => {
    /* Late is a punctuality problem, not an attendance one — they were there. */
    const s = summarise([day('late'), day('absent')]);
    expect(s.rate).toBe(50);
  });

  it('leaves an unfinished day out of the denominator', () => {
    const s = summarise([day('present'), day('expected', false)]);
    expect(s.settled).toBe(1);
    expect(s.rate).toBe(100);
  });

  it('has no rate at all before anything has settled', () => {
    /* ⚠️ Null, not zero. "0%" on a fresh month reads as "nobody came in". */
    expect(summarise([day('expected', false)]).rate).toBeNull();
    expect(summarise([]).rate).toBeNull();
  });

  it('averages only the days that have hours', () => {
    const s = summarise([day('present', true, 480), day('present', true, 440), day('absent')]);
    expect(s.averageMinutes).toBe(460);
    expect(s.totalMinutes).toBe(920);
  });

  it('rounds the rate to one decimal', () => {
    const s = summarise([day('present'), day('present'), day('present'), day('absent')]);
    expect(s.rate).toBe(75);
    expect(summarise([day('present'), day('present'), day('absent')]).rate).toBe(66.7);
  });
});

describe('the late strike notice', () => {
  const days = [
    { onDate: '2026-08-03', status: 'late' as AttendanceStatus },
    { onDate: '2026-08-11', status: 'late' as AttendanceStatus },
    { onDate: '2026-08-19', status: 'present' as AttendanceStatus },
    { onDate: '2026-09-02', status: 'late' as AttendanceStatus },
  ];

  it('counts lates within one calendar month only', () => {
    expect(lateCountInMonth(days, '2026-08')).toBe(2);
    expect(lateCountInMonth(days, '2026-09')).toBe(1);
  });

  it('is reached at the third late and stays reached', () => {
    /* ⚠️ NOT `=== 3`. The sweep runs nightly, so an exact match means anybody
       whose third late fell on a night it did not run is never told — and so is
       everybody already past three on the day the feature ships. The anti-nag is
       "once per person per month", enforced by the sweep against the notifications
       table, not by this returning false. */
    expect(reachedLateStrike(2)).toBe(false);
    expect(reachedLateStrike(3)).toBe(true);
    expect(reachedLateStrike(4)).toBe(true);
    expect(reachedLateStrike(11)).toBe(true);
  });
});

describe('date ranges', () => {
  it('lists every day of a month', () => {
    expect(datesInMonth('2026-02')).toHaveLength(28);
    expect(datesInMonth('2026-08')).toHaveLength(31);
    expect(datesInMonth('2026-08').at(-1)).toBe('2026-08-31');
  });

  it('handles a leap February', () => {
    expect(datesInMonth('2028-02')).toHaveLength(29);
  });

  it('lists a range inclusively and crosses a month end', () => {
    expect(datesBetween('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('returns nothing for a backwards range', () => {
    expect(datesBetween(TUE, '2026-08-24')).toEqual([]);
  });
});

describe('clockLabel', () => {
  it('shows Karachi time in the reference’s format', () => {
    expect(clockLabel(at('10:04'))).toBe('10:04 AM');
    expect(clockLabel(at('18:15'))).toBe('06:15 PM');
  });

  it('shows a dash for a missing stamp', () => {
    expect(clockLabel(null)).toBe('—');
  });
});

/* ============================================================================
 * How late is late
 * ----------------------------------------------------------------------------
 * The late-arrivals dialog prints this against every row, so the number has to
 * agree with the status pill beside it. The trap is measuring from 10:00 — that
 * would put "20m late" against somebody `dayStatus` calls Present.
 * ========================================================================= */

describe('minutesLate', () => {
  it('measures from the late line, not from the start of the day', () => {
    expect(minutesLate(at('10:47'))).toBe(17);
    expect(minutesLate(at('11:30'))).toBe(60);
  });

  it('returns null for an on-time arrival rather than zero', () => {
    /* Null, so a caller cannot print "0m late" against somebody punctual. */
    expect(minutesLate(at('09:58'))).toBeNull();
    expect(minutesLate(at('10:20'))).toBeNull();
  });

  it('agrees with dayStatus about the 10:30 boundary', () => {
    /* The one place these two could drift apart. 10:30 is on time by the owner's
       rule, so it must be late-by-nothing AND status Present. */
    const boundary = at('10:30');
    expect(minutesLate(boundary)).toBeNull();
    expect(
      dayStatus({
        team: 'blue_area',
        onDate: TUE,
        checkedInAt: boundary,
        today: TUE,
        nowMinutes: 20 * 60,
      }),
    ).toBe('present');

    const justAfter = at('10:31');
    expect(minutesLate(justAfter)).toBe(1);
    expect(
      dayStatus({
        team: 'blue_area',
        onDate: TUE,
        checkedInAt: justAfter,
        today: TUE,
        nowMinutes: 20 * 60,
      }),
    ).toBe('late');
  });

  it('is null for a missing or unreadable stamp', () => {
    expect(minutesLate(null)).toBeNull();
    expect(minutesLate('not a timestamp')).toBeNull();
  });

  it('reads the clock in Karachi, not in the runner’s timezone', () => {
    /* 06:00 Zulu is 11:00 in Karachi — half an hour late. Somewhere west of
       Greenwich a naive getHours() would call this the previous evening. */
    expect(minutesLate('2026-08-25T06:00:00.000Z')).toBe(30);
  });
});
