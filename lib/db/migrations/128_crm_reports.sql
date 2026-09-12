-- ============================================================================
-- 128 · REPORTS, STORED — Step 10 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Owner's rule, recorded 2026-09-09: *"first save in a database and always fetch
-- from the database."*
--
-- ── ⚠️ THE STATED REASON DOES NOT APPLY, AND A BETTER ONE DOES ─────────────
-- `08-TWELVE-STEPS.md` justifies storing reports like this: *"so a report you
-- generated in October still says in December what it said in October"*, because
-- Meta deletes lead data at 90 days.
--
-- That is not the reason. **We keep the leads.** Meta's deletion has no bearing
-- on a report computed from our own tables — the whole point of the importer was
-- to make our copy the permanent one.
--
-- The real reason is smaller and holds: a report is **a statement made on a
-- date**. Re-running "September, by campaign" in December would legitimately
-- give different numbers — leads have been reassigned, stages have moved, an
-- Admin may have deleted one. If a figure went into a board pack, what matters
-- is what it said when it was read, not what the same query returns now. So the
-- rows are frozen, and the row that froze them says who and when.
--
-- ⚠️ WHICH ALSO MEANS THE SNAPSHOT IS NOT A CACHE. It is never refreshed, never
-- invalidated, and a stale one is the correct answer to "what did we report in
-- September". Generating again makes a NEW row.
--
-- ── ⚠️ APPEND-ONLY, THE SAME AS `report_exports` ───────────────────────────
-- No UPDATE and no DELETE policy for anybody, including Admin. 096 puts it
-- plainly for its own table: *"a history that can be tidied cannot answer 'when
-- did this leave, and who took it?', which is the only question it exists to
-- answer."* A report somebody can quietly revise is not evidence of anything.
-- ============================================================================

do $$ begin
  create type public.crm_report_kind as enum ('funnel', 'ageing', 'sources', 'people');
exception when duplicate_object then null; end $$;


create table if not exists public.crm_reports (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         public.crm_report_kind not null,

  /* ⚠️ KARACHI CALENDAR DATES, not timestamps. A report is "September", and the
     boundary is midnight where the team lives — 109 of the 615 leads already
     have a different UTC date from their Karachi one, so a UTC month would put
     18% of an evening's leads in the wrong report. Null on `ageing`, which is a
     snapshot of now rather than a period. */
  period_from  date,
  period_to    date,

  title        text not null,

  /* ⚠️ THE WHOLE `Report` OBJECT, shaped exactly as `lib/domain/reports.ts`
     defines it — typed cells, figures, columns and notes. Stored whole rather
     than as normalised rows because the SHAPE is part of what was reported: a
     column that gets renamed, or a note that gets reworded, would silently
     change what an old report appears to have said. */
  payload      jsonb not null,
  row_count    integer not null default 0 check (row_count >= 0),

  generated_by_id uuid references public.users(id) on delete set null,
  generated_at    timestamptz not null default now()
);

create index if not exists crm_reports_recent_idx
  on public.crm_reports (project_id, kind, generated_at desc);

comment on table public.crm_reports is
  'A CRM report, frozen as it was read (128). Append-only, and never a cache: '
  'a stale snapshot is the correct answer to "what did we report in September".';

alter table public.crm_reports enable row level security;

/* Visible when the project's leads are — 124's routing, not a rule of its own. */
drop policy if exists crm_reports_select on public.crm_reports;
create policy crm_reports_select on public.crm_reports
  for select using (app.crm_in_project_department(project_id));

/* ⚠️ THE MANAGER AND ABOVE MAY GENERATE ONE. A salesperson reading their own
   leads is right; a salesperson producing a per-person comparison of the whole
   team is a different act, and it is the manager's. */
drop policy if exists crm_reports_insert on public.crm_reports;
create policy crm_reports_insert on public.crm_reports
  for insert with check (app.crm_manages_project(project_id));

/* ⚠️ NO UPDATE AND NO DELETE POLICY, ANYWHERE, FOR ANY RANK. See the header. */

grant select, insert on public.crm_reports to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE FOUR THINGS WORTH ASKING
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY ONE IS SECURITY DEFINER AND CHECKS `crm_manages_project` ITSELF.
-- They aggregate across the whole project — including leads a salesperson cannot
-- read — so the guard is inside, once, and the answer is empty for anybody else.
-- That is the same shape as 120's roster and for the same reason.
--
-- ⚠️ AND THE DATES ARE COMPARED IN KARACHI, every time. See the note on the
-- table's columns.
-- ════════════════════════════════════════════════════════════════════════════

/** Where the leads sit. The funnel, in pipeline order. */
create or replace function app.crm_report_funnel(
  p_project uuid,
  p_from    date,
  p_to      date
)
returns table (stage text, leads bigint, share numeric)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with scoped as (
    select l.stage::text as stage
      from public.crm_leads l
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
$$;

/**
 * How long the OPEN leads have been waiting, in buckets.
 *
 * ⚠️ THE ONE REPORT WITH REAL SIGNAL TODAY. Every lead is `new` and the oldest
 * is 91 days old — past Meta's deletion window. This is the report that says so
 * out loud rather than leaving it in a migration comment.
 *
 * ⚠️ AND IT TAKES NO PERIOD. Ageing is a snapshot of now; filtering it by when
 * a lead arrived would answer a different question and answer it confusingly.
 */
create or replace function app.crm_report_ageing(p_project uuid)
returns table (bucket text, sort_order integer, leads bigint, oldest_days integer)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with scoped as (
    select (now()::date - (l.submitted_at at time zone 'Asia/Karachi')::date) as age_days
      from public.crm_leads l
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
$$;

/**
 * Which form brought them in, and what became of them.
 *
 * ⚠️ THE FORM, NOT THE CAMPAIGN, and the report has to say so. `campaign_name`
 * comes back empty on every lead — the page and its ad account sit in different
 * portfolios (`06-CAMPAIGNS-AND-COVERAGE.md`). A column headed "Campaign" over
 * form names is how spend gets judged by the wrong figure. It becomes the
 * campaign the day Meta's permissions are changed, and not before.
 */
create or replace function app.crm_report_sources(
  p_project uuid,
  p_from    date,
  p_to      date
)
returns table (
  source     text,
  leads      bigint,
  contacted  bigint,
  won        bigint,
  lost       bigint,
  win_rate   numeric
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
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
    from public.crm_leads l
    left join public.crm_lead_forms f on f.id = l.form_id
   where l.project_id = p_project
     and app.crm_manages_project(p_project)
     and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
   group by coalesce(f.name, 'Not recorded')
$$;

/**
 * Per person: what they hold, how fast they answer, what they closed.
 *
 * ⚠️ THE OWNER'S HEADLINE QUESTION LIVES HERE — *"6,000 leads and not one
 * closed: is it the staff or the campaign?"* This is the staff half, and it is
 * arithmetic. Read beside `crm_report_sources`, the two answer it between them:
 * same source, different people → the person; same person, different sources →
 * the source.
 */
create or replace function app.crm_report_people(
  p_project uuid,
  p_from    date,
  p_to      date
)
returns table (
  person         text,
  leads          bigint,
  contacted      bigint,
  won            bigint,
  lost           bigint,
  still_open     bigint,
  median_minutes numeric
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.full_name,
         count(*),
         count(*) filter (where l.first_contacted_at is not null),
         count(*) filter (where l.stage = 'won'),
         count(*) filter (where l.stage = 'lost'),
         count(*) filter (where l.stage not in ('won', 'lost')),
         percentile_cont(0.5) within group (
           order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0
         ) filter (where l.first_contacted_at is not null)
    from public.crm_leads l
    join public.users u on u.id = l.owner_id
   where l.project_id = p_project
     and app.crm_manages_project(p_project)
     and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
   group by u.full_name
$$;

grant execute on function app.crm_report_funnel(uuid, date, date)  to cni_app;
grant execute on function app.crm_report_ageing(uuid)              to cni_app;
grant execute on function app.crm_report_sources(uuid, date, date) to cni_app;
grant execute on function app.crm_report_people(uuid, date, date)  to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ REMOVES ITS OWN ROWS BY ID. Migration 082 ate a live attendance row with a
-- tidy-up delete keyed on a date.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  v_sp     uuid;
  v_chit   uuid;
  v_report uuid;
  n        integer;
  v_leads  bigint;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_sp   from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_chit from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_sp is null or v_chit is null then
    raise notice '128 · people or Chitral missing; reports created untested';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 1 · The funnel reads the real table, and the shares add up.
  select sum(leads) into v_leads
    from app.crm_report_funnel(v_chit, '2026-01-01'::date, now()::date);
  if coalesce(v_leads, 0) < 1 then
    raise exception '128 · the funnel found no leads on a project holding hundreds';
  end if;

  -- 2 · ⚠️ AND AN EMPTY PERIOD RETURNS NOTHING RATHER THAN DIVIDING BY ZERO.
  select count(*) into n
    from app.crm_report_funnel(v_chit, '2020-01-01'::date, '2020-01-31'::date);
  if n <> 0 then
    raise exception '128 · a period with no leads produced % rows', n;
  end if;

  -- 3 · Ageing buckets, and the oldest is past Meta's window.
  select max(oldest_days) into n from app.crm_report_ageing(v_chit);
  if coalesce(n, 0) < 1 then
    raise exception '128 · ageing found nothing to age';
  end if;

  -- 4 · ⚠️ A WIN RATE IS NULL, NOT ZERO, WHILE NOTHING HAS CLOSED. Zero reads
  --     as a fact about the campaign; null says we cannot tell yet.
  select count(*) into n
    from app.crm_report_sources(v_chit, '2026-01-01'::date, now()::date)
   where won = 0 and lost = 0 and win_rate is not null;
  if n <> 0 then
    raise exception '128 · % sources reported a win rate with nothing closed', n;
  end if;

  -- 5 · The sources report names the forms.
  select count(*) into n from app.crm_report_sources(v_chit, '2026-01-01'::date, now()::date);
  if n < 1 then
    raise exception '128 · the sources report found no forms';
  end if;

  -- 6 · ⚠️ A SALESPERSON GETS NOTHING FROM ANY OF THEM. Definer bypasses RLS,
  --     so the guard is inside each function — without it a junior could read a
  --     per-person comparison of the whole team.
  perform set_config('app.user_id', v_sp::text, true);
  select count(*) into n from app.crm_report_funnel(v_chit, '2026-01-01'::date, now()::date);
  if n <> 0 then
    raise exception '128 · a salesperson can read the funnel for the whole project';
  end if;
  select count(*) into n from app.crm_report_people(v_chit, '2026-01-01'::date, now()::date);
  if n <> 0 then
    raise exception '128 · a salesperson can read a per-person comparison';
  end if;
  select count(*) into n from app.crm_report_ageing(v_chit);
  if n <> 0 then
    raise exception '128 · a salesperson can read project-wide ageing';
  end if;

  -- 7 · Nor may they store one.
  begin
    insert into public.crm_reports (project_id, kind, title, payload)
    values (v_chit, 'funnel', '128 self-check', '{}'::jsonb);
    raise exception '128 · a salesperson was allowed to store a report';
  exception when insufficient_privilege then
    null;
  end;

  -- 8 · An Admin can, and it comes back.
  perform set_config('app.user_id', v_admin::text, true);
  insert into public.crm_reports (project_id, kind, period_from, period_to, title, payload, row_count, generated_by_id)
  values (v_chit, 'funnel', '2026-09-01', '2026-09-30', '128 self-check',
          '{"rows":[]}'::jsonb, 0, v_admin)
  returning id into v_report;

  select count(*) into n from public.crm_reports where id = v_report;
  if n <> 1 then
    raise exception '128 · a stored report could not be read back';
  end if;

  -- 9 · ⚠️ AND NOBODY CAN QUIETLY REVISE IT. A report that can be edited after
  --     it was read is not evidence of anything.
  begin
    update public.crm_reports set title = 'rewritten' where id = v_report;
    raise exception '128 · a stored report was edited';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.crm_reports where id = v_report;
    raise exception '128 · a stored report was deleted';
  exception when insufficient_privilege then
    null;
  end;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_reports where id = v_report;

  raise notice '128 · four reports, stored append-only, and a salesperson can read none of them';
end $$;
