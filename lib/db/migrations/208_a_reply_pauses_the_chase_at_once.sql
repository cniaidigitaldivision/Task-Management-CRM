-- ============================================================================
-- 208 · A REPLY PAUSES THE CHASE AT ONCE, NOT WHEN THE NEXT STEP FALLS DUE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19, on the lead "Umm e e Habiba":
--
--   "Because she replied the conversation should be paused... the next follow-up
--   will not be sent but right now I am watching in the follow-up tab: the next
--   two follow-ups are still scheduled. Why is it not paused?"
--
-- ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
-- Not the rule. `app.crm_sequence_stop_reason` returned 'the client replied' for
-- that run the whole time, and BOTH gates consult it before anything leaves:
-- the engine's loop, and `crm_followups_to_send`'s own guard. No message was
-- ever going to reach her.
--
-- What was wrong is WHEN the answer gets written down. The engine only examines
-- a run whose next step is already due:
--
--     where ls.state in ('scheduled', 'active')
--       and ls.next_step_at is not null
--       and ls.next_step_at <= now()      <-- 21 Sep 10:00 for this lead
--
-- She replied on 19 Sep at 13:52. Her run stays `active` for another 44 hours,
-- and the Follow-ups tab reads the run — so it honestly draws steps 2 and 3 as
-- "upcoming", which is the opposite of what will happen.
--
-- ⚠️ A SCREEN THAT PROMISES WHAT THE ENGINE WILL REFUSE IS A BUG, even when the
-- engine is right. The salesperson's whole reason for looking at that tab is to
-- know whether the client is still being chased. Being told "yes" for two days
-- after the chase effectively stopped is how somebody sends a duplicate by hand.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- Settle the run at the moment the reply is recorded. `crm_record_inbound_message`
-- is the ONLY writer of an inbound row (checked against pg_proc, not assumed), so
-- it is the one place this belongs.
--
-- ⚠️ AND IT REUSES THE ENGINE'S OWN DECISION RATHER THAN RE-TESTING FOR A REPLY.
-- 202 shipped as half a fix precisely here: one function learned a new rule and
-- three others kept the old one, and a send failed with "no longer due". So the
-- transition itself — which state, which timestamp, which words — moves into one
-- function that the engine now calls as well. Two copies of "what a stop reason
-- does" is the same bug waiting again.
-- ============================================================================

-- ── 1 · One definition of "apply the stop condition" ────────────────────────
create or replace function app.crm_sequence_settle(p_lead_sequence uuid)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_stop text;
begin
  v_stop := app.crm_sequence_stop_reason(p_lead_sequence);
  if v_stop is null then
    return null;
  end if;

  /* ⚠️ A REPLY PAUSES; EVERYTHING ELSE STOPS. The distinction is the owner's:
     a client who wrote back is a conversation somebody picks up, and the plan
     can be resumed from where it stood. A closed lead, a stated no or a dead
     quotation are endings, and a resumed plan would immediately halt again. */
  update public.crm_lead_sequences
     set state = (case when v_stop = 'the client replied' then 'paused' else 'stopped' end)
                   ::public.crm_sequence_state,
         paused_at  = case when v_stop = 'the client replied' then now() end,
         stopped_at = case when v_stop <> 'the client replied' then now() end,
         pause_reason = v_stop,
         /* ⚠️ CLEARED, so nothing re-examines it and nothing re-fires. */
         next_step_at = null,
         updated_at = now()
   where id = p_lead_sequence
     and state in ('scheduled', 'active');

  return v_stop;
end;
$fn$;

comment on function app.crm_sequence_settle(uuid) is
  'Applies the run''s stop condition if it has one, and says which. A reply pauses, anything else stops. The engine and the inbound webhook both call this so the two cannot disagree. 208.';

grant execute on function app.crm_sequence_settle(uuid) to cni_app;


-- ── 2 · The engine asks the same function ───────────────────────────────────
-- ⚠️ REPRODUCED IN FULL, from `pg_get_functiondef` of the live 206/207 body, with
-- ONLY the settle block replaced. Re-typing an engine from memory is how a rule
-- quietly disappears.
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
    /* 208 · the settle is one function now, shared with the inbound webhook. */
    v_stop := app.crm_sequence_settle(r.id);
    if v_stop is not null then
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

    /* ── WHEN THE NEXT STEP FALLS — 207 ─────────────────────────────────────
       The day comes from its delay; the HOUR comes from the step itself when
       somebody chose one. */
    select * into v_next
      from public.crm_sequence_steps
     where sequence_id = r.sequence_id and step_no = v_step.step_no + 1
     limit 1;

    if found then
      v_when := now() + make_interval(days => greatest(v_next.delay_days, 0));

      if v_next.send_at_time is not null then
        /* ⚠️ THE DATE IN KARACHI, THE TIME ON IT, BACK TO AN INSTANT. */
        v_when := ((v_when at time zone 'Asia/Karachi')::date + v_next.send_at_time)
                    at time zone 'Asia/Karachi';

        if v_when < now() then
          v_when := v_when + interval '1 day';
        end if;
      end if;

      update public.crm_lead_sequences
         set state = 'active',
             current_step = v_step.step_no,
             started_at = coalesce(started_at, now()),
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


-- ── 3 · The webhook settles the run the moment the reply lands ──────────────
-- ⚠️ ONE WRITER, AND THIS IS IT. `crm_record_inbound_message` is the only
-- function in the database that writes a row with direction 'inbound' — checked
-- against pg_proc rather than assumed, because a second writer would leave half
-- the replies still pausing two days late.
create or replace function app.crm_record_inbound_message(
  p_from_e164  text,
  p_wamid      text,
  p_kind       text,
  p_body       text,
  p_media_id   text,
  p_media_mime text,
  p_filename   text,
  p_occurred   timestamptz,
  p_reply_to   text default null,
  p_voice      boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_id   uuid;
  v_run  uuid;
begin
  v_lead := app.crm_lead_for_number(p_from_e164);
  if v_lead is null then
    return null;
  end if;

  insert into public.crm_lead_messages
    (lead_id, wa_message_id, direction, kind, body, media_id, media_mime,
     media_filename, occurred_at, reply_to_wamid, media_voice)
  values
    (v_lead, p_wamid, 'inbound',
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[])
           then p_kind else 'unknown' end)::public.crm_message_kind,
     p_body, p_media_id, p_media_mime, p_filename,
     coalesce(p_occurred, now()), p_reply_to, coalesce(p_voice, false))
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform app.crm_notify_lead_replied(v_lead);

    /* ── 208 · THE CHASE STOPS NOW, NOT ON TUESDAY ───────────────────────────
       ⚠️ AFTER THE INSERT, AND THAT ORDER IS THE WHOLE THING. The stop reason is
       answered by looking for an inbound row; asked before this insert it would
       find nothing and cheerfully leave the plan running.

       ⚠️ AND ONLY ON A ROW THAT WAS ACTUALLY NEW. The `on conflict do nothing`
       above means a redelivered webhook — Meta retries — returns null here. A
       duplicate delivery must not restamp `paused_at` on a run a salesperson
       has since resumed. */
    for v_run in
      select ls.id from public.crm_lead_sequences ls
       where ls.lead_id = v_lead
         and ls.state in ('scheduled', 'active')
    loop
      perform app.crm_sequence_settle(v_run);
    end loop;
  end if;
  return v_id;
end $$;

revoke all on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz,text,boolean) from public;
grant execute on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz,text,boolean) to cni_app;


-- ============================================================================
-- SELF-CHECK — a reply pauses at once; a plan that may still run is left alone
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_seq uuid;
  v_replier uuid; v_quiet uuid;
  v_run_replier uuid; v_run_quiet uuid;
  v_phone text := '+9239999' || lpad((floor(random() * 100000))::text, 5, '0');
  s_replier text; s_quiet text; r_replier text;
  n_next_cleared int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '208 · fixtures missing (project %, owner %)', v_project, v_owner;
  end if;

  begin
    /* ⚠️ ITS OWN LEADS. Borrowing a live one and rolling back is how 082 ate
       somebody's attendance row — and pausing a real client's chase for a test
       is exactly the bug this migration exists to fix, inverted. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-208 replier', v_phone, v_phone, 'contacted', now(), v_owner, true)
    returning id into v_replier;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-208 quiet', 'contacted', now(), v_owner, true)
    returning id into v_quiet;

    insert into public.crm_sequences (project_id, name, purpose, stop_on_reply, created_by_id, is_test_data)
    values (v_project, 'SELFCHECK-208', 'no_response', true, v_owner, true) returning id into v_seq;
    insert into public.crm_sequence_steps (sequence_id, step_no, delay_days, channel, mode, purpose, title, body)
    values (v_seq, 1, 0, 'whatsapp', 'remind_me', 'no_response', 'one', 'body'),
           (v_seq, 2, 2, 'whatsapp', 'remind_me', 'no_response', 'two', 'body');

    /* ⚠️ THE NEXT STEP IS TWO DAYS AWAY — the exact shape of the reported bug.
       The engine cannot see this run at all, so nothing but the webhook can
       pause it. A fixture due now would pass against the OLD code too. */
    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
    values (v_replier, v_seq, 'active', 1, 2, now() - interval '1 hour', now() + interval '2 days')
    returning id into v_run_replier;
    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
    values (v_quiet, v_seq, 'active', 1, 2, now() - interval '1 hour', now() + interval '2 days')
    returning id into v_run_quiet;

    /* The reply, through the real webhook path rather than a direct insert. */
    perform app.crm_record_inbound_message(
      v_phone, 'SELFCHECK-208-' || gen_random_uuid()::text, 'text',
      'Waslam, please send me the details', null, null, null, now(), null, false);

    select state::text, pause_reason into s_replier, r_replier
      from public.crm_lead_sequences where id = v_run_replier;
    select count(*)::int into n_next_cleared
      from public.crm_lead_sequences where id = v_run_replier and next_step_at is null;
    select state::text into s_quiet
      from public.crm_lead_sequences where id = v_run_quiet;

    raise exception using errcode = 'P0208', message = '208 rollback';
  exception when sqlstate 'P0208' then
    null;
  end;

  if s_replier is distinct from 'paused' then
    raise exception '208 · the run was not paused when the client replied (state %)', s_replier;
  end if;
  if r_replier is distinct from 'the client replied' then
    raise exception '208 · the pause reason must be the engine''s own words, got %', r_replier;
  end if;
  if n_next_cleared <> 1 then
    raise exception '208 · next_step_at was left set on a paused run';
  end if;
  if s_quiet is distinct from 'active' then
    raise exception '208 · another lead''s plan was paused by this reply (state %)', s_quiet;
  end if;

  raise notice '208 · a reply pauses its own chase at once, and nobody else''s';
end $chk$;
