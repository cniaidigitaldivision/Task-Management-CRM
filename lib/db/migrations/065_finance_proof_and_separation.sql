-- ============================================================================
-- 065 · A RECORD WITHOUT A RECEIPT IS A CLAIM
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26, on the expense form:
--
--   "How can you consider that the person who is entering this record, for
--    example, is the team coordinator? How can I trust him? It's not about
--    trust, it's about accuracy. [...] the screenshot of that expense [...]
--    Without a screenshot or things like that, it would not be acceptable that
--    it's an expense."
--
--   "Salaries should not be in the category because salary should definitely be
--    assigned, or you can say linked, with some employee. It is not a separate
--    entity so exclude this salary from here."
--
--   "If I say that it's a utility bill, how can I know if it's an electricity
--    bill, a gas bill, something like maintenance, or anything?"
--
--   "I am not sure that all the money is received [...] whether it's pending,
--    received, returned, or any of the statuses."
--
-- ── ⚠️ WHAT THIS MIGRATION IS ACTUALLY ABOUT ────────────────────────────────
-- Migration 064 recorded WHAT was spent. It could not answer "says who?". A
-- figure typed by one person, readable only by another, with nothing attached,
-- is an assertion — and the whole reason the ledger is Admin-only is that
-- somebody is going to be asked to stand behind its totals.
--
-- So every hand-filed row now carries the document that proves it. The bytes go
-- to the same private bucket documents use (migration 048), and the row holds
-- the path.
--
-- ── ⚠️ THE RECEIPT CHECK IS `NOT VALID`, ON PURPOSE ────────────────────────
-- A plain CHECK is verified against every existing row, and the 123 rows the
-- demo seed wrote have no receipt — the migration would simply fail. `NOT VALID`
-- enforces the rule on everything written FROM NOW ON and leaves history alone,
-- which is the honest position: those rows were filed before the rule existed
-- and inventing receipts for them would be worse than admitting they predate it.
--
-- Do NOT run `validate constraint` on it until every legacy row has one.
-- ============================================================================

-- ── Where money stands, rather than whether a date is null ──────────────────
-- Owner: *"whether it's pending, received, returned, or any of the statuses
-- that could be right."* `received_on is null` could only ever say "not yet",
-- which cannot tell "we have not invoiced" from "they refused to pay".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'revenue_status') then
    create type public.revenue_status as enum
      ('pending', 'invoiced', 'received', 'returned', 'written_off');
  end if;
end $$;

comment on type public.revenue_status is
  'Where a piece of income stands. `received` is the only one that counts as '
  'money in hand, and it is the only one that demands proof.';

-- ── What somebody is employed as ────────────────────────────────────────────
-- Owner: *"set this category when adding an employee: whether it's a full-time
-- employee, a probationary employee, or an internee [...] sometimes internee pay
-- is something or we want to add that pay after 3 months."*
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employment_type') then
    create type public.employment_type as enum
      ('full_time', 'probation', 'intern', 'contract');
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- EXPENSES — PROOF, AND WHAT KIND OF THING IT WAS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.expenses
  -- The receipt. `receipt_path` is a key in the private bucket, never a URL:
  -- a URL would either be permanent (and so public forever) or expired by the
  -- time it was read. Links are signed on demand — see lib/storage/bucket.ts.
  add column if not exists receipt_path       text,
  add column if not exists receipt_name       text,
  add column if not exists receipt_mime       text,
  add column if not exists receipt_size_bytes bigint,

  -- ── ⚠️ WHAT KIND OF UTILITY BILL, WHAT TOOL ────────────────────────────
  -- Owner asked for a second level under the broad categories. Free text with
  -- a fixed list offered by the form, rather than a table per category: the
  -- lists are short, they differ per category, and "Other, and say what"
  -- has to be possible anyway — so a lookup table would be a join that still
  -- could not answer the question on its own.
  add column if not exists subtype            text,
  -- What they typed when the list did not contain it.
  add column if not exists subtype_other      text,

  -- ⚠️ For an AI-subscription expense: WHOSE seat it was. Owner: *"I will
  -- select the tool and then I will select the person to whom I'm giving this."*
  -- Distinct from `user_id`, which on a payroll row means whose salary it is.
  add column if not exists subscription_user_id uuid references public.users (id) on delete set null;

comment on column public.expenses.receipt_path is
  'Key in the private storage bucket. NOT a URL — links are signed per request.';

comment on column public.expenses.subtype is
  'The second level: which utility, which tool. NULL where the category has no '
  'sub-list. `other` means look at subtype_other.';

-- ⚠️ NOT VALID — see the header. Enforced on every new and updated row; the
-- rows that predate the rule are left as they are rather than falsified.
alter table public.expenses
  drop constraint if exists expenses_manual_needs_receipt;
alter table public.expenses
  add constraint expenses_manual_needs_receipt
  check (source <> 'manual' or receipt_path is not null)
  not valid;

-- If the list did not have it, say what it was.
alter table public.expenses
  drop constraint if exists expenses_other_subtype_named;
alter table public.expenses
  add constraint expenses_other_subtype_named
  check (subtype is distinct from 'other' or btrim(coalesce(subtype_other, '')) <> '')
  not valid;

create index if not exists expenses_by_subscription_user
  on public.expenses (subscription_user_id) where subscription_user_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- SALARY IS NOT A CATEGORY SOMEBODY PICKS
-- ════════════════════════════════════════════════════════════════════════════
-- Owner: *"salary should definitely be assigned, or you can say linked, with
-- some employee. It is not a separate entity."*
--
-- The category still EXISTS — the monthly run files every salary under it, and
-- deleting it would orphan that history. What changes is that it can no longer
-- be chosen by hand, which is enforced here rather than only hidden in the form.
alter table public.expense_categories
  add column if not exists posted_only boolean not null default false;

comment on column public.expense_categories.posted_only is
  'True where rows may ONLY be written by the monthly run. Salaries: a salary '
  'belongs to a person and their pay record, never to a free-text form.';

update public.expense_categories set posted_only = true where slug = 'salaries';

-- ⚠️ The rule, in the database, so the form is a convenience and not the fence.
alter table public.expenses
  drop constraint if exists expenses_posted_only_not_manual;

create or replace function public.guard_posted_only_category()
returns trigger
language plpgsql
as $$
declare
  locked boolean;
  label  text;
begin
  select posted_only, name into locked, label
    from public.expense_categories where id = new.category_id;

  if coalesce(locked, false) and new.source = 'manual' then
    raise exception
      '"%" is posted automatically each month and cannot be filed by hand. A '
      'salary belongs to a person''s pay record.', label
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_posted_only on public.expenses;
create trigger expenses_posted_only
  before insert or update on public.expenses
  for each row execute function public.guard_posted_only_category();


-- ════════════════════════════════════════════════════════════════════════════
-- INCOME — A STATUS, AND PROOF WHEN IT LANDS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.revenue_entries
  add column if not exists status public.revenue_status not null default 'pending',
  add column if not exists proof_path       text,
  add column if not exists proof_name       text,
  add column if not exists proof_mime       text,
  add column if not exists proof_size_bytes bigint,
  -- Why it came back, where it did.
  add column if not exists status_note text;

-- Existing rows: a received_on date meant it had landed. Carry that across
-- rather than resetting six months of history to 'pending'.
update public.revenue_entries
   set status = 'received'
 where received_on is not null and status = 'pending';

comment on column public.revenue_entries.status is
  'pending → invoiced → received, or returned / written_off. `received` is the '
  'only status that counts as money in hand.';

-- ⚠️ NOT VALID, same reasoning as the receipt: the seeded history has no proof
-- and pretending otherwise would be the opposite of what this migration is for.
alter table public.revenue_entries
  drop constraint if exists revenue_received_needs_proof;
alter table public.revenue_entries
  add constraint revenue_received_needs_proof
  check (status <> 'received' or proof_path is not null)
  not valid;

-- `received` and a date agree, in both directions.
alter table public.revenue_entries
  drop constraint if exists revenue_received_has_a_date;
alter table public.revenue_entries
  add constraint revenue_received_has_a_date
  check ((status = 'received') = (received_on is not null))
  not valid;

create index if not exists revenue_by_status on public.revenue_entries (status, earned_on desc);


-- ════════════════════════════════════════════════════════════════════════════
-- PAYROLL — WHAT SOMEBODY IS EMPLOYED AS, AND WHAT THEY USED TO BE PAID
-- ════════════════════════════════════════════════════════════════════════════
alter table public.employee_compensation
  add column if not exists employment_type public.employment_type not null default 'full_time',
  -- ⚠️ When probation or an internship ends. Owner: *"give me a notification:
  -- when a new employee is added or 3 months are completed, you have to enter a
  -- new salary for this employee."* A DATE rather than a computed "+3 months",
  -- because the term is a decision and not arithmetic — some are six months.
  add column if not exists review_due_on date;

comment on column public.employee_compensation.review_due_on is
  'When this person''s pay is due to be revisited — the end of a probation or '
  'an internship. Drives the reminder on the payroll screen. NULL for staff '
  'whose pay has no scheduled review.';

-- ── Every change to what somebody is paid, kept ─────────────────────────────
-- ⚠️ WHY THIS TABLE EXISTS. `employee_compensation` holds ONE figure per person
-- — what they are paid now. Raising it overwrites the old number, and then
-- nobody can answer "what was she on before April?" or "when did this change,
-- and who did it?". The posted ledger rows preserve what each MONTH cost, which
-- is the other half; this preserves the decision itself.
create table if not exists public.salary_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,

  previous_salary numeric(14, 2) check (previous_salary is null or previous_salary >= 0),
  new_salary      numeric(14, 2) not null check (new_salary >= 0),
  currency        text not null default 'PKR' check (char_length(currency) = 3),

  previous_type   public.employment_type,
  new_type        public.employment_type not null,

  -- The month from which the new figure applies.
  effective_from  date not null,
  reason          text,
  changed_by_id   uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists salary_history_by_user
  on public.salary_history (user_id, effective_from desc);

comment on table public.salary_history is
  'Every change to what a person is paid, and to how they are employed. Admin+ '
  'only, exactly like employee_compensation — this is the same information, '
  'over time.';

alter table public.salary_history enable row level security;

-- One policy, `for all`, Admin and above — migration 062's idiom, and the same
-- audience, because this is that table's history.
create policy salary_history_all on public.salary_history
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.salary_history to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE TOOL LIST THE OWNER NAMED
-- ════════════════════════════════════════════════════════════════════════════
-- *"Claude, ChatGPT, Canva, Flow, Capcut, Gemini API keys, anything like that."*
-- CapCut and a general API-keys line were missing. `on conflict do nothing`, so
-- a price or a rename made in the admin screen is never overwritten.
insert into public.subscriptions (name, slug, vendor, token, sort_order) values
  ('CapCut',   'capcut',   'ByteDance', 'project-promo',   60),
  ('API keys', 'api_keys', null,        'status-backlog',  70)
on conflict (slug) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n int;
begin
  -- The receipt rule must exist and must NOT be validated, or the migration
  -- either did not apply or has retroactively condemned the seeded history.
  if not exists (
    select 1 from pg_constraint
     where conname = 'expenses_manual_needs_receipt' and not convalidated
  ) then
    raise exception
      'expenses_manual_needs_receipt is missing or was validated. It must exist '
      'and stay NOT VALID until every legacy row carries a receipt.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'revenue_received_needs_proof' and not convalidated
  ) then
    raise exception 'revenue_received_needs_proof is missing or was validated.';
  end if;

  -- Salaries must be un-fileable by hand.
  if not (select posted_only from public.expense_categories where slug = 'salaries') then
    raise exception 'The salaries category is still filable by hand.';
  end if;

  -- And the trigger that enforces it must be attached.
  if not exists (
    select 1 from pg_trigger where tgname = 'expenses_posted_only' and not tgisinternal
  ) then
    raise exception 'The posted-only guard trigger is not attached to public.expenses.';
  end if;

  select count(*) into n from public.revenue_entries where status = 'received';
  raise notice 'Receipts required on new rows; % income rows carried across as received.', n;
  raise notice 'Tools now: %.', (select string_agg(name, ', ' order by sort_order)
                                   from public.subscriptions where is_active);
end $$;
