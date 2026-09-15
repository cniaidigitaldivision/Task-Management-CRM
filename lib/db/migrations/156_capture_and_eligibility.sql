-- ============================================================================
-- 156 · CAPTURING A LEAD BY HAND, AND WHO IS ELIGIBLE TO RECEIVE IT
-- ----------------------------------------------------------------------------
-- The Add Lead form needs four facts the table does not hold, and the rota needs
-- the eligibility filter the Phase 1 spec asks for:
--
--     *"Before ranking, filter out users who are inactive, are not
--     salespeople, do not have project access, are on leave, have exceeded
--     capacity."*
--
-- ── WHAT EACH OF THOSE FIVE MEANS HERE ─────────────────────────────────────
--   inactive          · users.is_active
--   not salespeople   · department_role — a manager distributes, does not carry
--   no project access · already the rule: the project's own lead department
--   on leave          · public.availability, which has recorded leave since 012
--   exceeded capacity · users.crm_max_open_leads, added below. NULL = no cap,
--                       which is everybody until somebody sets one. ⚠️ No
--                       default number is invented; a cap nobody chose would
--                       silently starve a working salesperson.
--
-- ── ⚠️ AND IT MUST NOT UNDO 133'S INVARIANT ────────────────────────────────
-- 133 is emphatic, and right: *"availability ORDERS the queue, it does not gate
-- it"* — because filtering on working hours means a lead arriving at 2am is
-- assigned to nobody, sits unowned, and the response time this system measures
-- starts counting from the moment it arrived.
--
-- Leave is not working hours: somebody on a week's holiday is genuinely not
-- coming back tonight, so it SHOULD gate. But the same trap is one Eid away —
-- a holiday row covering the whole team is the most likely case here, and a
-- gate that empties the rota stops assigning leads at all, silently.
--
-- So the filter has two strengths, and only one of them can be relaxed:
--   · HARD  — inactive, not a salesperson, over capacity. Never relaxed. A lead
--             handed to a disabled account is worse than one held back.
--   · SOFT  — on leave. Relaxed only when respecting it would leave nobody, in
--             which case the rota picks anyway and the reason says it had to.
--
-- ── ⚠️ WHATSAPP CONSENT IS NOT A NICETY ────────────────────────────────────
-- Every sequence step past the 24-hour window is a template send to somebody's
-- personal phone. Without a recorded consent there is nothing to point at when
-- a person asks why a business is messaging them — and enough reports lose the
-- number for every other client on it.
-- ============================================================================

-- ── The four capture fields ────────────────────────────────────────────────
alter table public.crm_leads
  /* ⚠️ THREE STATES, NOT TWO. true/false cannot tell "they agreed" from "nobody
     has asked them yet", and those are different facts: the first is consent,
     the second is a question still to ask. NULL is the honest default for every
     lead that predates this column. */
  add column if not exists whatsapp_consent boolean,
  add column if not exists whatsapp_consent_at timestamptz,
  add column if not exists preferred_channel public.crm_followup_channel,
  /* "Mornings", "after 6pm", "not Fridays". Free text because it is whatever
     the person actually said, and a dropdown of times refuses half of them. */
  add column if not exists preferred_time text;

/* ⚠️ crm_followup_channel carries a 'task' value (153) that is meaningless as a
   person's preferred contact channel — nobody asks to be reached by task. The
   enum is reused rather than duplicated, and the nonsense value is refused here,
   so the column cannot hold a state no form should ever offer. */
alter table public.crm_leads
  drop constraint if exists crm_leads_preferred_channel_reachable;
alter table public.crm_leads
  add constraint crm_leads_preferred_channel_reachable check (
    preferred_channel is null or preferred_channel <> 'task'
  ) not valid;

comment on column public.crm_leads.whatsapp_consent is
  'Did they agree to be contacted on WhatsApp? ⚠️ NULL means NOBODY ASKED, which '
  'is not the same as no. Required before a sequence may send. Migration 156.';

comment on column public.crm_leads.preferred_time is
  'When they said to reach them, in their words. Free text on purpose — a time '
  'dropdown refuses "after Maghrib" and "not Fridays". Migration 156.';

-- ── The capacity cap, deliberately unset ───────────────────────────────────
alter table public.users
  add column if not exists crm_max_open_leads integer;

alter table public.users
  drop constraint if exists users_crm_max_open_leads_positive;
alter table public.users
  add constraint users_crm_max_open_leads_positive check (
    crm_max_open_leads is null or crm_max_open_leads > 0
  );

comment on column public.users.crm_max_open_leads is
  'Most open leads this person may hold before the rota stops choosing them. '
  '⚠️ NULL = no cap, and NULL is everybody until a manager sets one — a default '
  'number nobody chose would quietly starve a working salesperson. Migration 156.';

-- ════════════════════════════════════════════════════════════════════════════
-- WHO MAY RECEIVE A LEAD
-- ----------------------------------------------------------------------------
-- ⚠️ ELIGIBILITY IS A SEPARATE QUESTION FROM RANKING. Keeping them apart is what
-- lets the decision be explained in a sentence: "three of five were eligible,
-- Sarah won on workload" is one. "Sarah scored 0.71" is not.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_eligible_owners(p_project uuid)
returns table (
  user_id        uuid,
  full_name      text,
  eligible       boolean,
  /* ⚠️ May this exclusion be relaxed when it would otherwise leave nobody?
     false for leave; true for an inactive account, a manager, or a breached cap. */
  blocked_always boolean,
  why_not        text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $fn$
  with people as (
    select
      u.id,
      u.full_name,
      u.is_active,
      u.department_role,
      u.crm_max_open_leads,
      (select count(*) from public.crm_leads l
        where l.owner_id = u.id and l.stage not in ('won','lost')) as open_now,
      (select min(a.end_date) from public.availability a
        where a.user_id = u.id
          /* ⚠️ half_day IS NOT LEAVE. Its capacity_multiplier defaults to 0
             (012), so a capacity test would exclude somebody who is at work for
             half the day — which is still at work. The types are read by name
             for exactly that reason. */
          and a.type in ('leave', 'holiday', 'unavailable')
          and (now() at time zone 'Asia/Karachi')::date between a.start_date and a.end_date
      ) as leave_until
      from public.users u
      /* This join IS the "project access" rule — a project's leads belong to its
         lead department, and membership of that department is the access. */
      join public.projects p on p.id = p_project
     where u.department_id = p.lead_department_id
  )
  select
    pe.id,
    pe.full_name,
    (pe.is_active
      and pe.department_role = 'member'
      and (pe.crm_max_open_leads is null or pe.open_now < pe.crm_max_open_leads)
      and pe.leave_until is null) as eligible,
    (not pe.is_active
      or pe.department_role <> 'member'
      or (pe.crm_max_open_leads is not null and pe.open_now >= pe.crm_max_open_leads))
      as blocked_always,
    case
      when not pe.is_active then 'account is inactive'
      when pe.department_role <> 'member'
        then 'runs the department rather than carrying leads'
      when pe.crm_max_open_leads is not null and pe.open_now >= pe.crm_max_open_leads
        then 'at capacity — ' || pe.open_now || ' open, limit ' || pe.crm_max_open_leads
      when pe.leave_until is not null
        then 'on leave until ' || to_char(pe.leave_until, 'FMDD Mon')
      else null
    end as why_not
  from people pe
$fn$;

comment on function app.crm_eligible_owners(uuid) is
  'Who may receive a lead on this project, and WHY NOT for everybody else. '
  '⚠️ blocked_always marks the exclusions the rota may never relax (inactive, '
  'not a salesperson, over cap) as against the one it may (on leave, when '
  'respecting it would leave nobody at all). Migration 156.';

revoke all on function app.crm_eligible_owners(uuid) from public;
grant execute on function app.crm_eligible_owners(uuid) to cni_app;

-- ⚠️ AND THE ROTA NOW ASKS IT. It previously ranked every active member of the
-- department, so somebody on a fortnight's holiday was ranked — and on a quiet
-- week won, and the lead sat untouched until they came back.
create or replace function app.crm_lead_rota(p_project uuid)
returns table (
  user_id          uuid,
  full_name        text,
  open_leads       int,
  weighted_load    numeric,
  median_minutes   numeric,
  at_work          boolean,
  days_quiet       int,
  last_given_at    timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $fn$
  with graded as (
    select * from app.crm_eligible_owners(p_project)
  ),
  /* ⚠️ THE FALLBACK, and the reason this does not simply filter. If the whole
     team is on leave — one Eid holiday row, the ordinary case here — eligible is
     false for everybody, and a plain filter would return no rows and assign
     nothing at all. Then the soft exclusion is dropped and the rota picks from
     whoever is merely on leave, never from a disabled account or the manager. */
  any_eligible as (
    select exists (select 1 from graded where eligible) as ok
  ),
  candidates as (
    select g.user_id as id, g.full_name
      from graded g, any_eligible a
     where g.eligible or (not a.ok and not g.blocked_always)
  )
  select
    c.id,
    c.full_name,
    (select count(*)::int from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')) as open_leads,
    coalesce((select sum(app.crm_stage_weight(l.stage)) from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')), 0) as weighted_load,
    (select percentile_cont(0.5) within group (order by x.minutes)
       from (
         select extract(epoch from (m.occurred_at - prev.occurred_at)) / 60 as minutes
           from public.crm_lead_messages m
           join lateral (
             select p2.occurred_at from public.crm_lead_messages p2
              where p2.lead_id = m.lead_id and p2.direction = 'inbound'
                and p2.occurred_at < m.occurred_at
              order by p2.occurred_at desc limit 1
           ) prev on true
          where m.direction = 'outbound' and m.sent_by_id = c.id
       ) x) as median_minutes,
    app.crm_is_at_work(c.id) as at_work,
    coalesce((select extract(day from now() - max(l.submitted_at))::int
       from public.crm_leads l where l.owner_id = c.id), 999) as days_quiet,
    (select max(a.assigned_at) from public.crm_lead_assignments a
      where a.to_user_id = c.id) as last_given_at
  from candidates c
  order by
    app.crm_is_at_work(c.id) desc,
    coalesce((select sum(app.crm_stage_weight(l.stage)) from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')), 0) asc,
    (select percentile_cont(0.5) within group (order by x.minutes)
       from (
         select extract(epoch from (m.occurred_at - prev.occurred_at)) / 60 as minutes
           from public.crm_lead_messages m
           join lateral (
             select p2.occurred_at from public.crm_lead_messages p2
              where p2.lead_id = m.lead_id and p2.direction = 'inbound'
                and p2.occurred_at < m.occurred_at
              order by p2.occurred_at desc limit 1
           ) prev on true
          where m.direction = 'outbound' and m.sent_by_id = c.id
       ) x) asc nulls last,
    (select max(a.assigned_at) from public.crm_lead_assignments a
      where a.to_user_id = c.id) asc nulls first,
    c.id
$fn$;

comment on function app.crm_lead_rota(uuid) is
  'The four signals, over the ELIGIBLE people only (156). Working hours still '
  'ORDER rather than gate (133); leave gates, unless respecting it would leave '
  'nobody. A null median sorts LAST — somebody who has never replied is not the '
  'fastest. Migrations 133 and 156.';

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid;
  v_person uuid;
  n_all int; n_eligible int; n_rota int;
  v_why text; v_leave uuid;
begin
  select p.id into v_project from public.projects p
    join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;

  if v_project is null then
    raise notice '156 · no demo sales project — functions replaced, nothing to measure';
    return;
  end if;

  select count(*) into n_all      from app.crm_eligible_owners(v_project);
  select count(*) into n_eligible from app.crm_eligible_owners(v_project) where eligible;
  select count(*) into n_rota     from app.crm_lead_rota(v_project);

  -- 1 · ⚠️ THE ROTA RANKS THE ELIGIBLE, AND ONLY THEM.
  if n_rota <> n_eligible then
    raise exception '156 · the rota ranks % people but % are eligible', n_rota, n_eligible;
  end if;

  -- 2 · ⚠️ AND EVERY EXCLUSION HAS A REASON IN WORDS. A filter that drops
  --     somebody silently is one nobody can argue with.
  if exists (select 1 from app.crm_eligible_owners(v_project)
              where not eligible and why_not is null) then
    raise exception '156 · somebody was filtered out with no reason given';
  end if;

  -- 3 · The manager is excluded, and says so in words.
  select e.why_not into v_why from app.crm_eligible_owners(v_project) e
    join public.users u on u.id = e.user_id
   where u.department_role = 'manager' limit 1;
  if v_why is null then
    raise notice '156 · no manager on this project to check';
  elsif v_why not like '%department%' then
    raise exception '156 · the manager is excluded for the wrong reason: %', v_why;
  end if;

  -- 4 · ⚠️ LEAVE ACTUALLY REMOVES SOMEBODY. Booked, measured, withdrawn.
  select r.user_id into v_person from app.crm_lead_rota(v_project) r limit 1;
  if v_person is null then
    raise exception '156 · the rota returned nobody on the demo project';
  end if;

  insert into public.availability (user_id, start_date, end_date, type, note)
  values (v_person,
          (now() at time zone 'Asia/Karachi')::date,
          (now() at time zone 'Asia/Karachi')::date + 3,
          'leave', 'migration 156 self-check')
  returning id into v_leave;

  if exists (select 1 from app.crm_lead_rota(v_project) r where r.user_id = v_person) then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · a person on leave is still being offered leads';
  end if;

  select e.why_not into v_why from app.crm_eligible_owners(v_project) e
   where e.user_id = v_person;
  if v_why is null or v_why not like 'on leave%' then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · leave was not the reason given, it said: %', coalesce(v_why, 'nothing');
  end if;

  -- 5 · ⚠️ AND A HALF DAY IS NOT LEAVE. capacity_multiplier defaults to 0, so a
  --     capacity test would have excluded somebody who is at work.
  update public.availability set type = 'half_day' where id = v_leave;
  if not exists (select 1 from app.crm_lead_rota(v_project) r where r.user_id = v_person) then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · a half day was treated as leave';
  end if;

  -- 6 · ⚠️ AND THE ROTA NEVER RETURNS NOBODY — 133's invariant, which this
  --     migration could easily have broken. Everybody on leave at once is one
  --     Eid holiday row away, and a rota that then assigned nothing would stop
  --     the whole desk silently.
  update public.availability set type = 'leave' where id = v_leave;
  insert into public.availability (user_id, start_date, end_date, type, note)
  select e.user_id,
         (now() at time zone 'Asia/Karachi')::date,
         (now() at time zone 'Asia/Karachi')::date,
         'holiday', 'migration 156 self-check'
    from app.crm_eligible_owners(v_project) e where e.eligible;

  select count(*) into n_eligible from app.crm_eligible_owners(v_project) where eligible;
  select count(*) into n_rota     from app.crm_lead_rota(v_project);

  if n_eligible <> 0 then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · the check failed to put everybody on leave (% left)', n_eligible;
  end if;
  if n_rota = 0 then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · with the whole team on leave the rota assigns NOBODY';
  end if;

  -- 7 · ⚠️ BUT THE FALLBACK NEVER REACHES A DISABLED ACCOUNT OR THE MANAGER.
  --     Relaxing leave must not relax the rest.
  if exists (
    select 1 from app.crm_lead_rota(v_project) r
      join public.users u on u.id = r.user_id
     where not u.is_active or u.department_role <> 'member'
  ) then
    delete from public.availability where note = 'migration 156 self-check';
    raise exception '156 · the fallback offered a lead to an inactive account or a manager';
  end if;

  /* ⚠️ EVERY ROW THIS CHECK WROTE IS WITHDRAWN, matched on its own note. A
     migration that left a real person booked on leave would take them off the
     rota for days and nobody would connect it to a schema change. */
  delete from public.availability where note = 'migration 156 self-check';

  select count(*) into n_eligible from app.crm_eligible_owners(v_project) where eligible;
  select count(*) into n_rota     from app.crm_lead_rota(v_project);
  if n_eligible <> n_rota or n_rota = 0 then
    raise exception '156 · the check did not clean up after itself — % eligible, % ranked',
      n_eligible, n_rota;
  end if;

  raise notice '156 · % of % eligible; leave gates, half days do not, and the rota still answers when everybody is off',
    n_eligible, n_all;
end $chk$;
