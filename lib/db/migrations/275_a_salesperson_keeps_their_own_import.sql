-- ============================================================================
-- 275 · A SALESPERSON KEEPS THEIR OWN IMPORT
-- ----------------------------------------------------------------------------
-- Found by driving /my-leads as Sarah: the wizard read her file, validated two
-- rows, said "these will all be yours to work", and imported nothing.
--
--     42501 — Only the manager of the department this project belongs to, an
--     Executive, or an Admin, can hand out its leads.
--     PL/pgSQL function crm_guard_reassign() line 10
--
-- ── ⚠️ THE GUARD IS RIGHT AND THE IMPORTER WAS WRONG ──────────────────────
-- `crm_leads_guard_reassign` fires BEFORE UPDATE on any change of `owner_id`,
-- and it does not care who the new owner is — so a salesperson setting a lead
-- to HERSELF reads as handing out leads, exactly as taking one from a colleague
-- would. That is the correct default: "claiming" and "reassigning" are the same
-- UPDATE, and the guard cannot tell them apart from the row alone.
--
-- What it CAN be told is that the row was created a moment ago by the very
-- person now being given it, inside a definer that has already checked they may
-- add leads to this project. So 274's import gets a flag of its own.
--
-- ── ⚠️ A NAMED FLAG, NOT A TRICK ───────────────────────────────────────────
-- The guard's own comment points at a shortcut: *"The importer runs with no
-- session and must pass"* — so clearing `app.user_id` around the UPDATE would
-- have worked and taken one line. It is rejected deliberately. A function that
-- blanks the acting user to get past a security check is a function nobody can
-- grep for, and the next person to read the guard would have no way to discover
-- which callers slip through it. `app.crm_importing` is greppable, is
-- transaction-local, is set only inside a SECURITY DEFINER the application
-- cannot pass arguments around, and is named after what it means.
--
-- ⚠️ AND IT IS NARROW. The flag lets the import set an owner; it does not let
-- it set ANY owner. `crm_import_leads` still refuses a salesperson who asks to
-- share leads out to other people (check_violation, migration 274), so the only
-- owner a salesperson can reach through this door is themselves.
-- ============================================================================

create or replace function app.crm_guard_reassign()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
begin
  if new.owner_id is distinct from old.owner_id then
    /* The importer runs with no session and must pass — see 120's note. */
    if app.current_user_id() is not null
       and not app.crm_manages_project(new.project_id)
       /* Owner, 2026-09-25: the Executive hands out leads. This is the only
          write their role has, and it changes `owner_id` alone. */
       and app.current_user_role() is distinct from 'executive'::public.user_role
       /* ⚠️ 275 · A LIST BEING IMPORTED, BY THE PERSON KEEPING IT. Set only
          inside `app.crm_import_leads`, which has already checked that the
          caller may add leads to this project and refuses a salesperson who
          asks to share them with anybody else. Transaction-local, so it cannot
          outlive the import that set it. */
       and coalesce(current_setting('app.crm_importing', true), '') <> 'on' then
      raise exception
        'Only the manager of the department this project belongs to, an Executive, or an Admin, can hand out its leads.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $function$;

-- ── The import sets it, tightly ─────────────────────────────────────────────
-- ⚠️ SET AND CLEARED AROUND THE UPDATE ITSELF, not once around the loop. A flag
-- that stays on for the whole function is a flag that is on while
-- `crm_create_lead` runs, and that function fires a dozen other triggers whose
-- behaviour nobody has thought about in this state.
do $mig$
declare
  v_src text;
  v_new text;
  FIND  constant text :=
    '      update public.crm_leads set owner_id = v_owner where id = v_lead;';
  PUT   constant text :=
    '      perform set_config(''app.crm_importing'', ''on'', true);' || chr(10) ||
    '      update public.crm_leads set owner_id = v_owner where id = v_lead;' || chr(10) ||
    '      perform set_config(''app.crm_importing'', '''', true);';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'crm_import_leads';
  if v_src is null then
    raise exception 'app.crm_import_leads does not exist - run 274 first';
  end if;

  v_src := replace(v_src, chr(13), '');
  if position('crm_importing' in v_src) > 0 then
    raise notice '275 - crm_import_leads already sets the flag';
    return;
  end if;

  v_new := replace(v_src, FIND, PUT);
  if v_new = v_src then
    raise exception '275 - the owner UPDATE in crm_import_leads did not match; update FIND rather than skipping it';
  end if;
  execute v_new;
end $mig$;

-- ============================================================================
-- SELF-CHECK — AS cni_app, AS A SALESPERSON AND THEN AS SOMEBODY ELSE
-- ----------------------------------------------------------------------------
-- ⚠️ THE SECOND HALF IS THE POINT. Proving the import works is easy; proving it
-- did not open a door for everything else is the reason this file exists.
-- ============================================================================
do $$
declare
  v_project uuid;
  v_sales   uuid;
  v_other   uuid;
  v_out     jsonb;
  v_lead    uuid;
  v_owner   uuid;
  v_refused boolean := false;
  NUMBER    constant text := '+923000002751';
begin
  /* ⚠️ FROM THE PREVIEW ROSTER, NOT FROM THE DEPARTMENT. The CRM is still
     restricted (migration 143) and `crm_in_project_department` runs
     `crm_preview_allows()` before anything else — so the first salesperson in
     the department alphabetically is refused CRM02 and this check fails for a
     reason that has nothing to do with what it is testing. That is exactly what
     happened on the first run: "You cannot add leads to this project", about a
     person who is not in the preview at all. */
  select u.id into v_sales
    from public.crm_preview_members m
    join public.users u on u.id = m.user_id
   where u.is_active and u.department_role <> 'manager'
     and exists (select 1 from public.projects p
                  where p.lead_department_id = u.department_id)
   order by u.full_name limit 1;

  select p.id into v_project from public.projects p
    join public.users u on u.id = v_sales
   where p.lead_department_id = u.department_id
   limit 1;

  select u.id into v_other
    from public.crm_preview_members m
    join public.users u on u.id = m.user_id
    join public.projects p on p.id = v_project
   where u.is_active and u.department_role <> 'manager'
     and u.department_id = p.lead_department_id and u.id <> v_sales
   order by u.full_name limit 1;

  if v_sales is null or v_other is null or v_project is null then
    raise exception 'FEWER THAN TWO SALESPEOPLE IN THE CRM PREVIEW — this check cannot run, and a pass would mean nothing';
  end if;

  if exists (select 1 from public.crm_leads where phone_e164 = NUMBER) then
    raise exception 'THE 275 FIXTURE NUMBER IS ALREADY IN USE';
  end if;

  -- ── 1 · a salesperson imports and keeps it ───────────────────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  perform set_config('app.crm_quiet_insert', 'on', true);
  v_out := app.crm_import_leads(
    v_project,
    jsonb_build_array(jsonb_build_object(
      'fullName', '275 Kept', 'phone', NUMBER, 'phoneE164', NUMBER, 'source', 'import')),
    '{}'::uuid[], false);
  reset role;

  if (v_out->>'created')::int <> 1 then
    raise exception '275 · a salesperson could not import their own list: %', v_out;
  end if;

  select id, owner_id into v_lead, v_owner from public.crm_leads where phone_e164 = NUMBER;
  if v_owner is distinct from v_sales then
    raise exception '275 · the importer did not keep the lead — owner is %', v_owner;
  end if;

  -- ── 2 · ⚠️ AND THE DOOR IS STILL SHUT AFTERWARDS ─────────────────────────
  -- The same salesperson, the same transaction, trying an ordinary reassign.
  -- The flag is cleared inside the import, so this must still be refused.
  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    update public.crm_leads set owner_id = v_other where id = v_lead;
    reset role;
  exception
    when insufficient_privilege then
      v_refused := true;
      reset role;
  end;

  if not v_refused then
    raise exception '275 · THE FLAG LEAKED — a salesperson reassigned a lead to somebody else after an import';
  end if;

  -- ── 3 · and a salesperson still cannot share an import out ───────────────
  v_refused := false;
  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    perform app.crm_import_leads(
      v_project,
      jsonb_build_array(jsonb_build_object('fullName', '275 Shared', 'phone', '+923000002752')),
      array[v_other], false);
    reset role;
  exception
    when check_violation then
      v_refused := true;
      reset role;
  end;

  if not v_refused then
    raise exception '275 · a salesperson shared an import out to somebody else';
  end if;

  -- ── clean up ─────────────────────────────────────────────────────────────
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_lead_assignments where lead_id = v_lead;
  delete from public.crm_lead_notes where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;
  delete from public.crm_leads where phone_e164 = '+923000002752';
  if exists (select 1 from public.crm_leads where phone_e164 in (NUMBER, '+923000002752')) then
    raise exception 'THE 275 FIXTURE SURVIVED';
  end if;

  raise notice '275 self-check passed: a salesperson imports and keeps their own list, cannot reassign afterwards, and cannot share an import out';
exception
  when others then
    reset role;
    raise;
end $$;
