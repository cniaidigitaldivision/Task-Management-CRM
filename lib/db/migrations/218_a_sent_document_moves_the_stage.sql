-- ============================================================================
-- 218 · A QUOTATION SENT IN THE CHAT COUNTS; THE NEXT ACTION STAYS TRUE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19, on Umm e e Habiba: *"the last message I sent was the
-- quotation for the CRM… so its status should be changed to quotation sent but
-- right now it's still on contacted."* And: *"the next section is showing as
-- overdue on 18 September… it is showing me a thing which is basically I have
-- stopped or I have cancelled."*
--
-- Three faults, each found in the data rather than guessed at:
--
-- ── 1 · 209 ONLY WATCHED THE QUOTATIONS TABLE ──────────────────────────────
-- The owner sent `CNI_AJ_Trading_Quotation.pdf` captioned "Quotation For CRM",
-- and earlier `CNI_AI_Powered_CRM_Solution_Proposal.pdf`, straight from the
-- WhatsApp composer. Neither created a quotation row, so the stage signal had
-- nothing to read. The salesperson named the file and wrote the caption; those
-- words ARE the record of what was sent. So an outbound document or image whose
-- file name or caption says quotation/quote/QT-n now counts as a quotation sent,
-- and one that says proposal counts as a proposal sent — with the file name
-- written into the timeline as the reason.
--
-- ⚠️ A BROCHURE MOVES NOTHING. Only those words, in the name or caption of a
-- file WE sent. A client sending us their own quotation is not us quoting them.
--
-- ── 2 · THE QUALIFICATION GATE OUTRANKED THE TRUTH ─────────────────────────
-- 167 refuses a lead entering qualified-or-beyond with no BANT answers, and
-- 209's fallback then parked it at `contacted`. So even a properly recorded
-- quotation would have left this lead at `contacted` — the owner's complaint,
-- from the other side. The gate exists so nobody CLAIMS progress that did not
-- happen. When the lead's own records PROVE the progress — a quotation really
-- went out — refusing to show it makes the stage lie instead.
--
-- So the gate now yields to evidence: a stage the lead's records support may be
-- entered without BANT. It still holds for a stage somebody picks with nothing
-- behind it. ⚠️ AND `qualified_at` IS NOT STAMPED on that path: the lead got
-- further without being qualified, and the date must not say it was.
--
-- ── 3 · THE NEXT ACTION WAS A COPY THAT NEVER DIED ─────────────────────────
-- Creating a plan copies its first step into the lead's next action. When that
-- step was sent — or cancelled, or skipped — nothing cleared the copy, so
-- "First nudge · Overdue · 18 Sep" sat on the desk describing three follow-ups
-- that had all finished. Now when a follow-up leaves the open states, a next
-- action that was mirroring it moves to the next open follow-up, or clears.
-- ============================================================================

-- ── 1 · What the evidence supports, now reading what we sent ────────────────
-- Reproduced from 209 with two blocks added, marked 218.
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

  /* ── visit_scheduled — still to come ─────────────────────────────────── */
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

  /* ── quotation_sent — a recorded quotation ───────────────────────────── */
  select q.number into r
    from public.crm_quotations q
   where q.lead_id = p_lead and q.status = 'sent'
   order by q.created_at desc limit 1;
  if found then
    return query select 'quotation_sent'::public.crm_stage,
                        'quotation ' || coalesce(r.number, '') || ' was sent';
    return;
  end if;

  /* ── 218 · quotation_sent — a file WE sent that says it is one ─────────────
     Punctuation and underscores are turned into spaces first, so
     "CNI_AJ_Trading_Quotation.pdf" reads "cni aj trading quotation pdf" and the
     whole-word test finds it. No backslashes in the pattern: a backslash in
     this file's history has reached Postgres as a bare letter once already. */
  select m.media_filename into r
    from public.crm_lead_messages m
   where m.lead_id = p_lead
     and m.direction = 'outbound'
     and m.kind::text in ('document', 'image')
     and m.hidden_at is null
     and regexp_replace(lower(coalesce(m.media_filename, '') || ' ' || coalesce(m.body, '')),
                        '[^a-z0-9]+', ' ', 'g')
         ~ '(^| )(quotation|quotations|quote|quotes|qt [0-9]+)( |$)'
   order by m.occurred_at desc limit 1;
  if found then
    return query select 'quotation_sent'::public.crm_stage,
                        'sent ' || coalesce(r.media_filename, 'a quotation');
    return;
  end if;

  /* ── 218 · proposal_pending — a file WE sent that says it is a proposal ── */
  select m.media_filename into r
    from public.crm_lead_messages m
   where m.lead_id = p_lead
     and m.direction = 'outbound'
     and m.kind::text in ('document', 'image')
     and m.hidden_at is null
     and regexp_replace(lower(coalesce(m.media_filename, '') || ' ' || coalesce(m.body, '')),
                        '[^a-z0-9]+', ' ', 'g')
         ~ '(^| )(proposal|proposals)( |$)'
   order by m.occurred_at desc limit 1;
  if found then
    return query select 'proposal_pending'::public.crm_stage,
                        'sent ' || coalesce(r.media_filename, 'a proposal');
    return;
  end if;

  /* ── contacted — an inbound AFTER one of ours (209) ──────────────────── */
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


-- ── 2 · The gate yields to evidence, and says nothing false when it does ────
-- Reproduced from the live 167 definition; the evidence block is the only
-- addition, marked 218.
create or replace function app.crm_require_qualification()
returns trigger
language plpgsql
as $fn$
declare
  qualified_and_beyond constant public.crm_stage[] := array[
    'qualified', 'proposal_pending', 'quotation_sent',
    'visit_scheduled', 'visited', 'negotiation', 'won'
  ]::public.crm_stage[];

  before_qualification constant public.crm_stage[] := array[
    'new', 'contacted', 'follow_up', 'scheduled'
  ]::public.crm_stage[];

  entering boolean;
  v_sig record;
begin
  entering :=
    new.stage = any (qualified_and_beyond)
    and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
    and (tg_op = 'INSERT' or old.stage = any (before_qualification));

  if not entering then
    return new;
  end if;

  if new.budget_band is null
     or new.authority is null
     or new.purpose is null
     or new.timeline is null
  then
    /* ── 218 · THE RECORDS PROVE IT, SO THE STAGE MAY SAY IT ───────────────
       A quotation that really went out is a lead at `quotation_sent`, whether
       or not anybody filled in the qualifying answers first. Refusing the move
       would make the stage lie. ⚠️ `qualified_at` stays EMPTY here: the lead
       got further without being qualified, and the date must not claim it was.
       The Qualify card keeps asking for the answers. */
    if tg_op = 'UPDATE' then
      select * into v_sig from app.crm_lead_stage_signal(new.id);
      if found and v_sig.stage is not null
         and app.crm_stage_rank(v_sig.stage) >= app.crm_stage_rank(new.stage) then
        return new;
      end if;
    end if;

    raise exception
      using errcode = 'CRM08',
            message = 'This lead has not been qualified yet.',
            detail  = concat_ws(', ',
              case when new.budget_band is null then 'budget' end,
              case when new.authority   is null then 'who decides' end,
              case when new.purpose     is null then 'what they want it for' end,
              case when new.timeline    is null then 'when they intend to buy' end
            ),
            hint    = 'Record the qualifying answers first. "Not disclosed" is a valid answer — never asking is not.';
  end if;

  if new.qualified_at is null then
    new.qualified_at := now();
    new.qualified_by_id := app.current_user_id();
  end if;

  return new;
end;
$fn$;


-- ── 3 · A next action that mirrored a follow-up follows it when it ends ─────
create or replace function app.crm_next_action_follows_plan()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_next record;
begin
  select f.title, f.due_at, f.channel::text as channel into v_next
    from public.crm_follow_ups f
   where f.lead_id = new.lead_id
     and f.status in ('planned', 'due')
   order by f.due_at
   limit 1;

  /* ⚠️ ONLY A NEXT ACTION THAT WAS THIS FOLLOW-UP'S COPY. A next action a person
     typed by hand ("Call back after Eid") is their own plan and is never
     overwritten because some unrelated follow-up finished. */
  update public.crm_leads l
     set next_action      = v_next.title,
         next_action_at   = v_next.due_at,
         next_action_type = case when v_next.channel in ('call', 'whatsapp', 'email', 'task')
                                 then v_next.channel::public.crm_next_action_kind end
   where l.id = new.lead_id
     and l.next_action = new.title;

  return null;
end;
$fn$;

drop trigger if exists crm_follow_ups_next_action on public.crm_follow_ups;
create trigger crm_follow_ups_next_action
  after update of status on public.crm_follow_ups
  for each row
  when (old.status in ('planned', 'due') and new.status not in ('planned', 'due'))
  execute function app.crm_next_action_follows_plan();


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid;
  v_quote uuid; v_brochure uuid; v_prop uuid; v_bare uuid; v_na uuid;
  s_quote text; s_brochure text; s_prop text; q_at timestamptz; why text;
  bare_refused boolean := false; na_after text; na_manual text;
  v_f uuid;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '218 · fixtures missing';
  end if;

  begin
    /* Four leads, all `contacted`, NONE with BANT — the Umm e e Habiba shape. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-218 quote',    'contacted', now(), v_owner, true) returning id into v_quote;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-218 brochure', 'contacted', now(), v_owner, true) returning id into v_brochure;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-218 proposal', 'contacted', now(), v_owner, true) returning id into v_prop;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-218 bare',     'contacted', now(), v_owner, true) returning id into v_bare;

    /* 1 · The exact file the owner sent. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, media_filename, occurred_at)
    values (v_quote, 'whatsapp', 'outbound', 'document', 'Quotation For CRM', 'CNI_AJ_Trading_Quotation.pdf', now());
    /* 2 · A brochure must move nothing. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, media_filename, occurred_at)
    values (v_brochure, 'whatsapp', 'outbound', 'document', '', 'Company_Brochure.pdf', now());
    /* 3 · The proposal the owner sent earlier. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, media_filename, occurred_at)
    values (v_prop, 'whatsapp', 'outbound', 'document', '', 'CNI_AI_Powered_CRM_Solution_Proposal.pdf', now());

    select stage::text, qualified_at into s_quote, q_at from public.crm_leads where id = v_quote;
    select stage::text into s_brochure from public.crm_leads where id = v_brochure;
    select stage::text into s_prop from public.crm_leads where id = v_prop;
    select a.detail->>'why' into why from public.crm_lead_activity a
     where a.lead_id = v_quote and a.kind = 'stage_changed' order by a.occurred_at desc limit 1;

    /* 4 · ⚠️ THE GATE STILL HOLDS WITH NOTHING BEHIND IT. */
    begin
      update public.crm_leads set stage = 'negotiation' where id = v_bare;
    exception when sqlstate 'CRM08' then bare_refused := true;
    end;

    /* 5 · A next action copied from a follow-up clears when the follow-up is
       done; one a person typed is left alone. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data,
                                  next_action, next_action_at)
    values (v_project, 'manual', 'SELFCHECK-218 next', 'contacted', now(), v_owner, true,
            'First nudge', now() - interval '1 day')
    returning id into v_na;
    insert into public.crm_follow_ups (lead_id, purpose, channel, mode, status, title, due_at, assigned_to_id, created_by_id)
    values (v_na, 'no_response', 'whatsapp', 'remind_me', 'due', 'First nudge', now() - interval '1 day', v_owner, v_owner)
    returning id into v_f;
    update public.crm_follow_ups set status = 'done', done_at = now(), done_by_id = v_owner where id = v_f;
    select coalesce(next_action, '(none)') into na_after from public.crm_leads where id = v_na;

    update public.crm_leads set next_action = 'Call back after Eid', next_action_at = now() + interval '3 days' where id = v_na;
    insert into public.crm_follow_ups (lead_id, purpose, channel, mode, status, title, due_at, assigned_to_id, created_by_id)
    values (v_na, 'no_response', 'whatsapp', 'remind_me', 'due', 'Something else', now(), v_owner, v_owner)
    returning id into v_f;
    update public.crm_follow_ups set status = 'cancelled' where id = v_f;
    select next_action into na_manual from public.crm_leads where id = v_na;

    raise exception using errcode = 'P0218', message = '218 rollback';
  exception when sqlstate 'P0218' then
    null;
  end;

  if s_quote is distinct from 'quotation_sent' then
    raise exception '218 · the quotation PDF did not move the stage (got %)', s_quote;
  end if;
  if q_at is not null then
    raise exception '218 · qualified_at was stamped on a lead nobody qualified';
  end if;
  if why is distinct from 'sent CNI_AJ_Trading_Quotation.pdf' then
    raise exception '218 · the timeline does not say which file moved it (got %)', why;
  end if;
  if s_brochure is distinct from 'contacted' then
    raise exception '218 · a brochure moved the stage to %', s_brochure;
  end if;
  if s_prop is distinct from 'proposal_pending' then
    raise exception '218 · the proposal PDF did not move the stage (got %)', s_prop;
  end if;
  if not bare_refused then
    raise exception '218 · the gate let a stage through with nothing behind it';
  end if;
  if na_after is distinct from '(none)' then
    raise exception '218 · a finished follow-up left its copy as the next action (%)', na_after;
  end if;
  if na_manual is distinct from 'Call back after Eid' then
    raise exception '218 · a next action a person typed was overwritten (%)', na_manual;
  end if;

  raise notice '218 · a sent quotation moves the stage, the gate yields only to evidence, and the next action stays true';
end $chk$;
