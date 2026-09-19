-- ============================================================================
-- 209 · THE STAGE MOVES ITSELF — the mechanical half
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"Manually changing each state is very hectic… When a
-- quotation is sent, it will be a quotation sent status. When a visit is
-- scheduled… you will automatically change its status."*
--
-- The plan is `docs/crm/17-AUTOMATIC-STAGES.md`. This is its Tier A: the moves
-- decided by rows we already write. **No model is involved in any of it.**
--
--   contacted        an inbound message AFTER one of ours, or a connected call
--   quotation_sent   a quotation reaching status 'sent'
--   visit_scheduled  a site visit booked and still to come
--   visited          that visit completed
--
-- `proposal_pending` is absent: `crm_document_kind` has no `proposal`, so there
-- is nothing to fire on. `qualified` is absent: it is the one that needs
-- judgement, and a person will still confirm it. `negotiation`, `won` and `lost`
-- are never automatic — the campaign-vs-salesperson report is computed from
-- outcomes, and an inferred one is fiction.
--
-- ── ⚠️ THE FIVE LAWS, FROM THE PLAN ────────────────────────────────────────
-- 1 · FORWARD ONLY. A reply from somebody in `negotiation` does not demote them.
-- 2 · NEVER CLOSES. `won`/`lost` are untouched, in both directions.
-- 3 · A HUMAN IS NEVER CONTRADICTED. Only advancement, never a correction.
-- 4 · THE TIMELINE SAYS WHAT MOVED IT — see the `why` added below.
-- 5 · IT LIVES IN THE DATABASE, so it fires whoever did the thing: the
--     salesperson, the scheduler, the webhook, an agent later.
--
-- ── ⚠️⚠️ AND THE ONE THAT WOULD HAVE BROKEN PRODUCTION ─────────────────────
-- 167's trigger REFUSES a lead entering `qualified` or beyond from `new` or
-- `contacted` with no BANT recorded, raising CRM08. Advancing to
-- `quotation_sent` inside the same transaction that sends the quotation would
-- therefore have raised out of the send itself — **the quotation would have
-- failed because the stage could not move.** Caught below, and the fallback is
-- to advance only as far as the gate allows.
-- ============================================================================

-- ── 1 · How far along a stage is ────────────────────────────────────────────
-- ⚠️ NOT `array_position(STAGE_ORDER)`. `nurture` sits after `negotiation` in the
-- display order, but it is a siding, not a further step — a parked lead that
-- gets a quotation is moving again, and ranking it 8 would call that backwards.
create or replace function app.crm_stage_rank(p_stage public.crm_stage)
returns integer
language sql
immutable
as $fn$
  select case p_stage
    when 'new'             then 0
    when 'contacted'       then 1
    when 'qualified'       then 2
    when 'proposal_pending' then 3
    when 'quotation_sent'  then 4
    when 'visit_scheduled' then 5
    when 'visited'         then 6
    when 'negotiation'     then 7
    /* Parked. Any real signal wakes it, so it must rank below all of them. */
    when 'nurture'         then -1
    /* ⚠️ NULL MEANS "NEVER TOUCH". won and lost are decisions with reasons. */
    else null
  end
$fn$;

comment on function app.crm_stage_rank(public.crm_stage) is
  'How far along the pipeline a stage is, for comparing two of them. NULL for won and lost, which automation never moves; -1 for nurture, which is parked rather than finished. 209.';


-- ── 2 · What the evidence supports ──────────────────────────────────────────
create or replace function app.crm_lead_stage_signal(p_lead uuid)
returns table (stage public.crm_stage, why text)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_first_out timestamptz;
  r record;
begin
  /* ── visited ──────────────────────────────────────────────────────────── */
  select a.scheduled_at into r
    from public.crm_appointments a
   where a.lead_id = p_lead and a.kind = 'site_visit' and a.status = 'completed'
   order by a.scheduled_at desc limit 1;
  if found then
    return query select 'visited'::public.crm_stage, 'the site visit was completed';
    return;
  end if;

  /* ── visit_scheduled ──────────────────────────────────────────────────────
     ⚠️ STILL TO COME. A visit booked for last Tuesday that nobody closed is not
     a lead with a visit scheduled; it is a lead somebody has to go and settle. */
  select a.scheduled_at into r
    from public.crm_appointments a
   where a.lead_id = p_lead and a.kind = 'site_visit'
     and a.status in ('scheduled', 'confirmed')
     and a.scheduled_at > now()
   order by a.scheduled_at limit 1;
  if found then
    return query select 'visit_scheduled'::public.crm_stage, 'a site visit is booked';
    return;
  end if;

  /* ── quotation_sent ───────────────────────────────────────────────────── */
  select q.number into r
    from public.crm_quotations q
   where q.lead_id = p_lead and q.status = 'sent'
   order by q.created_at desc limit 1;
  if found then
    return query select 'quotation_sent'::public.crm_stage,
                        'quotation ' || coalesce(r.number, '') || ' was sent';
    return;
  end if;

  /* ── contacted ────────────────────────────────────────────────────────────
     ⚠️⚠️ AN INBOUND *AFTER* ONE OF OURS, NOT MERELY BOTH. A Meta lead form
     arrives as an inbound message, so 660 of 689 leads have one before we have
     said a word. `exists(inbound) and exists(outbound)` would call Hina Shahzad
     contacted — she enquired on 12 Sep, we answered on the 17th, and she has
     never written back. Nobody has had a conversation with her. */
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

  /* ⚠️ AND A CONNECTED CALL IS A CONVERSATION. A CRM that only believed
     WhatsApp would leave every lead worked by phone sitting in `new`. */
  if exists (
    select 1 from public.crm_lead_activity a
     where a.lead_id = p_lead and a.kind = 'call_connected'
  ) then
    return query select 'contacted'::public.crm_stage, 'a call was connected';
    return;
  end if;

  return;
end;
$fn$;

comment on function app.crm_lead_stage_signal(uuid) is
  'The furthest stage this lead''s own records support, and why in words. Reads only facts we wrote: messages, quotations, appointments, connected calls. 209.';

grant execute on function app.crm_lead_stage_signal(uuid) to cni_app;


-- ── 3 · Advance, if the evidence is ahead of where the lead sits ────────────
create or replace function app.crm_advance_stage(p_lead uuid)
returns public.crm_stage
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_now  public.crm_stage;
  v_sig  record;
  v_rank integer;
begin
  select l.stage into v_now from public.crm_leads l where l.id = p_lead;
  if v_now is null then
    return null;
  end if;

  /* Law 2 — a closed lead is a decision somebody made, with a reason. */
  if app.crm_stage_rank(v_now) is null then
    return null;
  end if;

  select * into v_sig from app.crm_lead_stage_signal(p_lead);
  if not found or v_sig.stage is null then
    return null;
  end if;

  /* Law 1 and law 3 — only ever forward, so a human's choice is never undone. */
  if app.crm_stage_rank(v_sig.stage) <= app.crm_stage_rank(v_now) then
    return null;
  end if;

  /* Law 4 — the timeline gets the reason. 116's trigger writes the row; this
     hands it the sentence, transaction-locally, and clears it after. */
  perform set_config('app.crm_stage_why', v_sig.why, true);

  begin
    update public.crm_leads set stage = v_sig.stage where id = p_lead;
    perform set_config('app.crm_stage_why', '', true);
    return v_sig.stage;
  exception when sqlstate 'CRM08' then
    /* ⚠️⚠️ 167's QUALIFICATION GATE SAID NO, AND IT OUTRANKS THIS. It refuses a
       lead entering `qualified` or beyond out of `new`/`contacted` with no BANT
       recorded. Letting that raise would abort the caller's own transaction —
       **the quotation send would fail because the stage could not move**, which
       is a far worse bug than a stage left behind.

       So the automation takes what it is allowed: `contacted` is below the gate,
       and a lead with a quotation has self-evidently been spoken to. */
    if v_now = 'new' and app.crm_stage_rank('contacted') > app.crm_stage_rank(v_now) then
      begin
        perform set_config('app.crm_stage_why', v_sig.why || ', though qualification is still to be recorded', true);
        update public.crm_leads set stage = 'contacted' where id = p_lead;
        perform set_config('app.crm_stage_why', '', true);
        return 'contacted'::public.crm_stage;
      exception when others then
        perform set_config('app.crm_stage_why', '', true);
        return null;
      end;
    end if;
    perform set_config('app.crm_stage_why', '', true);
    return null;
  end;
end;
$fn$;

comment on function app.crm_advance_stage(uuid) is
  'Moves a lead forward to the stage its own records support, never backward and never into or out of won/lost. Catches 167''s CRM08 so a stage that cannot move never fails the action that triggered it. 209.';

grant execute on function app.crm_advance_stage(uuid) to cni_app;


-- ── 4 · The timeline carries the reason ─────────────────────────────────────
-- Reproduced from the live definition, with ONE addition: the `why`.
create or replace function app.crm_lead_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_actor uuid := app.current_user_id();
  v_why   text := nullif(coalesce(current_setting('app.crm_stage_why', true), ''), '');
begin
  if new.stage is distinct from old.stage then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (
      new.id, v_actor,
      case new.stage
        when 'won'  then 'won'::public.crm_activity_kind
        when 'lost' then 'lost'::public.crm_activity_kind
        else 'stage_changed'::public.crm_activity_kind
      end,
      nullif(new.lost_reason::text, ''),
      jsonb_build_object('from', old.stage::text, 'to', new.stage::text)
        /* ⚠️ 209 — ONLY WHEN SOMETHING SET IT. A stage a person moved carries no
           `why`, and inventing one would make every manual change read as
           automatic. */
        || case when v_why is null then '{}'::jsonb
                else jsonb_build_object('why', v_why) end
    );
  end if;

  if new.temperature is distinct from old.temperature then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (new.id, v_actor, 'temperature_set', new.temperature::text,
            jsonb_build_object('from', old.temperature::text, 'to', new.temperature::text));
  end if;

  if new.next_action is distinct from old.next_action
     or new.next_action_at is distinct from old.next_action_at then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (new.id, v_actor, 'next_action_set', new.next_action,
            jsonb_build_object('due', new.next_action_at));
  end if;

  if new.owner_id is distinct from old.owner_id then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, detail)
    values (new.id, v_actor, 'assigned',
            jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;

  return null;
end $fn$;


-- ── 5 · The four things that can move a stage ───────────────────────────────
-- ⚠️ ONE FUNCTION, FOUR TRIGGERS. Every one of these tables has `lead_id`, and a
-- second copy of "work out where this lead should be" is how two screens start
-- disagreeing about the same lead.
create or replace function app.crm_stage_watch()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  perform app.crm_advance_stage(new.lead_id);
  return null;
end $fn$;

drop trigger if exists crm_messages_move_stage on public.crm_lead_messages;
create trigger crm_messages_move_stage
  after insert on public.crm_lead_messages
  for each row execute function app.crm_stage_watch();

drop trigger if exists crm_quotations_move_stage on public.crm_quotations;
create trigger crm_quotations_move_stage
  after insert or update of status on public.crm_quotations
  for each row when (new.status = 'sent')
  execute function app.crm_stage_watch();

drop trigger if exists crm_appointments_move_stage on public.crm_appointments;
create trigger crm_appointments_move_stage
  after insert or update of status, scheduled_at on public.crm_appointments
  for each row when (new.kind = 'site_visit')
  execute function app.crm_stage_watch();

-- ⚠️ `call_connected` ONLY, AND THAT ALSO KILLS THE RECURSION. Advancing writes a
-- `stage_changed` row through 116's trigger; if this fired on every kind it would
-- call itself. The WHEN clause means it never sees its own footprints.
drop trigger if exists crm_calls_move_stage on public.crm_lead_activity;
create trigger crm_calls_move_stage
  after insert on public.crm_lead_activity
  for each row when (new.kind = 'call_connected')
  execute function app.crm_stage_watch();


-- ============================================================================
-- SELF-CHECK — it advances, it never retreats, and it never breaks the caller
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid;
  v_reply uuid; v_enquired uuid; v_ahead uuid; v_closed uuid; v_gated uuid;
  s_reply text; s_enquired text; s_ahead text; s_closed text; s_gated text;
  v_why text; v_quote uuid;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '209 · fixtures missing (project %, owner %)', v_project, v_owner;
  end if;

  begin
    /* ⚠️ ITS OWN LEADS — 082's lesson. Moving a real client's stage for a test
       is the exact damage this migration is supposed to prevent. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-209 replied',  'new', now(), v_owner, true) returning id into v_reply;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-209 enquired', 'new', now(), v_owner, true) returning id into v_enquired;
    /* ⚠️ THIS ONE NEEDS ITS BANT. 167's gate refuses a lead INSERTED at
       `negotiation` with no qualification, which the first run of this check
       discovered the hard way — a fixture that cannot exist is not a fixture. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data,
                                  budget_band, authority, purpose, timeline)
    values (v_project, 'manual', 'SELFCHECK-209 ahead', 'negotiation', now(), v_owner, true,
            'svc_50k_to_1l', 'sole_decider', 'svc_crm', 'within_1_month') returning id into v_ahead;
    insert into public.crm_leads (project_id, source, full_name, stage, lost_reason, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-209 closed', 'lost', 'no_answer', now(), v_owner, true) returning id into v_closed;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-209 gated', 'new', now(), v_owner, true) returning id into v_gated;

    /* 1 · We wrote, then they replied → contacted. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_reply, 'whatsapp', 'outbound', 'text', 'AoA, how can I help?', now() - interval '2 hours');
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_reply, 'whatsapp', 'inbound', 'text', 'Send me the details', now() - interval '1 hour');

    /* 2 · ⚠️ THEY ENQUIRED FIRST AND NEVER CAME BACK — the Hina Shahzad shape.
       An inbound BEFORE ours, then ours, and nothing since. Must stay `new`. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_enquired, 'whatsapp', 'inbound', 'text', 'More info please', now() - interval '5 days');
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_enquired, 'whatsapp', 'outbound', 'text', 'Here you are', now() - interval '1 hour');

    /* 3 · A lead already further along must not be dragged back. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_ahead, 'whatsapp', 'outbound', 'text', 'AoA', now() - interval '2 hours');
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_ahead, 'whatsapp', 'inbound', 'text', 'ok', now() - interval '1 hour');

    /* 4 · A closed lead is never touched. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_closed, 'whatsapp', 'outbound', 'text', 'AoA', now() - interval '2 hours');
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_closed, 'whatsapp', 'inbound', 'text', 'ok', now() - interval '1 hour');

    /* 5 · ⚠️ THE ONE THAT WOULD HAVE BROKEN PRODUCTION. A quotation marked sent
       on a lead with no BANT: the insert must SUCCEED, and the stage must settle
       at `contacted` rather than raising 167's CRM08 out of the caller. */
    insert into public.crm_quotations
      (lead_id, project_id, number, version, status, base_price, net_amount, prepared_by_id, is_test_data)
    values (v_gated, v_project, 'SELFCHECK-209', 1, 'sent', 1000, 1000, v_owner, true)
    returning id into v_quote;

    select stage::text into s_reply    from public.crm_leads where id = v_reply;
    select stage::text into s_enquired from public.crm_leads where id = v_enquired;
    select stage::text into s_ahead    from public.crm_leads where id = v_ahead;
    select stage::text into s_closed   from public.crm_leads where id = v_closed;
    select stage::text into s_gated    from public.crm_leads where id = v_gated;
    select a.detail->>'why' into v_why
      from public.crm_lead_activity a
     where a.lead_id = v_reply and a.kind = 'stage_changed'
     order by a.occurred_at desc limit 1;

    raise exception using errcode = 'P0209', message = '209 rollback';
  exception when sqlstate 'P0209' then
    null;
  end;

  if s_reply is distinct from 'contacted' then
    raise exception '209 · a reply after our message did not move the lead (got %)', s_reply;
  end if;
  if v_why is distinct from 'the client replied to us' then
    raise exception '209 · the timeline did not record WHY the stage moved (got %)', v_why;
  end if;
  if s_enquired is distinct from 'new' then
    raise exception '209 · an enquiry with no reply since was called % — the ordering rule is broken', s_enquired;
  end if;
  if s_ahead is distinct from 'negotiation' then
    raise exception '209 · a lead further along was dragged back to %', s_ahead;
  end if;
  if s_closed is distinct from 'lost' then
    raise exception '209 · a closed lead was moved to %', s_closed;
  end if;
  if s_gated is distinct from 'contacted' then
    raise exception '209 · the qualification gate was not handled; the lead sits at %', s_gated;
  end if;

  raise notice '209 · the stage moves itself: forward only, never past the gate, never a closed lead';
end $chk$;
