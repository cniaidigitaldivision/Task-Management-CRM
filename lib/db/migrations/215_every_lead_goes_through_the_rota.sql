-- ============================================================================
-- 215 · EVERY LEAD GOES THROUGH THE ROTA, WHEREVER IT CAME FROM
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"Why are you saying that when the leads arrive from any
-- campaign, leads are not assigned to someone? Why have we set criteria?
-- Whether a lead falls from any campaign, whether it is entered by hand, or
-- whether it is from Facebook, Instagram, or any platform, it should pass
-- through the assignment algorithm and be assigned to a salesperson."*
--
-- ── ⚠️ THEY ARE RIGHT, AND THIS WAS A GAP, NOT A DECISION ──────────────────
-- The rota exists (133, four signals) and the criteria exist. But asking
-- Postgres which functions actually use it:
--
--   crm_create_lead   → calls app.crm_lead_rota     (the "add a lead" form)
--   crm_record_leads  → NEVER TOUCHES owner_id      (the Meta importer)
--
-- So every lead that arrived from an ad landed unassigned, and that is why
-- **665 of 690 leads have no owner**. Nobody was responsible for them, the
-- neglect alerts had nobody to reach, and "my leads" was empty while the desk
-- filled up.
--
-- ── ⚠️ A TRIGGER, NOT A FIX TO THE IMPORTER ────────────────────────────────
-- Putting the call inside `crm_record_leads` would fix the Meta path and leave
-- the next one to be remembered — a webhook, a CSV, an agent creating a lead.
-- The owner's sentence is *"whether it falls from any campaign, by hand, or any
-- platform"*, and the only place that is true of is the table itself.
--
-- ⚠️ AND IT NEVER OVERWRITES AN OWNER SOMEBODY CHOSE. `crm_create_lead` assigns
-- before this sees the row, and a manager handing a lead out later must not be
-- undone by an import touching the same row.
-- ============================================================================

create or replace function app.crm_assign_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_top record;
begin
  /* Somebody already decided. Leave it alone. */
  if new.owner_id is not null then
    return null;
  end if;

  /* ⚠️ AN ARCHIVED LEAD IS NOT WORK. 214's backfill will archive the old ones,
     and handing them out on the way past would be the opposite of the point. */
  if new.archived_at is not null then
    return null;
  end if;

  select r.* into v_top from app.crm_lead_rota(new.project_id) r limit 1;

  if not found then
    /* ⚠️ UNASSIGNED IS A STATE, NOT A FAILURE — 158's own reasoning. A lead
       refused because the rota could not choose loses the enquiry, which is
       strictly worse than one a manager can see and hand out. */
    insert into public.crm_lead_assignments
      (lead_id, to_user_id, from_user_id, decided_by_id, rule, reason_text)
    values (new.id, null, null, null, 'rota',
            'Nobody was eligible on this project, so the lead was left unassigned.');
    return null;
  end if;

  update public.crm_leads set owner_id = v_top.user_id where id = new.id;

  /* ⚠️ THE SAME FIGURES AND THE SAME SENTENCE 158 WRITES for a lead typed
     in by hand. Two wordings of "why this person got it" would make the
     assignment history read as two different systems deciding.

     ⚠️ AND THE ACTIVITY ROW IS 116's TRIGGER'S, not written here — it fires on
     the owner_id change above and records who and when. A second one would put
     the same fact on the timeline twice. */
  insert into public.crm_lead_assignments
    (lead_id, to_user_id, from_user_id, decided_by_id, rule, reason, reason_text)
  values (
    new.id, v_top.user_id, null, null, 'rota',
    jsonb_build_object(
      'at_work',        v_top.at_work,
      'open_leads',     v_top.open_leads,
      'weighted_open',  v_top.weighted_load,
      'median_minutes', v_top.median_minutes,
      'days_quiet',     v_top.days_quiet,
      'last_given_at',  v_top.last_given_at,
      'arrived_by',     new.source::text),
    v_top.full_name || ' — '
      || case when v_top.at_work then 'at work' else 'off shift' end || ', '
      || v_top.weighted_load || ' weighted open, '
      || coalesce(round(v_top.median_minutes)::text || ' min median reply', 'no reply time yet'));

  return null;
end;
$fn$;

drop trigger if exists crm_leads_assign_on_arrival on public.crm_leads;
create trigger crm_leads_assign_on_arrival
  after insert on public.crm_leads
  for each row execute function app.crm_assign_new_lead();


-- ============================================================================
-- SELF-CHECK — an imported lead gets an owner; a chosen one is left alone
-- ============================================================================
do $chk$
declare
  v_project uuid; v_chosen uuid;
  v_auto uuid; v_manual uuid;
  o_auto uuid; o_manual uuid; n_note int;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_chosen
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_chosen is null then
    raise exception '215 · fixtures missing';
  end if;

  begin
    /* 1 · Arriving with no owner — the importer's shape. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, is_test_data)
    values (v_project, 'meta_lead_ad', 'SELFCHECK-215 imported', 'new', now(), true)
    returning id into v_auto;
    select owner_id into o_auto from public.crm_leads where id = v_auto;

    /* 2 · Arriving with an owner already chosen — must not be reassigned. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-215 chosen', 'new', now(), v_chosen, true)
    returning id into v_manual;
    select owner_id into o_manual from public.crm_leads where id = v_manual;

    select count(*)::int into n_note from public.crm_lead_assignments where lead_id = v_auto;

    raise exception using errcode = 'P0215', message = '215 rollback';
  exception when sqlstate 'P0215' then
    null;
  end;

  if o_auto is null then
    raise exception '215 · an imported lead was left unassigned — the whole point of this migration';
  end if;
  if o_manual is distinct from v_chosen then
    raise exception '215 · a lead somebody had already assigned was reassigned (% -> %)', v_chosen, o_manual;
  end if;
  if n_note < 1 then
    raise exception '215 · the assignment was not recorded, so nobody can say why';
  end if;

  raise notice '215 · every lead now passes through the rota, whatever brought it in';
end $chk$;
