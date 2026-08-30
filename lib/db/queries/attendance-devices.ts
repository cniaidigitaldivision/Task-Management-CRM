import 'server-only';

import { withUser } from '@/lib/db/client';
import type { AttendanceMode, ScanMethod } from '@/lib/domain/attendance-device';

/* ============================================================================
 * THE TERMINALS, AND WHO IS ON THEM — owner request 2026-08-30
 * ----------------------------------------------------------------------------
 * Owner, after mapping the first person by hand: *"I want in dashboard this
 * feature."* Fair — mapping somebody should not require somebody else to run
 * SQL for you.
 *
 * ── ⚠️ NO ROLE CHECK IN THIS FILE, AND THAT IS CORRECT ─────────────────────
 * The same rule the finance and library queries state: everything goes through
 * `withUser`, and migration 078 gives these tables their policies — terminals
 * and scans readable from Coordinator up, writable by Admin. A Member calling
 * any of these gets an empty array or a refusal from Postgres without a single
 * `if` here. The actions check `can()` as well; the database is the layer that
 * cannot be forgotten.
 * ========================================================================= */

export interface TerminalRow {
  readonly id: string;
  readonly serialNo: string;
  readonly model: string | null;
  readonly label: string;
  readonly location: string | null;
  readonly isActive: boolean;
  readonly lastSeenAt: string | null;
  readonly lastEventAt: string | null;
  /** Scans in the last 24 hours — the honest "is it working" number. */
  readonly scansToday: number;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

export async function listTerminals(actorId: string): Promise<TerminalRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.id, d.serial_no, d.model, d.label, d.location, d.is_active,
           d.last_seen_at, d.last_event_at,
           (select count(*) from public.attendance_scans s
             where s.device_id = d.id
               and s.scanned_at > now() - interval '24 hours')::int as scans_today
      from public.attendance_devices d
     order by d.label
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    serialNo: r.serial_no as string,
    model: (r.model as string | null) ?? null,
    label: r.label as string,
    location: (r.location as string | null) ?? null,
    isActive: Boolean(r.is_active),
    lastSeenAt: iso(r.last_seen_at),
    lastEventAt: iso(r.last_event_at),
    scansToday: Number(r.scans_today ?? 0),
  }));
}

/* ==========================================================================
 * THE QUEUE — scans that matched nobody
 * ========================================================================== */

export interface UnmatchedRow {
  /** The employee number the terminal sent. This is what gets mapped. */
  readonly employeeNo: string;
  /** What the TERMINAL calls them. The only human clue to who this is. */
  readonly deviceName: string | null;
  readonly scans: number;
  readonly lastScannedAt: string;
  readonly lastMethod: ScanMethod;
  readonly terminalLabel: string;
}

/**
 * Every employee number that has scanned and matched nobody, newest first.
 *
 * ⚠️ GROUPED BY NUMBER, NOT ONE ROW PER SCAN. Somebody unmapped scans four
 * times a day, so a raw list is the same person over and over and the queue
 * looks like forty problems instead of one. Mapping is per PERSON, so the queue
 * is per person too.
 *
 * ⚠️ AND IT ONLY LOOKS AT THE LAST 30 DAYS. The Wah terminal is shared with ~55
 * staff who will never be in Taskly; without a window this list would grow
 * forever with people nobody intends to map, and the one new colleague waiting
 * to be mapped would be buried.
 */
export async function listUnmatched(actorId: string): Promise<UnmatchedRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.employee_no,
           max(s.raw -> 'AccessControllerEvent' ->> 'name') as device_name,
           count(*)::int as scans,
           max(s.scanned_at) as last_scanned_at,
           (array_agg(s.method order by s.scanned_at desc))[1] as last_method,
           max(d.label) as terminal_label
      from public.attendance_scans s
      join public.attendance_devices d on d.id = s.device_id
     where s.outcome = 'unmatched'
       and s.scanned_at > now() - interval '30 days'
     group by s.employee_no
     order by max(s.scanned_at) desc
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    employeeNo: r.employee_no as string,
    deviceName: (r.device_name as string | null) ?? null,
    scans: Number(r.scans ?? 0),
    lastScannedAt: iso(r.last_scanned_at) ?? '',
    lastMethod: (r.last_method as ScanMethod) ?? 'other',
    terminalLabel: (r.terminal_label as string) ?? '',
  }));
}

/* ==========================================================================
 * WHO IS MAPPED
 * ========================================================================== */

export interface EnrolmentRow {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly roleTitle: string | null;
  readonly devicePersonNo: string | null;
  readonly attendanceMode: AttendanceMode;
  readonly isActive: boolean;
  /** When this person last scanned at any terminal. Null if never. */
  readonly lastScanAt: string | null;
}

/**
 * Everybody in Taskly, mapped or not.
 *
 * ⚠️ EVERYBODY, not just the mapped ones — the useful question on this screen
 * is "who is still missing", and a list of the already-done cannot answer it.
 */
export async function listEnrolments(actorId: string): Promise<EnrolmentRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select u.id, u.full_name, u.email, u.role_title, u.device_person_no,
           u.attendance_mode, u.is_active,
           (select max(s.scanned_at) from public.attendance_scans s
             where s.user_id = u.id) as last_scan_at
      from public.users u
     where u.is_active
     order by (u.device_person_no is null), u.full_name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    userId: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    roleTitle: (r.role_title as string | null) ?? null,
    devicePersonNo: (r.device_person_no as string | null) ?? null,
    attendanceMode: r.attendance_mode as AttendanceMode,
    isActive: Boolean(r.is_active),
    lastScanAt: iso(r.last_scan_at),
  }));
}

/* ==========================================================================
 * WRITING
 * ========================================================================== */

/**
 * Point an employee number at a Taskly account.
 *
 * ⚠️ CLEARS THE NUMBER FROM ANYBODY ELSE FIRST. `users_device_person_no_key` is
 * unique, so re-assigning a number somebody else holds would otherwise fail with
 * a constraint error naming an index. Moving it is also what somebody actually
 * means when they map a number that is already taken — the terminal was
 * re-enrolled, and the old owner's mapping is simply wrong now.
 */
export async function mapPerson(
  actorId: string,
  userId: string,
  employeeNo: string | null,
): Promise<void> {
  await withUser(actorId, async (tx) => {
    if (employeeNo !== null) {
      await tx`
        update public.users set device_person_no = null
         where device_person_no = ${employeeNo} and id <> ${userId}
      `;
    }
    await tx`
      update public.users set device_person_no = ${employeeNo} where id = ${userId}
    `;
  });
}

/** Whether somebody may use the Taskly button. Admin-only by trigger (078). */
export async function setAttendanceMode(
  actorId: string,
  userId: string,
  mode: AttendanceMode,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users set attendance_mode = ${mode}::public.attendance_mode
     where id = ${userId}
  `);
}

/**
 * Apply the scans that arrived before somebody was mapped.
 *
 * ⚠️ THE WORK IS IN THE DATABASE, not here — `app.apply_stored_scans` (079).
 * It has to be: the replay writes attendance, and every rule about what a scan
 * may do to a day lives in one place so the two paths cannot drift. This is a
 * one-line caller on purpose.
 */
export async function applyStoredScans(
  actorId: string,
  employeeNo: string,
): Promise<{ applied: number; skipped: number }> {
  const rows = await withUser(actorId, (tx) => tx`
    select applied, skipped from app.apply_stored_scans(${employeeNo})
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return { applied: Number(row?.applied ?? 0), skipped: Number(row?.skipped ?? 0) };
}
