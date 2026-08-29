-- ============================================================================
-- 076 · INVOICES — owner request 2026-08-29
-- ----------------------------------------------------------------------------
-- Owner: *"You have to send an invoice to some project or someone… when I
-- create an invoice, first of all, its form should be a very intelligent and
-- very smart form… only super admin and admin can generate an invoice…
-- a proper PDF with my proper template… attach my signature to that PDF and
-- send it to the client's email."*
--
-- ── ⚠️ THIS EXTENDS `revenue_entries`. IT DOES NOT REPLACE IT. ─────────────
-- The obvious move is a new `invoices` table. It is wrong here, and the reason
-- is `revenue_payments` (073) and `sync_revenue_settlement` (074): every piece
-- of machinery that answers "how much has this client paid, and what is still
-- owed" already hangs off `revenue_entries.id`. A second table would mean the
-- receivables ledger, the client statement, the P&L and the settlement trigger
-- each had to ask two places and add them up — and adding two sources is how
-- the two come to disagree.
--
-- An invoice IS a piece of billed income. It is billed income that additionally
-- has a NUMBER, a due date, a document and a recipient. So:
--
--     invoice_no IS NULL      income recorded directly — cash, a job never
--                             invoiced. The existing "Record income" form.
--     invoice_no IS NOT NULL  an invoice. Has a PDF, a due date, a billed-to
--                             snapshot, and can be sent.
--
-- One predicate, no join, and every existing total keeps working untouched.
--
-- ── ⚠️ `amount_pkr` STAYS THE GRAND TOTAL ──────────────────────────────────
-- Tax is added below, and the temptation is to make `amount_pkr` the net and
-- put the total somewhere new. That would silently rewrite settlement: 074's
-- trigger marks an invoice paid when `collected >= amount_pkr`, so a taxed
-- invoice would read as paid in full while the tax was still outstanding.
-- `amount_pkr` is therefore what the client actually owes — subtotal plus tax —
-- and `subtotal_pkr` / `tax_pkr` are the breakdown. A constraint keeps the
-- three in agreement rather than trusting the application to.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · WHO IS BILLED — real columns on the project
-- ════════════════════════════════════════════════════════════════════════════
-- Owner chose "a proper client billing contact" over retyping it each month.
--
-- ⚠️ WHY NOT `type_fields`, WHICH ALREADY HOLDS A CONTACT. That JSONB carries
-- `contact_person` / `contact_email` — the person you ring about the work. An
-- accounts inbox is usually somebody else, there is no billing address in there
-- at all, and a jsonb key cannot be constrained, indexed or checked for a
-- plausible email. Billing details go on an invoice that leaves the building;
-- they earn real columns. The existing contact is backfilled below so nothing
-- already typed is lost.
alter table public.projects
  add column if not exists billing_name       text,
  add column if not exists billing_contact    text,
  add column if not exists billing_email      text,
  add column if not exists billing_phone      text,
  add column if not exists billing_address    text,
  -- Net terms. Owner chose per-client rather than one global rule: *"GC Royal
  -- Net 10, Daniyal Net 30"* is the shape real clients come in.
  add column if not exists payment_terms_days smallint not null default 10;

alter table public.projects drop constraint if exists projects_payment_terms_sane;
alter table public.projects
  add constraint projects_payment_terms_sane
  check (payment_terms_days between 0 and 180);

-- ⚠️ Shape only, not deliverability — a check constraint cannot know whether an
-- inbox exists. It catches the typo that would otherwise be discovered when an
-- invoice silently fails to arrive.
alter table public.projects drop constraint if exists projects_billing_email_shape;
alter table public.projects
  add constraint projects_billing_email_shape
  check (billing_email is null or billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

comment on column public.projects.billing_name is
  'The legal entity on the invoice — "GC Royal Emporium (Pvt) Ltd", which is '
  'not always the project name. Falls back to the project name when null.';
comment on column public.projects.payment_terms_days is
  'Net terms. An invoice issued today is due this many days from now (076).';

-- Carry across what was already typed into type_fields, without overwriting
-- anything set since. Daniyal Marketing is the one project that has these.
update public.projects
   set billing_contact = coalesce(billing_contact, nullif(btrim(type_fields ->> 'contact_person'), '')),
       billing_email   = coalesce(billing_email,   nullif(btrim(type_fields ->> 'contact_email'), '')),
       billing_phone   = coalesce(billing_phone,   nullif(btrim(type_fields ->> 'contact_phone'), '')),
       billing_name    = coalesce(billing_name,    nullif(btrim(type_fields ->> 'client_name'), ''))
 where type_fields ?| array['contact_person', 'contact_email', 'contact_phone', 'client_name'];

-- ⚠️ TEST DATA, AND IT IS LABELLED AS SUCH. Owner, 2026-08-29: *"for now
-- testing purpose use habibaminhas989@gmail.com email for GC royal project"*.
-- Only fills the gap — if a real accounts address is entered later this does
-- nothing, and re-running the migration will not overwrite it.
update public.projects
   set billing_email = 'habibaminhas989@gmail.com'
 where name = 'GC Royal Emporium' and coalesce(btrim(billing_email), '') = '';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · A SAVED SIGNATURE, PER PERSON
-- ════════════════════════════════════════════════════════════════════════════
-- Owner chose both: a signature drawn once in Settings and stamped on every
-- invoice, plus the option to draw a different one on a particular invoice.
--
-- ⚠️ THE PATH, NOT THE IMAGE. A signature is a few KB of PNG and it would fit
-- in a bytea column — but `public.users` is selected on nearly every page in
-- this application, and a bytea column is returned by `select *` whether or not
-- anybody wanted it. The path costs nothing to carry; the bytes are fetched
-- only by the one composer that draws them.
alter table public.users
  add column if not exists signature_path       text,
  add column if not exists signature_updated_at timestamptz;

comment on column public.users.signature_path is
  'Storage key of this person''s saved signature PNG, in the private bucket. '
  'Stamped on invoices they issue (076). Null until they draw one.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE INVOICE ITSELF
-- ════════════════════════════════════════════════════════════════════════════
alter table public.revenue_entries
  -- Identity. NULL on a plain income row — see the header.
  add column if not exists invoice_no      text,
  -- ⚠️ THE THIRD DATE, AND IT IS NOT A DUPLICATE OF THE OTHER TWO.
  --   earned_on   the accounting month this income belongs to (accrual)
  --   issued_on   the day the invoice was raised
  --   due_on      the day the client has to pay by
  -- A September retainer raised on the 28th of August and due on the 7th of
  -- September needs all three, and no two of them are the same day.
  add column if not exists issued_on       date,
  add column if not exists due_on          date,

  -- The money, broken out. `amount_pkr` remains the grand total — see header.
  add column if not exists subtotal_pkr    numeric(14, 2),
  add column if not exists tax_rate_pct    numeric(5, 2),
  add column if not exists tax_pkr         numeric(14, 2),

  -- ⚠️ A SNAPSHOT, NOT A JOIN. The invoice says who it was addressed to ON THE
  -- DAY IT WAS SENT. Joining to the project would rewrite history the moment
  -- somebody corrects a client's address: the copy in the client's inbox and
  -- the copy on screen would stop matching, and the screen would be the one
  -- that was wrong. Same reasoning as the audit log's denormalised actor.
  add column if not exists billed_to_name    text,
  add column if not exists billed_to_person  text,
  add column if not exists billed_to_email   text,
  add column if not exists billed_to_address text,

  -- What was actually sent, and when. `send_count` because re-sending is a real
  -- act — a client who says "I never got it" is answered by this row.
  add column if not exists sent_at    timestamptz,
  add column if not exists sent_to    text,
  add column if not exists send_count integer not null default 0,

  -- The generated document, in the private bucket.
  add column if not exists pdf_path text,

  -- Who signed it. The NAME and TITLE are snapshotted for the same reason as
  -- the address: people get promoted, and last year's invoice was signed by
  -- whoever they were then.
  add column if not exists signature_path  text,
  add column if not exists signed_by_id    uuid references public.users (id) on delete set null,
  add column if not exists signed_by_name  text,
  add column if not exists signed_by_title text,

  -- ⚠️ VOID IS NOT A STATUS, AND THAT IS DELIBERATE. `revenue_status` already
  -- has `written_off`, which means "we have given up collecting this" — a real
  -- financial event that belongs in the write-off figures. A void means the
  -- invoice should never have existed. Folding one into the other would inflate
  -- write-offs with clerical mistakes. So it is its own fact, and the ledger
  -- queries exclude voided rows entirely rather than counting them as anything.
  add column if not exists voided_at    timestamptz,
  add column if not exists void_reason  text,
  add column if not exists voided_by_id uuid references public.users (id) on delete set null,

  -- Shown ON the PDF, unlike `note`, which is internal. Two audiences, two
  -- columns — one field serving both is how an internal remark reaches a client.
  add column if not exists client_note text;

-- One number, once. The whole point of a series.
create unique index if not exists revenue_invoice_no_key
  on public.revenue_entries (invoice_no) where invoice_no is not null;

create index if not exists revenue_invoices_due
  on public.revenue_entries (due_on)
  where invoice_no is not null and voided_at is null;

-- ── The rules that keep an invoice coherent ────────────────────────────────
alter table public.revenue_entries drop constraint if exists revenue_invoice_has_dates;
alter table public.revenue_entries
  add constraint revenue_invoice_has_dates
  -- An invoice has both dates or is not an invoice. A due date on a row with no
  -- number is a promise nothing will ever chase.
  check (invoice_no is null or (issued_on is not null and due_on is not null));

alter table public.revenue_entries drop constraint if exists revenue_due_after_issue;
alter table public.revenue_entries
  add constraint revenue_due_after_issue
  check (due_on is null or issued_on is null or due_on >= issued_on);

alter table public.revenue_entries drop constraint if exists revenue_tax_pair;
alter table public.revenue_entries
  add constraint revenue_tax_pair
  -- Either both tax columns or neither. A rate with no amount is a number
  -- nobody can check, and an amount with no rate cannot be explained to a
  -- client who asks how it was worked out.
  check ((tax_rate_pct is null) = (tax_pkr is null));

alter table public.revenue_entries drop constraint if exists revenue_tax_rate_sane;
alter table public.revenue_entries
  add constraint revenue_tax_rate_sane
  check (tax_rate_pct is null or (tax_rate_pct >= 0 and tax_rate_pct <= 100));

alter table public.revenue_entries drop constraint if exists revenue_total_adds_up;
alter table public.revenue_entries
  add constraint revenue_total_adds_up
  -- ⚠️ THE ONE THAT MATTERS. subtotal + tax = the total the client owes and the
  -- figure every settlement check uses. Enforced here rather than trusted to
  -- the form, because a total that disagrees with its own breakdown is an
  -- invoice that cannot be defended in a conversation about money.
  --
  -- A rupee of tolerance: the total is rounded for presentation and 16% of an
  -- odd subtotal does not land on a whole rupee.
  check (
    subtotal_pkr is null
    or abs(amount_pkr - (subtotal_pkr + coalesce(tax_pkr, 0))) <= 1.00
  );

alter table public.revenue_entries drop constraint if exists revenue_void_has_reason;
alter table public.revenue_entries
  add constraint revenue_void_has_reason
  -- A void with no reason is an invoice that vanished. Six months later nobody
  -- can say whether it was a mistake or a cancelled job.
  check (voided_at is null or btrim(coalesce(void_reason, '')) <> '');

alter table public.revenue_entries drop constraint if exists revenue_sent_has_recipient;
alter table public.revenue_entries
  add constraint revenue_sent_has_recipient
  check (sent_at is null or btrim(coalesce(sent_to, '')) <> '');

comment on column public.revenue_entries.invoice_no is
  'Set = this row is an invoice with a document and a recipient. Null = income '
  'recorded directly, with no invoice (076).';
comment on column public.revenue_entries.amount_pkr is
  'What the client owes IN TOTAL, tax included. Settlement compares payments '
  'against this, so it must never be the net figure — see 076''s header.';
comment on column public.revenue_entries.voided_at is
  'A void is a clerical reversal, NOT a write-off. Voided rows are excluded '
  'from every ledger total rather than counted as abandoned income (076).';


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · WHAT IS ON THE INVOICE
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  revenue_id  uuid not null
    references public.revenue_entries (id) on delete cascade,

  -- Draw order. Not `created_at`: two lines added in one statement share a
  -- timestamp, and an invoice whose lines reshuffle between the screen and the
  -- PDF is an invoice nobody trusts.
  position    smallint not null,

  description text not null,
  quantity    numeric(10, 2) not null default 1,
  unit_price_pkr numeric(14, 2) not null,

  -- ⚠️ GENERATED, NOT WRITTEN. A line total that can be set independently of
  -- its own quantity and rate is a line that can print "2 × 15,000 = 40,000".
  -- Postgres computes it; no code path can disagree with it.
  amount_pkr  numeric(14, 2)
    generated always as (round(quantity * unit_price_pkr, 2)) stored,

  created_at  timestamptz not null default now(),

  constraint invoice_lines_description_present check (btrim(description) <> ''),
  constraint invoice_lines_quantity_positive   check (quantity > 0),
  constraint invoice_lines_price_sane          check (unit_price_pkr >= 0)
);

create unique index if not exists invoice_lines_order_key
  on public.invoice_lines (revenue_id, position);

comment on table public.invoice_lines is
  'The rows of an invoice. A monthly retainer is usually one; an add-on invoice '
  'is often several. amount_pkr is generated so it cannot contradict its own '
  'quantity and rate (076).';

alter table public.invoice_lines enable row level security;

-- The same audience as the invoice they belong to. A line is a figure.
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'invoice_lines_all') then
    create policy invoice_lines_all on public.invoice_lines
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end $$;

grant select, insert, update, delete on public.invoice_lines to cni_app;
revoke all on public.invoice_lines from anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · THE NUMBER SERIES
-- ════════════════════════════════════════════════════════════════════════════
-- Owner chose sequential per year: CNI-2026-0001, resetting each January.
--
-- ⚠️ WHY A TABLE AND A FUNCTION RATHER THAN `max(invoice_no) + 1`. Two admins
-- pressing Create in the same second both read the same maximum and both write
-- CNI-2026-0004; the unique index then refuses one of them, and the person sees
-- a database error for having been unlucky. The UPDATE below takes a row lock,
-- so the second waits for the first and gets 0005. It is also correct after a
-- void: a voided invoice keeps its number, and the series never reissues it —
-- which is exactly what an accountant looking for a gap needs.
create table if not exists public.invoice_number_series (
  year        smallint primary key,
  next_number integer  not null default 1,
  updated_at  timestamptz not null default now(),

  constraint invoice_series_year_sane   check (year between 2020 and 2100),
  constraint invoice_series_number_sane check (next_number >= 1)
);

comment on table public.invoice_number_series is
  'The next invoice number for each year. Claimed through '
  'app.claim_invoice_number, which locks the row so two admins cannot be '
  'handed the same number (076).';

alter table public.invoice_number_series enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'invoice_series_all') then
    create policy invoice_series_all on public.invoice_number_series
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end $$;

grant select, insert, update on public.invoice_number_series to cni_app;
revoke all on public.invoice_number_series from anon, authenticated;

create or replace function app.claim_invoice_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number integer;
begin
  -- Two statements rather than one clever upsert: the INSERT establishes the
  -- year, the UPDATE takes the lock and hands out the number. `on conflict do
  -- nothing` makes the first idempotent, so two callers racing on a brand-new
  -- year both proceed to the UPDATE and serialise there.
  insert into public.invoice_number_series (year, next_number)
       values (p_year, 1)
  on conflict (year) do nothing;

  update public.invoice_number_series
     set next_number = next_number + 1,
         updated_at  = now()
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end
$$;

comment on function app.claim_invoice_number(integer) is
  'Hands out the next invoice number for a year and advances the series. '
  'SECURITY DEFINER so the counter cannot be edited directly by a caller who '
  'may only claim from it. Numbers are never reused, including after a void.';

revoke all on function app.claim_invoice_number(integer) from public;
grant execute on function app.claim_invoice_number(integer) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · A SENT INVOICE IS FROZEN
-- ════════════════════════════════════════════════════════════════════════════
-- Owner chose "locked — void and reissue": once the client has the PDF, the
-- numbers on it may not change underneath them.
--
-- ⚠️ A TRIGGER, NOT A UI RULE. The form can decline to show an edit button and
-- that is worth doing, but it is not a guarantee — a server action, a script or
-- a future screen can all write to this table. The copy in the client's inbox
-- is the thing being protected, and only the database can protect it.
--
-- ⚠️ WHAT IS DELIBERATELY STILL ALLOWED. Everything that happens AFTER an
-- invoice is sent, and none of it changes what the client was shown:
-- recording payments (status, received_on, amount_paid_pkr — all written by
-- 074's trigger), sending it again, voiding it, and internal notes.
create or replace function public.freeze_sent_invoice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Not sent yet, or not an invoice at all: nothing is frozen.
  if old.sent_at is null then
    return new;
  end if;

  if new.invoice_no      is distinct from old.invoice_no
     or new.issued_on    is distinct from old.issued_on
     or new.due_on       is distinct from old.due_on
     or new.amount_pkr   is distinct from old.amount_pkr
     or new.subtotal_pkr is distinct from old.subtotal_pkr
     or new.tax_rate_pct is distinct from old.tax_rate_pct
     or new.tax_pkr      is distinct from old.tax_pkr
     or new.kind         is distinct from old.kind
     or new.earned_on    is distinct from old.earned_on
     or new.project_id   is distinct from old.project_id
     or new.billed_to_name    is distinct from old.billed_to_name
     or new.billed_to_person  is distinct from old.billed_to_person
     or new.billed_to_email   is distinct from old.billed_to_email
     or new.billed_to_address is distinct from old.billed_to_address
     or new.client_note       is distinct from old.client_note
     or new.signature_path    is distinct from old.signature_path
     or new.signed_by_name    is distinct from old.signed_by_name
     or new.signed_by_title   is distinct from old.signed_by_title
  then
    raise exception
      'Invoice % was sent to the client on %. Its figures cannot be changed — void it and issue a corrected one.',
      old.invoice_no, old.sent_at::date
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists revenue_entries_freeze_sent on public.revenue_entries;
create trigger revenue_entries_freeze_sent
  before update on public.revenue_entries
  for each row execute function public.freeze_sent_invoice();

-- The lines are half of what the client was shown, so they freeze with it.
create or replace function public.freeze_sent_invoice_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sent timestamptz;
  v_no   text;
begin
  select sent_at, invoice_no into v_sent, v_no
    from public.revenue_entries
   where id = coalesce(new.revenue_id, old.revenue_id);

  -- The parent is already gone — a cascading delete takes its lines with it.
  if not found then
    return coalesce(new, old);
  end if;

  if v_sent is not null then
    raise exception
      'Invoice % was already sent. Its lines cannot be changed — void it and issue a corrected one.',
      v_no
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end
$$;

drop trigger if exists invoice_lines_freeze_sent on public.invoice_lines;
create trigger invoice_lines_freeze_sent
  before insert or update or delete on public.invoice_lines
  for each row execute function public.freeze_sent_invoice_lines();


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · THE LETTERHEAD
-- ════════════════════════════════════════════════════════════════════════════
-- What goes at the top of the PDF and in the "how to pay" block.
--
-- ⚠️ A SETTING, NOT A CONSTANT IN THE CODE. An address changes, a bank account
-- changes, and a tax registration arrives — none of those should be a deploy.
-- `system_settings` is readable by anybody signed in, which is right for this:
-- every one of these values is printed on a document that is sent OUT of the
-- company. There is nothing here that a colleague may not see.
insert into public.system_settings (key, value)
values (
  -- ⚠️ snake_case with no dots: `system_settings_key_shaped` is
  -- `^[a-z][a-z0-9_]*$`, and 'invoice.company' is refused by it.
  'invoice_company',
  jsonb_build_object(
    'legalName',    'Crescent Nova International',
    'division',     'AI & Digital Division',
    -- ⚠️ EMPTY ON PURPOSE, NOT INVENTED. An address or a bank account made up
    -- to fill a template is a wrong number on a document a client will pay
    -- against. The PDF omits any block whose fields are blank, and Settings →
    -- Invoicing is where they are filled in.
    'addressLines', jsonb_build_array(),
    'phone',        '',
    'email',        '',
    'website',      '',
    'ntn',          '',
    'strn',         '',
    'bankName',     '',
    'bankTitle',    '',
    'bankAccount',  '',
    'bankIban',     '',
    'invoicePrefix','CNI',
    -- Owner chose 16%, switched OFF by default — see the form.
    'defaultTaxRatePct', 16,
    'taxLabel',     'GST',
    'footerNote',   'Thank you for your business.'
  )
)
on conflict (key) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid;
  v_proj  uuid;
  v_inv   uuid;
  v_n1    integer;
  v_n2    integer;
  v_total numeric;
begin
  select id into v_admin from public.users where role in ('super_admin', 'admin') limit 1;
  select id into v_proj  from public.projects where is_draft = false limit 1;

  if v_admin is null then
    raise notice '076 · no admin to test with; structural checks only';
    return;
  end if;

  -- ── The series hands out consecutive numbers and never repeats ───────────
  v_n1 := app.claim_invoice_number(2099);
  v_n2 := app.claim_invoice_number(2099);
  if v_n2 <> v_n1 + 1 then
    raise exception '076 · the invoice series repeated or skipped: % then %', v_n1, v_n2;
  end if;

  -- ── An invoice with lines, tax, and a total that adds up ────────────────
  insert into public.revenue_entries
    (kind, project_id, amount_pkr, subtotal_pkr, tax_rate_pct, tax_pkr,
     earned_on, issued_on, due_on, invoice_no, billed_to_name, billed_to_email,
     status, created_by_id)
  values
    ('retainer', v_proj, 139200.00, 120000.00, 16.00, 19200.00,
     '2099-01-01', '2099-01-01', '2099-01-11', '076-SELFCHECK-1',
     'Self Check Ltd', 'selfcheck@example.com', 'invoiced', v_admin)
  returning id into v_inv;

  insert into public.invoice_lines (revenue_id, position, description, quantity, unit_price_pkr)
  values (v_inv, 1, 'Social media management', 1, 120000.00);

  -- The generated column computes its own total.
  select amount_pkr into v_total from public.invoice_lines where revenue_id = v_inv;
  if v_total <> 120000.00 then
    raise exception '076 · a line total was not generated correctly: %', v_total;
  end if;

  -- ── A total that disagrees with its breakdown is refused ────────────────
  begin
    update public.revenue_entries set amount_pkr = 999999 where id = v_inv;
    raise exception '076 · A TOTAL WAS ALLOWED TO CONTRADICT ITS OWN SUBTOTAL AND TAX';
  exception when check_violation then null;
  end;

  -- ── Two invoices cannot share a number ──────────────────────────────────
  begin
    insert into public.revenue_entries
      (kind, project_id, amount_pkr, earned_on, issued_on, due_on, invoice_no, status, created_by_id)
    values
      ('one_off', v_proj, 1000, '2099-01-01', '2099-01-01', '2099-01-11',
       '076-SELFCHECK-1', 'invoiced', v_admin);
    raise exception '076 · TWO INVOICES WERE ALLOWED TO SHARE A NUMBER';
  exception when unique_violation then null;
  end;

  -- ── A void must say why ─────────────────────────────────────────────────
  begin
    update public.revenue_entries set voided_at = now() where id = v_inv;
    raise exception '076 · AN INVOICE WAS VOIDED WITH NO REASON';
  exception when check_violation then null;
  end;

  -- ── Once sent, the figures are frozen ───────────────────────────────────
  update public.revenue_entries
     set sent_at = now(), sent_to = 'selfcheck@example.com', send_count = 1
   where id = v_inv;

  begin
    update public.revenue_entries
       set subtotal_pkr = 1, tax_pkr = 0, amount_pkr = 1 where id = v_inv;
    raise exception '076 · A SENT INVOICE WAS EDITED';
  exception when check_violation then null;
  end;

  begin
    insert into public.invoice_lines (revenue_id, position, description, quantity, unit_price_pkr)
    values (v_inv, 2, 'Snuck in after sending', 1, 50000);
    raise exception '076 · A LINE WAS ADDED TO A SENT INVOICE';
  exception when check_violation then null;
  end;

  -- ...but recording a payment against it still works, which is the point.
  update public.revenue_entries set status = 'invoiced', note = 'chased' where id = v_inv;

  -- ── ...and voiding it, with a reason, is still allowed ──────────────────
  update public.revenue_entries
     set voided_at = now(), void_reason = 'self-check', voided_by_id = v_admin
   where id = v_inv;

  -- Clean up. The lines go with it — `on delete cascade`.
  delete from public.revenue_entries where id = v_inv;
  delete from public.invoice_number_series where year = 2099;

  raise notice '076 · invoices ready: numbered, lined, taxed, frozen once sent';
end
$$;
