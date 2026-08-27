-- ============================================================================
-- 074 · THE SETTLEMENT DATE AND THE STATUS MUST AGREE
-- ----------------------------------------------------------------------------
-- A correction to 073's trigger, found by testing it rather than by reading it.
--
-- ── ⚠️ WHAT BROKE, AND WHY IT WAS INVISIBLE IN THE CODE ────────────────────
-- Migration 065 left this constraint on `revenue_entries`:
--
--     CHECK ((status = 'received') = (received_on IS NOT NULL))
--
-- A BICONDITIONAL: the settlement date is set if and only if the status says
-- received. 073's trigger computed the two independently —
--
--     received_on = case when collected >= billed then last_paid else null end,
--     status      = case when current_status in ('written_off','returned')
--                        then current_status ... end
--
-- — which agrees for every ordinary invoice and disagrees for exactly one case:
-- a payment arriving against an invoice that had been WRITTEN OFF or RETURNED.
-- The status correctly stays terminal, the date is set anyway, and the row is
-- refused with a constraint violation that names neither the trigger nor the
-- payment somebody was trying to record.
--
-- Nothing in 073's own self-checks could have caught it: they assert the totals
-- agree, and the totals do agree. It took inserting a payment against a
-- written-off invoice — which is a real thing a client does when a refund is
-- reversed, or when a debt written off last quarter is finally honoured.
--
-- ── ⚠️ THE FIX IS AN ORDERING, NOT A NEW RULE ──────────────────────────────
-- Decide the status FIRST, then derive the date FROM IT. The two can then never
-- disagree, because there is only one decision. That is also the more truthful
-- model: "settled on the 22nd" is a statement about an invoice that was
-- settled, and a written-off invoice was not settled — the money that arrived
-- against it is a receipt, and it is still recorded as one.
--
-- ⚠️ The constraint is deliberately NOT relaxed to make room for the trigger.
-- It is the thing that caught the bug; weakening it would have hidden the next
-- one. When a check and a trigger disagree, the trigger is usually wrong.
-- ============================================================================

create or replace function public.sync_revenue_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  target    uuid := coalesce(new.revenue_id, old.revenue_id);
  billed    numeric(14, 2);
  collected numeric(14, 2);
  last_paid date;
  was       public.revenue_status;
  becomes   public.revenue_status;
begin
  select amount_pkr, status into billed, was
    from public.revenue_entries where id = target;

  -- The parent is already gone — a cascading delete. Nothing to keep in step.
  if not found then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_pkr), 0), max(received_on)
    into collected, last_paid
    from public.revenue_payments
   where revenue_id = target;

  -- ── STEP 1 · What is this invoice now? ────────────────────────────────────
  becomes := case
    -- ⚠️ `written_off` and `returned` are TERMINAL DECISIONS a person took, and
    -- a payment arriving must not quietly reverse one. Money against a
    -- written-off invoice is still recorded as a receipt; the invoice's own
    -- verdict is not the trigger's to overturn.
    when was in ('written_off', 'returned') then was
    when collected >= billed and billed > 0 then 'received'::public.revenue_status
    -- ⚠️ Falls back to `invoiced`, not to `pending`. A payment was deleted or
    -- reduced; the bill was certainly issued, so claiming it was never sent
    -- would be a worse lie than the one being corrected.
    when was = 'received' then 'invoiced'::public.revenue_status
    else was
  end;

  -- ── STEP 2 · The date follows FROM the status, never beside it ────────────
  -- This is the whole correction. See the header.
  update public.revenue_entries
     set amount_paid_pkr = collected,
         status          = becomes,
         received_on     = case when becomes = 'received' then last_paid else null end
   where id = target;

  return coalesce(new, old);
end $$;

comment on function public.sync_revenue_settlement() is
  'Keeps revenue_entries.amount_paid_pkr, status and received_on in step with '
  'the payments beneath them. The status is decided first and the settlement '
  'date is derived from it, so the biconditional check added in 065 can never '
  'be violated. The only writer of amount_paid_pkr.';


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE THE CASE THAT BROKE IT
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ Runs the real scenario against real tables and rolls it back, rather than
-- asserting the shape of the function. The bug was a disagreement between two
-- correct-looking expressions; only executing them finds that.
do $$
declare
  actor uuid := (select id from public.users order by role limit 1);
  inv   uuid;
  paid  numeric(14, 2);
  st    public.revenue_status;
  dt    date;
begin
  insert into public.revenue_entries
    (kind, client_name, amount_pkr, earned_on, status, created_by_id)
  values ('retainer', 'ZZ migration self-check', 100000,
          date_trunc('month', current_date)::date, 'invoiced', actor)
  returning id into inv;

  -- ── Part paid ──
  insert into public.revenue_payments
    (revenue_id, amount_pkr, received_on, method, proof_path, created_by_id)
  values (inv, 40000, current_date, 'bank_transfer', 'selfcheck/a', actor);

  select amount_paid_pkr, status, received_on into paid, st, dt
    from public.revenue_entries where id = inv;
  if paid <> 40000 or st <> 'invoiced' or dt is not null then
    raise exception 'Part payment: expected 40000/invoiced/no date, got %/%/%', paid, st, dt;
  end if;

  -- ── Settled by a second instalment ──
  insert into public.revenue_payments
    (revenue_id, amount_pkr, received_on, method, proof_path, created_by_id)
  values (inv, 60000, current_date, 'cash', 'selfcheck/b', actor);

  select amount_paid_pkr, status, received_on into paid, st, dt
    from public.revenue_entries where id = inv;
  if paid <> 100000 or st <> 'received' or dt is null then
    raise exception 'Settled: expected 100000/received/a date, got %/%/%', paid, st, dt;
  end if;

  -- ── Undoing a payment falls back to invoiced, not pending ──
  delete from public.revenue_payments where revenue_id = inv and amount_pkr = 60000;
  select amount_paid_pkr, status, received_on into paid, st, dt
    from public.revenue_entries where id = inv;
  if paid <> 40000 or st <> 'invoiced' or dt is not null then
    raise exception 'Undo: expected 40000/invoiced/no date, got %/%/%', paid, st, dt;
  end if;

  -- ── ★ THE CASE THAT BROKE 073 ★ ──
  update public.revenue_entries set status = 'written_off', received_on = null where id = inv;
  insert into public.revenue_payments
    (revenue_id, amount_pkr, received_on, method, proof_path, created_by_id)
  values (inv, 60000, current_date, 'cash', 'selfcheck/c', actor);

  select amount_paid_pkr, status, received_on into paid, st, dt
    from public.revenue_entries where id = inv;
  if st <> 'written_off' or dt is not null then
    raise exception
      'A payment against a written-off invoice changed it to %/% — it must stay written_off with no settlement date.',
      st, dt;
  end if;
  if paid <> 100000 then
    raise exception 'The receipt itself must still be counted; paid = %', paid;
  end if;

  -- ── Cascade ──
  delete from public.revenue_entries where id = inv;
  if exists (select 1 from public.revenue_payments where revenue_id = inv) then
    raise exception 'Deleting an invoice left its payments behind.';
  end if;

  raise notice
    'Settlement trigger: part-paid, settled, undone, written-off-then-paid, and cascade all behave.';
end $$;
