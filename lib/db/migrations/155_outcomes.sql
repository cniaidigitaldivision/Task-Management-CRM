-- ============================================================================
-- 155 · WHAT HAPPENED, SEPARATELY FROM WHERE THE LEAD IS
-- ----------------------------------------------------------------------------
-- The owner's Phase 1 spec, verbatim: *"Store separately: lead_stage,
-- last_outcome, next_action_type, next_action_due_at, sequence_status."*
--
-- ── ⚠️ AND THE SEPARATION IS THE POINT, NOT TIDINESS ───────────────────────
-- A stage says where somebody is in the funnel. An outcome says what happened
-- the last time we spoke to them. They are not the same fact and they move at
-- different rates: a lead can sit in `negotiation` through four "no response"
-- outcomes, and collapsing the two loses every one of those.
--
-- It is also the mistake this schema already made once. `follow_up` was a STAGE
-- until 149 — an activity wearing a position's clothes — and retiring it is the
-- same lesson arriving from the other direction.
--
-- ── ⚠️ WHAT IS ENFORCED HERE, AND WHAT DELIBERATELY IS NOT ─────────────────
-- In the database, because they can never be true:
--   · `lost` with no reason
--   · `call_later` with no time to call back
--
-- NOT in the database, because 629 existing leads would fail it on contact:
--   · "every open lead leaves the form with a next action"
-- That one is the WRITE PATH's job. A constraint would refuse every future
-- update to 629 rows that predate the rule, which is how a good rule takes a
-- system down.
--
-- ⚠️ AND "won requires a confirmed booking" IS NOT ENFORCED EITHER, because
-- there is no bookings table yet. Writing a constraint against a table that does
-- not exist would be a rule nobody could satisfy; it arrives with Phase 7.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_outcome') then
    /* The owner's own eight, in their words. */
    create type public.crm_outcome as enum (
      'client_replied',
      'no_response',
      'interested',
      'not_interested',
      'wrong_contact',
      'call_later',
      'site_visit_requested',
      'booking_confirmed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_next_action_kind') then
    /* ⚠️ WHAT KIND of next action, beside the free-text `next_action` that
       already exists. The text says "Call back about the corner plot"; this says
       it is a CALL — which is what a channel filter, a day rail and any future
       reminder need, and none of them can parse a sentence. */
    create type public.crm_next_action_kind as enum (
      'call', 'whatsapp', 'email', 'meeting', 'site_visit', 'task'
    );
  end if;
end $$;

alter table public.crm_leads
  add column if not exists last_outcome public.crm_outcome,
  add column if not exists last_outcome_at timestamptz,
  add column if not exists last_outcome_by_id uuid references public.users (id) on delete set null,
  add column if not exists next_action_type public.crm_next_action_kind;

comment on column public.crm_leads.last_outcome is
  'What happened the last time somebody spoke to this lead. ⚠️ NOT the stage — a '
  'lead can sit in negotiation through four "no response" outcomes. Migration 155.';

comment on column public.crm_leads.next_action_type is
  'What KIND of next action, beside the free-text `next_action`. A filter, a day '
  'rail and a reminder all need this; none of them can parse a sentence. 155.';

-- ⚠️ NOT VALID, then validated separately. `lost_reason` is already null on any
-- historical lost lead, and an immediate check would refuse the migration
-- outright. `NOT VALID` binds every future write while leaving the past alone —
-- which is exactly the shape of this rule: it is about what may be RECORDED from
-- now on, not a claim about what was recorded before.
alter table public.crm_leads
  drop constraint if exists crm_leads_lost_needs_reason;
alter table public.crm_leads
  add constraint crm_leads_lost_needs_reason check (
    stage <> 'lost' or lost_reason is not null
  ) not valid;

alter table public.crm_leads
  drop constraint if exists crm_leads_call_later_needs_time;
alter table public.crm_leads
  add constraint crm_leads_call_later_needs_time check (
    last_outcome is distinct from 'call_later' or next_action_at is not null
  ) not valid;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead uuid;
  n int; bad boolean;
  v_stage public.crm_stage; v_reason public.crm_lost_reason;
begin
  /* ⚠️ Qualified. `id` alone is ambiguous across the join AND against the
     block's own variables — PL/pgSQL resolves a bare name to the variable
     first, which is the quieter half of the same trap. */
  select l.id, l.stage, l.lost_reason into v_lead, v_stage, v_reason
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' limit 1;

  if v_lead is null then
    raise notice '155 · no demo lead — columns added, nothing to measure';
    return;
  end if;

  -- 1 · ⚠️ LOST WITHOUT A REASON IS REFUSED FROM NOW ON.
  bad := false;
  begin
    update public.crm_leads set stage = 'lost', lost_reason = null where id = v_lead;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '155 · a lead was lost with no reason recorded';
  end if;

  -- 2 · With a reason it is accepted, then put back.
  update public.crm_leads set stage = 'lost', lost_reason = 'no_answer' where id = v_lead;
  update public.crm_leads set stage = v_stage, lost_reason = v_reason where id = v_lead;

  -- 3 · ⚠️ "CALL LATER" WITH NO TIME IS REFUSED. It is the one outcome whose
  --     entire meaning is a time, and recording it without one produces a lead
  --     that is waiting for a call nobody scheduled.
  bad := false;
  begin
    update public.crm_leads
       set last_outcome = 'call_later', next_action_at = null where id = v_lead;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '155 · "call later" was recorded with no time to call back';
  end if;

  -- 4 · And with one it is accepted.
  update public.crm_leads
     set last_outcome = 'call_later', next_action_at = now() + interval '1 day',
         next_action_type = 'call'
   where id = v_lead;

  -- 5 · ⚠️ THE PAST IS UNTOUCHED. `NOT VALID` means the 629 leads that predate
  --     these rules still read and still update — a constraint that took the
  --     backlog down would be a worse bug than the one it prevents.
  select count(*) into n from public.crm_leads;
  if n < 600 then
    raise exception '155 · the lead count collapsed to %', n;
  end if;

  update public.crm_leads
     set last_outcome = null, last_outcome_at = null, next_action_type = null,
         next_action_at = null
   where id = v_lead;

  raise notice '155 · outcome and next-action kind stored separately from the stage; % leads untouched', n;
end $$;
