-- ============================================================================
-- 136 · A SALESPERSON'S OWN DAY
-- ----------------------------------------------------------------------------
-- Step 5 of the nine, and the counterpart to 135. That one answers *"what is
-- wrong across the team"* and is the manager's. This answers *"what is mine,
-- and how am I doing"* and belongs to whoever is looking.
--
-- ⚠️ THE SAME SHAPE, SCOPED TO ONE PERSON — NOT A SECOND SET OF DEFINITIONS.
-- Overdue means the same thing here as it does on the manager's screen, and
-- `gone_quiet` still excludes `imported` and still uses migration 123's five
-- days. Two screens that count "overdue" slightly differently is how somebody
-- comes to distrust both, and the person most likely to notice the discrepancy
-- is the one being measured by it.
--
-- ── ⚠️ IT ALSO RETURNS THEIR RESPONSE TIME, DELIBERATELY ───────────────────
-- That figure is the single number their manager judges them on — it is the
-- first column of the sales team panel and signal 1 of the rota. A salesperson
-- who cannot see the measure being applied to them cannot improve it, and
-- finding out at an appraisal what has been on a screen for months is the worst
-- version of this product. So they see their own, in their own words.
--
-- ⚠️ AND NULL STAYS NULL, ALL THE WAY TO THE SCREEN. Somebody with no calls
-- logged has no response time, not a fast one — the page must read "no calls
-- yet" rather than "0m", which is the most flattering possible reading of never
-- having answered anybody. The same rule Step 7b's panel already follows.
--
-- ── ⚠️ NO MANAGER GATE, AND THAT IS THE DIFFERENCE FROM 135 ────────────────
-- `crm_lead_attention` ends in `having app.crm_manages_project(...)` because it
-- exposes the whole team's work. Everything here is filtered to
-- `owner_id = app.current_user_id()`, so it discloses nothing the caller could
-- not already read off their own desk. A manager calling it sees their own
-- leads — normally none, since they distribute rather than carry.
-- ============================================================================

create or replace function app.crm_my_day(p_project uuid)
returns table (
  open_total      int,
  overdue         int,
  due_today       int,
  never_contacted int,
  gone_quiet      int,
  won_total       int,
  median_minutes  numeric
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    count(*) filter (where l.stage not in ('won','lost'))::int,
    count(*) filter (
      where l.stage not in ('won','lost')
        and l.next_action_at is not null
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            < (now() at time zone 'Asia/Karachi')::date
    )::int,
    count(*) filter (
      where l.stage not in ('won','lost')
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            = (now() at time zone 'Asia/Karachi')::date
    )::int,
    count(*) filter (
      where l.stage not in ('won','lost') and l.first_contacted_at is null
    )::int,
    count(*) filter (
      where l.stage not in ('won','lost')
        and not exists (
          select 1 from public.crm_lead_activity a
           where a.lead_id = l.id
             and a.kind <> 'imported'
             and a.occurred_at > now() - interval '5 days'
        )
    )::int,
    /* ⚠️ WON IS COUNTED OVER ALL TIME, not over the open set. It is the one
       figure here that is meant to go UP and stay up; filtering it to open
       leads would make it permanently zero, since winning a lead is what takes
       it out of that set. */
    count(*) filter (where l.stage = 'won')::int,
    /* ⚠️ NULL WHEN NEVER MEASURED. `percentile_cont` over an empty filtered set
       returns NULL rather than 0, which is exactly what is wanted and is the
       reason no `coalesce` appears here. */
    percentile_cont(0.5) within group (
      order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0
    ) filter (where l.first_contacted_at is not null)
  from public.crm_leads l
  where l.project_id = p_project
    /* ⚠️ THEIRS, AND ONLY THEIRS. This is what removes the need for a manager
       gate — the function cannot disclose a colleague's workload because it
       never looks at one. */
    and l.owner_id = app.current_user_id()
$$;

comment on function app.crm_my_day(uuid) is
  'One salesperson''s own leads on one project, plus their own response time. '
  'Scoped to the caller, so no manager gate is needed. Same definitions as '
  'app.crm_lead_attention (135) — deliberately not a second set. Migration 136.';

revoke all on function app.crm_my_day(uuid) from public;
grant execute on function app.crm_my_day(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_project uuid;
  v_a       uuid;
  v_b       uuid;
  v_mgr     uuid;
  ra        record;
  rb        record;
  n         int;
begin
  select p.id into v_project from public.projects p
   where exists (select 1 from public.crm_leads l where l.project_id = p.id and l.owner_id is not null)
   order by p.name limit 1;
  if v_project is null then
    raise notice '136 · no project with assigned leads — skipping';
    return;
  end if;

  select owner_id into v_a from public.crm_leads
   where project_id = v_project and owner_id is not null limit 1;
  select owner_id into v_b from public.crm_leads
   where project_id = v_project and owner_id is not null and owner_id <> v_a limit 1;
  select u.id into v_mgr from public.users u
    join public.projects p on p.id = v_project
   where u.department_id = p.lead_department_id and u.department_role = 'manager'
     and u.is_active limit 1;

  -- 1 · The owner sees their own leads.
  set local role cni_app;
  perform set_config('app.user_id', v_a::text, true);
  select * into ra from app.crm_my_day(v_project);
  reset role;
  if ra.open_total is null or ra.open_total = 0 then
    raise exception '136 · a salesperson with leads is told they hold none';
  end if;

  -- 2 · ⚠️ AND IT IS GENUINELY THEIRS. Two people holding leads on one project
  --     must not read the same totals — which is what a missing owner filter
  --     would produce, and it would look perfectly plausible.
  if v_b is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_b::text, true);
    select * into rb from app.crm_my_day(v_project);
    reset role;

    select count(*) into n from public.crm_leads
     where project_id = v_project and owner_id = v_a and stage not in ('won','lost');
    if ra.open_total <> n then
      raise exception '136 · person A is told % open leads, the table says %', ra.open_total, n;
    end if;

    select count(*) into n from public.crm_leads
     where project_id = v_project and owner_id = v_b and stage not in ('won','lost');
    if rb.open_total <> n then
      raise exception '136 · person B is told % open leads, the table says %', rb.open_total, n;
    end if;
  end if;

  -- 3 · ⚠️ A MANAGER SEES THEIR OWN, NOT THE TEAM'S. They run the rota and
  --     normally carry nothing, so this must come back near zero rather than
  --     quietly handing them the whole project through a page with no gate.
  if v_mgr is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_mgr::text, true);
    select * into rb from app.crm_my_day(v_project);
    reset role;

    select count(*) into n from public.crm_leads
     where project_id = v_project and owner_id = v_mgr and stage not in ('won','lost');
    if rb.open_total <> n then
      raise exception '136 · the manager is shown % leads but owns %', rb.open_total, n;
    end if;
  end if;

  -- 4 · ⚠️ NULL RESPONSE TIME SURVIVES. A coalesce to zero anywhere in the
  --     chain would tell somebody who has never rung anybody that they answer
  --     instantly, which is the exact bug Step 7b's panel was built to avoid.
  set local role cni_app;
  perform set_config('app.user_id', v_a::text, true);
  select count(*) into n from app.crm_my_day(v_project)
   where median_minutes is null;
  reset role;
  select count(*) into n from public.crm_leads
   where project_id = v_project and owner_id = v_a and first_contacted_at is not null;
  if n = 0 and ra.median_minutes is not null then
    raise exception '136 · somebody who has contacted nobody has a response time of %', ra.median_minutes;
  end if;

  raise notice '136 · each salesperson sees their own day, and their own response time';
end $$;
