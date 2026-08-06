-- =============================================================================
-- MIGRATION 013 — ROW-LEVEL SECURITY FOR THE WORK CORE
-- Traces to: FR-157, ADR-003, doc 03 §3, doc 04 §5, registry C-14.
-- -----------------------------------------------------------------------------
-- ADR-003 is the requirement this file exists to make true:
--
--   "Members see ONLY their own tasks, workload and projects. They cannot see
--    other members' roles, tasks, workload or capacity."
--
-- That is the Phase 1 exit criterion, and it is stated as a property of the
-- *system*, not of the interface. So it is enforced here — where a forgotten
-- `where` clause in a query, a mistake in a server action, or a hand-written
-- API call cannot get around it.
--
-- ── HOW IDENTITY ARRIVES (registry C-14, revised by C-18) ────────────────────
-- There is no `auth.uid()`; we do not use Supabase Auth. Every request opens a
-- transaction and declares itself:
--
--     SET LOCAL ROLE cni_app;  SET LOCAL app.user_id = '<uuid>';
--
-- `app.current_user_id()` reads that. It returns NULL when unset, and every
-- predicate below is written so that NULL identity ⇒ no rows. Fail closed.
--
-- ── WHY THE VISIBILITY HELPERS ARE SECURITY DEFINER ──────────────────────────
-- A policy on `comments` that reads `tasks` is fine. But a policy on `tasks`
-- that reads `task_watchers`, while `task_watchers`' own policy reads `tasks`,
-- is mutual recursion — Postgres will error or, worse, the pair will be written
-- to avoid the error by loosening one side. The two helpers below read the
-- underlying tables as owner, so each policy asks a single, terminating
-- question. They are read-only, take one uuid, and return a boolean; there is
-- nothing to exploit in that surface.
--
-- ── WHERE THE FINE-GRAINED RULES LIVE, AND WHY NOT HERE ──────────────────────
-- RLS draws the coarse boundary: whose rows exist at all. It does NOT encode
-- "a member may not approve their own review" (BR-002) or "only an Admin grants
-- a time extension" (BR-018). Those are 79 actions × 4 roles and they live in
-- `lib/domain/permissions.ts`, tested three independent ways. Duplicating any
-- of them here would create a second implementation of a security control —
-- exactly what doc 20 forbids. This file and that file answer different
-- questions and both are needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · VISIBILITY HELPERS
-- -----------------------------------------------------------------------------

-- Coordinator and above see the whole board; that is the difference between a
-- coordinator and a member (doc 03 §2).
create or replace function app.sees_all_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.acting_at_least('team_coordinator'::public.user_role)
$$;

-- A member's task is one they are assigned, one they raised, or one they are
-- explicitly watching. Nothing else.
create or replace function app.task_is_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.current_user_id() is null then false
    when app.acting_at_least('team_coordinator'::public.user_role) then true
    else exists (
      select 1 from public.tasks t
       where t.id = p_task
         and (t.assignee_id = app.current_user_id()
              or t.created_by_id = app.current_user_id())
    ) or exists (
      select 1 from public.task_watchers w
       where w.task_id = p_task and w.user_id = app.current_user_id()
    )
  end
$$;

-- A member sees a project when they have work in it, own it, or raised it.
-- Note what this deliberately does NOT do: it does not reveal the project list
-- so a member can browse what everyone else is working on.
create or replace function app.project_is_visible(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.current_user_id() is null then false
    when app.acting_at_least('team_coordinator'::public.user_role) then true
    else exists (
      select 1 from public.projects p
       where p.id = p_project
         and (p.owner_id = app.current_user_id()
              or p.created_by_id = app.current_user_id())
    ) or exists (
      select 1 from public.tasks t
       where t.project_id = p_project
         and not t.is_deleted
         and (t.assignee_id = app.current_user_id()
              or t.created_by_id = app.current_user_id())
    )
  end
$$;

comment on function app.task_is_visible(uuid) is
  'ADR-003 member isolation. SECURITY DEFINER to break the tasks ↔ task_watchers policy recursion. Returns false on NULL identity — fail closed.';

grant execute on function app.sees_all_work()          to cni_app;
grant execute on function app.task_is_visible(uuid)    to cni_app;
grant execute on function app.project_is_visible(uuid) to cni_app;
revoke execute on function app.sees_all_work()          from public;
revoke execute on function app.task_is_visible(uuid)    from public;
revoke execute on function app.project_is_visible(uuid) from public;

-- -----------------------------------------------------------------------------
-- 2 · ENABLE RLS EVERYWHERE
-- -----------------------------------------------------------------------------
alter table public.projects                enable row level security;
alter table public.tasks                   enable row level security;
alter table public.task_skills             enable row level security;
alter table public.task_watchers           enable row level security;
alter table public.task_dependencies       enable row level security;
alter table public.checklist_items         enable row level security;
alter table public.comments                enable row level security;
alter table public.attachments             enable row level security;
alter table public.time_entries            enable row level security;
alter table public.time_extension_requests enable row level security;
alter table public.availability            enable row level security;
alter table public.activity_log            enable row level security;
alter table public.notifications           enable row level security;
alter table public.reference_counters      enable row level security;

-- -----------------------------------------------------------------------------
-- 3 · PROJECTS
-- -----------------------------------------------------------------------------
create policy projects_select on public.projects for select
  using (app.project_is_visible(id));

-- Coordinators and above create and edit projects (doc 03 §3). A member cannot.
create policy projects_insert on public.projects for insert
  with check (app.sees_all_work() and created_by_id = app.current_user_id());

create policy projects_update on public.projects for update
  using (app.sees_all_work())
  with check (app.sees_all_work());

-- No DELETE policy, on purpose. Projects archive (doc 15). Absent a policy, the
-- statement is refused — which is the correct answer, not an oversight.

-- -----------------------------------------------------------------------------
-- 4 · TASKS
-- -----------------------------------------------------------------------------
create policy tasks_select on public.tasks for select
  using (app.task_is_visible(id));

-- Anyone signed in may raise a task, but only as themselves. A member may only
-- raise it against themselves or leave it unassigned — handing work to someone
-- else is a coordinator action (doc 03 §3).
create policy tasks_insert on public.tasks for insert
  with check (
    app.current_user_id() is not null
    and created_by_id = app.current_user_id()
    and (
      app.sees_all_work()
      or assignee_id is null
      or assignee_id = app.current_user_id()
    )
  );

create policy tasks_update on public.tasks for update
  using (
    app.sees_all_work()
    or assignee_id = app.current_user_id()
    or created_by_id = app.current_user_id()
  )
  with check (
    app.sees_all_work()
    or assignee_id = app.current_user_id()
    or created_by_id = app.current_user_id()
  );

-- Deletion is a soft delete, which is an UPDATE. No DELETE policy — FR-095.

-- -----------------------------------------------------------------------------
-- 5 · TASK SATELLITES — visibility follows the task
-- -----------------------------------------------------------------------------
create policy task_skills_select on public.task_skills for select
  using (app.task_is_visible(task_id));
create policy task_skills_write on public.task_skills for all
  using (app.sees_all_work()) with check (app.sees_all_work());

create policy task_watchers_select on public.task_watchers for select
  using (app.task_is_visible(task_id) or user_id = app.current_user_id());
-- You may add or remove yourself as a watcher; coordinators may manage anyone's.
create policy task_watchers_write on public.task_watchers for all
  using (app.sees_all_work() or user_id = app.current_user_id())
  with check (app.sees_all_work() or user_id = app.current_user_id());

create policy task_dependencies_select on public.task_dependencies for select
  using (app.task_is_visible(task_id));
create policy task_dependencies_write on public.task_dependencies for all
  using (app.sees_all_work()) with check (app.sees_all_work());

create policy checklist_select on public.checklist_items for select
  using (app.task_is_visible(task_id));
-- The assignee ticks their own checklist. That is the point of a checklist.
create policy checklist_write on public.checklist_items for all
  using (app.task_is_visible(task_id))
  with check (app.task_is_visible(task_id));

create policy comments_select on public.comments for select
  using (app.task_is_visible(task_id));
create policy comments_insert on public.comments for insert
  with check (app.task_is_visible(task_id) and author_id = app.current_user_id());
-- You may edit your own comment. Nobody may edit anyone else's, at any rank —
-- putting words in someone's mouth is not a privilege that should exist.
create policy comments_update on public.comments for update
  using (author_id = app.current_user_id())
  with check (author_id = app.current_user_id());

create policy attachments_select on public.attachments for select
  using (app.task_is_visible(task_id));
create policy attachments_insert on public.attachments for insert
  with check (app.task_is_visible(task_id) and uploaded_by_id = app.current_user_id());
create policy attachments_delete on public.attachments for delete
  using (app.sees_all_work() or uploaded_by_id = app.current_user_id());

-- -----------------------------------------------------------------------------
-- 6 · TIME
-- -----------------------------------------------------------------------------
create policy time_entries_select on public.time_entries for select
  using (app.sees_all_work() or user_id = app.current_user_id());
create policy time_entries_insert on public.time_entries for insert
  with check (
    (app.sees_all_work() or user_id = app.current_user_id())
    and app.task_is_visible(task_id)
  );
create policy time_entries_update on public.time_entries for update
  using (app.sees_all_work() or user_id = app.current_user_id())
  with check (app.sees_all_work() or user_id = app.current_user_id());

create policy tx_select on public.time_extension_requests for select
  using (app.sees_all_work() or requested_by_id = app.current_user_id());
create policy tx_insert on public.time_extension_requests for insert
  with check (requested_by_id = app.current_user_id() and app.task_is_visible(task_id));
-- Only Admin and above decide (BR-018, FR-184). A Coordinator sets limits but
-- never extends them, so `sees_all_work()` is deliberately NOT the test here.
create policy tx_decide on public.time_extension_requests for update
  using (app.acting_at_least('admin'::public.user_role))
  with check (app.acting_at_least('admin'::public.user_role));

-- -----------------------------------------------------------------------------
-- 7 · AVAILABILITY
-- -----------------------------------------------------------------------------
create policy availability_select on public.availability for select
  using (app.sees_all_work() or user_id = app.current_user_id());
create policy availability_write on public.availability for all
  using (app.sees_all_work() or user_id = app.current_user_id())
  with check (app.sees_all_work() or user_id = app.current_user_id());

-- -----------------------------------------------------------------------------
-- 8 · ACTIVITY LOG
-- -----------------------------------------------------------------------------
-- A member sees their own trail and the trail of work they can see. They do not
-- get a window onto the whole team's movements — that is a coordinator view.
create policy activity_select on public.activity_log for select
  using (
    app.sees_all_work()
    or actor_id = app.current_user_id()
    or (entity_type = 'task' and app.task_is_visible(entity_id))
  );
create policy activity_insert on public.activity_log for insert
  with check (app.current_user_id() is not null and actor_id = app.current_user_id());

-- UPDATE and DELETE have no policy AND a rejecting trigger (migration 012).
-- Belt and braces on purpose: a REVOKE cannot bind a table owner.

-- -----------------------------------------------------------------------------
-- 9 · NOTIFICATIONS — yours and only yours, at every rank
-- -----------------------------------------------------------------------------
create policy notifications_select on public.notifications for select
  using (user_id = app.current_user_id());
-- Anyone may raise a notification for anyone (the system notifies on their
-- behalf), but nobody may read someone else's.
create policy notifications_insert on public.notifications for insert
  with check (app.current_user_id() is not null);
create policy notifications_update on public.notifications for update
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());
create policy notifications_delete on public.notifications for delete
  using (user_id = app.current_user_id());

-- -----------------------------------------------------------------------------
-- 10 · REFERENCE COUNTERS — no client path at all
-- -----------------------------------------------------------------------------
-- RLS on, zero policies, privileges revoked. References are issued only through
-- app.next_reference(), which runs as owner. If cni_app could write this table
-- directly, references would stop being unique-by-construction.
revoke all on public.reference_counters from cni_app;

-- -----------------------------------------------------------------------------
-- 11 · SELF-CHECK
-- -----------------------------------------------------------------------------
do $$
declare
  v_no_rls text;
  v_count  integer;
begin
  select string_agg(c.relname, ', ') into v_no_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_no_rls is not null then
    raise exception 'Tables without RLS: %', v_no_rls;
  end if;

  select count(*) into v_count from pg_policies
   where schemaname = 'public'
     and tablename in ('projects','tasks','comments','notifications','activity_log',
                       'time_entries','time_extension_requests','availability',
                       'checklist_items','attachments','task_skills','task_watchers',
                       'task_dependencies');

  if v_count < 30 then
    raise exception 'Expected at least 30 work-core policies, found %', v_count;
  end if;

  raise notice 'Migration 013 OK — RLS on every table, % work-core policies', v_count;
end
$$;
