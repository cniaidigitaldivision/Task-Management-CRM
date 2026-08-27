'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import * as A from '@/lib/db/queries/attendance';
import { OFFICE_TEAM_KEYS, localDate } from '@/lib/domain/attendance';
import { can } from '@/lib/domain/permissions';
import {
  attendanceCharts,
  buildAttendanceReport,
  describeAttendanceFilters,
} from '@/lib/domain/attendance-report';
import { reportFileStem } from '@/lib/domain/reports';
import { reportFileName, reportToCsv, reportToXlsx } from '@/lib/export/report-writers';
import { composeReportSheet } from '@/lib/pdf/report-sheet';
import {
  GRANULARITIES,
  RANGE_KEYS,
  buildAttendanceBoard,
  customRange,
  filterAttendanceRows,
  groupColumns,
  rangeLabel,
  resolveRange,
  type Granularity,
  type RangeKey,
  type RowFilters,
} from '@/lib/view/attendance-board';

/* ============================================================================
 * ATTENDANCE — THE TWO BUTTONS AND THE ADMIN'S PENCIL
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO TIME EVER CROSSES THIS BOUNDARY ───────────────────────────────────
 * `checkInAction` and `checkOutAction` take NO arguments. The moment is `now()`
 * inside the database, forced by the trigger in migration 060. A signature that
 * accepted a timestamp would be a self-reported attendance system with extra
 * steps, and the whole point of the feature is that the record is not a claim.
 *
 * ── ⚠️ WHY THE CORRECTION IS A SEPARATE ACTION WITH A SEPARATE PERMISSION ───
 * Owner, naming the person: *"he forgot to check out, he can add their checkout
 * time but you can say Kashif or any team coordinator could not do that."* So
 * `attendance.edit` is Admin-and-above while `attendance.view_all` includes the
 * Coordinator. A Coordinator sees everything and changes nothing.
 *
 * Three layers say so: this check, the trigger in 060, and the RLS policy. The
 * first is a courtesy — it produces a sentence instead of a raised exception —
 * and the other two are the boundary.
 *
 * ── EVERY CORRECTION IS AUDITED ─────────────────────────────────────────────
 * A rewritten attendance record is the kind of thing somebody argues about
 * months later, so it lands in the audit log as well as in `edited_by_id`.
 * ========================================================================= */

export type AttendanceResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** Where attendance is shown, and so what has to be re-rendered after a write. */
function refresh(): void {
  revalidatePath('/attendance');
  /* ⚠️ The layout too: the top bar's button is rendered there, and without this
     it keeps saying "Check in" until the next full navigation. */
  revalidatePath('/', 'layout');
}

export async function checkInAction(): Promise<AttendanceResult> {
  const user = await requireUser();

  /* Everybody can, including the Super Admin — see the matrix. Checked anyway so
     that a future change to the rule takes effect here without an edit. */
  if (!can({ role: user.role, id: user.id }, 'attendance.check_in')) {
    return { ok: false, error: 'You cannot record attendance.' };
  }

  const result = await A.checkIn(user.id);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, message: 'Checked in. Have a good day.' };
}

export async function checkOutAction(): Promise<AttendanceResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'attendance.check_in')) {
    return { ok: false, error: 'You cannot record attendance.' };
  }

  const result = await A.checkOut(user.id);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, message: 'Checked out. See you tomorrow.' };
}

/**
 * Correct one person's day.
 *
 * ⚠️ Times arrive as `HH:MM` in Karachi and are assembled against `onDate` HERE,
 * because the office timezone is a property of the division and not of whichever
 * browser submitted the form. A person in a different timezone correcting a record
 * must not shift it.
 */
export async function correctDayAction(input: {
  userId: string;
  onDate: string;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
}): Promise<AttendanceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'attendance.edit')) {
    return {
      ok: false,
      error: 'Only an Admin can change an attendance record. You can see it but not edit it.',
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) {
    return { ok: false, error: 'That is not a date.' };
  }

  /* ⚠️ Refused rather than silently swapped. An Admin who types the times the
     wrong way round means to type them the right way round, and a system that
     quietly reorders them teaches nobody. */
  const checkedInAt = instantFrom(input.onDate, input.checkIn);
  const checkedOutAt = instantFrom(input.onDate, input.checkOut);

  if (input.checkIn && !checkedInAt) return { ok: false, error: 'The check-in time is not a time.' };
  if (input.checkOut && !checkedOutAt) {
    return { ok: false, error: 'The check-out time is not a time.' };
  }
  if (checkedOutAt && !checkedInAt) {
    return { ok: false, error: 'Add a check-in time as well — a day cannot end before it starts.' };
  }
  if (checkedInAt && checkedOutAt && checkedOutAt < checkedInAt) {
    return { ok: false, error: 'The check-out time is before the check-in time.' };
  }

  const written = await A.correctDay(user.id, {
    userId: input.userId,
    onDate: input.onDate,
    checkedInAt,
    checkedOutAt,
    note: input.note?.trim() ? input.note.trim() : null,
  });

  /* ⚠️ An UPDATE that matches no row is a successful UPDATE. Without this the
     dialogue would close saying "Saved" after the database declined. */
  if (!written) {
    return { ok: false, error: 'That was not saved — the database declined the change.' };
  }

  /* ⚠️ `entityId` is the person the record belongs to, not the row's id. The
     question asked of this log is "who has been editing whose attendance", and a
     row id answers neither half of it. */
  await auditAlone(user, {
    entityType: 'attendance',
    entityId: input.userId,
    action: 'attendance.corrected',
    after: {
      onDate: input.onDate,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      note: input.note ?? null,
    },
  });

  refresh();
  return { ok: true, message: 'The record was corrected.' };
}

export async function setOfficeTeamAction(
  userId: string,
  team: string,
): Promise<AttendanceResult> {
  const user = await requireUser();

  /* ⚠️ `attendance.edit`, not `user.edit_profile`. Which office somebody is in
     decides which days count as their absences, so moving them rewrites the
     meaning of every past Friday and Sunday on their record. That is the same
     weight as correcting a time, not the same as fixing a phone number. */
  if (!can({ role: user.role, id: user.id }, 'attendance.edit')) {
    return { ok: false, error: 'Only an Admin can move somebody between offices.' };
  }

  if (!OFFICE_TEAM_KEYS.includes(team as (typeof OFFICE_TEAM_KEYS)[number])) {
    return { ok: false, error: 'That is not one of the offices.' };
  }

  const written = await A.setOfficeTeam(user.id, userId, team);
  if (!written) return { ok: false, error: 'That was not saved.' };

  await auditAlone(user, {
    entityType: 'attendance',
    entityId: userId,
    action: 'attendance.office_changed',
    after: { team },
  });

  refresh();
  revalidatePath('/team');
  return { ok: true, message: 'Their office was changed.' };
}

/* ---------------------------------------------------------------------------
 * Karachi wall-clock → instant
 * ------------------------------------------------------------------------- */

/**
 * `2026-08-25` + `18:05` → the instant that wall-clock reads in Karachi.
 *
 * ⚠️ THE OFFSET IS FOUND, NOT ASSUMED. Writing `T18:05:00+05:00` would hard-code
 * Pakistan's current offset, and Pakistan has observed daylight saving twice in
 * living memory (2002, 2008–09). This builds a UTC guess, asks what wall-clock
 * that lands on in Karachi, and corrects by the difference — so it stays right
 * through any future change without this file knowing about it.
 */
function instantFrom(onDate: string, hhmm: string | null): string | null {
  if (!hhmm) return null;
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const [y, m, d] = onDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hours, minutes);

  /* What that instant actually reads as, on the office wall. */
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(guess));
  const [gotH, gotM] = parts.split(':').map(Number);

  /* The gap between what we wanted and what we got IS the offset. Wrapped to
     ±12 hours so a date rollover does not turn +5 into −19. */
  let driftMinutes = gotH * 60 + gotM - (hours * 60 + minutes);
  if (driftMinutes > 720) driftMinutes -= 1440;
  if (driftMinutes < -720) driftMinutes += 1440;

  const at = guess - driftMinutes * 60_000;

  /* ⚠️ A last sanity check: the instant must fall on the date it was filed
     against, in Karachi. Otherwise a mistyped hour silently moves the record to
     the next day and the person's absence stays. */
  if (localDate(at) !== onDate) return null;

  return new Date(at).toISOString();
}

/* ---------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

export interface AttendanceExport {
  readonly ok: true;
  readonly fileName: string;
  /** CSV text, or base64 for the spreadsheet and the PDF. */
  readonly content: string;
  readonly encoding: 'text' | 'base64';
  readonly rowCount: number;
}

export interface AttendanceExportRequest {
  readonly range: string;
  readonly from: string;
  readonly to: string;
  readonly team: string;
  readonly status: string;
  readonly query: string;
  readonly onDate: string;
  readonly granularity: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
}

/**
 * Attendance as a file, through the Reports page's own print sheet.
 *
 * Owner, 2026-08-25: *"When exporting the PDF you should use the same template
 * that you have already been using… Just put this data over there."* So the PDF is
 * `composeReportSheet` — the same header band, figure cards, table and notes block
 * the Reports page prints — fed an attendance `Report`.
 *
 * ── ⚠️ REBUILT SERVER-SIDE, NOT TAKEN FROM THE BROWSER ──────────────────────
 * The client sends what it was LOOKING at — the range and the four filters — and
 * this re-reads and re-derives from them. It never accepts rows or figures. A
 * report posted back could claim any numbers at all, and this is the artefact that
 * leaves the building with the division's name on it. The same rule, and the same
 * reason, as `exportReportAction`.
 *
 * ⚠️ Because the filters are re-applied here through the SAME
 * `filterAttendanceRows` the table uses, the file contains exactly the rows on
 * screen — which is what was asked for.
 */
export async function exportAttendanceAction(
  request: AttendanceExportRequest,
): Promise<AttendanceExport | { ok: false; error: string }> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!['csv', 'xlsx', 'pdf'].includes(request.format)) {
    return { ok: false, error: 'Unknown export format.' };
  }

  const canViewAll = can(actor, 'attendance.view_all');

  const now = await A.attendanceNow();
  const range =
    request.range === 'custom'
      ? customRange(request.from, request.to, now.today)
      : resolveRange(
          (RANGE_KEYS as readonly string[]).includes(request.range)
            ? (request.range as RangeKey)
            : 'this_month',
          now.today,
        );

  const [attendees, records, leave] = await Promise.all([
    A.listAttendees(user.id),
    A.listAttendance(user.id, range),
    A.listApprovedLeave(user.id, range),
  ]);

  /* Narrowed exactly as the page narrows it — see the note there. */
  const people = canViewAll ? attendees : attendees.filter((person) => person.id === user.id);

  const board = buildAttendanceBoard({
    people,
    records,
    leave,
    from: range.from,
    to: range.to,
    today: now.today,
    nowMinutes: now.nowMinutes,
  });

  const filters: RowFilters = {
    team: canViewAll ? request.team : 'all',
    status: request.status,
    query: request.query,
    onDate: /^\d{4}-\d{2}-\d{2}$/.test(request.onDate) ? request.onDate : '',
  };

  const rows = filterAttendanceRows(board.rows, filters);

  const granularity: Granularity = GRANULARITIES.includes(request.granularity as Granularity)
    ? (request.granularity as Granularity)
    : 'daily';

  const input = {
    board,
    rows,
    from: range.from,
    to: range.to,
    rangeLabel: rangeLabel(range),
    filters: describeAttendanceFilters(filters),
    canViewAll,
    columns: groupColumns(board.days, granularity),
  };

  const report = buildAttendanceReport(input);
  const stem = reportFileStem(report);

  if (request.format === 'csv') {
    return {
      ok: true,
      fileName: reportFileName(stem, 'csv'),
      content: reportToCsv(report),
      encoding: 'text',
      rowCount: rows.length,
    };
  }

  if (request.format === 'xlsx') {
    return {
      ok: true,
      fileName: reportFileName(stem, 'xlsx'),
      content: (await reportToXlsx(report)).toString('base64'),
      encoding: 'base64',
      rowCount: rows.length,
    };
  }

  const pdf = await composeReportSheet({
    report,
    /* ⚠️ Null: `work` turns on the designed table built for the WORK report, whose
       rows carry avatars, brand marks and platform icons. Attendance has none of
       those, so it takes the generic table — which is the same one the four
       analytical reports print. */
    work: null,
    /* The same two charts the screen is showing, at the same granularity. */
    charts: attendanceCharts(input),
    filterSummary: input.filters,
    generatedOn: now.today,
    generatedBy: user.fullName,
  });

  await auditAlone(user, {
    entityType: 'attendance',
    entityId: null,
    action: 'attendance.exported',
    after: { format: request.format, from: range.from, to: range.to, rows: rows.length },
  });

  return {
    ok: true,
    fileName: reportFileName(stem, 'pdf'),
    content: Buffer.from(pdf).toString('base64'),
    encoding: 'base64',
    rowCount: rows.length,
  };
}
