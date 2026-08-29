-- ============================================================================
-- 077 · A SENT INVOICE CANNOT BE DELETED EITHER
-- ----------------------------------------------------------------------------
-- A gap in 076, found by asking what its own trigger did NOT cover.
--
-- 076 froze the figures on a sent invoice with a `before update` trigger, and
-- the reasoning it gives is right: the copy in the client's inbox is the thing
-- being protected, and only the database can protect it. But `revenue_entries`
-- already has a `deleteRevenue` in the query layer, and DELETE is not UPDATE —
-- so every figure was frozen against being changed and none of it was frozen
-- against being removed outright.
--
-- That is the worse of the two. An edited invoice at least leaves a row that
-- disagrees with the client's copy; a deleted one leaves the client holding a
-- document this system has no record of ever issuing, and a hole in the number
-- series that looks like fraud to whoever finds it.
--
-- ── ⚠️ VOID IS THE ANSWER, AND IT ALREADY EXISTS ───────────────────────────
-- 076 added `voided_at` / `void_reason` precisely so a wrong invoice has a
-- correct ending. The error below names it, because "you cannot delete this" is
-- only half of what somebody needs to be told.
--
-- ⚠️ A CASCADING DELETE FROM `users` IS NOT AFFECTED. `revenue_entries` has no
-- cascade onto it — `created_by_id` is a plain reference and 041 releases the
-- actor on purge rather than deleting their work. Nothing legitimate deletes an
-- invoice row today, which is what makes this safe to forbid outright.
-- ============================================================================

create or replace function public.forbid_deleting_a_sent_invoice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.sent_at is not null then
    raise exception
      'Invoice % was sent to the client on %. It cannot be deleted — void it instead, with a reason, so the record and the client''s copy still agree.',
      old.invoice_no, old.sent_at::date
      using errcode = 'check_violation';
  end if;

  return old;
end
$$;

drop trigger if exists revenue_entries_no_delete_when_sent on public.revenue_entries;
create trigger revenue_entries_no_delete_when_sent
  before delete on public.revenue_entries
  for each row execute function public.forbid_deleting_a_sent_invoice();


-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
do $$
declare v_admin uuid; v_inv uuid;
begin
  select id into v_admin from public.users where role in ('super_admin', 'admin') limit 1;
  if v_admin is null then
    raise notice '077 · no admin to test with; trigger installed, untested';
    return;
  end if;

  insert into public.revenue_entries
    (kind, client_name, amount_pkr, earned_on, issued_on, due_on, invoice_no,
     billed_to_name, billed_to_email, status, created_by_id)
  values
    ('one_off', 'Self Check Ltd', 5000, '2099-02-01', '2099-02-01', '2099-02-11',
     '077-SELFCHECK', 'Self Check Ltd', 'selfcheck@example.com', 'invoiced', v_admin)
  returning id into v_inv;

  -- Not sent yet: deleting a draft is ordinary and must keep working.
  delete from public.revenue_entries where id = v_inv;
  if exists (select 1 from public.revenue_entries where id = v_inv) then
    raise exception '077 · an UNSENT invoice could not be deleted';
  end if;

  -- ...and once sent, it cannot be.
  insert into public.revenue_entries
    (kind, client_name, amount_pkr, earned_on, issued_on, due_on, invoice_no,
     billed_to_name, billed_to_email, status, created_by_id, sent_at, sent_to, send_count)
  values
    ('one_off', 'Self Check Ltd', 5000, '2099-02-01', '2099-02-01', '2099-02-11',
     '077-SELFCHECK-2', 'Self Check Ltd', 'selfcheck@example.com', 'invoiced', v_admin,
     now(), 'selfcheck@example.com', 1)
  returning id into v_inv;

  begin
    delete from public.revenue_entries where id = v_inv;
    raise exception '077 · A SENT INVOICE WAS DELETED';
  exception when check_violation then null;
  end;

  -- Voiding it is the sanctioned ending, and it still works.
  update public.revenue_entries
     set voided_at = now(), void_reason = 'self-check', voided_by_id = v_admin
   where id = v_inv;

  -- Clean up: clear the send so the fixture can be removed.
  update public.revenue_entries set sent_at = null, sent_to = null where id = v_inv;
  delete from public.revenue_entries where id = v_inv;

  raise notice '077 · a sent invoice can be voided but never deleted';
end
$$;
