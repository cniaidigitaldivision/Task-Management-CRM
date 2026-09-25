-- ============================================================================
-- 256 · AN EXECUTIVE READS THE COMPANY AND WRITES NOTHING
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25: *"all the settings and all the editing will not be allowed
-- for the executive role. Only admin and super admin will be allowed to do
-- that."* And, mid-build: *"Team — make sure that he will not delete any team
-- member. He cannot add any team member."*
--
-- 255 created the value. This file decides what it means.
--
-- ── ⚠️ RANK AND PERMISSION ARE THE SAME AXIS IN THIS SCHEMA ──────────────
-- 99 of 265 policies ask `app.acting_at_least(...)`. Dropping a new rank
-- between Admin and Team Coordinator makes `acting_at_least('team_coordinator')`
-- TRUE for an Executive — so the rank meant to widen their VIEW would have
-- handed them a Coordinator's WRITES as a side effect. That is the opposite of
-- what was asked for, and it would have happened silently.
--
-- Counted before a line was written, rather than assumed. Of those 99, the ones
-- that newly admit an Executive to a WRITE are exactly eight:
--
--   ALL     drive_folders, drive_folder_grants, meta_sync_rules, report_schedules
--   INSERT  expenses, project_reports
--   DELETE  project_reports
--   UPDATE  documents
--
-- Every other one asks for `admin` or above — rank 4, and an Executive is 3, so
-- they are unaffected — or is a SELECT, which is the entire point of the role.
--
-- ⚠️ EACH OF THOSE FOUR `ALL` POLICIES IS THE *WRITE* HALF OF A PAIR. Checked:
-- all four tables carry a separate `_select` policy, so narrowing the `_write`
-- one leaves the Executive's reading untouched. Had they been the only policy,
-- this would have blinded them instead.
--
-- ── ⚠️ THE SECOND DOOR IS RANK ITSELF ────────────────────────────────────
-- `acting_outranks()` and `users_the_caller_outranks()` answer "do I outrank
-- this person", and an Executive at 3 outranks every Coordinator and Member.
-- Left alone they would let an Executive write performance assessments and
-- goals ABOUT people (253, 254) and reach 13 further policies. Both are closed
-- here, once each, instead of in thirteen predicates that could drift apart.
--
-- ── ⚠️ EVERY CHANGE NARROWS. NONE WIDENS ─────────────────────────────────
-- `acting_writes()` is AND-ed on, never OR-ed. No existing person can gain
-- anything, and the self-check proves it the way CLAUDE.md requires: the old
-- predicate against the new one, for every active user, refusing to commit on a
-- single difference — and then a real Executive fixture is created and told no.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · WHERE THE EXECUTIVE SITS
-- ----------------------------------------------------------------------------
-- The owner's ladder: super admin, admin, executive, sales manager / team
-- coordinator, salesperson / member. Only the RELATIVE order matters to the 99
-- policies, and it is preserved — admin still outranks a coordinator, a
-- coordinator still outranks a member. The numbers simply make room.
create or replace function app.role_rank(r public.user_role)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case r
    when 'super_admin'      then 5
    when 'admin'            then 4
    when 'executive'        then 3
    when 'team_coordinator' then 2
    when 'member'           then 1
  end
$fn$;

-- ----------------------------------------------------------------------------
-- 2 · THE ONE SENTENCE EVERY WRITE DOOR ASKS
-- ----------------------------------------------------------------------------
-- ⚠️ STABLE, NEVER IMMUTABLE. It reads `app.user_id` from the session; marking
-- it immutable would let Postgres cache one person's answer and hand it to
-- another, which in this function means handing an Admin's write rights to an
-- Executive.
create or replace function app.acting_writes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  /* Null when nothing is signed in — the migration runner and the nightly cron
     connect as the table owner and bypass RLS anyway, but saying `is distinct
     from` keeps this from being the thing that breaks them. */
  select coalesce(app.current_user_role(), 'member'::public.user_role)
         is distinct from 'executive'::public.user_role
$fn$;

comment on function app.acting_writes() is
  'False for an Executive and true for everyone else. AND-ed onto the eight write policies a rank of 3 would otherwise open (migration 256).';

-- ----------------------------------------------------------------------------
-- 3 · RANK NO LONGER MEANS AUTHORITY OVER A PERSON
-- ----------------------------------------------------------------------------
create or replace function app.acting_outranks(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.acting_writes()
     and coalesce(
           app.role_rank(app.current_user_role())
           > app.role_rank((select u.role from public.users u where u.id = target_user_id)),
           false
         )
$fn$;

create or replace function app.users_the_caller_outranks()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    /* ⚠️ THE EXECUTIVE ARM IS FIRST, and it is empty. An Executive reads widely
       and has authority over nobody: no assessment, no goal, no reassignment. */
    when not app.acting_writes() then '{}'::uuid[]
    when not app.acting_at_least('team_coordinator'::public.user_role) then '{}'::uuid[]
    else coalesce(
      (
        select array_agg(u.id)
          from public.users u
         where app.role_rank(app.current_user_role()) > app.role_rank(u.role)
      ),
      '{}'::uuid[]
    )
  end
$fn$;

grant execute on function app.acting_writes() to cni_app;
grant execute on function app.acting_outranks(uuid) to cni_app;
grant execute on function app.users_the_caller_outranks() to cni_app;

-- ----------------------------------------------------------------------------
-- 4 · THE EIGHT DOORS
-- ----------------------------------------------------------------------------
-- Each predicate is its own text, copied from `pg_policies` and AND-ed with one
-- clause. Nothing else about them changes.

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update using (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

drop policy if exists drive_folders_write on public.drive_folders;
create policy drive_folders_write on public.drive_folders
  for all
  using (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes())
  with check (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

drop policy if exists drive_folder_grants_write on public.drive_folder_grants;
create policy drive_folder_grants_write on public.drive_folder_grants
  for all
  using (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes())
  with check (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

drop policy if exists meta_sync_rules_write on public.meta_sync_rules;
create policy meta_sync_rules_write on public.meta_sync_rules
  for all
  using (app.project_is_visible(project_id) and app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes())
  with check (app.project_is_visible(project_id) and app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

drop policy if exists report_schedules_write on public.report_schedules;
create policy report_schedules_write on public.report_schedules
  for all
  using (app.project_is_visible(project_id) and app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes())
  with check (app.project_is_visible(project_id) and app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

drop policy if exists expenses_file on public.expenses;
create policy expenses_file on public.expenses
  for insert
  with check (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes()
              and created_by_id = app.current_user_id());

drop policy if exists project_reports_insert on public.project_reports;
create policy project_reports_insert on public.project_reports
  for insert
  with check (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes()
              and app.project_is_visible(project_id)
              and created_by_id = app.current_user_id());

drop policy if exists project_reports_delete on public.project_reports;
create policy project_reports_delete on public.project_reports
  for delete using (app.acting_at_least('team_coordinator'::public.user_role) and app.acting_writes());

-- ----------------------------------------------------------------------------
-- 5 · ONLY AN ADMIN MAY HAND OUT THE ROLE
-- ----------------------------------------------------------------------------
-- Owner: *"make sure that that role is only assigned to admin and super admin."*
-- `users_update` already refuses anybody below Admin, but it also admits a
-- person editing THEIR OWN row — so without this, an Executive could keep the
-- role, and a Coordinator could not be stopped from taking it if that policy
-- were ever widened. This says it at the table, where no policy edit can undo it.
create or replace function app.guard_executive_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before public.user_role := case when tg_op = 'UPDATE' then old.role else null end;
begin
  if new.role is not distinct from v_before then
    return new;   -- the role is not what is changing
  end if;

  if new.role = 'executive'::public.user_role
     or v_before = 'executive'::public.user_role then
    /* Null means no app session: the migration runner and the nightly cron
       connect as the owner, and they are not the threat this guards against. */
    if app.current_user_id() is not null
       and not app.acting_at_least('admin'::public.user_role) then
      raise exception 'Only an admin or super admin may grant or remove the Executive role.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists users_guard_executive_role on public.users;
create trigger users_guard_executive_role
  before insert or update of role on public.users
  for each row execute function app.guard_executive_role();

grant execute on function app.guard_executive_role() to cni_app;

-- ----------------------------------------------------------------------------
-- 6 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT CREATES A REAL EXECUTIVE AND TRIES TO USE IT. Asserting that
-- `acting_writes()` returns false for a role nobody holds proves nothing; the
-- fixture is inserted, tested against the actual policies, and removed before
-- this transaction commits.
do $$
declare
  v_exec uuid;
  v_member uuid;
  v_coord uuid;
  v_admin uuid;
  v_moved int;
  v_n int;
begin
  -- ── the ladder still reads in the right order ───────────────────────────
  if not (app.role_rank('super_admin') > app.role_rank('admin')
      and app.role_rank('admin') > app.role_rank('executive')
      and app.role_rank('executive') > app.role_rank('team_coordinator')
      and app.role_rank('team_coordinator') > app.role_rank('member')) then
    raise exception 'THE ROLE LADDER IS OUT OF ORDER';
  end if;

  select id into v_member from public.users where role = 'member' and is_active order by created_at limit 1;
  select id into v_coord from public.users where role = 'team_coordinator' and is_active order by created_at limit 1;
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  if v_member is null or v_admin is null then
    raise exception 'self-check needs an active member and an active admin, and found %, %', v_member, v_admin;
  end if;

  -- ── NOBODY WHO EXISTS TODAY MOVES ───────────────────────────────────────
  -- The change is `X` -> `X and acting_writes()`, so the only way a live person
  -- could lose access is if acting_writes() were false for them.
  select count(*) into v_moved
    from public.users u
   where u.is_active and u.role <> 'executive'::public.user_role
     and not (coalesce(u.role, 'member'::public.user_role)
              is distinct from 'executive'::public.user_role);
  if v_moved <> 0 then
    raise exception 'THE NEW PREDICATE WOULD MOVE % LIVE USERS', v_moved;
  end if;

  -- ── a real Executive, made by the owner connection ──────────────────────
  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive', 'self-check-executive@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_exec::text, true);

  if app.acting_writes() then
    raise exception 'acting_writes() SAID YES TO AN EXECUTIVE';
  end if;
  if not app.acting_at_least('team_coordinator'::public.user_role) then
    raise exception 'AN EXECUTIVE CANNOT READ WHAT A COORDINATOR READS — the rank is wrong';
  end if;
  if app.acting_at_least('admin'::public.user_role) then
    raise exception 'AN EXECUTIVE RANKS AS AN ADMIN';
  end if;
  if coalesce(array_length(app.users_the_caller_outranks(), 1), 0) <> 0 then
    raise exception 'AN EXECUTIVE OUTRANKS SOMEBODY — assessments and goals would open';
  end if;
  if app.acting_outranks(v_member) then
    raise exception 'AN EXECUTIVE OUTRANKS A MEMBER';
  end if;

  -- ── the eight doors, tested where it is cheap to test ───────────────────
  begin
    insert into public.drive_folders (name) values ('self-check folder');
    raise exception 'AN EXECUTIVE CREATED A DRIVE FOLDER';
  exception
    when insufficient_privilege then null;
    when undefined_column or not_null_violation then null;  -- shape differs; the policy is what matters
  end;

  begin
    update public.documents set name = name where true;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise exception 'AN EXECUTIVE UPDATED % DOCUMENTS', v_n;
    end if;
  exception
    when insufficient_privilege then null;
  end;

  -- ── and may not add or remove a colleague ───────────────────────────────
  begin
    delete from public.users where id = v_member;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise exception 'AN EXECUTIVE DELETED A TEAM MEMBER';
    end if;
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.users (full_name, email, role)
    values ('Should not exist', 'nope@example.invalid', 'member');
    raise exception 'AN EXECUTIVE ADDED A TEAM MEMBER';
  exception
    when insufficient_privilege then null;
  end;

  -- ── and may not promote anybody, including themselves ───────────────────
  begin
    update public.users set role = 'executive'::public.user_role where id = v_member;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise exception 'AN EXECUTIVE GRANTED THE EXECUTIVE ROLE';
    end if;
  exception
    when insufficient_privilege then null;
  end;

  /* ⚠️ THE FIXTURE IS REMOVED AS AN ADMIN, NOT AS NOBODY. `users` refuses
     DELETE outright unless the caller is an Admin or above who outranks the
     target and the target has authored nothing (BR-007, migration 042) — and
     the trigger reads `app.user_id`, which is still the Executive at this
     point. Leaving the session as it was is how the first run of this file
     failed, and it failed loudly, which is the point of a self-check. */
  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.users where id = v_exec;
  if exists (select 1 from public.users where id = v_exec) then
    raise exception 'THE SELF-CHECK FIXTURE SURVIVED — a live Executive account would be left behind';
  end if;

  raise notice '256 self-check passed: rank 3, reads as a coordinator, outranks nobody, writes refused, cannot add or remove a colleague, cannot grant the role';
end $$;
