-- ============================================================================
-- 252 · TASK VISIBILITY IS ANSWERED ONCE, NOT ONCE PER ROW
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-22: *"that page is very heavy … taking a lot of time to render.
-- I don't know why these things are happening like that … I want this type of
-- fast page."*
--
-- ── ⚠️ WHAT THE MEASUREMENT ACTUALLY SAID, HAVING BEEN WRONG FIRST ─────────
-- The plan for this work assumed the payload: "the page ships 1,141 tasks and
-- throws 793 away." **That was a mis-measurement** — it counted a window the
-- page does not use. The real default board reads **62 rows**, and its 403 kB of
-- HTML is **brotli-compressed to about 30 kB on the wire**. The payload was
-- never the problem.
--
-- Measured properly, on production, 2026-09-23:
--   · /tasks 3.4 s · /my-work 3.5 s · /profile 3.1 s — a floor on EVERY page.
--   · The board's own queries: listTasks 267 ms, taskTotals **637 ms**.
--   · And the plan, which names the cause:
--
--       Index Scan using tasks_status_idx on tasks t
--         Filter: app.task_is_visible(id)
--       Execution Time: 181 ms      (for 500 rows)
--
-- `app.task_is_visible(id)` takes THE ROW'S OWN COLUMN, so Postgres cannot hoist
-- it: it is called once per row, and each call runs a sub-select on `tasks` plus
-- three more function calls. This is Law 5 in CLAUDE.md, the exact shape that
-- cost 1,214 ms on the leads table and is now 2.2 ms there.
--
-- ── THE FIX: COMPUTE THE SET ONCE, TEST MEMBERSHIP PER ROW ────────────────
-- `(select app.fn())` is planned as an **InitPlan** — evaluated before the scan
-- and reused as a constant. So the session-wide parts (who am I, what rank, whom
-- do I outrank, what do I watch) are answered once, and what remains per row is
-- a column comparison and an array membership test.
--
-- ⚠️ `app.task_is_visible` ITSELF IS UNCHANGED AND STILL USED. The satellite
-- tables (`task_skills`, `task_watchers`, `task_dependencies`, …) pass a
-- DIFFERENT table's column to it, where the row's own columns are not available.
-- Only `tasks_select` changes, which is where the per-row cost was.
--
-- ⚠️ AND NOT ONE ROW MAY MOVE. The self-check compares the old predicate with
-- the new one **for every active user, row by row**, and refuses to commit on a
-- single difference — the rule CLAUDE.md sets for any policy change, and the
-- pattern migrations 164 and 165 established.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE TWO SETS, COMPUTED ONCE PER STATEMENT
-- ----------------------------------------------------------------------------

-- ⚠️ STABLE, NEVER IMMUTABLE. These read `app.user_id` from the session, so
-- marking them immutable would let Postgres cache one person's answer and hand
-- it to another — the one change in this area that leaks a colleague's work.
create or replace function app.users_the_caller_outranks()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    /* A Member outranks nobody, so the coordinator arm is empty for them —
       exactly what `acting_at_least('team_coordinator') and …` said. */
    when not app.acting_at_least('team_coordinator'::public.user_role) then '{}'::uuid[]
    else coalesce(
      (
        select array_agg(u.id)
          from public.users u
         /* ⚠️ NOT filtered by `is_active`. `acting_outranks` does not filter it
            either, and a deactivated colleague's tasks must not change hands
            just because their account was switched off. */
         where app.role_rank(app.current_user_role()) > app.role_rank(u.role)
      ),
      '{}'::uuid[]
    )
  end
$fn$;

create or replace function app.tasks_the_caller_watches()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select array_agg(w.task_id)
        from public.task_watchers w
       where w.user_id = app.current_user_id()
    ),
    '{}'::uuid[]
  )
$fn$;

grant execute on function app.users_the_caller_outranks() to cni_app;
grant execute on function app.tasks_the_caller_watches() to cni_app;

-- ----------------------------------------------------------------------------
-- 2 · THE POLICY, SAYING THE SAME THING WITHOUT ASKING PER ROW
-- ----------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (select app.current_user_id()) is not null
    and (
      /* Admin and above see everything — one InitPlan, then the scan stops
         asking. */
      (select app.acting_at_least('admin'::public.user_role))
      or assignee_id = (select app.current_user_id())
      or created_by_id = (select app.current_user_id())
      /* The coordinator arm: whose work this is, against the set of people the
         caller outranks — computed once, tested per row. */
      /* ⚠️ `= any ((select f()))` DOES NOT WORK: the parser reads a parenthesised
         SELECT as ANY(subquery) and then compares uuid with uuid[]. Wrapping it
         in coalesce() makes the outermost expression an array, which is what ANY
         wants — and the scalar subquery inside is still an InitPlan. */
      or coalesce(assignee_id, created_by_id) = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
      /* Watching is an explicit grant and survives the narrowing. */
      or id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
    )
  );

-- ============================================================================
-- SELF-CHECK — ⚠️ EVERY ACTIVE USER, ROW BY ROW, OLD AGAINST NEW
-- ============================================================================
do $chk$
declare
  u record;
  n_old integer;
  n_new integer;
  n_diff integer;
  n_people integer := 0;
  n_rows integer := 0;
  v_ms numeric;
  t0 timestamptz;
begin
  for u in
    select id, full_name, role::text as role from public.users where is_active order by role, full_name
  loop
    perform set_config('app.user_id', u.id::text, true);

    /* The OLD predicate, evaluated by hand over every task. */
    select count(*) into n_old
      from public.tasks t
     where not t.is_deleted and app.task_is_visible(t.id);

    /* The NEW predicate, written out exactly as the policy states it. */
    select count(*) into n_new
      from public.tasks t
     where not t.is_deleted
       and (select app.current_user_id()) is not null
       and (
         (select app.acting_at_least('admin'::public.user_role))
         or t.assignee_id = (select app.current_user_id())
         or t.created_by_id = (select app.current_user_id())
         or coalesce(t.assignee_id, t.created_by_id) = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
         or t.id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
       );

    /* ⚠️ COUNTS AGREEING IS NOT THE SAME AS THE SAME ROWS. Two predicates can
       admit the same NUMBER of tasks and a different set of them, which would
       be the worst possible outcome: a silent swap of whose work each person
       sees. So the rows themselves are compared. */
    select count(*) into n_diff
      from (
        select t.id from public.tasks t where not t.is_deleted and app.task_is_visible(t.id)
        except
        select t.id from public.tasks t
         where not t.is_deleted
           and (select app.current_user_id()) is not null
           and (
             (select app.acting_at_least('admin'::public.user_role))
             or t.assignee_id = (select app.current_user_id())
             or t.created_by_id = (select app.current_user_id())
             or coalesce(t.assignee_id, t.created_by_id) = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
             or t.id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
           )
        union all
        select t.id from public.tasks t
         where not t.is_deleted
           and (select app.current_user_id()) is not null
           and (
             (select app.acting_at_least('admin'::public.user_role))
             or t.assignee_id = (select app.current_user_id())
             or t.created_by_id = (select app.current_user_id())
             or coalesce(t.assignee_id, t.created_by_id) = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
             or t.id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
           )
        except
        select t.id from public.tasks t where not t.is_deleted and app.task_is_visible(t.id)
      ) d;

    if n_old <> n_new or n_diff <> 0 then
      raise exception '252 · % (%) sees % tasks under the old rule and % under the new, % row(s) differ',
        u.full_name, u.role, n_old, n_new, n_diff using errcode = 'TS252';
    end if;

    n_people := n_people + 1;
    n_rows := n_rows + n_old;
  end loop;

  raise notice '252 · ✓ % active people, % visible rows in total, not one row moved', n_people, n_rows;

  /* And it is actually faster — the point of the whole exercise. */
  perform set_config('app.user_id',
    (select id::text from public.users where is_active and role = 'member' order by full_name limit 1), true);
  t0 := clock_timestamp();
  perform count(*) from public.tasks t where not t.is_deleted and app.task_is_visible(t.id);
  v_ms := extract(milliseconds from clock_timestamp() - t0);
  raise notice '252 ·   old predicate over every task: % ms', round(v_ms, 1);

  t0 := clock_timestamp();
  perform count(*) from public.tasks t
   where not t.is_deleted
     and (
       (select app.acting_at_least('admin'::public.user_role))
       or t.assignee_id = (select app.current_user_id())
       or t.created_by_id = (select app.current_user_id())
       or coalesce(t.assignee_id, t.created_by_id) = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
       or t.id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
     );
  v_ms := extract(milliseconds from clock_timestamp() - t0);
  raise notice '252 ·   new predicate over every task: % ms', round(v_ms, 1);
end $chk$;
