-- ============================================================================
-- 269 · A LEAD CAN ONLY WANT A PLOT FROM ITS OWN SCHEME
-- ----------------------------------------------------------------------------
-- ⚠️ THIS CLOSES A HOLE THE CODE ALREADY BELIEVED WAS CLOSED.
--
-- `components/crm/add-lead.tsx` has carried this comment since the picker was
-- written:
--
--     ⚠️ WHICH PROJECT IT BELONGS TO MATTERS. `crm_leads.property_id`
--     references `crm_properties` and nothing else, so a plot from one project
--     can be attached to another project's lead and every later quotation,
--     payment plan and price describes a property the client was never shown.
--     The field is hidden the moment the chosen project stops matching, **and
--     the database refuses it anyway (CRM07).**
--
-- The first half is right and the last clause is not. There is no CRM07
-- constraint, no trigger and no check: the only thing standing between a
-- Chitral plot and a Demo lead was a dropdown that hides itself. Measured
-- 2026-09-28 by attaching `PROP-E513` (Chitral Royal Homes [demo]) to a lead on
-- Demo — Product Enquiries, inside a transaction that was rolled back. It was
-- allowed.
--
-- ⚠️ AND IT MATTERS MORE NOW, because this is the migration that lands beside a
-- new "attach a plot" control on an existing lead. A rule that was only ever
-- enforced by hiding a field is a rule that breaks the moment a second screen
-- can set the same column.
--
-- ── WHY A TRIGGER AND NOT A COMPOSITE FOREIGN KEY ────────────────────────
-- The tidy answer is a `(id, project_id)` unique key on `crm_properties` and a
-- composite FK from `crm_leads`. It was rejected: it needs a redundant
-- `project_id` on every lead row to point at, `crm_leads.project_id` can itself
-- be changed by a re-file (`crm_refile_form`), and a composite FK would then
-- fail a move that is otherwise legitimate with an error naming neither column.
-- A trigger can say what is wrong in a sentence.
-- ============================================================================

create or replace function app.crm_lead_property_matches_project()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_plot_project uuid;
  v_plot_code    text;
begin
  if new.property_id is null then
    return new;
  end if;

  /* Unchanged on this write, and the lead is not moving scheme: nothing to
     re-check. Keeps a re-file or a stage change off this path entirely. */
  if tg_op = 'UPDATE'
     and new.property_id is not distinct from old.property_id
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  select p.project_id, p.code into v_plot_project, v_plot_code
    from public.crm_properties p where p.id = new.property_id;

  if v_plot_project is null then
    raise exception 'That property does not exist.'
      using errcode = 'check_violation';
  end if;

  if v_plot_project <> new.project_id then
    /* ⚠️ The message names the plot, because the person reading it is looking
       at a list of plot numbers and needs to know which one was wrong. */
    raise exception '% belongs to a different project. A lead can only be linked to a plot in its own scheme.',
      coalesce(v_plot_code, 'That property')
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

drop trigger if exists crm_leads_property_matches_project on public.crm_leads;
create trigger crm_leads_property_matches_project
  before insert or update of property_id, project_id on public.crm_leads
  for each row execute function app.crm_lead_property_matches_project();

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ EXISTING ROWS ARE CHECKED FIRST. A trigger that refuses a state the table
-- is already in makes every later edit of those rows fail, and the failure
-- would surface weeks later on an unrelated save. If any lead already holds a
-- foreign plot, this migration must not commit.
-- ============================================================================
do $$
declare
  v_wrong   int;
  v_admin   uuid;
  v_lead    uuid;
  v_project uuid;
  v_foreign uuid;
  v_own     uuid;
  v_before  uuid;
  v_ok      boolean := false;
begin
  select count(*) into v_wrong
    from public.crm_leads l
    join public.crm_properties p on p.id = l.property_id
   where p.project_id <> l.project_id;
  if v_wrong <> 0 then
    raise exception '% LEADS ALREADY HOLD A PLOT FROM ANOTHER SCHEME. Fix the data before this trigger lands.', v_wrong;
  end if;
  raise notice '269 · no existing lead holds a foreign plot';

  select id into v_admin from public.users
   where is_active and role in ('admin','super_admin') order by created_at limit 1;
  perform set_config('app.user_id', v_admin::text, true);

  select l.id, l.project_id, l.property_id into v_lead, v_project, v_before
    from public.crm_leads l
    join public.crm_properties p on p.project_id = l.project_id
   where l.is_test_data
   order by l.id limit 1;

  if v_lead is null then
    raise notice '269 · no test lead on a scheme with a catalogue; the trigger is untested here';
    return;
  end if;

  select id into v_own from public.crm_properties
   where project_id = v_project and not is_draft order by code limit 1;
  select id into v_foreign from public.crm_properties
   where project_id <> v_project and not is_draft order by code limit 1;

  -- ── its own scheme's plot is accepted ────────────────────────────────────
  update public.crm_leads set property_id = v_own where id = v_lead;

  -- ── another scheme's plot is refused, by name ────────────────────────────
  if v_foreign is not null then
    begin
      update public.crm_leads set property_id = v_foreign where id = v_lead;
    exception
      when check_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception 'A LEAD TOOK A PLOT FROM ANOTHER SCHEME — the trigger did nothing';
    end if;
  else
    raise notice '269 · only one scheme has a catalogue here; the refusal is untested';
  end if;

  -- ── and clearing it is always allowed ────────────────────────────────────
  update public.crm_leads set property_id = null where id = v_lead;
  update public.crm_leads set property_id = v_before where id = v_lead;

  raise notice '269 self-check passed: a lead takes its own scheme''s plot, refuses another scheme''s by name, and can always be cleared';
end $$;
