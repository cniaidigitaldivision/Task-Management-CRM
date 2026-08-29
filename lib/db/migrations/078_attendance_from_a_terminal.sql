-- ============================================================================
-- 078 · ATTENDANCE FROM THE WALL — owner request 2026-08-29
-- ----------------------------------------------------------------------------
-- A Hikvision DS-K1T320MFWX face terminal (serial GB4571046) in the Wah office.
-- It posts a message every time somebody scans, and that message has to become a
-- row in `attendance_days` — the same table the check-in button already writes.
--
-- Owner: *"I want people to come and check in on that machine… in the same way
-- when they are going out, they will go and check out from there… I want to not
-- disturb any of these things."*
--
-- ── ⚠️ THE BUTTON IS NOT TOUCHED ────────────────────────────────────────────
-- `checkIn()` and `checkOut()` behave exactly as they did. Every existing row is
-- `self` on both halves. The terminal writes through a SEPARATE, single door —
-- `app.record_device_scan` — and both doors are recorded.
--
-- ── ⚠️ WHY THE TERMINAL'S OWN CLOCK IS KEPT, NOT `now()` ────────────────────
-- 060 stamps the arrival time on the server on purpose: *"a check-in time is the
-- moment the button was pressed on the server, or the whole feature is
-- self-reported."* Right for a button, WRONG for a terminal.
--
-- A scan crosses a network. A Wi-Fi stall, a cold serverless function, or an
-- hour of no internet all put real distance between the moment somebody stood at
-- the wall and the moment we hear about it. Stamping `now()` records the delay as
-- lateness — and lateness here is a payroll argument.
--
-- So this path keeps `scanned_at`, the time the terminal recorded. Which makes
-- the terminal's clock a payroll input: it must be NTP-synced and set to
-- Karachi, and the function refuses anything implausible rather than filing it.
--
-- ── ⚠️ WHO MAY USE WHICH DOOR IS A POLICY, NOT A FREE CHOICE ────────────────
-- Owner, on being shown that somebody could scan in at the wall and close their
-- day from their phone: *"I don't want to check in and check out first…
-- If I want to set that, definitely as admin I will set that or as super admin.
-- No one else has the authority to change it."*
--
-- So `users.attendance_mode` decides, and only an Admin may change it — enforced
-- by trigger, exactly like `office_team` in 060.
--
-- ── ⚠️ NOTHING IS EVER DROPPED ──────────────────────────────────────────────
-- Every scan is written to `attendance_scans` whether or not it matched somebody
-- and whether or not it changed anything. A scan from an employee number nobody
-- has mapped is the normal case on day one; discarding it silently means
-- somebody's attendance disappears with no trace of why.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE VOCABULARY
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠️ TWO SOURCE COLUMNS FOLLOW FROM THIS, NOT ONE. Arriving and leaving are
-- separate events and — where the policy allows it — can come from different
-- places. One `source` column would have to pick which of the two to record.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_source') then
    create type public.attendance_source as enum ('self', 'device');
  end if;
end $$;

comment on type public.attendance_source is
  'How a time was recorded: `self` = the button in Taskly, `device` = a scan at '
  'a terminal (078).';

-- Owner: *"I should know that he has checked in with face recognition or with a
-- face"*. The terminal reports how it recognised somebody, so it is kept.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_method') then
    create type public.scan_method as enum (
      'face', 'fingerprint', 'card', 'pin', 'combination', 'other'
    );
  end if;
end $$;

comment on type public.scan_method is
  'How the terminal recognised somebody. `combination` is a device configured to '
  'require two of them; `other` is anything a future firmware reports that this '
  'list does not name — kept rather than refused, because losing a real scan is '
  'worse than an imprecise label (078).';

-- ⚠️ TWO VALUES, NOT THREE. There is deliberately no `app_only`: somebody who
-- physically stood at the terminal and scanned WAS there, and refusing that fact
-- would make the record less true, not more controlled. The policy therefore
-- governs the one thing that can honestly be governed — whether the button is
-- available to a person who is expected to be at a wall.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_mode') then
    create type public.attendance_mode as enum ('either', 'terminal_only');
  end if;
end $$;

comment on type public.attendance_mode is
  'Whether somebody may use the Taskly button. `either` = button and terminal '
  'both (remote staff, and anybody before the terminal is live). '
  '`terminal_only` = they attend an office and must scan. Admin-only to change '
  '(078).';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · WHAT EACH ATTENDANCE ROW NOW REMEMBERS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.attendance_days
  -- ⚠️ DEFAULT 'self' AND NOT NULL. Every row that exists today was the button,
  -- so the default states a true fact about history rather than filling a gap.
  add column if not exists check_in_source   public.attendance_source not null default 'self',
  add column if not exists check_out_source  public.attendance_source not null default 'self',
  -- Null on a button press: pressing a button is not a recognition method, and
  -- writing 'other' there would invent a fact.
  add column if not exists check_in_method   public.scan_method,
  add column if not exists check_out_method  public.scan_method,
  add column if not exists device_id         uuid;

comment on column public.attendance_days.check_in_source is
  'Where the arrival time came from. Existing rows are all `self` because the '
  'button was the only way in until 078.';
comment on column public.attendance_days.check_in_method is
  'How the terminal recognised them, when it was a terminal. Null for a button '
  'press — see 078.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE TERMINALS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.attendance_devices (
  id          uuid primary key default gen_random_uuid(),

  -- ⚠️ THE SERIAL IS THE IDENTITY, not the IP and not the MAC. An IP moves the
  -- first time the router reboots; a MAC can be set in software. The serial is
  -- printed on the box and is in every message the device sends.
  serial_no   text not null,
  model       text,
  label       text not null,
  location    text,

  -- ⚠️ A HASH, NEVER THE SECRET. This endpoint is the one thing in the
  -- application reachable without signing in, so the shared secret is the whole
  -- gate — and a gate kept in plaintext is one database read from being copied.
  --
  -- ⚠️ sha256 RATHER THAN bcrypt, DELIBERATELY. This is verified on every single
  -- scan, and a deliberately slow hash on an unauthenticated hot path is a
  -- denial of service anybody can trigger from outside by posting rubbish. The
  -- secret is 32 random bytes we generate, not a human password, so the offline
  -- guessing bcrypt defends against does not apply.
  secret_hash text not null,

  is_active   boolean not null default true,

  -- Health. Lets the admin screen say "not heard from since Tuesday" instead of
  -- showing an empty list and letting somebody conclude nobody came in.
  last_seen_at  timestamptz,
  last_event_at timestamptz,

  created_by_id uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint attendance_devices_serial_present check (btrim(serial_no) <> ''),
  constraint attendance_devices_label_present  check (btrim(label) <> '')
);

create unique index if not exists attendance_devices_serial_key
  on public.attendance_devices (upper(btrim(serial_no)));

comment on table public.attendance_devices is
  'The attendance terminals. Identified by SERIAL — an IP moves and a MAC can be '
  'spoofed (078).';

alter table public.attendance_days drop constraint if exists attendance_days_device_fk;
alter table public.attendance_days
  add constraint attendance_days_device_fk
  foreign key (device_id) references public.attendance_devices (id) on delete set null;

alter table public.attendance_devices enable row level security;

do $$
begin
  -- Readable by Coordinator and above: the same audience that may already see
  -- everybody's attendance (060), so the terminal and the record it produces
  -- have one audience rather than two.
  if not exists (select 1 from pg_policy where polname = 'attendance_devices_select') then
    create policy attendance_devices_select on public.attendance_devices
      for select to cni_app
      using (app.acting_at_least('team_coordinator'::public.user_role));
  end if;

  -- Admin only to write: registering a terminal is handing out a key to the
  -- attendance record.
  if not exists (select 1 from pg_policy where polname = 'attendance_devices_write') then
    create policy attendance_devices_write on public.attendance_devices
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end $$;

grant select, insert, update, delete on public.attendance_devices to cni_app;
revoke all on public.attendance_devices from anon, authenticated;

drop trigger if exists attendance_devices_touch on public.attendance_devices;
create trigger attendance_devices_touch
  before update on public.attendance_devices
  for each row execute function app.touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · WHO IS WHO, AND WHICH DOOR THEY USE
-- ════════════════════════════════════════════════════════════════════════════
-- The terminal knows people as an employee number it was enrolled with — "1001"
-- — and knows nothing about Taskly. This column is the whole translation.
--
-- ⚠️ A COLUMN RATHER THAN A MAPPING TABLE, and the trade is worth stating:
-- Hikvision's employee number is per-device, so a SECOND terminal numbering the
-- same people differently would need a real table. With one terminal and eight
-- people that table is ceremony. If Blue Area gets its own terminal, either
-- number people identically on both — which anybody would do anyway — or promote
-- this then.
alter table public.users
  add column if not exists device_person_no text,
  -- ⚠️ DEFAULT 'either', so applying this migration changes nobody's behaviour.
  -- An Admin moves the office staff to `terminal_only` once the wall is live.
  add column if not exists attendance_mode public.attendance_mode not null default 'either';

comment on column public.users.device_person_no is
  'This person''s employee number on the terminal. Null for anybody not enrolled '
  '— remote staff never are (078).';
comment on column public.users.attendance_mode is
  'Whether this person may use the Taskly check-in button. Admin-only to change, '
  'enforced by app.guard_attendance_mode (078).';

-- ⚠️ Unique where present. Two people sharing a number means every scan is filed
-- against whichever row the query happened to return first — a bug that looks
-- exactly like somebody else's attendance.
create unique index if not exists users_device_person_no_key
  on public.users (device_person_no)
  where device_person_no is not null;

-- ── Only an Admin may move somebody between doors ───────────────────────────
-- ⚠️ A TRIGGER, because RLS cannot express a column-level rule, and this is the
-- owner's explicit instruction: *"no one else has the authority to change it."*
-- Same shape as `app.guard_office_team` in 060.
create or replace function app.guard_attendance_mode()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
begin
  if new.attendance_mode is distinct from old.attendance_mode
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an Admin can change how somebody records attendance.'
      using errcode = 'check_violation';
  end if;
  -- Enrolling somebody on the terminal is the same kind of act, and the same
  -- rank: it decides whose face opens whose attendance record.
  if new.device_person_no is distinct from old.device_person_no
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an Admin can enrol somebody on an attendance terminal.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists users_attendance_mode_guard on public.users;
create trigger users_attendance_mode_guard
  before update of attendance_mode, device_person_no on public.users
  for each row execute function app.guard_attendance_mode();


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · EVERY SCAN, KEPT
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_outcome') then
    create type public.scan_outcome as enum (
      'opened_day',   -- became somebody's arrival
      'closed_day',   -- moved their leaving time
      'ignored',      -- a scan between the two; nothing to change
      'unmatched',    -- no Taskly account carries that employee number
      'duplicate',    -- the terminal sent it twice
      'out_of_range', -- dated too far ahead or behind: a clock problem
      'locked'        -- an Admin has corrected that day by hand
    );
  end if;
end $$;

comment on type public.scan_outcome is
  'What a scan did. Recorded so a day that looks wrong is explained by the scans '
  'behind it rather than guessed at (078).';

create table if not exists public.attendance_scans (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.attendance_devices (id) on delete cascade,

  -- As the terminal sent it. Kept even once resolved, because the resolution can
  -- be wrong and this is the only way back to what actually arrived.
  employee_no text not null,
  user_id     uuid references public.users (id) on delete set null,

  method      public.scan_method not null default 'other',

  -- ⚠️ THE TERMINAL'S CLOCK — the reason this file's header is as long as it is.
  scanned_at  timestamptz not null,
  -- Ours. The gap between the two is the network delay, and being able to see it
  -- matters: a widening gap is a terminal losing its Wi-Fi.
  received_at timestamptz not null default now(),

  outcome     public.scan_outcome not null,
  on_date     date,

  -- ⚠️ WHAT MAKES A RESEND HARMLESS. Hikvision retries, and a bridge catching up
  -- after an outage replays. Without this, one arrival becomes three and the
  -- middle one silently becomes a departure.
  dedup_key   text not null,

  raw         jsonb,
  created_at  timestamptz not null default now(),

  constraint attendance_scans_employee_present check (btrim(employee_no) <> '')
);

create unique index if not exists attendance_scans_dedup_key
  on public.attendance_scans (device_id, dedup_key);

create index if not exists attendance_scans_recent_idx
  on public.attendance_scans (scanned_at desc);

-- ⚠️ Finds the scans an Admin has to act on — somebody scanned and Taskly does
-- not know who they are — without reading the whole log.
create index if not exists attendance_scans_unmatched_idx
  on public.attendance_scans (received_at desc)
  where outcome = 'unmatched';

create index if not exists attendance_scans_person_idx
  on public.attendance_scans (user_id, scanned_at desc);

comment on table public.attendance_scans is
  'Every scan the terminals reported — matched or not, applied or not. The audit '
  'trail behind attendance_days and the only way to replay a mis-mapped person '
  '(078).';

alter table public.attendance_scans enable row level security;

do $$
begin
  -- Your own scans always; everybody's from Coordinator up. The same rule
  -- `attendance_days_select` uses, so the log and the record it explains have
  -- one audience.
  if not exists (select 1 from pg_policy where polname = 'attendance_scans_select') then
    create policy attendance_scans_select on public.attendance_scans
      for select to cni_app
      using (
        user_id = app.current_user_id()
        or app.acting_at_least('team_coordinator'::public.user_role)
      );
  end if;

  -- ⚠️ NO INSERT POLICY, DELIBERATELY. Nothing signed in may write a scan: the
  -- only writer is `app.record_device_scan`, which is SECURITY DEFINER and so
  -- not subject to this. Somebody who could forge a row here could forge
  -- attendance. UPDATE exists only so an Admin can re-resolve a mis-mapped one.
  if not exists (select 1 from pg_policy where polname = 'attendance_scans_update') then
    create policy attendance_scans_update on public.attendance_scans
      for update to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end $$;

grant select, update on public.attendance_scans to cni_app;
-- ⚠️ NO INSERT and NO DELETE for anybody, matching 060's rule for attendance
-- itself. A scan records something that happened at a physical door; it is
-- explained, never removed.
revoke all on public.attendance_scans from anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · THE GUARD LEARNS ABOUT THE WALL
-- ════════════════════════════════════════════════════════════════════════════
-- `app.guard_attendance()` (060) enforces three rules against the person
-- pressing the button. Two are wrong for a terminal:
--
--   "only today"       a scan legitimately arrives after midnight for the day
--                      that has just ended, or in a backlog after an outage.
--   `now()` overwrite  the whole point of this path is the terminal's clock.
--
-- ⚠️ SO THE FUNCTION GETS AN EXPLICIT, GREPPABLE ESCAPE — and it is not a hole.
-- `app.device_write` is transaction-local and is set by exactly one function,
-- `app.record_device_scan`, which verifies the terminal's secret before setting
-- it. Anybody else who set it would still meet row-level security, which refuses
-- an insert from a session with no user id. The flag suspends the SHAPE rules,
-- never the permission ones.
--
-- ⚠️ AND IT GAINS ONE NEW RULE: somebody the owner has put on `terminal_only`
-- cannot use the button. Enforced here rather than in the action, because a
-- rule the interface alone enforces is a rule anybody with the endpoint can skip.
create or replace function app.guard_attendance()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  v_mode public.attendance_mode;
begin
  -- ⚠️ FIRST. A scan has already been checked by `record_device_scan`, which is
  -- the only thing that can set this and which owns the rules for that path.
  if coalesce(current_setting('app.device_write', true), '') = 'on' then
    return new;
  end if;

  -- An Admin may write anything, and is recorded as having done so. Before every
  -- rule below, because those are about somebody acting on their own row.
  if app.acting_at_least('admin'::public.user_role) then
    if tg_op = 'UPDATE' and new.user_id <> app.current_user_id() then
      new.edited_by_id := app.current_user_id();
      new.edited_at := now();
    end if;
    return new;
  end if;

  if new.user_id <> app.current_user_id() then
    raise exception 'Only an Admin can record attendance for somebody else.'
      using errcode = 'check_violation';
  end if;

  -- ── The owner's policy ───────────────────────────────────────────────────
  select attendance_mode into v_mode from public.users where id = new.user_id;
  if v_mode = 'terminal_only' then
    raise exception 'You record attendance at the terminal, not here. Scan at the reader on your way in and out.'
      using errcode = 'check_violation';
  end if;

  if new.on_date <> app.attendance_today() then
    raise exception 'Attendance can only be recorded for today (%). Ask an Admin to correct another day.',
      app.attendance_today()
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.checked_out_at is not null then
      raise exception 'Check in before checking out.'
        using errcode = 'check_violation';
    end if;
    -- ⚠️ Not trusted from the client. A check-in time is the moment the button
    -- was pressed on the server, or the whole feature is self-reported.
    new.checked_in_at := now();
    new.edited_by_id := null;
    new.edited_at := null;
    return new;
  end if;

  -- UPDATE, by the person themselves: the one legal move is closing an open day.
  if old.checked_out_at is not null then
    raise exception 'You have already checked out today.'
      using errcode = 'check_violation';
  end if;
  if new.checked_in_at <> old.checked_in_at then
    raise exception 'Your check-in time cannot be changed. Ask an Admin.'
      using errcode = 'check_violation';
  end if;
  if new.checked_out_at is null then
    raise exception 'Nothing to change.'
      using errcode = 'check_violation';
  end if;
  new.checked_out_at := now();
  return new;
end $$;

comment on function app.guard_attendance() is
  'The three rules an interface must not be alone in enforcing (060), plus the '
  'owner''s terminal_only policy and an explicit bypass for the terminal path, '
  'which has its own rules and its own clock (078).';


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · THE ONE DOOR A TERMINAL WRITES THROUGH
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ THE SECRET IS VERIFIED IN HERE, not only in the route that calls it. The
-- route checks it too — a bad secret should be a 401 without a database round
-- trip — but a rule enforced only in application code is one refactor from being
-- enforced nowhere. This function is safe to grant to `cni_app` precisely
-- because holding the grant is not enough: you need the terminal's secret.
create or replace function app.record_device_scan(
  p_serial      text,
  p_secret      text,
  p_employee_no text,
  p_scanned_at  timestamptz,
  p_dedup_key   text,
  p_method      public.scan_method default 'other',
  p_raw         jsonb default null
)
returns table (outcome public.scan_outcome, on_date date, user_id uuid)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_device  public.attendance_devices%rowtype;
  v_user    uuid;
  v_day     date;
  v_today   date := app.attendance_today();
  v_row     public.attendance_days%rowtype;
  v_outcome public.scan_outcome;
begin
  -- ── Who is asking ────────────────────────────────────────────────────────
  select * into v_device
    from public.attendance_devices
   where upper(btrim(serial_no)) = upper(btrim(p_serial)) and is_active;

  if not found then
    raise exception 'No active terminal with that serial.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ⚠️ `extensions.digest`, SCHEMA-QUALIFIED. pgcrypto is installed in the
  -- `extensions` schema on Supabase, not `public`, so a bare `digest(...)` does
  -- not resolve. Qualifying it is also the safe fix: widening this function's
  -- search_path instead would be the classic SECURITY DEFINER escalation shape,
  -- where somebody who can create a function in an earlier schema gets to
  -- choose what `digest` means.
  if v_device.secret_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
    raise exception 'That terminal secret is wrong.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The terminal is talking to us, whatever this scan turns out to be. Recorded
  -- before anything can reject it, so the admin screen can tell "the wall is
  -- offline" from "the wall is fine and nobody is enrolled yet".
  update public.attendance_devices set last_seen_at = now() where id = v_device.id;

  -- ── Has this scan already been applied ───────────────────────────────────
  if exists (select 1 from public.attendance_scans
              where device_id = v_device.id and dedup_key = p_dedup_key) then
    return query select 'duplicate'::public.scan_outcome, null::date, null::uuid;
    return;
  end if;

  select id into v_user
    from public.users
   where device_person_no = btrim(p_employee_no) and is_active;

  v_day := (p_scanned_at at time zone 'Asia/Karachi')::date;

  -- ⚠️ THE CLOCK IS BOUNDED IN BOTH DIRECTIONS. A terminal drifted forward would
  -- open tomorrow's day and nothing would ever close it; one reset to its
  -- factory date would file today's arrivals against 2020. A day of future
  -- tolerance covers timezone confusion during setup; seven days of past covers
  -- a bridge catching up after a long outage.
  if v_user is null then
    v_outcome := 'unmatched';
    v_day := null;
  elsif v_day > v_today + 1 or v_day < v_today - 7 then
    v_outcome := 'out_of_range';
    v_day := null;
  else
    select * into v_row
      from public.attendance_days
     where attendance_days.user_id = v_user and attendance_days.on_date = v_day;

    -- ⚠️ AN ADMIN'S CORRECTION OUTRANKS THE WALL. Somebody who forgot to scan
    -- out and had their day fixed by hand must not have it undone by a late
    -- message. The scan is still recorded, marked `locked`, and stays visible.
    if found and v_row.edited_by_id is not null then
      v_outcome := 'locked';

    elsif not found then
      -- ⚠️ The flag, and only around the write. Transaction-local so it cannot
      -- leak into anything else this transaction does.
      perform set_config('app.device_write', 'on', true);
      insert into public.attendance_days
        (user_id, on_date, checked_in_at, check_in_source, check_in_method, device_id)
      values
        (v_user, v_day, p_scanned_at, 'device', p_method, v_device.id);
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    elsif v_row.checked_in_at is null or p_scanned_at < v_row.checked_in_at then
      -- An earlier scan arrived late. It is the real arrival, so it wins — which
      -- is what makes a bridge replaying a backlog produce the right answer
      -- whatever order the messages come back in.
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_in_at = p_scanned_at,
             check_in_source = 'device',
             check_in_method = p_method,
             device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'opened_day';

    elsif p_scanned_at > coalesce(v_row.checked_out_at, v_row.checked_in_at) then
      -- ⚠️ THE LAST SCAN OF THE DAY WINS, which is what makes lunch work with
      -- nobody pressing a function key: stepping out sets a leaving time, coming
      -- back moves it, and going home moves it for the last time.
      perform set_config('app.device_write', 'on', true);
      update public.attendance_days
         set checked_out_at = p_scanned_at,
             check_out_source = 'device',
             check_out_method = p_method,
             device_id = v_device.id
       where id = v_row.id;
      perform set_config('app.device_write', 'off', true);
      v_outcome := 'closed_day';

    else
      -- Between the two, or exactly on one of them. Nothing to change.
      v_outcome := 'ignored';
    end if;
  end if;

  -- ── The scan itself, always ──────────────────────────────────────────────
  insert into public.attendance_scans
    (device_id, employee_no, user_id, method, scanned_at, outcome, on_date, dedup_key, raw)
  values
    (v_device.id, btrim(p_employee_no), v_user, p_method, p_scanned_at,
     v_outcome, v_day, p_dedup_key, p_raw);

  update public.attendance_devices set last_event_at = now() where id = v_device.id;

  return query select v_outcome, v_day, v_user;
end $$;

comment on function app.record_device_scan is
  'The only way a terminal writes attendance. Verifies the terminal''s secret '
  'itself, keeps the device''s clock, derives arrival from the first scan and '
  'departure from the last, and records every scan whatever it did (078).';

revoke all on function app.record_device_scan(text, text, text, timestamptz, text, public.scan_method, jsonb) from public;
grant execute on function app.record_device_scan(text, text, text, timestamptz, text, public.scan_method, jsonb) to cni_app;

-- Hashing a secret when a terminal is registered, so the plaintext never has to
-- travel to the application and back.
create or replace function app.hash_device_secret(p_secret text)
returns text language sql immutable
set search_path = public, pg_temp
-- Schema-qualified for the same reason as above: pgcrypto is in `extensions`.
as $$ select encode(extensions.digest(p_secret, 'sha256'), 'hex') $$;

grant execute on function app.hash_device_secret(text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid; v_person uuid; v_dev uuid;
  v_day date := app.attendance_today();
  r record; v_in timestamptz; v_out timestamptz;
  v_src public.attendance_source; v_meth public.scan_method;
begin
  -- ⚠️ EVERY FIXTURE TIME BELOW IS BUILT `at time zone 'Asia/Karachi'`, and the
  -- first version of this test was not. `(a_date + time '19:30')::timestamptz` is
  -- interpreted in the SERVER's zone — UTC — so it meant 00:30 the NEXT Karachi
  -- day, the function correctly filed it against tomorrow, and the assertion
  -- failed against a function that was doing exactly the right thing. The same
  -- trap `app.attendance_today()` exists to avoid, met from the other side.
  select id into v_admin from public.users where role in ('super_admin','admin') limit 1;
  select id into v_person from public.users
   where role = 'member' and is_active and device_person_no is null limit 1;

  if v_admin is null or v_person is null then
    raise notice '078 · not enough users to self-check; structure is in place';
    return;
  end if;

  -- ⚠️ ACT AS THE ADMIN for the setup. The migration runs as the table owner
  -- with no `app.user_id`, so `acting_at_least('admin')` is false and the guard
  -- created above correctly refuses to enrol anybody. Setting the actor is the
  -- honest fix — it exercises the same path a real Admin takes — rather than
  -- disabling the guard to get the test past it.
  perform set_config('app.user_id', v_admin::text, true);

  insert into public.attendance_devices (serial_no, model, label, secret_hash, created_by_id)
  values ('078-SELFCHECK', 'DS-K1T320MFWX', 'Self check',
          app.hash_device_secret('correct-horse'), v_admin)
  returning id into v_dev;

  update public.users set device_person_no = '078-TEST' where id = v_person;

  -- ── A wrong secret is refused ───────────────────────────────────────────
  begin
    perform app.record_device_scan('078-SELFCHECK', 'wrong', '078-TEST', now(), 'k0');
    raise exception '078 · A WRONG SECRET WAS ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  -- ── An unknown employee number is kept, not dropped ─────────────────────
  select * into r from app.record_device_scan(
    '078-SELFCHECK', 'correct-horse', 'NOBODY', now(), 'k1', 'face') limit 1;
  if r.outcome <> 'unmatched' then
    raise exception '078 · an unknown number gave % rather than unmatched', r.outcome;
  end if;
  if not exists (select 1 from public.attendance_scans
                  where device_id = v_dev and employee_no = 'NOBODY') then
    raise exception '078 · AN UNMATCHED SCAN WAS DISCARDED';
  end if;

  -- ── First scan opens the day, at the TERMINAL's time, with its method ───
  select * into r from app.record_device_scan('078-SELFCHECK', 'correct-horse', '078-TEST',
    ((v_day::timestamp + time '09:58') at time zone 'Asia/Karachi'), 'k2', 'face') limit 1;
  if r.outcome <> 'opened_day' then
    raise exception '078 · the first scan gave % rather than opened_day', r.outcome;
  end if;

  select checked_in_at, check_in_source, check_in_method into v_in, v_src, v_meth
    from public.attendance_days where user_id = v_person and on_date = v_day;
  if v_src <> 'device' then raise exception '078 · arrival not marked as from the device'; end if;
  if v_meth <> 'face'  then raise exception '078 · the recognition method was lost'; end if;
  if v_in <> ((v_day::timestamp + time '09:58') at time zone 'Asia/Karachi') then
    raise exception '078 · THE TERMINAL CLOCK WAS OVERWRITTEN BY now(): got %', v_in;
  end if;

  -- ── The same scan again does nothing ────────────────────────────────────
  select * into r from app.record_device_scan('078-SELFCHECK', 'correct-horse', '078-TEST',
    ((v_day::timestamp + time '09:58') at time zone 'Asia/Karachi'), 'k2', 'face') limit 1;
  if r.outcome <> 'duplicate' then
    raise exception '078 · a resent scan gave % rather than duplicate', r.outcome;
  end if;

  -- ── Lunch: out, back, home. The LAST one is the leaving time ────────────
  perform app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          ((v_day::timestamp + time '13:00') at time zone 'Asia/Karachi'), 'k3', 'face');
  perform app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          ((v_day::timestamp + time '14:00') at time zone 'Asia/Karachi'), 'k4', 'face');
  select * into r from app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          ((v_day::timestamp + time '18:03') at time zone 'Asia/Karachi'), 'k5', 'fingerprint') limit 1;
  if r.outcome <> 'closed_day' then
    raise exception '078 · the last scan gave % rather than closed_day', r.outcome;
  end if;

  select checked_in_at, checked_out_at, check_out_method into v_in, v_out, v_meth
    from public.attendance_days where user_id = v_person and on_date = v_day;
  if v_in <> ((v_day::timestamp + time '09:58') at time zone 'Asia/Karachi') then
    raise exception '078 · LUNCH MOVED THE ARRIVAL TIME to %', v_in;
  end if;
  if v_out <> ((v_day::timestamp + time '18:03') at time zone 'Asia/Karachi') then
    raise exception '078 · the leaving time is % rather than the last scan', v_out;
  end if;
  if v_meth <> 'fingerprint' then
    raise exception '078 · the departure method was not kept separately';
  end if;

  -- ── A scan arriving out of order still yields the earliest arrival ──────
  perform app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          ((v_day::timestamp + time '09:31') at time zone 'Asia/Karachi'), 'k6', 'card');
  select checked_in_at into v_in
    from public.attendance_days where user_id = v_person and on_date = v_day;
  if v_in <> ((v_day::timestamp + time '09:31') at time zone 'Asia/Karachi') then
    raise exception '078 · a late-arriving EARLIER scan did not become the arrival: %', v_in;
  end if;

  -- ── A terminal with a broken clock is logged, not filed ─────────────────
  select * into r from app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          now() - interval '40 days', 'k7', 'face') limit 1;
  if r.outcome <> 'out_of_range' then
    raise exception '078 · a 40-day-old scan gave % rather than out_of_range', r.outcome;
  end if;

  -- ── terminal_only refuses the button, and only an Admin may set it ──────
  update public.users set attendance_mode = 'terminal_only' where id = v_person;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_person::text, true);
    begin
      update public.users set attendance_mode = 'either' where id = v_person;
      raise exception '078 · A MEMBER CHANGED THEIR OWN ATTENDANCE MODE';
    exception when check_violation then null;
    end;
    reset role;
    -- Hand the actor back, or every write below is refused by the same guard.
    perform set_config('app.user_id', v_admin::text, true);
  end;

  -- ── An Admin's correction outranks the wall ─────────────────────────────
  update public.attendance_days
     set edited_by_id = v_admin, edited_at = now(), edit_note = 'self-check'
   where user_id = v_person and on_date = v_day;

  select * into r from app.record_device_scan('078-SELFCHECK','correct-horse','078-TEST',
          ((v_day::timestamp + time '19:30') at time zone 'Asia/Karachi'), 'k8', 'face') limit 1;
  if r.outcome <> 'locked' then
    raise exception '078 · a scan overrode an Admin correction (%)', r.outcome;
  end if;

  -- ── The flag did not leak out of the function ───────────────────────────
  if coalesce(current_setting('app.device_write', true), 'off') = 'on' then
    raise exception '078 · app.device_write WAS LEFT ON — the guard is suspended';
  end if;

  delete from public.attendance_days where user_id = v_person and on_date = v_day;
  delete from public.attendance_devices where id = v_dev;
  update public.users set device_person_no = null, attendance_mode = 'either'
   where id = v_person;

  raise notice '078 · the wall can write: clock kept, method kept, resends ignored, lunch handled, Admin wins';
end $$;
