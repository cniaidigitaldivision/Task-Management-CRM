-- ============================================================================
-- 101 · THE DUE-RULES READER CARRIES THE RULE'S OWN TIME — owner, 2026-09-05
-- ----------------------------------------------------------------------------
-- ⚠️ THE BUG THIS COMPLETES THE FIX FOR: A RULE'S TIME WAS DECORATION.
-- `nextRunAfter` took only a frequency and returned `now + interval`, so a rule
-- saved as "daily at 02:00" ran at whatever o'clock it was created and then
-- every 24 hours from there — while the schedules table and the sync calendar
-- both printed 02:00. Found on a live rule: saved with `run_at 21:55`, its next
-- run had been computed for 23:55 Karachi.
--
-- The domain function now anchors on `run_at`, which means every caller has to
-- be able to supply it. The server action reads the whole rule and already
-- could; the CRON reads through `app.meta_sync_rules_due`, which returned
-- neither the time nor the weekday. Without this migration the runner would
-- keep re-computing the old, unanchored answer on every run and quietly undo the
-- fix — the rule would drift back to the creation-time grid the moment it first
-- executed.
--
-- ⚠️ `drop` FIRST. A function's return type cannot be widened by `create or
-- replace`; this is the same reason 100 had to drop before recreating.
-- ============================================================================

drop function if exists app.meta_sync_rules_due(timestamptz);

create function app.meta_sync_rules_due(p_now timestamptz)
returns table (
  rule_id        uuid,
  project_id     uuid,
  project_name   text,
  name           text,
  platforms      text[],
  categories     text[],
  frequency      text,
  -- ⚠️ The two new columns, and the whole point of this migration.
  run_at         time,
  run_on_weekday integer,
  max_retries    integer
)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select r.id, r.project_id, p.name, r.name, r.platforms, r.categories,
         r.frequency, r.run_at, r.run_on_weekday, r.max_retries
    from public.meta_sync_rules r
    join public.projects p on p.id = r.project_id
    -- ⚠️ THE PROJECT'S OFF SWITCH WINS OVER ITS RULES. Turning auto-sync off must
    -- stop everything, not merely stop the default pull while named rules carry
    -- on collecting — which is exactly what somebody switching it off is trying
    -- to prevent. Carried over from 099 unchanged.
    left join public.meta_sync_settings s on s.project_id = r.project_id
   where r.is_active
     and r.next_run_at <= p_now
     and coalesce(s.auto_sync_enabled, true)
   order by r.next_run_at
$$;

comment on function app.meta_sync_rules_due(timestamptz) is
  'Sync rules due to run, with the time each is anchored to (101). SECURITY '
  'DEFINER because a cron has no session and RLS would silently return nothing.';

grant execute on function app.meta_sync_rules_due(timestamptz) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` WITH NO SESSION, exactly as the cron does — a migration
-- executes as the schema owner and bypasses RLS, which is how 094's self-check
-- passed while proving nothing. It creates its own project and removes it.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_rule    uuid;
  v_before  bigint;
  v_after   bigint;
  v_time    time;
  v_dow     integer;
  n         integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;
  if v_admin is null then
    raise notice '101 · no admin row; the function is in place, self-check skipped';
    return;
  end if;

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('101 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_sync_rules
    (project_id, name, frequency, run_at, run_on_weekday, next_run_at, created_by_id)
  values (v_project, '101 weekly', 'weekly', '02:00'::time, 3,
          now() - interval '1 minute', v_admin)
  returning id into v_rule;

  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 1 · The reader still finds a due rule without a session. Restated from 099
  --     because dropping and recreating the function is exactly when that
  --     property would be lost without anybody noticing.
  select count(*) into n from app.meta_sync_rules_due(now()) where rule_id = v_rule;
  if n <> 1 then
    raise exception '101 · the reader returned % rows for a due rule with no session; expected 1', n;
  end if;

  -- 2 · ⚠️ THE TIME AND WEEKDAY COME BACK. Without them the runner recomputes the
  --     unanchored answer and silently undoes the fix this migration exists for.
  select run_at, run_on_weekday into v_time, v_dow
    from app.meta_sync_rules_due(now()) where rule_id = v_rule;

  if v_time is null then
    raise exception '101 · the reader returned no run_at — the anchor would be lost on every cron run';
  end if;
  if v_time <> '02:00'::time then
    raise exception '101 · the reader returned run_at %, expected 02:00', v_time;
  end if;
  if v_dow <> 3 then
    raise exception '101 · the reader returned weekday %, expected 3', v_dow;
  end if;

  reset role;

  delete from public.projects where id = v_project;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '101 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '101 · due rules carry their own time and weekday';
end $$;
