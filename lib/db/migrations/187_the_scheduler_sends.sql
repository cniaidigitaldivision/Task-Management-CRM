-- ============================================================================
-- 187 · THE SCHEDULER SENDS — business hours, conditions a person chooses, and
--       a queue something can actually deliver from
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the review screen saying nothing is sent automatically:
--
--   *"I am on that the follow-up will be sent at the respective time
--   automatically. If I have to log in and send the follow-up, then why should I
--   not write the message at that time and send it? What is the purpose of the
--   follow-up then, and the automation of follow-ups then?"*
--
-- They are right. 170 built a scheduler that QUEUES and nothing has ever
-- delivered from that queue. This migration gives the queue everything a sender
-- needs, and gives the plan the two things the owner's designs show: business
-- hours with the days it may run, and stop conditions that are CHOSEN rather
-- than hard-coded.
--
-- ── ⚠️ WHAT THE DATABASE STILL REFUSES TO PROMISE ──────────────────────────
-- WhatsApp's 24-hour rule is not ours to relax. Outside it, only a template Meta
-- has approved may go out, and this account has none of its own yet. So a step
-- that would be free text outside the window is still handed to a person
-- (`review_first`) rather than attempted — the rule proved live on 2026-09-15,
-- where Meta's TEST number accepted free text 26 hours late and a production
-- number does not.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · WHEN A PLAN MAY SEND, AND WHAT STOPS IT
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_sequences
  /* ⚠️ DEFAULT TRUE PRESERVES 170's BEHAVIOUR for every plan written before
     today. These make the rules choosable, not weaker: the two that are never
     choosable — a closed lead and a stated no — are not columns at all. */
  add column if not exists stop_on_visit boolean not null default true,
  add column if not exists stop_on_quotation_dead boolean not null default true,
  /* Business hours, in Karachi. NULL means "whatever the project's quiet hours
     say", which is what every existing plan gets. */
  add column if not exists send_from_hour smallint,
  add column if not exists send_to_hour smallint,
  /* 0 = Sunday … 6 = Saturday. NULL means any day. */
  add column if not exists send_days smallint[];

alter table public.crm_sequences
  drop constraint if exists crm_sequences_hours_sane;
alter table public.crm_sequences
  add constraint crm_sequences_hours_sane check (
    (send_from_hour is null) = (send_to_hour is null)
    and (send_from_hour is null
         or (send_from_hour between 0 and 23 and send_to_hour between 1 and 24
             and send_to_hour > send_from_hour))
  );

comment on column public.crm_sequences.send_from_hour is
  'Business hours in Asia/Karachi. NULL falls back to the project''s quiet hours. 187.';
comment on column public.crm_sequences.send_days is
  'Days this plan may send on, 0=Sunday. NULL or empty means any day. 187.';

alter table public.crm_sequence_steps
  /* The owner's design puts this on the step: "Only if no reply". */
  add column if not exists only_if_no_reply boolean not null default false,
  add column if not exists subject text,
  add column if not exists wa_template_language text,
  /* Files to attach — rows of `crm_documents`, checked against the lead when sent. */
  add column if not exists document_ids uuid[];

comment on column public.crm_sequence_steps.only_if_no_reply is
  'Skip this step when the client has written since the plan started or was last resumed. ⚠️ Default FALSE: the sequence-wide stop_on_reply already pauses everything, and a step that silently skipped itself would be a hole nobody asked for. 187.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE NEXT MOMENT THIS PLAN IS ALLOWED TO SEND
-- ----------------------------------------------------------------------------
-- ⚠️ ONE FUNCTION, SO THE ENGINE AND THE SCREEN CANNOT DISAGREE. The dialog says
-- "Send during business hours, 10 AM – 6 PM, Mon–Sat"; this is what decides it.
-- ⚠️ AND IT NEVER DROPS A STEP — it always returns a moment, pushing forward at
-- most a week. A chase that silently skipped a step leaves a hole in it.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_next_send_slot(
  p_at         timestamptz,
  p_from       smallint,
  p_to         smallint,
  p_days       smallint[],
  p_night_from integer,
  p_night_to   integer
) returns timestamptz
language plpgsql
immutable
as $fn$
declare
  v_local timestamp;
  v_hour  integer;
  v_dow   integer;
  v_days  smallint[] := nullif(p_days, '{}'::smallint[]);
  i       integer := 0;
  v_at    timestamptz := p_at;
begin
  /* No business hours on the plan: the project's quiet hours, exactly as 170. */
  if p_from is null then
    if p_night_from is null or p_night_to is null then
      return v_at;
    end if;
    v_local := v_at at time zone 'Asia/Karachi';
    v_hour := extract(hour from v_local)::integer;
    if (p_night_from < p_night_to and v_hour >= p_night_from and v_hour < p_night_to)
       or (p_night_from > p_night_to and (v_hour >= p_night_from or v_hour < p_night_to))
    then
      return (date_trunc('day', v_local) + make_interval(hours => p_night_to)
              + case when v_hour >= p_night_from then interval '1 day' else interval '0' end)
             at time zone 'Asia/Karachi';
    end if;
    return v_at;
  end if;

  /* Business hours, and the days they run on. */
  loop
    i := i + 1;
    exit when i > 9;
    v_local := v_at at time zone 'Asia/Karachi';
    v_hour := extract(hour from v_local)::integer;
    v_dow := extract(dow from v_local)::integer;

    if v_days is not null and not (v_dow = any (v_days)) then
      v_at := (date_trunc('day', v_local) + interval '1 day' + make_interval(hours => p_from))
              at time zone 'Asia/Karachi';
      continue;
    end if;
    if v_hour < p_from then
      v_at := (date_trunc('day', v_local) + make_interval(hours => p_from)) at time zone 'Asia/Karachi';
      continue;
    end if;
    if v_hour >= p_to then
      v_at := (date_trunc('day', v_local) + interval '1 day' + make_interval(hours => p_from))
              at time zone 'Asia/Karachi';
      continue;
    end if;
    return v_at;
  end loop;

  return v_at;
end;
$fn$;

comment on function app.crm_next_send_slot(timestamptz, smallint, smallint, smallint[], integer, integer) is
  'The next moment a plan may send: its own business hours and days, or the project''s quiet hours. Never returns NULL — a step is pushed, never dropped. 187.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE STOP-CONDITIONS, AS THE PLAN CHOSE THEM
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_sequence_stop_reason(p_lead_sequence uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  r record;
begin
  select ls.id, ls.lead_id, ls.started_at, ls.resumed_at, ls.quotation_id,
         s.stop_on_reply, s.stop_on_visit, s.stop_on_quotation_dead,
         s.is_active, s.purpose::text as purpose,
         l.stage, l.whatsapp_consent
    into r
    from public.crm_lead_sequences ls
    join public.crm_sequences s on s.id = ls.sequence_id
    join public.crm_leads l on l.id = ls.lead_id
   where ls.id = p_lead_sequence;

  if not found then
    return 'the sequence no longer exists';
  end if;

  /* ⚠️ THE TWO THAT ARE NEVER A CHOICE. A closed lead and a stated no are not
     preferences; nothing in the dialog can switch them off. */
  if r.stage in ('won', 'lost') then
    return 'the lead is closed';
  end if;
  if r.whatsapp_consent is false then
    return 'they asked not to be messaged';
  end if;

  if not r.is_active then
    return 'the sequence was switched off';
  end if;

  /* The client replied — measured from the last resume (182). */
  if r.stop_on_reply and exists (
    select 1 from public.crm_lead_messages m
     where m.lead_id = r.lead_id
       and m.direction = 'inbound'
       and m.created_at >= coalesce(r.resumed_at, r.started_at)
  ) then
    return 'the client replied';
  end if;

  if r.stop_on_quotation_dead and r.quotation_id is not null and exists (
    select 1 from public.crm_quotations q
     where q.id = r.quotation_id
       and (q.status in ('expired', 'rejected', 'superseded')
            or (q.valid_until is not null
                and q.valid_until < (now() at time zone 'Asia/Karachi')::date))
  ) then
    return 'the quotation is no longer live';
  end if;

  /* ⚠️ A CHASE ONLY (185), AND NOW ONLY WHEN THE PLAN ASKED FOR IT. */
  if r.stop_on_visit
     and r.purpose in ('no_response', 're_engage', 'quotation')
     and exists (
       select 1 from public.crm_appointments a
        where a.lead_id = r.lead_id
          and a.status in ('scheduled', 'confirmed')
          and a.scheduled_at >= now()
     ) then
    return 'a visit is already booked';
  end if;

  return null;
end;
$fn$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · ADVANCING — business hours, a step that may skip itself, and the mode
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_advance_sequences()
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  r          record;
  v_step     record;
  v_stop     text;
  v_settings record;
  v_slot     timestamptz;
  v_mode     public.crm_followup_mode;
  v_title    text;
  v_replied  boolean;
  n_queued   integer := 0;
begin
  for r in
    select ls.id, ls.lead_id, ls.sequence_id, ls.current_step, ls.total_steps,
           ls.started_at, ls.resumed_at,
           s.send_from_hour, s.send_to_hour, s.send_days,
           l.project_id, l.owner_id
      from public.crm_lead_sequences ls
      join public.crm_sequences s on s.id = ls.sequence_id
      join public.crm_leads l on l.id = ls.lead_id
     where ls.state in ('scheduled', 'active')
       and ls.next_step_at is not null
       and ls.next_step_at <= now()
     order by ls.next_step_at
     limit 200
  loop
    v_stop := app.crm_sequence_stop_reason(r.id);
    if v_stop is not null then
      update public.crm_lead_sequences
         set state = (case when v_stop = 'the client replied' then 'paused' else 'stopped' end)
                       ::public.crm_sequence_state,
             paused_at  = case when v_stop = 'the client replied' then now() end,
             stopped_at = case when v_stop <> 'the client replied' then now() end,
             pause_reason = v_stop,
             next_step_at = null,
             updated_at = now()
       where id = r.id;
      continue;
    end if;

    select * into v_step
      from public.crm_sequence_steps
     where sequence_id = r.sequence_id
       and step_no = r.current_step + 1
     limit 1;

    if not found then
      update public.crm_lead_sequences
         set state = 'stopped', stopped_at = now(),
             pause_reason = 'every step has been sent',
             next_step_at = null, updated_at = now()
       where id = r.id;
      continue;
    end if;

    /* ── ⚠️ BUSINESS HOURS FIRST. Nothing is dropped: the step is pushed to the
       next moment this plan is allowed to send. */
    select * into v_settings from public.crm_project_settings where project_id = r.project_id;
    v_slot := app.crm_next_send_slot(
      now(), r.send_from_hour, r.send_to_hour, r.send_days,
      v_settings.sla_night_from, v_settings.sla_night_to);
    if v_slot > now() + interval '1 minute' then
      update public.crm_lead_sequences set next_step_at = v_slot, updated_at = now() where id = r.id;
      continue;
    end if;

    /* ── ONE CHASE PER LEAD PER DAY ─────────────────────────────────────── */
    if exists (
      select 1 from public.crm_follow_ups f
       where f.lead_id = r.lead_id
         and f.lead_sequence_id is not null
         and (f.created_at at time zone 'Asia/Karachi')::date
             = (now() at time zone 'Asia/Karachi')::date
    ) then
      update public.crm_lead_sequences
         set next_step_at = now() + interval '1 day', updated_at = now()
       where id = r.id;
      continue;
    end if;

    v_replied := exists (
      select 1 from public.crm_lead_messages m
       where m.lead_id = r.lead_id
         and m.direction = 'inbound'
         and m.created_at >= coalesce(r.resumed_at, r.started_at));

    v_title := coalesce(nullif(v_step.title, ''),
                        coalesce(nullif(v_step.purpose, ''), 'Follow up') || ' · step ' || v_step.step_no);

    /* ── ⚠️ "ONLY IF NO REPLY" IS RECORDED, NOT SILENTLY DROPPED. The row is
       written as `skipped` so the plan on screen still has all its steps and one
       of them says why it did not go. */
    if v_step.only_if_no_reply and v_replied then
      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at,
         lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id, outcome_note)
      values (
        r.lead_id,
        coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
        v_step.channel, 'remind_me', 'skipped', v_title, v_step.body, now(),
        r.id, v_step.step_no, r.owner_id, r.owner_id,
        'Skipped — the client had already replied');
    else
      v_mode := case
        when v_step.channel = 'email' then v_step.mode
        when v_step.channel <> 'whatsapp' then 'remind_me'
        when v_step.mode = 'remind_me' then 'remind_me'
        when app.crm_window_is_open(r.lead_id) then v_step.mode
        when nullif(v_step.wa_template_name, '') is not null then v_step.mode
        /* ⚠️ Free text outside the 24-hour window: a person sends it, or nobody does. */
        else 'review_first'
      end::public.crm_followup_mode;

      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at,
         lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
      values (
        r.lead_id,
        coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
        v_step.channel, v_mode, 'due', v_title, v_step.body, now(),
        r.id, v_step.step_no, r.owner_id, r.owner_id);

      /* A step a PERSON must complete becomes the lead's next action (186). */
      if v_mode <> 'auto_send' then
        update public.crm_leads
           set next_action = v_title,
               next_action_at = now(),
               next_action_type = v_step.channel::text::public.crm_next_action_kind
         where id = r.lead_id
           and (next_action_at is null or next_action_at < now());
      end if;
    end if;

    update public.crm_lead_sequences
       set state = 'active',
           current_step = v_step.step_no,
           started_at = coalesce(started_at, now()),
           next_step_at = (
             select app.crm_next_send_slot(
                      now() + make_interval(days => greatest(nx.delay_days, 0)),
                      r.send_from_hour, r.send_to_hour, r.send_days,
                      v_settings.sla_night_from, v_settings.sla_night_to)
               from public.crm_sequence_steps nx
              where nx.sequence_id = r.sequence_id and nx.step_no = v_step.step_no + 1
           ),
           updated_at = now()
     where id = r.id;

    n_queued := n_queued + 1;
  end loop;

  return n_queued;
end;
$fn$;

revoke all on function app.crm_advance_sequences() from public;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · THE QUEUE A SENDER READS
-- ----------------------------------------------------------------------------
-- ⚠️ IT RE-ASKS THE STOP-CONDITIONS. A row queued fifteen minutes ago is a
-- promise about now: the client may have replied in between, and the whole point
-- of the engine is that they are never chased after they do.
-- ⚠️ AND IT NEVER RETURNS A ROW IT CANNOT DEFEND — no number, no consent, or a
-- free-text WhatsApp step whose window has closed since it was queued.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid,
  lead_id uuid,
  project_id uuid,
  lead_sequence_id uuid,
  channel text,
  title text,
  body text,
  subject text,
  lead_name text,
  to_phone text,
  to_email text,
  template_name text,
  template_language text,
  document_ids uuid[],
  window_open boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         nullif(st.wa_template_name, ''), coalesce(nullif(st.wa_template_language, ''), 'en'),
         st.document_ids,
         app.crm_window_is_open(f.lead_id)
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   where f.status = 'due'
     and f.mode = 'auto_send'
     and f.due_at <= now()
     and l.stage not in ('won', 'lost')
     and (f.lead_sequence_id is null or app.crm_sequence_stop_reason(f.lead_sequence_id) is null)
     and (
       (f.channel = 'whatsapp'
        and l.phone_e164 is not null
        and l.whatsapp_consent is distinct from false
        /* Free text needs the window; outside it only an approved template goes. */
        and (app.crm_window_is_open(f.lead_id) or nullif(st.wa_template_name, '') is not null))
       or (f.channel = 'email' and l.email is not null)
     )
   order by f.due_at
   limit greatest(1, least(p_limit, 100))
$fn$;

revoke all on function app.crm_followups_to_send(integer) from public;

/* What happened to it — written by the sender, in one statement. */
create or replace function app.crm_followup_sent(
  p_follow_up uuid,
  p_message_id text,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  n integer;
begin
  update public.crm_follow_ups
     set status = case when p_error is null then 'done' else 'failed' end::public.crm_followup_status,
         done_at = case when p_error is null then now() end,
         outcome_note = coalesce(p_error, 'Sent automatically' ||
                                 case when p_message_id is null then '' else ' · ' || p_message_id end),
         updated_at = now()
   where id = p_follow_up
     and status = 'due';
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

revoke all on function app.crm_followups_to_send(integer) from public;
revoke all on function app.crm_followup_sent(uuid, text, text) from public;

/* The message itself, in the thread, attributed to the lead's owner.
   ⚠️ SENT BY A MACHINE ON SOMEBODY'S BEHALF IS STILL SOMEBODY'S MESSAGE — the
   conversation has to show it, or the next person to open the chat will send the
   same thing again. */
create or replace function app.crm_record_sequence_message(
  p_follow_up uuid,
  p_wamid text,
  p_body text,
  p_subject text
) returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_id uuid;
begin
  insert into public.crm_lead_messages
    (lead_id, channel, direction, kind, subject, body, wa_message_id, status, sent_by_id, occurred_at)
  select f.lead_id, f.channel::text::public.crm_message_channel, 'outbound', 'text',
         p_subject, p_body, p_wamid, 'sent', f.assigned_to_id, now()
    from public.crm_follow_ups f
   where f.id = p_follow_up
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function app.crm_record_sequence_message(uuid, text, text, text) from public;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_seq uuid; v_ls uuid;
  v_slot timestamptz; v_local timestamp;
  v_queued integer; v_status text; v_note text; v_mode text;
  v_rows integer;
begin
  -- 1 · The slot function, on its own.
  --     Tuesday 2026-09-15 20:00 Karachi, hours 10–18 → Wednesday 10:00.
  v_slot := app.crm_next_send_slot(
    timestamptz '2026-09-15 20:00+05', 10::smallint, 18::smallint, null, null, null);
  v_local := v_slot at time zone 'Asia/Karachi';
  if v_local <> timestamp '2026-09-16 10:00' then
    raise exception '187 · after hours did not move to the next morning (got %)', v_local;
  end if;

  --     Inside the hours it does not move.
  v_slot := app.crm_next_send_slot(
    timestamptz '2026-09-15 11:30+05', 10::smallint, 18::smallint, null, null, null);
  if (v_slot at time zone 'Asia/Karachi') <> timestamp '2026-09-15 11:30' then
    raise exception '187 · a moment inside business hours was moved';
  end if;

  --     Saturday 2026-09-19, days Mon–Fri → Monday 21st at 10:00.
  v_slot := app.crm_next_send_slot(
    timestamptz '2026-09-19 11:00+05', 10::smallint, 18::smallint,
    array[1,2,3,4,5]::smallint[], null, null);
  v_local := v_slot at time zone 'Asia/Karachi';
  if v_local <> timestamp '2026-09-21 10:00' then
    raise exception '187 · a weekend was not skipped to Monday (got %)', v_local;
  end if;

  --     No business hours: the project's quiet hours still apply, as in 170.
  v_slot := app.crm_next_send_slot(
    timestamptz '2026-09-15 23:00+05', null, null, null, 21, 9);
  v_local := v_slot at time zone 'Asia/Karachi';
  if v_local <> timestamp '2026-09-16 09:00' then
    raise exception '187 · quiet hours stopped working (got %)', v_local;
  end if;

  -- 2 · The queue, end to end, on a fixture that is rolled back.
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data
     and l.stage not in ('won', 'lost') and l.phone_e164 is not null
     and not exists (select 1 from public.crm_lead_sequences ls
                      where ls.lead_id = l.id and ls.state in ('scheduled', 'active', 'paused'))
   limit 1;
  if v_lead is null then
    raise exception '187 · no demo lead free of a live sequence — refusing to skip the check';
  end if;

  begin
    delete from public.crm_follow_ups where lead_id = v_lead and lead_sequence_id is not null;
    update public.crm_project_settings set sla_night_from = 0, sla_night_to = 0 where project_id = v_project;

    insert into public.crm_sequences
      (project_id, lead_id, name, purpose, stop_on_reply, stop_on_visit, stop_on_quotation_dead,
       is_test_data, created_by_id)
    values (v_project, v_lead, 'SELFCHECK-187', 'no_response', false, false, false, true, v_sales)
    returning id into v_seq;
    insert into public.crm_sequence_steps
      (sequence_id, step_no, channel, delay_days, purpose, title, body, mode, wa_template_name, only_if_no_reply)
    values (v_seq, 1, 'whatsapp', 0, 'no_response', 'Auto one', 'Hello.', 'auto_send', 'selfcheck_187', false),
           (v_seq, 2, 'whatsapp', 0, 'no_response', 'Skip me',  'Hello.', 'auto_send', 'selfcheck_187', true);

    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at, created_by_id)
    values (v_lead, v_seq, 'scheduled', 0, 2, now() - interval '1 hour', now() - interval '1 minute', v_sales)
    returning id into v_ls;

    v_queued := app.crm_advance_sequences();
    select mode::text, status::text into v_mode, v_status
      from public.crm_follow_ups where lead_sequence_id = v_ls and sequence_step_no = 1;
    if v_mode is distinct from 'auto_send' or v_status is distinct from 'due' then
      raise exception '187 · a template step was not queued for sending (mode %, status %)', v_mode, v_status;
    end if;

    -- ⚠️ IT APPEARS IN THE SENDER'S QUEUE, and disappears the moment it is settled.
    select count(*) into v_rows from app.crm_followups_to_send(25) q
     where q.follow_up_id = (select id from public.crm_follow_ups
                              where lead_sequence_id = v_ls and sequence_step_no = 1);
    if v_rows <> 1 then
      raise exception '187 · a due auto-send step was not in the sender queue';
    end if;

    perform app.crm_followup_sent(
      (select id from public.crm_follow_ups where lead_sequence_id = v_ls and sequence_step_no = 1),
      'wamid.selfcheck187', null);
    select status::text, outcome_note into v_status, v_note
      from public.crm_follow_ups where lead_sequence_id = v_ls and sequence_step_no = 1;
    if v_status <> 'done' or v_note not like 'Sent automatically%' then
      raise exception '187 · settling a sent step did not record it (% / %)', v_status, v_note;
    end if;

    -- ⚠️ AND A REPLY MAKES "only if no reply" SKIP RATHER THAN SEND.
    insert into public.crm_lead_messages (lead_id, direction, kind, body, status, created_at)
    values (v_lead, 'inbound', 'text', '187 reply', 'delivered', now());
    delete from public.crm_follow_ups where lead_sequence_id = v_ls;
    update public.crm_lead_sequences set next_step_at = now() - interval '1 minute' where id = v_ls;
    perform app.crm_advance_sequences();
    select status::text, outcome_note into v_status, v_note
      from public.crm_follow_ups where lead_sequence_id = v_ls and sequence_step_no = 2;
    if v_status is distinct from 'skipped' then
      raise exception '187 · "only if no reply" sent anyway (status %)', coalesce(v_status, 'nothing');
    end if;
    select count(*) into v_rows from app.crm_followups_to_send(25) q where q.lead_id = v_lead;
    if v_rows <> 0 then
      raise exception '187 · a skipped step was still offered to the sender';
    end if;

    raise exception using errcode = 'P0187', message = '187 rollback';
  exception when sqlstate 'P0187' then
    null;
  end;

  if exists (select 1 from public.crm_sequences where name = 'SELFCHECK-187') then
    raise exception '187 · the self-check left rows behind';
  end if;

  raise notice '187 · business hours and days push a step forward and never drop it; the sender queue re-asks the stop conditions; a settled step leaves it; "only if no reply" is recorded as skipped';
end $chk$;
