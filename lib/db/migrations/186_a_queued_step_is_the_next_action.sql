-- ============================================================================
-- 186 · A QUEUED STEP IS THE LEAD'S NEXT ACTION
-- ----------------------------------------------------------------------------
-- Found while building the New follow-up dialog (185), by reading what `/todos`
-- actually selects.
--
-- ⚠️⚠️ THE SECOND STEP OF EVERY PLAN WAS INVISIBLE. `crmMyTodos` is derived from
-- `crm_leads.next_action`, appointments and quotations — it never reads
-- `crm_follow_ups`. 170 queues a step as a follow-up row and moves the pointer,
-- and nothing has ever touched `next_action`. So:
--
--   · the app sets `next_action` when a person plans the FIRST step (185), and
--   · every later step the engine queued appeared in the drawer and NOWHERE ELSE.
--
-- A salesperson working from their to-do list would simply never see steps 2 and
-- 3 — the exact failure a chase engine exists to prevent. The tab said "Needs
-- you" on a screen nobody opens until they already remembered the lead.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- When the engine queues a step that a PERSON must complete, the lead's next
-- action becomes that step. ⚠️ NOT for `auto_send`: a machine-sent step is not
-- somebody's to-do, and until a sender exists nothing is `auto_send` from the
-- dialog anyway (`lib/domain/crm-followup-plans.ts`, NOTHING_SENDS_YET).
--
-- ⚠️ AND IT ONLY MOVES THE POINTER FORWARD when the step is genuinely the
-- soonest thing owed — absent, already late, or later than this one — which is
-- the same rule `createFollowUp` and `createLeadPlan` use. Two writers with two
-- rules is how a desk starts disagreeing with a drawer.
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
  v_hour     integer;
  v_mode     public.crm_followup_mode;
  v_title    text;
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

    /* ── ⚠️ QUIET HOURS. Nothing is skipped — the step is pushed to the morning,
       because a chase that silently dropped a step leaves a hole in it. */
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

    /* ── ⚠️ ONE CHASE PER LEAD PER DAY. A visit reminder and the quotation
       itself are transactional and are never capped; this counts only what a
       sequence queued. */
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

    /* ── Who completes it, and what it is called ────────────────────────── */
    v_mode := case
      when v_step.channel <> 'whatsapp' then 'remind_me'
      /* The step's own answer (185), which may narrow what follows, never widen it. */
      when v_step.mode = 'remind_me' then 'remind_me'
      when app.crm_window_is_open(r.lead_id) then v_step.mode
      when nullif(v_step.wa_template_name, '') is not null then v_step.mode
      /* ⚠️ Free text outside the 24-hour window: a person sends it, or nobody does. */
      else 'review_first'
    end::public.crm_followup_mode;

    v_title := coalesce(nullif(v_step.title, ''),
                        coalesce(nullif(v_step.purpose, ''), 'Follow up') || ' · step ' || v_step.step_no);

    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at,
       lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
    values (
      r.lead_id,
      coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
      v_step.channel,
      v_mode,
      'due',
      v_title,
      v_step.body,
      now(),
      r.id,
      v_step.step_no,
      r.owner_id,
      r.owner_id
    );

    /* ── ⚠️ AND IT BECOMES THE LEAD'S NEXT ACTION, which is what `/todos` and
       every desk row read. Without this, only the first step of a plan was ever
       visible outside the drawer. Not for `auto_send`: a machine's step is not
       somebody's to-do. */
    if v_mode <> 'auto_send' then
      update public.crm_leads
         set next_action = v_title,
             next_action_at = now(),
             next_action_type = v_step.channel::text::public.crm_next_action_kind
       where id = r.lead_id
         and (next_action_at is null or next_action_at < now());
    end if;

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


-- ============================================================================
-- SELF-CHECK — it builds its own plan, runs the engine, and rolls everything back
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_seq uuid; v_ls uuid;
  v_action text; v_action_at timestamptz; v_kind text;
  v_action_auto text; v_mode text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data
     and l.stage not in ('won', 'lost')
     and not exists (select 1 from public.crm_lead_sequences ls
                      where ls.lead_id = l.id and ls.state in ('scheduled', 'active', 'paused'))
   limit 1;
  if v_lead is null then
    raise exception '186 · no demo lead free of a live sequence — refusing to skip the check';
  end if;

  begin
    /* Neither of these may decide the answer: the daily cap and quiet hours are
       rolled back with everything else. */
    delete from public.crm_follow_ups where lead_id = v_lead and lead_sequence_id is not null;
    update public.crm_project_settings set sla_night_from = 0, sla_night_to = 0 where project_id = v_project;
    update public.crm_leads
       set next_action = 'SELFCHECK-186 old', next_action_at = now() - interval '2 days'
     where id = v_lead;

    insert into public.crm_sequences (project_id, lead_id, name, purpose, stop_on_reply, is_test_data, created_by_id)
    values (v_project, v_lead, 'SELFCHECK-186', 'no_response', false, true, v_sales)
    returning id into v_seq;
    insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose, title, body, mode)
    values (v_seq, 1, 'call', 0, 'no_response', 'Ring them', 'Ask how it is going.', 'remind_me'),
           (v_seq, 2, 'whatsapp', 0, 'no_response', 'Machine step', 'Template text.', 'auto_send');
    update public.crm_sequence_steps set wa_template_name = 'selfcheck_186' where sequence_id = v_seq and step_no = 2;

    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at, created_by_id)
    values (v_lead, v_seq, 'scheduled', 0, 2, now(), now() - interval '1 minute', v_sales)
    returning id into v_ls;

    -- 1 · A step for a PERSON becomes the lead's next action.
    perform app.crm_advance_sequences();
    select next_action, next_action_at, next_action_type::text
      into v_action, v_action_at, v_kind
      from public.crm_leads where id = v_lead;

    -- 2 · A step for the MACHINE does not.
    update public.crm_leads set next_action = 'SELFCHECK-186 unchanged', next_action_at = now() - interval '2 days'
     where id = v_lead;
    delete from public.crm_follow_ups where lead_id = v_lead and lead_sequence_id is not null;
    update public.crm_lead_sequences set next_step_at = now() - interval '1 minute' where id = v_ls;
    perform app.crm_advance_sequences();
    select mode::text into v_mode from public.crm_follow_ups
     where lead_sequence_id = v_ls and sequence_step_no = 2;
    select next_action into v_action_auto from public.crm_leads where id = v_lead;

    raise exception using errcode = 'P0186', message = '186 rollback';
  exception when sqlstate 'P0186' then
    null;
  end;

  if v_action is distinct from 'Ring them' then
    raise exception '186 · a queued step did not become the next action (got %)', coalesce(v_action, 'null');
  end if;
  if v_kind is distinct from 'call' then
    raise exception '186 · the next action kept the wrong channel (%)', coalesce(v_kind, 'null');
  end if;
  if v_action_at is null or v_action_at < now() - interval '5 minutes' then
    raise exception '186 · the next action kept a stale time';
  end if;
  if v_mode is distinct from 'auto_send' then
    raise exception '186 · a template step inside the window stopped being auto_send (%)', coalesce(v_mode, 'null');
  end if;
  if v_action_auto is distinct from 'SELFCHECK-186 unchanged' then
    raise exception '186 · a machine step became somebody''s to-do (%)', coalesce(v_action_auto, 'null');
  end if;
  if exists (select 1 from public.crm_sequences where name = 'SELFCHECK-186') then
    raise exception '186 · the self-check left rows behind';
  end if;

  raise notice '186 · a step a person must do becomes the lead''s next action, so it reaches /todos and the desk; a machine step does not';
end $chk$;
