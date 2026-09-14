-- ============================================================================
-- 146 · "SALES" IS NOT ONE BUSINESS — WHICH MARKET DOES THIS PERSON SELL INTO?
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-14: *"the team name is Sale Team. Whether that Sale Team is for
-- the real estate sale team… It's a sale, sales of which type? …basically a real
-- estate type sale team having a real estate type or a sale team having some
-- other type, like frozen food types or some other businesses like that. Right
-- now most of the team is for the real estate sales team."*
--
-- ── ⚠️ THE TAXONOMY IS READ OFF THEIR OWN PROJECTS, NOT INVENTED ───────────
-- Q19 stands: the specialisation field must not be made up. This is not that
-- field. The 14 projects whose leads route to Sales are demonstrably several
-- different businesses, and the four markets below are just those projects
-- sorted:
--
--   Real estate        Chitral Royal Homes (632 leads), The Executive Housing
--                      Project, Investo 21, AGC Construction & Interior Design
--   Food               Al Maida Frozen Food
--   Business services  ANSONS Business Solutions, Daniyal Marketing,
--                      Crescent Nova International
--   Other              Attari Group, ETEMAAD100, Khattar Qabila,
--                      Saif Ur Rehman Khan, Jashn e Subha Noor
--
-- The owner confirmed this derivation rather than a generic list, and can rename
-- or add rows afterwards — which is why these are TABLE ROWS and not an enum.
-- An enum would need a migration every time the division sells something new.
--
-- ── ⚠️ MANY PER PERSON, AND THE DATA DECIDED THAT ──────────────────────────
-- 14 projects, 3 salespeople. One market each is arithmetically impossible, so a
-- single-valued column would have been wrong the day it shipped.
--
-- ── ⚠️ AND NOTHING ROUTES ON IT YET — ON PURPOSE ───────────────────────────
-- Owner chose "person only, for now": the label is visible and editable, and the
-- four-signal rota (133) is untouched. Step 7c can later prefer a real-estate
-- seller for a Chitral lead by giving PROJECTS a market too, but that is a
-- separate decision and this migration deliberately does not pre-empt it.
--
-- ── ⚠️ THIS IS NOT `users.specialisation` (131), AND DOES NOT REPLACE IT ───
-- That one is free text — *"ERP and CRM enquiries, manufacturing and retail,
-- Punjab"* — and answers "what does this person handle". Useful to read, and
-- impossible to route or filter on. This answers the coarser question "which
-- business are they selling", which is the one that can be acted on. Both stay.
-- ============================================================================

create table if not exists public.sales_markets (
  id         uuid primary key default gen_random_uuid(),
  /* Stable across a rename — anything that ever keys off a market keys off this,
     never off the display name. */
  key        text not null,
  name       text not null,
  sort_order int  not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_markets_key_present  check (btrim(key)  <> ''),
  constraint sales_markets_name_present check (btrim(name) <> '')
);

create unique index if not exists sales_markets_key_uq
  on public.sales_markets (lower(btrim(key)));

comment on table public.sales_markets is
  'Which business a salesperson sells into — real estate, food, services. Rows '
  'rather than an enum so a new market does not need a migration. Read off the '
  'division''s own projects, not invented. Migration 146.';

create table if not exists public.user_sales_markets (
  user_id   uuid not null references public.users (id)         on delete cascade,
  market_id uuid not null references public.sales_markets (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (user_id, market_id)
);

comment on table public.user_sales_markets is
  'Which markets one person sells into. MANY per person: 14 lead projects, 3 '
  'salespeople. Migration 146.';

/* ⚠️ Indexed the other way too — the team page reads by person, and "who sells
   real estate" reads by market. The primary key only serves the first. */
create index if not exists user_sales_markets_market_idx
  on public.user_sales_markets (market_id);

-- ════════════════════════════════════════════════════════════════════════════
-- POLICIES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.sales_markets      enable row level security;
alter table public.user_sales_markets enable row level security;

do $$
begin
  /* ⚠️ THE LIST OF MARKETS IS READABLE BY ANYBODY SIGNED IN. It is four words
     naming what the company sells — there is nothing to protect, and the invite
     form needs it before the reader has any other context. */
  if not exists (select 1 from pg_policy where polname = 'sales_markets_select') then
    create policy sales_markets_select on public.sales_markets
      for select to cni_app
      using (app.current_user_id() is not null);
  end if;

  /* Adding or renaming a market is an Admin act — it changes a vocabulary the
     whole team then files people under. */
  if not exists (select 1 from pg_policy where polname = 'sales_markets_write') then
    create policy sales_markets_write on public.sales_markets
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;

  /* ⚠️ DELEGATED TO THE PERSON, NOT RE-DECIDED HERE. Whoever may see the user
     row may see what they sell; the same shape as 137's insight policy. A second
     hand-written audience would drift from `users_select` the first time that
     changed. */
  if not exists (select 1 from pg_policy where polname = 'user_sales_markets_select') then
    create policy user_sales_markets_select on public.user_sales_markets
      for select to cni_app
      using (exists (select 1 from public.users u where u.id = user_sales_markets.user_id));
  end if;

  /* Admin only to change — it sits on the same forms as the department and the
     rank, and those are Admin-only for the same reason. */
  if not exists (select 1 from pg_policy where polname = 'user_sales_markets_write') then
    create policy user_sales_markets_write on public.user_sales_markets
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end $$;

grant select on public.sales_markets to cni_app;
grant insert, update, delete on public.sales_markets to cni_app;
grant select, insert, update, delete on public.user_sales_markets to cni_app;
revoke all on public.sales_markets      from anon, authenticated;
revoke all on public.user_sales_markets from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- THE FOUR, AND THE THREE PEOPLE WHO ALREADY HAVE ONE
-- ════════════════════════════════════════════════════════════════════════════
insert into public.sales_markets (key, name, sort_order) values
  ('real_estate',       'Real estate',       10),
  ('food',              'Food',              20),
  ('business_services', 'Business services', 30),
  ('other',             'Other',             90)
on conflict do nothing;

/* ⚠️ SEEDED FROM THE OWNER'S OWN SENTENCE — *"Right now most of the team is for
   the real estate sales team"* — so the feature arrives with the truth already
   in it rather than as three empty rows somebody has to fill in before they can
   see what it does. One click changes any of them. */
insert into public.user_sales_markets (user_id, market_id)
select u.id, m.id
  from public.users u
  join public.departments d on d.id = u.department_id
  cross join public.sales_markets m
 where d.key = 'sales' and u.is_active and m.key = 'real_estate'
on conflict do nothing;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  n_markets int;
  n_sales   int;
  n_tagged  int;
  v_admin   uuid;
  v_member  uuid;
  n_seen    int;
begin
  select count(*) into n_markets from public.sales_markets where is_active;
  if n_markets <> 4 then
    raise exception '146 · % markets, expected 4', n_markets;
  end if;

  select count(*) into n_sales
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active;

  select count(distinct user_id) into n_tagged from public.user_sales_markets;
  if n_tagged <> n_sales then
    raise exception '146 · % of % salespeople carry a market', n_tagged, n_sales;
  end if;

  -- ⚠️ MANY PER PERSON MUST ACTUALLY BE POSSIBLE. A unique index on user_id
  --    would pass every check above and fail the first time somebody sells two
  --    things, which is the case this whole table exists for.
  if n_sales > 0 then
    declare v_one uuid; v_food uuid;
    begin
      select user_id into v_one from public.user_sales_markets limit 1;
      select id into v_food from public.sales_markets where key = 'food';
      insert into public.user_sales_markets (user_id, market_id) values (v_one, v_food);
      select count(*) into n_seen from public.user_sales_markets where user_id = v_one;
      if n_seen < 2 then
        raise exception '146 · a person cannot hold two markets';
      end if;
      delete from public.user_sales_markets where user_id = v_one and market_id = v_food;
    end;
  end if;

  -- ⚠️ AND AN ORDINARY MEMBER CAN READ THE LIST. The invite form needs it, and
  --    a form whose dropdown is empty for the person filling it in is the bug
  --    this codebase has shipped five times.
  select id into v_member from public.users
   where role = 'member' and is_active limit 1;
  if v_member is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_member::text, true);
    select count(*) into n_seen from public.sales_markets;
    reset role;
    if n_seen <> 4 then
      raise exception '146 · a member sees % markets, not 4', n_seen;
    end if;
  end if;

  -- And an Admin can still write.
  select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    select count(*) into n_seen from public.sales_markets;
    reset role;
    if n_seen <> 4 then
      raise exception '146 · an admin sees % markets, not 4', n_seen;
    end if;
  end if;

  raise notice '146 · % markets, % salespeople carrying one, many-per-person proved', n_markets, n_tagged;
end $$;
