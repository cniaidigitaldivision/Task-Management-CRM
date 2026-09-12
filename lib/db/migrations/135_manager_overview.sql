-- ============================================================================
-- 135 · WHAT A MANAGER NEEDS TO SEE, LIVE
-- ----------------------------------------------------------------------------
-- Step 4 of the nine. The manager already has a panel under the lead list —
-- who holds what, how fast they answer — and four reports at `/lead-reports`
-- that are FROZEN on purpose: a report is a statement made on a date.
--
-- ⚠️ THIS IS THE OTHER HALF, AND THE DISTINCTION IS THE WHOLE DESIGN. A frozen
-- report answers *"what did we say in September"*. A manager opening their
-- screen on a Tuesday morning is asking *"what is wrong RIGHT NOW"*, and a
-- stored snapshot is the wrong shape for that question — it is correct and
-- out of date, which is worse than either.
--
-- So nothing here is stored. Every number is computed on read and is true at
-- the moment it is drawn.
--
-- ⚠️ AND IT REUSES `crm_report_sources`, `crm_report_ageing`, `crm_project_roster`
-- AND `crmDueCounts` RATHER THAN RE-DERIVING THEM. Two functions counting
-- "overdue" slightly differently is how a manager comes to distrust both.
-- ============================================================================

/* ── What is actually wrong, right now ───────────────────────────────────────
   One row, five numbers, every one of them a thing somebody can act on today.

   ⚠️ `never_contacted` IS THE ONE THAT MATTERS MOST and is deliberately not
   folded into "overdue". A lead nobody has ever rung is a different failure
   from one whose follow-up slipped: 553 of Chitral's leads are over a month old
   and NOT ONE has been contacted, and a single "overdue" count would have hidden
   that inside a number that looks like ordinary Tuesday backlog. */
create or replace function app.crm_lead_attention(p_project uuid)
returns table (
  overdue         int,
  due_today       int,
  unassigned      int,
  never_contacted int,
  gone_quiet      int
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    count(*) filter (
      where l.next_action_at is not null
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            < (now() at time zone 'Asia/Karachi')::date
    )::int,
    count(*) filter (
      where (l.next_action_at at time zone 'Asia/Karachi')::date
            = (now() at time zone 'Asia/Karachi')::date
    )::int,
    count(*) filter (where l.owner_id is null)::int,
    count(*) filter (where l.first_contacted_at is null)::int,
    /* Held by somebody, and nothing has happened to it in five days.
       ⚠️ `imported` is excluded — every lead carries one, and counting it would
       make a lead nobody has ever touched look freshly worked. The five days
       match migration 123's neglect threshold rather than inventing a second. */
    count(*) filter (
      where l.owner_id is not null
        and not exists (
          select 1 from public.crm_lead_activity a
           where a.lead_id = l.id
             and a.kind <> 'imported'
             and a.occurred_at > now() - interval '5 days'
        )
    )::int
  from public.crm_leads l
  where l.project_id = p_project
    /* ⚠️ OPEN ONLY. A won lead is not overdue and a lost one is not neglected;
       counting them would make every number climb for ever and never fall. */
    and l.stage not in ('won', 'lost')
  /* ⚠️ HAVING, NOT WHERE — AND THE SELF-CHECK IS WHAT FOUND IT. As a WHERE this
     filtered the ROWS, and an aggregate over no rows still returns ONE ROW of
     zeros. So a salesperson opening the manager's screen would have read
     "0 overdue, 0 never contacted" — which looks like good news rather than
     like a screen that is not theirs, and is the most dangerous possible
     rendering of a permission failure. HAVING filters the aggregate itself, so
     they get no row at all and the page can say so. */
  having app.crm_manages_project(p_project)
$$;

comment on function app.crm_lead_attention(uuid) is
  'Live counts of what needs a manager today. Open leads only. Never-contacted '
  'is kept separate from overdue on purpose — they are different failures. 135.';

/* ── Arrivals, and whether anybody answered them ─────────────────────────────
   ⚠️ TWO SERIES, NOT ONE. "Leads are up this week" is only good news if
   somebody rang them; plotting arrivals alone is how a campaign gets praised
   for volume nobody worked. `contacted` counts leads that ARRIVED on that day
   and have since been contacted at all — it is a property of the day's intake,
   not of the day's activity. */
create or replace function app.crm_lead_arrivals(p_project uuid, p_days int default 14)
returns table (on_date date, arrived int, contacted int)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with days as (
    /* ⚠️ EVERY DAY, INCLUDING THE EMPTY ONES. A series built only from days
       that had leads draws a flat line through a weekend of nothing and reads
       as steady intake. Karachi dates — 18% of leads fall on a different UTC
       day (measured, Step 4). */
    select generate_series(
      (now() at time zone 'Asia/Karachi')::date - (p_days - 1),
      (now() at time zone 'Asia/Karachi')::date,
      interval '1 day'
    )::date as d
  )
  select
    days.d,
    count(l.id)::int,
    count(l.id) filter (where l.first_contacted_at is not null)::int
  from days
  left join public.crm_leads l
    on (l.submitted_at at time zone 'Asia/Karachi')::date = days.d
   and l.project_id = p_project
  where app.crm_manages_project(p_project)
  group by days.d
  order by days.d
$$;

comment on function app.crm_lead_arrivals(uuid, int) is
  'Leads per day and how many of them were ever contacted. Karachi dates, empty '
  'days included. Two series because volume without contact is not good news. 135.';

revoke all on function app.crm_lead_attention(uuid) from public;
revoke all on function app.crm_lead_arrivals(uuid, int) from public;
grant execute on function app.crm_lead_attention(uuid) to cni_app;
grant execute on function app.crm_lead_arrivals(uuid, int) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_project uuid;
  v_mgr     uuid;
  v_member  uuid;
  v_admin   uuid;
  r         record;
  n         int;
begin
  select id into v_admin from public.users where role='admin' and is_active limit 1;
  select p.id into v_project from public.projects p
   where exists (select 1 from public.crm_leads l where l.project_id=p.id)
   order by p.name limit 1;
  if v_project is null then
    raise notice '135 · no project with leads — skipping';
    return;
  end if;

  select u.id into v_mgr from public.users u
    join public.projects p on p.id = v_project
   where u.department_id = p.lead_department_id and u.department_role='manager'
     and u.is_active limit 1;
  select u.id into v_member from public.users u
    join public.projects p on p.id = v_project
   where u.department_id = p.lead_department_id and u.department_role='member'
     and u.is_active limit 1;

  -- 1 · A manager gets numbers.
  if v_mgr is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_mgr::text, true);
    select * into r from app.crm_lead_attention(v_project);
    reset role;
    if r.overdue is null then
      raise exception '135 · the manager gets no attention counts';
    end if;
  end if;

  -- 2 · ⚠️ AND A SALESPERSON GETS NOTHING. These are whole-project figures —
  --     every colleague's workload in one row — so the predicate is
  --     crm_manages_project, not crm_in_project_department. A member reading
  --     them would be reading the team's numbers, which is the manager's screen.
  if v_member is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_member::text, true);
    select count(*) into n from app.crm_lead_attention(v_project) where overdue is not null;
    reset role;
    if n <> 0 then
      raise exception '135 · a salesperson can read the whole project''s attention counts';
    end if;
  end if;

  -- 3 · The arrivals series has one row per day, empty days included.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from app.crm_lead_arrivals(v_project, 14);
  reset role;
  if n <> 14 then
    raise exception '135 · arrivals returned % days instead of 14 — empty days are being dropped', n;
  end if;

  -- 4 · ⚠️ CONTACTED CAN NEVER EXCEED ARRIVED. A subset counted as a superset
  --     would draw a chart where the answered line sits above the intake line,
  --     which is the kind of wrong that looks like a rendering bug for a week.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from app.crm_lead_arrivals(v_project, 30) where contacted > arrived;
  reset role;
  if n > 0 then
    raise exception '135 · % days report more contacted than arrived', n;
  end if;

  raise notice '135 · the manager gets a live picture, and a salesperson does not';
end $$;
