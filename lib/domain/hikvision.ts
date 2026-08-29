/* ============================================================================
 * READING WHAT A HIKVISION TERMINAL SENDS — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * Pure. No database, no network, no clock (doc 20 §1) — so the awkward parts of
 * this format can be tested against real captured payloads without a device on
 * the desk.
 *
 * ── ⚠️ WRITTEN AGAINST THE DOCUMENTED FORMAT, NOT A CAPTURE ─────────────────
 * The terminal is in the Wah office and the team had gone home, so this is built
 * from Hikvision's ISAPI documentation rather than from a message this firmware
 * actually sent. That is a real difference: the shape varies by model and by
 * firmware, and DS-K1T320MFWX on V3.5.20 has not been seen yet.
 *
 * Everything here is therefore built to DEGRADE rather than refuse:
 *
 *   · every field is looked for in several places, because Hikvision moves them
 *   · an unrecognised verification mode becomes `other`, never an error
 *   · the raw payload is stored whatever happens, so a scan can be re-read once
 *     the real shape is known
 *
 * The one thing that is NOT tolerant is identity: no employee number means no
 * attendance, because guessing who somebody is would be worse than dropping it.
 *
 * ⚠️ WHEN THE FIRST REAL PAYLOAD ARRIVES, check it against
 * `lib/domain/__tests__/hikvision.test.ts` and add it as a fixture. That is the
 * moment this file stops being an educated guess.
 * ========================================================================= */

import type { ScanMethod } from './attendance-device';

/* ==========================================================================
 * WHAT WE MANAGED TO READ
 * ========================================================================== */

export interface ParsedScan {
  /** The employee number the terminal was enrolled with. The identity. */
  readonly employeeNo: string;
  /** When the person stood at the terminal, as an ISO string. */
  readonly scannedAt: string;
  readonly method: ScanMethod;
  /** Stable per scan, so a resend is recognised. */
  readonly dedupKey: string;
  /** The terminal's serial, when the message carries it. */
  readonly serialNo: string | null;
  /** The person's name as the DEVICE knows it — for the unmatched queue, so an
   *  Admin sees "1007 — Bilal" rather than a bare number. Never used to identify
   *  anybody: only `employeeNo` does that. */
  readonly deviceName: string | null;
}

export type ParseResult =
  | { readonly ok: true; readonly scan: ParsedScan }
  | { readonly ok: false; readonly reason: string };

/* ==========================================================================
 * DIGGING THINGS OUT
 * ========================================================================== */

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The first non-empty string found at any of these paths.
 *
 * ⚠️ SEVERAL PATHS PER FIELD ON PURPOSE. Hikvision nests access-control fields
 * under `AccessControllerEvent` on most firmware and at the top level on some,
 * and the same value appears as `employeeNoString` on newer builds and
 * `employeeNo` (a number) on older ones. Looking in one place is how this breaks
 * on a firmware update nobody told us about.
 */
function pick(source: Bag, paths: readonly string[]): string | null {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const key of path.split('.')) {
      if (!isBag(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[key];
    }
    if (typeof cursor === 'string' && cursor.trim() !== '') return cursor.trim();
    /* A number is a legitimate employee number on older firmware. `0` is
       excluded deliberately: it is Hikvision's "no employee" filler, not
       somebody's id. */
    if (typeof cursor === 'number' && Number.isFinite(cursor) && cursor !== 0) {
      return String(cursor);
    }
  }
  return null;
}

/* ==========================================================================
 * HOW SOMEBODY WAS RECOGNISED
 * ========================================================================== */

/**
 * ⚠️ `currentVerifyMode` DESCRIBES WHAT THE DOOR ACCEPTS, NOT WHAT WAS USED.
 * A terminal set to `cardOrFaceOrFp` reports that string whether the person
 * showed a face or a finger, so it cannot by itself answer the owner's question
 * — *"I should know that he has checked in with face recognition"*.
 *
 * The minor event type is the field that says what actually happened, so it is
 * read FIRST and the verify mode is only a fallback for the single-method cases
 * where it is unambiguous. Where neither settles it the answer is `other`, which
 * is honest, rather than `face`, which would be a guess printed next to
 * somebody's name.
 */
const MINOR_EVENT_METHOD: Readonly<Record<number, ScanMethod>> = {
  1: 'card',        // legal card authentication passed
  38: 'fingerprint',// fingerprint comparison passed
  75: 'face',       // face authentication passed
  76: 'face',       // face and fingerprint
  77: 'combination',// face and card
  21: 'pin',
};

/** Only the modes that name exactly one method. Anything with `Or`/`And` in it
 *  describes a choice and is deliberately absent. */
const VERIFY_MODE_METHOD: Readonly<Record<string, ScanMethod>> = {
  face: 'face',
  fp: 'fingerprint',
  fingerprint: 'fingerprint',
  card: 'card',
  pw: 'pin',
  password: 'pin',
  pin: 'pin',
};

export function readMethod(event: Bag): ScanMethod {
  const minorRaw = pick(event, [
    'AccessControllerEvent.subEventType',
    'subEventType',
    'AccessControllerEvent.minorEventType',
    'minorEventType',
  ]);
  const minor = minorRaw === null ? Number.NaN : Number(minorRaw);
  if (Number.isFinite(minor) && MINOR_EVENT_METHOD[minor]) return MINOR_EVENT_METHOD[minor];

  const mode = pick(event, [
    'AccessControllerEvent.currentVerifyMode',
    'currentVerifyMode',
    'AccessControllerEvent.verifyMode',
  ]);
  if (mode) {
    const normalised = mode.toLowerCase();
    /* Only an exact single-method match. A substring test would read
       `cardOrFace` as `card`, which is the wrong half of an either/or. */
    if (VERIFY_MODE_METHOD[normalised]) return VERIFY_MODE_METHOD[normalised];
    if (/(or|and)/i.test(mode)) return 'combination';
  }

  return 'other';
}

/* ==========================================================================
 * THE TIME
 * ========================================================================== */

/**
 * ⚠️ AN OFFSET IS REQUIRED, AND A BARE LOCAL TIME IS ASSUMED TO BE KARACHI.
 *
 * Hikvision sends `2026-08-29T18:03:12+05:00` when the terminal knows its
 * timezone, and `2026-08-29T18:03:12` when it does not. Handing the second form
 * to `new Date()` in Node parses it as the SERVER's local time — UTC on Vercel —
 * which files an 18:03 arrival as 23:03 Karachi and makes everybody five hours
 * late.
 *
 * So a string with no offset gets `+05:00` appended rather than being trusted.
 * That is a guess, but it is the right one: the terminal is in Wah, and the
 * setup instructions say to set it to Karachi. The alternative — trusting the
 * server's zone — is a guess too, and a worse one.
 */
export function readScannedAt(raw: string | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const candidate = hasOffset ? trimmed : `${trimmed}+05:00`;

  const at = new Date(candidate);
  if (Number.isNaN(at.getTime())) return null;

  /* A terminal that has never had its clock set reports 1970 or 2000. Those are
     not scans, and letting them through would fill the log with `out_of_range`
     rows that hide the real problem. */
  if (at.getUTCFullYear() < 2020 || at.getUTCFullYear() > 2100) return null;

  return at.toISOString();
}

/* ==========================================================================
 * THE WHOLE MESSAGE
 * ========================================================================== */

/**
 * Turn one posted event into something `app.record_device_scan` can take.
 *
 * ⚠️ AN EMPLOYEE NUMBER IS THE GATE, and it is doing more work than it looks.
 * A terminal reports far more than successful recognitions — door held open,
 * tamper alarms, an unrecognised face, a failed PIN. None of those are
 * attendance, and all of them arrive at this endpoint. Every one of them also
 * lacks an employee number, because the device did not recognise anybody. So
 * requiring one filters the noise using the same fact that makes a scan
 * meaningful, rather than by keeping a list of event codes that a firmware
 * update would invalidate.
 */
export function parseScan(payload: unknown): ParseResult {
  if (!isBag(payload)) return { ok: false, reason: 'The message was not an object.' };

  const employeeNo = pick(payload, [
    'AccessControllerEvent.employeeNoString',
    'AccessControllerEvent.employeeNo',
    'employeeNoString',
    'employeeNo',
  ]);

  if (!employeeNo) {
    return {
      ok: false,
      reason: 'No employee number — not a recognised person, so not attendance.',
    };
  }

  const scannedAt = readScannedAt(
    pick(payload, ['dateTime', 'AccessControllerEvent.dateTime', 'time', 'eventTime']),
  );

  if (!scannedAt) {
    return { ok: false, reason: 'The message carried no usable time.' };
  }

  const serialNo = pick(payload, [
    'AccessControllerEvent.deviceNo',
    'deviceSerialNo',
    'serialNo',
    'AccessControllerEvent.serialNo',
  ]);

  /* ── ⚠️ THE DEDUP KEY, AND WHY IT IS NOT JUST THE EVENT SERIAL ───────────
     Hikvision's `serialNo` on the event is an incrementing counter, which is
     exactly what is wanted — except that it RESETS when the device is factory
     reset or its log is cleared, and it is per-device rather than global. So it
     is used when present, scoped by the employee number and the time, and the
     time alone is the fallback.

     The time is a sound fallback here because a person cannot physically scan
     twice in the same second, and two different people scanning in the same
     second have different employee numbers. */
  const eventSerial = pick(payload, [
    'AccessControllerEvent.serialNo',
    'AccessControllerEvent.eventSerialNo',
  ]);

  const dedupKey = eventSerial
    ? `s:${eventSerial}:${employeeNo}`
    : `t:${scannedAt}:${employeeNo}`;

  return {
    ok: true,
    scan: {
      employeeNo,
      scannedAt,
      method: readMethod(payload),
      dedupKey,
      serialNo,
      deviceName: pick(payload, ['AccessControllerEvent.name', 'name']),
    },
  };
}

/* ==========================================================================
 * WHAT ARRIVED IN THE REQUEST
 * ========================================================================== */

/**
 * Hikvision posts one event, or several, or wraps them.
 *
 * ⚠️ ALL THREE SHAPES ARE REAL. A single event is the common case; a device
 * catching up after a network stall batches them into an array; and some
 * firmware wraps the batch in `{ "events": [...] }`. Handling only the first
 * means a backlog silently becomes one scan.
 */
export function eventsFrom(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isBag(body)) {
    for (const key of ['events', 'eventList', 'AccessControllerEventList']) {
      const nested = body[key];
      if (Array.isArray(nested)) return nested;
    }
    return [body];
  }
  return [];
}
