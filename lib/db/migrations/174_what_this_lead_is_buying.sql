-- ============================================================================
-- 174 · WHICH QUESTIONS TO ASK — decided per lead, from the campaign it came in on
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"The system should be smart enough. It should know which
-- question to display at the time according to the campaign, according to the
-- user. For example if it's ERP enquiries, it is definitely clear that it's an AI
-- services lead, so show questions accordingly."*
--
-- ── ⚠️ THE CAMPAIGN, NOT ONLY THE PROJECT — and the demo data proves why ───
-- Measured today, every lead on **one** project:
--
--     ERP enquiry [demo]      · Adnan, Ayesha, Bilal, Faisal, Hina, Kamran, …
--     CRM enquiry [demo]      · Junaid
--     Taskly enquiry [demo]   · Imran, Kiran, Mehwish
--
-- All three are AI & Digital services and they share a project with two PLOTS.
-- A project-level answer alone would have been wrong for every one of them, so
-- the form carries the answer and the project is only the fallback.
--
-- ⚠️ AND THE ATTACHED ITEM OUTRANKS BOTH. If a salesperson has attached a 5
-- Marla plot to a lead, they are discussing a plot, whatever form it arrived on.
-- The most specific fact wins, which is also what surfaced the fixture bug below.
-- ============================================================================

create type public.crm_sells as enum ('property', 'service', 'mixed');

alter table public.crm_project_settings
  add column sells public.crm_sells not null default 'property';

/* ⚠️ ON THE FORM TOO, AND NULLABLE. A project runs several campaigns and they do
   not have to sell the same thing — "ERP enquiry" and a plot campaign can both
   belong to one business. NULL means "whatever the project sells", so nobody has
   to answer this for every form before anything works. */
alter table public.crm_lead_forms
  add column sells public.crm_sells;

comment on column public.crm_project_settings.sells is
  'What this project sells by default. Overridden per campaign by crm_lead_forms.sells, and per lead by an attached catalogue item.';
comment on column public.crm_lead_forms.sells is
  'What THIS campaign sells. NULL = inherit the project. The owner''s "according to the campaign".';

-- ── The backfill, from evidence rather than guesswork ──────────────────────
-- ⚠️ MATCHED ON THE FORM'S OWN NAME, because that is the only evidence that
-- exists. A form called "ERP enquiry" is a service campaign; one called "plot"
-- or "Royal Homes" is not. Anything that matches neither is left NULL and
-- inherits — silence is the honest answer where the name says nothing.
update public.crm_lead_forms
   set sells = 'service'
 where sells is null
   and (name ilike '%erp%' or name ilike '%crm%' or name ilike '%taskly%'
        or name ilike '%automation%' or name ilike '%software%'
        or name ilike '%marketing%' or name ilike '%website%');

/* The demo project is where every service campaign lives, so it defaults to
   services; it still holds two plots, which is exactly what `mixed` is for. */
update public.crm_project_settings s
   set sells = 'mixed'
  from public.projects p
 where p.id = s.project_id and p.name like '%[demo]';


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS THIS LEAD BUYING?
-- ----------------------------------------------------------------------------
-- ⚠️ ONE FUNCTION, because the drawer, the quotation form, the reports and
-- eventually the agent all need the same answer. Four places deciding for
-- themselves is four places that disagree by the second month.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_lead_sells(p_lead uuid)
returns public.crm_sells
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(
    /* 1 · What they are actually discussing. The most specific fact wins. */
    (select case when pr.catalogue_kind = 'service' then 'service' else 'property' end
       from public.crm_leads l
       join public.crm_properties pr on pr.id = l.property_id
      where l.id = p_lead)::public.crm_sells,
    /* 2 · The campaign it arrived on — the owner's own rule. */
    (select f.sells from public.crm_leads l
       join public.crm_lead_forms f on f.id = l.form_id
      where l.id = p_lead and f.sells is not null),
    /* 3 · What the project sells by default. */
    (select s.sells from public.crm_leads l
       join public.crm_project_settings s on s.project_id = l.project_id
      where l.id = p_lead),
    'property'::public.crm_sells
  )
$$;

comment on function app.crm_lead_sells(uuid) is
  'Which qualifying questions this lead needs: attached item, then campaign, then project. Never guesses from the lead itself.';

grant execute on function app.crm_lead_sells(uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_form uuid; v_lead uuid; v_plot uuid;
  v_answer text; refused boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then
    raise exception '174 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '174 · nobody eligible'; end if;

  -- 1 · ⚠️ THE REAL CASE THE OWNER REPORTED. A lead on an ERP form must ask
  --     service questions, even though its project also sells plots.
  select f.id into v_form from public.crm_lead_forms f
   where f.project_id = v_project and f.name ilike '%erp%' limit 1;
  if v_form is null then
    raise exception '174 · no ERP form on the demo project — the reported case cannot be proved';
  end if;
  if (select sells from public.crm_lead_forms where id = v_form) is distinct from 'service' then
    raise exception '174 · the ERP campaign was not recognised as selling services';
  end if;

  insert into public.crm_leads
    (project_id, form_id, owner_id, source, full_name, phone, stage, is_test_data, submitted_at)
  values (v_project, v_form, v_sales, 'manual', 'SELFCHECK-174', '+920000000174',
          'contacted', true, now())
  returning id into v_lead;

  v_answer := app.crm_lead_sells(v_lead)::text;
  if v_answer <> 'service' then
    delete from public.crm_leads where id = v_lead;
    raise exception '174 · an ERP lead asks % questions rather than service ones', v_answer;
  end if;

  -- 2 · ⚠️ AN ATTACHED PLOT OUTRANKS THE CAMPAIGN. Whatever form they came in
  --     on, if a salesperson has put a 5 Marla plot against them, they are
  --     discussing a plot.
  select id into v_plot from public.crm_properties
   where project_id = v_project and catalogue_kind in ('plot', 'unit') limit 1;
  if v_plot is not null then
    update public.crm_leads set property_id = v_plot where id = v_lead;
    v_answer := app.crm_lead_sells(v_lead)::text;
    if v_answer <> 'property' then
      delete from public.crm_leads where id = v_lead;
      raise exception '174 · a lead with a plot attached asks % questions', v_answer;
    end if;
    update public.crm_leads set property_id = null where id = v_lead;
  end if;

  -- 3 · ⚠️ THE SERVICE VALUES ADDED BY 173 CAN ACTUALLY BE WRITTEN, by a real
  --     salesperson, through the application's own grant. 166 exists because a
  --     column was added and never granted; the same trap applies to a value
  --     nobody has ever stored.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads
     set budget_band = 'svc_1l_to_3l', purpose = 'svc_erp',
         authority = 'sole_decider', timeline = 'within_1_month'
   where id = v_lead;
  reset role;

  if (select budget_band::text from public.crm_leads where id = v_lead) <> 'svc_1l_to_3l' then
    delete from public.crm_leads where id = v_lead;
    raise exception '174 · a salesperson could not record a service budget band';
  end if;

  -- 4 · And the gate from 167 still holds on the service values.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads set stage = 'qualified' where id = v_lead;
  reset role;
  if (select stage::text from public.crm_leads where id = v_lead) <> 'qualified' then
    delete from public.crm_leads where id = v_lead;
    raise exception '174 · a fully qualified SERVICE lead was refused by the gate';
  end if;

  -- 5 · A lead on a form that says nothing falls back to the project.
  update public.crm_leads set form_id = null where id = v_lead;
  v_answer := app.crm_lead_sells(v_lead)::text;
  if v_answer <> 'mixed' then
    delete from public.crm_leads where id = v_lead;
    raise exception '174 · the project fallback gave % rather than the demo project''s mixed', v_answer;
  end if;

  delete from public.crm_leads where id = v_lead;

  raise notice '174 · an ERP lead asks service questions, an attached plot outranks its campaign, a salesperson can record the service values, the gate still holds, and a silent form falls back to the project';
end $chk$;
