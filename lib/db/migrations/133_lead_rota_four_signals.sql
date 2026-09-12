-- ============================================================================
-- 133 · THE ROTA STOPS JUST COUNTING
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-12: *"is this one figure, or is this one check enough for a
-- smart system to assign leads to a salesperson?… If I claim that my system is
-- an AI intelligent, AI smart, or AI-powered system, is this one check enough?"*
--
-- The answer written into `docs/crm/10-LEAD-ASSIGNMENT.md` was no. What existed
-- was one signal — fewest open leads — which is capacity routing with a
-- fairness tiebreak. A real algorithm, and arithmetic rather than intelligence.
--
-- This adds the three other signals that need nothing from anybody, and the one
-- that needed working hours (now set for all 16 active people, 2026-09-13):
--
--   1 · who actually answers fastest   ⭐ 5 min vs 30 min is 21× the qualify rate
--   2 · who is actually at work        ⭐ the one PropForce cannot copy
--   3 · weighted by STAGE, not headcount
--   4 · who has gone quiet on what they already hold
--
-- ⚠️ AND ONE SIGNAL IS DELIBERATELY ABSENT. Conversion rate does NOT route.
-- Performance-based routing creates a reinforcement loop — the best closer gets
-- the best leads, so nobody else can ever improve, and within months there is a
-- two-tier team the numbers then "prove" was correct. Performance is a
-- tiebreak. It is never the router.
--
-- ── ⚠️ IT NEVER RETURNS NOBODY JUST BECAUSE IT IS 2AM ──────────────────────
-- The obvious build filters out whoever is off the clock. Then a lead arriving
-- at midnight is assigned to no one, sits unowned until somebody notices, and
-- the response time this whole system measures starts counting from the moment
-- it arrived. So availability ORDERS the queue, it does not gate it: an
-- available person always beats an unavailable one, and when nobody is
-- available the rota still picks the least-loaded person and says why.
--
-- ── ⚠️ NULL RESPONSE TIME SORTS LAST, NOT FIRST ────────────────────────────
-- Somebody with no calls logged has an UNKNOWN median, not a fast one. Sorting
-- nulls first would hand every new lead to whoever has never answered one —
-- exactly backwards, and the same trap the sales panel already avoids by
-- printing "No calls yet" instead of "0m".
-- ============================================================================

/* ── What a stage costs, in attention ────────────────────────────────────────
   ⚠️ Five leads in `negotiation` is a week; five untouched `new` ones is an
   afternoon. Counting both as "5 open" was the crudest part of the old rule.
   The numbers are a judgement, not a measurement — there is not one closed lead
   to derive them from — so they live in one function that can be corrected in
   one place when there is. */
create or replace function app.crm_stage_weight(p_stage public.crm_stage)
returns numeric
language sql
immutable
as $$
  select case p_stage
    when 'new'         then 1.0
    when 'contacted'   then 1.5
    when 'follow_up'   then 2.0
    when 'visited'     then 2.5
    when 'qualified'   then 3.0
    when 'scheduled'   then 3.0
    when 'negotiation' then 3.0
    else 0.0                      -- won and lost are not open work
  end
$$;

comment on function app.crm_stage_weight(public.crm_stage) is
  'How much attention a lead at this stage costs. A judgement, not a measurement '
  '— correct it here when there are closed leads to learn from. Migration 133.';

/* ── Is this person at work right now? ───────────────────────────────────────
   ⚠️ KARACHI, NOT UTC, AND THE DAY MATTERS AS MUCH AS THE HOUR. `office_team`
   already decides which weekdays are worked — Blue Area rests Sunday, Wah rests
   Friday (migration 060) — so a Friday afternoon is a normal working hour for
   one office and a day off for the other. Reading `now()` in UTC would also put
   five evening hours of every Karachi day on the wrong date. */
create or replace function app.crm_is_at_work(p_user uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select
        /* On shift… */
        (localtime_now between u.work_starts_at and u.work_ends_at)
        /* …and today is a day their office works. */
        and (extract(isodow from local_now)::int = any (
              case u.office_team
                when 'wah' then array[1,2,3,4,6,7]   -- Friday off
                else            array[1,2,3,4,5,6]   -- Sunday off
              end))
      from (
        select u2.work_starts_at, u2.work_ends_at, u2.office_team,
               (now() at time zone 'Asia/Karachi')          as local_now,
               (now() at time zone 'Asia/Karachi')::time    as localtime_now
          from public.users u2 where u2.id = p_user
      ) u
      where u.work_starts_at is not null and u.work_ends_at is not null
    ),
    /* ⚠️ UNKNOWN HOURS COUNT AS AVAILABLE, NOT UNAVAILABLE. Nobody had working
       hours until 2026-09-13, and a rota that silently stopped giving leads to
       everyone whose record was incomplete would look like it had broken. */
    true
  )
$$;

comment on function app.crm_is_at_work(uuid) is
  'Is this person within their working day, on a day their office works? '
  'Karachi time. Unknown hours count as available. Migration 133.';

/* ── The rota, with its reasoning ────────────────────────────────────────────
   Returns everybody who could take a lead on this project, best first, with
   every number the ordering used — so the sentence on screen can be built from
   the same row that made the decision rather than from a second query that may
   disagree with it. */
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
as $$
  with candidates as (
    select u.id, u.full_name
      from public.users u
      join public.projects p on p.id = p_project
     where u.department_id = p.lead_department_id
       and u.is_active
       /* ⚠️ The manager runs the rota and is not in it — unchanged from the
          original. They distribute; they do not carry. */
       and u.department_role = 'member'
  )
  select
    c.id,
    c.full_name,
    (select count(*)::int from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')),
    /* Signal 3 — weighted by stage rather than counted. */
    coalesce((select sum(app.crm_stage_weight(l.stage)) from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')), 0),
    /* Signal 1 — how fast they answer, in minutes. NULL when never measured. */
    (select percentile_cont(0.5) within group (
              order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
       from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.first_contacted_at is not null),
    /* Signal 2 — are they at work right now. */
    app.crm_is_at_work(c.id),
    /* Signal 4 — days since they last DID anything to a lead.
       ⚠️ `imported` is excluded: every lead carries one and counting it would
       make somebody who has never rung anybody look freshly active. */
    (select coalesce(
        extract(day from (now() - max(a.occurred_at)))::int,
        /* Never acted at all. 999 rather than NULL so it sorts as "quiet" — but
           see the ordering: it only ever breaks a tie. */
        999)
       from public.crm_lead_activity a
       join public.crm_leads l on l.id = a.lead_id
      where l.owner_id = c.id and l.project_id = p_project
        and a.kind <> 'imported'),
    (select max(a.occurred_at) from public.crm_lead_activity a
      where a.kind = 'assigned' and (a.detail->>'to')::uuid = c.id)
  from candidates c
  order by
    /* ⚠️ AVAILABILITY ORDERS, IT DOES NOT GATE — see the header. */
    app.crm_is_at_work(c.id) desc,
    /* Signal 3 · the real workload */
    coalesce((select sum(app.crm_stage_weight(l.stage)) from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')), 0) asc,
    /* Signal 1 · faster answerer wins a tie. ⚠️ NULLS LAST — unknown is not fast. */
    (select percentile_cont(0.5) within group (
              order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
       from public.crm_leads l
      where l.owner_id = c.id and l.project_id = p_project
        and l.first_contacted_at is not null) asc nulls last,
    /* Signal 4 · then whoever has been acting most recently on what they hold */
    (select coalesce(extract(day from (now() - max(a.occurred_at)))::int, 999)
       from public.crm_lead_activity a
       join public.crm_leads l on l.id = a.lead_id
      where l.owner_id = c.id and l.project_id = p_project
        and a.kind <> 'imported') asc,
    /* The original tiebreak, kept last: longest since they were given one. */
    (select max(a.occurred_at) from public.crm_lead_activity a
      where a.kind = 'assigned' and (a.detail->>'to')::uuid = c.id) asc nulls first,
    c.full_name
$$;

comment on function app.crm_lead_rota(uuid) is
  'Everybody who could take a lead on this project, best first, with every '
  'number the ordering used. Migration 133 — see docs/crm/10-LEAD-ASSIGNMENT.md.';

revoke all on function app.crm_lead_rota(uuid) from public;
grant execute on function app.crm_lead_rota(uuid) to cni_app;

/* ── The existing entry point, now reading the rota ──────────────────────────
   ⚠️ SAME NAME, SAME SIGNATURE, SAME RETURN TYPE. `shareOutLeadsAction`,
   `crmNextOwner` and the test form all call this and none of them changes. A
   new name would have meant three callers to update and one of them forgotten. */
create or replace function app.crm_next_owner(p_project uuid)
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select user_id from app.crm_lead_rota(p_project) limit 1
$$;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_project uuid;
  v_admin   uuid;
  r         record;
  n         int;
  first_id  uuid;
begin
  select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  select p.id into v_project
    from public.projects p
   where exists (select 1 from public.crm_leads l where l.project_id = p.id)
   order by p.name limit 1;

  if v_project is null then
    raise notice '133 · no project with leads — skipping';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 1 · The rota returns people, and never nobody.
  select count(*) into n from app.crm_lead_rota(v_project);
  if n = 0 then
    raise exception '133 · the rota is empty for a project that has leads';
  end if;

  -- 2 · ⚠️ AND `crm_next_owner` STILL RETURNS SOMEBODY. This is the check that
  --     matters: three callers depend on it and none of them was changed.
  select app.crm_next_owner(v_project) into first_id;
  if first_id is null then
    raise exception '133 · crm_next_owner returned nobody — every caller is now broken';
  end if;

  -- 3 · The top of the rota IS what crm_next_owner picks. Two functions that
  --     disagree would make the explanation on screen a lie.
  select user_id into r from app.crm_lead_rota(v_project) limit 1;
  if r.user_id <> first_id then
    raise exception '133 · the rota and crm_next_owner disagree about who is next';
  end if;

  -- 4 · ⚠️ WEIGHTED LOAD IS NOT THE SAME AS A HEADCOUNT, which is the whole
  --     point of signal 3. Somebody holding work must weigh more than they count.
  select * into r from app.crm_lead_rota(v_project)
   where open_leads > 0 order by weighted_load desc limit 1;
  if found and r.weighted_load <= r.open_leads and r.open_leads > 0 then
    raise notice '133 · note: heaviest person weighs % for % leads (all at stage weight 1)',
      r.weighted_load, r.open_leads;
  end if;

  -- 5 · Availability is computed and is a real boolean, not null.
  select count(*) into n from app.crm_lead_rota(v_project) where at_work is null;
  if n > 0 then
    raise exception '133 · availability came back NULL for % people', n;
  end if;

  reset role;
  raise notice '133 · the rota answers on four signals, and crm_next_owner still picks somebody';
end $$;
