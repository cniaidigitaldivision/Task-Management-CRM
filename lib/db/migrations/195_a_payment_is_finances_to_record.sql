-- ============================================================================
-- 195 · A PAYMENT IS FINANCE'S TO RECORD — on an invoice too
-- ----------------------------------------------------------------------------
-- 194 guarded the money on a booking and left the same money unguarded one table
-- over: `crm_invoices.paid_amount`. A salesperson could not confirm a booking but
-- could mark its invoice paid, which arrives at the same place — an outstanding
-- balance of zero that Finance never saw.
--
-- ⚠️ THE OWNER'S RULE IS ABOUT THE MONEY, NOT THE TABLE. *"Sales consultant
-- cannot verify payments."* So the same trigger shape, on the column that says
-- what has been received.
--
-- Raising a payment is Finance's; writing the invoice, its description, its
-- amount and its due date stays with whoever is working the lead.
-- ============================================================================

create or replace function app.crm_invoices_guard_payment()
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
    if not v_finance and new.paid_amount <> 0 then
      raise exception using
        errcode = 'CRM95',
        message = 'Only Finance can record a payment against an invoice.';
    end if;
  elsif not v_finance and new.paid_amount is distinct from old.paid_amount then
    raise exception using
      errcode = 'CRM95',
      message = 'Only Finance can record a payment against an invoice.';
  end if;

  /* ⚠️ THE STATUS STILL FOLLOWS THE MONEY (194), and this runs before that
     trigger by name — `crm_invoices_guard_payment` sorts before
     `crm_invoices_status_follows_payment`, which is how Postgres orders two
     BEFORE triggers on one table. The guard must go first, or a refused write
     would already have had its status computed. */
  return new;
end;
$fn$;

drop trigger if exists crm_invoices_guard_payment on public.crm_invoices;
create trigger crm_invoices_guard_payment
  before insert or update on public.crm_invoices
  for each row execute function app.crm_invoices_guard_payment();

-- ============================================================================
-- SELF-CHECK — the salesperson is refused, Finance is not
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_finance uuid; v_lead uuid; v_invoice uuid;
  n_sales int := -1; n_finance int := -1; v_status text;
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
    raise exception '195 · fixtures missing (lead %, finance %)', v_lead, v_finance;
  end if;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    insert into public.crm_invoices (lead_id, project_id, description, amount, is_test_data, created_by_id)
    values (v_lead, v_project, 'SELFCHECK-195', 500000, true, v_sales)
    returning id into v_invoice;

    begin
      update public.crm_invoices set paid_amount = 500000 where id = v_invoice;
      n_sales := 1;
    exception when sqlstate 'CRM95' then n_sales := 0;
    end;
    reset role;

    set local role cni_app;
    perform set_config('app.user_id', v_finance::text, true);
    begin
      update public.crm_invoices set paid_amount = 500000 where id = v_invoice;
      n_finance := 1;
    exception when sqlstate 'CRM95' then n_finance := 0;
    end;
    reset role;

    select status::text into v_status from public.crm_invoices where id = v_invoice;
    raise exception using errcode = 'P0195', message = '195 rollback';
  exception when sqlstate 'P0195' then
    null;
  end;

  if n_sales <> 0 then
    raise exception '195 · a salesperson marked an invoice paid';
  end if;
  if n_finance <> 1 then
    raise exception '195 · Finance could not record a payment';
  end if;
  if v_status <> 'paid' then
    raise exception '195 · a fully paid invoice reads as %', v_status;
  end if;
  if exists (select 1 from public.crm_invoices where description = 'SELFCHECK-195') then
    raise exception '195 · the self-check left rows behind';
  end if;

  raise notice '195 · only Finance records a payment on an invoice, and the status still follows the money';
end $chk$;
