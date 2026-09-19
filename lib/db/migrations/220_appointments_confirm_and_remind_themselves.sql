-- ============================================================================
-- 220 · APPOINTMENTS CONFIRM AND REMIND THEMSELVES, WINDOW OR NO WINDOW
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"I have created both templates."* Read back from Meta:
--
--   appointment_confirmed  [en_GB]  UTILITY  APPROVED  5 variables
--   appointment_reminder   [en_GB]  UTILITY  PENDING   5 variables
--
-- 219 wrote the confirmation as a follow-up row and chose `auto_send` only when
-- the 24-hour window happened to be open, because a standalone follow-up had
-- nowhere to put a template name — only a SEQUENCE STEP could carry one. With an
-- approved template that limit is gone, and the confirmation goes out whether or
-- not the client has written in the last day.
--
-- ── ⚠️ VALUES ON A FOLLOW-UP, TOKEN NAMES ON A STEP, AND THE NAMES SAY WHICH ──
-- `crm_sequence_steps.wa_template_vars` holds token NAMES because a step is a
-- plan reused across many leads — freezing "Ali" into it would put the wrong
-- person's name in the second lead's message. A standalone follow-up is the
-- opposite: one lead, one moment, one appointment at one time. Its values are
-- known when it is written and must not be recomputed later — so the column is
-- `wa_template_values`, and the different name is the warning.
--
-- ── ⚠️ AND {{5}} IS NEVER EMPTY ────────────────────────────────────────────
-- Meta returns **400 (#131008) Required parameter is missing** for a body
-- parameter with an empty string, and drops the whole message — measured against
-- the live API on 2026-09-19. A call has no location, so that slot falls back to
-- a sentence rather than a blank.
-- ============================================================================

-- ── 1 · A follow-up may carry its own template ──────────────────────────────
alter table public.crm_follow_ups
  add column if not exists wa_template_name text,
  add column if not exists wa_template_language text,
  add column if not exists wa_template_values text[];

comment on column public.crm_follow_ups.wa_template_values is
  '⚠️ RESOLVED VALUES, not token names — unlike crm_sequence_steps.wa_template_vars. This row is one lead at one moment; its words are fixed when it is written. 220.';


-- ── 2 · The queue prefers the row''s own template ───────────────────────────
-- ⚠️ DROPPED FIRST: `create or replace` cannot widen a return type. Reproduced
-- from 210 with the two template columns added.
drop function if exists app.crm_followups_to_send(integer);

create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
  channel text, title text, body text, subject text, lead_name text,
  to_phone text, to_email text, template_name text, template_language text,
  template_vars text[], template_values text[], document_ids uuid[], window_open boolean,
  wa_phone_number_id text, sender_name text, project_name text
)
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  with claimed as (
    update public.crm_follow_ups f
       set claimed_at = now()
     where f.id in (
       select c.id
         from public.crm_follow_ups c
         join public.crm_leads l on l.id = c.lead_id
         join public.projects p on p.id = l.project_id
         left join public.crm_lead_sequences ls on ls.id = c.lead_sequence_id
         left join public.crm_sequence_steps st
                on st.sequence_id = ls.sequence_id and st.step_no = c.sequence_step_no
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          and (
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             and l.whatsapp_consent is distinct from false
             /* 220 · the row's own template counts, not only a step's. */
             and (app.crm_window_is_open(c.lead_id)
                  or nullif(c.wa_template_name, '') is not null
                  or nullif(st.wa_template_name, '') is not null))
            or (c.channel = 'email' and l.email is not null)
          )
        order by c.due_at
        limit greatest(1, least(p_limit, 100))
        for update of c skip locked
     )
    returning f.id
  )
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         coalesce(nullif(f.wa_template_name, ''), nullif(st.wa_template_name, '')),
         coalesce(nullif(f.wa_template_language, ''), nullif(st.wa_template_language, ''), 'en'),
         st.wa_template_vars,
         f.wa_template_values,
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
    from claimed
    join public.crm_follow_ups f on f.id = claimed.id
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   order by f.due_at
$fn$;

comment on function app.crm_followups_to_send(integer) is
  'Claims and returns what the sender should send now. 187, widened in 202, claim added in 204, step template variables in 210, the row''s own template in 220.';


-- ── 3 · Booking writes the confirmation AND the reminder ────────────────────
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

  v_moved := tg_op = 'INSERT'
    or old.scheduled_at is distinct from new.scheduled_at
    or old.status is distinct from new.status;
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

  /* ⚠️ NEVER EMPTY — see this migration's header. */
  v_extra := coalesce(
    'Location: ' || nullif(btrim(new.location), ''),
    case when new.kind::text = 'call'
         then 'We look forward to speaking with you.'
         else 'We look forward to seeing you.' end);

  v_title := (case when tg_op = 'INSERT' then 'Confirm the ' else 'Confirm the new ' end) || v_what || ' time';

  v_body := 'Assalam-o-Alaikum ' || v_first || ', your ' || v_what || ' with ' || v_lead.business ||
            case when tg_op = 'INSERT' then ' is confirmed for ' else ' has been moved to ' end ||
            v_when || '. ' || v_extra;

  /* Both pending rows for this appointment go, so a client told Sunday and then
     Monday is neither confirmed nor reminded about the old time. */
  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Superseded — the appointment time changed.'
   where lead_id = new.lead_id
     and purpose = 'appointment_reminder'
     and status in ('planned', 'due');

  /* ── The confirmation, now ─────────────────────────────────────────────── */
  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id,
     wa_template_name, wa_template_language, wa_template_values)
  values (new.lead_id, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
          v_title, v_body, now(), v_lead.owner_id, v_lead.owner_id,
          'appointment_confirmed', 'en_GB',
          array[v_first, v_what, v_lead.business, v_when, v_extra]);

  /* ── The reminder, before it ───────────────────────────────────────────────
     ⚠️ ONLY IF THAT MOMENT IS STILL AHEAD. A visit booked for this afternoon
     with a two-hour reminder would otherwise queue a reminder for a time that
     has already gone, and the sender would fire it immediately — two messages
     in one minute saying the same thing. */
  v_mins := greatest(15, least(10080, v_lead.remind_minutes));
  v_remind := new.scheduled_at - make_interval(mins => v_mins);

  if v_remind > now() + interval '1 minute' then
    /* ⚠️ THE PHRASE IS FIXED NOW, and it is right because both moments are
       known: the reminder's own day against the appointment's day. Computing
       "tomorrow" at send time would need the sender to know what it is sending. */
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


-- ── 4 · The greeting moves to the two-variable template ─────────────────────
-- ⚠️ `lead_greeting_v2` DROPS THE SALESPERSON'S NAME, and that is the point: at
-- the moment a lead arrives nobody has spoken to them, so "I'm Sarah and I'll be
-- helping you" is a claim about a conversation that has not happened.
update public.crm_project_settings
   set greeting_template_name = 'lead_greeting_v2',
       greeting_template_language = 'en_GB',
       greeting_vars = array['lead_first_name', 'company']
 where greeting_template_name in ('_lead_greeting', 'lead_greeting');


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_appt uuid;
  n_conf int; n_rem int;
  c_tpl text; c_vals text[]; c_mode text;
  r_due timestamptz; r_vals text[]; r_when text;
  v_soon uuid; n_soon_rem int; v_day uuid; d_when text; d_extra text;
  v_queued int;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '220 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'Ayesha SELFCHECK-220', '+923000000220', '+923000000220', 'contacted', now(), v_owner, true)
    returning id into v_lead;

    /* A visit three days out: both rows expected. */
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, location, owner_id, created_by_id, is_test_data)
    values (v_lead, v_project, 'site_visit', 'scheduled',
            (((now() at time zone 'Asia/Karachi')::date + interval '3 days 11 hours')
              at time zone 'Asia/Karachi'),
            60, 'Site office', v_owner, v_owner, true)
    returning id into v_appt;

    select count(*)::int into n_conf from public.crm_follow_ups
     where lead_id = v_lead and wa_template_name = 'appointment_confirmed';
    select count(*)::int into n_rem from public.crm_follow_ups
     where lead_id = v_lead and wa_template_name = 'appointment_reminder';

    select wa_template_name, wa_template_values, mode::text into c_tpl, c_vals, c_mode
      from public.crm_follow_ups where lead_id = v_lead and wa_template_name = 'appointment_confirmed';
    select due_at, wa_template_values into r_due, r_vals
      from public.crm_follow_ups where lead_id = v_lead and wa_template_name = 'appointment_reminder';
    r_when := r_vals[4];

    /* ⚠️ THE CLAIM PATH SEES IT even with the window shut — the whole point. */
    select count(*)::int into v_queued from app.crm_followups_to_send(50) q
     where q.lead_id = v_lead and q.template_name = 'appointment_confirmed';

    /* ⚠️ AND THE DAY-BEFORE CASE, which the default 120 minutes never
       reaches: two hours before a visit is the SAME day, so "today" is right
       there and "tomorrow" only appears when the reminder is set a day out.
       The first run of this check asserted "tomorrow" for a two-hour reminder
       and the check was wrong, not the code. */
    update public.crm_project_settings set visit_reminder_minutes = 1440 where project_id = v_project;
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-220 dayahead', '+923000000222', '+923000000222', 'contacted', now(), v_owner, true)
    returning id into v_day;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, owner_id, created_by_id, is_test_data)
    values (v_day, v_project, 'meeting', 'scheduled',
            (((now() at time zone 'Asia/Karachi')::date + interval '3 days 11 hours') at time zone 'Asia/Karachi'),
            45, v_owner, v_owner, true);
    select wa_template_values[4], wa_template_values[5] into d_when, d_extra
      from public.crm_follow_ups where lead_id = v_day and wa_template_name = 'appointment_reminder';

    /* A visit in one hour: the reminder moment has gone, so only the
       confirmation is written. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-220 soon', '+923000000221', '+923000000221', 'contacted', now(), v_owner, true)
    returning id into v_soon;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, owner_id, created_by_id, is_test_data)
    values (v_soon, v_project, 'call', 'scheduled', now() + interval '1 hour', 30, v_owner, v_owner, true);
    select count(*)::int into n_soon_rem from public.crm_follow_ups
     where lead_id = v_soon and wa_template_name = 'appointment_reminder';

    raise exception using errcode = 'P0220', message = '220 rollback';
  exception when sqlstate 'P0220' then
    null;
  end;

  if n_conf <> 1 then
    raise exception '220 · expected 1 confirmation, got %', n_conf;
  end if;
  if c_mode is distinct from 'auto_send' then
    raise exception '220 · the confirmation is not automatic (mode %)', c_mode;
  end if;
  if array_length(c_vals, 1) <> 5 then
    raise exception '220 · the confirmation carries % values, the template needs 5', array_length(c_vals, 1);
  end if;
  if '' = any (c_vals) or c_vals[5] is null then
    raise exception '220 · an empty template value would be refused 131008 by Meta: %', c_vals;
  end if;
  if c_vals[1] <> 'Ayesha' or c_vals[2] <> 'site visit' or c_vals[5] not like 'Location:%' then
    raise exception '220 · the confirmation values are in the wrong order: %', c_vals;
  end if;
  if v_queued <> 1 then
    raise exception '220 · the sender did not claim the confirmation (%), so a shut window still blocks it', v_queued;
  end if;
  if n_rem <> 1 then
    raise exception '220 · expected 1 reminder, got %', n_rem;
  end if;
  if r_due >= (select scheduled_at from public.crm_appointments where id = v_appt) then
    raise exception '220 · the reminder is not before the appointment';
  end if;
  if r_when not like 'today at%' then
    raise exception '220 · a two-hour reminder is the same day and should say today, got %', r_when;
  end if;
  if d_when not like 'tomorrow,%' then
    raise exception '220 · a day-ahead reminder should say tomorrow, got %', d_when;
  end if;
  if d_extra is null or d_extra = '' then
    raise exception '220 · a meeting with no location left {{5}} empty — Meta refuses that';
  end if;
  if n_soon_rem <> 0 then
    raise exception '220 · an appointment inside the reminder window still queued a reminder';
  end if;

  raise notice '220 · appointments confirm now and remind before, window or no window';
end $chk$;
