-- ============================================================================
-- 251 · EDITING ONE COPY IS NOT EDITING THE SERIES
-- ----------------------------------------------------------------------------
-- 250 gave a repeating task a definition of its own. This is the other half of
-- the flaw it was written for:
--
--   The next copy used to be made from the LATEST COPY, so renaming one day's
--   task renamed every future one. Measured on the live table: a series raised
--   as "making daily report of all pages" now generates as "making daily report
--   of all pages, Weekly report done", because somebody edited one day's copy
--   to record what they had finished.
--
-- With 250 the runner reads the definition instead, so that has already stopped.
-- What is left is the control: when somebody changes the REPEAT on a copy, they
-- mean the series — and nothing else they typed on that copy does.
--
-- So: one function that changes the rule and only the rule.
-- ============================================================================

set local lock_timeout = '5s';

-- ── The repeat itself, changed from any copy ─────────────────────────────────
create or replace function app.set_task_series_rule(p_series uuid, p_rule text)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_rule text := nullif(btrim(coalesce(p_rule, '')), '');
begin
  if app.current_user_id() is null then
    raise exception 'No acting user.' using errcode = 'TS251';
  end if;
  if v_rule is null then
    raise exception 'A repeating task needs a rule. To end it, stop it.' using errcode = 'TS251';
  end if;
  if not app.can_manage_task_series(p_series) then
    raise exception 'You cannot change that repeating task.' using errcode = 'TS251';
  end if;

  update public.task_series
     set recurrence_rule = v_rule,
         updated_at = now()
   where id = p_series;

  if not found then
    raise exception 'That repeating task no longer exists.' using errcode = 'TS251';
  end if;
end;
$fn$;

-- ── What a task's series is, for the screen in front of somebody ─────────────
-- ⚠️ Returns a row for a STOPPED series too, so the task can say "this used to
-- repeat" rather than pretending it never did.
create or replace function app.task_series_of_task(p_task uuid)
returns table (
  id uuid, recurrence_rule text, title text, assignee_id uuid, assignee_name text,
  created_by_id uuid, created_by_name text, one_open_copy boolean,
  status_on_create text, stopped_at timestamptz, stopped_by_name text,
  open_copies integer, untouched_copies integer, can_manage boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select s.id, s.recurrence_rule, s.title, s.assignee_id, a.full_name,
         s.created_by_id, c.full_name, s.one_open_copy,
         s.status_on_create::text, s.stopped_at, b.full_name,
         (select count(*) from public.tasks t
           where t.recurrence_series_id = s.id and not t.is_deleted
             and t.status not in ('done', 'cancelled'))::int,
         (select count(*) from public.tasks t
           where t.recurrence_series_id = s.id and not t.is_deleted
             and t.status = s.status_on_create and t.completed_at is null
             and not exists (select 1 from public.comments m where m.task_id = t.id)
             and not exists (select 1 from public.time_entries e where e.task_id = t.id))::int,
         app.can_manage_task_series(s.id)
    from public.tasks t
    join public.task_series s on s.id = t.recurrence_series_id
    left join public.users a on a.id = s.assignee_id
    join public.users c on c.id = s.created_by_id
    left join public.users b on b.id = s.stopped_by_id
   where t.id = p_task
     and app.task_is_visible(t.id)
$fn$;

grant execute on function app.set_task_series_rule(uuid, text) to cni_app;
grant execute on function app.task_series_of_task(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_series uuid;
  v_task uuid;
  v_member uuid;
  v_stranger uuid;
  v_rule text;
  n integer;
  v_after text;
begin
  /* ── ⚠️ EVERY FIXTURE IS READ BEFORE THE ROLE CHANGES ────────────────────
     `task_series` has RLS on and no policies (see 250's note), so `cni_app`
     cannot read it directly at all — a lookup left inside the cni_app section
     fails with "permission denied for table task_series", which is what the
     first draft of this check did. Read as the owner, act as the member. */
  select s.id, s.created_by_id, s.recurrence_rule into v_series, v_member, v_rule
    from public.task_series s
   where s.stopped_at is null
     and exists (select 1 from public.tasks t where t.recurrence_series_id = s.id and not t.is_deleted)
   limit 1;
  if v_series is null then
    raise exception '251 · no live series with a copy to check against' using errcode = 'TS251';
  end if;

  select t.id into v_task from public.tasks t
   where t.recurrence_series_id = v_series and not t.is_deleted limit 1;

  select u.id into v_stranger
    from public.users u
   where u.is_active and u.role = 'member' and u.id <> v_member
     and not exists (
       select 1 from public.task_series s2
        where s2.id = v_series and (s2.created_by_id = u.id or s2.assignee_id = u.id))
   limit 1;
  if v_stranger is null then
    raise exception '251 · nobody unrelated to the series to test the refusal with' using errcode = 'TS251';
  end if;

  -- 1 · the owner of the series can read it from one of its copies
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from app.task_series_of_task(v_task);

  -- 2 · and change the repeat from there
  perform app.set_task_series_rule(v_series, 'FREQ=WEEKLY;INTERVAL=1');
  reset role;

  if n <> 1 then
    raise exception '251 · a series is not readable from its own copy' using errcode = 'TS251';
  end if;
  select recurrence_rule into v_after from public.task_series where id = v_series;
  if v_after <> 'FREQ=WEEKLY;INTERVAL=1' then
    raise exception '251 · the rule did not change' using errcode = 'TS251';
  end if;

  -- 3 · ⚠️ AND SOMEBODY UNRELATED IS REFUSED. The refusal is proved by reading
  --     the rule back afterwards, not by trusting that an exception was raised —
  --     a handler that catches its own complaint proves nothing.
  set local role cni_app;
  perform set_config('app.user_id', v_stranger::text, true);
  begin
    perform app.set_task_series_rule(v_series, 'FREQ=DAILY;INTERVAL=7');
  exception when others then
    null;
  end;
  reset role;

  select recurrence_rule into v_after from public.task_series where id = v_series;
  if v_after <> 'FREQ=WEEKLY;INTERVAL=1' then
    raise exception '251 · somebody unrelated to the series changed its rule' using errcode = 'TS251';
  end if;

  -- Put the series back exactly as it was. This is a check, not a change to
  -- somebody's week.
  update public.task_series set recurrence_rule = v_rule, updated_at = updated_at where id = v_series;
  select recurrence_rule into v_after from public.task_series where id = v_series;
  if v_after <> v_rule then
    raise exception '251 · the self-check did not restore the rule it changed' using errcode = 'TS251';
  end if;

  raise notice '251 · ✓ the repeat is changeable from any copy by its owner, refused for anybody else, and restored';
end $chk$;
