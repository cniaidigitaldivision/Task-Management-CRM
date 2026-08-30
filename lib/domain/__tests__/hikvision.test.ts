import { describe, expect, it } from 'vitest';

import { eventsFrom, parseScan, readMethod, readScannedAt } from '../hikvision';
import { isStaleScan } from '../attendance-device';

/* ============================================================================
 * READING A TERMINAL'S MESSAGES
 * ----------------------------------------------------------------------------
 * ⚠️ THESE FIXTURES ARE BUILT FROM HIKVISION'S DOCUMENTATION, NOT FROM A REAL
 * CAPTURE. The terminal is in the Wah office and had nobody near it when this
 * was written, so nothing here has been checked against what DS-K1T320MFWX on
 * firmware V3.5.20 actually sends.
 *
 * That is worth stating loudly, because these tests passing does NOT mean the
 * integration works. It means the parser handles the shapes we expect and
 * degrades sensibly on the ones we do not.
 *
 * ⚠️ WHEN THE FIRST REAL PAYLOAD ARRIVES: paste it in as a fixture here. That is
 * the moment this file stops being an educated guess, and any of the assumptions
 * below that turn out wrong will fail loudly rather than quietly mis-file
 * somebody's arrival.
 * ========================================================================= */

/** The documented shape for an access-control event on a face terminal. */
const REAL_SHAPE = {
  ipAddress: '192.168.1.64',
  portNo: 80,
  protocol: 'HTTP',
  macAddress: 'a4:d5:c2:67:e1:d1',
  channelID: 1,
  dateTime: '2026-08-30T09:58:12+05:00',
  activePostCount: 1,
  eventType: 'AccessControllerEvent',
  eventState: 'active',
  eventDescription: 'Access Controller Event',
  AccessControllerEvent: {
    deviceName: 'Access Control Terminal',
    majorEventType: 5,
    subEventType: 75,
    employeeNoString: '1001',
    name: 'Kashif Ahmed',
    cardReaderNo: 1,
    verifyNo: 1,
    currentVerifyMode: 'cardOrFaceOrFp',
    serialNo: 4471,
    userType: 'normal',
    attendanceStatus: 'undefined',
    mask: 'no',
  },
};

describe('a scan the terminal recognised', () => {
  it('reads the identity, the time and the method', () => {
    const result = parseScan(REAL_SHAPE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scan.employeeNo).toBe('1001');
    expect(result.scan.scannedAt).toBe('2026-08-30T04:58:12.000Z'); // 09:58 Karachi
    expect(result.scan.method).toBe('face');
    expect(result.scan.deviceName).toBe('Kashif Ahmed');
  });

  it('gives the same scan the same dedup key twice', () => {
    const a = parseScan(REAL_SHAPE);
    const b = parseScan(structuredClone(REAL_SHAPE));
    expect(a.ok && b.ok && a.scan.dedupKey === b.scan.dedupKey).toBe(true);
  });

  it('gives two different people in the same second different keys', () => {
    const other = structuredClone(REAL_SHAPE);
    other.AccessControllerEvent.employeeNoString = '1002';
    other.AccessControllerEvent.serialNo = 4472;

    const a = parseScan(REAL_SHAPE);
    const b = parseScan(other);
    expect(a.ok && b.ok && a.scan.dedupKey !== b.scan.dedupKey).toBe(true);
  });

  it('finds the employee number where older firmware puts it', () => {
    const older = { dateTime: '2026-08-30T09:58:12+05:00', employeeNo: 1001 };
    const result = parseScan(older);
    expect(result.ok && result.scan.employeeNo).toBe('1001');
  });

  /* ⚠️ Hikvision fills `employeeNo` with 0 on events that belong to nobody. */
  it('does not read a filler zero as somebody', () => {
    expect(parseScan({ dateTime: '2026-08-30T09:58:12+05:00', employeeNo: 0 }).ok).toBe(false);
  });
});

describe('what is not attendance', () => {
  /* A terminal reports far more than recognitions, and all of it arrives here.
     None of it carries an employee number, which is what makes that the filter
     rather than a list of event codes a firmware update would invalidate. */
  it('refuses a door-open with nobody attached', () => {
    const result = parseScan({
      dateTime: '2026-08-30T09:58:12+05:00',
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: { majorEventType: 5, subEventType: 1024, doorNo: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a face it did not recognise', () => {
    const result = parseScan({
      dateTime: '2026-08-30T09:58:12+05:00',
      AccessControllerEvent: { majorEventType: 5, subEventType: 27, employeeNoString: '' },
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a message with no time', () => {
    expect(parseScan({ AccessControllerEvent: { employeeNoString: '1001' } }).ok).toBe(false);
  });

  it('refuses something that is not an object at all', () => {
    expect(parseScan(null).ok).toBe(false);
    expect(parseScan('hello').ok).toBe(false);
    expect(parseScan([]).ok).toBe(false);
  });
});

describe('the time', () => {
  it('keeps an offset the terminal supplied', () => {
    expect(readScannedAt('2026-08-30T09:58:12+05:00')).toBe('2026-08-30T04:58:12.000Z');
  });

  /* ⚠️ THE ONE THAT MATTERS. A bare local time handed to `new Date()` in Node is
     read in the SERVER's zone — UTC on Vercel — which files an 09:58 arrival as
     14:58 Karachi and makes everybody five hours late. */
  it('assumes Karachi when the terminal sends no offset', () => {
    expect(readScannedAt('2026-08-30T09:58:12')).toBe('2026-08-30T04:58:12.000Z');
  });

  it('is not shifted by the machine timezone', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Karachi', 'Pacific/Midway', 'Pacific/Kiritimati']) {
        process.env.TZ = zone;
        expect(readScannedAt('2026-08-30T09:58:12')).toBe('2026-08-30T04:58:12.000Z');
      }
    } finally {
      process.env.TZ = original;
    }
  });

  /* A terminal that has never had its clock set reports 1970 or 2000. Those are
     not scans, and letting them through fills the log with `out_of_range` rows
     that hide the real problem. */
  it('refuses a terminal whose clock was never set', () => {
    expect(readScannedAt('1970-01-01T00:00:00+05:00')).toBeNull();
    expect(readScannedAt('2000-01-01T08:00:00+05:00')).toBeNull();
  });

  it('refuses nonsense', () => {
    expect(readScannedAt('not a date')).toBeNull();
    expect(readScannedAt('')).toBeNull();
    expect(readScannedAt(null)).toBeNull();
  });
});

describe('how somebody was recognised', () => {
  const withEvent = (event: Record<string, unknown>) => ({ AccessControllerEvent: event });

  it('believes the event code over the verify mode', () => {
    /* The mode says the door accepts three things; the code says which one
       actually happened. The code wins — that is the owner's question. */
    expect(readMethod(withEvent({ subEventType: 75, currentVerifyMode: 'cardOrFaceOrFp' })))
      .toBe('face');
    expect(readMethod(withEvent({ subEventType: 38, currentVerifyMode: 'cardOrFaceOrFp' })))
      .toBe('fingerprint');
    expect(readMethod(withEvent({ subEventType: 1, currentVerifyMode: 'cardOrFaceOrFp' })))
      .toBe('card');
  });

  it('falls back to the mode only when it names one method', () => {
    expect(readMethod(withEvent({ currentVerifyMode: 'face' }))).toBe('face');
    expect(readMethod(withEvent({ currentVerifyMode: 'fp' }))).toBe('fingerprint');
    expect(readMethod(withEvent({ currentVerifyMode: 'card' }))).toBe('card');
  });

  /* ⚠️ `cardOrFace` must not read as `card`. A substring test would pick the
     wrong half of an either/or and print it beside somebody's name. */
  it('does not pick a half out of an either/or', () => {
    expect(readMethod(withEvent({ currentVerifyMode: 'cardOrFace' }))).toBe('combination');
    expect(readMethod(withEvent({ currentVerifyMode: 'faceAndFp' }))).toBe('combination');
  });

  it('says "not recorded" rather than guessing', () => {
    expect(readMethod(withEvent({}))).toBe('other');
    expect(readMethod(withEvent({ subEventType: 9999 }))).toBe('other');
    expect(readMethod({})).toBe('other');
  });
});

describe('how many events arrived', () => {
  it('takes a single event', () => {
    expect(eventsFrom(REAL_SHAPE)).toHaveLength(1);
  });

  /* ⚠️ A device catching up after a network stall batches them. Handling only
     the single case means a backlog silently becomes one scan. */
  it('takes a batch', () => {
    expect(eventsFrom([REAL_SHAPE, REAL_SHAPE, REAL_SHAPE])).toHaveLength(3);
  });

  it('takes a wrapped batch', () => {
    expect(eventsFrom({ events: [REAL_SHAPE, REAL_SHAPE] })).toHaveLength(2);
    expect(eventsFrom({ eventList: [REAL_SHAPE] })).toHaveLength(1);
  });

  it('takes nothing from nothing', () => {
    expect(eventsFrom(null)).toHaveLength(0);
    expect(eventsFrom('')).toHaveLength(0);
  });
});

/* ============================================================================
 * TOO OLD TO MATTER
 * ----------------------------------------------------------------------------
 * ⚠️ THIS RULE WAS WRITTEN AGAINST A LIVE INCIDENT. Connecting the Wah terminal
 * made it replay seven months of stored events — ~45,000 of them — each costing
 * a database round trip, while the scans that mattered queued behind. The
 * database already refuses anything over a week old; this lets the route work
 * that out before paying for the round trip.
 * ========================================================================= */

describe('scans too old to become attendance', () => {
  /* A fixed "now" so the boundary is a fact rather than a race. */
  const now = Date.parse('2026-08-30T10:00:00Z');
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

  it('keeps anything recent enough to still be filed', () => {
    expect(isStaleScan(daysAgo(0), now)).toBe(false);
    expect(isStaleScan(daysAgo(1), now)).toBe(false);
    expect(isStaleScan(daysAgo(7), now)).toBe(false);
  });

  /* ⚠️ THE MARGIN IS THE POINT. The database's limit is seven days; this is ten.
     Days 8 and 9 are kept here even though the database will refuse them, so
     that a rounding or a few minutes of clock drift can never make this discard
     something the database would have accepted. */
  it('keeps the three days of margin over the database rule', () => {
    expect(isStaleScan(daysAgo(8), now)).toBe(false);
    expect(isStaleScan(daysAgo(9), now)).toBe(false);
  });

  it('drops what is genuinely historical', () => {
    expect(isStaleScan(daysAgo(11), now)).toBe(true);
    expect(isStaleScan(daysAgo(60), now)).toBe(true);
    /* The real backlog: January events replayed at the end of August. */
    expect(isStaleScan('2026-01-25T12:22:06+05:00', now)).toBe(true);
  });

  /* ⚠️ A FUTURE DATE IS A FAULT, NOT NOISE. A terminal whose clock has drifted
     forward needs somebody to look at it, so those are kept and recorded as
     `out_of_range` — dropping them here would hide the problem. */
  it('never drops a scan dated in the future', () => {
    expect(isStaleScan(daysAgo(-1), now)).toBe(false);
    expect(isStaleScan(daysAgo(-400), now)).toBe(false);
  });

  it('keeps anything it cannot read a date from', () => {
    expect(isStaleScan('not a date', now)).toBe(false);
  });
});
