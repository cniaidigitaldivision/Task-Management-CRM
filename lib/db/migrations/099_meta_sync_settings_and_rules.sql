-- ============================================================================
-- 099 · SYNC SETTINGS AND SYNC RULES — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- Behind the Studio's Settings & Sync tab. Owner: *"Make it all work according
-- to my own system and our live data."*
--
-- Two tables. `meta_sync_settings` is the Settings tab's switches, one row per
-- project. `meta_sync_rules` is the Sync Schedule Manager: named rules saying
-- WHEN a project pulls and WHAT it pulls.
--
-- ── ⚠️ RULES ARE ADDITIVE — A PROJECT WITH NONE KEEPS TODAY'S BEHAVIOUR ─────
-- The standing instruction on this codebase is not to disturb a working thing,
-- and the two-hourly pull works: 407 metric rows and 50 posts, collected. So the
-- runner's contract is:
--
--     no active rules  → the default two-hourly pull, exactly as now
--     active rules     → only the rules that are due, scoped to their categories
--
-- A project cannot be made WORSE off by this migration, because a project with
-- no rules is every project the moment this commits.
--
-- ── ⚠️ `auto_sync_enabled = false` IS A REAL OFF SWITCH, AND IT IS DANGEROUS ─
-- It stops collection. Meta serves ~30 days and no more, so a project switched
-- off for five weeks has a hole in its history that CANNOT be backfilled — the
-- data is gone from Meta by then. The column exists because the reference asks
-- for the switch and an admin may genuinely need it; the UI says this in as many
-- words next to the toggle, and `paused_at` records when it happened so the page
-- can say how much history is at risk.
-- ============================================================================

create table if not exists public.meta_sync_settings (
  project_id          uuid primary key references public.projects(id) on delete cascade,

  auto_sync_enabled   boolean not null default true,
  -- ⚠️ NOT NULL WITH A DEFAULT MATCHING vercel.json's `0 */2 * * *`. A null here
  -- would have to mean "the default", and then two places would define the
  -- default and eventually disagree.
  interval_hours      integer not null default 2 check (interval_hours in (1, 2, 4, 6, 12, 24)),

  -- Kept for as long as the division wants it. ⚠️ NOTHING DELETES ON THIS YET:
  -- it records the intention, and the UI says so rather than implying a sweeper
  -- that does not exist. A retention setting that silently did nothing would be
  -- the worst of the three options; one that silently DID delete client history
  -- would be worse still.
  retention_months    integer not null default 36 check (retention_months between 6 and 120),

  paused_at           timestamptz,
  paused_by_id        uuid references public.users(id) on delete set null,

  updated_at          timestamptz not null default now(),
  updated_by_id       uuid references public.users(id) on delete set null,

  -- The pause pair travels together or not at all, like `meta_accounts`' error.
  constraint meta_sync_settings_pause_pair check (
    (auto_sync_enabled and paused_at is null) or (not auto_sync_enabled)
  )
);

comment on table public.meta_sync_settings is
  'Per-project Meta sync switches (099). A project with no row uses the '
  'defaults, which match vercel.json''s two-hourly cron.';


-- ════════════════════════════════════════════════════════════════════════════
-- SYNC RULES
-- ----------------------------------------------------------------------------
-- ⚠️ `categories` MAPS ONTO REAL BRANCHES OF `runMetaSync`, not onto wishes.
-- `lib/meta/sync.ts` already collects three separable things per account —
-- daily insight series, posts with their metrics, and the profile snapshot — so
-- a rule scoping to one of them genuinely pulls less. A category naming
-- something the runner cannot scope would be a checkbox that does nothing.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.meta_sync_rules (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,

  name            text not null check (length(trim(name)) between 2 and 60),
  description     text not null default '',

  -- Which platforms this rule covers. Empty means every linked platform.
  platforms       text[] not null default '{}',

  categories      text[] not null default '{metrics,posts,profile}',

  frequency       text not null check (frequency in ('hourly', 'every_6h', 'every_12h', 'daily', 'weekly')),
  -- ⚠️ A LOCAL CLOCK TIME, AND THE ZONE IS STORED BESIDE IT. Every date boundary
  -- in this system is Asia/Karachi; the reference's own drawer has a timezone
  -- field, and a bare `time` column would be read in whatever zone the server
  -- happens to run in — five hours out, which has already made a correct answer
  -- look wrong once.
  run_at          time not null default '02:00',
  timezone        text not null default 'Asia/Karachi',
  -- For 'weekly'. 1 = Monday, ISO.
  run_on_weekday  integer check (run_on_weekday between 1 and 7),

  retry_minutes   integer not null default 15 check (retry_minutes in (5, 15, 30, 60)),
  max_retries     integer not null default 3 check (max_retries between 0 and 10),

  is_active       boolean not null default true,

  next_run_at     timestamptz not null default now(),
  last_run_at     timestamptz,
  last_outcome    text check (last_outcome in ('ok', 'failed')),
  last_error      text,
  run_count       integer not null default 0 check (run_count >= 0),
  failure_count   integer not null default 0 check (failure_count >= 0),

  created_at      timestamptz not null default now(),
  created_by_id   uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now(),

  -- Two rules of the same name on one project is a double-click.
  constraint meta_sync_rules_name_unique unique (project_id, name),

  -- A weekly rule needs a weekday; nothing else may carry one.
  constraint meta_sync_rules_weekday check (
    (frequency = 'weekly' and run_on_weekday is not null) or
    (frequency <> 'weekly' and run_on_weekday is null)
  ),

  -- ⚠️ A RULE THAT PULLS NOTHING IS A RULE THAT LIES. It would appear in the
  -- table, report "Successful" forever and collect nothing at all.
  constraint meta_sync_rules_has_category check (cardinality(categories) > 0),

  -- A failure count can never exceed the runs it is counted from.
  constraint meta_sync_rules_counts check (failure_count <= run_count)
);

create index if not exists meta_sync_rules_project_idx on public.meta_sync_rules (project_id);
create index if not exists meta_sync_rules_due_idx on public.meta_sync_rules (next_run_at) where is_active;

comment on table public.meta_sync_rules is
  'Named Meta sync schedules (099). A project with no active rule keeps the '
  'default two-hourly pull — see the header.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE CRON'S READER AND WRITER
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER, BECAUSE RLS FAILS CLOSED FOR A CRON. A cron has no
-- session, `app.current_user_id()` is NULL, every policy evaluates false, and
-- the read returns ZERO ROWS WITH NO ERROR — so the job reports a clean success
-- having done nothing. That has now happened three times on this feature (094,
-- 095, 097 all exist for it). Never widen a policy to fix it.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.meta_sync_rules_due(p_now timestamptz)
returns table (
  rule_id      uuid,
  project_id   uuid,
  project_name text,
  name         text,
  platforms    text[],
  categories   text[],
  frequency    text,
  max_retries  integer
)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select r.id, r.project_id, p.name, r.name, r.platforms, r.categories,
         r.frequency, r.max_retries
    from public.meta_sync_rules r
    join public.projects p on p.id = r.project_id
    -- ⚠️ THE PROJECT'S OWN OFF SWITCH WINS OVER ITS RULES. Turning auto-sync off
    -- must stop everything, not merely stop the default pull while five named
    -- rules carry on collecting — which is exactly what somebody switching it
    -- off is trying to prevent.
    left join public.meta_sync_settings s on s.project_id = r.project_id
   where r.is_active
     and r.next_run_at <= p_now
     and coalesce(s.auto_sync_enabled, true)
   order by r.next_run_at
$$;

comment on function app.meta_sync_rules_due(timestamptz) is
  'Sync rules due to run (099). SECURITY DEFINER: a cron has no session and RLS '
  'would silently return nothing.';


-- Which projects have NO active rule, and so keep the default pull.
create or replace function app.meta_projects_on_default_sync()
returns table (project_id uuid)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select distinct a.project_id
    from public.meta_accounts a
    left join public.meta_sync_settings s on s.project_id = a.project_id
   where a.is_active
     and coalesce(s.auto_sync_enabled, true)
     and not exists (
       select 1 from public.meta_sync_rules r
        where r.project_id = a.project_id and r.is_active
     )
$$;


create or replace function app.record_rule_run(
  p_rule    uuid,
  p_next    timestamptz,
  p_outcome text,
  p_error   text
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  -- ⚠️ THE DUE TIME ADVANCES EVEN ON FAILURE. If a failure left `next_run_at` in
  -- the past, every subsequent cron tick would retry the same broken rule
  -- forever. The error is recorded and the rule tries again at its next natural
  -- time; `retry_minutes` is the UI's stated intent for a finer retry and the
  -- page says plainly that the two-hourly cron is the real floor.
  update public.meta_sync_rules
     set last_run_at   = now(),
         next_run_at   = p_next,
         last_outcome  = p_outcome,
         last_error    = p_error,
         run_count     = run_count + 1,
         failure_count = failure_count + case when p_outcome = 'failed' then 1 else 0 end,
         updated_at    = now()
   where id = p_rule;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- ⚠️ VISIBILITY DELEGATES TO `app.project_is_visible` rather than being
-- reimplemented — a second implementation of that rule is how two screens come
-- to disagree about who may see a client's data.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.meta_sync_settings enable row level security;
alter table public.meta_sync_rules    enable row level security;

drop policy if exists meta_sync_settings_select on public.meta_sync_settings;
create policy meta_sync_settings_select on public.meta_sync_settings
  for select using (app.project_is_visible(project_id));

-- ⚠️ ADMIN ONLY. Switching collection off loses history that cannot be
-- recovered, because Meta will not serve it again after ~30 days. That is an
-- administrative act, not a coordinator's.
drop policy if exists meta_sync_settings_write on public.meta_sync_settings;
create policy meta_sync_settings_write on public.meta_sync_settings
  for all
  using      (app.project_is_visible(project_id) and app.acting_at_least('admin'::public.user_role))
  with check (app.project_is_visible(project_id) and app.acting_at_least('admin'::public.user_role));

drop policy if exists meta_sync_rules_select on public.meta_sync_rules;
create policy meta_sync_rules_select on public.meta_sync_rules
  for select using (app.project_is_visible(project_id));

-- A rule only ever narrows or reschedules collection, so a Coordinator may keep
-- them. It cannot switch collection off — that is the settings row above.
drop policy if exists meta_sync_rules_write on public.meta_sync_rules;
create policy meta_sync_rules_write on public.meta_sync_rules
  for all
  using      (app.project_is_visible(project_id)
              and app.acting_at_least('team_coordinator'::public.user_role))
  with check (app.project_is_visible(project_id)
              and app.acting_at_least('team_coordinator'::public.user_role));

grant select on public.meta_sync_settings, public.meta_sync_rules to cni_app;
grant insert, update, delete on public.meta_sync_settings to cni_app;
grant insert, update, delete on public.meta_sync_rules to cni_app;
grant execute on function app.meta_sync_rules_due(timestamptz)                       to cni_app;
grant execute on function app.meta_projects_on_default_sync()                        to cni_app;
grant execute on function app.record_rule_run(uuid, timestamptz, text, text)         to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ TOUCHES NO LIVE ROW — it creates its own project and removes exactly that.
-- Migration 082's self-check borrowed a real person and cleaned up with a DELETE
-- keyed on TODAY's date, which would have destroyed a genuine attendance row.
--
-- ⚠️ AND THE POLICY ASSERTIONS RUN AS `cni_app`. A migration executes as the
-- schema owner and BYPASSES RLS, which is how 094's self-check passed while
-- proving nothing.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_rule    uuid;
  v_before  bigint;
  v_after   bigint;
  n         integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;
  if v_admin is null then
    raise notice '099 · no admin row; the tables are in place, self-check skipped';
    return;
  end if;

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('099 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  -- 1 · A rule that collects nothing cannot be stored. It would sit in the table
  --     reporting "Successful" forever while pulling nothing at all.
  begin
    insert into public.meta_sync_rules (project_id, name, frequency, categories, created_by_id)
    values (v_project, '099 empty', 'daily', '{}', v_admin);
    raise exception '099 · a rule with no categories was accepted — it would collect nothing';
  exception when check_violation then
    null;
  end;

  -- 2 · A weekly rule must name a weekday, and a daily one must not.
  begin
    insert into public.meta_sync_rules (project_id, name, frequency, created_by_id)
    values (v_project, '099 weekly', 'weekly', v_admin);
    raise exception '099 · a weekly rule was stored with no weekday';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.meta_sync_rules (project_id, name, frequency, run_on_weekday, created_by_id)
    values (v_project, '099 daily', 'daily', 3, v_admin);
    raise exception '099 · a daily rule was stored carrying a weekday';
  exception when check_violation then
    null;
  end;

  -- 3 · A real rule, due an hour ago.
  insert into public.meta_sync_rules
    (project_id, name, frequency, next_run_at, created_by_id)
  values (v_project, '099 hourly', 'hourly', now() - interval '1 hour', v_admin)
  returning id into v_rule;

  -- ── Everything below runs with NO SESSION, exactly as the cron does ──────
  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 4 · ⚠️ THE ASSERTION THAT MATTERS. A plain select under RLS with no session
  --     returns nothing; the reader must return the row anyway.
  select count(*) into n from public.meta_sync_rules where id = v_rule;
  if n <> 0 then
    raise exception '099 · RLS let a session-less caller read a rule directly — the policy is too open';
  end if;

  select count(*) into n from app.meta_sync_rules_due(now()) where rule_id = v_rule;
  if n <> 1 then
    raise exception '099 · the reader returned % rows for a due rule with no session; expected 1', n;
  end if;

  -- 5 · A rule not yet due is not returned.
  select count(*) into n from app.meta_sync_rules_due(now() - interval '2 hours')
   where rule_id = v_rule;
  if n <> 0 then
    raise exception '099 · a rule due an hour ago was returned for two hours ago';
  end if;

  reset role;

  -- 6 · ⚠️ THE PROJECT'S OFF SWITCH BEATS ITS RULES. Somebody switching
  --     auto-sync off is trying to stop collection, not to stop the default pull
  --     while five named rules carry on regardless.
  insert into public.meta_sync_settings (project_id, auto_sync_enabled, paused_at, paused_by_id)
  values (v_project, false, now(), v_admin);

  set local role cni_app;
  select count(*) into n from app.meta_sync_rules_due(now()) where rule_id = v_rule;
  if n <> 0 then
    raise exception '099 · a rule ran on a project whose auto-sync is switched off';
  end if;
  reset role;

  -- 7 · The pause pair cannot be half-set.
  begin
    update public.meta_sync_settings set auto_sync_enabled = true where project_id = v_project;
    raise exception '099 · auto-sync was re-enabled while paused_at was still set';
  exception when check_violation then
    null;
  end;

  -- 8 · The outcome writer moves the counters, and a failure counts once.
  perform app.record_rule_run(v_rule, now() + interval '1 hour', 'failed', 'self-check');
  perform app.record_rule_run(v_rule, now() + interval '2 hours', 'ok', null);
  select run_count into n from public.meta_sync_rules where id = v_rule;
  if n <> 2 then
    raise exception '099 · run_count is % after two runs, expected 2', n;
  end if;
  select failure_count into n from public.meta_sync_rules where id = v_rule;
  if n <> 1 then
    raise exception '099 · failure_count is % after one failure, expected 1', n;
  end if;

  -- 9 · The cascade takes the rules and settings with the project.
  delete from public.projects where id = v_project;
  if exists (select 1 from public.meta_sync_rules where id = v_rule) then
    raise exception '099 · a sync rule outlived its project';
  end if;
  if exists (select 1 from public.meta_sync_settings where project_id = v_project) then
    raise exception '099 · a settings row outlived its project';
  end if;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '099 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '099 · sync settings and rules are in place';
end $$;
