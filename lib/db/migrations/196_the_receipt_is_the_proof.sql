-- ============================================================================
-- 196 · THE RECEIPT IS THE PROOF — who sends, who uploads, who approves
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, correcting how 194/195 read on screen:
--
--   *"Definitely you are saying that the salesperson cannot verify the payment
--   but invoices can be generated. If he is dealing with the quotation in which
--   the prices are mentioned, like 50% advance or whatever the terms are, he will
--   make sure that the invoice is sent. Once approved they will approve and
--   upload that invoice, or you can say, payment receipt as proof."*
--
-- So the split is not "Finance owns invoices". It is:
--
--   THE SALESPERSON    raises the invoice from the quotation's own terms,
--                      sends it to the client, and uploads the receipt the
--                      client sends back — the PROOF.
--   FINANCE            looks at that proof and approves the payment.
--
-- 195 already reserved the money column. What was missing is everything around
-- it: when it went out, what came back, and who put it there.
--
-- ⚠️ THE PROOF IS NOT THE PAYMENT. Uploading a receipt does not mark anything
-- paid — that is exactly the door this keeps shut. It gives Finance something to
-- look at, and the trigger from 195 still decides what counts as received.
-- ============================================================================

do $$
begin
  /* A receipt and an invoice are documents in their own right — the shelf, the
     email attachments and the sequence steps all read `crm_documents`. */
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'crm_document_kind' and e.enumlabel = 'receipt'
  ) then
    alter type public.crm_document_kind add value 'receipt';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'crm_document_kind' and e.enumlabel = 'invoice'
  ) then
    alter type public.crm_document_kind add value 'invoice';
  end if;
end $$;

alter table public.crm_invoices
  /* When the salesperson sent it to the client, and how. */
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by_id uuid references public.users (id) on delete set null,
  /* What the client sent back. */
  add column if not exists receipt_path text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists receipt_uploaded_by_id uuid references public.users (id) on delete set null;

alter table public.crm_bookings
  add column if not exists receipt_path text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists receipt_uploaded_by_id uuid references public.users (id) on delete set null;

comment on column public.crm_invoices.receipt_path is
  'The payment receipt the client sent back, uploaded by whoever is working the lead. ⚠️ EVIDENCE, NOT A PAYMENT — 195''s trigger still decides what has been received. 196.';

/* ⚠️ COLUMN-LEVEL GRANTS, which is what 166 exists to remind us about: a new
   column on a table `cni_app` can already write is unwritable until it is named.
   The money columns are deliberately NOT here — 194 and 195 own those. */
grant update (sent_at, sent_by_id, receipt_path, receipt_uploaded_at, receipt_uploaded_by_id, notes, pdf_path)
  on public.crm_invoices to cni_app;
grant update (receipt_path, receipt_uploaded_at, receipt_uploaded_by_id, notes,
              status, verification_requested_at, cancelled_at, cancel_reason)
  on public.crm_bookings to cni_app;

/* Whoever uploaded it is whoever is acting — never a value posted from a form. */
create or replace function app.crm_stamp_receipt()
returns trigger
language plpgsql
as $fn$
begin
  if new.receipt_path is distinct from old.receipt_path and new.receipt_path is not null then
    new.receipt_uploaded_at := now();
    new.receipt_uploaded_by_id := app.current_user_id();
  end if;
  if tg_table_name = 'crm_invoices'
     and new.sent_at is distinct from old.sent_at and new.sent_at is not null then
    new.sent_by_id := coalesce(new.sent_by_id, app.current_user_id());
  end if;
  return new;
end;
$fn$;

drop trigger if exists crm_invoices_stamp_receipt on public.crm_invoices;
create trigger crm_invoices_stamp_receipt
  before update on public.crm_invoices
  for each row execute function app.crm_stamp_receipt();

drop trigger if exists crm_bookings_stamp_receipt on public.crm_bookings;
create trigger crm_bookings_stamp_receipt
  before update on public.crm_bookings
  for each row execute function app.crm_stamp_receipt();

-- ============================================================================
-- SELF-CHECK — the salesperson sends and proves; Finance still owns the money
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_finance uuid; v_lead uuid; v_invoice uuid;
  v_sent timestamptz; v_receipt text; v_by uuid; v_status text;
  n_sales_pay int := -1; n_finance_pay int := -1;
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
  if v_finance is null then
    select id into v_finance from public.users where role in ('admin', 'super_admin') and is_active limit 1;
  end if;
  if v_lead is null or v_finance is null then
    raise exception '196 · fixtures missing (lead %, finance %)', v_lead, v_finance;
  end if;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);

    insert into public.crm_invoices (lead_id, project_id, description, amount, is_test_data, created_by_id)
    values (v_lead, v_project, 'SELFCHECK-196', 450000, true, v_sales)
    returning id into v_invoice;

    /* 1 · The salesperson sends it and uploads the proof. */
    update public.crm_invoices
       set sent_at = now(),
           receipt_path = 'crm-receipts/selfcheck-196.pdf'
     where id = v_invoice;
    select sent_at, receipt_path, receipt_uploaded_by_id into v_sent, v_receipt, v_by
      from public.crm_invoices where id = v_invoice;

    /* 2 · …and still cannot say it is paid. */
    begin
      update public.crm_invoices set paid_amount = 450000 where id = v_invoice;
      n_sales_pay := 1;
    exception when sqlstate 'CRM95' then n_sales_pay := 0;
    end;
    reset role;

    /* 3 · Finance looks at the proof and approves it. */
    set local role cni_app;
    perform set_config('app.user_id', v_finance::text, true);
    begin
      update public.crm_invoices set paid_amount = 450000 where id = v_invoice;
      n_finance_pay := 1;
    exception when sqlstate 'CRM95' then n_finance_pay := 0;
    end;
    reset role;

    select status::text into v_status from public.crm_invoices where id = v_invoice;
    raise exception using errcode = 'P0196', message = '196 rollback';
  exception when sqlstate 'P0196' then
    null;
  end;

  if v_sent is null then
    raise exception '196 · a salesperson could not record that the invoice was sent';
  end if;
  if v_receipt is null then
    raise exception '196 · a salesperson could not upload the receipt';
  end if;
  if v_by is distinct from v_sales then
    raise exception '196 · the receipt was not stamped with the person who uploaded it (got %)', v_by;
  end if;
  if n_sales_pay <> 0 then
    raise exception '196 · uploading proof let a salesperson mark the invoice paid';
  end if;
  if n_finance_pay <> 1 or v_status <> 'paid' then
    raise exception '196 · Finance could not approve the payment (% / %)', n_finance_pay, v_status;
  end if;
  if exists (select 1 from public.crm_invoices where description = 'SELFCHECK-196') then
    raise exception '196 · the self-check left rows behind';
  end if;

  raise notice '196 · the salesperson sends the invoice and uploads the receipt as proof; the proof is not a payment; Finance approves it';
end $chk$;
