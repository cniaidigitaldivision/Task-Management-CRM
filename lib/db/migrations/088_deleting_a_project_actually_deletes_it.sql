-- ============================================================================
-- 088 · DELETING A PROJECT ACTUALLY DELETES IT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03: *"when I click on the Delete Permanently any project and a
-- modal appears, I type that project name and click confirm. It shows me the
-- delete but it is actually not deleting."*
--
-- Correct, and the cause is worse than nothing happening.
--
-- ── ⚠️ WHAT THE ACTION WAS ACTUALLY DOING ───────────────────────────────────
-- `public.projects` has RLS enabled and NO DELETE POLICY AT ALL. Under RLS an
-- operation with no policy is refused, and a refused DELETE is not an error —
-- it affects zero rows. `deleteProjectAction` never checked the count, so it
-- reported success every time.
--
-- And it did not fail cleanly on the way there, because the child deletes have
-- DIFFERENT audiences:
--
--   invoice_lines / revenue_payments / revenue_entries  Admin+     → DELETED
--   documents                                           folder mgr → maybe
--   tasks                                               SUPER ADMIN ONLY → kept
--   projects                                            no policy  → kept
--
-- So an Admin pressing "Delete for ever" destroyed the project's invoices and
-- revenue rows, kept the project and its tasks, and was told it had worked. A
-- partial delete reported as a success is the worst of the three possible
-- outcomes. Verified before writing this: the two projects the owner tried it on
-- had no invoices or documents, so nothing was lost.
--
-- ── ⚠️ WHY A FUNCTION AND NOT FIVE DELETE POLICIES ─────────────────────────
-- Adding `for delete using (acting_at_least('admin'))` to projects and tasks
-- would fix this case and hand every Admin a blanket right to delete ANY task
-- and ANY project row by any route, for ever — `tasks_delete` is deliberately
-- Super Admin only, and BR-007 keeps user rows undeletable, so this codebase
-- clearly treats destruction as narrow on purpose.
--
-- One function instead: it deletes a project and its dependents, or refuses and
-- says why, and it is the only thing that can. It also makes the whole cascade
-- atomic, which the six separate statements never were.
--
-- ── THE ORDER IS NOT ARBITRARY ──────────────────────────────────────────────
--   · `tasks.project_id` is ON DELETE **RESTRICT**, so tasks must go first or
--     the project delete fails. Everything hanging off a task (placements,
--     comments, checklists, attachments, dependencies, time entries) is CASCADE
--     from tasks and needs no statement of its own.
--   · `revenue_entries.project_id` is ON DELETE **SET NULL**. Left to the FK,
--     deleting a project would silently turn its invoices into unattributed
--     income sitting in the ledger for ever. They are deleted explicitly.
--   · `documents.project_id` is SET NULL for the same reason and gets the same
--     treatment.
--   · project_members, platforms, reports and services are CASCADE.
-- ============================================================================

create or replace function app.delete_project(p_project uuid)
returns table (deleted boolean, refusal text)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor     uuid := app.current_user_id();
  v_name      text;
  v_permanent boolean;
  v_sent      text;
  v_rows      integer;
begin
  if v_actor is null then
    return query select false, 'You are not signed in.'::text;
    return;
  end if;

  -- ⚠️ Admin and above. The same rank `project.soft_delete` grants in the
  -- permission matrix, checked here so the rule holds even if a future caller
  -- forgets to ask.
  if not app.acting_at_least('admin'::public.user_role) then
    return query select false, 'Only an Admin can delete a project.'::text;
    return;
  end if;

  -- ⚠️ Consulted, not bypassed. SECURITY DEFINER exists here to widen WHICH
  -- ROWS may be deleted, never which projects may be reached.
  if not app.project_is_visible(p_project) then
    return query select false, 'That project is no longer available.'::text;
    return;
  end if;

  select name, is_permanent into v_name, v_permanent
    from public.projects where id = p_project;

  if v_name is null then
    return query select false, 'That project is no longer available.'::text;
    return;
  end if;

  if v_permanent then
    return query select false,
      'The Misc / Ad-hoc project cannot be deleted — ad-hoc work has to have somewhere to land.'::text;
    return;
  end if;

  -- ⚠️ REFUSED, NOT FORCED. A sent invoice is a document the client is holding;
  -- deleting the project would erase our copy of something they can still
  -- produce. Voiding is the sanctioned route and it keeps the number.
  select invoice_no into v_sent
    from public.revenue_entries
   where project_id = p_project and sent_at is not null
   limit 1;

  if v_sent is not null then
    return query select false,
      ('Invoice ' || v_sent || ' has already been sent to the client. Void it first — a sent invoice cannot be erased by deleting its project.')::text;
    return;
  end if;

  -- Inward out. See the header for why each of these is explicit.
  delete from public.invoice_lines
   where revenue_id in (select id from public.revenue_entries where project_id = p_project);
  delete from public.revenue_payments
   where revenue_id in (select id from public.revenue_entries where project_id = p_project);
  delete from public.revenue_entries where project_id = p_project;
  delete from public.documents        where project_id = p_project;
  delete from public.tasks            where project_id = p_project;
  delete from public.projects         where id = p_project;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Should be unreachable: the row existed a few statements ago. Reported
    -- rather than assumed, because reporting a delete that did not happen is
    -- the exact bug this migration exists to end.
    return query select false, 'That project could not be deleted.'::text;
    return;
  end if;

  return query select true, null::text;
end;
$$;

comment on function app.delete_project(uuid) is
  'Deletes a project and its dependents, or refuses with a reason. Exists because public.projects has RLS with no DELETE policy, so the previous statement-by-statement delete removed the invoices (Admin+), kept the tasks (Super Admin only) and the project (no policy), and reported success. Order matters: tasks are RESTRICT, revenue and documents are SET NULL and would otherwise be orphaned.';

revoke all on function app.delete_project(uuid) from public;
grant execute on function app.delete_project(uuid) to cni_app;

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
-- ⚠️ END TO END, on a throwaway project created here. The whole point of this
-- migration is that the operation silently did nothing, so asserting anything
-- less than "the row is gone" would miss a repeat of exactly that.
do $$
declare
  v_admin  uuid;
  v_member uuid;
  v_id     uuid := gen_random_uuid();
  v_ok     boolean;
  v_why    text;
begin
  select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  select id into v_member from public.users where role = 'member' and is_active limit 1;

  if v_admin is null then
    raise notice '088: no admin to test with; assertions skipped';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.projects (id, name, type, code, status, owner_id, created_by_id)
  values (v_id, '088 self-check', 'other', 'OTH', 'active', v_admin, v_admin);

  -- 1 · a MEMBER may not delete it
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    select deleted, refusal into v_ok, v_why from app.delete_project(v_id);
    if v_ok then
      raise exception '088: a member deleted a project';
    end if;
    if (select count(*) from public.projects where id = v_id) <> 1 then
      raise exception '088: the project vanished on a refused delete';
    end if;
  end if;

  -- 2 · an unidentified session may not
  perform set_config('app.user_id', '', true);
  select deleted into v_ok from app.delete_project(v_id);
  if v_ok then
    raise exception '088: an unidentified session deleted a project';
  end if;

  -- 3 · the Admin can, and the row is ACTUALLY GONE
  perform set_config('app.user_id', v_admin::text, true);
  select deleted, refusal into v_ok, v_why from app.delete_project(v_id);
  if not v_ok then
    raise exception '088: the admin could not delete a project: %', coalesce(v_why, 'no reason given');
  end if;
  if (select count(*) from public.projects where id = v_id) <> 0 then
    raise exception '088: delete_project reported success and the project is still there';
  end if;

  -- 4 · and deleting it twice is an honest refusal, not a silent success
  select deleted, refusal into v_ok, v_why from app.delete_project(v_id);
  if v_ok then
    raise exception '088: deleting an absent project reported success';
  end if;

  raise notice '088: a project is deleted by an Admin, refused for everybody else, and the row really goes';
end $$;
