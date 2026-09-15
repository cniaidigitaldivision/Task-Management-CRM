-- ============================================================================
-- 166 · A SALESPERSON MAY SAY WHICH UNIT A LEAD IS ASKING ABOUT
-- ----------------------------------------------------------------------------
-- 150 added `crm_leads.property_id` and `crm_leads.budget`; neither was added to
-- 116's column grant, so both have been unwritable by the application since the
-- day they appeared. Measured before this migration:
--
--     cni_app may UPDATE: stage, temperature, lost_reason, next_action,
--                         next_action_at, owner_id, last_outcome,
--                         last_outcome_at, last_outcome_by_id, next_action_type
--
-- `app.crm_create_lead` sets both at creation and gets away with it because it
-- is SECURITY DEFINER — the same thing that hid the missing outcome grant for
-- three migrations (162). Anything running as the caller is refused.
--
-- ── ⚠️ WHY THESE TWO AND NOT THE REST ──────────────────────────────────────
-- 116's exclusions are deliberate and stay:
--   · full_name, phone, email, city, answers  — Meta's record of what a stranger
--                                               typed. Not a salesperson's to edit.
--   · submitted_at, first_contacted_at, closed_at — stamped by triggers, so the
--                                               response-time figures cannot be
--                                               doctored.
--   · project_id, form_id, campaign_id       — a lead's filing is not theirs.
--
-- `property_id` and `budget` are neither. They are what the salesperson LEARNT
-- on the call — *they want the corner plot, they have about eighty lakh* — and
-- recording that is the job. A price is still the company's: `crm_properties`
-- remains read-only to them (150), so they may point at a unit and may not
-- change what it costs.
-- ============================================================================

grant update (
  stage,
  temperature,
  lost_reason,
  next_action,
  next_action_at,
  owner_id,
  last_outcome,
  last_outcome_at,
  last_outcome_by_id,
  next_action_type,
  -- ── added by 150, and the reason this migration exists ──
  property_id,
  budget
) on public.crm_leads to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ THE APPLICATION'S OWN STATEMENT, AS A REAL SALESPERSON, WITH NO DEFINER.
-- Reading `information_schema` confirms a grant exists and proves nothing about
-- whether the statement runs — that is exactly how 162's gap survived.
-- ============================================================================
do $chk$
declare
  v_sales uuid; v_lead uuid; v_project uuid;
  v_unit uuid; v_foreign uuid; v_before uuid;
  bad boolean;
begin
  select l.id, l.owner_id, l.project_id, l.property_id
    into v_lead, v_sales, v_project, v_before
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null
   limit 1;

  if v_lead is null then
    raise notice '166 · no demo lead with an owner — grant applied, nothing to measure';
    return;
  end if;

  select id into v_unit from public.crm_properties where project_id = v_project limit 1;
  if v_unit is null then
    raise notice '166 · the demo project has no units — grant applied, nothing to measure';
    return;
  end if;

  -- 1 · ⚠️ THE WRITE THE APPLICATION MAKES, as the lead's owner.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads set property_id = v_unit where id = v_lead;
  reset role;

  if (select property_id from public.crm_leads where id = v_lead) is distinct from v_unit then
    raise exception '166 · attaching a unit did not take effect';
  end if;

  -- 2 · ⚠️ AND A UNIT FROM ANOTHER PROJECT IS STILL REFUSED. The grant makes the
  --     COLUMN writable; it must not make the wrong VALUE acceptable. The query
  --     layer carries that rule in its WHERE clause, so this checks the rule
  --     rather than the grant.
  insert into public.crm_properties (project_id, code, plot_number, kind, is_test_data)
  select p.id, 'SELFCHECK-166', 'SELFCHECK-166', 'Residential plot', true
    from public.projects p where p.id <> v_project limit 1
  returning id into v_foreign;

  if v_foreign is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    update public.crm_leads l
       set property_id = v_foreign
     where l.id = v_lead
       and exists (
         select 1 from public.crm_properties p
          where p.id = v_foreign and p.project_id = l.project_id
       );
    reset role;

    if (select property_id from public.crm_leads where id = v_lead) = v_foreign then
      delete from public.crm_properties where id = v_foreign;
      raise exception '166 · a unit from another project was attached';
    end if;
    delete from public.crm_properties where id = v_foreign;
  end if;

  -- 3 · ⚠️ AND WHAT 116 PROTECTED IS STILL PROTECTED. A grant written one column
  --     too wide would pass both checks above and quietly hand a salesperson the
  --     right to rewrite what a stranger typed into Meta's form.
  bad := false;
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  begin
    update public.crm_leads set full_name = 'Doctored' where id = v_lead;
    bad := true;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if bad then
    raise exception '166 · full_name became writable — the grant is too wide';
  end if;

  -- Put the lead back exactly as it was.
  update public.crm_leads set property_id = v_before where id = v_lead;

  raise notice '166 · a salesperson can attach a unit from their own project, cannot attach one from another, and still cannot edit the name';
end $chk$;
