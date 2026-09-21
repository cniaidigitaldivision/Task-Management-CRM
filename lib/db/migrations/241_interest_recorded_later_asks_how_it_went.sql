-- ============================================================================
-- 241 · INTEREST RECORDED LATER STILL ASKS HOW IT WENT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, on the Appointments page: the Reschedule / Cancel / Record
-- outcome buttons "are not working" — on an appointment already Completed they
-- were all disabled. A completed appointment now offers "Edit outcome": fix the
-- note, or say the client is interested. Umm e e Habiba's visit was recorded
-- before the interest question existed, so saying "interested" now must do what
-- saying it then would have done: queue the feedback message (once — 237's
-- one-per-appointment guard still holds).
-- ============================================================================

CREATE OR REPLACE FUNCTION app.crm_appointment_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_note  text;
  v_lead  record;
  v_what  text;
  v_due   timestamptz;
  v_local timestamp;
  v_day   date;
begin
  /* 241 · TWO WAYS IN. Closing an open appointment (235/237), or telling an
     already-completed one that the client IS interested — "Edit outcome" on the
     Appointments page. The second sends the feedback message the first would
     have, once; it has no reminders left to cancel. */
  if new.status::text = 'completed' and old.status::text = 'completed'
     and new.client_interested is true and old.client_interested is distinct from true then
    null;  -- falls through to the feedback below
  elsif new.status::text not in ('cancelled', 'completed', 'no_show')
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

  /* ── 237 · Done, and the client is interested: ask how it went ───────── */
  if new.status::text <> 'completed' or new.client_interested is not true or new.kind::text = 'call' then
    return null;
  end if;

  select l.id, l.owner_id, l.phone_e164, l.whatsapp_consent, l.stage::text as stage
    into v_lead
    from public.crm_leads l where l.id = new.lead_id;
  if v_lead.id is null or v_lead.stage in ('won', 'lost')
     or v_lead.phone_e164 is null or v_lead.whatsapp_consent is false then
    return null;
  end if;

  /* One feedback per appointment, however often it is re-recorded. */
  if exists (select 1 from public.crm_follow_ups f
              where f.appointment_id = new.id and f.purpose = 'meeting_feedback') then
    return null;
  end if;

  v_what := case new.kind::text when 'site_visit' then 'site visit' when 'office_visit' then 'office visit' else 'meeting' end;

  /* About two hours on; inside office hours (10–7, Monday to Saturday), or the
     next working morning at 11. */
  v_due := now() + interval '2 hours';
  v_local := v_due at time zone 'Asia/Karachi';
  if extract(isodow from v_local) = 7
     or extract(hour from v_local) >= 19
     or extract(hour from v_local) < 10 then
    v_day := v_local::date + case when extract(hour from v_local) < 10 and extract(isodow from v_local) <> 7 then 0 else 1 end;
    if extract(isodow from v_day::timestamp) = 7 then
      v_day := v_day + 1;
    end if;
    v_due := (v_day + time '11:00') at time zone 'Asia/Karachi';
  end if;

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id, appointment_id, cancel_on_reply)
  values
    (new.lead_id, 'meeting_feedback', 'whatsapp', 'auto_send', 'planned',
     'Ask how the ' || v_what || ' went',
     'Assalam-o-Alaikum {{lead_first_name}}, thank you for your time at the ' || v_what ||
       ' with {{company}}. How did you find it? We are happy to answer any questions.',
     v_due, v_lead.owner_id, v_lead.owner_id, new.id, true);

  return null;
end;
$function$;

drop trigger if exists crm_appointments_closed on public.crm_appointments;
create trigger crm_appointments_closed
  after update of status, client_interested on public.crm_appointments
  for each row execute function app.crm_appointment_closed();

-- ============================================================================
-- SELF-CHECK — rolled back.
-- ============================================================================
do $chk$
declare
  v_lead record; v_id uuid; n_before int := -1; n_after int := -1; n_again int := -1;
begin
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false and l.stage not in ('won', 'lost')
   limit 1;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'site_visit', now() - interval '2 hours', 90, v_lead.owner_id, v_lead.owner_id)
    returning id into v_id;
    update public.crm_appointments set status = 'completed', outcome = '241 check', outcome_at = now() where id = v_id;
    select count(*) into n_before from public.crm_follow_ups where appointment_id = v_id and purpose = 'meeting_feedback';
    update public.crm_appointments set client_interested = true where id = v_id;
    select count(*) into n_after from public.crm_follow_ups where appointment_id = v_id and purpose = 'meeting_feedback';
    update public.crm_appointments set client_interested = false where id = v_id;
    update public.crm_appointments set client_interested = true where id = v_id;
    select count(*) into n_again from public.crm_follow_ups where appointment_id = v_id and purpose = 'meeting_feedback';
    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if n_before <> 0 or n_after <> 1 or n_again <> 1 then
    raise exception '241 · feedback: none asked %, then interested %, flipped again % (expected 0, 1, 1)', n_before, n_after, n_again
      using errcode = 'CR241';
  end if;
  raise notice '241 · ✓ saying "interested" after the fact queues the feedback once, and never twice';
end
$chk$;
