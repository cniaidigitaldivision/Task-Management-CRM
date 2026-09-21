-- ============================================================================
-- 244 · THE AGENT MOVES AN APPOINTMENT THE CLIENT ASKS TO CHANGE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, after closing the tab to watch the agent work alone:
-- *"the client sent three messages … I'm not getting any response from the AI
-- agent."* The log says why: it answered two, and on *"can you please change
-- time of appointment"* it handed over — as it was told to — and then sat
-- silent while the client sent two more.
--
-- Changing a time is the one thing it is best placed to do: it holds the
-- salesperson's free slots, and 236 already lets it book one. So it may now
-- MOVE the appointment the client already has, to a time it has checked is
-- free. Cancelling is still a person's.
--
-- ⚠️ NOT `app.crm_reschedule_appointment` — that one asks
-- `crm_lead_is_visible`, and the agent runs with nobody signed in, so it would
-- always refuse. This is the agent's own, with the same diary lock as
-- `crm_agent_book`, and it ends `confirmed` because the CLIENT chose the time.
--
-- ⚠️ ONE ROW MOVES (225). The appointment keeps its number and its history;
-- the booking trigger tells the client it *"has been moved to"* the new time
-- and re-queues the reminder for it (220/235).
-- ============================================================================

create or replace function app.crm_agent_move(p_lead uuid, p_at timestamptz, p_minutes integer default null)
returns table(appointment_id uuid, confirmation_id uuid)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_a    record;
  v_old  timestamptz;
  v_id   uuid;
begin
  if p_at < now() + interval '1 hour' then
    raise exception 'that time is too soon or already past' using errcode = 'CRA02';
  end if;

  select a.id, a.owner_id, a.scheduled_at, a.duration_minutes, a.notes
    into v_a
    from public.crm_appointments a
   where a.lead_id = p_lead
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at
   limit 1;
  if v_a.id is null then
    raise exception 'this client has no appointment to move' using errcode = 'CRA06';
  end if;
  if v_a.owner_id is null then
    raise exception 'nobody owns this appointment' using errcode = 'CRA03';
  end if;

  /* The clash, under the same lock as a new booking — and this appointment's
     own hour does not count as a clash with itself. */
  perform pg_advisory_xact_lock(hashtext('crm_agent_book:' || v_a.owner_id::text));
  if exists (
    select 1
      from public.crm_appointments o
     where o.owner_id = v_a.owner_id
       and o.id <> v_a.id
       and o.status in ('scheduled', 'confirmed')
       and o.scheduled_at < p_at + make_interval(mins => coalesce(p_minutes, v_a.duration_minutes))
       and o.scheduled_at + make_interval(mins => o.duration_minutes) > p_at
  ) then
    raise exception 'that time is no longer free' using errcode = 'CRA05';
  end if;

  v_old := v_a.scheduled_at;
  update public.crm_appointments
     set scheduled_at = p_at,
         duration_minutes = coalesce(p_minutes, duration_minutes),
         /* Appended, never replaced — the row IS the history (225). */
         notes = btrim(coalesce(notes || E'\n', '') ||
                 to_char(now() at time zone 'Asia/Karachi', 'FMDD FMMon FMHH12:MI AM') ||
                 ' — moved from ' ||
                 to_char(v_old at time zone 'Asia/Karachi', 'FMDD FMMon, FMHH12:MI AM') ||
                 ': the client asked the assistant on WhatsApp'),
         /* 242 · the client chose the new time, so it is confirmed. */
         status = 'confirmed'::public.crm_appointment_status,
         updated_at = now()
   where id = v_a.id
   returning id into v_id;

  return query
    select v_id,
           (select f.id from public.crm_follow_ups f
             where f.appointment_id = v_id and f.status = 'due'
             order by f.created_at desc limit 1);
end;
$fn$;

grant execute on function app.crm_agent_move(uuid, timestamptz, integer) to cni_app;

-- ============================================================================
-- SELF-CHECK — rolled back.
-- ============================================================================
do $chk$
declare
  v_lead record; v_id uuid; v_when timestamptz; v_moved timestamptz; v_status text;
  v_note text; n_msgs int := -1; c_none text := 'none'; c_soon text := 'none';
begin
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false and l.stage not in ('won', 'lost')
     and not exists (select 1 from app.crm_agent_lead_booked(l.id))
   limit 1;
  if v_lead.id is null then
    raise exception '244 · no free demo lead to check with' using errcode = 'CR244';
  end if;
  v_when := date_trunc('day', now()) + interval '6 days 7 hours';

  begin
    /* Nothing booked yet — refused. */
    begin
      perform app.crm_agent_move(v_lead.id, v_when);
    exception when sqlstate 'CRA06' then c_none := 'refused';
    end;

    select b.appointment_id into v_id from app.crm_agent_book(v_lead.id, 'office_visit', v_when, 60) b;
    begin
      perform app.crm_agent_move(v_lead.id, now() + interval '10 minutes');
    exception when sqlstate 'CRA02' then c_soon := 'refused';
    end;

    perform app.crm_agent_move(v_lead.id, v_when + interval '1 day');
    select scheduled_at, status::text, notes into v_moved, v_status, v_note
      from public.crm_appointments where id = v_id;
    select count(*) into n_msgs from public.crm_follow_ups
     where appointment_id = v_id and status in ('planned', 'due');

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if c_none <> 'refused' or c_soon <> 'refused' then
    raise exception '244 · refusals: nothing booked %, too soon %', c_none, c_soon using errcode = 'CR244';
  end if;
  if v_moved is distinct from v_when + interval '1 day' then
    raise exception '244 · the appointment did not move (at %)', v_moved using errcode = 'CR244';
  end if;
  if v_status is distinct from 'confirmed' then
    raise exception '244 · after the move the appointment was %, not confirmed', v_status using errcode = 'CR244';
  end if;
  if v_note not like '%moved from%' then
    raise exception '244 · the move left no history: %', v_note using errcode = 'CR244';
  end if;
  if n_msgs < 1 then
    raise exception '244 · the move told the client nothing (% messages)', n_msgs using errcode = 'CR244';
  end if;
  raise notice '244 · ✓ one row moves, confirmed, with its history and % message(s) to the client; too soon and nothing-booked are refused', n_msgs;
end
$chk$;
