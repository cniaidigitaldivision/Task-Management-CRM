-- ============================================================================
-- 199 · A BOOKING HOLDS THE PLOT — the two halves of "booked"
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the Bookings tab:
--
--   *"Also add View Booking, which is basically just booking the property.
--   Booking the property: Book Property is when he sends payment and the property
--   is reserved. These two things will be said at the booking of the property.
--   When these two things are done, the property booking is done, right?"*
--
-- So a booking is two facts, not one: THE PAYMENT WENT IN, and THE PLOT IS HELD.
-- 194 recorded the first and left the second to whoever remembered to open the
-- catalogue — which means the plot a client has paid for stays "available" and
-- the next salesperson quotes it to somebody else. That is the bug this closes.
--
-- The catalogue now follows the booking:
--
--   a live booking (requested · pending_verification · confirmed)  →  reserved
--   its last live booking cancelled                                →  available
--
-- ⚠️ RESERVED, NOT SOLD. "Sold" is transfer — full payment and papers — and
-- nothing in this system knows about that yet. Writing 'sold' here would retire
-- a plot from the catalogue on the strength of a first instalment.
--
-- ⚠️ AND IT NEVER TOUCHES 'sold' OR 'withdrawn'. Those are decisions somebody
-- made outside this table; a cancelled booking must not put a sold plot back on
-- the market, and this returns only what it itself reserved.
--
-- ⚠️ DEFINER, BECAUSE THE PLOT IS NOT THE SALESPERSON'S TO EDIT. `crm_properties`
-- is the project's catalogue and a member has no update policy on it — correctly.
-- The hold is a consequence of their booking, not a hand-edit of the catalogue,
-- so the trigger carries the right and the person is never given it.
-- ============================================================================

create or replace function app.crm_booking_holds_property()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_property uuid;
  v_live int;
begin
  /* Either row may name the plot: an update that clears `property_id` still has
     to release the plot the booking was holding. */
  v_property := coalesce(new.property_id, case when tg_op = 'UPDATE' then old.property_id end);
  if v_property is null then
    return null;
  end if;

  select count(*) into v_live
    from public.crm_bookings b
   where b.property_id = v_property
     and b.status in ('requested', 'pending_verification', 'confirmed');

  if v_live > 0 then
    update public.crm_properties
       set status = 'reserved', updated_at = now()
     where id = v_property and status = 'available';
  else
    /* ⚠️ ONLY BACK FROM 'reserved'. See the header. */
    update public.crm_properties
       set status = 'available', updated_at = now()
     where id = v_property and status = 'reserved';
  end if;

  return null;
end $$;

comment on function app.crm_booking_holds_property() is
  '199 · a live booking reserves its plot; the last one cancelled releases it. Never writes sold/withdrawn.';

revoke all on function app.crm_booking_holds_property() from public;

/* ⚠️ AFTER, AND STATEMENT-BLIND. The count above reads the table this trigger
   fires on, so it must run once the row is written — a BEFORE trigger would
   count the world as it was and reserve nothing on the first booking. */
drop trigger if exists crm_bookings_hold_property on public.crm_bookings;
create trigger crm_bookings_hold_property
  after insert or update of status, property_id on public.crm_bookings
  for each row execute function app.crm_booking_holds_property();

-- ============================================================================
-- SELF-CHECK — a booking reserves the plot, cancelling gives it back, and a
-- sold plot is left alone
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_plot uuid; v_sold uuid;
  v_booking uuid; v_sold_booking uuid;
  s_after_book text; s_after_cancel text; s_sold_after text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data limit 1;
  if v_lead is null then
    raise exception '199 · fixtures missing (project %, lead %)', v_project, v_lead;
  end if;

  begin
    /* ⚠️ THE FIXTURES ARE THIS CHECK'S OWN, not a plot somebody is selling. A
       real available plot borrowed here would be left reserved if the rollback
       ever failed to take. */
    insert into public.crm_properties (project_id, code, kind, size_marla, base_price, status, is_test_data)
    values (v_project, 'SELFCHECK-199-A', 'Residential plot', 5, 4500000, 'available', true)
    returning id into v_plot;
    insert into public.crm_properties (project_id, code, kind, size_marla, base_price, status, is_test_data)
    values (v_project, 'SELFCHECK-199-B', 'Residential plot', 5, 4500000, 'sold', true)
    returning id into v_sold;

    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);

    /* 1 · The salesperson books it. The plot is held. */
    insert into public.crm_bookings (lead_id, project_id, property_id, amount, is_test_data, created_by_id)
    values (v_lead, v_project, v_plot, 500000, true, v_sales)
    returning id into v_booking;
    select status::text into s_after_book from public.crm_properties where id = v_plot;

    /* 2 · Cancelled — and the plot is back on the market. */
    update public.crm_bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'SELFCHECK-199'
     where id = v_booking;
    select status::text into s_after_cancel from public.crm_properties where id = v_plot;

    /* 3 · A sold plot is not quietly re-listed by a booking of its own. */
    insert into public.crm_bookings (lead_id, project_id, property_id, amount, is_test_data, created_by_id)
    values (v_lead, v_project, v_sold, 500000, true, v_sales)
    returning id into v_sold_booking;
    update public.crm_bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'SELFCHECK-199'
     where id = v_sold_booking;
    select status::text into s_sold_after from public.crm_properties where id = v_sold;

    reset role;
    raise exception using errcode = 'P0199', message = '199 rollback';
  exception when sqlstate 'P0199' then
    null;
  end;

  if s_after_book is distinct from 'reserved' then
    raise exception '199 · booking a plot did not reserve it (got %)', coalesce(s_after_book, 'null');
  end if;
  if s_after_cancel is distinct from 'available' then
    raise exception '199 · cancelling the booking did not release the plot (got %)', coalesce(s_after_cancel, 'null');
  end if;
  if s_sold_after is distinct from 'sold' then
    raise exception '199 · a cancelled booking re-listed a SOLD plot (got %)', coalesce(s_sold_after, 'null');
  end if;

  raise notice '199 ✓ booked → reserved, cancelled → available, sold left alone';
end $chk$;
