-- ============================================================================
-- 237 · A DONE APPOINTMENT MOVES THE STAGE, AND AN INTERESTED CLIENT IS ASKED
--       HOW IT WENT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21: *"when appointment Done auto stage change and auto
-- feedback followup should send"* — *"but only client interested then"*.
--
--   1 · crm_appointments.client_interested — asked when a visit or a demo is
--       recorded as done (Appointments page, Today's plan). Required there.
--   2 · Done + interested → a feedback message is queued (purpose
--       meeting_feedback, auto-send, the approved template when the window is
--       shut — 234's sender picks it). About two hours later, inside office
--       hours, otherwise the next working morning at 11. It cancels itself if
--       the client writes first (231's cancel_on_reply). Done + not interested
--       → nothing is sent.
--   3 · The stage: a done site visit already moved the lead to Visited (209).
--       A DEMO now counts the same — booked → Visit scheduled, done → Visited —
--       because the AI agent books demos as meetings (236) and the owner treats
--       them as one: *"demo, or you can say visit"*. Forward only, as ever.
--       (No project had a meeting appointment when this was written.)
-- ============================================================================

alter table public.crm_appointments
  add column if not exists client_interested boolean;

comment on column public.crm_appointments.client_interested is
  'Asked when the appointment is recorded as done. True queues the feedback message (237); false sends nothing; null was never asked.';

/* ── 3 · A demo counts as a visit for the stage ─────────────────────────── */
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
   where a.lead_id = p_lead and a.kind in ('site_visit', 'meeting') and a.status = 'completed'
   order by a.scheduled_at desc limit 1;
  if found then
    return query select 'visited'::public.crm_stage, 'the site visit or demo was completed';
    return;
  end if;

  /* ── visit_scheduled — still to come ─────────────────────────────────── */
  select a.scheduled_at into r
    from public.crm_appointments a
   where a.lead_id = p_lead and a.kind in ('site_visit', 'meeting')
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
  when (new.kind in ('site_visit'::public.crm_appointment_kind, 'meeting'::public.crm_appointment_kind))
  execute function app.crm_stage_watch();

/* ── 2 · Closing an appointment: its reminders go (235), and an interested
         client is asked how it went ────────────────────────────────────────── */
create or replace function app.crm_appointment_closed()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
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

  v_what := case new.kind::text when 'site_visit' then 'site visit' else 'meeting' end;

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
$fn$;

-- ============================================================================
-- SELF-CHECK — rolled back: nothing it writes survives.
-- ============================================================================
do $chk$
declare
  v_lead record; v_yes uuid; v_no uuid; v_demo uuid;
  n_yes int := -1; n_no int := -1; v_due timestamptz; v_hour int; v_dow int; v_sig text;
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
    raise exception '237 · no demo lead to check with' using errcode = 'CR237';
  end if;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'site_visit', now() - interval '3 hours', 90, v_lead.owner_id, v_lead.owner_id)
    returning id into v_yes;
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id)
    values (v_lead.id, v_lead.project_id, 'site_visit', now() - interval '5 hours', 90, v_lead.owner_id, v_lead.owner_id)
    returning id into v_no;

    update public.crm_appointments
       set status = 'completed', outcome = '237 check', outcome_at = now(), client_interested = true
     where id = v_yes;
    update public.crm_appointments
       set status = 'completed', outcome = '237 check', outcome_at = now(), client_interested = false
     where id = v_no;

    select count(*) into n_yes from public.crm_follow_ups where appointment_id = v_yes and purpose = 'meeting_feedback';
    select count(*) into n_no from public.crm_follow_ups where appointment_id = v_no and purpose = 'meeting_feedback';
    select due_at into v_due from public.crm_follow_ups where appointment_id = v_yes and purpose = 'meeting_feedback';

    /* A demo counts: a completed meeting is a "visited" signal. */
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id, status, outcome, outcome_at)
    values (v_lead.id, v_lead.project_id, 'meeting', now() - interval '1 day', 45, v_lead.owner_id, v_lead.owner_id, 'completed', '237 check', now())
    returning id into v_demo;
    delete from public.crm_appointments where id in (v_yes, v_no);
    select stage::text into v_sig from app.crm_lead_stage_signal(v_lead.id);

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if n_yes <> 1 or n_no <> 0 then
    raise exception '237 · feedback queued: interested %, not interested % (expected 1 and 0)', n_yes, n_no using errcode = 'CR237';
  end if;
  v_hour := extract(hour from v_due at time zone 'Asia/Karachi');
  v_dow := extract(isodow from v_due at time zone 'Asia/Karachi');
  if v_due <= now() or v_hour < 10 or v_hour >= 19 or v_dow = 7 then
    raise exception '237 · the feedback is due at % Karachi, outside office hours', v_due at time zone 'Asia/Karachi' using errcode = 'CR237';
  end if;
  if v_sig is distinct from 'visited' then
    raise exception '237 · a completed demo did not signal Visited (got %)', v_sig using errcode = 'CR237';
  end if;
  raise notice '237 · ✓ done + interested queues one feedback at % Karachi; not interested queues none; a done demo signals Visited', to_char(v_due at time zone 'Asia/Karachi', 'Dy HH24:MI');
end
$chk$;
