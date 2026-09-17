-- ============================================================================
-- 170 · PHASE G · THE SEQUENCE ENGINE — the chase that runs itself
-- ----------------------------------------------------------------------------
-- Owner's description: *"Sarah will create a follow-up… after 1 day the client
-- didn't reply, then send this follow-up. Or if he schedules 3 follow-ups, day
-- by day… In between that phase, if the client replies, that follow-up will
-- auto-pause."*
--
-- 153 built the tables and nothing has ever advanced them: `crm_sequences`,
-- `crm_sequence_steps`, `crm_lead_sequences`, `crm_follow_ups` — all empty. This
-- is the machinery that moves them.
--
-- ── ⚠️ THE SCHEDULER QUEUES. IT NEVER SENDS. ───────────────────────────────
-- Postgres cannot call Meta's API, and it should not try. `pg_cron` decides WHAT
-- is due and writes a `crm_follow_ups` row; a route outside picks those up and
-- sends. That split is not a limitation — it is what makes every decision below
-- testable without a network, and what stops a failed HTTP call rolling back a
-- sequence's state.
--
-- ⚠️ AND `mode` ALREADY SAYS WHO ACTS. 153 gave follow-ups `remind_me`,
-- `review_first` and `auto_send`. Only the last is sent by machine; the other two
-- become rows on `/todos`, which is exactly where a salesperson already looks.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE QUEUE
-- ----------------------------------------------------------------------------
-- ⚠️ A STORED `next_step_at`, NOT ARITHMETIC OVER `started_at`. Recomputing from
-- the start plus the sum of the delays cannot express a sequence that was paused
-- for three days and resumed — every step would still be measured from a moment
-- that no longer means anything. The column IS the queue.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_lead_sequences
  add column next_step_at timestamptz;

comment on column public.crm_lead_sequences.next_step_at is
  'When the next step falls due. NULL means nothing is scheduled — finished, stopped, or waiting to start.';

/* ⚠️ PARTIAL, ON THE QUESTION THE JOB ACTUALLY ASKS: which live sequences are
   due. Indexing `next_step_at` alone would still scan every sequence ever run,
   and by law 5 that gets worse every month the business grows. */
create index crm_lead_sequences_due_idx
  on public.crm_lead_sequences (next_step_at)
  where state in ('scheduled', 'active') and next_step_at is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE STOP-CONDITIONS
-- ----------------------------------------------------------------------------
-- ⚠️ CHECKED BEFORE EVERY SEND, NOT ONLY AT THE START. A sequence set running on
-- Monday is a promise about Thursday, and everything about the lead can change in
-- between. One function so the scheduler and the sender cannot disagree about
-- what "still safe to send" means.
--
-- ⚠️ IT RETURNS THE REASON, NOT A BOOLEAN. "Paused" tells a salesperson nothing;
-- "the client replied" tells them to go and read the reply.
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
  select ls.id, ls.lead_id, ls.started_at, ls.quotation_id,
         s.stop_on_reply, s.is_active,
         l.stage, l.whatsapp_consent
    into r
    from public.crm_lead_sequences ls
    join public.crm_sequences s on s.id = ls.sequence_id
    join public.crm_leads l on l.id = ls.lead_id
   where ls.id = p_lead_sequence;

  if not found then
    return 'the sequence no longer exists';
  end if;

  /* ⚠️ CLOSED FIRST, because it is the one that makes every other check moot. */
  if r.stage in ('won', 'lost') then
    return 'the lead is closed';
  end if;

  /* ⚠️ `false` STOPS IT; `NULL` DOES NOT, AND THAT IS NOT A LOOPHOLE. NULL means
     nobody has ever asked — 640 of 641 real leads. Treating it as a refusal would
     mean no sequence could ever run; treating it as consent is the incident in
     `docs/crm-ai/05-GUARDRAILS.md` §5. So it is neither: the SENDER refuses a
     NULL, and this function reports only a stated no. */
  if r.whatsapp_consent is false then
    return 'they asked not to be messaged';
  end if;

  if not r.is_active then
    return 'the sequence was switched off';
  end if;

  /* ⚠️ THE CLIENT REPLIED — the single most important rule in any chase engine.
     Measured from the moment the sequence STARTED, not from the last step: a
     reply that arrived while step two was pending still means somebody is
     talking to us, and firing step three at them is the behaviour that gets a
     business muted. */
  if r.stop_on_reply and exists (
    select 1 from public.crm_lead_messages m
     where m.lead_id = r.lead_id
       and m.direction = 'inbound'
       and m.created_at >= r.started_at
  ) then
    return 'the client replied';
  end if;

  /* A chase for a quotation that has expired is an advertisement for a price we
     are no longer offering. */
  if r.quotation_id is not null and exists (
    select 1 from public.crm_quotations q
     where q.id = r.quotation_id
       and (q.status in ('expired', 'rejected', 'superseded')
            or (q.valid_until is not null
                and q.valid_until < (now() at time zone 'Asia/Karachi')::date))
  ) then
    return 'the quotation is no longer live';
  end if;

  /* ⚠️ ALREADY BOOKED. Somebody who has agreed to come does not need chasing to
     come; they need a reminder, which is a different sequence with a different
     purpose. */
  if exists (
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
-- 3 · MAY WE SEND FREE TEXT, OR MUST IT BE A TEMPLATE?
-- ----------------------------------------------------------------------------
-- ⚠️⚠️ ARITHMETIC OVER OUR OWN RECORDS, NEVER A REACTION TO A REFUSAL. Proved
-- live on 2026-09-15: Meta's TEST number accepted free text 26.3 hours after the
-- last inbound, with the window shut. A production number refuses it. So an
-- engine that inferred the window from whether the API said yes would pass every
-- test and fail silently in the field, in the direction that reaches real
-- customers.
--
-- The window is therefore decided HERE, from `crm_lead_messages`, before
-- anything is queued.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_window_is_open(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.crm_lead_messages m
     where m.lead_id = p_lead
       and m.direction = 'inbound'
       and m.created_at > now() - interval '24 hours'
  )
$$;

comment on function app.crm_window_is_open(uuid) is
  'True when the customer messaged us inside 24 hours. ⚠️ Decided from our own records, never from whether the API accepted the last attempt — the test number lies about this.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · ADVANCING A SEQUENCE
-- ----------------------------------------------------------------------------
-- ⚠️ IT WRITES A FOLLOW-UP AND MOVES THE POINTER. It does not send, does not
-- call out, and does not decide whether a human or a machine acts — `mode` on
-- the step's own row already says that, and `/todos` picks up whatever is left
-- for a person.
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
  v_hour     integer;
  n_queued   integer := 0;
begin
  for r in
    select ls.id, ls.lead_id, ls.sequence_id, ls.current_step, ls.total_steps,
           l.project_id, l.owner_id
      from public.crm_lead_sequences ls
      join public.crm_leads l on l.id = ls.lead_id
     where ls.state in ('scheduled', 'active')
       and ls.next_step_at is not null
       and ls.next_step_at <= now()
     order by ls.next_step_at
     limit 200
  loop
    /* ── The stop-conditions, before anything else ──────────────────────── */
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
      /* ⚠️ A REPLY PAUSES, EVERYTHING ELSE STOPS. Paused can be resumed by a
         salesperson who has read the reply and wants the chase to carry on;
         stopped is final, because a closed lead or a dead quotation does not
         become live again by waiting. */
      continue;
    end if;

    /* ── The step that is now due ───────────────────────────────────────── */
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

    /* ── ⚠️ QUIET HOURS. The rule exists so a stranger is not woken at 2am, so
       it is checked at the moment of queueing rather than left to the sender.
       Nothing is skipped — the step is pushed to the morning, because a chase
       that silently dropped a step would leave a sequence with a hole in it. */
    select * into v_settings
      from public.crm_project_settings where project_id = r.project_id;

    if found then
      v_hour := extract(hour from (now() at time zone 'Asia/Karachi'))::integer;
      if (v_settings.sla_night_from < v_settings.sla_night_to
            and v_hour >= v_settings.sla_night_from and v_hour < v_settings.sla_night_to)
         or (v_settings.sla_night_from > v_settings.sla_night_to
            and (v_hour >= v_settings.sla_night_from or v_hour < v_settings.sla_night_to))
      then
        update public.crm_lead_sequences
           set next_step_at = (date_trunc('day', now() at time zone 'Asia/Karachi')
                               + make_interval(hours => v_settings.sla_night_to))
                              at time zone 'Asia/Karachi'
                              + case when v_hour >= v_settings.sla_night_from
                                     then interval '1 day' else interval '0' end,
               updated_at = now()
         where id = r.id;
        continue;
      end if;
    end if;

    /* ── ⚠️ ONE CHASE PER LEAD PER DAY ──────────────────────────────────────
       The owner's point, and they were right to push back on a blanket cap: a
       visit reminder and the quotation itself are TRANSACTIONAL — the client
       wants them and they are never capped. This counts only chases, which is
       what a sequence step is. */
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

    /* ── Queue it ───────────────────────────────────────────────────────── */
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at,
       lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
    values (
      r.lead_id,
      coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
      v_step.channel,
      /* ⚠️ A TEMPLATE STEP OUTSIDE THE WINDOW IS THE ONLY THING THAT MAY BE SENT
         BY MACHINE. Free text outside the window would be refused by a real
         business number, and a step with no template name has nothing to fall
         back to — so it goes to a human instead of failing at 3am. */
      case
        when v_step.channel <> 'whatsapp' then 'remind_me'
        when app.crm_window_is_open(r.lead_id) then 'auto_send'
        when nullif(v_step.wa_template_name, '') is not null then 'auto_send'
        else 'review_first'
      end::public.crm_followup_mode,
      'due',
      coalesce(nullif(v_step.purpose, ''), 'Follow up') || ' · step ' || v_step.step_no,
      v_step.body,
      now(),
      r.id,
      v_step.step_no,
      r.owner_id,
      r.owner_id
    );

    update public.crm_lead_sequences
       set state = 'active',
           current_step = v_step.step_no,
           started_at = coalesce(started_at, now()),
           next_step_at = (
             select now() + make_interval(days => greatest(nx.delay_days, 0))
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

do $$
begin
  perform cron.unschedule('crm-sequences');
exception when others then
  null;
end $$;

select cron.schedule(
  'crm-sequences',
  /* Every 15 minutes. Steps are day-scale, but a sequence that stops on a reply
     should stop within minutes of that reply, not at the top of the next hour. */
  '*/15 * * * *',
  $job$ select app.crm_advance_sequences(); $job$
);


-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT BUILDS ITS OWN FIXTURE AND RAISES IF IT CANNOT. A check that hunts for a
-- sequence it may not find prints a tick for a rule it never ran.
-- ⚠️ AND IT REMOVES ITS ROWS BY ID, never by predicate — 082 ate a live row that
-- way.
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid;
  v_seq uuid; v_ls uuid; v_queued integer; v_state text; v_reason text;
  v_mode text; v_open boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then
    raise exception '170 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then
    raise exception '170 · nobody eligible on the demo project';
  end if;

  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, stage, is_test_data, submitted_at,
     first_contacted_at)
  values
    (v_project, v_sales, 'manual', 'SELFCHECK-170', '+920000000170', 'contacted', true,
     now(), now())
  returning id into v_lead;

  insert into public.crm_sequences (project_id, name, purpose, stop_on_reply, is_active, is_test_data, created_by_id)
  values (v_project, 'SELFCHECK-170', 'no_response', true, true, true, v_sales)
  returning id into v_seq;

  insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose, wa_template_name, body)
  values (v_seq, 1, 'whatsapp', 0, 'no_response', 'selfcheck_170', 'Step one.'),
         (v_seq, 2, 'whatsapp', 3, 'no_response', 'selfcheck_170', 'Step two.');

  insert into public.crm_lead_sequences
    (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at, created_by_id)
  values (v_lead, v_seq, 'scheduled', 0, 2, now(), now() - interval '1 minute', v_sales)
  returning id into v_ls;

  -- 1 · A due step is queued as a follow-up.
  v_queued := app.crm_advance_sequences();
  if not exists (select 1 from public.crm_follow_ups where lead_sequence_id = v_ls and sequence_step_no = 1) then
    raise exception '170 · a due step queued nothing (% returned)', v_queued;
  end if;

  -- 2 · ⚠️ NO INBOUND MESSAGE EVER, so the 24-hour window is SHUT, and the step
  --     may only go by machine because it names a template.
  v_open := app.crm_window_is_open(v_lead);
  select mode::text into v_mode from public.crm_follow_ups
   where lead_sequence_id = v_ls and sequence_step_no = 1;
  if v_open then
    raise exception '170 · the window read as open on a lead with no inbound message ever';
  end if;
  if v_mode <> 'auto_send' then
    raise exception '170 · a template step outside the window was not sendable (mode %)', v_mode;
  end if;

  -- 3 · ⚠️ THE SAME STEP WITHOUT A TEMPLATE MUST GO TO A HUMAN. Free text outside
  --     the window is refused by a real business number, and the test number's
  --     acceptance of it is exactly the lie this rule exists to survive.
  update public.crm_sequence_steps set wa_template_name = null where sequence_id = v_seq and step_no = 2;
  update public.crm_lead_sequences set next_step_at = now() - interval '1 minute' where id = v_ls;
  delete from public.crm_follow_ups where lead_sequence_id = v_ls;  -- clear the daily cap
  perform app.crm_advance_sequences();
  select mode::text into v_mode from public.crm_follow_ups
   where lead_sequence_id = v_ls and sequence_step_no = 2;
  if v_mode is distinct from 'review_first' then
    raise exception '170 · free text outside the 24-hour window was queued to send by machine (mode %)', v_mode;
  end if;

  -- 4 · ⚠️ ONE CHASE PER LEAD PER DAY. A second run today must queue nothing more.
  update public.crm_lead_sequences set next_step_at = now() - interval '1 minute', current_step = 0 where id = v_ls;
  perform app.crm_advance_sequences();
  if (select count(*) from public.crm_follow_ups where lead_sequence_id = v_ls) > 1 then
    raise exception '170 · the daily chase cap did not hold';
  end if;

  -- 5 · ⚠️ A REPLY PAUSES IT, and the reason says so in words.
  insert into public.crm_lead_messages (lead_id, direction, kind, body, status, created_at)
  values (v_lead, 'inbound', 'text', 'Yes I am interested', 'delivered', now());
  v_reason := app.crm_sequence_stop_reason(v_ls);
  if v_reason is distinct from 'the client replied' then
    raise exception '170 · a reply did not stop the sequence (got %)', coalesce(v_reason, 'null');
  end if;

  update public.crm_lead_sequences set next_step_at = now() - interval '1 minute' where id = v_ls;
  delete from public.crm_follow_ups where lead_sequence_id = v_ls;
  perform app.crm_advance_sequences();
  select state::text into v_state from public.crm_lead_sequences where id = v_ls;
  if v_state <> 'paused' then
    raise exception '170 · a replied-to sequence is % rather than paused', v_state;
  end if;
  if exists (select 1 from public.crm_follow_ups where lead_sequence_id = v_ls) then
    raise exception '170 · a step was queued AFTER the client had replied';
  end if;

  -- 6 · ⚠️ AND THE WINDOW IS NOW OPEN, because they just messaged us.
  if not app.crm_window_is_open(v_lead) then
    raise exception '170 · the window read as shut right after an inbound message';
  end if;

  -- 7 · A closed lead stops rather than pauses — it does not come back.
  update public.crm_leads set stage = 'lost', lost_reason = 'not_serious' where id = v_lead;
  if app.crm_sequence_stop_reason(v_ls) <> 'the lead is closed' then
    raise exception '170 · a lost lead did not stop its sequence';
  end if;

  delete from public.crm_follow_ups where lead_sequence_id = v_ls;
  delete from public.crm_lead_sequences where id = v_ls;
  delete from public.crm_sequence_steps where sequence_id = v_seq;
  delete from public.crm_sequences where id = v_seq;
  delete from public.crm_lead_messages where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;

  raise notice '170 · a due step queues, a template may send outside the window, free text may not, one chase a day holds, a reply pauses it within minutes, and a closed lead stops it for good';
end $chk$;
