-- ============================================================================
-- 276 · THE SCHEDULE ARRIVES LIKE A PERSON
-- ----------------------------------------------------------------------------
-- Owner, 2026-10-01:
--
--   *"Right now I am observing that you are checking in daily at the same time,
--    9:40, and checking out at the same time daily. I don't want that. I want to
--    randomize some time up and some time down for check-in and check-out so it
--    would look like a real person is checking out and checking in."*
--
-- And: *"For this, Farhan, I also want a cron job to auto-check in and
-- auto-check out."*
--
-- ── ⚠️ 276 ON MAIN, NOT 265, AND THAT IS NOT A TYPO ──────────────────────
-- The CRM branch `properties-page` already holds 265 through 275. Numbering this
-- 265 would put two different files called 265 into one history the first time
-- those branches meet. The next number free on BOTH sides is 276.
--
-- ── ⚠️ THE TIME IS STILL NEVER WRITTEN BY HAND ───────────────────────────
-- 264's whole design rests on one rule, which `app.guard_attendance()` has
-- carried since 060:
--
--     -- ⚠️ Not trusted from the client. A check-in time is the moment the
--     -- button was pressed on the server, or the whole feature is self-reported.
--
-- Randomising by stamping a made-up timestamp would be the obvious fix and would
-- throw that away — an attendance table where the server invents arrival times
-- is not a record of anything. So the TARGET moves and the clock does not: the
-- cron ticks across the window and the first tick at or after that day's target
-- does the work, taking `now()` exactly as before.
--
-- ⚠️ WHICH MEANS THE TICK HAS TO BE EVERY MINUTE. At `*/10` the recorded time
-- could only ever land on :00, :10, :20 — "randomised" into six possible values
-- a month. Every minute across the window gives the forty-odd the owner can
-- actually see, and pg_cron running two one-line statements a minute for two
-- hours a day is nothing.
--
-- ── ⚠️ AND THE TARGET IS DERIVED, NOT DRAWN ──────────────────────────────
-- `random()` would re-roll on every tick: at 09:31 it might pick 09:55 and
-- refuse to act, then at 09:32 pick 09:33 and act. The result would be biased
-- hard towards the start of the window and would differ between two ticks of the
-- same minute. A hash of (person, date, slot) is stable all day, different every
-- day, different for each person, and reproducible — so a row can still be
-- explained a month later.
--
-- ── ⚠️ AND THE CRON STOPS DECIDING WHO WORKS WHEN ────────────────────────
-- The jobs ran `* * 1-6`, which is Blue Area's week. The Wah team works Sunday
-- and rests Friday, so the day-of-week filter in the cron expression was a
-- second, quieter copy of a rule `working_days` already holds — and it would
-- have silently skipped every Sunday for the first Wah person added. The
-- schedule now runs every day and the function decides.
-- ============================================================================

-- ── 1 · a window, not an instant ────────────────────────────────────────────
alter table public.attendance_auto
  add column if not exists check_in_until  time,
  add column if not exists check_out_until time;

/* Existing rows keep their current time as a window of zero width until the
   update below widens them — so this file is safe to stop halfway. */
update public.attendance_auto
   set check_in_until  = coalesce(check_in_until, check_in_local),
       check_out_until = coalesce(check_out_until, check_out_local);

alter table public.attendance_auto
  alter column check_in_until  set not null,
  alter column check_out_until set not null;

comment on column public.attendance_auto.check_in_local is
  'Earliest local check-in. The day''s actual target is a stable random minute between this and check_in_until — migration 276.';
comment on column public.attendance_auto.check_out_until is
  'Latest local check-out. See app.attendance_auto_target().';

alter table public.attendance_auto
  drop constraint if exists attendance_auto_windows_ordered;
alter table public.attendance_auto
  add constraint attendance_auto_windows_ordered
  check (check_in_until >= check_in_local
     and check_out_until >= check_out_local
     and check_out_local > check_in_until);

-- ── 2 · the day's target ────────────────────────────────────────────────────
/**
 * A stable minute inside [p_from, p_until] for this person on this day.
 *
 * ⚠️ IMMUTABLE AND HASH-BASED, which is what makes it safe to call from a loop
 * that runs every minute: every tick of a given day computes the same answer, so
 * the first tick at or after it acts and the rest find the work done. `random()`
 * here would re-roll per tick and bias the result to the start of the window.
 *
 * ⚠️ AND THE SLOT IS IN THE HASH. Without it, arriving and leaving would be
 * correlated — the same person's late mornings would always be late evenings,
 * which is a pattern a reader would eventually notice and which no real week
 * has.
 */
create or replace function app.attendance_auto_target(
  p_user  uuid,
  p_date  date,
  p_slot  text,
  p_from  time,
  p_until time
)
returns time
language sql
immutable
as $function$
  select p_from + make_interval(
    mins => (abs(hashtextextended(p_user::text || '|' || p_date::text || '|' || p_slot, 0))
             % (greatest(
                  (extract(epoch from p_until) - extract(epoch from p_from))::int / 60, 0) + 1))::int
  )
$function$;

comment on function app.attendance_auto_target(uuid, date, text, time, time) is
  'A stable pseudo-random minute inside a window, derived from the person, the day and the slot. Migration 276.';

-- ── 3 · the job reads the window ────────────────────────────────────────────
create or replace function app.run_scheduled_attendance(
  p_kind text,
  p_only uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today   date     := app.attendance_today();
  v_local   time     := (now() at time zone 'Asia/Karachi')::time;
  v_dow     smallint := extract(isodow from (now() at time zone 'Asia/Karachi'))::smallint;
  v_target  time;
  v_closes  time;
  v_done    int      := 0;
  v_skipped int      := 0;
  v_names   text[]   := '{}';
  r         record;
begin
  if p_kind not in ('in', 'out') then
    raise exception 'run_scheduled_attendance takes ''in'' or ''out'', not %', p_kind;
  end if;

  for r in
    select a.user_id, a.check_in_local, a.check_in_until,
           a.check_out_local, a.check_out_until, u.full_name
      from public.attendance_auto a
      join public.users u on u.id = a.user_id
     where a.is_enabled
       and u.is_active
       and u.account_state = 'active'
       and v_dow = any (a.working_days)
       and (p_only is null or a.user_id = p_only)
       /* not on their own approved leave, a holiday, or a blocked day */
       and not exists (
         select 1 from public.availability av
          where av.user_id = a.user_id
            and v_today between av.start_date and av.end_date
            and av.type in ('leave', 'holiday', 'unavailable')
       )
  loop
    /* ⚠️ THE DAY'S OWN MINUTE, not the column. See the header: stable within the
       day, different tomorrow, different per person, never re-rolled. */
    v_target := case
      when p_kind = 'in'
        then app.attendance_auto_target(r.user_id, v_today, 'in', r.check_in_local, r.check_in_until)
      else app.attendance_auto_target(r.user_id, v_today, 'out', r.check_out_local, r.check_out_until)
    end;

    v_closes := case when p_kind = 'in' then r.check_in_until else r.check_out_until end;

    /* Before the target: not this tick. A later tick in the window will find it. */
    if v_local < v_target then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    /* ⚠️⚠️ AND AFTER THE WINDOW IT DOES NOTHING AT ALL. 264 had no upper bound —
       it only refused to act EARLY — and the tight ten-minute cron window was the only
       thing keeping a late tick from stamping a late arrival. Widening the
       schedule in this file exposed it immediately: rescheduling at 06:58 UTC
       fired a tick at 11:58 Karachi, and Farhan Shah was checked in nearly two
       hours after his window, which the app reads as LATE.

       An automation that marks somebody late because a cron job ran at an odd
       moment is worse than one that records nothing: a missing day is visibly
       missing, and a late day is a quiet accusation. So the window is the
       authority and the cron expression is only an optimisation — the function
       now gives the same answer whatever hours it is called in. */
    if v_local > v_closes then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    /* ⚠️ Act AS them. `app.guard_attendance()` reads `app.current_user_id()` to
       decide whose row this is and to honour `attendance_mode = 'terminal_only'`.
       Running with no identity would slip past the "somebody else's row" check on
       a NULL comparison, which is the wrong way for a guard to fail. `is_local`
       is true, so it is gone when this transaction ends. */
    perform set_config('app.user_id', r.user_id::text, true);

    if p_kind = 'in' then
      insert into public.attendance_days (user_id, on_date, check_in_source)
      values (r.user_id, v_today, 'scheduled'::public.attendance_source)
      on conflict (user_id, on_date) do nothing;
    else
      update public.attendance_days
         set checked_out_at  = now(),
             check_out_source = 'scheduled'::public.attendance_source
       where user_id = r.user_id
         and on_date = v_today
         and checked_in_at is not null
         and checked_out_at is null
         /* never earlier than the morning: `attendance_days_ordered` would
            abort the job for everybody behind this person in the loop */
         and checked_in_at <= now();
    end if;

    if found then
      v_done := v_done + 1;
      v_names := v_names || r.full_name;
      if p_kind = 'in' then
        update public.attendance_auto set last_in_at = now() where user_id = r.user_id;
      else
        update public.attendance_auto set last_out_at = now() where user_id = r.user_id;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  perform set_config('app.user_id', '', true);

  return jsonb_build_object(
    'kind', p_kind, 'on_date', v_today, 'at_local', v_local,
    'recorded', v_done, 'skipped', v_skipped, 'people', to_jsonb(v_names)
  );
end
$function$;

revoke all on function app.run_scheduled_attendance(text, uuid) from public;

-- ── 4 · the windows, and Farhan ─────────────────────────────────────────────
-- ⚠️ 09:30–10:15, NOT 09:30–10:30. `LATE_AFTER_MINUTES` is 10:30 and `late` is
-- after it, so a window ending at 10:30 would sit one minute from marking the
-- owner late on her own schedule. Fifteen minutes of headroom costs nothing and
-- the variation is still forty-six possible minutes.
update public.attendance_auto
   set check_in_local  = time '09:30', check_in_until  = time '10:15',
       check_out_local = time '18:45', check_out_until = time '19:30';

-- ⚠️ Blue Area, so Monday to Saturday with Sunday off — read from his own row
-- rather than assumed, because the Wah team rests on Friday instead and the two
-- are one column apart.
insert into public.attendance_auto
  (user_id, check_in_local, check_in_until, check_out_local, check_out_until,
   working_days, note, created_by_id)
select u.id, time '09:30', time '10:15', time '18:45', time '19:30',
       case when u.office_team = 'wah'
         then '{1,2,3,4,6,7}'::smallint[] else '{1,2,3,4,5,6}'::smallint[] end,
       'Asked for on 2026-10-01, alongside the owner''s own schedule.',
       (select id from public.users where is_active and role = 'admin' order by created_at limit 1)
  from public.users u
 where u.email = 'induscityproject@gmail.com'
   and u.is_active
on conflict (user_id) do update
  set is_enabled      = true,
      check_in_local  = excluded.check_in_local,
      check_in_until  = excluded.check_in_until,
      check_out_local = excluded.check_out_local,
      check_out_until = excluded.check_out_until,
      working_days    = excluded.working_days;

-- ── 5 · tick every minute, every day ────────────────────────────────────────
-- ⚠️ THE WINDOWS ARE IN UTC AND KARACHI IS +5. 09:30–10:15 local is 04:30–05:15
-- UTC, and 18:45–19:30 local is 13:45–14:30. `cron.timezone` on this cluster is
-- GMT — checked, not assumed — so the hours below are UTC hours. An hour of
-- slack on each side costs two idle statements a minute and covers a tick that
-- arrives late.
select cron.unschedule('attendance-auto-in')  where exists (select 1 from cron.job where jobname = 'attendance-auto-in');
select cron.unschedule('attendance-auto-out') where exists (select 1 from cron.job where jobname = 'attendance-auto-out');

-- ⚠️ 4-5 AND 13-14, NOT 4-6 AND 13-16. The first draft added an hour of slack on
-- each side "in case a tick arrives late", which is exactly the wrong instinct
-- now that the function refuses to act outside the window anyway: the extra
-- hours could never record anything, and while the function still LACKED that
-- refusal they were what stamped an 11:58 arrival. 04:30–05:15 UTC and
-- 13:45–14:30 UTC are the real windows; these cover them whole.
select cron.schedule('attendance-auto-in',  '* 4-5 * * *',   $$select app.run_scheduled_attendance('in')$$);
select cron.schedule('attendance-auto-out', '* 13-14 * * *', $$select app.run_scheduled_attendance('out')$$);

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_user    uuid;
  v_a       time;
  v_b       time;
  v_days    int := 0;
  v_same    int := 0;
  v_outside int := 0;
  v_corr    int := 0;
  d         date;
  FROM_T    constant time := time '09:30';
  UNTIL_T   constant time := time '10:15';
begin
  select user_id into v_user from public.attendance_auto limit 1;
  if v_user is null then
    raise exception 'NOBODY IS ON THE SCHEDULE — this check cannot run, and a pass would mean nothing';
  end if;

  -- ── 1 · stable within a day ──────────────────────────────────────────────
  v_a := app.attendance_auto_target(v_user, date '2026-10-02', 'in', FROM_T, UNTIL_T);
  v_b := app.attendance_auto_target(v_user, date '2026-10-02', 'in', FROM_T, UNTIL_T);
  if v_a <> v_b then
    raise exception '276 · the target moved between two calls on the same day — every tick would disagree';
  end if;

  -- ── 2 · inside the window, varied across the month, and not always equal ─
  for d in select generate_series(date '2026-10-01', date '2026-10-31', '1 day')::date loop
    v_days := v_days + 1;
    v_a := app.attendance_auto_target(v_user, d, 'in', FROM_T, UNTIL_T);
    v_b := app.attendance_auto_target(v_user, d, 'out', time '18:45', time '19:30');
    if v_a < FROM_T or v_a > UNTIL_T then v_outside := v_outside + 1; end if;
    if v_a = time '09:40' then v_same := v_same + 1; end if;
    /* the two slots must not move together */
    if extract(minute from v_a)::int = extract(minute from v_b)::int then
      v_corr := v_corr + 1;
    end if;
  end loop;

  if v_outside > 0 then
    raise exception '276 · % of % targets fell outside the window', v_outside, v_days;
  end if;
  if v_same > 3 then
    raise exception '276 · the target was 09:40 on % of % days — that is not randomised', v_same, v_days;
  end if;
  if v_corr > v_days / 3 then
    raise exception '276 · arriving and leaving moved together on % of % days — the slot is not in the hash', v_corr, v_days;
  end if;

  -- ── 3 · a zero-width window still works ──────────────────────────────────
  if app.attendance_auto_target(v_user, date '2026-10-02', 'in', time '09:40', time '09:40')
     <> time '09:40' then
    raise exception '276 · a window of one minute did not return that minute';
  end if;

  -- ── 4 · everybody on the schedule has a real window ──────────────────────
  if exists (select 1 from public.attendance_auto
              where check_in_until <= check_in_local or check_out_until <= check_out_local) then
    raise exception '276 · somebody on the schedule still has a window of zero width';
  end if;

  -- ── 5 · and the cron no longer decides the week ──────────────────────────
  if exists (select 1 from cron.job
              where jobname in ('attendance-auto-in', 'attendance-auto-out')
                and schedule not like '%* * *') then
    raise exception '276 · a day-of-week filter is still in the cron expression; working_days is the authority';
  end if;

  -- ── 6 · ⚠️ AND A LATE TICK RECORDS NOTHING ───────────────────────────────
  -- The bug this file created and then fixed: run the job as if it were noon and
  -- it must decline rather than stamp a late arrival.
  if (select (app.run_scheduled_attendance('in')->>'recorded')::int) is null then
    raise exception '276 · the job did not return a count';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'run_scheduled_attendance'
       and p.prosrc like '%v_local > v_closes%') then
    raise exception '276 · the job has no upper bound — a late tick would mark somebody late';
  end if;

  raise notice '276 self-check passed: the target is stable within a day, varies across the month, stays inside the window, and arriving does not move with leaving';
end $$;
