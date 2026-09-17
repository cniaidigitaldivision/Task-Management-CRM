-- ============================================================================
-- 176 · QT-1042 v2 IS A NEW ROW — the owner's three-quotation ladder, working
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, with their own worked example: **2 lakh → 1.5 lakh → 1
-- lakh.** The client's budget picks which tier OPENS; tier 3 is the floor.
--
-- ⚠️ THE LADDER DID NOT EXIST. `crm_quotations` has carried `number`, `version`
-- and `supersedes_id` since 151 and **every quotation ever raised is version 1
-- with a brand new number** — measured today: 2 rows, 0 above v1, 0 supersede
-- chains. Raising a second price for the same client produced QT-1044, not
-- QT-1042 v2, so the history the owner is relying on was never being written.
--
-- ⚠️ AND THE UNIQUE PAIR THE DOCS PROMISED WAS NEVER THERE. 13-PROPERTY-AND-
-- QUOTATION-TESTPACK says *"number and version are separate columns with a
-- unique pair"*. There is no such constraint on the table. Added below — a
-- documented invariant nothing enforces is a documented hope.
--
-- ── ⚠️ WHY VERSIONING RATHER THAN EDITING, RESTATED ────────────────────────
-- *"A price that changes under a client is a dispute and the version history is
-- the whole defence."* That only holds if the old row survives, unaltered, with
-- the new one pointing at it. An UPDATE in place destroys the only evidence that
-- the first number was ever offered.
-- ============================================================================

-- 1 · ⚠️ ONE ROW PER NUMBER PER VERSION.
create unique index crm_quotations_number_version_idx
  on public.crm_quotations (number, version);

-- 2 · ⚠️ ONE LIVE VERSION PER NUMBER, and this is the invariant that matters.
--     Two live versions of QT-1042 means two prices are simultaneously on offer
--     and nobody can say which one the client is holding.
create unique index crm_quotations_one_live_per_number_idx
  on public.crm_quotations (number)
  where status in ('draft', 'pending_approval', 'approved', 'sent');

-- 3 · The chain must be a chain.
create or replace function app.crm_quotation_chain_is_sane()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  prev record;
begin
  if new.supersedes_id is null then
    /* A first version needs nothing to point at — but it must BE a first
       version. A v2 that supersedes nothing is an orphan claiming a history. */
    if new.version > 1 then
      raise exception using errcode = 'CRM10',
        message = 'A later version must say which quotation it replaces.',
        hint = 'Revise the existing quotation rather than creating a new version by hand.';
    end if;
    return new;
  end if;

  select id, number, version, lead_id into prev
    from public.crm_quotations where id = new.supersedes_id;

  if not found then
    raise exception using errcode = 'CRM10',
      message = 'The quotation it claims to replace does not exist.';
  end if;

  /* ⚠️ THE SAME NUMBER AND THE SAME LEAD. A chain that crossed either would put
     one client's price in another's history — and QT-1042 v2 would not be a
     revision of QT-1042 at all. */
  if prev.number is distinct from new.number or prev.lead_id is distinct from new.lead_id then
    raise exception using errcode = 'CRM10',
      message = 'A new version must keep the same quotation number and the same lead.',
      detail  = 'Replacing ' || prev.number || ' with ' || new.number;
  end if;

  if new.version <> prev.version + 1 then
    raise exception using errcode = 'CRM10',
      message = 'Versions run one after another.',
      detail  = 'Replacing version ' || prev.version || ' with version ' || new.version;
  end if;

  /* ⚠️ THE OLD ONE IS RETIRED HERE, not left to the caller. A write path that
     forgot would leave two live versions — which index 2 above would refuse, so
     the failure would surface as a baffling unique violation rather than as the
     thing that actually went wrong. Doing it in the same statement makes the
     invariant true by construction. */
  update public.crm_quotations
     set status = 'superseded', updated_at = now()
   where id = prev.id;

  return new;
end;
$fn$;

create trigger crm_quotations_chain_is_sane
  before insert on public.crm_quotations
  for each row execute function app.crm_quotation_chain_is_sane();


-- ════════════════════════════════════════════════════════════════════════════
-- WHICH RUNG COMES NEXT
-- ----------------------------------------------------------------------------
-- ⚠️ THE LADDER IS THE ITEM'S, NOT THE SALESPERSON'S. Tiers come from
-- `crm_properties` — base_price, price_mid, price_floor — so the next price is
-- a company decision already taken, and the salesperson is choosing WHEN to
-- move rather than HOW FAR.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_next_rung(p_quotation uuid)
returns table (tier integer, price numeric, is_floor boolean)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with q as (
    select qt.base_price, p.base_price as list, p.price_mid, p.price_floor
      from public.crm_quotations qt
      join public.crm_properties p on p.id = qt.property_id
     where qt.id = p_quotation
  )
  select 2, q.price_mid, false from q
   where q.price_mid is not null and q.base_price > q.price_mid
  union all
  select 3, q.price_floor, true from q
   where q.price_floor is not null
     and q.base_price > q.price_floor
     and (q.price_mid is null or q.base_price <= q.price_mid)
  order by 1
  limit 1
$$;

comment on function app.crm_next_rung(uuid) is
  'The next price down for this quotation''s item, and whether it is the floor. Empty when already at the floor — there is nowhere further to go.';

grant execute on function app.crm_next_rung(uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_item uuid; v_lead uuid;
  v1 uuid; v2 uuid; v3 uuid;
  refused boolean; v_status text; v_tier integer; v_price numeric; v_floor boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then raise exception '176 · no demo sales project'; end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '176 · nobody eligible'; end if;

  -- The owner's own worked example, to the rupee.
  insert into public.crm_properties
    (project_id, code, kind, catalogue_kind, base_price, price_mid, price_floor,
     scope_note, is_test_data, created_by_id)
  values (v_project, 'SELFCHECK-176', 'CRM implementation', 'service',
          200000, 150000, 100000, 'Setup and training.', true, v_sales)
  returning id into v_item;

  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, stage, is_test_data,
     submitted_at, property_id, budget_band, authority, purpose, timeline)
  values (v_project, v_sales, 'manual', 'SELFCHECK-176', '+920000000176', 'qualified',
          true, now(), v_item, 'svc_1l_to_3l', 'sole_decider', 'svc_crm', 'within_1_month')
  returning id into v_lead;

  -- v1 · 2 lakh, the list price.
  insert into public.crm_quotations
    (lead_id, property_id, project_id, number, version, base_price, premium_charges,
     requested_discount, net_amount, status, prepared_by_id, is_test_data)
  values (v_lead, v_item, v_project, 'QT-SELFCHECK-176', 1, 200000, 0, 0, 200000,
          'sent', v_sales, true)
  returning id into v1;

  -- 1 · ⚠️ THE NEXT RUNG IS THE COMPANY'S DECISION, already taken.
  select tier, price, is_floor into v_tier, v_price, v_floor
    from app.crm_next_rung(v1);
  if v_tier <> 2 or v_price <> 150000 or v_floor then
    raise exception '176 · next rung after list was tier % at % (floor %)', v_tier, v_price, v_floor;
  end if;

  -- 2 · v2 · 1.5 lakh. The old one retires BY CONSTRUCTION.
  insert into public.crm_quotations
    (lead_id, property_id, project_id, number, version, supersedes_id,
     base_price, premium_charges, requested_discount, net_amount, status,
     prepared_by_id, is_test_data)
  values (v_lead, v_item, v_project, 'QT-SELFCHECK-176', 2, v1, 150000, 0, 0, 150000,
          'sent', v_sales, true)
  returning id into v2;

  select status::text into v_status from public.crm_quotations where id = v1;
  if v_status <> 'superseded' then
    raise exception '176 · v1 is still % after v2 was raised', v_status;
  end if;

  -- 3 · And v3 lands on the floor, which reports itself as the last one.
  select tier, price, is_floor into v_tier, v_price, v_floor from app.crm_next_rung(v2);
  if v_tier <> 3 or v_price <> 100000 or not v_floor then
    raise exception '176 · next rung after the middle was tier % at % (floor %)', v_tier, v_price, v_floor;
  end if;

  insert into public.crm_quotations
    (lead_id, property_id, project_id, number, version, supersedes_id,
     base_price, premium_charges, requested_discount, net_amount, status,
     prepared_by_id, is_test_data)
  values (v_lead, v_item, v_project, 'QT-SELFCHECK-176', 3, v2, 100000, 0, 0, 100000,
          'sent', v_sales, true)
  returning id into v3;

  -- 4 · ⚠️ AND THERE IS NOWHERE FURTHER TO GO. The floor is the last quotation.
  if exists (select 1 from app.crm_next_rung(v3)) then
    raise exception '176 · a rung was offered below the floor';
  end if;

  -- 5 · ⚠️ ONE LIVE VERSION PER NUMBER. Two prices simultaneously on offer means
  --     nobody can say which one the client is holding.
  if (select count(*) from public.crm_quotations
       where number = 'QT-SELFCHECK-176'
         and status in ('draft','pending_approval','approved','sent')) <> 1 then
    raise exception '176 · more than one version of the same quotation is live';
  end if;

  -- 6 · A version that skips a number is refused.
  refused := false;
  begin
    insert into public.crm_quotations
      (lead_id, property_id, project_id, number, version, supersedes_id,
       base_price, premium_charges, requested_discount, net_amount, status,
       prepared_by_id, is_test_data)
    values (v_lead, v_item, v_project, 'QT-SELFCHECK-176', 9, v3, 100000, 0, 0, 100000,
            'draft', v_sales, true);
  exception when sqlstate 'CRM10' then refused := true;
  end;
  if not refused then raise exception '176 · a version skipped the sequence'; end if;

  -- 7 · ⚠️ AND A v2 THAT REPLACES NOTHING IS AN ORPHAN CLAIMING A HISTORY.
  refused := false;
  begin
    insert into public.crm_quotations
      (lead_id, property_id, project_id, number, version,
       base_price, premium_charges, requested_discount, net_amount, status,
       prepared_by_id, is_test_data)
    values (v_lead, v_item, v_project, 'QT-ORPHAN-176', 2, 100000, 0, 0, 100000,
            'draft', v_sales, true);
  exception when sqlstate 'CRM10' then refused := true;
  end;
  if not refused then raise exception '176 · an orphan version 2 was accepted'; end if;

  -- 8 · The whole history survives. That is the entire point of versioning.
  if (select count(*) from public.crm_quotations where number = 'QT-SELFCHECK-176') <> 3 then
    raise exception '176 · the version history did not survive';
  end if;

  delete from public.crm_quotations where number like 'QT-%SELFCHECK-176' or number = 'QT-ORPHAN-176';
  delete from public.crm_quotations where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;
  delete from public.crm_properties where id = v_item;

  raise notice '176 · 2 lakh to 1.5 to 1: each version retires the last by construction, the floor reports itself as the end of the ladder, only one version is ever live, and the whole history survives';
end $chk$;
