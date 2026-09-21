-- ============================================================================
-- 242 · THE AGENT BOOKS AN OFFICE VISIT, AND A TIME THE CLIENT CHOSE IS CONFIRMED
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, reading APPT-106 (booked by the agent the same afternoon):
--
--   *"the client says 'please arrange a meeting for me in the office'. He should
--   arrange an appointment and its type should not be just 'meeting'. It should
--   be 'office visit'."*
--
--   *"the AI agent gives the client two time slots and the client selects one …
--   Why, when I go to the upcoming appointment page, is the status still
--   'client confirmation needed' while the client confirmed the time?"*
--
-- Both are this function's:
--   1 · `office_visit` joins `meeting` and `site_visit` as a kind the agent may
--       book (239 added the kind; the agent was never told about it).
--   2 · A slot the client PICKED IN THE CONVERSATION is already confirmed. The
--       appointment is written `confirmed`, not `scheduled`, so the page says
--       Confirmed rather than asking for a confirmation they have just given.
--       The client still gets the confirmation message with the details, and
--       the reminder before it (220/235) — that is a courtesy, not a question.
--
-- ⚠️ A PERSON'S BOOKING IS UNCHANGED. A salesperson picks the time, not the
-- client, so it stays `scheduled` until the client taps Confirm (222).
-- ============================================================================

drop function if exists app.crm_agent_book(uuid, text, timestamptz, integer);
create function app.crm_agent_book(p_lead uuid, p_kind text, p_at timestamptz, p_minutes integer)
returns table(appointment_id uuid, confirmation_id uuid)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead record;
  v_id uuid;
begin
  if p_kind not in ('meeting', 'site_visit', 'office_visit') then
    raise exception 'the agent books a demo, an office visit or a site visit, not a %', p_kind using errcode = 'CRA01';
  end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then
    raise exception 'an appointment of % minutes', p_minutes using errcode = 'CRA01';
  end if;
  if p_at < now() + interval '1 hour' then
    raise exception 'that time is too soon or already past' using errcode = 'CRA02';
  end if;

  select l.id, l.project_id, l.property_id, l.owner_id, l.stage::text as stage, l.is_test_data
    into v_lead
    from public.crm_leads l
   where l.id = p_lead;
  if v_lead.id is null or v_lead.stage in ('won', 'lost') then
    raise exception 'the lead is closed or gone' using errcode = 'CRA03';
  end if;
  if v_lead.owner_id is null then
    raise exception 'nobody owns this lead, so there is no diary to book into' using errcode = 'CRA03';
  end if;

  if exists (select 1 from app.crm_agent_lead_booked(p_lead)) then
    raise exception 'the client already has an appointment coming' using errcode = 'CRA04';
  end if;

  /* The clash, checked under a lock on the salesperson (236). */
  perform pg_advisory_xact_lock(hashtext('crm_agent_book:' || v_lead.owner_id::text));
  if exists (
    select 1 from app.crm_agent_diary(v_lead.owner_id, p_at, p_at + make_interval(mins => p_minutes))
  ) then
    raise exception 'that time is no longer free' using errcode = 'CRA05';
  end if;

  insert into public.crm_appointments
    (lead_id, project_id, property_id, kind, status, scheduled_at, duration_minutes,
     location, notes, owner_id, created_by_id, is_test_data)
  values
    (v_lead.id, v_lead.project_id, v_lead.property_id, p_kind::public.crm_appointment_kind,
     /* 242 · the client chose this time in the chat — it is confirmed. */
     'confirmed'::public.crm_appointment_status, p_at, p_minutes,
     null, 'Booked by the AI agent on WhatsApp, at the time the client chose.',
     v_lead.owner_id, v_lead.owner_id, v_lead.is_test_data)
  returning id into v_id;

  return query
    select v_id,
           (select f.id from public.crm_follow_ups f
             where f.appointment_id = v_id and f.status = 'due'
             order by f.created_at limit 1);
end;
$fn$;

grant execute on function app.crm_agent_book(uuid, text, timestamptz, integer) to cni_app;

/* ── The one the owner is looking at ──────────────────────────────────────
   APPT-106: the client asked for a meeting IN THE OFFICE and picked the time.
   ⚠️ Changing `kind` alone does not wake the booking trigger (it watches
   status and scheduled_at), and 'scheduled' → 'confirmed' is not a move, so
   nothing is re-announced to the client. */
update public.crm_appointments
   set kind = 'office_visit', duration_minutes = 60, status = 'confirmed', updated_at = now()
 where ref_no = 106
   and kind = 'meeting'
   and status = 'scheduled'
   and notes like 'Booked by the AI agent%';

-- ============================================================================
-- SELF-CHECK — rolled back.
-- ============================================================================
do $chk$
declare
  v_lead record; v_id uuid; v_kind text; v_status text; n_msgs int := -1; c_call text := 'none';
begin
  select l.id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false and l.stage not in ('won', 'lost')
     and not exists (select 1 from app.crm_agent_lead_booked(l.id))
   limit 1;
  if v_lead.id is null then
    raise exception '242 · no free demo lead to check with' using errcode = 'CR242';
  end if;

  begin
    select b.appointment_id into v_id
      from app.crm_agent_book(v_lead.id, 'office_visit', date_trunc('day', now()) + interval '5 days 7 hours', 60) b;
    select kind::text, status::text into v_kind, v_status from public.crm_appointments where id = v_id;
    select count(*) into n_msgs from public.crm_follow_ups where appointment_id = v_id and status in ('planned', 'due');
    begin
      perform app.crm_agent_book(v_lead.id, 'call', now() + interval '3 days', 20);
    exception when sqlstate 'CRA01' then c_call := 'refused';
    end;
    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if v_kind is distinct from 'office_visit' then
    raise exception '242 · the agent booked % instead of an office visit', v_kind using errcode = 'CR242';
  end if;
  if v_status is distinct from 'confirmed' then
    raise exception '242 · a time the client chose was written % , not confirmed', v_status using errcode = 'CR242';
  end if;
  if n_msgs < 1 then
    raise exception '242 · the booking queued % messages for the client', n_msgs using errcode = 'CR242';
  end if;
  if c_call <> 'refused' then
    raise exception '242 · the agent was allowed to book a call' using errcode = 'CR242';
  end if;
  raise notice '242 · ✓ the agent books an office visit, confirmed, with its % message(s); a call is still refused', n_msgs;
end
$chk$;
