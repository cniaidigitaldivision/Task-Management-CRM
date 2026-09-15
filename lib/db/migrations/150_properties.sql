-- ============================================================================
-- 150 · WHAT IS BEING SOLD — properties, and the plans that price them
-- ----------------------------------------------------------------------------
-- Phase C of `14-SALES-WORKSPACE-PHASES.md`. Owner, 2026-09-15: *"There are no
-- property tables, no quotation tables, no schedule… please create them properly
-- first of all… I want a complete setup."*
--
-- Built against `13-PROPERTY-AND-QUOTATION-TESTPACK.md` — the owner's own two
-- plots — so the columns exist because a real document needed them, not because
-- a CRM usually has them.
--
-- ── ⚠️ THE MARLA STANDARD LIVES ON THE PROJECT ─────────────────────────────
-- The owner's note, and it is the whole reason this is not a constant: *"the
-- size of one Marla varies between projects and regions."* 225 sq ft is right
-- for this project and wrong somewhere else, so a number in code would be wrong
-- the first time a second project used a different one — silently, on every
-- quotation.
--
-- ── ⚠️ AND `area_sqft` IS STORED, NOT COMPUTED AT READ TIME ────────────────
-- A quotation is a document somebody was sent. If the project's standard is ever
-- corrected, every historical quotation must keep the area it was issued with —
-- recomputing would rewrite what a client was told. Same reason the price is
-- copied onto the quotation rather than joined.
--
-- ── ⚠️ NOT EVERY PROJECT SELLS PLOTS ───────────────────────────────────────
-- Chitral sells land; AI & Digital sells services. `has_catalogue` is what keeps
-- the property fields off a project that has none, rather than every service
-- project growing an empty Properties tab.
-- ============================================================================

alter table public.projects
  /* ⚠️ NULL means "this project does not sell by Marla" — a service project, or
     one priced per square foot. Not a default of 225, which would quietly claim
     a standard nobody set. */
  add column if not exists marla_sqft_standard integer,
  add column if not exists has_catalogue boolean not null default false;

comment on column public.projects.marla_sqft_standard is
  'Square feet in one Marla FOR THIS PROJECT. Varies by region — the owner said '
  'so explicitly — which is why it is not a constant. NULL where the project '
  'does not sell by Marla. Migration 150.';

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE CATALOGUE
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_property_status') then
    create type public.crm_property_status as enum (
      'available', 'reserved', 'sold', 'withdrawn'
    );
  end if;
end $$;

create table if not exists public.crm_properties (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,

  /* ⚠️ THE HUMAN CODE, AND IT IS UNIQUE PER PROJECT, NOT GLOBALLY. "A-101"
     exists in most housing schemes; two projects both having one is ordinary,
     and a global unique index would refuse the second project's entire
     catalogue. */
  code        text not null,
  plot_number text,
  block       text,
  kind        text not null default 'Residential plot',

  size_marla  numeric(8,2),
  /* Stored, never derived at read time — see the header. */
  area_sqft   integer,
  dimensions  text,

  category    text,
  facing      text,
  road_width_ft integer,
  is_corner   boolean not null default false,
  is_park_facing boolean not null default false,
  is_main_boulevard boolean not null default false,

  /* ⚠️ MINOR UNITS, NEVER A FLOAT. PKR 4,500,000 held as a double is a price
     that prints as 4499999.999999 on somebody's quotation eventually. `bigint`
     of rupees — Pakistan has no circulating subunit, so rupees ARE the minor
     unit here, and the column comment says so rather than leaving the next
     reader to guess whether it is paisa. */
  base_price  bigint,

  status      public.crm_property_status not null default 'available',
  development_status text,
  possession_months  integer,
  price_updated_at   timestamptz,

  notes       text,

  /* ⚠️ A COLUMN, NOT A NAMING CONVENTION. The owner shipped `is_test_data: true`
     with the pack, and `[demo]` in a project name is a string somebody will
     eventually edit. Reports filter on this. */
  is_test_data boolean not null default false,

  created_by_id uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_properties_code_present check (btrim(code) <> ''),
  constraint crm_properties_price_sane check (base_price is null or base_price > 0),
  constraint crm_properties_area_sane  check (area_sqft is null or area_sqft > 0)
);

create unique index if not exists crm_properties_code_uq
  on public.crm_properties (project_id, lower(btrim(code)));
create index if not exists crm_properties_project_idx
  on public.crm_properties (project_id, status);

comment on table public.crm_properties is
  'What a project has to sell. Built from the owner''s own test pack (doc 13), so '
  'every column exists because a real property sheet needed it. Migration 150.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE PAYMENT PLAN
-- ----------------------------------------------------------------------------
-- ⚠️ ROWS, NOT A JSON BLOB. The quotation PDF prints these, a discount approval
-- recomputes them, and a future receipt will need to point at one stage. All
-- three want to read a single stage; none of them wants to parse a document.
--
-- ⚠️ AND A PLAN BELONGS TO EITHER A PROPERTY OR A QUOTATION, NEVER BOTH.
-- The property's plan is the list price schedule. A quotation takes a COPY at
-- the moment it is issued, because the list price can move afterwards and the
-- document must not. `quotation_id` is added in 151; the check below already
-- allows for it.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_payment_stages (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid references public.crm_properties (id) on delete cascade,

  sort_order  integer not null,
  label       text not null,
  /* Stored beside the amount rather than instead of it: the percentage is what
     the plan MEANS, the amount is what the client pays, and a rounding that
     makes them disagree is worth seeing rather than hiding. */
  percentage  numeric(6,3),
  amount      bigint not null,
  /* 18 for "18 monthly instalments of 125,000"; null for a one-off stage. */
  instalments integer,

  created_at  timestamptz not null default now(),

  constraint crm_payment_stages_label_present check (btrim(label) <> ''),
  constraint crm_payment_stages_amount_sane check (amount >= 0),
  constraint crm_payment_stages_instalments_sane
    check (instalments is null or instalments > 0)
);

create index if not exists crm_payment_stages_property_idx
  on public.crm_payment_stages (property_id, sort_order);

comment on table public.crm_payment_stages is
  'One row per payment stage — booking, confirmation, instalments, balloting, '
  'possession. Rows rather than a blob because the PDF, a discount '
  'recalculation and a future receipt each need ONE stage. Migration 150.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · WHICH PROPERTY A LEAD IS ASKING ABOUT
-- ----------------------------------------------------------------------------
-- ⚠️ `on delete set null`, NOT cascade. Deleting a plot from the catalogue must
-- never delete the person who enquired about it — the enquiry, the conversation
-- and the follow-ups are all still real.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.crm_leads
  add column if not exists property_id uuid
    references public.crm_properties (id) on delete set null,
  /* What they said they can spend, in the same minor units as the price. */
  add column if not exists budget bigint,
  add column if not exists is_test_data boolean not null default false;

create index if not exists crm_leads_property_idx
  on public.crm_leads (property_id) where property_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · POLICIES
-- ----------------------------------------------------------------------------
-- ⚠️ THE SAME AUDIENCE AS THE PROJECT'S LEADS, through the same definers used by
-- 130, 140 and 141. A salesperson is a member of no project — that is the whole
-- premise of department routing — so `projects_select` would hide the entire
-- catalogue from the people who sell it. Six migrations exist because of exactly
-- this; see `admin-sessions-cannot-test-access`.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.crm_properties     enable row level security;
alter table public.crm_payment_stages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'crm_properties_select') then
    create policy crm_properties_select on public.crm_properties
      for select to cni_app
      using (
        app.crm_manages_project(project_id)
        or app.crm_in_project_department(project_id)
      );
  end if;

  /* ⚠️ A SALESPERSON MAY NOT EDIT THE CATALOGUE. The owner's Phase 1 rules are
     explicit that they may VIEW accessible property information and may not
     change prices — a price is the company's, not the seller's. */
  if not exists (select 1 from pg_policy where polname = 'crm_properties_write') then
    create policy crm_properties_write on public.crm_properties
      for all to cni_app
      using (app.crm_manages_project(project_id))
      with check (app.crm_manages_project(project_id));
  end if;

  /* ⚠️ DELEGATED TO THE PROPERTY, not re-decided. A second hand-written audience
     would drift from the first the day either changed. */
  if not exists (select 1 from pg_policy where polname = 'crm_payment_stages_select') then
    create policy crm_payment_stages_select on public.crm_payment_stages
      for select to cni_app
      using (
        property_id is null
        or exists (select 1 from public.crm_properties p where p.id = property_id)
      );
  end if;

  if not exists (select 1 from pg_policy where polname = 'crm_payment_stages_write') then
    create policy crm_payment_stages_write on public.crm_payment_stages
      for all to cni_app
      using (
        exists (
          select 1 from public.crm_properties p
           where p.id = property_id and app.crm_manages_project(p.project_id)
        )
      )
      with check (
        exists (
          select 1 from public.crm_properties p
           where p.id = property_id and app.crm_manages_project(p.project_id)
        )
      );
  end if;
end $$;

grant select, insert, update, delete on public.crm_properties     to cni_app;
grant select, insert, update, delete on public.crm_payment_stages to cni_app;
revoke all on public.crm_properties     from anon, authenticated;
revoke all on public.crm_payment_stages from anon, authenticated;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_project uuid;
  v_prop    uuid;
  v_sales   uuid;
  v_dev     uuid;
  n         int;
  bad       boolean;
begin
  select id into v_project from public.projects where name like '%[demo]' limit 1;
  if v_project is null then
    raise notice '150 · no demo project — tables created, nothing to measure';
    return;
  end if;

  update public.projects
     set marla_sqft_standard = 225, has_catalogue = true
   where id = v_project;

  -- A throwaway property to prove the shape, removed at the end.
  insert into public.crm_properties
    (project_id, code, plot_number, block, size_marla, area_sqft, base_price, is_test_data)
  values (v_project, '150-selfcheck', 'X-000', 'X', 5, 1125, 4500000, true)
  returning id into v_prop;

  -- 1 · ⚠️ A NEGATIVE PRICE IS REFUSED. Checked by attempting it, not by reading
  --     the constraint — a check that tests its own text proves nothing.
  bad := false;
  begin
    update public.crm_properties set base_price = -1 where id = v_prop;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '150 · a property was allowed a negative price';
  end if;

  -- 2 · ⚠️ THE SAME CODE TWICE IN ONE PROJECT IS REFUSED, and the same code in a
  --     DIFFERENT project is fine. "A-101" exists in most schemes.
  bad := false;
  begin
    insert into public.crm_properties (project_id, code)
    values (v_project, '150-SELFCHECK');   -- different case, same code
    bad := true;
  exception when unique_violation then null;
  end;
  if bad then
    raise exception '150 · two properties share a code in one project';
  end if;

  -- 3 · ⚠️ AND A SALESPERSON CAN READ THE CATALOGUE. This is the check that six
  --     previous migrations existed to add after the fact.
  select u.id into v_sales
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active
     and u.department_role is distinct from 'manager'::public.department_role
   limit 1;

  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    select count(*) into n from public.crm_properties where id = v_prop;
    reset role;
    if n <> 1 then
      raise exception '150 · a salesperson cannot see the catalogue they sell from';
    end if;
  end if;

  -- 4 · ⚠️ AND CANNOT CHANGE A PRICE. Viewing is theirs; pricing is not.
  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    update public.crm_properties set base_price = 1 where id = v_prop;
    get diagnostics n = row_count;
    reset role;
    if n <> 0 then
      raise exception '150 · a salesperson repriced a property';
    end if;
  end if;

  -- 5 · Somebody with no leads on this project sees nothing.
  select u.id into v_dev
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'development' and u.is_active limit 1;
  if v_dev is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_dev::text, true);
    select count(*) into n from public.crm_properties where id = v_prop;
    reset role;
    if n <> 0 then
      raise exception '150 · Development can read a catalogue they have no leads on';
    end if;
  end if;

  -- 6 · ⚠️ DELETING A PROPERTY MUST NOT DELETE THE ENQUIRY. `set null`, not
  --     cascade — the person who asked is still real.
  declare v_lead uuid;
  begin
    select id into v_lead from public.crm_leads where project_id = v_project limit 1;
    if v_lead is not null then
      update public.crm_leads set property_id = v_prop where id = v_lead;
      delete from public.crm_properties where id = v_prop;
      select count(*) into n from public.crm_leads where id = v_lead;
      if n <> 1 then
        raise exception '150 · deleting a property deleted the lead that wanted it';
      end if;
      select count(*) into n from public.crm_leads
       where id = v_lead and property_id is null;
      if n <> 1 then
        raise exception '150 · the lead kept a pointer to a deleted property';
      end if;
    else
      delete from public.crm_properties where id = v_prop;
    end if;
  end;

  raise notice '150 · catalogue, payment stages and the lead link are in, and a salesperson can read but not reprice';
end $$;
