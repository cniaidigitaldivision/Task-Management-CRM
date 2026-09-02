-- ============================================================================
-- 084 · SIGHT FOLLOWS RANK
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03, setting out the flow they want end to end:
--
--   *"admin can view everyone task included himself or herself also… In same
--   way, team coordinator can view his or her task plus task plus team member
--   task, but can't view the admin task. In same way, the team members can only
--   view his or her task only, or those tasks which is assigned to them."*
--
--   Member       own + assigned to them (+ watched)
--   Coordinator  own + the work of anybody they outrank — NOT an Admin's
--   Admin+       everything
--
-- ── ⚠️ THIS REVERSES MIGRATION 083, ONE DAY OLD, AND THAT IS CORRECT ────────
-- 083 granted a Member sight of every task in a project they belong to. It was
-- the right answer to the problem in front of us yesterday: 306 content tasks
-- had been bulk-created with NO ASSIGNEE, so the people meant to do them could
-- not see them, and Kashif was doing every paste himself.
--
-- The cause is being removed rather than worked around. Nothing pre-creates a
-- month of unowned posts any more (see the plan: the schedule generator is
-- retired and a tracker takes its place); people create their own work, so it
-- has an owner from the first moment. With no unowned tasks, the widening has
-- nothing left to fix — and it was the loosest part of the model, since it let
-- a Member read a colleague's task for no reason they had asked for.
--
-- 083's `app.claim_task` STAYS. Still needed: whoever pastes the live link on a
-- post somebody else raised takes it, and `tasks_update` would refuse them.
--
-- ── ⚠️ WHAT IS NEW HERE, NOT A REVERT ──────────────────────────────────────
-- A Coordinator loses sight of Admin and Super Admin tasks. Until now
-- `acting_at_least('team_coordinator')` returned TRUE for every row, so Kashif
-- could read the owner's own to-do list. Nobody asked for that; it fell out of
-- one rank check standing in for the whole rule.
--
-- ── WHOSE TASK IS IT, FOR THE RANK COMPARISON ───────────────────────────────
-- `coalesce(assignee_id, created_by_id)` — the person doing it if there is one,
-- otherwise the person who raised it. So an Admin's task delegated to a Member
-- IS visible to a Coordinator (it is that Member's work now), and an Admin's
-- own undelegated task is not.
--
-- ── ⚠️ WRITES ARE DELIBERATELY UNTOUCHED ───────────────────────────────────
-- `app.sees_all_work()` is still Coordinator-and-above and still governs
-- `tasks_update`. A Coordinator therefore retains WRITE permission on a row
-- they can no longer SELECT, which sounds worse than it is: every code path
-- fetches before it writes, so the read is the gate in practice. Narrowing
-- `sees_all_work` would reach into project, finance and workload visibility in
-- the same stroke, and that is a separate decision from this one.
-- ============================================================================

create or replace function app.task_is_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when app.current_user_id() is null then false

    -- ⚠️ 'admin', not 'team_coordinator'. That single word is the change: the
    -- blanket "Coordinator sees all" is gone, and a Coordinator now earns each
    -- row through the rank comparison below.
    when app.acting_at_least('admin'::public.user_role) then true

    else exists (
      select 1 from public.tasks t
       where t.id = p_task
         and (
           t.assignee_id   = app.current_user_id()
           or t.created_by_id = app.current_user_id()

           -- A Coordinator also sees the work of anybody they outrank.
           -- `acting_outranks` is STRICTLY greater rank, so this admits a
           -- Member's task and refuses an Admin's — and refuses a second
           -- Coordinator's, which matches "team member task" as written.
           or (
             app.acting_at_least('team_coordinator'::public.user_role)
             and app.acting_outranks(coalesce(t.assignee_id, t.created_by_id))
           )
         )
    ) or exists (
      -- Watching is an explicit, deliberate grant and survives the narrowing:
      -- somebody added as a watcher was added on purpose.
      select 1 from public.task_watchers w
       where w.task_id = p_task and w.user_id = app.current_user_id()
    )
  end
$$;

comment on function app.task_is_visible(uuid) is
  'May the caller see this task? Admin+ everything; Coordinator their own plus the work of anybody they outrank (not an Admin''s); Member their own and what is assigned to them; plus anything they explicitly watch. Rank is taken from coalesce(assignee_id, created_by_id). Replaces 083''s project-membership arm, which existed only while bulk-created posts had no owner.';

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
-- ⚠️ Read-only: every assertion is a question, none of it writes. 083's check
-- earned this pattern by refusing a wrong first attempt.
do $$
declare
  v_member   uuid;
  v_member2  uuid;
  v_coord    uuid;
  v_admin    uuid;
  v_task_m   uuid;   -- a Member's own task
  v_task_a   uuid;   -- an Admin's own task
begin
  select id into v_coord from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_admin from public.users where role = 'admin' and is_active limit 1;

  -- A member's own task: raised by them and nobody else's business.
  select t.created_by_id, t.id into v_member, v_task_m
    from public.tasks t
    join public.users u on u.id = t.created_by_id and u.role = 'member'
   where t.assignee_id = t.created_by_id and not t.is_deleted
   limit 1;

  select id into v_member2 from public.users
   where role = 'member' and is_active and id is distinct from v_member limit 1;

  if v_task_m is null or v_coord is null or v_admin is null then
    raise notice '084: not enough shape in the data to test; assertions skipped';
    return;
  end if;

  -- 1 · the member sees their own
  perform set_config('app.user_id', v_member::text, true);
  if not app.task_is_visible(v_task_m) then
    raise exception '084: a member cannot see their own task';
  end if;

  -- 2 · ⚠️ ANOTHER member does NOT. This is the 083 arm being gone: before this
  -- migration a colleague on the same project could read it.
  if v_member2 is not null then
    perform set_config('app.user_id', v_member2::text, true);
    if app.task_is_visible(v_task_m) then
      raise exception '084: one member can still see another member''s task';
    end if;
  end if;

  -- 3 · the coordinator sees a member's work
  perform set_config('app.user_id', v_coord::text, true);
  if not app.task_is_visible(v_task_m) then
    raise exception '084: the coordinator cannot see a member''s task';
  end if;

  -- 4 · ⚠️ but NOT an admin's own. The new restriction.
  select t.id into v_task_a
    from public.tasks t
   where t.created_by_id = v_admin
     and (t.assignee_id is null or t.assignee_id = v_admin)
     and not t.is_deleted
   limit 1;

  if v_task_a is not null then
    if app.task_is_visible(v_task_a) then
      raise exception '084: the coordinator can still see an admin''s own task';
    end if;

    -- 5 · and the admin can, obviously
    perform set_config('app.user_id', v_admin::text, true);
    if not app.task_is_visible(v_task_a) then
      raise exception '084: the admin cannot see their own task';
    end if;
    if not app.task_is_visible(v_task_m) then
      raise exception '084: the admin cannot see a member''s task';
    end if;
  else
    raise notice '084: no admin-owned task to test the new restriction against';
  end if;

  -- 6 · fails closed
  perform set_config('app.user_id', '', true);
  if app.task_is_visible(v_task_m) then
    raise exception '084: an unidentified session can see a task';
  end if;

  raise notice '084: sight follows rank (member own-only, coordinator not admin, admin all, fails closed)';
end $$;
