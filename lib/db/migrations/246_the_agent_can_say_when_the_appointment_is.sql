-- ============================================================================
-- 246 · THE AGENT CAN SAY WHEN THE APPOINTMENT IS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-22, from the live thread on their own test lead:
--
--   *"The client is just asking to confirm the appointment time. Instead of it,
--   you'd go and see the appointment. What exact appointment? It should tell
--   the time. … He just wants to know. … when a client says 'Yeah I have to
--   change some plan' … or 'Is this quotation right or not?' … any decision-
--   making, then it should be handed over to the salesperson. Otherwise it
--   should engage the client again."*
--
-- What happened, from `crm_agent_runs`:
--   client: "Mujy appointment ka time confirm krna ha ?"
--   agent : "Noted. For any change to your appointment, our team will contact
--            you shortly to arrange it."   → handed over
--   client: "Mujy time pta krna ha srf"  /  "Meri aj appointment kitny bjy ha?"
--   agent : the same line again           → handed over again
--
-- The client asked WHEN. They were answered about a CHANGE they never asked
-- for, twice, and then left waiting. The appointment was in the model's own
-- context the whole time (ALREADY BOOKED), so it had the answer and was told
-- by its rules not to give it.
--
-- ⚠️ THIS MIGRATION ONLY WIDENS WHAT THE AGENT KNOWS. The rule change lives in
-- the prompt; this makes the facts it must state complete enough to state.
-- Before, `crm_agent_lead_booked` returned the kind and the time only — so
-- "where is it?" and "is it confirmed?" had no answer in context, and a model
-- with no answer hands over, correctly.
--
-- ⚠️ AND IT STILL RETURNS ONE ROW, STILL FUTURE-ONLY, STILL scheduled/confirmed.
-- Nothing about what the agent may DO changes: booking a second appointment and
-- moving this one remain the salesperson's (245).
-- ============================================================================

drop function if exists app.crm_agent_lead_booked(uuid);

create or replace function app.crm_agent_lead_booked(p_lead uuid)
returns table (kind text, starts_at timestamptz, status text, location text, ref_no int)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select a.kind::text, a.scheduled_at, a.status::text, a.location, a.ref_no
    from public.crm_appointments a
   where a.lead_id = p_lead
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at
   limit 1
$fn$;

grant execute on function app.crm_agent_lead_booked(uuid) to public;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  r record;
  n_appt int;
  lead_with uuid;
begin
  /* The shape is what the runner reads. */
  select count(*) into n_appt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'crm_agent_lead_booked';
  if n_appt <> 1 then
    raise exception '246 · expected exactly one crm_agent_lead_booked, found %', n_appt
      using errcode = 'CR246';
  end if;

  /* ⚠️ RUN IT AGAINST A REAL LEAD THAT HAS ONE, or say plainly that it could
     not be checked. A self-check that looks for a fixture it may not find
     prints a tick for a rule it never ran. */
  select a.lead_id into lead_with
    from public.crm_appointments a
   where a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at
   limit 1;

  if lead_with is null then
    raise notice '246 · ⚠ no lead has a future appointment right now — shape checked, values NOT';
  else
    select * into r from app.crm_agent_lead_booked(lead_with);
    if r.starts_at is null or r.kind is null or r.status is null then
      raise exception '246 · the definer returned no kind/time/status for a lead that has one'
        using errcode = 'CR246';
    end if;
    if r.starts_at <= now() then
      raise exception '246 · it returned an appointment in the past (%)', r.starts_at
        using errcode = 'CR246';
    end if;
    if r.status not in ('scheduled', 'confirmed') then
      raise exception '246 · it returned a % appointment', r.status using errcode = 'CR246';
    end if;
    raise notice '246 · ✓ checked on a real lead: % % (%), ref %', r.kind, r.starts_at, r.status, r.ref_no;
  end if;

  /* And the agent still cannot change one. */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'crm_agent_move'
  ) then
    raise exception '246 · the agent can move an appointment again' using errcode = 'CR246';
  end if;

  raise notice '246 · ✓ the agent can say when the appointment is; changing it is still the salespersons';
end
$chk$;
