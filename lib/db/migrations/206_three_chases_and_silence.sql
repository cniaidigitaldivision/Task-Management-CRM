-- ============================================================================
-- 206 · THREE CHASES AND SILENCE — the sequence parks the lead itself
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18: *"after three follow-ups the client is not replying. Move
-- the follow-up lead to nurture automatically… I know that he contacted us and we
-- sent three follow-ups successfully but he didn't reply so that's why this lead
-- goes to nurture."*
--
-- Until now, when a plan ran out of steps the SEQUENCE ended and the LEAD did not
-- move at all. It sat in whatever stage it was in, with nothing anywhere saying
-- the chase was finished and unanswered — the only record was a line inside that
-- one lead's drawer. There was no list of "chased three times, never replied",
-- which is the most valuable list on the desk.
--
-- ⚠️ IT MOVES ONLY WHEN ALL THREE THINGS ARE TRUE, and each matters:
--
--   1. Every step has been sent            — not a plan somebody stopped early.
--   2. The client never replied             — measured from when the plan started
--                                             (or resumed), not from all time.
--   3. The lead is still open               — `won`, `lost` and `nurture` are
--                                             left exactly alone.
--
-- ⚠️ AND IT NEVER TOUCHES A LEAD THAT ANSWERED. A reply pauses the plan long
-- before it exhausts (`stop_on_reply`), so the exhausted case is nearly always
-- silence — but "nearly always" is not a rule, and the reply test is what makes
-- it one. A lead that replied to step 2 and then went quiet has still spoken to
-- us, and parking it would be wrong.
--
-- ⚠️ THE ACTIVITY ROW IS WRITTEN BY THE EXISTING TRIGGER, not by hand here.
-- `crm_leads_record_activity` already records every stage change, so the timeline
-- says who moved it and when — and for this it will say the system did.
--
-- ⚠️ AND A NOTE SAYS WHY, IN WORDS. A stage that changed by itself with no
-- explanation is the kind of thing somebody argues with six months later.
-- ============================================================================

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

      /* ── ⚠️ EVERY STEP SENT AND NOT A WORD BACK: PARK IT — 206 ───────────
         The three conditions in this migration's header, asked here. */
      v_replied := exists (
        select 1 from public.crm_lead_messages m
         where m.lead_id = r.lead_id
           and m.direction = 'inbound'
           and m.occurred_at >= coalesce(r.resumed_at, r.started_at));

      /* How many actually went out, so the note can say so rather than guess. */
      select count(*) into v_sent
        from public.crm_follow_ups f
       where f.lead_sequence_id = r.id
         and f.status = 'done';

      if not v_replied and v_sent > 0 then
        update public.crm_leads
           set stage = 'nurture',
               /* ⚠️ THE CHASE IS OVER, so the desk must stop showing one. */
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

comment on function app.crm_advance_sequences() is
  '187 · advances every due sequence. 206 · parks the lead in Nurture when every step went out and nobody replied.';

-- ============================================================================
-- SELF-CHECK — parked on silence, left alone on a reply
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_seq uuid; v_run uuid;
  v_quiet uuid; v_spoke uuid; v_closed uuid;
  s_quiet text; s_spoke text; s_closed text; n_note int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '206 · fixtures missing (project %, owner %)', v_project, v_owner;
  end if;

  begin
    /* ⚠️ THE CHECK BUILDS ITS OWN LEADS. Borrowing a real one and rolling back
       is how 082 deleted somebody's attendance row — and a stage moved on a live
       lead would be a client parked by a test. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-206 quiet',  'contacted', now(), v_owner, true) returning id into v_quiet;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-206 spoke',  'contacted', now(), v_owner, true) returning id into v_spoke;
    /* ⚠️ `lost`, NOT `won`, for the closed fixture: `won` is inside
       `qualified_and_beyond` and would demand BANT before this check could even
       set it up. `lost` is exempt for the same reason nurture is. */
    insert into public.crm_leads (project_id, source, full_name, stage, lost_reason, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-206 closed', 'lost', 'no_answer', now(), v_owner, true)
    returning id into v_closed;

    insert into public.crm_sequences (project_id, name, purpose, created_by_id, is_test_data)
    values (v_project, 'SELFCHECK-206', 'no_response', v_owner, true) returning id into v_seq;
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body)
    values (v_seq, 1, 0, 'whatsapp', 'remind_me', 'no_response', 'one', 'body');

    /* Each run is already past its only step, so the next pass exhausts it. */
    for v_run in
      select x from unnest(array[v_quiet, v_spoke, v_closed]) x
    loop
      insert into public.crm_lead_sequences
        (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
      values (v_run, v_seq, 'active', 1, 1, now() - interval '1 day', now() - interval '1 minute');
      /* A step that went out, so v_sent > 0. */
      /* ⚠️ `done` NEEDS ITS STAMPS — `crm_follow_ups_done_complete` says a
         completed row records when and by whom. */
      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, due_at, done_at, done_by_id,
         assigned_to_id, created_by_id, lead_sequence_id, sequence_step_no)
      values (v_run, 'no_response', 'whatsapp', 'remind_me', 'done', 'one',
              now() - interval '1 hour', now() - interval '1 hour', v_owner,
              v_owner, v_owner,
              (select id from public.crm_lead_sequences where lead_id = v_run and sequence_id = v_seq), 1);
    end loop;

    /* ⚠️ ONE OF THEM ANSWERED. That lead must be left exactly where it is. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, status, occurred_at)
    values (v_spoke, 'whatsapp', 'inbound', 'text', 'I am interested', 'delivered', now());

    perform app.crm_advance_sequences();

    select stage::text into s_quiet  from public.crm_leads where id = v_quiet;
    select stage::text into s_spoke  from public.crm_leads where id = v_spoke;
    select stage::text into s_closed from public.crm_leads where id = v_closed;
    select count(*)::int into n_note from public.crm_lead_notes
     where lead_id = v_quiet and body like 'Moved to Nurture automatically%';

    raise exception using errcode = 'P0206', message = '206 rollback';
  exception when sqlstate 'P0206' then
    null;
  end;

  if s_quiet is distinct from 'nurture' then
    raise exception '206 · a lead chased to the end in silence was not parked (got %)', s_quiet;
  end if;
  if n_note <> 1 then
    raise exception '206 · nothing on the timeline says why it moved';
  end if;
  if s_spoke is distinct from 'contacted' then
    raise exception '206 · a lead that REPLIED was parked anyway (got %)', s_spoke;
  end if;
  if s_closed is distinct from 'lost' then
    raise exception '206 · a closed lead was moved (got %)', s_closed;
  end if;

  raise notice '206 ✓ silence parks the lead in Nurture with a note; a reply and a closed lead are left alone';
end $chk$;
