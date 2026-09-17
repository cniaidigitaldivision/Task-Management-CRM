-- ============================================================================
-- 185 · PLAN A FOLLOW-UP — one action, or a scheduler, from the drawer
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, with a design for the New follow-up dialog: *"I want to set
-- a scheduler… then the scheduler will be like: day 1, send this one."* and
-- *"I want to set a single follow-up."*
--
-- 153 and 170 already have both shapes: `crm_follow_ups` is ONE action, and a
-- sequence is a template of steps that the engine turns into those actions. What
-- was missing is that a sequence could only be written by an admin or a
-- department manager, for a whole project. A salesperson planning "day 1, day 3,
-- day 7" for ONE client had nowhere to put it.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- 1 · `crm_sequences.lead_id` — a plan made FOR ONE LEAD by whoever works it.
--     ⚠️ Still a template + a run, not one row. The run (`crm_lead_sequences`)
--     is what pauses, resumes and records what was sent; collapsing them would
--     mean editing the plan rewrites what already happened.
-- 2 · `crm_sequence_steps.title` and `.mode` — the step's own words ("Gentle
--     reminder") and who acts on it.
-- 3 · The booked-visit stop-condition stops CHASES, not the reminders that are
--     about the visit itself. ⚠️ Without this an appointment reminder could
--     never run: 170 would stop it on the very appointment it exists to remind
--     about, and nothing on screen would say why.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · A PLAN THAT BELONGS TO ONE LEAD
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_sequences
  add column if not exists lead_id uuid references public.crm_leads (id) on delete cascade;

comment on column public.crm_sequences.lead_id is
  'Set when this plan was made for ONE lead from the drawer (185). NULL is a project template a manager owns and anyone may start. A lead plan is never offered on another lead.';

create index if not exists crm_sequences_lead_idx
  on public.crm_sequences (lead_id) where lead_id is not null;

alter table public.crm_sequence_steps
  add column if not exists title text;

comment on column public.crm_sequence_steps.title is
  'What this step is called in the plan — "Initial follow-up", "Final check-in". Becomes the queued follow-up''s title. 185.';

/* ⚠️ DEFAULT `auto_send` PRESERVES 170 EXACTLY. The engine used to decide the
   mode from the channel and the 24-hour window alone; with this column it may
   only ever narrow that decision, never widen it. Every step written before
   today keeps the behaviour it had. */
alter table public.crm_sequence_steps
  add column if not exists mode public.crm_followup_mode not null default 'auto_send';

comment on column public.crm_sequence_steps.mode is
  'Who acts on this step: remind_me (it lands on /todos), review_first (drafted for a person to send), auto_send (the machine may send it). ⚠️ A CEILING, not a promise — 170 still refuses free text outside the 24-hour window. 185.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · WHO MAY WRITE ONE
-- ----------------------------------------------------------------------------
-- ⚠️ A PROJECT TEMPLATE IS STILL A MANAGER'S. It decides what goes out under the
-- business's name on every lead in the project. A LEAD plan is the salesperson's
-- own next three messages to one person they already own — the same authority
-- they have to send those messages by hand.
--
-- ⚠️ AND `crm_manages_project(project_id)` IS KEPT AS IT WAS, per row, against
-- law 5's rule. This table holds templates — tens of rows, not hundreds of
-- thousands — and rewriting a reviewed access predicate to save microseconds on
-- a table this size is how a sixth membership bug ships.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists crm_sequences_select on public.crm_sequences;
create policy crm_sequences_select on public.crm_sequences
  for select to cni_app
  using (
    (select app.current_user_id()) is not null
    /* A lead plan is visible to whoever can see the lead; RLS on crm_leads
       answers that, so this cannot show one salesperson another's client. */
    and (lead_id is null or exists (select 1 from public.crm_leads l where l.id = lead_id))
  );

drop policy if exists crm_sequences_write on public.crm_sequences;
create policy crm_sequences_write on public.crm_sequences
  for all to cni_app
  using (
    app.acting_at_least('admin'::public.user_role)
    or (lead_id is null and project_id is not null and app.crm_manages_project(project_id))
    or (lead_id is not null and exists (select 1 from public.crm_leads l where l.id = lead_id))
  )
  with check (
    app.acting_at_least('admin'::public.user_role)
    or (lead_id is null and project_id is not null and app.crm_manages_project(project_id))
    or (lead_id is not null and exists (select 1 from public.crm_leads l where l.id = lead_id))
  );

/* The steps follow their sequence: whoever may write the plan may write what is
   in it. ⚠️ It was admin-only, which is why a manager could create a template
   with no steps in it and nothing to run. */
drop policy if exists crm_sequence_steps_write on public.crm_sequence_steps;
create policy crm_sequence_steps_write on public.crm_sequence_steps
  for all to cni_app
  using (
    exists (
      select 1 from public.crm_sequences s
       where s.id = sequence_id
         and (app.acting_at_least('admin'::public.user_role)
              or (s.lead_id is null and s.project_id is not null and app.crm_manages_project(s.project_id))
              or s.lead_id is not null)
    )
  )
  with check (
    exists (
      select 1 from public.crm_sequences s
       where s.id = sequence_id
         and (app.acting_at_least('admin'::public.user_role)
              or (s.lead_id is null and s.project_id is not null and app.crm_manages_project(s.project_id))
              or s.lead_id is not null)
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · A REMINDER ABOUT A VISIT IS NOT A CHASE
-- ----------------------------------------------------------------------------
-- ⚠️⚠️ THIS WOULD HAVE SHIPPED BROKEN THE DAY THE DIALOG OFFERED "Appointment
-- reminder". 170 stops any sequence when a visit is booked — right for a chase
-- ("they agreed to come; stop asking"), and fatal for the reminder ABOUT that
-- visit, which would stop on the appointment it exists to remind about. The
-- salesperson would see "Stopped — a visit is already booked" and no reminder.
--
-- So the rule now applies to the purposes that ARE a chase. Everything else in
-- the function is untouched: a closed lead, a stated no, a switched-off
-- sequence, a reply since the last resume, and a dead quotation all still stop.
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
         s.stop_on_reply, s.is_active, s.purpose::text as purpose,
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

  /* ⚠️ `false` STOPS IT; `NULL` DOES NOT. NULL means nobody has ever asked — 640
     of 641 real leads. Treating it as a refusal would mean no sequence could run;
     treating it as consent is the incident in `docs/crm-ai/05-GUARDRAILS.md` §5.
     So the SENDER refuses a NULL, and this function reports only a stated no. */
  if r.whatsapp_consent is false then
    return 'they asked not to be messaged';
  end if;

  if not r.is_active then
    return 'the sequence was switched off';
  end if;

  /* ⚠️ THE CLIENT REPLIED — the single most important rule in any chase engine.
     Measured from the last resume, or from the start if it has never been
     resumed (182): a salesperson who has read the reply and carried on is not
     paused again by the same message. */
  if r.stop_on_reply and exists (
    select 1 from public.crm_lead_messages m
     where m.lead_id = r.lead_id
       and m.direction = 'inbound'
       and m.created_at >= coalesce(r.resumed_at, r.started_at)
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

  /* ⚠️ ALREADY BOOKED — AND ONLY FOR A CHASE. Somebody who has agreed to come
     does not need chasing to come. But a visit reminder, a payment reminder or a
     check-in after the visit are all ABOUT the appointment, and 170 stopped every
     one of them on the appointment itself. */
  if r.purpose in ('no_response', 're_engage', 'quotation') and exists (
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
-- 4 · THE ENGINE HONOURS WHAT THE STEP ASKED FOR
-- ----------------------------------------------------------------------------
-- ⚠️ THE STEP'S `mode` MAY ONLY NARROW. A step that says "remind me" is never
-- sent by machine. A step that says "send it" still becomes `review_first` when
-- it is free text outside the 24-hour window — the one rule that would reach a
-- real customer if it were wrong, and the test number lies about it.
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

    /* ── Queue it ───────────────────────────────────────────────────────── */
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at,
       lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
    values (
      r.lead_id,
      coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
      v_step.channel,
      case
        when v_step.channel <> 'whatsapp' then 'remind_me'
        /* The step's own answer, which may narrow what follows but never widen it. */
        when v_step.mode = 'remind_me' then 'remind_me'
        when app.crm_window_is_open(r.lead_id) then v_step.mode
        when nullif(v_step.wa_template_name, '') is not null then v_step.mode
        /* ⚠️ Free text outside the window: a person sends it, or nobody does. */
        else 'review_first'
      end::public.crm_followup_mode,
      'due',
      coalesce(nullif(v_step.title, ''),
               coalesce(nullif(v_step.purpose, ''), 'Follow up') || ' · step ' || v_step.step_no),
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


-- ============================================================================
-- SELF-CHECK — as cni_app, as real people; every fixture rolled back
-- ⚠️ It builds what it needs and raises if it cannot. A check that hunts for a
-- fixture it may not find prints a tick for a rule it never ran.
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_outsider uuid; v_lead uuid;
  v_seq uuid; v_ls uuid;
  n_plan_by_sales int := -1; n_template_by_sales int := -1; n_steps_by_sales int := -1;
  n_seen_by_other int := -1;
  v_reason_chase text; v_reason_reminder text; v_mode text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  /* ⚠️ A LEAD WITH NO LIVE RUN. One live sequence per lead is a unique index, so
     borrowing the seeded demo lead would fail on the fixture rather than on the
     rule being checked. */
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data
     and l.stage not in ('won', 'lost')
     and not exists (select 1 from public.crm_lead_sequences ls
                      where ls.lead_id = l.id and ls.state in ('scheduled', 'active', 'paused'))
   limit 1;
  /* ⚠️ SOMEBODY WHO GENUINELY CANNOT SEE THIS LEAD. A manager of the same
     department SHOULD see it, so testing privacy against one proves nothing —
     it is a different department's member who must come back empty. */
  select u.id into v_outsider
    from public.users u
   where u.is_active and u.role = 'member' and u.id <> v_sales
     and u.department_id is distinct from (select department_id from public.users where id = v_sales)
   limit 1;

  if v_project is null or v_lead is null or v_sales is null or v_outsider is null then
    raise exception '185 · fixtures missing (project %, lead %, owner %, outsider %) — refusing to skip',
      v_project, v_lead, v_sales, v_outsider;
  end if;

  begin
    -- ── 1 · A salesperson may plan for THEIR OWN lead, steps included ──────
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    begin
      insert into public.crm_sequences (project_id, lead_id, name, purpose, stop_on_reply, is_test_data, created_by_id)
      values (v_project, v_lead, 'SELFCHECK-185', 'no_response', true, true, v_sales)
      returning id into v_seq;
      n_plan_by_sales := 1;
    exception when insufficient_privilege then n_plan_by_sales := 0;
    end;

    if n_plan_by_sales = 1 then
      begin
        insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose, title, body, mode)
        values (v_seq, 1, 'whatsapp', 0, 'no_response', 'Initial follow-up', 'Step one.', 'review_first'),
               (v_seq, 2, 'whatsapp', 2, 'no_response', 'Gentle reminder',   'Step two.', 'remind_me');
        n_steps_by_sales := 1;
      exception when insufficient_privilege then n_steps_by_sales := 0;
      end;
    end if;

    -- ── 2 · …but NOT a template for the whole project ─────────────────────
    begin
      insert into public.crm_sequences (project_id, lead_id, name, purpose, is_test_data, created_by_id)
      values (v_project, null, 'SELFCHECK-185-template', 'no_response', true, v_sales);
      n_template_by_sales := 1;
    exception when insufficient_privilege then n_template_by_sales := 0;
    end;
    reset role;

    -- ── 3 · A visit stops a CHASE and does not stop the reminder about it ──
    insert into public.crm_appointments (lead_id, project_id, kind, status, scheduled_at, created_by_id, owner_id, is_test_data)
    values (v_lead, v_project, 'site_visit', 'confirmed', now() + interval '2 days', v_sales, v_sales, true);

    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at, created_by_id)
    values (v_lead, v_seq, 'scheduled', 0, 2, now(), now() - interval '1 minute', v_sales)
    returning id into v_ls;

    v_reason_chase := app.crm_sequence_stop_reason(v_ls);
    update public.crm_sequences set purpose = 'appointment_reminder' where id = v_seq;
    v_reason_reminder := app.crm_sequence_stop_reason(v_ls);

    -- ── 4 · A step that asked to be reviewed is never upgraded to auto-send ─
    --    ⚠️ The window is OPEN here only if the lead has a recent inbound; the
    --    step names no template, so 170's old rule would have said review_first
    --    anyway. The inbound message below makes the window open, which is the
    --    case where the old rule said auto_send — so this proves the narrowing.
    insert into public.crm_lead_messages (lead_id, direction, kind, body, status, created_at)
    values (v_lead, 'inbound', 'text', '185 window', 'delivered', now());
    update public.crm_sequences set stop_on_reply = false where id = v_seq;
    /* ⚠️ THE TWO THINGS THAT WOULD MAKE THIS CHECK PASS BY ACCIDENT, removed
       rather than hoped for: the one-chase-a-day cap (this lead may already have
       queued rows today) and quiet hours (a migration run at 11pm would queue
       nothing and the check would read that as a broken mode). Both are rolled
       back with everything else. */
    delete from public.crm_follow_ups where lead_id = v_lead and lead_sequence_id is not null;
    update public.crm_project_settings set sla_night_from = 0, sla_night_to = 0 where project_id = v_project;
    perform app.crm_advance_sequences();
    select mode::text into v_mode from public.crm_follow_ups
     where lead_sequence_id = v_ls and sequence_step_no = 1;

    -- ── 5 · Another department's member cannot see this lead's plan ───────
    set local role cni_app;
    perform set_config('app.user_id', v_outsider::text, true);
    select count(*) into n_seen_by_other from public.crm_sequences where id = v_seq;
    reset role;

    raise exception using errcode = 'P0185', message = '185 rollback';
  exception when sqlstate 'P0185' then
    null;
  end;

  if n_plan_by_sales <> 1 then
    raise exception '185 · a salesperson could not plan a follow-up on their own lead';
  end if;
  if n_steps_by_sales <> 1 then
    raise exception '185 · a salesperson could not write the steps of their own plan';
  end if;
  if n_template_by_sales <> 0 then
    raise exception '185 · a salesperson wrote a project-wide template';
  end if;
  if v_reason_chase is distinct from 'a visit is already booked' then
    raise exception '185 · a booked visit no longer stops a chase (got %)', coalesce(v_reason_chase, 'null');
  end if;
  if v_reason_reminder is not null then
    raise exception '185 · the reminder ABOUT the visit was stopped by the visit (%)', v_reason_reminder;
  end if;
  if v_mode is distinct from 'review_first' then
    raise exception '185 · a review_first step was queued as % — the step''s own answer was overruled', coalesce(v_mode, 'nothing');
  end if;
  if n_seen_by_other <> 0 then
    raise exception '185 · a plan made for one salesperson''s lead is visible to another department';
  end if;
  if exists (select 1 from public.crm_sequences where name like 'SELFCHECK-185%') then
    raise exception '185 · the self-check left rows behind';
  end if;

  raise notice '185 · a salesperson plans for their own lead but not for the project; a visit stops a chase and never the reminder about it; a review-first step stays review-first; a lead plan is private to that lead';
end $chk$;
