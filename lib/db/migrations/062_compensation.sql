-- ============================================================================
-- 062 · WHAT EACH PERSON IS PAID
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26: the team form is missing the office somebody sits in and
-- what they are paid, and both are needed before a finance page can say
-- anything useful.
--
-- ── ⚠️ WHY SALARY IS NOT A COLUMN ON `public.users` ─────────────────────────
-- That was the obvious shape and it is wrong here. `users_select` (migration
-- 005) reads:
--
--     id = app.current_user_id() or app.acting_at_least('team_coordinator')
--
-- — so every Team Coordinator can read every user row. Adding `monthly_salary`
-- there would hand each Coordinator the whole division's pay, permanently and
-- silently, as a side effect of a column choice. No application code could take
-- it back: RLS is the boundary, and the boundary would already have let them in.
--
-- A separate table has its own policy, and this one is ADMIN AND ABOVE for
-- reads as well as writes. The same reasoning migration 047 used for
-- credentials: access follows rank, and rank is checked in the database rather
-- than in a component.
--
-- ── ⚠️ THE OFFICE IS ALREADY MODELLED — DO NOT ADD A SECOND ONE ─────────────
-- `public.users.office_team` exists from migration 060 ('blue_area' | 'wah')
-- and already drives which weekdays count as an absence. The team form simply
-- never asked for it, so everybody landed on the default. This migration adds
-- no location column; the form now sets the one that exists.
-- ============================================================================

create table if not exists public.employee_compensation (
  user_id        uuid primary key references public.users(id) on delete cascade,

  -- ⚠️ `numeric`, never a float. Money in a binary float accumulates error the
  -- moment it is summed, and a payroll total that is out by a fraction is a
  -- payroll total nobody trusts. 14,2 holds any salary this division will pay.
  monthly_salary numeric(14, 2) not null check (monthly_salary >= 0),

  -- Stored per row rather than assumed globally: a contractor paid in USD is a
  -- realistic thing to happen, and discovering that after the fact would mean
  -- re-reading every historical figure.
  currency       text not null default 'PKR' check (char_length(currency) = 3),

  note           text,
  updated_at     timestamptz not null default now(),
  updated_by_id  uuid references public.users(id) on delete set null
);

comment on table public.employee_compensation is
  'What each person is paid, monthly. SEPARATE from public.users because users_select exposes every row to Coordinator and above, and pay must not follow that rule — read and write here are Admin+ only.';

comment on column public.employee_compensation.monthly_salary is
  'Numeric, not float: money that is summed must not drift.';

alter table public.employee_compensation enable row level security;

-- ── ⚠️ ONE POLICY, ADMIN AND ABOVE, FOR EVERYTHING ─────────────────────────
-- Deliberately not split into select/insert/update: every operation on pay has
-- the same audience, and four policies that must agree is four places for them
-- to stop agreeing.
create policy compensation_all on public.employee_compensation
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.employee_compensation to cni_app;

-- Finance reads this by office and by role; both go through `users`, so the
-- foreign key is the only index that matters and the primary key provides it.

-- ── The audit trail ────────────────────────────────────────────────────────
-- A pay change is exactly the kind of privileged action doc 16 §10 requires to
-- be recorded. The application writes the audit row (it knows the actor and the
-- before/after); this trigger only guarantees `updated_at` cannot be forgotten.
create or replace function public.touch_compensation()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists compensation_touch on public.employee_compensation;
create trigger compensation_touch
  before update on public.employee_compensation
  for each row execute function public.touch_compensation();
