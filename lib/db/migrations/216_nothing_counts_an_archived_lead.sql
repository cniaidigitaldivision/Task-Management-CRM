-- ============================================================================
-- 216 · NOTHING COUNTS AN ARCHIVED LEAD — THE DESK, THE REPORTS, THE ALERTS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"I just manage from the desk. Don't count them and don't
-- add any report on the basis of it… each report and everything on the basis of
-- that data, not the previous leads."*
--
-- 214 added the flag and 665 old leads were archived with it. A flag nothing
-- reads does nothing, and two kinds of reader have to learn it.
--
-- ── 1 · THE APP — 58 QUERIES IN SEVEN FILES ────────────────────────────────
-- Editing 58 queries by hand means the one that gets missed still shows them.
-- They all run as `cni_app` (withUser and withAppRole alike — the latter does not
-- bypass RLS), so ONE RESTRICTIVE policy covers every one of them, including
-- queries nobody has written yet.
--
-- ── 2 · THE DEFINERS — FOURTEEN THAT COUNT ─────────────────────────────────
-- The four reports, arrivals, attention, My Day, the due and neglect alerts,
-- the project counts, the roster, the client list and the rota. They run as the
-- table owner, which has BYPASSRLS — checked, not assumed — so no policy can
-- reach them. Each is REPRODUCED FROM ITS LIVE DEFINITION with exactly one
-- change, applied mechanically:
--
--     public.crm_leads l   ->   (select * from public.crm_leads where archived_at is null) l
--
-- Every one reads the table under the alias `l`, so the substitution keeps each
-- query's meaning — in a FROM, a LEFT JOIN and a correlated count alike — and
-- Postgres inlines the subquery, so the plan does not change. 20 reads in all.
--
-- ⚠️ NOT A HAND EDIT OF FOURTEEN FUNCTIONS. Typing them out from memory is how a
-- rule quietly disappears; this file was generated from pg_get_functiondef and
-- the self-check below refuses to commit if any of them still reads the raw
-- table.
--
-- ⚠️ AND AN ARCHIVED LEAD THAT WRITES TO US COMES BACK. A person messaging the
-- business is live again, whatever we decided about them in September — and a
-- reply recorded against a lead nobody can see is a reply nobody answers.
-- ============================================================================

-- ── 1 · The app never sees an archived lead ────────────────────────────────
drop policy if exists crm_leads_not_archived on public.crm_leads;
create policy crm_leads_not_archived on public.crm_leads
  as restrictive
  for select
  to cni_app
  using (archived_at is null);


-- ── 2 · An archived lead who writes to us is live again ────────────────────
create or replace function app.crm_unarchive_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  if new.direction = 'inbound' then
    update public.crm_leads
       set archived_at = null, archived_reason = null
     where id = new.lead_id and archived_at is not null;
  end if;
  return null;
end;
$fn$;

drop trigger if exists crm_messages_unarchive on public.crm_lead_messages;
create trigger crm_messages_unarchive
  after insert on public.crm_lead_messages
  for each row execute function app.crm_unarchive_on_reply();


-- ── 3 · The definers, each with one read narrowed ──────────────────────────

-- crm_report_ageing: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_report_ageing(p_project uuid)
 RETURNS TABLE(bucket text, sort_order integer, leads bigint, oldest_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  with scoped as (
    select (now()::date - (l.submitted_at at time zone 'Asia/Karachi')::date) as age_days
      from (select * from public.crm_leads where archived_at is null) l
     where l.project_id = p_project
       and app.crm_manages_project(p_project)
       and l.stage not in ('won', 'lost')
  ), bucketed as (
    select case
             when age_days <= 1  then 'Today or yesterday'
             when age_days <= 7  then 'This week'
             when age_days <= 30 then 'Up to a month'
             when age_days <= 60 then 'One to two months'
             when age_days <= 90 then 'Two to three months'
             else 'Over 90 days'
           end as bucket,
           case
             when age_days <= 1  then 1
             when age_days <= 7  then 2
             when age_days <= 30 then 3
             when age_days <= 60 then 4
             when age_days <= 90 then 5
             else 6
           end as sort_order,
           age_days
      from scoped
  )
  select b.bucket, b.sort_order, count(*), max(b.age_days)::integer
    from bucketed b
   group by b.bucket, b.sort_order
$function$;

-- crm_report_funnel: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_report_funnel(p_project uuid, p_from date, p_to date)
 RETURNS TABLE(stage text, leads bigint, share numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  with scoped as (
    select l.stage::text as stage
      from (select * from public.crm_leads where archived_at is null) l
     where l.project_id = p_project
       and app.crm_manages_project(p_project)
       and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ), total as (select count(*)::numeric as n from scoped)
  select s.stage, count(*),
         /* ⚠️ `nullif` ON THE DIVISOR. An empty period would divide by zero and
            the whole report would fail rather than say "nothing happened". */
         round(count(*) * 100.0 / nullif((select n from total), 0), 1)
    from scoped s
   group by s.stage
$function$;

-- crm_report_people: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_report_people(p_project uuid, p_from date, p_to date)
 RETURNS TABLE(person text, leads bigint, contacted bigint, won bigint, lost bigint, still_open bigint, median_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select u.full_name,
         count(*),
         count(*) filter (where l.first_contacted_at is not null),
         count(*) filter (where l.stage = 'won'),
         count(*) filter (where l.stage = 'lost'),
         count(*) filter (where l.stage not in ('won', 'lost')),
         percentile_cont(0.5) within group (
           order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0
         ) filter (where l.first_contacted_at is not null)
    from (select * from public.crm_leads where archived_at is null) l
    join public.users u on u.id = l.owner_id
   where l.project_id = p_project
     and app.crm_manages_project(p_project)
     and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
   group by u.full_name
$function$;

-- crm_report_sources: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_report_sources(p_project uuid, p_from date, p_to date)
 RETURNS TABLE(source text, leads bigint, contacted bigint, won bigint, lost bigint, win_rate numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select coalesce(f.name, 'Not recorded'),
         count(*),
         count(*) filter (where l.first_contacted_at is not null),
         count(*) filter (where l.stage = 'won'),
         count(*) filter (where l.stage = 'lost'),
         /* ⚠️ NULL, NOT ZERO, when nothing has closed. A rate of 0% reads as a
            fact about the campaign; null reads as "we cannot say yet", which is
            the truth while the pipeline is three weeks old. The builder renders
            the two differently. */
         case
           when count(*) filter (where l.stage in ('won', 'lost')) = 0 then null
           else round(count(*) filter (where l.stage = 'won') * 100.0
                      / count(*) filter (where l.stage in ('won', 'lost')), 1)
         end
    from (select * from public.crm_leads where archived_at is null) l
    left join public.crm_lead_forms f on f.id = l.form_id
   where l.project_id = p_project
     and app.crm_manages_project(p_project)
     and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
   group by coalesce(f.name, 'Not recorded')
$function$;

-- crm_lead_arrivals: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_lead_arrivals(p_project uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(on_date date, arrived integer, contacted integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  left join (select * from public.crm_leads where archived_at is null) l
    on (l.submitted_at at time zone 'Asia/Karachi')::date = days.d
   and l.project_id = p_project
  where app.crm_manages_project(p_project)
  group by days.d
  order by days.d
$function$;

-- crm_lead_attention: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_lead_attention(p_project uuid)
 RETURNS TABLE(overdue integer, due_today integer, unassigned integer, never_contacted integer, gone_quiet integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  from (select * from public.crm_leads where archived_at is null) l
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
$function$;

-- crm_my_day: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_my_day(p_project uuid)
 RETURNS TABLE(open_total integer, overdue integer, due_today integer, never_contacted integer, gone_quiet integer, won_total integer, median_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  from (select * from public.crm_leads where archived_at is null) l
  where l.project_id = p_project
    /* ⚠️ THEIRS, AND ONLY THEIRS. This is what removes the need for a manager
       gate — the function cannot disclose a colleague's workload because it
       never looks at one. */
    and l.owner_id = app.current_user_id()
$function$;

-- crm_notify_due_leads: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_notify_due_leads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  r        record;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
  n_sent   integer := 0;
  v_title  text;
begin
  for r in
    select l.owner_id,
           count(*) filter (
             where (l.next_action_at at time zone 'Asia/Karachi')::date < v_today
           ) as overdue,
           count(*) filter (
             where (l.next_action_at at time zone 'Asia/Karachi')::date = v_today
           ) as due_today
      from (select * from public.crm_leads where archived_at is null) l
      join public.users u on u.id = l.owner_id
     where l.owner_id is not null
       and l.next_action_at is not null
       and l.stage not in ('won', 'lost')
       and u.is_active
       and (l.next_action_at at time zone 'Asia/Karachi')::date <= v_today
     group by l.owner_id
  loop
    /* ⚠️ ALREADY TOLD THEM TODAY? The job runs hourly so that one missed firing
       does not cost a day; this is what stops it becoming an hourly nag. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.owner_id
         and n.kind = 'lead_due'
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    if not app.wants_in_app(r.owner_id, 'lead_due') then
      continue;
    end if;

    /* ⚠️ THE OVERDUE ONES ARE NAMED FIRST, because they are the ones that have
       already gone wrong. A single count of "23 leads" hides whether that is a
       normal Tuesday or three weeks of neglect. */
    v_title := case
      when r.overdue > 0 and r.due_today > 0 then
        r.overdue || ' overdue and ' || r.due_today || ' due today'
      when r.overdue > 0 then
        r.overdue || case when r.overdue = 1 then ' lead is overdue' else ' leads are overdue' end
      else
        r.due_today || case when r.due_today = 1 then ' lead needs you today' else ' leads need you today' end
    end;

    insert into public.notifications (user_id, kind, title, body, link_to)
    values (
      r.owner_id, 'lead_due', v_title,
      'Open the desk to see which, sorted by what is owed first.',
      /* ⚠️ No lead id — this is about several. The desk already sorts by next
         action, so it opens on exactly the right rows. */
      '/leads'
    );

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $function$;

-- crm_notify_neglect: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_notify_neglect(p_days integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  r       record;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  n_sent  integer := 0;
begin
  /* ⚠️ ONE PASS PER MANAGER PER PERSON THEY MANAGE. 123 looked up "the sales
     manager"; now every department that owns leads has its own, and a manager
     hears only about their own department's projects. */
  for r in
    select mgr.id as manager_id,
           l.owner_id,
           u.full_name,
           count(*) as stale
      from (select * from public.crm_leads where archived_at is null) l
      join public.projects p on p.id = l.project_id
      join public.users mgr on mgr.department_id = p.lead_department_id
                           and mgr.department_role = 'manager'
                           and mgr.is_active
      join public.users u on u.id = l.owner_id
     where l.owner_id is not null
       and l.owner_id <> mgr.id
       and l.stage not in ('won', 'lost')
       and u.is_active
       and not exists (
         select 1 from public.crm_lead_activity a
          where a.lead_id = l.id
            and a.kind <> 'imported'
            and a.occurred_at > now() - make_interval(days => p_days)
       )
     group by mgr.id, l.owner_id, u.full_name
  loop
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.manager_id
         and n.kind = 'lead_neglected'
         and n.entity_id = r.owner_id
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    if not app.wants_in_app(r.manager_id, 'lead_neglected') then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (
      r.manager_id, 'lead_neglected',
      r.stale || case when r.stale = 1 then ' lead of ' else ' leads of ' end
        || r.full_name || ' have gone quiet',
      'No call, message or note on them for ' || p_days || ' days.',
      '/leads', r.owner_id
    );

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $function$;

-- crm_project_options: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_project_options()
 RETURNS TABLE(id uuid, name text, code text, leads bigint, forms bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select p.id, p.name, p.code,
         (select count(*) from (select * from public.crm_leads where archived_at is null)      l where l.project_id = p.id),
         (select count(*) from public.crm_lead_forms f where f.project_id = p.id)
    from public.projects p
   where p.is_draft = false
     /* ⚠️ THE WHOLE SECURITY OF THIS FUNCTION. RLS is bypassed below, so the
        caller's right to these projects is checked here, once, against the same
        predicate migration 124 put on `crm_leads`. A caller whose department
        owns nothing gets an empty set — the same answer the table would have
        given, for a better reason. */
     and app.crm_in_project_department(p.id)
   order by 4 desc, p.name
$function$;

-- crm_project_roster: 4 reads narrowed
CREATE OR REPLACE FUNCTION app.crm_project_roster(p_project uuid)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, is_manager boolean, open_leads bigint, total_leads bigint, won_leads bigint, last_given timestamp with time zone, median_response_minutes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select u.id, u.full_name, u.avatar_url,
         u.department_role = 'manager',
         (select count(*) from (select * from public.crm_leads where archived_at is null) l
           where l.owner_id = u.id and l.project_id = p_project
             and l.stage not in ('won', 'lost')),
         (select count(*) from (select * from public.crm_leads where archived_at is null) l
           where l.owner_id = u.id and l.project_id = p_project),
         (select count(*) from (select * from public.crm_leads where archived_at is null) l
           where l.owner_id = u.id and l.project_id = p_project and l.stage = 'won'),
         (select max(a.occurred_at) from public.crm_lead_activity a
           where a.kind = 'assigned' and (a.detail->>'to')::uuid = u.id),
         (select percentile_cont(0.5) within group (
                   order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
            from (select * from public.crm_leads where archived_at is null) l
           where l.owner_id = u.id and l.project_id = p_project
             and l.first_contacted_at is not null)
    from public.users u
    join public.projects p on p.id = p_project
   where u.department_id = p.lead_department_id
     and u.is_active
     /* ⚠️ The guard stays INSIDE, because definer bypasses RLS: without it a
        salesperson could read colleagues' response times and win counts. */
     and app.crm_manages_project(p_project)
   order by u.department_role desc, u.full_name
$function$;

-- crm_client_list: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_client_list()
 RETURNS TABLE(id uuid, full_name text, phone_e164 text, email text, city text, first_lead_at timestamp with time zone, converted_at timestamp with time zone, lead_count bigint, won_count bigint, projects text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select c.id, c.full_name, c.phone_e164, c.email, c.city,
         c.first_lead_at, c.converted_at,
         count(l.id),
         count(l.id) filter (where l.stage = 'won'),
         array_agg(distinct p.name order by p.name)
    from public.crm_clients c
    join (select * from public.crm_leads where archived_at is null) l on l.client_id = c.id
    join public.projects p  on p.id = l.project_id
   where app.crm_manages_project(l.project_id)
      or (app.crm_in_project_department(l.project_id)
          and l.owner_id = app.current_user_id())
   group by c.id, c.full_name, c.phone_e164, c.email, c.city,
            c.first_lead_at, c.converted_at
   order by c.converted_at desc
$function$;

-- crm_eligible_owners: 1 read narrowed
CREATE OR REPLACE FUNCTION app.crm_eligible_owners(p_project uuid)
 RETURNS TABLE(user_id uuid, full_name text, eligible boolean, blocked_always boolean, why_not text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with people as (
    select
      u.id,
      u.full_name,
      u.is_active,
      u.department_role,
      u.crm_max_open_leads,
      (select count(*) from (select * from public.crm_leads where archived_at is null) l
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
$function$;

-- crm_lead_rota: 4 reads narrowed
CREATE OR REPLACE FUNCTION app.crm_lead_rota(p_project uuid)
 RETURNS TABLE(user_id uuid, full_name text, open_leads integer, weighted_load numeric, median_minutes numeric, at_work boolean, days_quiet integer, last_given_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    (select count(*)::int from (select * from public.crm_leads where archived_at is null) l
      where l.owner_id = c.id and l.project_id = p_project
        and l.stage not in ('won','lost')) as open_leads,
    coalesce((select sum(app.crm_stage_weight(l.stage)) from (select * from public.crm_leads where archived_at is null) l
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
       from (select * from public.crm_leads where archived_at is null) l where l.owner_id = c.id), 999) as days_quiet,
    (select max(a.assigned_at) from public.crm_lead_assignments a
      where a.to_user_id = c.id) as last_given_at
  from candidates c
  order by
    app.crm_is_at_work(c.id) desc,
    coalesce((select sum(app.crm_stage_weight(l.stage)) from (select * from public.crm_leads where archived_at is null) l
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
$function$;

-- ============================================================================
-- SELF-CHECK — no definer still reads the raw table; the app cannot see an
-- archived lead; a count does not move when one is added
-- ============================================================================
do $chk$
declare
  v_leftover text;
  v_project uuid; v_owner uuid; v_lead uuid;
  n_before int; n_after int; n_seen int := -1; back boolean;
begin
  /* 1 · ⚠️ THE MECHANICAL EDIT MISSED NOTHING. Any counting definer that still
     names the raw table under `l` would go on counting the archive. */
  select string_agg(p.proname, ', ') into v_leftover
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['crm_report_ageing', 'crm_report_funnel', 'crm_report_people', 'crm_report_sources', 'crm_lead_arrivals', 'crm_lead_attention', 'crm_my_day', 'crm_notify_due_leads', 'crm_notify_neglect', 'crm_project_options', 'crm_project_roster', 'crm_client_list', 'crm_eligible_owners', 'crm_lead_rota']::text[])
     and pg_get_functiondef(p.oid) ~ 'public\.crm_leads\s+l\M';
  if v_leftover is not null then
    raise exception '216 · still reading archived leads: %', v_leftover;
  end if;

  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;

  begin
    select o.leads into n_before from app.crm_project_options() o where o.id = v_project;

    insert into public.crm_leads
      (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data, archived_at, archived_reason)
    values (v_project, 'manual', 'SELFCHECK-216', 'new', now(), v_owner, true, now(), 'selfcheck')
    returning id into v_lead;

    /* 2 · A report-side count does not move. */
    select o.leads into n_after from app.crm_project_options() o where o.id = v_project;

    /* 3 · The app, as the salesperson who OWNS it, still cannot see it. */
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    select count(*)::int into n_seen from public.crm_leads where id = v_lead;
    reset role;

    /* 4 · A reply brings it back. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at)
    values (v_lead, 'whatsapp', 'inbound', 'text', 'Still interested', now());
    select archived_at is null into back from public.crm_leads where id = v_lead;

    raise exception using errcode = 'P0216', message = '216 rollback';
  exception when sqlstate 'P0216' then
    null;
  end;

  if n_after is distinct from n_before then
    raise exception '216 · an archived lead was counted (% -> %)', n_before, n_after;
  end if;
  if n_seen <> 0 then
    raise exception '216 · the app could see an archived lead';
  end if;
  if not back then
    raise exception '216 · a reply from an archived lead did not bring it back';
  end if;

  raise notice '216 · archived leads leave every count, report and the desk; a reply brings one back';
end $chk$;
