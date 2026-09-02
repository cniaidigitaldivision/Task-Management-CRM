-- ============================================================================
-- 083 · YOUR PROJECT'S WORK IS YOUR WORK, AND WHOEVER POSTS IT OWNS IT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-02, describing the content flow they want: *"when someone is
-- doing an AI digital project, a task is auto-created by me, and someone starts
-- their to-do process. Put the link of Facebook and Instagram and mark as
-- published. When it is marked as published it should automatically move to in
-- review. Then I review it."*
--
-- That flow was not merely unbuilt. IT WAS IMPOSSIBLE, and measuring said why:
--
--     content tasks due 2026-09-02 ............................ 18
--     visible to Abdul Moiz (member) .......................... 2   ← his own
--     visible to Kashif (team_coordinator) .................... 18
--
-- The sixteen auto-created posts carry `assignee_id is null` and
-- `created_by_id = Kashif`, and `app.task_is_visible` grants a Member sight only
-- of a task they are assigned, raised, or watch. So every one of those posts was
-- invisible to every Member in the division. The activity log agrees: Kashif
-- pasted every link and made every status move himself, because nobody else
-- could see the card. The owner read that as a workflow problem — *"these all
-- should be moved to Done by Kashif. I think it's not a good thing"* — and it
-- was a permissions problem underneath.
--
-- ── ⚠️ THIS WIDENS ADR-003, DELIBERATELY AND ON THE OWNER'S DECISION ────────
-- ADR-003 is "a Member sees only their own work". It now reads: their own work,
-- plus the work of projects they are on. Chosen by the owner on 2026-09-02 over
-- the alternatives of Kashif assigning ~16 posts by hand every morning, or
-- making every content task division-wide.
--
-- Two things make it a small change rather than a hole:
--   · `public.projects` ALREADY works this way — `app.project_is_visible`
--     (migration 033) consults `project_members`. Tasks were the inconsistent
--     one: you could see the project and not the work in it.
--   · Membership is explicit and administered. Nobody is added to a project by
--     accident, and the Team tab on a project is where it is granted.
--
-- ⚠️ AND IT DOES NOT WIDEN WRITES. `tasks_update` still demands
-- `sees_all_work() or assignee_id = me or created_by_id = me`, so a Member who
-- can now SEE a colleague's task still cannot touch it. That is what
-- `app.claim_task` below is for, and why it is a function and not a policy.
-- ============================================================================

-- ── 1 · SIGHT FOLLOWS MEMBERSHIP ───────────────────────────────────────────
create or replace function app.task_is_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when app.current_user_id() is null then false
    when app.acting_at_least('team_coordinator'::public.user_role) then true
    else exists (
      select 1 from public.tasks t
       where t.id = p_task
         and (t.assignee_id = app.current_user_id()
              or t.created_by_id = app.current_user_id()
              -- ⚠️ NEW, 083. Hits project_members_pkey (project_id, user_id)
              -- directly, which matters: this function is evaluated per row by
              -- tasks_select and by every correlated count on a task board.
              or exists (
                select 1 from public.project_members m
                 where m.project_id = t.project_id
                   and m.user_id = app.current_user_id()
              ))
    ) or exists (
      select 1 from public.task_watchers w
       where w.task_id = p_task and w.user_id = app.current_user_id()
    )
  end
$$;

comment on function app.task_is_visible(uuid) is
  'May the caller see this task? Coordinator+ sees everything; below that: assigned to them, raised by them, watched by them, or belonging to a project they are a member of (083). Sight only — tasks_update is unchanged and still refuses a task they neither own nor were assigned.';

-- ── 2 · CLAIMING THE POST YOU JUST PUBLISHED ───────────────────────────────
-- ⚠️ WHY A FUNCTION AND NOT `or assignee_id is null` IN `tasks_update`. That
-- policy arm would let any Member rewrite EVERY column of EVERY unassigned task
-- in the division — title, due date, effort, project — as a side effect of
-- wanting to claim one. A policy cannot express "you may write this one column,
-- only this value, and only while it is empty". This can, so the widening is
-- confined to the single operation that needs it.
--
-- Refuses: no identity (fail closed, C-14) · a task the caller cannot see · one
-- that already has somebody · one already closed.
create or replace function app.claim_task(p_task_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor   uuid := app.current_user_id();
  v_claimed integer;
begin
  if v_actor is null then
    return false;
  end if;

  -- ⚠️ Consulted, not circumvented. This is SECURITY DEFINER only so it can
  -- write a column the UPDATE policy would refuse; it must never become a route
  -- to a task the caller was not allowed to see in the first place.
  if not app.task_is_visible(p_task_id) then
    return false;
  end if;

  update public.tasks
     set assignee_id = v_actor
   where id = p_task_id
     and assignee_id is null
     and status not in ('done', 'cancelled')
     and not is_deleted;

  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$$;

comment on function app.claim_task(uuid) is
  'Assigns an unassigned, open, visible task to the caller. Exists because tasks_update is Coordinator-and-above for a task you neither raised nor were assigned, so a Member pasting a live link could not claim it and the write silently affected zero rows.';

revoke all on function app.claim_task(uuid) from public;
grant execute on function app.claim_task(uuid) to cni_app;

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
-- ⚠️ Exercised against real rows and then undone. Safe because the runner wraps
-- this file in ONE transaction: no other session observes the intermediate
-- state, and any failure rolls the whole file back rather than leaving a task
-- claimed by a test.
do $$
declare
  v_member uuid;
  v_other  uuid;
  v_task   uuid;
  v_before integer;
  v_after  integer;
begin
  -- A Member who is on at least one project, and an unassigned open task in a
  -- project they belong to. Anything less proves nothing.
  select m.user_id, t.id into v_member, v_task
    from public.project_members m
    join public.users u on u.id = m.user_id and u.role = 'member' and u.is_active
    join public.tasks t on t.project_id = m.project_id
   where t.assignee_id is null
     and t.created_by_id <> m.user_id
     and t.status not in ('done', 'cancelled')
     and not t.is_deleted
   limit 1;

  if v_task is null then
    raise notice '083: no member-on-a-project with an unassigned task; guards untested';
    return;
  end if;

  perform set_config('app.user_id', v_member::text, true);

  -- 1 · they can now SEE it, which is the change
  if not app.task_is_visible(v_task) then
    raise exception '083: a project member still cannot see their project''s task';
  end if;

  -- 2 · and they can claim it, which the UPDATE policy alone would refuse
  if not app.claim_task(v_task) then
    raise exception '083: a member could not claim an unassigned task in their own project';
  end if;
  if (select assignee_id from public.tasks where id = v_task) is distinct from v_member then
    raise exception '083: claim_task reported success without writing the assignee';
  end if;

  -- 3 · nobody may take it off them once claimed
  select id into v_other from public.users
   where id <> v_member and is_active and role = 'member' limit 1;
  if v_other is not null then
    perform set_config('app.user_id', v_other::text, true);
    if app.claim_task(v_task) then
      raise exception '083: claim_task stole a task that already had an assignee';
    end if;
  end if;

  -- 4 · undo. It was null; put it back exactly.
  update public.tasks set assignee_id = null where id = v_task;

  -- 5 · fails closed with no identity
  perform set_config('app.user_id', '', true);
  if app.claim_task(v_task) then
    raise exception '083: claim_task acted for an unidentified session';
  end if;

  -- 6 · ⚠️ SIGHT MUST NOT HAVE BECOME UNIVERSAL. A member on NO project must
  -- still see nothing extra — otherwise this migration widened far more than
  -- the owner agreed to.
  select id into v_other from public.users u
   where u.role = 'member' and u.is_active
     and not exists (select 1 from public.project_members m where m.user_id = u.id)
   limit 1;
  if v_other is not null then
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into v_before from public.tasks t
     where t.id = v_task and app.task_is_visible(t.id);
    if v_before > 0 then
      raise exception '083: a member on no project can see a task anyway — too wide';
    end if;
  end if;

  raise notice '083: sight follows membership, claim_task holds, and non-members still see nothing';
end $$;
