-- ============================================================================
-- 063 · AI TOOLS: WHO HOLDS WHAT, AND WHAT IT COSTS
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26:
--
--   "the AI subscriptions are assigned to specific people. Each person can see
--    which subscriptions they have, for example Gemini, but the subscription
--    cost is not compulsory to show them. Admin and super admin can see the
--    cost. I want to track how many of each subscription — Claude, ChatGPT,
--    Canva, Gemini, Flow — and to whom they are provided."
--
-- ── ⚠️ THREE TABLES, NOT ONE, AND THE SPLIT IS THE WHOLE POINT ──────────────
-- The obvious shape is one `subscriptions` table with a `monthly_cost_pkr`
-- column and a `user_id`. It is wrong here for the same reason migration 062
-- refused to put `monthly_salary` on `public.users`:
--
--   A MEMBER MUST BE ABLE TO READ THEIR OWN SEAT. That is the owner's
--   instruction — "each person can see which subscriptions they have". Reading
--   a seat means reading the row, and reading the row means reading every
--   column on it. A cost column on that row is a cost the member can read, and
--   no amount of not-rendering-it in a component takes that back. RLS is the
--   boundary; a column choice cannot be undone above it.
--
-- So the money is moved out of reach instead of hidden:
--
--   public.subscriptions       the tool. Name, vendor, colour. NO MONEY.
--                              → readable by anybody signed in
--   public.subscription_seats  who holds it, and since when. NO MONEY.
--                              → readable by the HOLDER or an Admin
--   public.subscription_costs  what it costs.
--                              → Admin and above, read and write
--
-- A Member selecting `subscriptions` and `subscription_seats` gets exactly
-- "you have Claude and Gemini" and there is nothing else on those rows to
-- leak. The cost is not concealed from them; it is in a table their role
-- cannot select at all.
--
-- This is the difference lib/view/project-finance.ts is candid about: hiding a
-- fee at the render site is a display gate, and RLS still lets the reader
-- select the column. Here there is no column to select.
--
-- ── ⚠️ WHY A TABLE OF TOOLS AND NOT AN ENUM ────────────────────────────────
-- Migration 032 settled this for packages and the reasoning is unchanged: "an
-- enum change is a migration and a deploy; a row is an afternoon in the admin
-- screen." The five tools named today will not be the five tools next year.
-- ============================================================================

-- ── The billing cycle ───────────────────────────────────────────────────────
-- An enum rather than a table: unlike the tool list, this genuinely is a closed
-- set that code must branch on to annualise a figure, and a sixth value would
-- need code anyway.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_cycle') then
    create type public.billing_cycle as enum ('monthly', 'yearly');
  end if;
end $$;

comment on type public.billing_cycle is
  'How often a subscription is billed. Yearly costs are divided by twelve when '
  'a monthly figure is needed — never multiplied up, which would overstate a '
  'month by a factor of twelve.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE TOOL CATALOGUE — no money in this table, on purpose
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  vendor     text,

  -- ⚠️ A THEME TOKEN NAME, NEVER A HEX. BR-025, and the same rule
  -- `PROJECT_TYPE_META.token` follows. A hex here would be one colour in two
  -- themes, and the seat board has to work in both.
  token      text not null default 'accent-primary',

  sort_order integer not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_name_present check (btrim(name) <> ''),
  constraint subscriptions_slug_shape   check (slug ~ '^[a-z0-9_]+$')
);

create unique index if not exists subscriptions_slug_key
  on public.subscriptions (slug);

comment on table public.subscriptions is
  'AI and creative tools the division pays for. DELIBERATELY HOLDS NO PRICE — '
  'see public.subscription_costs. This table is readable by everybody signed in '
  'precisely because there is nothing sensitive on it, which is what lets a '
  'Member see the name of a tool they hold.';

alter table public.subscriptions enable row level security;

-- Anybody signed in may read the catalogue. Safe by construction: no money.
create policy subscriptions_select on public.subscriptions
  for select to cni_app
  using (app.current_user_id() is not null);

create policy subscriptions_write on public.subscriptions
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.subscriptions to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT EACH TOOL COSTS — Admin and above, read as well as write
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.subscription_costs (
  subscription_id uuid primary key
    references public.subscriptions (id) on delete cascade,

  -- ⚠️ `numeric`, never a float. Migration 062 states the rule and it holds
  -- everywhere money is summed: binary floats accumulate error the moment you
  -- add them, and a spend total that is out by a fraction is one nobody trusts.
  monthly_cost_pkr numeric(12, 2) not null check (monthly_cost_pkr >= 0),

  currency        text not null default 'PKR' check (char_length(currency) = 3),
  billing_cycle   public.billing_cycle not null default 'monthly',

  -- Null means "priced per seat" — the monthly cost is charged for each holder.
  -- A number means the price covers that many seats however many are assigned.
  seats_included  integer check (seats_included is null or seats_included > 0),

  note            text,
  updated_at      timestamptz not null default now(),
  updated_by_id   uuid references public.users (id) on delete set null
);

comment on table public.subscription_costs is
  'What each tool costs. SEPARATE from public.subscriptions because a Member '
  'must be able to read the tool they hold, and reading a row means reading '
  'every column on it. Admin and above, for reads as well as writes.';

comment on column public.subscription_costs.seats_included is
  'NULL = per-seat pricing, so monthly spend is cost x active seats. A number = '
  'a flat price covering that many seats, so spend is the price regardless.';

alter table public.subscription_costs enable row level security;

-- One policy, `for all`, Admin and above — migration 062's idiom. Every
-- operation on a price has the same audience, and four policies that must agree
-- is four places for them to stop agreeing.
create policy subscription_costs_all on public.subscription_costs
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.subscription_costs to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- WHO HOLDS WHAT — no money here either
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.subscription_seats (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,

  started_on      date not null default current_date,

  -- ⚠️ A seat is ENDED, not deleted. Deleting it would rewrite history: a tool
  -- somebody held for four months would vanish from those four months' spend,
  -- and last quarter's cost would silently drop. Same principle as the ledger
  -- in 064 — what happened stays written down.
  ended_on        date,

  seat_note       text,
  assigned_by_id  uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint subscription_seats_dates_ordered
    check (ended_on is null or ended_on >= started_on)
);

-- One LIVE seat per person per tool. Ended seats are unconstrained, so the same
-- person can be given Claude again next year without tripping over last year's.
create unique index if not exists subscription_seats_one_active
  on public.subscription_seats (subscription_id, user_id)
  where ended_on is null;

create index if not exists subscription_seats_by_user
  on public.subscription_seats (user_id) where ended_on is null;

comment on table public.subscription_seats is
  'Which person holds which tool. HOLDS NO PRICE — the holder can read their own '
  'rows (that is the point) and a price column here would be a price they can '
  'read. Read: the holder, or Admin+. Write: Admin+ only.';

alter table public.subscription_seats enable row level security;

-- ── ⚠️ READ AND WRITE HAVE DIFFERENT AUDIENCES, SO THE POLICIES SPLIT ───────
-- Migration 062 used a single `for all` because pay has one audience. Here the
-- audiences genuinely differ — everybody reads their own, only an Admin assigns
-- — so this follows 058's split-policy shape instead. Collapsing these into one
-- `for all` would either hand Members the power to assign themselves a tool or
-- take away the self-read the owner asked for; there is no single predicate
-- that says both things.
create policy subscription_seats_select on public.subscription_seats
  for select to cni_app
  using (user_id = app.current_user_id() or app.acting_at_least('admin'));

create policy subscription_seats_insert on public.subscription_seats
  for insert to cni_app
  with check (app.acting_at_least('admin'));

-- ⚠️ `using` AND `with check`. Without the check half a row could pass on the
-- way in and be updated into a shape that would not pass again — here that
-- means re-pointing a seat at a different person. 058 documents the same trap.
create policy subscription_seats_update on public.subscription_seats
  for update to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

create policy subscription_seats_delete on public.subscription_seats
  for delete to cni_app
  using (app.acting_at_least('admin'));

grant select, insert, update, delete on public.subscription_seats to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE FIVE TOOLS THE OWNER NAMED
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `on conflict do nothing`, so re-running this never overwrites an edit made
-- in the admin screen. Tokens are EXISTING theme tokens rather than a new
-- `--tool-*` family: the owner asked for tokens to be used optimally, not
-- multiplied, and these five already carry a light and a dark value that has
-- been contrast-checked.
insert into public.subscriptions (name, slug, vendor, token, sort_order) values
  ('Claude',  'claude',  'Anthropic', 'accent-primary',   10),
  ('ChatGPT', 'chatgpt', 'OpenAI',    'status-done',      20),
  ('Gemini',  'gemini',  'Google',    'status-todo',      30),
  ('Canva',   'canva',   'Canva',     'priority-medium',  40),
  ('Flow',    'flow',    'Google',    'status-review',    50)
on conflict (slug) do nothing;


-- ── Keep `updated_at` honest ────────────────────────────────────────────────
create or replace function public.touch_subscription()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.touch_subscription();

drop trigger if exists subscription_costs_touch on public.subscription_costs;
create trigger subscription_costs_touch
  before update on public.subscription_costs
  for each row execute function public.touch_subscription();


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This migration runs as the owning role, which bypasses RLS entirely. Every
-- check made while writing it therefore proves nothing about what a Member can
-- see — that is exactly how migration 050 shipped with policies and no GRANT.
-- What follows asserts the SHAPE of what was created.
do $$
declare
  problem text;
begin
  -- The whole design rests on there being no money column outside the costs
  -- table. If somebody later "tidies up" by adding one, this fails loudly.
  select string_agg(table_name || '.' || column_name, ', ')
    into problem
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('subscriptions', 'subscription_seats')
     and (column_name like '%cost%' or column_name like '%price%'
          or column_name like '%pkr%' or column_name like '%amount%');

  if problem is not null then
    raise exception
      'A price column exists where a Member can read it: %. Money belongs in '
      'public.subscription_costs — see this migration''s header.', problem;
  end if;

  -- A Member's self-read must exist, or the owner's instruction is unmet.
  if not exists (
    select 1 from pg_policies
     where tablename = 'subscription_seats' and cmd = 'SELECT'
       and qual like '%current_user_id%'
  ) then
    raise exception 'subscription_seats has no self-read policy.';
  end if;

  -- ...and writing must NOT be open to the same crowd.
  if exists (
    select 1 from pg_policies
     where tablename = 'subscription_seats' and cmd in ('INSERT', 'UPDATE', 'DELETE')
       and coalesce(qual, '') || coalesce(with_check, '') like '%current_user_id%'
  ) then
    raise exception 'A seat write policy admits the holder. Assignment is Admin-only.';
  end if;

  raise notice 'Subscriptions: catalogue is open, seats are self-read, costs are Admin-only.';
  raise notice 'Seeded % tools.', (select count(*) from public.subscriptions);
end $$;
