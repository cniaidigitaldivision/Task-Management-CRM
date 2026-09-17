-- ============================================================================
-- 177 · THE SAME SERVICE COSTS DIFFERENT MONEY IN A DIFFERENT CAMPAIGN
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"For the same CRM I am running a campaign for the US…
-- their campaigns will be different and their charges will be different. One
-- campaign could take the CRM quotation for Pakistan, which is different for the
-- same project. The quotation for the USA and foreign countries would be
-- different."*
--
-- ── ⚠️ ONE ITEM WITH SEVERAL LADDERS, NOT SEVERAL ITEMS ────────────────────
-- The obvious shortcut is a second catalogue row — "CRM (Pakistan)" and "CRM
-- (USA)". It is wrong for a reason that only shows up months later: the same
-- service would exist twice, so every count of what the division sells, every
-- conversion rate and every "which product wins" report would double-count it,
-- and nobody would be able to answer *how many CRM deals did we close* without
-- knowing to add two rows together.
--
-- ── ⚠️ KEYED ON THE CAMPAIGN, WHICH IS THE FORM ────────────────────────────
-- `crm_campaigns` is still EMPTY — 0 rows, and has been since 111. The thing
-- that actually identifies a campaign in this database is the LEAD FORM: 127
-- files a lead by its form, 174 asks the form what it sells, and the demo
-- project's three campaigns are three forms. So the ladder hangs off the form,
-- and a NULL form is the item's default.
--
-- ── ⚠️ AND A PRICE IN DOLLARS IS NOT A PRICE IN RUPEES ─────────────────────
-- A USA ladder with no currency would print $2,000 as "PKR 2,000". The currency
-- travels with the ladder and is copied onto the quotation, because a quotation
-- is a statement made on a date and must not re-read anything afterwards.
-- ============================================================================

-- ── The demo link the owner will share with a client ───────────────────────
-- Owner: *"I will put a demo at some URL and you will share that URL with the
-- client. For CRM a separate URL, for ERP a separate URL, for WhatsApp
-- optimization a separate URL."*
alter table public.crm_properties
  add column demo_url text;

comment on column public.crm_properties.demo_url is
  'A live demo a salesperson can send. Per item, because CRM, ERP and the WhatsApp automation are three different demos.';

alter table public.crm_properties
  add constraint crm_properties_demo_url_is_a_url check (
    demo_url is null or demo_url ~ '^https?://'
  );

grant update (demo_url) on public.crm_properties to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE PER-CAMPAIGN LADDER
-- ════════════════════════════════════════════════════════════════════════════

create table public.crm_item_prices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.crm_properties(id) on delete cascade,

  /* NULL = this item's default ladder. A row with a form is that campaign's. */
  form_id uuid references public.crm_lead_forms(id) on delete cascade,

  /* A label a human reads on the screen — "Pakistan", "USA & overseas". */
  market_label text not null,

  /* ⚠️ ISO, AND NOT AN ENUM. The division sells into markets it has not met
     yet; an enum would need a migration the first time somebody quotes in AED. */
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),

  price_list  numeric(14,2) not null check (price_list > 0),
  price_mid   numeric(14,2),
  price_floor numeric(14,2),

  is_test_data boolean not null default false,
  created_by_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* ⚠️ THE SAME RULE AS 171: the ladder must descend. A floor above the list is
     a typo otherwise found by a client quoted MORE for pushing back. */
  constraint crm_item_prices_ladder_descends check (
    (price_mid is null or price_mid <= price_list)
    and (price_floor is null or price_mid is null or price_floor <= price_mid)
    and (price_floor is null or price_floor <= price_list)
  )
);

/* ⚠️ TWO INDEXES, BECAUSE NULLS DO NOT COLLIDE IN A UNIQUE INDEX. A plain
   `unique (item_id, form_id)` would happily accept five default ladders for one
   item, since NULL is never equal to NULL — and the resolver would then pick one
   at random. This is the standard trap and it is silent. */
create unique index crm_item_prices_per_campaign_idx
  on public.crm_item_prices (item_id, form_id) where form_id is not null;
create unique index crm_item_prices_default_idx
  on public.crm_item_prices (item_id) where form_id is null;

alter table public.crm_item_prices enable row level security;

/* Read by anyone who may use the desk — a salesperson must see the price they
   are quoting. Written by whoever manages the project's department, the same
   rule 150 applies to the catalogue: a price is the company's, not the
   seller's. */
create policy crm_item_prices_select on public.crm_item_prices
  for select using (app.crm_is_open_to_caller());

grant select on public.crm_item_prices to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- WHICH LADDER APPLIES
-- ----------------------------------------------------------------------------
-- ⚠️ ONE RESOLVER, because the quotation form, the floor trigger, the email and
-- eventually the agent all need the same answer. Three places deciding for
-- themselves is three places that disagree about what a client was quoted.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_item_ladder(p_item uuid, p_form uuid)
returns table (currency text, price_list numeric, price_mid numeric,
               price_floor numeric, market_label text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  /* 1 · This campaign's own ladder. */
  select p.currency, p.price_list, p.price_mid, p.price_floor, p.market_label
    from public.crm_item_prices p
   where p.item_id = p_item and p.form_id = p_form and p_form is not null
  union all
  /* 2 · The item's default ladder. */
  select p.currency, p.price_list, p.price_mid, p.price_floor, p.market_label
    from public.crm_item_prices p
   where p.item_id = p_item and p.form_id is null
     and not exists (
       select 1 from public.crm_item_prices q
        where q.item_id = p_item and q.form_id = p_form and p_form is not null
     )
  union all
  /* 3 · ⚠️ THE ITEM'S OWN COLUMNS, which is where every existing price lives.
     171 put the ladder on `crm_properties` and this migration does not move it —
     a table with per-campaign overrides and a fallback is additive; migrating
     two live rows to prove a point is not. */
  select 'PKR', i.base_price, i.price_mid, i.price_floor, 'Default'
    from public.crm_properties i
   where i.id = p_item
     and not exists (select 1 from public.crm_item_prices p where p.item_id = p_item)
  limit 1
$$;

comment on function app.crm_item_ladder(uuid, uuid) is
  'The prices that apply to this item for this campaign: the campaign''s own ladder, else the item''s default, else the columns on crm_properties.';

grant execute on function app.crm_item_ladder(uuid, uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE QUOTATION REMEMBERS ITS CURRENCY
-- ----------------------------------------------------------------------------
-- ⚠️ COPIED, NEVER LOOKED UP AGAIN. A quotation is a statement made on a date.
-- If it read the currency back from the ladder, changing a market's currency
-- would silently restate every quotation ever issued into it.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_quotations
  add column currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$');

grant insert (currency) on public.crm_quotations to cni_app;
grant update (currency) on public.crm_quotations to cni_app;


-- ⚠️ AND THE FLOOR TRIGGER NOW ASKS THE RESOLVER. 171 read `crm_properties`
-- directly, so a USA quotation would have been held to the Pakistan floor —
-- which, on a dollar ladder, is not a floor at all.
create or replace function app.crm_quotation_respects_floor()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_floor numeric(14,2);
  v_cur   text;
  v_code  text;
  v_form  uuid;
begin
  if new.property_id is null then
    return new;
  end if;

  select l.form_id into v_form from public.crm_leads l where l.id = new.lead_id;
  select price_floor, currency into v_floor, v_cur
    from app.crm_item_ladder(new.property_id, v_form);
  select code into v_code from public.crm_properties where id = new.property_id;

  /* No floor set is not a licence to go to zero — it means nobody has decided
     yet, and the readiness report is already asking them to. */
  if v_floor is null then
    return new;
  end if;

  if new.net_amount < v_floor then
    raise exception
      using errcode = 'CRM09',
            message = 'That is below the floor price for this item.',
            detail  = coalesce(v_code, 'This item') || ' may not be sold below '
                      || coalesce(v_cur, 'PKR') || ' ' || to_char(v_floor, 'FM999,999,999'),
            hint    = 'The floor is the last quotation. Below it, the answer is a smaller item or a lost lead.';
  end if;

  return new;
end;
$fn$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_item uuid; v_form_pk uuid; v_form_us uuid;
  v_lead_pk uuid; v_lead_us uuid;
  v_cur text; v_list numeric; v_floor numeric; v_market text;
  refused boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then raise exception '177 · no demo sales project'; end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '177 · nobody eligible'; end if;

  select id into v_form_pk from public.crm_lead_forms
   where project_id = v_project and name ilike '%crm%' limit 1;
  if v_form_pk is null then
    raise exception '177 · no CRM campaign on the demo project — the owner''s own example cannot be proved';
  end if;

  /* ⚠️ `page_id` IS NOT NULL — copied from the campaign this one shadows rather
     than invented. A form belongs to a Meta page, and a fixture that made one up
     would be testing a row the importer could never produce. */
  insert into public.crm_lead_forms (project_id, page_id, meta_form_id, name, sells)
  select f.project_id, f.page_id, 'SELFCHECK-177-US', 'CRM enquiry — USA [demo]', 'service'
    from public.crm_lead_forms f where f.id = v_form_pk
  returning id into v_form_us;

  insert into public.crm_properties
    (project_id, code, kind, catalogue_kind, base_price, price_mid, price_floor,
     scope_note, demo_url, is_test_data, created_by_id)
  values (v_project, 'SELFCHECK-177', 'CRM implementation', 'service',
          200000, 150000, 100000, 'Setup and training.',
          'https://demo.example.invalid/crm', true, v_sales)
  returning id into v_item;

  -- 1 · ⚠️ A DEMO URL MUST BE A URL. "ask Sarah for the link" in this field is
  --     a link a salesperson would send to a client.
  refused := false;
  begin
    update public.crm_properties set demo_url = 'ask Sarah' where id = v_item;
  exception when check_violation then refused := true;
  end;
  if not refused then
    delete from public.crm_properties where id = v_item;
    delete from public.crm_lead_forms where id = v_form_us;
    raise exception '177 · a non-URL was accepted as a demo link';
  end if;

  -- 2 · With no override, the item's own columns answer — nothing moved.
  select currency, price_list, price_floor, market_label
    into v_cur, v_list, v_floor, v_market
    from app.crm_item_ladder(v_item, v_form_pk);
  if v_cur <> 'PKR' or v_list <> 200000 or v_floor <> 100000 then
    raise exception '177 · the fallback ladder gave % % / %', v_cur, v_list, v_floor;
  end if;

  -- 3 · ⚠️ THE OWNER'S OWN CASE. The USA campaign is dearer AND in dollars.
  insert into public.crm_item_prices
    (item_id, form_id, market_label, currency, price_list, price_mid, price_floor,
     is_test_data, created_by_id)
  values (v_item, v_form_us, 'USA & overseas', 'USD', 4000, 3000, 2000, true, v_sales);

  select currency, price_list, price_floor, market_label
    into v_cur, v_list, v_floor, v_market
    from app.crm_item_ladder(v_item, v_form_us);
  if v_cur <> 'USD' or v_list <> 4000 or v_floor <> 2000 or v_market <> 'USA & overseas' then
    raise exception '177 · the USA ladder gave % % / % (%)', v_cur, v_list, v_floor, v_market;
  end if;

  -- 4 · ⚠️ AND THE PAKISTAN CAMPAIGN IS UNTOUCHED BY IT. One item, two ladders.
  select currency, price_list into v_cur, v_list
    from app.crm_item_ladder(v_item, v_form_pk);
  if v_cur <> 'PKR' or v_list <> 200000 then
    raise exception '177 · the USA ladder leaked into the Pakistan campaign (% %)', v_cur, v_list;
  end if;

  -- 5 · ⚠️ ONE DEFAULT LADDER PER ITEM. NULLs do not collide in a unique index,
  --     so without the partial index this accepts any number of them.
  insert into public.crm_item_prices
    (item_id, form_id, market_label, currency, price_list, price_mid, price_floor,
     is_test_data, created_by_id)
  values (v_item, null, 'Default', 'PKR', 180000, 140000, 90000, true, v_sales);

  refused := false;
  begin
    insert into public.crm_item_prices
      (item_id, form_id, market_label, currency, price_list, is_test_data, created_by_id)
    values (v_item, null, 'A second default', 'PKR', 999, true, v_sales);
  exception when unique_violation then refused := true;
  end;
  if not refused then
    raise exception '177 · an item was allowed two default ladders';
  end if;

  -- 6 · ⚠️ THE FLOOR TRIGGER NOW USES THE CAMPAIGN'S FLOOR. A USA lead at
  --     USD 1,500 is below the USD 2,000 floor and must be refused — under 171
  --     it would have been compared with the PKR floor and sailed through.
  insert into public.crm_leads
    (project_id, form_id, owner_id, source, full_name, phone, stage, is_test_data,
     submitted_at, property_id, budget_band, authority, purpose, timeline)
  values (v_project, v_form_us, v_sales, 'manual', 'SELFCHECK-177-US', '+920000000177',
          'qualified', true, now(), v_item, 'svc_3l_to_5l', 'sole_decider', 'svc_crm',
          'within_1_month')
  returning id into v_lead_us;

  refused := false;
  begin
    insert into public.crm_quotations
      (lead_id, property_id, project_id, number, version, currency, base_price,
       premium_charges, requested_discount, net_amount, status, prepared_by_id, is_test_data)
    values (v_lead_us, v_item, v_project, 'QT-SELFCHECK-177', 1, 'USD', 4000, 0, 2500,
            1500, 'draft', v_sales, true);
  exception when sqlstate 'CRM09' then refused := true;
  end;
  if not refused then
    raise exception '177 · a USA quotation below the USD floor was accepted';
  end if;

  -- 7 · And at the USD floor it goes through, carrying its own currency.
  insert into public.crm_quotations
    (lead_id, property_id, project_id, number, version, currency, base_price,
     premium_charges, requested_discount, net_amount, status, prepared_by_id, is_test_data)
  values (v_lead_us, v_item, v_project, 'QT-SELFCHECK-177', 1, 'USD', 4000, 0, 2000,
          2000, 'draft', v_sales, true);

  if (select currency from public.crm_quotations where number = 'QT-SELFCHECK-177') <> 'USD' then
    raise exception '177 · the quotation did not keep its own currency';
  end if;

  -- 8 · ⚠️ A SALESPERSON MAY READ THE LADDER THEY ARE QUOTING FROM. A price they
  --     cannot see is one they will ask a colleague for and get wrong.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  if not exists (select 1 from public.crm_item_prices where item_id = v_item) then
    reset role;
    raise exception '177 · a salesperson cannot read the prices they must quote';
  end if;
  reset role;

  delete from public.crm_quotations where number = 'QT-SELFCHECK-177';
  delete from public.crm_leads where id = v_lead_us;
  delete from public.crm_item_prices where item_id = v_item;
  delete from public.crm_properties where id = v_item;
  delete from public.crm_lead_forms where id = v_form_us;

  raise notice '177 · one item carries a Pakistan ladder and a USA ladder in dollars, neither leaks into the other, a second default is refused, and the floor trigger now holds a USA quotation to the USA floor';
end $chk$;
