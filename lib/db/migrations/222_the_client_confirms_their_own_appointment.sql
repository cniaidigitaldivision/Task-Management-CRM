-- ============================================================================
-- 222 · THE CLIENT CONFIRMS THEIR OWN APPOINTMENT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"When a client clicks Confirmed, it should automatically
-- be confirmed in my system and a reminder message should be sent that our
-- meeting is scheduled — a short or a very warm reminder if possible."*
--
-- The webhook already records a template's quick-reply tap: Meta sends it as a
-- message of kind `button` whose text is the button's own words, and 184 stores
-- it like any other inbound. Nothing acted on it. Now the tap moves the
-- appointment and answers the client.
--
-- ── ⚠️ AND IT FIXES A LIVE BUG FOUND WHILE READING 220 ─────────────────────
-- `crm_appointment_booked` treated ANY status change as a reason to confirm
-- again:
--
--     or old.status is distinct from new.status
--
-- So a salesperson marking an appointment `confirmed` by hand today sends the
-- client a SECOND "your site visit is confirmed for…" — and the client tapping
-- Confirm would have done the same, which is how this was noticed. A booking is
-- re-announced when its TIME moves, or when it comes back from cancelled. Being
-- confirmed is not a new fact about when it is.
--
-- ── ⚠️ WHICH APPOINTMENT: THE SOONEST ONE STILL AHEAD ──────────────────────
-- Meta's button reply carries `context.id` — the wamid of the message tapped —
-- but nothing links a wamid back to an appointment, and adding that chain would
-- be three joins to answer a question the lead already answers: a client has one
-- upcoming appointment at a time. If they ever have two, the soonest is the one
-- they were just written to about.
-- ============================================================================

-- ── 1 · Booking no longer re-announces itself on a status change ────────────
create or replace function app.crm_appointment_booked()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
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

  v_first := coalesce(nullif(split_part(btrim(v_lead.full_name), ' ', 1), ''), 'Sir/Madam');

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

  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Superseded — the appointment time changed.'
   where lead_id = new.lead_id
     and purpose = 'appointment_reminder'
     and status in ('planned', 'due');

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id,
     wa_template_name, wa_template_language, wa_template_values)
  values (new.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
          v_title, v_body, now(), v_lead.owner_id, v_lead.owner_id,
          'appointment_confirmed', 'en_GB',
          array[v_first, v_what, v_lead.business, v_when, v_extra]);

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
       wa_template_name, wa_template_language, wa_template_values)
    values (new.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'planned',
            'Remind about the ' || v_what,
            'Assalam-o-Alaikum ' || v_first || ', a reminder that your ' || v_what ||
              ' with ' || v_lead.business || ' is ' || v_rwhen || '. ' || v_extra,
            v_remind, v_lead.owner_id, v_lead.owner_id,
            'appointment_reminder', 'en_GB',
            array[v_first, v_what, v_lead.business, v_rwhen, v_extra]);
  end if;

  return null;
end;
$fn$;


-- ── 2 · The tap itself ──────────────────────────────────────────────────────
create or replace function app.crm_appointment_answered(p_lead uuid, p_reply text)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  /* Lower case, trimmed, and stripped of trailing punctuation, so that
     "Confirmed." and "confirm" are the same answer. */
  v_said  text := lower(btrim(regexp_replace(coalesce(p_reply, ''), '[[:punct:][:space:]]+$', '')));
  v_appt  record;
  v_lead  record;
  v_what  text;
  v_when  text;
  v_first text;
begin
  if v_said = '' then
    return null;
  end if;

  /* ⚠️ THE WHOLE MESSAGE, NOT A SUBSTRING OF IT. This runs on every inbound
     message, so a loose pattern is not a small mistake — an earlier draft of
     this function searched for "ok" anywhere in the text, which means
     "Can you b-o-o-k another time?" contains it and would have silently marked
     the visit confirmed and thanked them for it.

     ⚠️ AND ONLY PHRASES A PERSON SENDS ON PURPOSE. Bare "yes" and "ok" are
     deliberately absent: a client typing "ok" is usually agreeing with the last
     thing said, not confirming a visit, and we cannot tell which. A tap always
     arrives as the button's exact text, so the button path is unaffected — and
     anything unrecognised stays an ordinary message for the salesperson, which
     is the direction that fails safely. */
  if v_said = any (array['change the time', 'change time', 'reschedule',
                         'another time', 'a different time', 'different time']) then
    v_said := 'reschedule';
  elsif v_said = any (array['confirm', 'confirmed', 'confirm it', 'yes confirm',
                            'yes confirmed', 'confirm please', 'ji confirm']) then
    v_said := 'confirm';
  else
    return null;
  end if;

  select a.* into v_appt
    from public.crm_appointments a
   where a.lead_id = p_lead
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at
   limit 1;

  if not found then
    return null;
  end if;

  select l.full_name, l.owner_id,
         coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name) as business
    into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
   where l.id = p_lead;

  v_first := coalesce(nullif(split_part(btrim(v_lead.full_name), ' ', 1), ''), 'Sir/Madam');
  v_what := case v_appt.kind::text
              when 'site_visit' then 'site visit'
              when 'meeting'    then 'meeting'
              when 'call'       then 'call'
              else 'appointment' end;
  v_when := to_char(v_appt.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMonth') ||
            ' at ' || to_char(v_appt.scheduled_at at time zone 'Asia/Karachi', 'FMHH12:MI AM');

  /* ── They want a different time ──────────────────────────────────────────
     ⚠️ NOTHING IS MOVED AUTOMATICALLY. Only the salesperson knows what else is
     in the diary, and a client saying "not that time" has not said which time.
     This is a handover with the question attached. */
  if v_said = 'reschedule' then
    perform app.crm_agent_hand_over(
      p_lead,
      'asked to change the ' || v_what || ' booked for ' || v_when);
    return 'reschedule';
  end if;

  /* ── They confirmed ──────────────────────────────────────────────────────
     Only a real move is written, so a second tap changes nothing and sends
     nothing. */
  if v_appt.status <> 'confirmed' then
    update public.crm_appointments
       set status = 'confirmed', updated_at = now()
     where id = v_appt.id;

    /* ⚠️ FREE TEXT, AND THAT IS SAFE HERE: they have just written to us, so the
       24-hour window is open by definition. Short and warm, as asked — a
       template would be a second approval for one sentence. */
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at,
       assigned_to_id, created_by_id)
    values (p_lead, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
            'Thank them for confirming',
            'Shukriya ' || v_first || '! Your ' || v_what || ' is confirmed for ' || v_when ||
              '. We look forward to seeing you — message us any time if anything changes.',
            now(), v_lead.owner_id, v_lead.owner_id);
  end if;

  return 'confirmed';
end;
$fn$;

grant execute on function app.crm_appointment_answered(uuid, text) to cni_app;


-- ── 3 · What the webhook is allowed to call ───────────────────────────
/*
 * ⚠️ THE WEBHOOK CANNOT LOOK THE LEAD UP ITSELF. It runs under `withAppRole`,
 * which does not bypass RLS — a bare `select lead_id from crm_lead_messages`
 * there returns zero rows for everyone, always, and the confirmation would
 * silently never happen. It is the trap this codebase has hit before.
 *
 * So the pairing of message to reply happens here, inside a definer, and the
 * webhook passes the one id it already holds. It also cannot pair them wrongly,
 * which a two-argument call could.
 */
create or replace function app.crm_act_on_reply(p_message uuid)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead uuid;
  v_body text;
begin
  select m.lead_id, m.body into v_lead, v_body
    from public.crm_lead_messages m
   where m.id = p_message and m.direction = 'inbound';

  if v_lead is null then
    return null;
  end if;

  return app.crm_appointment_answered(v_lead, v_body);
end;
$fn$;

grant execute on function app.crm_act_on_reply(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_appt uuid; v_other uuid;
  n_before int; n_after int; s_after text; said text;
  n_thanks int; n_twice int; s_hand text; n_hand int; v_msg uuid;
  v_loose uuid; s_loose text; s_untouched text; v_word text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '222 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-222', '+923000000222', '+923000000222', 'contacted', now(), v_owner, true)
    returning id into v_lead;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, location, owner_id, created_by_id, is_test_data)
    values (v_lead, v_project, 'site_visit', 'scheduled', now() + interval '3 days', 60, 'Site office', v_owner, v_owner, true)
    returning id into v_appt;

    select count(*)::int into n_before from public.crm_follow_ups where lead_id = v_lead;

    /* 1 · The tap confirms it, thanks them, and says nothing twice.
          ⚠️ THROUGH THE WEBHOOK'S OWN DOOR, not the inner function — that is
          the path that has to work, and the one with the RLS trap in it. */
    insert into public.crm_lead_messages (lead_id, direction, kind, body, wa_message_id)
    values (v_lead, 'inbound', 'text', 'Confirm', 'selfcheck-222-' || gen_random_uuid()::text)
    returning id into v_msg;
    select app.crm_act_on_reply(v_msg) into said;
    select status::text into s_after from public.crm_appointments where id = v_appt;
    select count(*)::int into n_thanks from public.crm_follow_ups
     where lead_id = v_lead and title = 'Thank them for confirming';

    /* 2 · ⚠️ AND CONFIRMING DID NOT RE-ANNOUNCE THE BOOKING. */
    select count(*)::int into n_after from public.crm_follow_ups
     where lead_id = v_lead and wa_template_name = 'appointment_confirmed';

    /* 3 · A second tap changes nothing. */
    perform app.crm_act_on_reply(v_msg);
    select count(*)::int into n_twice from public.crm_follow_ups
     where lead_id = v_lead and title = 'Thank them for confirming';

    /* 4 · Asking for another time hands over rather than moving anything. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-222 other', '+923000000223', '+923000000223', 'contacted', now(), v_owner, true)
    returning id into v_other;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, owner_id, created_by_id, is_test_data)
    values (v_other, v_project, 'meeting', 'scheduled', now() + interval '2 days', 30, v_owner, v_owner, true);
    select app.crm_appointment_answered(v_other, 'Change the time') into s_hand;
    select count(*)::int into n_hand from public.crm_leads
     where id = v_other and agent_handoff_at is not null;

    /* 5 · ⚠️ AND ORDINARY SENTENCES ARE LEFT ALONE. Each of these contains a
          confirming word as a SUBSTRING, which is how the first draft of this
          function would have confirmed a visit nobody agreed to. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-222 loose', '+923000000224', '+923000000224', 'contacted', now(), v_owner, true)
    returning id into v_loose;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, owner_id, created_by_id, is_test_data)
    values (v_loose, v_project, 'site_visit', 'scheduled', now() + interval '4 days', 60, v_owner, v_owner, true);

    foreach v_word in array array[
      'Can you book another time?',   -- "b-OK-another"
      'Okay send me the location',    -- starts with a confirming word
      'Yes I saw the quotation',
      'Please confirm the price first',
      'ji haan bhai kal baat karte hain'
    ] loop
      select app.crm_appointment_answered(v_loose, v_word) into s_loose;
      if s_loose is not null then
        raise exception '222 · "%" was read as "%" and should have been left alone', v_word, s_loose;
      end if;
    end loop;

    select status::text into s_untouched from public.crm_appointments where lead_id = v_loose;

    raise exception using errcode = 'P0222', message = '222 rollback';
  exception when sqlstate 'P0222' then
    null;
  end;

  if said is distinct from 'confirmed' then
    raise exception '222 · a Confirm tap was not understood (got %)', said;
  end if;
  if s_after is distinct from 'confirmed' then
    raise exception '222 · the appointment was not confirmed (status %)', s_after;
  end if;
  if n_thanks <> 1 then
    raise exception '222 · expected 1 thank-you, got %', n_thanks;
  end if;
  if n_after <> 1 then
    raise exception '222 · confirming re-announced the booking (% confirmations)', n_after;
  end if;
  if n_twice <> 1 then
    raise exception '222 · a second tap sent a second thank-you';
  end if;
  if s_hand is distinct from 'reschedule' then
    raise exception '222 · a request for another time was not understood (got %)', s_hand;
  end if;
  if n_hand <> 1 then
    raise exception '222 · asking for another time did not reach the salesperson';
  end if;
  if s_untouched is distinct from 'scheduled' then
    raise exception '222 · an ordinary sentence moved an appointment (status %)', s_untouched;
  end if;

  raise notice '222 · a client can confirm their own appointment, asking to move it reaches a person, and an ordinary sentence does neither';
end $chk$;
