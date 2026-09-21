-- ============================================================================
-- 245 · CHANGING AN APPOINTMENT IS THE SALESPERSON'S — 244 REVERSED
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, an hour after 244 shipped:
--
--   *"I think the change of appointment should be considered or should be in
--   the test of the salesperson. I don't want that agent to do it
--   automatically. Please reverse the changes."*
--
-- So `app.crm_agent_move` goes. A client asking to change or cancel the
-- appointment they already have is handed to a person, as it was before —
-- with the holding line 244 added, so they are told somebody is coming.
--
-- ⚠️ WHAT STAYS FROM 244: the handover's holding message, and punctuation-only
-- ("?") being an opener rather than a thank-you. Those were separate faults.
--
-- ⚠️ DROPPED, NOT LEFT UNUSED. A definer nothing calls is a path somebody
-- wires up later without the reasoning — and this one moves a client's booked
-- appointment.
-- ============================================================================

drop function if exists app.crm_agent_move(uuid, timestamptz, integer);

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  n_fn int;
begin
  select count(*) into n_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'crm_agent_move';
  if n_fn <> 0 then
    raise exception '245 · the agent can still move an appointment (% function)', n_fn using errcode = 'CR245';
  end if;

  /* And booking one is untouched. */
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'crm_agent_book'
  ) then
    raise exception '245 · the agent can no longer book either' using errcode = 'CR245';
  end if;
  raise notice '245 · ✓ the agent books but cannot move an appointment; changing one is the salespersons';
end
$chk$;
