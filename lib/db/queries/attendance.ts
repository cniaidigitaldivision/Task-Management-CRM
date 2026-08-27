import { sql, withUser } from '@/lib/db/client';

/* ============================================================================
 * ATTENDANCE — READS AND THE TWO WRITES
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE TIMES ARE THE SERVER'S, NOT THE CALLER'S ─────────────────────────
 * Nothing here accepts a check-in or check-out time from the application. The
 * trigger in migration 060 overwrites both with `now()`, so an attendance record
 * cannot be self-reported however the request was made. The one exception is
 * `correctDay`, which is an Admin deliberately stating a time and is recorded as
 * such in `edited_by_id`.
 *
 * ── ⚠️ "TODAY" COMES FROM THE DATABASE ──────────────────────────────────────
 * `app.attendance_today()` — the Karachi date. Never `current_date` (this database
 * runs in UTC) and never the Node process's idea of today, because a check-out at
 * 1am would then be filed against the wrong day and the whole record would drift
 * for people who work late, which the owner says is normal.
 * ========================================================================= */

export interface AttendanceDayRow {
  readonly id: string;
  readonly userId: string;
  readonly userName: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly avatarUrl: string | null;
  readonly officeTeam: string;
  readonly onDate: string;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  readonly editedByName: string | null;
  readonly editedAt: string | null;
  readonly editNote: string | null;
  /** ⚠️ From `availability`, not from this table. Approved leave is not an absence. */
  readonly onLeave: boolean;
}

/** What the top bar's button needs, and nothing else. */
export interface TodayRow {
  readonly onDate: string;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    /* ⚠️ A `date` column comes back as a Date at UTC midnight. `toISOString()`
       would be right, and `toLocaleDateString` would shift it — so slice the ISO
       string and never format it. */
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? '').slice(0, 10);
}

function toRow(row: Record<string, unknown>): AttendanceDayRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    userName: (row.user_name as string | null) ?? 'Somebody',
    roleTitle: (row.role_title as string | null) ?? null,
    role: (row.role as string | null) ?? 'member',
    avatarUrl: (row.avatar_url as string | null) ?? null,
    officeTeam: (row.office_team as string | null) ?? 'blue_area',
    onDate: dateOnly(row.on_date),
    checkedInAt: iso(row.checked_in_at),
    checkedOutAt: iso(row.checked_out_at),
    editedByName: (row.edited_by_name as string | null) ?? null,
    editedAt: iso(row.edited_at),
    editNote: (row.edit_note as string | null) ?? null,
    onLeave: row.on_leave === true,
  };
}

/**
 * The Karachi date and minute the server believes it is.
 *
 * ⚠️ ONE ROUND TRIP, and every status on the page is computed from it. Asking the
 * database twice — once for the date, once inside another query — can straddle
 * midnight and produce a page where the table and the cards disagree about which
 * day it is.
 */
export async function attendanceNow(): Promise<{ today: string; nowMinutes: number }> {
  const rows = await sql`
    select app.attendance_today() as today,
           extract(hour from (now() at time zone 'Asia/Karachi')) * 60
             + extract(minute from (now() at time zone 'Asia/Karachi')) as minutes
  `;
  return {
    today: dateOnly(rows[0]?.today),
    nowMinutes: Number(rows[0]?.minutes ?? 0),
  };
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------- */

/** One person's row for today, or null if they have not checked in. */
export async function todayFor(actorId: string): Promise<TodayRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select on_date, checked_in_at, checked_out_at
      from public.attendance_days
     where user_id = ${actorId}
       and on_date = app.attendance_today()
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    onDate: dateOnly(row.on_date),
    checkedInAt: iso(row.checked_in_at),
    checkedOutAt: iso(row.checked_out_at),
  };
}

/**
 * Every recorded day in a date range, for everybody RLS lets the caller see.
 *
 * ⚠️ ONLY RECORDED DAYS COME BACK. An absence is the absence of a row, so the page
 * builds the grid from the people and the dates and fills it in from this — a
 * query that tried to return "all days including missing ones" would need a
 * generated series crossed with the team and would still not know who was on
 * leave. Deciding that is `lib/domain/attendance.ts`'s job.
 *
 * ⚠️ `on_leave` is joined from `availability`, and only where somebody APPROVED
 * it: an unapproved request is a plan, not a day off, and counting it would let
 * anybody excuse their own absence by filing a request afterwards.
 */
export async function listAttendance(
  actorId: string,
  range: { from: string; to: string },
): Promise<AttendanceDayRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.user_id, a.on_date, a.checked_in_at, a.checked_out_at,
           a.edited_at, a.edit_note,
           u.full_name as user_name, u.role, u.role_title, u.avatar_url, u.office_team,
           e.full_name as edited_by_name,
           exists (
             select 1 from public.availability av
              where av.user_id = a.user_id
                and av.approved_by_id is not null
                and av.type in ('leave', 'holiday')
                and a.on_date between av.start_date and av.end_date
           ) as on_leave
      from public.attendance_days a
      join public.users u on u.id = a.user_id
      left join public.users e on e.id = a.edited_by_id
     where a.on_date between ${range.from}::date and ${range.to}::date
     order by a.on_date desc, u.full_name
  `);
  return rows.map(toRow);
}

/**
 * Approved leave in a range, for people with no attendance row at all.
 *
 * ⚠️ A SEPARATE QUERY, because somebody on leave for a week has no
 * `attendance_days` rows to join `on_leave` onto — so without this they would show
 * as five absences. The join above covers the other case: leave on a day they
 * happened to check in anyway.
 */
export async function listApprovedLeave(
  actorId: string,
  range: { from: string; to: string },
): Promise<{ userId: string; from: string; to: string }[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select user_id, start_date, end_date
      from public.availability
     where approved_by_id is not null
       and type in ('leave', 'holiday')
       and start_date <= ${range.to}::date
       and end_date >= ${range.from}::date
  `);
  return rows.map((row) => ({
    userId: row.user_id as string,
    from: dateOnly(row.start_date),
    to: dateOnly(row.end_date),
  }));
}

/** Who attendance is tracked for: everybody active, with their office. */
export async function listAttendees(actorId: string): Promise<
  {
    id: string;
    name: string;
    roleTitle: string | null;
    role: string;
    avatarUrl: string | null;
    officeTeam: string;
    email: string;
  }[]
> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, full_name, role, role_title, avatar_url, office_team, email
      from public.users
     where is_active and account_state = 'active'
     order by case role when 'super_admin' then 0 when 'admin' then 1
                        when 'team_coordinator' then 2 else 3 end, full_name
  `);
  return rows.map((row) => ({
    id: row.id as string,
    name: (row.full_name as string | null) ?? 'Somebody',
    roleTitle: (row.role_title as string | null) ?? null,
    role: (row.role as string | null) ?? 'member',
    avatarUrl: (row.avatar_url as string | null) ?? null,
    officeTeam: (row.office_team as string | null) ?? 'blue_area',
    email: (row.email as string | null) ?? '',
  }));
}

/* ---------------------------------------------------------------------------
 * The two writes anybody can make
 * ------------------------------------------------------------------------- */

export type CheckResult =
  | { ok: true; at: string; kind: 'in' | 'out' }
  | { ok: false; error: string };

/**
 * Check in.
 *
 * ⚠️ `on conflict do nothing` and then a check, rather than a read followed by an
 * insert. Two taps on a phone are two requests, and the read-then-write version
 * lets both pass the read before either writes — the unique index turns that into
 * an error rather than two rows, and this turns the error into "you are already
 * checked in".
 */
export async function checkIn(actorId: string): Promise<CheckResult> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.attendance_days (user_id)
    values (${actorId})
    on conflict (user_id, on_date) do nothing
    returning checked_in_at
  `);

  const at = iso(rows[0]?.checked_in_at);
  if (at) return { ok: true, at, kind: 'in' };

  /* The conflict fired: today already exists. Which of the two states it is in
     decides what to say, and neither is an error worth a red banner. */
  const existing = await todayFor(actorId);
  if (existing?.checkedOutAt) {
    return { ok: false, error: 'You have already checked out today. Tomorrow is a new day.' };
  }
  return { ok: false, error: 'You are already checked in.' };
}

/**
 * Check out.
 *
 * ⚠️ The `where` does the guarding as well as the trigger: an update that matches
 * no row is a successful update in Postgres, so without `checked_out_at is null`
 * a second press would report success and change nothing. `returning` is what
 * turns "matched nothing" into a value this can read — the same lesson as
 * `updateCredential`.
 */
export async function checkOut(actorId: string): Promise<CheckResult> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.attendance_days
       set checked_out_at = now()
     where user_id = ${actorId}
       and on_date = app.attendance_today()
       and checked_in_at is not null
       and checked_out_at is null
    returning checked_out_at
  `);

  const at = iso(rows[0]?.checked_out_at);
  if (at) return { ok: true, at, kind: 'out' };

  const existing = await todayFor(actorId);
  if (!existing) return { ok: false, error: 'You have not checked in today.' };
  if (existing.checkedOutAt) return { ok: false, error: 'You have already checked out today.' };
  return { ok: false, error: 'That could not be recorded.' };
}

/* ---------------------------------------------------------------------------
 * The Admin's correction
 * ------------------------------------------------------------------------- */

/**
 * Write somebody's times by hand.
 *
 * Owner: *"if we can say he forgot to check out, he can add their checkout time
 * but you can say Kashif or any team coordinator could not do that."*
 *
 * ⚠️ RETURNS WHETHER A ROW WAS WRITTEN. The trigger raises for a Coordinator, but
 * an RLS refusal is silent — an UPDATE matching no row succeeds — so the action
 * needs to be able to tell the difference between "corrected" and "the database
 * declined and I told them it worked".
 *
 * ⚠️ Times arrive as full instants from the caller, which has the person's date and
 * the office timezone. Accepting `HH:MM` here would mean this file deciding what
 * day 00:30 belongs to, and that decision already lives in one place.
 */
export async function correctDay(
  actorId: string,
  input: {
    userId: string;
    onDate: string;
    checkedInAt: string | null;
    checkedOutAt: string | null;
    note: string | null;
  },
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.attendance_days
      (user_id, on_date, checked_in_at, checked_out_at, edited_by_id, edited_at, edit_note)
    values
      (${input.userId}, ${input.onDate}::date, ${input.checkedInAt}, ${input.checkedOutAt},
       ${actorId}, now(), ${input.note})
    on conflict (user_id, on_date) do update
       set checked_in_at  = excluded.checked_in_at,
           checked_out_at = excluded.checked_out_at,
           edited_by_id   = excluded.edited_by_id,
           edited_at      = now(),
           edit_note      = excluded.edit_note
    returning id
  `);
  return rows.length > 0;
}

/** Move somebody between offices. Admin-only, and the trigger says so too. */
export async function setOfficeTeam(
  actorId: string,
  userId: string,
  team: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.users
       set office_team = ${team}::public.office_team
     where id = ${userId}
    returning id
  `);
  return rows.length > 0;
}

/* ---------------------------------------------------------------------------
 * For the sweeps
 * ------------------------------------------------------------------------- */

/**
 * Open days — checked in, never checked out — on or before a date.
 *
 * ⚠️ RUNS AS THE MIGRATION OWNER, not as a person, and is the one function here
 * that does. The 9pm sweep is nobody's session: there is no signed-in user to
 * scope it to, and running it as an Admin would mean the reminder list depended on
 * which Admin happened to be configured. It reads only what it needs to send an
 * email, and it is called from one route that requires `CRON_SECRET`.
 */
export async function openDaysUpTo(
  onOrBefore: string,
): Promise<
  {
    userId: string;
    name: string;
    email: string;
    onDate: string;
    checkedInAt: string;
    officeTeam: string;
  }[]
> {
  const rows = await sql`
    select a.user_id, a.on_date, a.checked_in_at,
           u.full_name, u.email, u.office_team
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where a.checked_out_at is null
       and a.checked_in_at is not null
       and a.on_date <= ${onOrBefore}::date
       and u.is_active
     order by a.on_date, u.full_name
  `;
  return rows.map((row) => ({
    userId: row.user_id as string,
    name: (row.full_name as string | null) ?? 'Somebody',
    email: (row.email as string | null) ?? '',
    onDate: dateOnly(row.on_date),
    checkedInAt: iso(row.checked_in_at) ?? '',
    officeTeam: (row.office_team as string | null) ?? 'blue_area',
  }));
}

/** Every recorded day in a month, for everybody. For the late-strike sweep. */
export async function monthForSweep(
  month: string,
): Promise<
  {
    userId: string;
    name: string;
    email: string;
    officeTeam: string;
    onDate: string;
    checkedInAt: string | null;
  }[]
> {
  const rows = await sql`
    select a.user_id, a.on_date, a.checked_in_at,
           u.full_name, u.email, u.office_team
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where to_char(a.on_date, 'YYYY-MM') = ${month}
       and u.is_active
     order by a.on_date
  `;
  return rows.map((row) => ({
    userId: row.user_id as string,
    name: (row.full_name as string | null) ?? 'Somebody',
    email: (row.email as string | null) ?? '',
    officeTeam: (row.office_team as string | null) ?? 'blue_area',
    onDate: dateOnly(row.on_date),
    checkedInAt: iso(row.checked_in_at),
  }));
}

/**
 * Whether a notification of this kind already exists for this person today.
 *
 * ⚠️ THE WHOLE REASON THE SWEEP CAN BE RUN TWICE. A cron that fires hourly after
 * 9pm must not send four emails, and the digest route's answer — "calling it twice
 * sends two emails, so the schedule must be right" — is acceptable for a morning
 * summary and not for a nag. This makes the sweep idempotent per person per day.
 */
export async function alreadyNotified(
  userId: string,
  kind: string,
  onOrAfter: string,
): Promise<boolean> {
  const rows = await sql`
    select 1
      from public.notifications
     where user_id = ${userId}
       and kind = ${kind}::public.notification_kind
       and created_at >= ${onOrAfter}::timestamptz
     limit 1
  `;
  return rows.length > 0;
}

/** Post an in-app notification. Used only by the sweeps. */
export async function notify(input: {
  userId: string;
  kind: string;
  title: string;
  body: string;
  linkTo: string;
}): Promise<void> {
  await sql`
    insert into public.notifications (user_id, kind, title, body, link_to)
    values (${input.userId}, ${input.kind}::public.notification_kind,
            ${input.title}, ${input.body}, ${input.linkTo})
  `;
}
