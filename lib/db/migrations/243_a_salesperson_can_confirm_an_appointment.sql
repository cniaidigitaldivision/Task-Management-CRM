-- ============================================================================
-- 243 · A SALESPERSON CAN CONFIRM AN APPOINTMENT, OR ASK THE CLIENT AGAIN
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21: *"In any case it's still waiting for confirmation. The
-- salesperson can come and confirm that appointment … There's no button
-- available on the appointment page where he can confirm … Right now I'm doing
-- it with your code but there should be enough front UI for the salesperson."*
--
-- Two ways, both from the Appointments page:
--   · **Mark confirmed** — the client said yes on a call or in the chat. That
--     is an ordinary UPDATE the salesperson's own session may make (152's
--     policy, 116's column grants), so it needs nothing here.
--   · **Ask the client again** — this function. It re-queues the confirmation
--     message for THIS appointment (cancelling one still waiting), due now, so
--     the sender delivers it within the minute; the app also runs the sender at
--     once so it goes while the salesperson is looking at the screen.
--
-- ⚠️ IT IS THE BOOKING'S OWN MESSAGE, not a new kind. Same purpose, same
-- template (`appointment_confirmed`), same Confirm / Change the time buttons —
-- so a tap still lands in 222's `crm_appointment_answered`.
-- ============================================================================

create or replace function app.crm_appointment_ask_confirm(p_appt uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_a     record;
  v_lead  record;
  v_first text;
  v_when  text;
  v_what  text;
  v_extra text;
  v_body  text;
  v_id    uuid;
begin
  select a.* into v_a from public.crm_appointments a where a.id = p_appt;
  if not found then
    raise exception 'that appointment is gone' using errcode = 'CRC01';
  end if;
  if v_a.status::text not in ('scheduled', 'confirmed') then
    raise exception 'an appointment that is % cannot be confirmed', v_a.status using errcode = 'CRC02';
  end if;
  if v_a.scheduled_at <= now() then
    raise exception 'that time has already passed' using errcode = 'CRC03';
  end if;

  select l.full_name, l.phone_e164, l.owner_id, l.whatsapp_consent,
         coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name) as business
    into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
   where l.id = v_a.lead_id;
  if v_lead.phone_e164 is null or v_lead.whatsapp_consent is false then
    raise exception 'this client has no WhatsApp number, or has not agreed to messages' using errcode = 'CRC04';
  end if;

  v_first := coalesce(nullif(app.crm_first_name(v_lead.full_name), ''), 'Sir/Madam');
  v_when  := to_char(v_a.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMonth') ||
             ' at ' || to_char(v_a.scheduled_at at time zone 'Asia/Karachi', 'FMHH12:MI AM');
  v_what  := case v_a.kind::text
               when 'site_visit'   then 'site visit'
               when 'office_visit' then 'office visit'
               when 'meeting'      then 'meeting'
               when 'call'         then 'call'
               else 'appointment'
             end;
  v_extra := coalesce(
    'Location: ' || nullif(btrim(v_a.location), ''),
    case when v_a.kind::text = 'call'
         then 'We look forward to speaking with you.'
         else 'We look forward to seeing you.' end);
  v_body := 'Assalam-o-Alaikum ' || v_first || ', your ' || v_what || ' with ' || v_lead.business ||
            ' is confirmed for ' || v_when || '. ' || v_extra;

  /* One pending confirmation per appointment — the old one goes. */
  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Superseded — the client was asked again.',
         updated_at = now()
   where appointment_id = p_appt
     and purpose = 'appointment_reminder'
     and title like 'Confirm the%'
     and status in ('planned', 'due');

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id,
     wa_template_name, wa_template_language, wa_template_values, appointment_id)
  values (v_a.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
          'Confirm the ' || v_what || ' time', v_body, now(),
          v_lead.owner_id, coalesce(app.current_user_id(), v_lead.owner_id),
          'appointment_confirmed', 'en_GB',
          array[v_first, v_what, v_lead.business, v_when, v_extra], p_appt)
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function app.crm_appointment_ask_confirm(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK — rolled back.
-- ============================================================================
do $chk$
declare
  v_lead record; v_id uuid; v_f uuid; n_pending int := -1; v_tpl text; c_past text := 'none';
begin
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false and l.stage not in ('won', 'lost')
   limit 1;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'office_visit', now() + interval '3 days', 60, v_lead.owner_id, v_lead.owner_id)
    returning id into v_id;

    v_f := app.crm_appointment_ask_confirm(v_id);
    select count(*) into n_pending from public.crm_follow_ups
     where appointment_id = v_id and title like 'Confirm the%' and status in ('planned', 'due');
    select wa_template_name into v_tpl from public.crm_follow_ups where id = v_f;

    /* A past appointment is refused. */
    update public.crm_appointments set scheduled_at = now() - interval '1 hour' where id = v_id;
    begin
      perform app.crm_appointment_ask_confirm(v_id);
    exception when sqlstate 'CRC03' then c_past := 'refused';
    end;

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if v_f is null or n_pending <> 1 then
    raise exception '243 · asking again left % pending confirmations, expected exactly 1', n_pending using errcode = 'CR243';
  end if;
  if v_tpl is distinct from 'appointment_confirmed' then
    raise exception '243 · the re-ask used template %', v_tpl using errcode = 'CR243';
  end if;
  if c_past <> 'refused' then
    raise exception '243 · a past appointment was asked to confirm' using errcode = 'CR243';
  end if;
  raise notice '243 · ✓ asking again queues exactly one confirmation on the approved template, and a past appointment is refused';
end
$chk$;
