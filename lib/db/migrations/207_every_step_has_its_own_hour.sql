-- ============================================================================
-- 207 · EVERY STEP HAS ITS OWN HOUR — a sequence is not one time repeated
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18: *"it only lets me choose the first follow-up time and
-- date… the date and time for the second and third follow-ups is not visible.
-- That's a major flaw."*
--
-- And earlier, on the same point: *"I don't want that to be exactly 2 days, at
-- the same time."*
--
-- They are describing a real hole, not a missing control. A step's moment was
-- computed as
--
--   next_step_at = now() + delay_days
--
-- taken at the instant the PREVIOUS step was materialised — so every step
-- inherited the hour of the one before it, all the way back to the first. A plan
-- could say "day 1 at 2 pm, day 3 at 10 am" on screen and the engine had nowhere
-- to put the 10 am. There was no column for it.
--
-- ⚠️ SO THE HOUR IS STORED, AND IT IS NULLABLE ON PURPOSE. Null means "whatever
-- time the plan is running at" — the behaviour every existing sequence already
-- has, unchanged. A time only overrides when somebody actually chose one.
--
-- ⚠️ AND BUSINESS HOURS STILL WIN. `app.crm_next_send_slot` runs after this, so
-- a step set for 8 am on a plan that may only send from 10 is moved to 10 rather
-- than going out early. The chosen hour is a request, not a licence — the same
-- stance the appointment scheduler's office-hours guard takes.
-- ============================================================================

alter table public.crm_sequence_steps
  add column if not exists send_at_time time;

comment on column public.crm_sequence_steps.send_at_time is
  '207 · the hour this step should go out, in Asia/Karachi. Null inherits the time the plan is running at. Business hours still apply afterwards.';

create or replace function app.crm_advance_sequences()
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  r          record;
  v_step     record;
  v_next     record;
  v_stop     text;
  v_settings record;
  v_slot     timestamptz;
  v_when     timestamptz;
  v_mode     public.crm_followup_mode;
  v_title    text;
  v_replied  boolean;
  v_sent     integer;
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

      /* ── EVERY STEP SENT AND NOT A WORD BACK: PARK IT — 206 ─────────────── */
      v_replied := exists (
        select 1 from public.crm_lead_messages m
         where m.lead_id = r.lead_id
           and m.direction = 'inbound'
           and m.occurred_at >= coalesce(r.resumed_at, r.started_at));

      select count(*) into v_sent
        from public.crm_follow_ups f
       where f.lead_sequence_id = r.id
         and f.status = 'done';

      if not v_replied and v_sent > 0 then
        update public.crm_leads
           set stage = 'nurture',
               next_action = null,
               next_action_at = null,
               next_action_type = null
         where id = r.lead_id
           and stage not in ('won', 'lost', 'nurture');

        if found then
          insert into public.crm_lead_notes (lead_id, author_id, body)
          values (
            r.lead_id, r.owner_id,
            'Moved to Nurture automatically — ' || v_sent ||
            ' follow-up' || case when v_sent = 1 then '' else 's' end ||
            ' sent and no reply. The lead is parked, not lost: nothing was refused, so it can be picked up again at any time.');
        end if;
      end if;

      continue;
    end if;

    /* ── BUSINESS HOURS FIRST. Nothing is dropped. ───────────────────────── */
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

      if v_mode <> 'auto_send' then
        update public.crm_leads
           set next_action = v_title,
               next_action_at = now(),
               next_action_type = v_step.channel::text::public.crm_next_action_kind
         where id = r.lead_id
           and (next_action_at is null or next_action_at < now());
      end if;
    end if;

    /* ── ⚠️ WHEN THE NEXT STEP FALLS — 207 ──────────────────────────────────
       The day comes from its delay; the HOUR comes from the step itself when
       somebody chose one. Without this the hour was inherited from whenever the
       previous step happened to run, which is what made a three-step plan fire
       at the same minute every time. */
    select * into v_next
      from public.crm_sequence_steps
     where sequence_id = r.sequence_id and step_no = v_step.step_no + 1
     limit 1;

    if found then
      v_when := now() + make_interval(days => greatest(v_next.delay_days, 0));

      if v_next.send_at_time is not null then
        /* ⚠️ THE DATE IN KARACHI, THE TIME ON IT, BACK TO AN INSTANT. Composing
           these in UTC would land the 10 am five hours out — `karachi-not-utc`,
           which is a different DAY for five hours every evening. */
        v_when := ((v_when at time zone 'Asia/Karachi')::date + v_next.send_at_time)
                    at time zone 'Asia/Karachi';

        /* A time already gone today means the day itself has passed; the delay
           decides the day, so never send earlier than the delay asked for. */
        if v_when < now() then
          v_when := v_when + interval '1 day';
        end if;
      end if;

      update public.crm_lead_sequences
         set state = 'active',
             current_step = v_step.step_no,
             started_at = coalesce(started_at, now()),
             /* Business hours still win — see the header. */
             next_step_at = app.crm_next_send_slot(
               v_when, r.send_from_hour, r.send_to_hour, r.send_days,
               v_settings.sla_night_from, v_settings.sla_night_to),
             updated_at = now()
       where id = r.id;
    else
      update public.crm_lead_sequences
         set state = 'active',
             current_step = v_step.step_no,
             started_at = coalesce(started_at, now()),
             next_step_at = null,
             updated_at = now()
       where id = r.id;
    end if;

    n_queued := n_queued + 1;
  end loop;

  return n_queued;
end;
$fn$;

comment on function app.crm_advance_sequences() is
  '187 · advances every due sequence. 206 · parks the lead in Nurture on silence. 207 · each step may carry its own hour.';

-- ============================================================================
-- SELF-CHECK — a step's own hour is honoured; without one, nothing changes
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_seq uuid; v_run uuid;
  v_next timestamptz; v_hour int := -1; v_day date;
  v_lead2 uuid; v_seq2 uuid; v_run2 uuid; v_next2 timestamptz;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '207 · fixtures missing';
  end if;

  begin
    /* ── A plan whose SECOND step asks for 09:30 ─────────────────────────── */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-207 timed', 'contacted', now(), v_owner, true) returning id into v_lead;
    insert into public.crm_sequences (project_id, name, purpose, created_by_id, is_test_data,
                                      send_from_hour, send_to_hour, send_days)
    /* ⚠️ Hours wide open, so this proves the STEP's time rather than the plan's
       business-hours nudge doing it by accident. */
    values (v_project, 'SELFCHECK-207', 'no_response', v_owner, true, 0, 24, array[0,1,2,3,4,5,6])
    returning id into v_seq;
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body)
    values (v_seq, 1, 0, 'whatsapp', 'remind_me', 'no_response', 'one', 'body');
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body, send_at_time)
    values (v_seq, 2, 2, 'whatsapp', 'remind_me', 'no_response', 'two', 'body', time '09:30');

    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
    values (v_lead, v_seq, 'scheduled', 0, 2, now(), now() - interval '1 minute') returning id into v_run;

    perform app.crm_advance_sequences();
    select next_step_at into v_next from public.crm_lead_sequences where id = v_run;
    v_hour := extract(hour from (v_next at time zone 'Asia/Karachi'))::int;
    v_day  := (v_next at time zone 'Asia/Karachi')::date;

    /* ── And a plan with NO time on its steps behaves exactly as before ──── */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-207 plain', 'contacted', now(), v_owner, true) returning id into v_lead2;
    insert into public.crm_sequences (project_id, name, purpose, created_by_id, is_test_data,
                                      send_from_hour, send_to_hour, send_days)
    values (v_project, 'SELFCHECK-207b', 'no_response', v_owner, true, 0, 24, array[0,1,2,3,4,5,6])
    returning id into v_seq2;
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body)
    values (v_seq2, 1, 0, 'whatsapp', 'remind_me', 'no_response', 'one', 'body');
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body)
    values (v_seq2, 2, 2, 'whatsapp', 'remind_me', 'no_response', 'two', 'body');

    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
    values (v_lead2, v_seq2, 'scheduled', 0, 2, now(), now() - interval '1 minute') returning id into v_run2;

    perform app.crm_advance_sequences();
    select next_step_at into v_next2 from public.crm_lead_sequences where id = v_run2;

    raise exception using errcode = 'P0207', message = '207 rollback';
  exception when sqlstate 'P0207' then
    null;
  end;

  if v_hour <> 9 then
    raise exception '207 · the step asked for 09:30 and was scheduled for hour % instead', v_hour;
  end if;
  if v_day is distinct from ((now() at time zone 'Asia/Karachi')::date + 2) then
    raise exception '207 · the two-day delay was lost (got %)', v_day;
  end if;
  if v_next2 is null then
    raise exception '207 · a plan with no step time lost its schedule entirely';
  end if;
  if extract(hour from (v_next2 at time zone 'Asia/Karachi'))::int
     <> extract(hour from (now() at time zone 'Asia/Karachi'))::int then
    raise exception '207 · a step with no time of its own stopped inheriting the running hour';
  end if;

  raise notice '207 ✓ a step keeps its own hour on the right day; one without a time is unchanged';
end $chk$;
