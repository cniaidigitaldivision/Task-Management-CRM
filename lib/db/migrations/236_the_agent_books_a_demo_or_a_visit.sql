-- ============================================================================
-- 236 · THE AGENT BOOKS A DEMO OR A VISIT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21: *"make the build agent booking start with demo and visit.
-- Call is not working but demo, or you can say visit, will be working."*
--
-- The agent offers free times from the salesperson's own diary
-- (lib/domain/crm-agent-slots.ts) and books the one the client chooses. The
-- booking is an ordinary crm_appointments row, so everything a person's booking
-- does happens here too: the confirmation message, the reminder before it
-- (both naming the appointment, 235), the stage moving to Visit scheduled, the
-- diary on the Appointments page.
--
-- ⚠️ THE DATABASE CHECKS AGAIN. The code only lets the agent book a time it was
-- shown as free, but two clients can pick the same half hour a minute apart.
-- `crm_agent_book` refuses a clash in the salesperson's diary, a time in the
-- past or less than an hour away, a call, and a second appointment for a lead
-- that already has one coming — each with its own code, so the runner can hand
-- over with the reason.
--
-- Runs with nobody signed in (withAppRole), hence definers.
-- ============================================================================

/* What is already in this salesperson's diary in a window. */
create or replace function app.crm_agent_diary(p_owner uuid, p_from timestamptz, p_to timestamptz)
returns table(starts_at timestamptz, minutes integer)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select a.scheduled_at, a.duration_minutes
    from public.crm_appointments a
   where a.owner_id = p_owner
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at < p_to
     and a.scheduled_at + make_interval(mins => a.duration_minutes) > p_from
$fn$;

grant execute on function app.crm_agent_diary(uuid, timestamptz, timestamptz) to cni_app;

/* This lead's own appointment still to come, if any. */
create or replace function app.crm_agent_lead_booked(p_lead uuid)
returns table(kind text, starts_at timestamptz)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select a.kind::text, a.scheduled_at
    from public.crm_appointments a
   where a.lead_id = p_lead
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at
   limit 1
$fn$;

grant execute on function app.crm_agent_lead_booked(uuid) to cni_app;

/* Book it — or refuse, with a code the runner can explain. Returns the
   appointment and the confirmation the booking trigger queued for it (235), so
   the runner can deliver that confirmation at once instead of a minute later. */
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
  if p_kind not in ('meeting', 'site_visit') then
    raise exception 'the agent books a demo or a site visit, not a %', p_kind using errcode = 'CRA01';
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

  /* ⚠️ THE CLASH, CHECKED UNDER A LOCK ON THE SALESPERSON. Two clients picking
     the same half hour a minute apart are serialised here, not in the model. */
  perform pg_advisory_xact_lock(hashtext('crm_agent_book:' || v_lead.owner_id::text));
  if exists (
    select 1 from app.crm_agent_diary(v_lead.owner_id, p_at, p_at + make_interval(mins => p_minutes))
  ) then
    raise exception 'that time is no longer free' using errcode = 'CRA05';
  end if;

  insert into public.crm_appointments
    (lead_id, project_id, property_id, kind, scheduled_at, duration_minutes,
     location, notes, owner_id, created_by_id, is_test_data)
  values
    (v_lead.id, v_lead.project_id, v_lead.property_id, p_kind::public.crm_appointment_kind, p_at, p_minutes,
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

-- ============================================================================
-- SELF-CHECK — rolled back: no appointment, no message, no stage move survives.
-- ============================================================================
do $chk$
declare
  v_lead record; v_at timestamptz; v_id uuid;
  n_msgs int := -1; c_clash text := 'none'; c_again text := 'none'; c_call text := 'none'; c_soon text := 'none';
begin
  select l.id, l.owner_id into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]'
     and l.owner_id is not null
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
     and not exists (select 1 from app.crm_agent_lead_booked(l.id))
   limit 1;
  if v_lead.id is null then
    raise exception '236 · no demo lead without an appointment to check with' using errcode = 'CR236';
  end if;
  /* Midday, five days out — well inside any rule. */
  v_at := date_trunc('day', now()) + interval '5 days 7 hours';

  begin
    select b.appointment_id into v_id from app.crm_agent_book(v_lead.id, 'meeting', v_at, 45) b;
    select count(*) into n_msgs from public.crm_follow_ups where appointment_id = v_id and status in ('planned', 'due');

    begin
      perform app.crm_agent_book(v_lead.id, 'meeting', v_at + interval '2 days', 45);
    exception when sqlstate 'CRA04' then c_again := 'refused';
    end;
    begin
      perform app.crm_agent_book(v_lead.id, 'call', v_at + interval '2 days', 20);
    exception when sqlstate 'CRA01' then c_call := 'refused';
    end;
    begin
      perform app.crm_agent_book(v_lead.id, 'meeting', now() + interval '10 minutes', 45);
    exception when sqlstate 'CRA02' then c_soon := 'refused';
    end;
    /* Another lead of the same salesperson, same half hour. */
    begin
      perform app.crm_agent_book(
        (select l.id from public.crm_leads l
          where l.owner_id = v_lead.owner_id and l.id <> v_lead.id and l.stage not in ('won', 'lost')
            and not exists (select 1 from app.crm_agent_lead_booked(l.id))
          limit 1),
        'site_visit', v_at + interval '15 minutes', 90);
    exception when sqlstate 'CRA05' then c_clash := 'refused';
    end;

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if v_id is null or n_msgs < 1 then
    raise exception '236 · the agent''s booking queued % messages', n_msgs using errcode = 'CR236';
  end if;
  if c_again <> 'refused' or c_call <> 'refused' or c_soon <> 'refused' or c_clash <> 'refused' then
    raise exception '236 · refusals: second booking %, call %, too soon %, clash %', c_again, c_call, c_soon, c_clash
      using errcode = 'CR236';
  end if;
  if exists (select 1 from public.crm_appointments where id = v_id) then
    raise exception '236 · the check''s appointment was left behind' using errcode = 'CR236';
  end if;
  raise notice '236 · ✓ the agent books a demo with its confirmation queued, and refuses a second booking, a call, a time too soon, and a clash in the diary';
end
$chk$;
