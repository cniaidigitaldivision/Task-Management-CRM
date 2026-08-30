import type { Metadata } from 'next';

import { AttendanceRangePicker } from '@/components/attendance/attendance-range-picker';
import { AttendanceWorkspace } from '@/components/attendance/attendance-workspace';
import { TerminalHealth } from '@/components/attendance/terminal-panel';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listTerminals } from '@/lib/db/queries/attendance-devices';
import {
  attendanceNow,
  listApprovedLeave,
  listAttendance,
  listAttendees,
  todayFor,
} from '@/lib/db/queries/attendance';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';
import {
  RANGE_KEYS,
  buildAttendanceBoard,
  customRange,
  resolveRange,
  type RangeKey,
} from '@/lib/view/attendance-board';

export const metadata: Metadata = { title: 'Attendance' };

/* ============================================================================
 * ATTENDANCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25. Check in at 10, out at 6, two offices with different days
 * off, and a month of it on one page.
 *
 * ── ⚠️ A MEMBER'S BOARD IS BUILT FROM THEMSELVES ALONE, HERE ────────────────
 * This is the one thing on this page that would be a real problem if it were done
 * in the component. The grid is people × dates, and a Member can SEE every name in
 * the division (the team page is open to everybody) but not their attendance rows
 * — RLS returns only their own. Handing the component the whole team would
 * therefore paint the entire division as absent every day: not a data leak, but a
 * page confidently stating something false about six colleagues.
 *
 * So the people list is narrowed to the caller unless they hold
 * `attendance.view_all`. It is narrowed on the SERVER, above the boundary, so no
 * prop and no filter can undo it.
 *
 * ── ⚠️ ONE CLOCK READING, PASSED DOWN ───────────────────────────────────────
 * `attendanceNow()` asks the database for the Karachi date and minute once, and
 * every status on the page derives from it. Two reads could straddle midnight and
 * produce a page whose cards and rows disagree about which day it is.
 *
 * ── ⚠️ THE PERIOD IS A URL PARAM, INCLUDING A CUSTOM SPAN ───────────────────
 * Owner asked for named ranges, a single day and a date range. All three arrive
 * here as `?range=`, plus `?from=&to=` for the custom case — so the period is
 * shareable, survives a refresh, and comes back from the Back button. Anything
 * unrecognised falls back to this month rather than erroring: a mistyped URL should
 * show a page, not a stack trace.
 * ========================================================================= */

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const canViewAll = can(actor, 'attendance.view_all');
  const canEdit = can(actor, 'attendance.edit');
  /* ⚠️ ONE RUNG NARROWER THAN `view_all`, and deliberately so. Owner, 2026-08-30:
     *"only in admin and superadmin."* A Coordinator may read who was late and may
     not decide whose attendance a face opens. Migration 079 narrows the tables to
     match, so this only decides whether the panel is drawn. */
  const canManageTerminals = can(actor, 'attendance.manage_devices');

  const params = await searchParams;

  /* The clock first: the range depends on what day it is, and everything else
     depends on the range. */
  const now = await attendanceNow();

  const range =
    params.range === 'custom'
      ? customRange(params.from ?? now.today, params.to ?? now.today, now.today)
      : resolveRange(
          RANGE_KEYS.includes(params.range as RangeKey) ? (params.range as RangeKey) : 'this_month',
          now.today,
        );

  const [attendees, records, leave, mine, terminals] = await Promise.all([
    listAttendees(user.id),
    listAttendance(user.id, range),
    listApprovedLeave(user.id, range),
    todayFor(user.id),
    /* ⚠️ Only fetched for somebody who may see them. RLS would return empty
       anyway (079), but a query issued for data the page will not draw is a
       round trip for nothing — the same rule the finance page follows. */
    canManageTerminals ? listTerminals(user.id) : Promise.resolve([]),
  ]);

  /* See the header. */
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

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Attendance"
        description={
          canViewAll
            ? 'Who came in, when, and who has not. Times are recorded by the server in Pakistan time — 10 AM to 6 PM, with two offices on different days off.'
            : 'Your own record. Check in when you arrive and out when you leave; an Admin can correct a day you forgot.'
        }
        /* The reference's top-right chip. In the header rather than in the
           workspace so it sits level with the title, as drawn. */
        actions={<AttendanceRangePicker range={range} today={now.today} />}
      />

      {/* ── IS THE WALL WORKING ───────────────────────────────────────────
          Admin+ only, and only the terminal's HEALTH. Owner, 2026-08-30: *"the
          number of scans today, that's fine, that could be on the attendance
          page but the mapping should be on the team page."* Right — this is read
          while looking at today's attendance and noticing somebody missing, so
          it belongs beside the record it explains. Mapping is a people job and
          lives on Team. */}
      {canManageTerminals && <TerminalHealth terminals={terminals} nowMs={nowMs()} />}

      <AttendanceWorkspace
        board={board}
        range={range}
        today={now.today}
        nowMinutes={now.nowMinutes}
        mine={mine}
        myName={user.fullName}
        canViewAll={canViewAll}
        canEdit={canEdit}
      />
    </div>
  );
}
