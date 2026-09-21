-- ============================================================================
-- 240 · WHAT AN OFFICE VISIT DOES
-- ----------------------------------------------------------------------------
-- 239 added the kind. Here it behaves like the others:
--   · the client's confirmation and reminder say "office visit" (booking trigger);
--   · done + interested asks "how was the office visit" (237's trigger);
--   · booked → Visit scheduled, done → Visited, like a site visit or a demo.
-- ============================================================================

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
              when 'office_visit' then 'office visit'
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

CREATE OR REPLACE FUNCTION app.crm_lead_stage_signal(p_lead uuid)
 RETURNS TABLE(stage crm_stage, why text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_first_out timestamptz;
  r record;
begin
  /* ── visited ──────────────────────────────────────────────────────────── */
  select a.scheduled_at into r
    from public.crm_appointments a
   where a.lead_id = p_lead and a.kind in ('site_visit', 'meeting', 'office_visit') and a.status = 'completed'
   order by a.scheduled_at desc limit 1;
  if found then
    return query select 'visited'::public.crm_stage, 'the site visit or demo was completed';
    return;
  end if;

  /* ── visit_scheduled — still to come ─────────────────────────────────── */
  select a.scheduled_at into r
    from public.crm_appointments a
   where a.lead_id = p_lead and a.kind in ('site_visit', 'meeting', 'office_visit')
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at limit 1;
  if found then
    return query select 'visit_scheduled'::public.crm_stage, 'a site visit or demo is booked';
    return;
  end if;

  /* ── quotation_sent — a recorded quotation ───────────────────────────── */
  select q.number into r
    from public.crm_quotations q
   where q.lead_id = p_lead and q.status = 'sent'
   order by q.created_at desc limit 1;
  if found then
    return query select 'quotation_sent'::public.crm_stage,
                        'quotation ' || coalesce(r.number, '') || ' was sent';
    return;
  end if;

  /* ── 218 · quotation_sent — a file WE sent that says it is one ─────────────
     Punctuation and underscores are turned into spaces first, so
     "CNI_AJ_Trading_Quotation.pdf" reads "cni aj trading quotation pdf" and the
     whole-word test finds it. No backslashes in the pattern: a backslash in
     this file's history has reached Postgres as a bare letter once already. */
  select m.media_filename into r
    from public.crm_lead_messages m
   where m.lead_id = p_lead
     and m.direction = 'outbound'
     and m.kind::text in ('document', 'image')
     and m.hidden_at is null
     and regexp_replace(lower(coalesce(m.media_filename, '') || ' ' || coalesce(m.body, '')),
                        '[^a-z0-9]+', ' ', 'g')
         ~ '(^| )(quotation|quotations|quote|quotes|qt [0-9]+)( |$)'
   order by m.occurred_at desc limit 1;
  if found then
    return query select 'quotation_sent'::public.crm_stage,
                        'sent ' || coalesce(r.media_filename, 'a quotation');
    return;
  end if;

  /* ── 218 · proposal_pending — a file WE sent that says it is a proposal ── */
  select m.media_filename into r
    from public.crm_lead_messages m
   where m.lead_id = p_lead
     and m.direction = 'outbound'
     and m.kind::text in ('document', 'image')
     and m.hidden_at is null
     and regexp_replace(lower(coalesce(m.media_filename, '') || ' ' || coalesce(m.body, '')),
                        '[^a-z0-9]+', ' ', 'g')
         ~ '(^| )(proposal|proposals)( |$)'
   order by m.occurred_at desc limit 1;
  if found then
    return query select 'proposal_pending'::public.crm_stage,
                        'sent ' || coalesce(r.media_filename, 'a proposal');
    return;
  end if;

  /* ── contacted — an inbound AFTER one of ours (209) ──────────────────── */
  select min(m.occurred_at) into v_first_out
    from public.crm_lead_messages m
   where m.lead_id = p_lead and m.direction = 'outbound';

  if v_first_out is not null and exists (
    select 1 from public.crm_lead_messages i
     where i.lead_id = p_lead and i.direction = 'inbound'
       and i.occurred_at > v_first_out
  ) then
    return query select 'contacted'::public.crm_stage, 'the client replied to us';
    return;
  end if;

  if exists (
    select 1 from public.crm_lead_activity a
     where a.lead_id = p_lead and a.kind = 'call_connected'
  ) then
    return query select 'contacted'::public.crm_stage, 'a call was connected';
    return;
  end if;

  return;
end;
$function$;

drop trigger if exists crm_appointments_move_stage on public.crm_appointments;
create trigger crm_appointments_move_stage
  after insert or update of status, scheduled_at on public.crm_appointments
  for each row
  when (new.kind in ('site_visit'::public.crm_appointment_kind,
                     'meeting'::public.crm_appointment_kind,
                     'office_visit'::public.crm_appointment_kind))
  execute function app.crm_stage_watch();

-- ============================================================================
-- SELF-CHECK — rolled back: an office visit is booked, confirmed in its own
-- words, done with interest, and signals Visited.
-- ============================================================================
do $chk$
declare
  v_lead record; v_id uuid; v_body text; n_feedback int := -1; v_sig text;
begin
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false and l.stage not in ('won', 'lost')
   limit 1;
  if v_lead.id is null then
    raise exception '240 · no demo lead to check with' using errcode = 'CR240';
  end if;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'office_visit', now() + interval '2 days', 60, v_lead.owner_id, v_lead.owner_id)
    returning id into v_id;
    select body into v_body from public.crm_follow_ups where appointment_id = v_id and title like 'Confirm the%';
    update public.crm_appointments
       set scheduled_at = now() - interval '1 hour' where id = v_id;
    update public.crm_appointments
       set status = 'completed', outcome = '240 check', outcome_at = now(), client_interested = true where id = v_id;
    select count(*) into n_feedback from public.crm_follow_ups where appointment_id = v_id and purpose = 'meeting_feedback';
    select stage::text into v_sig from app.crm_lead_stage_signal(v_lead.id);
    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if v_body is null or v_body not like '%office visit%' then
    raise exception '240 · the confirmation does not say office visit: %', v_body using errcode = 'CR240';
  end if;
  if n_feedback <> 1 then
    raise exception '240 · done + interested queued % feedback messages', n_feedback using errcode = 'CR240';
  end if;
  if v_sig is distinct from 'visited' then
    raise exception '240 · a done office visit signalled % not visited', v_sig using errcode = 'CR240';
  end if;
  raise notice '240 · ✓ an office visit is confirmed as one, asked about when done, and moves the lead to Visited';
end
$chk$;
