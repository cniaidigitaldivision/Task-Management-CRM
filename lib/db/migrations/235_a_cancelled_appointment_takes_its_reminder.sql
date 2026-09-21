-- ============================================================================
-- 235 · A CANCELLED APPOINTMENT TAKES ITS REMINDER WITH IT
-- ----------------------------------------------------------------------------
-- Found 2026-09-21 while answering the owner's question about the Appointments
-- page: calling off a visit before it happened left its reminder queued. The
-- client would still have received *"a reminder that your site visit … is
-- tomorrow"* for a visit that was not happening. The owner: *"Go with that."*
--
-- The cause: 220/222's booking trigger returns at once for any status that is
-- not scheduled/confirmed, and a reminder row did not say which appointment it
-- was for — so nothing could find it.
--
--   1 · crm_follow_ups.appointment_id — the confirmation and the reminder now
--       name their appointment.
--   2 · app.crm_appointment_closed — when an appointment is cancelled, marked
--       done, or (old data) marked a no-show, every message still waiting for
--       it is cancelled. An older row that names no appointment is cancelled
--       too when the lead has no other appointment still to come.
--   3 · the booking trigger's "superseded" sweep now only touches THIS
--       appointment's rows, and it names the client the way every other
--       message does (223's crm_first_name).
--
-- Also, same day: "No-show" is gone from the screens — an appointment is done
-- or cancelled, and "the client did not come" is a cancel reason.
-- ============================================================================

alter table public.crm_follow_ups
  add column if not exists appointment_id uuid references public.crm_appointments(id) on delete set null;

create index if not exists crm_follow_ups_appointment_idx
  on public.crm_follow_ups (appointment_id) where appointment_id is not null;

comment on column public.crm_follow_ups.appointment_id is
  'The appointment a confirmation or reminder is about. Cancelling or closing that appointment cancels what is still waiting (235).';

/* ── 3 · The booking trigger names its appointment ────────────────────── */
CREATE OR REPLACE FUNCTION app.crm_appointment_booked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_lead    record;
  v_when    text;
  v_what    text;
  v_extra   text;
  v_body    text;
  v_title   text;
  v_moved   boolean;
  v_first   text;
  v_remind  timestamptz;
  v_mins    integer;
  v_rwhen   text;
begin
  if new.status not in ('scheduled', 'confirmed') or new.scheduled_at <= now() then
    return null;
  end if;

  /* ⚠️ A CONFIRMATION IS NOT A NEW TIME — see this migration's header. */
  v_moved := tg_op = 'INSERT'
    or old.scheduled_at is distinct from new.scheduled_at
    or (old.status not in ('scheduled', 'confirmed') and new.status in ('scheduled', 'confirmed'));
  if not v_moved then
    return null;
  end if;

  perform app.crm_warm_lead(new.lead_id, 'hot', 'a visit was booked');

  select l.full_name, l.phone_e164, l.owner_id, l.whatsapp_consent,
         coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name) as business,
         coalesce(s.visit_reminder_minutes, 120) as remind_minutes
    into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
   where l.id = new.lead_id;

  if v_lead.phone_e164 is null or v_lead.whatsapp_consent is false then
    return null;
  end if;

  /* 235 · the same first name as every other message (223) — "Umm e e
     Habiba" is not "Umm". */
  v_first := coalesce(nullif(app.crm_first_name(v_lead.full_name), ''), 'Sir/Madam');

  v_when := to_char(new.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMonth') ||
            ' at ' || to_char(new.scheduled_at at time zone 'Asia/Karachi', 'FMHH12:MI AM');

  v_what := case new.kind::text
              when 'site_visit' then 'site visit'
              when 'meeting'    then 'meeting'
              when 'call'       then 'call'
              else 'appointment'
            end;

  v_extra := coalesce(
    'Location: ' || nullif(btrim(new.location), ''),
    case when new.kind::text = 'call'
         then 'We look forward to speaking with you.'
         else 'We look forward to seeing you.' end);

  v_title := (case when tg_op = 'INSERT' then 'Confirm the ' else 'Confirm the new ' end) || v_what || ' time';

  v_body := 'Assalam-o-Alaikum ' || v_first || ', your ' || v_what || ' with ' || v_lead.business ||
            case when tg_op = 'INSERT' then ' is confirmed for ' else ' has been moved to ' end ||
            v_when || '. ' || v_extra;

  /* 235 · only THIS appointment's messages (and old rows that name none) —
     a second appointment on the same lead keeps its own reminder. */
  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Superseded — the appointment time changed.'
   where lead_id = new.lead_id
     and purpose = 'appointment_reminder'
     and status in ('planned', 'due')
     and (appointment_id = new.id or appointment_id is null);

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id,
     wa_template_name, wa_template_language, wa_template_values, appointment_id)
  values (new.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
          v_title, v_body, now(), v_lead.owner_id, v_lead.owner_id,
          'appointment_confirmed', 'en_GB',
          array[v_first, v_what, v_lead.business, v_when, v_extra], new.id);

  v_mins := greatest(15, least(10080, v_lead.remind_minutes));
  v_remind := new.scheduled_at - make_interval(mins => v_mins);

  if v_remind > now() + interval '1 minute' then
    v_rwhen := case
      when (v_remind at time zone 'Asia/Karachi')::date
           = (new.scheduled_at at time zone 'Asia/Karachi')::date
        then 'today at ' || to_char(new.scheduled_at at time zone 'Asia/Karachi', 'FMHH12:MI AM')
      when (new.scheduled_at at time zone 'Asia/Karachi')::date
           - (v_remind at time zone 'Asia/Karachi')::date = 1
        then 'tomorrow, ' || v_when
      else 'on ' || v_when
    end;

    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at,
       assigned_to_id, created_by_id,
       wa_template_name, wa_template_language, wa_template_values, appointment_id)
    values (new.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'planned',
            'Remind about the ' || v_what,
            'Assalam-o-Alaikum ' || v_first || ', a reminder that your ' || v_what ||
              ' with ' || v_lead.business || ' is ' || v_rwhen || '. ' || v_extra,
            v_remind, v_lead.owner_id, v_lead.owner_id,
            'appointment_reminder', 'en_GB',
            array[v_first, v_what, v_lead.business, v_rwhen, v_extra], new.id);
  end if;

  return null;
end;
$function$;

/* ── 2 · Closing an appointment stops its messages ─────────────────────── */
create or replace function app.crm_appointment_closed()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_note text;
begin
  if new.status::text not in ('cancelled', 'completed', 'no_show')
     or old.status::text not in ('scheduled', 'confirmed') then
    return null;
  end if;

  v_note := case new.status::text
              when 'cancelled' then 'Not sent — the appointment was cancelled.'
              else 'Not sent — the appointment has already happened.'
            end;

  update public.crm_follow_ups f
     set status = 'cancelled',
         outcome_note = v_note,
         updated_at = now()
   where f.lead_id = new.lead_id
     and f.purpose = 'appointment_reminder'
     and f.status in ('planned', 'due')
     and (f.appointment_id = new.id
          or (f.appointment_id is null
              and not exists (
                select 1 from public.crm_appointments o
                 where o.lead_id = new.lead_id
                   and o.id <> new.id
                   and o.status in ('scheduled', 'confirmed')
                   and o.scheduled_at > now())));
  return null;
end;
$fn$;

drop trigger if exists crm_appointments_closed on public.crm_appointments;
create trigger crm_appointments_closed
  after update of status on public.crm_appointments
  for each row execute function app.crm_appointment_closed();

/* Old rows: a waiting reminder whose lead has exactly one appointment to come
   is that appointment's. */
update public.crm_follow_ups f
   set appointment_id = a.id
  from public.crm_appointments a
 where f.appointment_id is null
   and f.purpose = 'appointment_reminder'
   and f.status in ('planned', 'due')
   and a.lead_id = f.lead_id
   and a.status in ('scheduled', 'confirmed')
   and a.scheduled_at > now()
   and (select count(*) from public.crm_appointments x
         where x.lead_id = f.lead_id and x.status in ('scheduled', 'confirmed') and x.scheduled_at > now()) = 1;

-- ============================================================================
-- SELF-CHECK — book a visit, cancel it, and nothing is left waiting.
-- Done inside a block that is rolled back: no appointment, no message, no
-- stage move survives it.
-- ============================================================================
do $chk$
declare
  v_lead record; v_appt uuid;
  n_booked int := -1; n_left int := -1; n_other int := -1; v_second uuid;
begin
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]'
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
   limit 1;
  if v_lead.id is null then
    raise exception '235 · no demo lead to check with' using errcode = 'CR235';
  end if;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'site_visit', now() + interval '3 days', 60, v_lead.owner_id, v_lead.owner_id)
    returning id into v_appt;
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'meeting', now() + interval '6 days', 60, v_lead.owner_id, v_lead.owner_id)
    returning id into v_second;

    select count(*) into n_booked from public.crm_follow_ups
     where appointment_id = v_appt and status in ('planned', 'due');

    update public.crm_appointments set status = 'cancelled', outcome = '235 check' where id = v_appt;

    select count(*) into n_left from public.crm_follow_ups
     where appointment_id = v_appt and status in ('planned', 'due');
    select count(*) into n_other from public.crm_follow_ups
     where appointment_id = v_second and status in ('planned', 'due');

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if n_booked < 1 then
    raise exception '235 · booking a visit queued % messages naming it', n_booked using errcode = 'CR235';
  end if;
  if n_left <> 0 then
    raise exception '235 · % messages still waiting for a cancelled visit', n_left using errcode = 'CR235';
  end if;
  if n_other < 1 then
    raise exception '235 · cancelling one appointment took the other appointment''s reminder with it' using errcode = 'CR235';
  end if;
  raise notice '235 · ✓ a booked visit''s % message(s) name it; cancelling it leaves none waiting, and the lead''s other appointment keeps its own', n_booked;
end
$chk$;
