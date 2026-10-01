-- ============================================================================
-- 274 · IMPORT A LIST OF LEADS
-- ----------------------------------------------------------------------------
-- Owner, 2026-10-01: *"one more thing I want right now is to import a CSV or
-- Excel file… My focus right now is to make sure to properly import and export
-- the leads."*
--
-- And the rule they set when we agreed the sequence:
--
--   > *"if a salesperson imports, all the leads are theirs. If a manager
--   > imports, they pick one or more salespeople and the leads are distributed
--   > among only those, by the existing algorithm."*
--
-- ── ⚠️ ONE CALL, NOT ONE CALL PER ROW ──────────────────────────────────────
-- A 500-row import driven from Node is 500 round trips. Inside `withUser` they
-- run in SERIES on one connection — that is what turned a 49-second write into
-- a 2.4-second one elsewhere in this schema — and from Karachi each trip is
-- ~101 ms, so the naive version costs the best part of a minute with a spinner
-- on it. The rows travel as one jsonb array and the loop runs server-side.
--
-- ── ⚠️ AND IT CREATES LEADS THROUGH `crm_create_lead`, NOT BY INSERTING ────
-- That function owns what a lead is: the name check (CRM03), the "some way to
-- reach them" check (CRM04), the duplicate rule (CRM05/CRM06), the demo flag,
-- the activity row. A second INSERT here would be a second opinion about all of
-- them, and the two would drift the first time one was amended.
--
-- What `crm_create_lead` does that an import must NOT is pick the owner from
-- the rota. So this teaches it the hold that migration 270 already invented for
-- exactly this reason — `app.crm_hold_assignment` — and assigns afterwards.
-- With the flag unset, which is every other caller, nothing changes.
-- ============================================================================

-- ── 1 · the hold, injected into the live function ───────────────────────────
-- ⚠️ INJECTED RATHER THAN RETYPED. Pasting a 9.8 KB function body into this file
-- to change four lines is how a migration silently reverts whatever was done to
-- it in between. The guard is spliced into the definition the database is
-- actually running, and the re-read below refuses to commit unless it took.
--
-- ⚠️ AND THE PATTERN ALLOWS \r. Function bodies come back from
-- `pg_get_functiondef` with CRLF line endings on this cluster; a pattern written
-- with bare \n matches nothing and the migration would "succeed" having changed
-- not one character.
do $mig$
declare
  v_src  text;
  v_new  text;
  FIND   constant text :=
    '  select r.* into v_top from app.crm_lead_rota(p_project) r limit 1;' || chr(10) ||
    '  select count(*) into v_considered from app.crm_eligible_owners(p_project);' || chr(10) ||
    '  select count(*) into v_eligible from app.crm_eligible_owners(p_project) where eligible;';
  PUT    constant text :=
    '  /* THE IMPORTER HOLDS THE ROTA BACK - migration 274, the same flag' || chr(10) ||
    '     migration 270 uses to stop a stranger being handed to a salesperson.' || chr(10) ||
    '     With the flag unset this runs exactly as it always has; with it on the' || chr(10) ||
    '     rota is never read, v_owner becomes null and the lead is created' || chr(10) ||
    '     UNOWNED - a state this function already supports and documents four' || chr(10) ||
    '     lines below. The caller then assigns it deliberately.' || chr(10) ||
    '' || chr(10) ||
    '     THE null SELECT IS NOT DECORATION. A plpgsql record that was never' || chr(10) ||
    '     assigned raises "record v_top is not assigned yet" the moment anything' || chr(10) ||
    '     reads a field off it, and the very next line does. Giving it one null' || chr(10) ||
    '     column is what lets the existing unowned branch below do its job. */' || chr(10) ||
    '  if coalesce(current_setting(''app.crm_hold_assignment'', true), '''') = ''on'' then' || chr(10) ||
    '    select null::uuid as user_id into v_top;' || chr(10) ||
    '  else' || chr(10) ||
    '    select r.* into v_top from app.crm_lead_rota(p_project) r limit 1;' || chr(10) ||
    '    select count(*) into v_considered from app.crm_eligible_owners(p_project);' || chr(10) ||
    '    select count(*) into v_eligible from app.crm_eligible_owners(p_project) where eligible;' || chr(10) ||
    '  end if;';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'crm_create_lead';
  if v_src is null then
    raise exception 'app.crm_create_lead does not exist - 274 cannot run';
  end if;

  if position('crm_hold_assignment' in v_src) > 0 then
    raise notice '274 - the hold is already in crm_create_lead, leaving it alone';
    return;
  end if;

  /* CARRIAGE RETURNS STRIPPED FIRST. Function bodies come back from
     pg_get_functiondef with CRLF line endings on this cluster, so a pattern
     written with plain newlines matches nothing and the migration "succeeds"
     having changed not one character. Stripping them is safe - they are
     whitespace inside a plpgsql body - and it is what makes a LITERAL replace
     possible at all. */
  v_src := replace(v_src, chr(13), '');

  /* replace(), NOT regexp_replace(). The pattern needed backslash escapes
     inside a dollar-quoted body inside a migration file, and every layer had
     its own opinion about them; the first attempt died on "syntax error at or
     near \". A literal match has no escapes to get wrong. */
  v_new := replace(v_src, FIND, PUT);

  if v_new = v_src then
    raise exception '274 - the rota block in crm_create_lead did not match. The function has changed: update FIND above rather than skipping it.';
  end if;

  execute v_new;
end $mig$;

-- ── 2 · whose turn it is, among the people the manager chose ────────────────
/**
 * ⚠️ THE ROTA'S OWN ORDER, NARROWED — not a second ordering.
 * `app.crm_lead_rota` decides by workload, then median reply time, then how
 * long somebody has waited; re-deriving any of that here would give the import
 * a different idea of "fairest" from every other assignment in the product.
 * This filters that list and takes the first survivor.
 *
 * ⚠️ NULL WHEN NONE OF THE CHOSEN ARE IN THE ROTA. The caller reports it rather
 * than falling back to the whole department: a manager who named three people
 * did not ask for a fourth.
 */
create or replace function app.crm_next_owner_among(p_project uuid, p_people uuid[])
returns uuid
language sql
stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
  select r.user_id
    from app.crm_lead_rota(p_project) r
   where r.user_id = any(coalesce(p_people, '{}'::uuid[]))
   limit 1
$function$;

revoke all on function app.crm_next_owner_among(uuid, uuid[]) from public;
grant execute on function app.crm_next_owner_among(uuid, uuid[]) to cni_app;

-- ── 3 · the import itself ───────────────────────────────────────────────────
/**
 * Write a list of leads, and decide who works each one.
 *
 * `p_owners` empty  → every lead goes to the caller. A salesperson importing
 *                     their own list keeps it, which is the owner's rule.
 * `p_owners` given  → shared between exactly those people by the rota, one at a
 *                     time so each choice sees the previous one's effect.
 *
 * ⚠️ THE ROTA IS READ PER LEAD, NOT PER BATCH. One read reused across two
 * hundred rows hands all two hundred to whoever happened to be lightest at the
 * start — `crmNextOwner`'s own note makes the same point about sharing out.
 *
 * Returns `{"created": n, "skipped": n, "assigned": {...}}` so the wizard can
 * say what happened rather than "done".
 */
create or replace function app.crm_import_leads(
  p_project     uuid,
  p_rows        jsonb,
  p_owners      uuid[] default '{}'::uuid[],
  p_mark_test   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_actor    uuid := app.current_user_id();
  v_row      jsonb;
  v_lead     uuid;
  v_owner    uuid;
  v_created  int := 0;
  v_skipped  int := 0;
  v_nobody   int := 0;
  v_by_owner jsonb := '{}'::jsonb;
  v_share    boolean := coalesce(array_length(p_owners, 1), 0) > 0;
begin
  if v_actor is null then
    raise exception 'No acting user' using errcode = 'CRM00';
  end if;

  /* ⚠️ THE SAME GATE `crm_create_lead` USES, ASKED ONCE. Every row would raise
     CRM02 anyway; asking here turns 400 identical refusals into one sentence. */
  if not app.crm_in_project_department(p_project)
     and not app.crm_manages_project(p_project) then
    raise exception 'You cannot add leads to this project' using errcode = 'CRM02';
  end if;

  /* ⚠️ ONLY A MANAGER MAY HAND LEADS TO OTHER PEOPLE. A salesperson importing a
     list gets it themselves — that is the owner's rule and also migration 120's
     trigger, which would refuse the write anyway. Saying so here means the
     refusal names the reason instead of arriving as a constraint violation on
     row 227. */
  if v_share
     and not app.crm_manages_project(p_project)
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only a manager can share imported leads out to other people'
      using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    /* ⚠️ THE HOLD, SO THE ROTA DOES NOT CHOOSE FOR US. Set inside the loop
       because `crm_create_lead` is a definer with its own `search_path`, and a
       transaction-local setting survives it — but clarity beats cleverness in a
       loop that decides who gets paid. */
    perform set_config('app.crm_hold_assignment', 'on', true);

    begin
      v_lead := app.crm_create_lead(
        p_project,
        nullif(btrim(coalesce(v_row->>'fullName', '')), ''),
        nullif(btrim(coalesce(v_row->>'phone', '')), ''),
        nullif(btrim(coalesce(v_row->>'phoneE164', '')), ''),
        nullif(btrim(coalesce(v_row->>'email', '')), ''),
        nullif(btrim(coalesce(v_row->>'city', '')), ''),
        coalesce(nullif(v_row->>'source', ''), 'import')::public.crm_lead_source,
        nullif(btrim(coalesce(v_row->>'sourceDetail', '')), ''),
        nullif(btrim(coalesce(v_row->>'enquiry', '')), ''),
        null::uuid,
        nullif(v_row->>'budget', '')::bigint,
        false, null, null, null, null, null,
        false
      );
    exception
      /* ⚠️ A DUPLICATE IS SKIPPED, NOT A FAILURE. CRM05 and CRM06 both mean "we
         already know this person"; the wizard counted them at validate time and
         the reader chose to skip them. Letting either abort the whole import
         would lose 499 good rows to one repeat. */
      when sqlstate 'CRM05' or sqlstate 'CRM06' then
        v_skipped := v_skipped + 1;
        perform set_config('app.crm_hold_assignment', '', true);
        continue;
    end;

    perform set_config('app.crm_hold_assignment', '', true);
    v_created := v_created + 1;

    if p_mark_test then
      update public.crm_leads set is_test_data = true where id = v_lead;
    end if;

    /* ── Who works it ───────────────────────────────────────────────────── */
    if v_share then
      v_owner := app.crm_next_owner_among(p_project, p_owners);
    else
      v_owner := v_actor;
    end if;

    if v_owner is null then
      /* ⚠️ LEFT UNOWNED AND COUNTED, NOT GUESSED AT. Every person the manager
         chose is outside this project's rota — on leave, or no longer in the
         department. Handing the lead to somebody they did not choose would be
         worse than leaving it in the queue they can see. */
      v_nobody := v_nobody + 1;
    else
      update public.crm_leads set owner_id = v_owner where id = v_lead;
      /* ⚠️ rule = 'import', WHICH THE ENUM ALREADY HAS. Filing these as 'rota'
         would be true about the algorithm and false about the event, and the
         assignment log is the thing somebody reads when they want to know why
         they got a lead. */
      insert into public.crm_lead_assignments
        (lead_id, to_user_id, decided_by_id, rule, reason, reason_text)
      values (v_lead, v_owner, v_actor, 'import'::public.crm_assignment_rule,
              jsonb_build_object('shared_between', coalesce(array_length(p_owners, 1), 0)),
              case when v_share
                then 'Shared out when a list was imported, between the people chosen at the time.'
                else 'Kept by whoever imported the list.' end);
      insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome)
      values (v_lead, v_actor, 'assigned',
              (select full_name from public.users where id = v_owner));
      v_by_owner := jsonb_set(
        v_by_owner, array[v_owner::text],
        to_jsonb(coalesce((v_by_owner->>v_owner::text)::int, 0) + 1), true);
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'unassigned', v_nobody,
    'byOwner', v_by_owner
  );
end $function$;

revoke all on function app.crm_import_leads(uuid, jsonb, uuid[], boolean) from public;
grant execute on function app.crm_import_leads(uuid, jsonb, uuid[], boolean) to cni_app;

-- ============================================================================
-- SELF-CHECK — AS cni_app, ON ITS OWN ROWS
-- ----------------------------------------------------------------------------
-- ⚠️ AS cni_app BECAUSE 271 HAPPENED: a definer's EXECUTE grant is invisible to
-- any check that runs as the migration owner, which is how a button shipped
-- that could never be pressed.
-- ============================================================================
do $$
declare
  v_manager uuid;
  v_project uuid;
  v_sales   uuid[];
  v_out     jsonb;
  v_ids     uuid[];
  v_unowned int;
  v_before  int;
  NUMBERS   constant text[] := array['+923000002741', '+923000002742', '+923000002743'];
begin
  select u.id into v_manager
    from public.users u
   where u.is_active and u.department_role = 'manager'
     and exists (select 1 from public.projects p where p.lead_department_id = u.department_id)
   limit 1;
  if v_manager is null then
    raise exception 'NO DEPARTMENT MANAGER — this check cannot run, and a pass would mean nothing';
  end if;

  select p.id into v_project from public.projects p
    join public.users u on u.id = v_manager
   where p.lead_department_id = u.department_id limit 1;

  select array_agg(u.id) into v_sales
    from public.users u
    join public.projects p on p.id = v_project
   where u.department_id = p.lead_department_id and u.is_active
     and u.department_role <> 'manager';
  if coalesce(array_length(v_sales, 1), 0) < 2 then
    raise exception 'FEWER THAN TWO SALESPEOPLE — the sharing half of this check cannot run';
  end if;

  select count(*) into v_before from public.crm_leads where phone_e164 = any(NUMBERS);
  if v_before <> 0 then
    raise exception 'THE 274 FIXTURE NUMBERS ARE ALREADY IN USE — refusing to touch live rows';
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_manager::text, true);
  perform set_config('app.crm_quiet_insert', 'on', true);

  v_out := app.crm_import_leads(
    v_project,
    jsonb_build_array(
      jsonb_build_object('fullName', '274 One', 'phone', NUMBERS[1], 'phoneE164', NUMBERS[1], 'source', 'import'),
      jsonb_build_object('fullName', '274 Two', 'phone', NUMBERS[2], 'phoneE164', NUMBERS[2], 'source', 'import'),
      jsonb_build_object('fullName', '274 Three', 'phone', NUMBERS[3], 'phoneE164', NUMBERS[3], 'source', 'import')
    ),
    v_sales[1:2],
    false
  );
  reset role;

  if (v_out->>'created')::int <> 3 then
    raise exception '274 · expected 3 created, got %', v_out->>'created';
  end if;

  select array_agg(id) into v_ids from public.crm_leads where phone_e164 = any(NUMBERS);

  /* ⚠️ EVERY LEAD WENT TO SOMEBODY THE MANAGER CHOSE — the whole point. */
  if exists (select 1 from public.crm_leads
              where id = any(v_ids)
                and (owner_id is null or not (owner_id = any(v_sales[1:2])))) then
    raise exception '274 · a lead went to somebody outside the chosen list, or to nobody';
  end if;

  /* ⚠️ AND THEY WERE SHARED, NOT ALL DUMPED ON ONE PERSON. Three leads across
     two people cannot be 3–0 under a rota that re-reads load each time. */
  if (select count(distinct owner_id) from public.crm_leads where id = any(v_ids)) < 2 then
    raise exception '274 · all three leads went to one person; the rota is not re-reading load';
  end if;

  /* ── a repeat is skipped, not fatal ─────────────────────────────────── */
  set local role cni_app;
  v_out := app.crm_import_leads(
    v_project,
    jsonb_build_array(
      jsonb_build_object('fullName', '274 One', 'phone', NUMBERS[1], 'phoneE164', NUMBERS[1]),
      jsonb_build_object('fullName', '274 Four', 'phone', '+923000002744', 'phoneE164', '+923000002744')
    ),
    v_sales[1:1], false);
  reset role;

  if (v_out->>'skipped')::int <> 1 or (v_out->>'created')::int <> 1 then
    raise exception '274 · a repeat should skip one and create one; got skipped=% created=%',
      v_out->>'skipped', v_out->>'created';
  end if;

  /* ── and with nobody named, the importer keeps them ─────────────────── */
  set local role cni_app;
  v_out := app.crm_import_leads(
    v_project,
    jsonb_build_array(jsonb_build_object('fullName', '274 Five', 'phone', '+923000002745', 'phoneE164', '+923000002745')),
    '{}'::uuid[], false);
  reset role;

  if (select owner_id from public.crm_leads where phone_e164 = '+923000002745') <> v_manager then
    raise exception '274 · with no owners named the lead must go to whoever imported it';
  end if;

  /* ── ⚠️ AND THE HOLD DID NOT LEAK. An ordinary lead created afterwards must
     still be given to the rota, or 274 has broken every other caller. ────── */
  set local role cni_app;
  perform app.crm_create_lead(
    v_project, '274 Ordinary', '+923000002746', '+923000002746', null, null,
    'manual'::public.crm_lead_source, null, null, null, null,
    false, null, null, null, null, null, false);
  reset role;
  select count(*) into v_unowned from public.crm_leads
   where phone_e164 = '+923000002746' and owner_id is null;
  if v_unowned <> 0 then
    raise exception '274 · THE HOLD LEAKED — an ordinary lead was created unowned';
  end if;

  -- ── clean up, by number ──────────────────────────────────────────────────
  select array_agg(id) into v_ids from public.crm_leads
   where phone_e164 = any(NUMBERS || array['+923000002744', '+923000002745', '+923000002746']);
  delete from public.crm_lead_activity where lead_id = any(v_ids);
  delete from public.crm_lead_assignments where lead_id = any(v_ids);
  delete from public.crm_lead_notes where lead_id = any(v_ids);
  delete from public.crm_leads where id = any(v_ids);
  if exists (select 1 from public.crm_leads
              where phone_e164 = any(NUMBERS || array['+923000002744', '+923000002745', '+923000002746'])) then
    raise exception 'THE 274 FIXTURE SURVIVED';
  end if;

  raise notice '274 self-check passed: as cni_app — a manager shares an import between chosen people only, repeats skip, a salesperson keeps their own list, and the hold does not leak into ordinary lead creation';
exception
  when others then
    reset role;
    raise;
end $$;
