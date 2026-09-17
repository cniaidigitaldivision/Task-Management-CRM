-- ============================================================================
-- 194 · BOOKINGS AND INVOICES — the two steps after a quotation
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, with five designs for the drawer's Related items: Quotations,
-- Properties, Appointments, **Bookings**, **Invoices**. The first three are rows
-- we already keep. The last two had no table at all — their panels in the design
-- are marked *"Demo data"*, and a CRM that invented figures on a client's record
-- would be worse than one that admitted the gap.
--
-- ── ⚠️ THE RULES ARE THE OWNER'S OWN, WRITTEN INTO THE DESIGN ──────────────
-- The mock states three, and they are the reason this is a table rather than a
-- status field on the quotation:
--
--   1. *"Quotation does not reserve the plot."*      → a booking is its own row.
--   2. *"Pending booking cannot mark the lead Won."* → Won needs a CONFIRMED one.
--   3. *"Sales consultant cannot verify payments."*  → verification is Finance's.
--
-- ⚠️ RULE 3 IS ENFORCED BY A TRIGGER, NOT BY A SCREEN. A salesperson may create a
-- booking and ask for it to be checked; the money columns move only for Finance
-- or an admin. A button that hid the option would be a UI convention; this is a
-- rule.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_booking_status') then
    create type public.crm_booking_status as enum (
      'requested',             -- the client has agreed and the salesperson wrote it down
      'pending_verification',  -- money is claimed; Finance has not confirmed it
      'confirmed',             -- Finance has seen the payment
      'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_invoice_status') then
    create type public.crm_invoice_status as enum ('unpaid', 'part_paid', 'paid', 'void');
  end if;
end $$;

/* ⚠️ HUMAN NUMBERS, FROM A SEQUENCE. BK-301 is what somebody says on the phone;
   a uuid is not. The offsets match the owner's own examples so the demo data and
   the real thing read alike. */
create sequence if not exists public.crm_booking_no_seq start 301;
create sequence if not exists public.crm_invoice_no_seq start 501;

create table if not exists public.crm_bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  property_id uuid references public.crm_properties (id) on delete set null,
  /* The quotation this booking is against — the price everybody agreed. */
  quotation_id uuid references public.crm_quotations (id) on delete set null,

  number text not null unique default ('BK-' || nextval('public.crm_booking_no_seq')),
  status public.crm_booking_status not null default 'requested',

  /* What the booking costs, and what Finance has actually seen. */
  amount          numeric(14, 2) not null check (amount > 0),
  verified_amount numeric(14, 2) not null default 0 check (verified_amount >= 0),

  requested_at   timestamptz not null default now(),
  verification_requested_at timestamptz,
  verified_at    timestamptz,
  verified_by_id uuid references public.users (id) on delete set null,
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,

  notes text,
  is_test_data boolean not null default false,
  created_by_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* ⚠️ A CONFIRMED BOOKING HAS BEEN SEEN BY SOMEBODY, and the row says who and
     when. "Confirmed" with nothing behind it is the one state this table exists
     to prevent. */
  constraint crm_bookings_confirmed_is_evidenced check (
    status <> 'confirmed' or (verified_at is not null and verified_by_id is not null)
  ),
  constraint crm_bookings_cancelled_has_reason check (
    status <> 'cancelled' or (cancelled_at is not null and btrim(coalesce(cancel_reason, '')) <> '')
  )
);

create index if not exists crm_bookings_lead_idx on public.crm_bookings (lead_id, created_at desc);
create index if not exists crm_bookings_project_idx on public.crm_bookings (project_id, status);

create table if not exists public.crm_invoices (
  id uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.crm_leads (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  booking_id uuid references public.crm_bookings (id) on delete set null,
  quotation_id uuid references public.crm_quotations (id) on delete set null,
  property_id  uuid references public.crm_properties (id) on delete set null,

  number text not null unique default ('INV-' || nextval('public.crm_invoice_no_seq')),
  /* What it is for, in the client's language: "Booking deposit", "Instalment 3". */
  description text not null check (btrim(description) <> ''),

  amount      numeric(14, 2) not null check (amount > 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  status public.crm_invoice_status not null default 'unpaid',

  issued_at date not null default (now() at time zone 'Asia/Karachi')::date,
  due_at    date,
  /* The letter itself, once somebody has one to attach. */
  pdf_path text,

  notes text,
  is_test_data boolean not null default false,
  created_by_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_invoices_due_after_issue check (due_at is null or due_at >= issued_at),
  constraint crm_invoices_paid_within_amount check (paid_amount <= amount)
);

create index if not exists crm_invoices_lead_idx on public.crm_invoices (lead_id, issued_at desc);

comment on table public.crm_bookings is
  'A booking against a quotation. ⚠️ A quotation does not reserve anything; this does — and only once Finance has verified the money. 194.';
comment on table public.crm_invoices is
  'What the client owes for a booking or an instalment. 194.';


-- ════════════════════════════════════════════════════════════════════════════
-- WHO MAY MOVE THE MONEY
-- ----------------------------------------------------------------------------
-- ⚠️ THE OWNER'S THIRD RULE, AS A TRIGGER. The salesperson who took the booking
-- may write it, ask for verification, cancel it and annotate it. Confirming it —
-- and the verified figure it rests on — belongs to Finance or an admin, and a
-- trigger is the only place that cannot be talked out of by a form.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_bookings_guard_money()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_finance boolean;
begin
  v_finance := app.acting_at_least('admin'::public.user_role)
               or app.acting_department_key() = 'finance';

  if tg_op = 'INSERT' then
    if not v_finance and (new.status = 'confirmed' or new.verified_amount <> 0) then
      raise exception using
        errcode = 'CRM94',
        message = 'Only Finance can confirm a booking or record a verified payment.';
    end if;
    return new;
  end if;

  if not v_finance
     and (new.verified_amount is distinct from old.verified_amount
          or (new.status = 'confirmed' and old.status is distinct from 'confirmed')
          or new.verified_at is distinct from old.verified_at
          or new.verified_by_id is distinct from old.verified_by_id) then
    raise exception using
      errcode = 'CRM94',
      message = 'Only Finance can confirm a booking or record a verified payment.';
  end if;

  /* Whoever verified it is whoever is acting — never a value posted from a form. */
  if v_finance and new.verified_amount is distinct from old.verified_amount then
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by_id := app.current_user_id();
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists crm_bookings_guard_money on public.crm_bookings;
create trigger crm_bookings_guard_money
  before insert or update on public.crm_bookings
  for each row execute function app.crm_bookings_guard_money();

/* An invoice follows its payments: the status is never typed, it is derived. */
create or replace function app.crm_invoices_status_follows_payment()
returns trigger
language plpgsql
as $fn$
begin
  if new.status <> 'void' then
    new.status := case
      when new.paid_amount <= 0 then 'unpaid'
      when new.paid_amount >= new.amount then 'paid'
      else 'part_paid'
    end::public.crm_invoice_status;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists crm_invoices_status_follows_payment on public.crm_invoices;
create trigger crm_invoices_status_follows_payment
  before insert or update on public.crm_invoices
  for each row execute function app.crm_invoices_status_follows_payment();


-- ════════════════════════════════════════════════════════════════════════════
-- WHO MAY SEE THEM — the lead decides, as everywhere else in this module
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_bookings enable row level security;
alter table public.crm_invoices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'crm_bookings_select') then
    create policy crm_bookings_select on public.crm_bookings
      for select to cni_app using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_bookings_write') then
    create policy crm_bookings_write on public.crm_bookings
      for all to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_invoices_select') then
    create policy crm_invoices_select on public.crm_invoices
      for select to cni_app using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_invoices_write') then
    create policy crm_invoices_write on public.crm_invoices
      for all to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
end $$;

grant select, insert, update on public.crm_bookings to cni_app;
grant select, insert, update on public.crm_invoices to cni_app;
grant usage on sequence public.crm_booking_no_seq to cni_app;
grant usage on sequence public.crm_invoice_no_seq to cni_app;
revoke all on public.crm_bookings, public.crm_invoices from anon, authenticated;

/* ⚠️ AND A QUOTATION MAY CARRY ITS OWN PDF, uploaded by hand. `pdf_path` has
   existed since 151 and nothing has ever written it; the Related items dialog
   now can. The column-level grant is what 166 exists to remind us about. */
grant update (pdf_path) on public.crm_quotations to cni_app;


-- ============================================================================
-- SELF-CHECK — as cni_app, as a salesperson and as Finance; fixtures rolled back
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_finance uuid; v_lead uuid; v_quote uuid;
  v_booking uuid; v_invoice uuid;
  v_number text; v_status text; v_inv_status text;
  n_sales_confirm int := -1; n_finance_confirm int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data limit 1;
  select u.id into v_finance
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'finance' and u.is_active limit 1;
  if v_lead is null then
    raise exception '194 · no demo lead — refusing to skip the check';
  end if;
  if v_finance is null then
    /* ⚠️ NOT SKIPPED. Admin stands in for Finance, and the check still proves
       that a salesperson cannot confirm — which is the rule that matters. */
    select id into v_finance from public.users where role in ('admin', 'super_admin') and is_active limit 1;
  end if;

  select id into v_quote from public.crm_quotations where lead_id = v_lead order by created_at desc limit 1;

  begin
    -- ── A salesperson takes a booking ───────────────────────────────────
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    insert into public.crm_bookings (lead_id, project_id, quotation_id, amount, notes, is_test_data, created_by_id)
    values (v_lead, v_project, v_quote, 900000, 'SELFCHECK-194', true, v_sales)
    returning id, number into v_booking, v_number;

    -- …and asks for it to be checked
    update public.crm_bookings
       set status = 'pending_verification', verification_requested_at = now()
     where id = v_booking;

    -- ⚠️ …but cannot confirm it, or move the verified figure
    begin
      update public.crm_bookings set verified_amount = 900000, status = 'confirmed' where id = v_booking;
      n_sales_confirm := 1;
    exception when sqlstate 'CRM94' then n_sales_confirm := 0;
    end;
    reset role;

    -- ── Finance can ──────────────────────────────────────────────────────
    set local role cni_app;
    perform set_config('app.user_id', v_finance::text, true);
    begin
      update public.crm_bookings
         set verified_amount = 900000, status = 'confirmed', confirmed_at = now()
       where id = v_booking;
      n_finance_confirm := 1;
    exception when sqlstate 'CRM94' then n_finance_confirm := 0;
    end;
    reset role;

    select status::text into v_status from public.crm_bookings where id = v_booking;

    -- ── An invoice follows its payments ──────────────────────────────────
    insert into public.crm_invoices (lead_id, project_id, booking_id, description, amount, due_at, is_test_data, created_by_id)
    values (v_lead, v_project, v_booking, 'SELFCHECK-194 deposit', 900000,
            (now() at time zone 'Asia/Karachi')::date + 7, true, v_sales)
    returning id into v_invoice;
    update public.crm_invoices set paid_amount = 400000 where id = v_invoice;
    select status::text into v_inv_status from public.crm_invoices where id = v_invoice;

    raise exception using errcode = 'P0194', message = '194 rollback';
  exception when sqlstate 'P0194' then
    null;
  end;

  if v_number is null or v_number not like 'BK-%' then
    raise exception '194 · a booking did not get a readable number (got %)', coalesce(v_number, 'null');
  end if;
  if n_sales_confirm <> 0 then
    raise exception '194 · a salesperson confirmed their own booking';
  end if;
  if n_finance_confirm <> 1 then
    raise exception '194 · Finance could not confirm a booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception '194 · the confirmed booking did not stick (%)', v_status;
  end if;
  if v_inv_status <> 'part_paid' then
    raise exception '194 · an invoice paid in part reads as % rather than part_paid', v_inv_status;
  end if;
  if exists (select 1 from public.crm_bookings where notes = 'SELFCHECK-194') then
    raise exception '194 · the self-check left rows behind';
  end if;

  raise notice '194 · a salesperson takes a booking and asks for it to be checked; only Finance confirms it; an invoice follows its payments';
end $chk$;
