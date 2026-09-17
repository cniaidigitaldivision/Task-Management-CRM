-- ============================================================================
-- 167 · QUALIFICATION — BANT, AND THE GATE IN FRONT OF `qualified`
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-16: *"I want to properly implement a BANT tester… when I want
-- to convert my status from contacted to qualified, I should know all these
-- things first."*
--
-- Until now `qualified` was a badge. There were no qualification fields at all
-- and `budget` — added by 150, made writable only by 166 — was the nearest
-- thing. Measured the day this was written: **0 of 641 real leads carried one.**
-- So a lead reached `qualified` because somebody clicked it, and every figure
-- computed from that stage meant nothing.
--
-- ── ⚠️ QUALIFICATION IS A GATE, NOT A WAYPOINT ─────────────────────────────
-- It sits third in the funnel — new · contacted · QUALIFIED · … — because its
-- whole job is to decide whether to spend money on somebody. A site visit is the
-- most expensive thing a salesperson does; qualifying after it means paying for
-- it first. The lost reasons already assume this: `budget_too_low`,
-- `wrong_location`, `not_serious`, `wants_what_we_dont_offer` are every one of
-- them a qualification failure, and they are only cheap to discover early.
--
-- ── ⚠️ THE GATE REQUIRES AN ANSWER RECORDED, NOT AN ANSWER GIVEN ───────────
-- Every enum here carries a "not disclosed" or "unknown" value on purpose. A
-- client who will not say their budget is a fact about the lead, not a reason to
-- block the salesperson — so the gate can always be satisfied honestly. What it
-- refuses is reaching `qualified` having never ASKED. The suggestion engine then
-- reads four unknowns and proposes `cold`, which is the correct answer.
--
-- ── ⚠️ AND IT GRANDFATHERS EVERYTHING THAT ALREADY EXISTS ──────────────────
-- The gate fires only on the transition OUT of `new`/`contacted`. Demo leads
-- already sitting at `quotation_sent` and `won` have no BANT and must keep
-- moving; a CHECK constraint would have frozen every one of them on the spot.
-- ============================================================================

-- ── The four BANT axes, plus the two this market actually needs ────────────
-- ⚠️ CREATE TYPE, never ALTER TYPE … ADD VALUE. A label added to an existing
-- enum cannot be USED in the transaction that adds it — 157 exists solely
-- because of that rule. A newly created type has no such restriction, which is
-- why the self-check at the foot of this file can cast to these.

create type public.crm_budget_band as enum (
  'under_2m', '2m_to_4m', '4m_to_6m', '6m_to_10m', 'over_10m', 'not_disclosed'
);

create type public.crm_authority as enum (
  -- ⚠️ THE ONE THAT SAVES THE MOST DEALS. In property the decision is a family:
  -- the person who filled the Meta form is often not the buyer. Asking at
  -- qualification kills the "I need to discuss with my brother" stall that
  -- otherwise surfaces at negotiation, where it is most expensive.
  'sole_decider', 'shares_decision', 'not_the_decider', 'unknown'
);

create type public.crm_purpose as enum (
  -- Need. An investor and somebody building a house to live in are two
  -- different conversations, two different plots and two different objections.
  'investment', 'build_to_live', 'build_to_rent', 'resale', 'business_use', 'other', 'unknown'
);

create type public.crm_timeline as enum (
  'within_1_month', '1_to_3_months', '3_to_6_months', '6_to_12_months',
  'just_exploring', 'unknown'
);

create type public.crm_payment_mode as enum (
  -- ⚠️ NOT PART OF CLASSIC BANT, AND IT BELONGS HERE ANYWAY. In Pakistani
  -- property, cash versus instalments changes which units are even offerable and
  -- what the payment plan looks like. It is not gated — it is an extra the
  -- salesperson records when it comes up.
  'full_cash', 'instalments', 'mixed', 'unknown'
);

alter table public.crm_leads
  add column budget_band       public.crm_budget_band,
  add column authority         public.crm_authority,
  add column purpose           public.crm_purpose,
  add column timeline          public.crm_timeline,
  add column payment_mode      public.crm_payment_mode,
  -- Which block or scheme they want. Free text: a preference is what they said,
  -- not a value we can enumerate before hearing it.
  add column location_preference text,
  -- ⚠️ THE OBJECTION, IN THEIR OWN WORDS. The nine lost reasons are for
  -- reporting; this is what lets a manager coach and a campaign be retargeted.
  add column qualification_note  text,
  -- Stamped by the trigger below, never by the application — the same reason
  -- 116 keeps `first_contacted_at` out of the grant: a response-time figure the
  -- measured party can edit is not a measurement.
  add column qualified_at        timestamptz,
  add column qualified_by_id     uuid references public.users(id) on delete set null;

comment on column public.crm_leads.budget_band is
  'BANT · Budget. `not_disclosed` means asked and refused, which is information. NULL means never asked.';
comment on column public.crm_leads.authority is
  'BANT · Authority. Who actually decides — in property this is usually a family, not the form-filler.';
comment on column public.crm_leads.purpose is
  'BANT · Need. Investment vs building to live changes the whole conversation.';
comment on column public.crm_leads.timeline is
  'BANT · Timeline. The single strongest predictor of temperature.';

create index crm_leads_qualified_at_idx on public.crm_leads (qualified_at desc)
  where qualified_at is not null;

-- ============================================================================
-- THE GATE
-- ----------------------------------------------------------------------------
-- ⚠️ A TRIGGER, NOT A CHECK CONSTRAINT, and the difference is the 641 rows that
-- already exist. A CHECK is evaluated against every row on every write, so any
-- lead already past `contacted` without BANT would become unwritable — a
-- migration that silently freezes the demo data it was tested against.
--
-- ⚠️ AND IT GUARDS THE WHOLE RANGE, NOT JUST `qualified`. Gating only the one
-- stage would leave `contacted → quotation_sent` open, and a gate somebody can
-- walk around by picking the next option in the dropdown is decoration.
-- ============================================================================

create or replace function app.crm_require_qualification()
returns trigger
language plpgsql
as $fn$
declare
  -- ⚠️ `lost` IS DELIBERATELY ABSENT. A lead can be lost from any stage without
  -- ever being qualified — indeed `budget_too_low` is a loss that happens
  -- BECAUSE you qualified it. Requiring BANT to record a loss would mean the
  -- leads you disqualify fastest are the ones hardest to close.
  qualified_and_beyond constant public.crm_stage[] := array[
    'qualified', 'proposal_pending', 'quotation_sent',
    'visit_scheduled', 'visited', 'negotiation', 'won'
  ]::public.crm_stage[];

  before_qualification constant public.crm_stage[] := array[
    'new', 'contacted', 'follow_up', 'scheduled'
  ]::public.crm_stage[];

  entering boolean;
begin
  entering :=
    new.stage = any (qualified_and_beyond)
    and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
    and (tg_op = 'INSERT' or old.stage = any (before_qualification));

  if not entering then
    return new;
  end if;

  if new.budget_band is null
     or new.authority is null
     or new.purpose is null
     or new.timeline is null
  then
    -- ⚠️ THE MESSAGE NAMES WHAT IS MISSING. "Qualification incomplete" sends
    -- somebody hunting through a form; naming the field is the difference
    -- between a rule and an obstruction.
    raise exception
      using errcode = 'CRM08',
            message = 'This lead has not been qualified yet.',
            detail  = concat_ws(', ',
              case when new.budget_band is null then 'budget' end,
              case when new.authority   is null then 'who decides' end,
              case when new.purpose     is null then 'what they want it for' end,
              case when new.timeline    is null then 'when they intend to buy' end
            ),
            hint    = 'Record the qualifying answers first. "Not disclosed" is a valid answer — never asking is not.';
  end if;

  -- First crossing only. Re-entering `qualified` after a bounce back to
  -- `contacted` keeps the original date: when this lead became real is one fact,
  -- not the most recent time somebody pressed a dropdown.
  if new.qualified_at is null then
    new.qualified_at := now();
    new.qualified_by_id := app.current_user_id();
  end if;

  return new;
end;
$fn$;

create trigger crm_leads_require_qualification
  before insert or update of stage on public.crm_leads
  for each row execute function app.crm_require_qualification();

-- ============================================================================
-- THE GRANT — ⚠️ THE PART 166 EXISTS BECAUSE SOMEBODY FORGOT
-- ----------------------------------------------------------------------------
-- 150 added two columns and never added them to 116's column grant, so both were
-- unwritable by the application for sixteen migrations while `app.crm_create_lead`
-- hid it by being SECURITY DEFINER. These eight columns are exactly what the
-- salesperson LEARNT on the call, so they are theirs to write.
--
-- ⚠️ `qualified_at` AND `qualified_by_id` ARE NOT IN THIS LIST. The trigger
-- stamps them. A salesperson who could backdate their own qualification could
-- rewrite how long it took them — the same reasoning that keeps
-- `first_contacted_at` out of 116.
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
  property_id,
  budget,
  -- ── added by this migration ──
  budget_band,
  authority,
  purpose,
  timeline,
  payment_mode,
  location_preference,
  qualification_note
) on public.crm_leads to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUN AS A REAL SALESPERSON, WITH A SESSION, NO DEFINER. Reading
-- `information_schema` proves a grant exists and says nothing about whether the
-- statement runs — which is exactly how 162's and 166's gaps survived.
--
-- ⚠️ AND IT CREATES ITS OWN FIXTURE RATHER THAN HOPING TO FIND ONE. A check
-- that looks for a lead it may not find prints a tick for a rule it never ran.
-- ============================================================================
do $chk$
declare
  v_sales uuid; v_project uuid; v_lead uuid; v_old uuid;
  v_stage public.crm_stage; v_when timestamptz; v_by uuid;
  refused boolean;
begin
  select p.id into v_project
    from public.projects p
    join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]'
   limit 1;
  if v_project is null then
    raise exception '167 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e
   where e.eligible
   limit 1;
  if v_sales is null then
    raise exception '167 · nobody eligible on %, so the gate cannot be proved as a salesperson', v_project;
  end if;

  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, stage, is_test_data, submitted_at)
  values
    (v_project, v_sales, 'manual', 'SELFCHECK-167', '+920000000167', 'contacted', true, now())
  returning id into v_lead;

  -- 1 · ⚠️ THE GATE HOLDS, AS THE SALESPERSON, WITH NO BANT RECORDED.
  refused := false;
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  begin
    update public.crm_leads set stage = 'qualified' where id = v_lead;
  exception when sqlstate 'CRM08' then refused := true;
  end;
  reset role;
  if not refused then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · a lead reached `qualified` with no qualifying answers';
  end if;

  -- 2 · ⚠️ AND IT CANNOT BE WALKED AROUND by skipping to a later stage.
  refused := false;
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  begin
    update public.crm_leads set stage = 'quotation_sent' where id = v_lead;
  exception when sqlstate 'CRM08' then refused := true;
  end;
  reset role;
  if not refused then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · the gate was bypassed by jumping past `qualified`';
  end if;

  -- 3 · ⚠️ LOSING IT NEEDS NO QUALIFICATION. Requiring BANT to record a loss
  --     would make the leads you disqualify fastest the hardest to close off.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads
     set stage = 'lost', lost_reason = 'not_serious'
   where id = v_lead;
  reset role;
  if (select stage from public.crm_leads where id = v_lead) <> 'lost' then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · a lead could not be lost without being qualified first';
  end if;
  update public.crm_leads set stage = 'contacted', lost_reason = null where id = v_lead;

  -- 4 · ⚠️ THE SALESPERSON CAN ACTUALLY WRITE THE ANSWERS. This is the 166
  --     check: the gate is worthless if the only way through it is refused by a
  --     missing column grant, and that failure looks identical to the gate.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads
     set budget_band         = '4m_to_6m',
         authority           = 'sole_decider',
         purpose             = 'build_to_live',
         timeline            = 'within_1_month',
         payment_mode        = 'instalments',
         location_preference = 'Block A',
         qualification_note  = 'Wants a corner plot near the park.'
   where id = v_lead;
  reset role;

  select budget_band is not null into refused from public.crm_leads where id = v_lead;
  if not refused then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · a salesperson could not write the qualifying answers — the column grant is missing';
  end if;

  -- 5 · NOW THE GATE OPENS, and stamps who and when.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads set stage = 'qualified' where id = v_lead;
  reset role;

  select stage, qualified_at, qualified_by_id
    into v_stage, v_when, v_by
    from public.crm_leads where id = v_lead;

  if v_stage <> 'qualified' then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · the gate refused a fully qualified lead';
  end if;
  if v_when is null or v_by is distinct from v_sales then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · qualified_at/by were not stamped (% / %)', v_when, v_by;
  end if;

  -- 6 · ⚠️ A SALESPERSON MAY NOT BACKDATE THEIR OWN QUALIFICATION. The stamp is
  --     a measurement of them; leaving it writable would make it an opinion.
  refused := false;
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  begin
    update public.crm_leads set qualified_at = now() - interval '30 days' where id = v_lead;
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  if not refused then
    delete from public.crm_leads where id = v_lead;
    raise exception '167 · qualified_at is writable — the grant is too wide';
  end if;

  -- 7 · ⚠️ EXISTING LEADS ARE GRANDFATHERED. A lead already past the gate with
  --     no BANT must keep moving, or this migration freezes the demo data.
  v_old := null;
  select id into v_old from public.crm_leads
   where stage in ('quotation_sent', 'visit_scheduled', 'visited', 'negotiation')
     and budget_band is null and id <> v_lead
   limit 1;
  if v_old is not null then
    select stage into v_stage from public.crm_leads where id = v_old;
    update public.crm_leads set stage = 'negotiation' where id = v_old;
    if (select stage from public.crm_leads where id = v_old) <> 'negotiation' then
      raise exception '167 · an existing unqualified lead was frozen by the gate';
    end if;
    update public.crm_leads set stage = v_stage where id = v_old;
  end if;

  delete from public.crm_leads where id = v_lead;

  raise notice '167 · the gate refuses an unqualified lead, cannot be jumped, still allows a loss, lets the salesperson record the answers, stamps who qualified it, refuses backdating, and leaves existing leads moving';
end $chk$;
