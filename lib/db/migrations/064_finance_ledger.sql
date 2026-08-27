-- ============================================================================
-- 064 · THE LEDGER — WHAT WE SPEND, WHAT WE EARN
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26:
--
--   "I want to implement a finance page where we can manage all our expenses
--    and our project package income. Expenses include employee salaries, light
--    bills, utility bills like gas and Wi-Fi, office rent, employee AI tool
--    subscriptions, equipment such as headphones and systems, and arbitrary
--    expenses that I don't remember right now. [...] In the admin panel the
--    admin and the super admin can view where we have spent and what we have
--    spent. The team coordinator can also add expenses. The list of expenses,
--    their report, or their analysis should only be visible to the admin and
--    the super admin."
--
-- ── ⚠️ A LEDGER IS A DIARY, NOT A CALCULATION ───────────────────────────────
-- The tempting shortcut for payroll is `sum(employee_compensation)`. It is
-- wrong the first time somebody gets a raise: August silently becomes more
-- expensive than it was, and last quarter's profit changes while you are
-- looking at it. Nothing in the schema would be broken and every figure would
-- be a lie.
--
-- So `public.employee_compensation` (062) is the RATE CARD — what a person is
-- paid NOW — and this table records WHAT EACH MONTH ACTUALLY COST, written down
-- at the rate that applied then and never recomputed. The application posts
-- those rows so nobody types them, but they are real rows.
--
-- ── ⚠️ TWO DATES, NOT ONE ───────────────────────────────────────────────────
-- Every entry carries the month it BELONGS to (`incurred_on` / `earned_on`) and
-- optionally when the money actually MOVED (`paid_on` / `received_on`). Profit
-- and loss is computed on the first. That is accrual accounting, and it is why
-- a client paying three weeks late does not make August look like a bad month
-- and September like a miracle. The second date answers one question the owner
-- will ask constantly — who has not paid yet — for the price of a nullable
-- column.
--
-- ── ⚠️ CATEGORIES ARE ROWS, NOT AN ENUM ─────────────────────────────────────
-- Migration 032 settled the principle: "an enum change is a migration and a
-- deploy; a row is an afternoon in the admin screen." The owner said outright
-- that there will be expenses nobody has thought of yet. An enum would mean a
-- deploy every time one appears.
-- ============================================================================

-- ── How a row got here ──────────────────────────────────────────────────────
-- Distinguishing typed-in rows from posted ones is what makes "run the month"
-- safe to press twice, and what lets a mistaken run be undone without touching
-- anything a human wrote.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_source') then
    create type public.expense_source as enum
      ('manual', 'payroll_run', 'subscription_run');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_kind') then
    create type public.expense_kind as enum ('recurring', 'one_off');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'revenue_kind') then
    create type public.revenue_kind as enum ('retainer', 'one_off', 'add_on');
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT KINDS OF SPENDING EXIST
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  kind       public.expense_kind not null default 'one_off',

  -- A theme token NAME, never a hex — BR-025. The spend donut has to work in
  -- both themes, and a hex is one colour in two of them.
  token      text not null default 'accent-primary',
  -- A lucide icon name. Resolved through a map in the component, because a
  -- function cannot cross the server-to-client boundary.
  icon       text not null default 'Receipt',

  -- ⚠️ Seeded categories cannot be deleted. An expense keeps a foreign key to
  -- its category (`on delete restrict`), so deleting one would either fail
  -- confusingly or orphan history. New categories the owner adds are free to go.
  is_system  boolean not null default false,

  sort_order integer not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expense_categories_name_present check (btrim(name) <> ''),
  constraint expense_categories_slug_shape   check (slug ~ '^[a-z0-9_]+$')
);

create unique index if not exists expense_categories_slug_key
  on public.expense_categories (slug);

comment on table public.expense_categories is
  'The kinds of spending. A TABLE, not an enum, because the owner will add '
  'categories nobody has thought of yet and that must not need a deploy (032).';

alter table public.expense_categories enable row level security;

-- ⚠️ READABLE BY ANYBODY SIGNED IN, and that is deliberate. The Team
-- Coordinator's expense form needs this dropdown, and a Coordinator has no
-- select policy on `expenses` itself. A category name is not a figure.
create policy expense_categories_select on public.expense_categories
  for select to cni_app
  using (app.current_user_id() is not null);

create policy expense_categories_write on public.expense_categories
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.expense_categories to cni_app;

-- ⚠️ Tokens are EXISTING theme tokens, not a new `--spend-*` family. The owner
-- asked for tokens to be used optimally rather than multiplied, and each of
-- these already carries a light and a dark value that has been contrast-checked.
insert into public.expense_categories (name, slug, kind, token, icon, is_system, sort_order) values
  ('Salaries',        'salaries',         'recurring', 'status-progress',  'Users',        true, 10),
  ('Office rent',     'office_rent',      'recurring', 'project-event',    'Building2',    true, 20),
  ('Utility bills',   'utilities',        'recurring', 'load-warning',     'Zap',          true, 30),
  ('Internet',        'internet',         'recurring', 'status-todo',      'Wifi',         true, 40),
  ('AI subscriptions','ai_subscriptions', 'recurring', 'accent-primary',   'Sparkles',     true, 50),
  ('Equipment',       'equipment',        'one_off',   'priority-medium',  'Laptop',       true, 60),
  ('Software',        'software_other',   'recurring', 'status-review',    'AppWindow',    true, 70),
  ('Marketing',       'marketing',        'one_off',   'project-promo',    'Megaphone',    true, 80),
  ('Travel',          'travel',           'one_off',   'project-other',    'Car',          true, 90),
  ('Other',           'misc',             'one_off',   'status-cancelled', 'Receipt',      true, 100)
on conflict (slug) do nothing;

comment on column public.expense_categories.slug is
  'Stable identifier. `salaries`, `ai_subscriptions` and `utilities` are read '
  'by name from application code — renaming those three breaks the monthly run.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE SPEND LEDGER
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),

  -- `restrict`, not `cascade`: deleting a category must never silently delete
  -- the history filed under it.
  category_id uuid not null references public.expense_categories (id) on delete restrict,

  title       text not null,

  -- ⚠️ `numeric`, never a float (062). Money in a binary float accumulates
  -- error the moment it is summed, and a spend total that is out by a fraction
  -- is a spend total nobody trusts.
  amount_pkr  numeric(14, 2) not null check (amount_pkr >= 0),
  currency    text not null default 'PKR' check (char_length(currency) = 3),

  -- THE ACCOUNTING DATE — which month this belongs to. Profit and loss is
  -- computed on this and never on `paid_on`. See the header.
  incurred_on date not null,
  -- When the money actually left. NULL means it has not been paid yet.
  paid_on     date,

  vendor      text,

  -- Rent and bills differ between the two offices, so spend has to be
  -- attributable to one. Reuses the enum migration 060 already created rather
  -- than inventing a second notion of location.
  office_team public.office_team,

  -- Set on salary rows, so payroll can be read per person.
  user_id     uuid references public.users (id) on delete set null,
  -- Set on subscription rows, so tool spend can be read per tool.
  subscription_id uuid references public.subscriptions (id) on delete set null,
  -- Optional: a cost attributable to one client's work.
  project_id  uuid references public.projects (id) on delete set null,

  source        public.expense_source not null default 'manual',
  -- The first day of the month a posted row covers. NULL for manual rows.
  period_month  date,

  note          text,
  created_by_id uuid not null references public.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint expenses_title_present check (btrim(title) <> ''),
  constraint expenses_paid_after_incurred
    check (paid_on is null or paid_on >= incurred_on),
  -- A posted row must say which month it covers; a typed one must not pretend to.
  constraint expenses_period_matches_source
    check ((source = 'manual') = (period_month is null)),
  constraint expenses_period_is_month_start
    check (period_month is null or period_month = date_trunc('month', period_month)::date)
);

-- ── ⚠️ THE GUARD THAT MAKES "RUN THE MONTH" SAFE TO PRESS TWICE ────────────
-- `nulls not distinct` is load-bearing and requires PostgreSQL 15 or newer
-- (verified: this database is 17.6). Without it, two payroll rows for the same
-- person in the same month both have `subscription_id = null`, those nulls
-- compare as DISTINCT under the default, the index permits both, and the guard
-- silently does nothing — which is the worst possible outcome, because the
-- duplicate looks like real spending.
create unique index if not exists expenses_run_once
  on public.expenses (source, period_month, user_id, subscription_id)
  nulls not distinct
  where source <> 'manual';

create index if not exists expenses_by_month
  on public.expenses (incurred_on desc);
create index if not exists expenses_by_category
  on public.expenses (category_id, incurred_on desc);
create index if not exists expenses_unpaid
  on public.expenses (incurred_on) where paid_on is null;

comment on table public.expenses is
  'Every rupee spent. WRITE: Team Coordinator and above may file one. READ: '
  'Admin and above only — the owner was explicit that the list, its report and '
  'its analysis are not for a Coordinator. That asymmetry is why this table has '
  'four policies rather than one.';

comment on column public.expenses.incurred_on is
  'The accounting date — which month this belongs to. Profit and loss uses THIS, '
  'never paid_on, so a late payment does not move cost into the wrong month.';

alter table public.expenses enable row level security;

-- ── ⚠️ FILING AN EXPENSE IS NOT READING ONE ────────────────────────────────
-- Coordinator and above may INSERT. Only Admin and above may SELECT. This is
-- the owner's instruction expressed where it cannot be forgotten.
--
-- ⚠️⚠️ THE CONSEQUENCE THAT WILL BITE WHOEVER TOUCHES THIS NEXT:
-- Postgres requires SELECT rights on any column returned by `insert ...
-- returning`. A Coordinator has no select policy here, so the moment the
-- application's insert ends with `returning id`, a Coordinator's filing fails
-- with a permission error — WHILE EVERY TEST RUN AS AN ADMIN PASSES. The insert
-- in lib/db/queries/finance.ts therefore has no returning clause, and the
-- action reports "Recorded." rather than echoing the row back. That is not a
-- style choice; it is what makes a write-only boundary work.
create policy expenses_file on public.expenses
  for insert to cni_app
  with check (
    app.acting_at_least('team_coordinator')
    -- Nobody files under somebody else's name.
    and created_by_id = app.current_user_id()
  );

create policy expenses_read on public.expenses
  for select to cni_app
  using (app.acting_at_least('admin'));

-- `using` AND `with check` — 058's rule. Without the check half, a row could
-- pass on the way in and be edited into a shape that would not pass again.
create policy expenses_amend on public.expenses
  for update to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

create policy expenses_remove on public.expenses
  for delete to cni_app
  using (app.acting_at_least('admin'));

grant select, insert, update, delete on public.expenses to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE INCOME LEDGER
-- ════════════════════════════════════════════════════════════════════════════
-- Owner, 2026-08-26: income is entered by hand, every line. Nothing posts
-- itself here — the form offers a project's agreed fee as a prefill so nobody
-- has to remember 120,000, but the act of recording income is deliberate.
create table if not exists public.revenue_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        public.revenue_kind not null default 'retainer',

  -- Where it came from. A project when there is one; a plain name when the work
  -- predates the project record or never had one.
  project_id  uuid references public.projects (id) on delete set null,
  client_name text,
  -- Optional provenance for one-off sales, from the catalogue 032 seeded.
  service_id  uuid references public.services (id) on delete set null,
  package_id  uuid references public.packages (id) on delete set null,

  amount_pkr  numeric(14, 2) not null check (amount_pkr >= 0),
  currency    text not null default 'PKR' check (char_length(currency) = 3),

  -- THE ACCOUNTING DATE — the month this income belongs to.
  earned_on   date not null,
  -- When the money actually arrived. NULL means still outstanding.
  received_on date,

  invoice_ref text,
  note        text,
  created_by_id uuid not null references public.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Every income line names where it came from. An unattributed figure is a
  -- figure nobody can check.
  constraint revenue_has_a_source
    check (project_id is not null or btrim(coalesce(client_name, '')) <> ''),
  constraint revenue_received_after_earned
    check (received_on is null or received_on >= earned_on)
);

create index if not exists revenue_by_month
  on public.revenue_entries (earned_on desc);
create index if not exists revenue_outstanding
  on public.revenue_entries (earned_on) where received_on is null;

comment on table public.revenue_entries is
  'Money the division earned. Admin and above for reads AND writes — the owner '
  'gave the Coordinator expenses only, and income is not among them.';

alter table public.revenue_entries enable row level security;

-- One policy, `for all`: unlike expenses, reading and writing income have the
-- same audience, so 062's single-policy idiom applies rather than 058's split.
create policy revenue_entries_all on public.revenue_entries
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.revenue_entries to cni_app;


-- ── Keep `updated_at` honest ────────────────────────────────────────────────
create or replace function public.touch_finance()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists expense_categories_touch on public.expense_categories;
create trigger expense_categories_touch
  before update on public.expense_categories
  for each row execute function public.touch_finance();

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch
  before update on public.expenses
  for each row execute function public.touch_finance();

drop trigger if exists revenue_entries_touch on public.revenue_entries;
create trigger revenue_entries_touch
  before update on public.revenue_entries
  for each row execute function public.touch_finance();


-- ── A seeded category must not be deletable ─────────────────────────────────
create or replace function public.guard_system_category()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception
      'The "%" category is built in and cannot be deleted. Deactivate it instead.',
      old.name
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists expense_categories_guard on public.expense_categories;
create trigger expense_categories_guard
  before delete on public.expense_categories
  for each row execute function public.guard_system_category();


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This migration runs as the owning role, which bypasses RLS. Nothing tried
-- while writing it proves what a Coordinator can see.
do $$
declare
  reader text;
  filer  text;
begin
  -- The asymmetry IS the feature. If a future migration adds a select policy
  -- admitting a Coordinator, the owner's instruction is quietly broken and
  -- nothing else would notice.
  select coalesce(qual, '') into reader
    from pg_policies where tablename = 'expenses' and cmd = 'SELECT';

  if reader is null then
    raise exception 'expenses has no select policy at all.';
  end if;
  if reader like '%team_coordinator%' then
    raise exception
      'The expenses SELECT policy admits a Coordinator. The owner asked that the '
      'list, its report and its analysis be Admin-only.';
  end if;

  select coalesce(with_check, '') into filer
    from pg_policies where tablename = 'expenses' and cmd = 'INSERT';

  if filer is null or filer not like '%team_coordinator%' then
    raise exception
      'The expenses INSERT policy does not admit a Coordinator. Filing an expense '
      'is exactly what they were given.';
  end if;
  if filer not like '%current_user_id%' then
    raise exception 'A Coordinator could file an expense under another name.';
  end if;

  -- Income is Admin-only on both sides.
  if exists (
    select 1 from pg_policies
     where tablename = 'revenue_entries'
       and coalesce(qual, '') || coalesce(with_check, '') like '%team_coordinator%'
  ) then
    raise exception 'A revenue policy admits a Coordinator. Income is Admin+ only.';
  end if;

  -- The idempotency guard is worthless without `nulls not distinct`.
  if not exists (
    select 1 from pg_indexes
     where tablename = 'expenses' and indexname = 'expenses_run_once'
       and indexdef ilike '%nulls not distinct%'
  ) then
    raise exception
      'expenses_run_once is missing NULLS NOT DISTINCT — running the month twice '
      'would post every salary again.';
  end if;

  raise notice 'Expenses: Coordinator files, Admin reads. Income: Admin only.';
  raise notice 'Seeded % categories.', (select count(*) from public.expense_categories);
end $$;
