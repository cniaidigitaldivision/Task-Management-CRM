-- ============================================================================
-- 262 · THE EXECUTIVE RUNS THE WORK
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-26, reversing part of the 25th: *"the executive will not be
-- allowed to see the task page but right now I have to add task-related things
-- for him ... he can assign a task to a team member ... he can view tasks and
-- everything like that. The task page and these things will now be allowed."*
--
-- Asked before building, and the answers were: create AND assign, full control
-- of a task afterwards (content, dates, status), approvals included, and he may
-- assign to anyone he outranks.
--
-- ── ⚠️ THIS RETIRES THE READ-ONLY SESSION, AND THAT IS THE RIGHT CALL ─────
-- 257 made every Executive transaction READ ONLY, which was the honest shape of
-- "writes nothing". It is no longer the shape of the role. Creating a task
-- touches `tasks`, `task_dependencies`, `task_skills`, `task_watchers`,
-- `checklist_items`, `comments`, `attachments`, `activity_log` and
-- `notifications`; approving one moves a status and writes a reason. Keeping the
-- blanket refusal and punching fifteen named holes through it would leave a
-- boundary that is mostly holes — and each hole is a place to forget a check.
--
-- So the guarantee moves from "this session cannot write" to "these particular
-- doors are shut", which is how every other role in this system already works.
-- The doors are listed below and each one is closed deliberately.
--
-- ── ⚠️ WHAT STAYS SHUT, AND WHY IT DID NOT NEED A LINE HERE ──────────────
-- `app.users_the_caller_outranks()` still returns an empty set for an Executive
-- (256), and that single fact keeps eleven write policies refused without this
-- file touching one of them:
--
--     auth_identities insert/update      sign-in identities
--     invitations insert/update          creating or re-issuing an invitation
--     mfa_factors delete                 removing somebody's second factor
--     performance_assessments ins/upd    writing an appraisal about a person
--     performance_goals ins/upd          setting somebody's target
--     goal_checkins / goal_comments      reporting against their goals
--
-- Task assignment does NOT go through that helper — the rank test for "may I
-- hand work to this person" is `canAssignTo` in TypeScript plus `tasks_update`,
-- which asks `sees_all_work()`. So the work opens and the personnel file does
-- not. That separation is the whole reason this migration is short.
--
-- ⚠️ AND `app.acting_writes()` STILL GUARDS THE EIGHT DOORS 256 CLOSED —
-- drive folders, sync rules, report schedules, expenses, project reports and
-- document edits. Nine more are added below for the same reason.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THEY CAN SEE THE WORK
-- ----------------------------------------------------------------------------
-- ⚠️ AN EXPLICIT ARM, NOT `sees_all_work()`. That helper is
-- `acting_at_least('team_coordinator')`, so putting it in this predicate would
-- widen what every COORDINATOR sees from "the people I outrank" to "everything"
-- — a change to somebody else's access, made by accident, while adding a role.
-- The Executive is named instead.
--
-- ⚠️ AND IT IS COMPANY-WIDE ON PURPOSE. The owner's answer to "who can he assign
-- to" was "anyone below him", and you cannot hand out work you cannot see.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select
  using (
    (select app.current_user_id()) is not null
    and (
      (select app.acting_at_least('admin'::public.user_role))
      or (select app.acting_is_executive())
      or assignee_id = (select app.current_user_id())
      or created_by_id = (select app.current_user_id())
      or coalesce(assignee_id, created_by_id)
         = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
      or id = any (coalesce((select app.tasks_the_caller_watches()), '{}'::uuid[]))
    )
  );

-- ----------------------------------------------------------------------------
-- 2 · THE DOORS THAT STAY SHUT
-- ----------------------------------------------------------------------------
-- Lifting the read-only session opens everything `sees_all_work()` admits, and
-- that set is wider than tasks. None of these was asked for, so each is closed
-- the same way 256 closed its eight: one clause, AND-ed, narrowing only.
--
-- ⚠️ PROJECTS ARE THE IMPORTANT ONE. An Executive who could create and edit
-- projects could route a department's leads to itself by changing
-- `lead_department_id` — the CRM's own access rule reads that column.

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (app.sees_all_work() and app.acting_writes());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (app.sees_all_work() and app.acting_writes());

drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members
  for all
  using (app.sees_all_work() and app.acting_writes())
  with check (app.sees_all_work() and app.acting_writes());

drop policy if exists project_platforms_write on public.project_platforms;
create policy project_platforms_write on public.project_platforms
  for all
  using (app.sees_all_work() and app.acting_writes())
  with check (app.sees_all_work() and app.acting_writes());

drop policy if exists project_services_write on public.project_services;
create policy project_services_write on public.project_services
  for all
  using (app.sees_all_work() and app.acting_writes())
  with check (app.sees_all_work() and app.acting_writes());

-- Somebody's working hours and leave are theirs and their manager's.
drop policy if exists availability_write on public.availability;
create policy availability_write on public.availability
  for all
  using (app.sees_all_work() and app.acting_writes())
  with check (app.sees_all_work() and app.acting_writes());

-- ⚠️ DELETING a file stays shut; ATTACHING one does not, because a reviewer
-- asking for a change may need to show what they mean.
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete using (app.sees_all_work() and app.acting_writes());

-- Logging hours against work is a record of who did it, not of who ran it.
drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert with check (app.sees_all_work() and app.acting_writes());

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update using (app.sees_all_work() and app.acting_writes());

-- ----------------------------------------------------------------------------
-- 3 · THE READ-ONLY SESSION IS RETIRED
-- ----------------------------------------------------------------------------
-- ⚠️ IT RETURNS 'off' RATHER THAN BEING DROPPED. `withUser` calls it on every
-- query in the application; dropping the function would take the whole app down
-- between this migration and the deploy that stops calling it. It is removed
-- from `withUser` in the same commit, and this function goes in a later
-- migration once no deployed build still asks for it.
create or replace function app.session_read_only(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  /* Retired by 262. The Executive now runs the work — see that file's header.
     `p_user` is kept so the signature does not change under a running deploy. */
  select case when p_user is null then 'off' else 'off' end
$fn$;

comment on function app.session_read_only(uuid) is
  'RETIRED by migration 262 — always off. Kept only so a deployed build calling it does not break; remove once nothing does.';

-- ----------------------------------------------------------------------------
-- 4 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_admin uuid;
  v_member uuid;
  v_project uuid;
  v_task uuid;
  v_seen int;
  v_before uuid;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_member from public.users where role = 'member' and is_active order by created_at limit 1;
  select id into v_project from public.projects order by created_at limit 1;
  if v_admin is null or v_member is null or v_project is null then
    raise exception 'self-check needs an admin, a member and a project';
  end if;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 262', 'self-check-262@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_exec::text, true);

  -- ── they can SEE the company's work ─────────────────────────────────────
  select count(*) into v_seen from public.tasks;
  if v_seen = 0 then
    raise exception 'AN EXECUTIVE STILL SEES NO TASKS';
  end if;

  -- ── they can CREATE one and give it to somebody ─────────────────────────
  /* ⚠️ `reference` and `effort_points` are NOT NULL with no default — the
     application supplies both. A fixture that omits them fails on the column
     rather than on the policy, which would have read as a refusal. */
  insert into public.tasks (reference, title, project_id, created_by_id, assignee_id, status, effort_points)
  values ('SC262-' || substr(gen_random_uuid()::text, 1, 6),
          'Self-check 262 task', v_project, v_exec, v_member, 'todo', 1)
  returning id into v_task;
  if v_task is null then
    raise exception 'AN EXECUTIVE COULD NOT CREATE A TASK';
  end if;

  -- ── and EDIT it, and MOVE it ────────────────────────────────────────────
  update public.tasks set title = 'Self-check 262 task (edited)' where id = v_task;
  if (select title from public.tasks where id = v_task) <> 'Self-check 262 task (edited)' then
    raise exception 'AN EXECUTIVE COULD NOT EDIT A TASK';
  end if;
  update public.tasks set status = 'in_progress' where id = v_task;
  if (select status from public.tasks where id = v_task) <> 'in_progress' then
    raise exception 'AN EXECUTIVE COULD NOT MOVE A TASK';
  end if;

  -- ── and REASSIGN it ─────────────────────────────────────────────────────
  update public.tasks set assignee_id = v_admin where id = v_task;
  if (select assignee_id from public.tasks where id = v_task) <> v_admin then
    raise exception 'AN EXECUTIVE COULD NOT REASSIGN A TASK';
  end if;

  -- ── AND THE DOORS THAT MUST STAY SHUT ───────────────────────────────────
  begin
    insert into public.projects (name, lead_department_id)
    values ('Self-check 262 project', null);
    raise exception 'AN EXECUTIVE CREATED A PROJECT';
  exception
    when insufficient_privilege then null;
  end;

  update public.projects set name = name || '' where id = v_project;
  if found then
    raise exception 'AN EXECUTIVE EDITED A PROJECT';
  end if;

  -- personnel writes are still refused, via the empty outranks set from 256
  if coalesce(array_length(app.users_the_caller_outranks(), 1), 0) <> 0 then
    raise exception 'AN EXECUTIVE OUTRANKS SOMEBODY AGAIN — assessments and MFA would open';
  end if;

  begin
    insert into public.performance_goals (subject_id, title, set_by_id)
    values (v_member, 'Self-check 262 goal', v_exec);
    raise exception 'AN EXECUTIVE SET SOMEBODY A GOAL';
  exception
    when insufficient_privilege then null;
  end;

  -- ── clean up ────────────────────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.tasks where id = v_task;
  delete from public.users where id = v_exec;
  if exists (select 1 from public.users where id = v_exec) then
    raise exception 'THE 262 FIXTURE SURVIVED';
  end if;

  raise notice '262 self-check passed: an executive sees, creates, edits, moves and reassigns work; projects, goals and personnel writes stay shut';
end $$;
