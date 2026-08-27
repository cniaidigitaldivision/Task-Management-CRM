-- ============================================================================
-- 073 · A CLIENT MAY PAY AN INVOICE MORE THAN ONCE
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-27:
--
--   "It's not possible that in some project they are giving money in one go.
--    Maybe they are giving two monies in pieces, two times or three times, in
--    one month. How can I manage that? Right now I can see that this project is
--    not being handled properly."
--
-- ── ⚠️ WHAT WAS WRONG, IN ACCOUNTING TERMS ─────────────────────────────────
-- Migration 064 modelled income as ONE ROW carrying both what was billed and
-- when it arrived: `amount_pkr`, `received_on`, and later a single `proof_path`.
-- That is a cash book, not a ledger, and it cannot express the single most
-- ordinary thing a client does — pay 50,000 of a 120,000 invoice on the 5th and
-- the rest on the 22nd.
--
-- Everything an owner actually wants to know is unanswerable in that shape:
--
--   · how much of this invoice is still outstanding
--   · when the money came in, and in what pieces
--   · which bank reference matches which part of the payment
--   · proof for EACH receipt, not one file standing for the whole invoice
--
-- The fix is the standard one, and it is standard because it is right: an
-- invoice is one thing and a receipt against it is another. `revenue_entries`
-- stays as the INVOICE — what was billed, to whom, for which month. Money
-- arriving becomes rows in `revenue_payments`, as many as it takes.
--
-- ── ⚠️ THE PARENT KEEPS A MAINTAINED TOTAL, AND THAT IS DELIBERATE ─────────
-- `amount_paid_pkr` could be a subquery every time. It is a stored column kept
-- honest by a trigger instead, because the collected figure is read on the
-- finance hero, on every row of the ledger, in the monthly report and by the
-- assistant's finance tool — and a correlated aggregate in all four is how a
-- page that used to take 200ms starts taking two seconds with no code change to
-- blame. The trigger is the only writer; nothing else may set it.
--
-- ── ⚠️ NOTHING IS LOST: THE EXISTING ROWS ARE MIGRATED, NOT DROPPED ────────
-- Every entry already marked received becomes a single payment for its full
-- amount, carrying its existing date and proof. So the history reads exactly as
-- it did, and it is now in a shape that can hold the second instalment.
-- ============================================================================

-- ── How the money arrived ───────────────────────────────────────────────────
-- Not free text. "Bank", "bank transfer", "Transfer" and "IBFT" are the same
-- method typed four ways, and a column that allows all four cannot answer "how
-- much came through the bank this month".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum
      ('bank_transfer', 'cash', 'cheque', 'online', 'other');
  end if;
end $$;

comment on type public.payment_method is
  'How a client paid. `online` covers card and wallet rails (JazzCash, Easypaisa); '
  '`bank_transfer` is an IBFT or a deposit; `other` exists so a real receipt is '
  'never blocked by a missing enum value.';


-- ════════════════════════════════════════════════════════════════════════════
-- RECEIPTS AGAINST AN INVOICE
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.revenue_payments (
  id         uuid primary key default gen_random_uuid(),

  -- ⚠️ `on delete cascade`. A receipt has no meaning without the invoice it
  -- settles, and an orphan row would silently keep counting toward collected
  -- income for a bill that no longer exists.
  revenue_id uuid not null
    references public.revenue_entries (id) on delete cascade,

  -- ⚠️ `> 0`, not `>= 0`. A zero-value receipt records nothing and would sit in
  -- the payment history as a line nobody can explain.
  amount_pkr numeric(14, 2) not null check (amount_pkr > 0),

  -- THE DATE THE MONEY ARRIVED. Unlike the invoice's `earned_on`, this is a
  -- cash date and may fall in a different month — which is exactly the gap
  -- between "earned in August" and "collected in September" that the owner
  -- needs to see.
  received_on date not null,

  method public.payment_method not null default 'bank_transfer',

  -- The bank's own reference, so a line here can be matched against a
  -- statement. Free text on purpose: every rail formats these differently.
  reference text,

  -- ⚠️ PROOF PER RECEIPT, NOT PER INVOICE. This is the other half of the bug.
  -- One `proof_path` on the invoice meant the second instalment either
  -- overwrote the first screenshot or went unevidenced. Owner, on expenses:
  -- *"It's not about trust, it's about accuracy."* The same applies here.
  proof_path       text,
  proof_name       text,
  proof_mime       text,
  proof_size_bytes bigint,

  note text,

  created_by_id uuid not null references public.users (id),
  created_at    timestamptz not null default now()
);

-- Every read is "the payments for this invoice, in order".
create index if not exists revenue_payments_by_entry
  on public.revenue_payments (revenue_id, received_on);

-- And "what came in during this period", for the collections view.
create index if not exists revenue_payments_by_date
  on public.revenue_payments (received_on desc);

comment on table public.revenue_payments is
  'Money actually received against an invoice. Many rows per invoice: a client '
  'paying in two or three instalments is the ordinary case, not the exception. '
  'The invoice keeps what was BILLED; these keep what ARRIVED.';

alter table public.revenue_payments enable row level security;

-- ⚠️ The same audience as `revenue_entries` — Admin and above, read and write.
-- The owner gave the Coordinator expenses only, and income is not among them.
-- Stated as one `for all` policy, matching 064's idiom for the parent table.
create policy revenue_payments_all on public.revenue_payments
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

grant select, insert, update, delete on public.revenue_payments to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THE INVOICE NOW CARRIES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.revenue_entries
  -- ⚠️ MAINTAINED BY THE TRIGGER BELOW AND BY NOTHING ELSE. See the header for
  -- why it is stored rather than computed on read.
  add column if not exists amount_paid_pkr numeric(14, 2) not null default 0;

comment on column public.revenue_entries.amount_paid_pkr is
  'Sum of public.revenue_payments for this invoice. Maintained by trigger — do '
  'NOT write it from the application. Outstanding is amount_pkr minus this.';

comment on column public.revenue_entries.received_on is
  'The date the invoice was SETTLED IN FULL, or null while anything is still '
  'outstanding. Derived from the payments by trigger. For the date an individual '
  'instalment arrived, read public.revenue_payments.';


-- ── ⚠️ THE OLD "RECEIVED NEEDS PROOF" RULE MOVES DOWN A LEVEL ──────────────
-- 065 required `proof_path` on the invoice once it was marked received. With
-- instalments that is the wrong place for it: three payments and one proof
-- column means two of them go unevidenced. The requirement is not relaxed, it
-- is applied per receipt below.
alter table public.revenue_entries
  drop constraint if exists revenue_received_needs_proof;

-- ⚠️ `NOT VALID`, for the reason 065 records at length: the seeded history and
-- the rows backfilled below predate the rule, and inventing proof for them
-- would be worse than admitting they came first. New receipts are checked.
alter table public.revenue_payments
  drop constraint if exists revenue_payment_needs_proof;
alter table public.revenue_payments
  add constraint revenue_payment_needs_proof
  check (proof_path is not null)
  not valid;


-- ════════════════════════════════════════════════════════════════════════════
-- KEEPING THE INVOICE HONEST
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ SECURITY DEFINER with a pinned search_path. The trigger writes to
-- `revenue_entries`, and the caller is `cni_app` under RLS — an Admin passes
-- that policy, but the function must not depend on the caller's rights to keep
-- a derived total correct. A definer without `set search_path` is the classic
-- escalation hole; pinning it closes that.
create or replace function public.sync_revenue_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  target   uuid := coalesce(new.revenue_id, old.revenue_id);
  billed   numeric(14, 2);
  collected numeric(14, 2);
  last_paid date;
  current_status public.revenue_status;
begin
  select amount_pkr, status into billed, current_status
    from public.revenue_entries where id = target;

  -- The parent is already gone — a cascading delete. Nothing to keep in step.
  if not found then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_pkr), 0), max(received_on)
    into collected, last_paid
    from public.revenue_payments
   where revenue_id = target;

  update public.revenue_entries
     set amount_paid_pkr = collected,

         -- ⚠️ Set only when the invoice is FULLY settled. Half-paid is not
         -- "received on the 5th"; it is outstanding, and the outstanding index
         -- depends on this staying null until the balance is nil.
         received_on = case when collected >= billed then last_paid else null end,

         -- ⚠️ `written_off` and `returned` are TERMINAL DECISIONS a person
         -- took, and a payment arriving must not quietly reverse one. A refund
         -- against a returned invoice is still a returned invoice.
         status = case
           when current_status in ('written_off', 'returned') then current_status
           when collected >= billed then 'received'::public.revenue_status
           -- ⚠️ Falls back to `invoiced`, not to `pending`. A payment was
           -- deleted or reduced; the bill was certainly issued, so claiming it
           -- was never sent would be a worse lie than the one being corrected.
           when current_status = 'received' then 'invoiced'::public.revenue_status
           else current_status
         end
   where id = target;

  return coalesce(new, old);
end $$;

comment on function public.sync_revenue_settlement() is
  'Keeps revenue_entries.amount_paid_pkr, received_on and status in step with '
  'the payments beneath them. The only writer of amount_paid_pkr.';

drop trigger if exists revenue_payments_sync on public.revenue_payments;
create trigger revenue_payments_sync
  after insert or update or delete on public.revenue_payments
  for each row execute function public.sync_revenue_settlement();


-- ════════════════════════════════════════════════════════════════════════════
-- BRING THE EXISTING HISTORY ACROSS
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ Every invoice already marked received becomes ONE payment for its full
-- amount, carrying the date and the proof it already had. Nothing is invented
-- and nothing is dropped: after this the screens read exactly as before, and
-- the second instalment now has somewhere to go.
--
-- ⚠️ Guarded by `not exists`, so re-running this migration cannot double-count.
insert into public.revenue_payments
  (revenue_id, amount_pkr, received_on, method, reference,
   proof_path, proof_name, proof_mime, proof_size_bytes, note, created_by_id)
select r.id,
       r.amount_pkr,
       r.received_on,
       'bank_transfer',
       r.invoice_ref,
       r.proof_path, r.proof_name, r.proof_mime, r.proof_size_bytes,
       'Brought forward when instalments were introduced.',
       r.created_by_id
  from public.revenue_entries r
 where r.status = 'received'
   and r.received_on is not null
   and not exists (
     select 1 from public.revenue_payments p where p.revenue_id = r.id
   );

-- ⚠️ And the invoices that were NOT settled still need their maintained total
-- set, because the trigger only fires on rows that had a payment inserted
-- above. Without this they would sit at the column default of 0 — which is the
-- right number, but arrived at by luck rather than by the rule.
update public.revenue_entries r
   set amount_paid_pkr = coalesce(
         (select sum(p.amount_pkr) from public.revenue_payments p
           where p.revenue_id = r.id), 0);


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This migration runs as the owning role, which bypasses RLS — so nothing
-- here proves what an Admin or a Coordinator can see. What it CAN prove is that
-- the derived total agrees with the payments beneath it, which is the one thing
-- a stored aggregate can get silently wrong.
do $$
declare
  drifted integer;
  settled_without_date integer;
begin
  select count(*) into drifted
    from public.revenue_entries r
   where r.amount_paid_pkr <> coalesce(
           (select sum(p.amount_pkr) from public.revenue_payments p
             where p.revenue_id = r.id), 0);

  if drifted > 0 then
    raise exception
      'amount_paid_pkr disagrees with the payments on % invoice(s).', drifted;
  end if;

  -- A fully-settled invoice must carry the date it was settled, or the
  -- outstanding index and every "what is still owed" query quietly disagree.
  select count(*) into settled_without_date
    from public.revenue_entries r
   where r.amount_paid_pkr >= r.amount_pkr
     and r.amount_pkr > 0
     and r.received_on is null;

  if settled_without_date > 0 then
    raise exception
      '% invoice(s) are paid in full but carry no settlement date.',
      settled_without_date;
  end if;

  raise notice
    'Instalments: % payment row(s) across % invoice(s).',
    (select count(*) from public.revenue_payments),
    (select count(distinct revenue_id) from public.revenue_payments);
end $$;
