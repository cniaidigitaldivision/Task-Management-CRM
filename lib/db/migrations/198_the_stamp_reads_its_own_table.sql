-- ============================================================================
-- 198 · THE STAMP READS ITS OWN TABLE — every booking update has been failing
-- ----------------------------------------------------------------------------
-- 196 gave `crm_invoices` and `crm_bookings` the same receipt columns and one
-- trigger function for both, with the invoice-only part behind a guard:
--
--   if tg_table_name = 'crm_invoices'
--      and new.sent_at is distinct from old.sent_at and new.sent_at is not null
--
-- ⚠️ THAT GUARD DOES NOT PROTECT THE FIELD REFERENCE. PL/pgSQL hands the whole
-- condition to the SQL executor as one expression; `new.sent_at` is resolved
-- against the row's own type before anything is evaluated, and `crm_bookings`
-- has no `sent_at`. So on a booking the trigger raises
--
--   record "new" has no field "sent_at"
--
-- and **every UPDATE on `crm_bookings` fails**: requesting verification,
-- confirming, cancelling, uploading the receipt. Since 196 the Bookings tab has
-- been able to create a booking and never able to move one.
--
-- ⚠️ 196'S SELF-CHECK PASSED BECAUSE IT ONLY TOUCHED INVOICES. The check proved
-- the rule it was written about — who may record a payment — and never updated
-- the other table the same trigger had just been attached to. A shared trigger
-- needs a case per table it is attached to, not one case for the rule.
-- It was 199's check, writing a booking for a different reason, that found this.
--
-- The fix is the shape that cannot have the bug: one function per row type.
-- `crm_stamp_receipt` keeps only what both tables actually have, and the
-- invoice's "sent" stamp moves into a function that runs on invoices alone.
-- ============================================================================

/* Both tables have these three columns, so this resolves on either row type. */
create or replace function app.crm_stamp_receipt()
returns trigger
language plpgsql
as $fn$
begin
  if new.receipt_path is distinct from old.receipt_path and new.receipt_path is not null then
    new.receipt_uploaded_at := now();
    new.receipt_uploaded_by_id := app.current_user_id();
  end if;
  return new;
end;
$fn$;

comment on function app.crm_stamp_receipt() is
  '196/198 · stamps who uploaded a receipt. ⚠️ ONLY COLUMNS BOTH crm_invoices AND crm_bookings HAVE — see 198.';

/* The invoice's own half, on the only table that has the columns. */
create or replace function app.crm_stamp_invoice_sent()
returns trigger
language plpgsql
as $fn$
begin
  if new.sent_at is distinct from old.sent_at and new.sent_at is not null then
    new.sent_by_id := coalesce(new.sent_by_id, app.current_user_id());
  end if;
  return new;
end;
$fn$;

comment on function app.crm_stamp_invoice_sent() is
  '198 · records who sent the invoice to the client. crm_invoices only.';

revoke all on function app.crm_stamp_invoice_sent() from public;

drop trigger if exists crm_invoices_stamp_sent on public.crm_invoices;
create trigger crm_invoices_stamp_sent
  before update of sent_at on public.crm_invoices
  for each row execute function app.crm_stamp_invoice_sent();

-- ============================================================================
-- SELF-CHECK — a booking can be updated at all, and both stamps still land
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_booking uuid; v_invoice uuid;
  v_b_receipt text; v_b_by uuid; v_b_status text;
  v_i_sent timestamptz; v_i_sent_by uuid; v_i_receipt_by uuid;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data limit 1;
  if v_lead is null then
    raise exception '198 · fixtures missing (project %, lead %)', v_project, v_lead;
  end if;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);

    /* 1 · The case that was broken: any update at all to a booking. */
    insert into public.crm_bookings (lead_id, project_id, amount, is_test_data, created_by_id)
    values (v_lead, v_project, 500000, true, v_sales)
    returning id into v_booking;

    update public.crm_bookings
       set status = 'pending_verification',
           verification_requested_at = now(),
           receipt_path = 'crm-receipts/selfcheck-198.pdf'
     where id = v_booking;
    select status::text, receipt_path, receipt_uploaded_by_id
      into v_b_status, v_b_receipt, v_b_by
      from public.crm_bookings where id = v_booking;

    /* 2 · And the invoice keeps both of its stamps. */
    insert into public.crm_invoices (lead_id, project_id, description, amount, is_test_data, created_by_id)
    values (v_lead, v_project, 'SELFCHECK-198', 450000, true, v_sales)
    returning id into v_invoice;

    update public.crm_invoices
       set sent_at = now(), receipt_path = 'crm-receipts/selfcheck-198-inv.pdf'
     where id = v_invoice;
    select sent_at, sent_by_id, receipt_uploaded_by_id
      into v_i_sent, v_i_sent_by, v_i_receipt_by
      from public.crm_invoices where id = v_invoice;

    reset role;
    raise exception using errcode = 'P0198', message = '198 rollback';
  exception when sqlstate 'P0198' then
    null;
  end;

  if v_b_status is distinct from 'pending_verification' then
    raise exception '198 · a booking still cannot be updated (status %)', coalesce(v_b_status, 'null');
  end if;
  if v_b_receipt is null then
    raise exception '198 · the booking receipt was not recorded';
  end if;
  if v_b_by is distinct from v_sales then
    raise exception '198 · the booking receipt was not stamped with the uploader (got %)', v_b_by;
  end if;
  if v_i_sent is null or v_i_sent_by is distinct from v_sales then
    raise exception '198 · the invoice sent stamp was lost (at %, by %)', v_i_sent, v_i_sent_by;
  end if;
  if v_i_receipt_by is distinct from v_sales then
    raise exception '198 · the invoice receipt stamp was lost (got %)', v_i_receipt_by;
  end if;

  raise notice '198 ✓ bookings update again; invoice sent-by and receipt-by both still stamped';
end $chk$;
