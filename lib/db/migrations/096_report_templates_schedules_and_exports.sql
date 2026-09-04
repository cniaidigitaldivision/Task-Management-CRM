-- ============================================================================
-- 096 · REPORT TEMPLATES, SCHEDULES AND EXPORT HISTORY — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- Behind the Studio's Reports & Exports tab. Owner: *"everything should be
-- working and live data will be added. Put everything in logically and make it
-- work."*
--
-- ── ⚠️ A TEMPLATE IS A PRESET OVER MACHINERY THAT ALREADY EXISTS ────────────
-- It does NOT describe a document layout. `lib/pdf/report-poster.ts` draws the
-- owner's four reference layouts at FIXED geometry — panels sit at measured
-- coordinates, because that is what took days to get right ("I told you that I
-- want this template of the PDF"). Nothing here reflows it.
--
-- What a template actually carries is: which report KIND to run, which ENGINE
-- produces the file, and what to call it. `engine` is the load-bearing column —
-- the server action dispatches on it, so every template in this table maps to a
-- generator that exists TODAY and returns a real file. There is no row here
-- whose button does nothing.
--
-- ── ⚠️ NINE BUILT-INS, NOT THE REFERENCE'S TWENTY-FOUR ──────────────────────
-- The reference card reads "Total Templates 24". Nine engines exist. Seeding
-- fifteen more rows would put fifteen buttons on the page that produce nothing,
-- and "Total Templates" would then be counting the padding. The figure on the
-- card is a count of this table, so it reads 9 and will read more when more
-- generators are written.
--
-- ── ⚠️ NO `sections` COLUMN, AND THAT IS THE HONEST ANSWER ──────────────────
-- The reference's detail drawer shows "Sections Included" as ticked checkboxes,
-- which implies choosing them. They cannot be chosen: see the fixed geometry
-- above. Storing a section list would be storing a preference nothing reads.
-- The drawer therefore DESCRIBES what a kind's layout contains — derived in
-- `lib/domain/report-templates.ts` from the layout as built — which is the fact
-- somebody actually needs when picking between two templates.
-- ============================================================================

create table if not exists public.report_templates (
  id            uuid primary key default gen_random_uuid(),

  -- Stable key for the built-ins, so a later migration can amend one by name.
  -- Null for anything a person creates: two people may both want "Client Recap".
  slug          text unique,

  name          text not null check (length(trim(name)) between 2 and 80),
  description   text not null default '',

  category      text not null
                  check (category in ('performance','content','delivery','audience','executive','data')),

  -- ⚠️ THE COLUMN THAT MAKES THE BUTTON WORK. `app/actions/report-templates.ts`
  -- switches on this; an unknown value is refused rather than silently ignored,
  -- so a template can never be saved pointing at a generator that isn't there.
  engine        text not null
                  check (engine in (
                    'project_report',    -- the drawn PDF, lib/pdf/report-poster.ts
                    'tasks_csv',         -- exportTasksAction
                    'workload_csv',      -- exportWorkloadAction
                    'meta_metrics_csv',  -- the daily Meta series
                    'meta_posts_csv'     -- posts with their metrics
                  )),

  -- Only the PDF engine has periods; a CSV engine covers the chosen range. NULL
  -- means "whatever range the page is showing", which is why it is nullable
  -- rather than defaulted to 'month'.
  kind          text check (kind in ('today','yesterday','week','month','year')),

  -- ⚠️ TWO FORMATS, NOT FIVE. The reference draws PDF · Excel · PPT · CSV ·
  -- Google Slides. This system writes PDF (pdf-lib) and CSV (lib/domain/csv.ts)
  -- and has no writer for the other three. The check constraint is the reason a
  -- future 'xlsx' cannot be seeded before something can produce one.
  format        text not null check (format in ('pdf','csv')),

  is_builtin    boolean not null default false,
  created_by_id uuid references public.users(id) on delete set null,

  -- Maintained by app.record_template_use — see the note on that function.
  usage_count   integer not null default 0 check (usage_count >= 0),
  last_used_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A built-in is seeded by a migration and has no author; a custom one always
  -- has one. Enforcing the pair stops a custom row losing its owner and
  -- becoming un-editable by anybody.
  constraint report_templates_builtin_author check (
    (is_builtin and slug is not null) or (not is_builtin and created_by_id is not null)
  ),

  -- The PDF engine needs a period; a CSV engine must not pretend to have one.
  constraint report_templates_kind_matches_engine check (
    (engine = 'project_report' and kind is not null) or
    (engine <> 'project_report' and kind is null)
  )
);

create index if not exists report_templates_category_idx on public.report_templates (category);
create index if not exists report_templates_usage_idx    on public.report_templates (usage_count desc);

comment on table public.report_templates is
  'Named presets over the existing report generators (096). `engine` decides '
  'which generator runs; every value maps to one that exists.';


-- ── Favourites are per person ───────────────────────────────────────────────
-- ⚠️ NOT a boolean on the template. The reference has a Favorites filter, and a
-- flag on the shared row would mean one person starring a template starred it
-- for the whole division.
create table if not exists public.report_template_favourites (
  template_id uuid not null references public.report_templates(id) on delete cascade,
  user_id     uuid not null references public.users(id)            on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (template_id, user_id)
);


-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULES
-- ----------------------------------------------------------------------------
-- ⚠️ A SCHEDULE FILES A REPORT; IT DOES NOT EMAIL ONE. There is no `recipients`
-- column, deliberately. Outbound mail is dead — the Resend domain has been
-- `status: failed` since it was added — so a recipients list would be collected,
-- stored, and never used, and the page would promise a delivery that silently
-- never happens. When mail works, a recipients column and a send step are a
-- small migration; a page that has been lying to its users for a month is not.
--
-- What this does do is real: the cron generates the report on its due date and
-- it appears in the project's report list, where the existing PDF route serves
-- it. The UI says exactly that.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.report_schedules (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id)          on delete cascade,
  template_id   uuid not null references public.report_templates(id)  on delete cascade,

  cadence       text not null check (cadence in ('daily','weekly','monthly')),

  -- ⚠️ A DATE, AND IT IS A KARACHI DATE. Every date boundary in this system is
  -- Asia/Karachi (UTC+5) — `current_date` on this server is a different day for
  -- five hours each evening, which has already made a correct answer look wrong
  -- once. The runner compares against the Karachi date, never `current_date`.
  next_run_on   date not null,
  last_run_at   timestamptz,
  last_error    text,

  is_active     boolean not null default true,
  created_by_id uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One live schedule per template per project. A second identical one is a
  -- double-click, not an intention.
  constraint report_schedules_unique unique (project_id, template_id, cadence)
);

create index if not exists report_schedules_due_idx
  on public.report_schedules (next_run_on) where is_active;


-- ════════════════════════════════════════════════════════════════════════════
-- EXPORT HISTORY
-- ----------------------------------------------------------------------------
-- ⚠️ APPEND-ONLY, FOR THE SAME REASON `app/actions/export.ts` AUDITS EVERY CSV:
-- once a file is in somebody's Downloads folder every access control in this
-- system stops applying to it. So there is no UPDATE and no DELETE policy for
-- anybody. A history that can be tidied cannot answer "when did this leave, and
-- who took it?", which is the only question it exists to answer.
--
-- A FAILED export is recorded too. A history of successes only would hide the
-- interesting half — the exports somebody tried and could not get.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.report_exports (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id)         on delete cascade,
  template_id     uuid references public.report_templates(id) on delete set null,

  -- The generated report this export produced, when the engine was the PDF one.
  -- `project_reports` is itself append-only, so this stays resolvable and the
  -- history row can offer a working download months later.
  report_id       uuid references public.project_reports(id)  on delete set null,

  template_name   text not null,   -- kept verbatim: a custom template may be deleted
  format          text not null check (format in ('pdf','csv')),
  file_name       text not null,
  byte_size       bigint check (byte_size >= 0),
  row_count       integer check (row_count >= 0),

  status          text not null check (status in ('ready','failed')),
  error           text,

  requested_by_id uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint report_exports_failure_has_reason check (
    (status = 'ready' and error is null) or (status = 'failed' and error is not null)
  )
);

create index if not exists report_exports_project_idx on public.report_exports (project_id, created_at desc);

comment on table public.report_exports is
  'Every export anybody took, successful or not (096). Append-only: no UPDATE '
  'or DELETE policy exists, because a tidiable history answers nothing.';


-- ════════════════════════════════════════════════════════════════════════════
-- USAGE COUNTER
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER, BECAUSE THE ALTERNATIVE IS AN UPDATE POLICY ON THE WHOLE
-- ROW. "Used 47 times" has to be bumped by whoever pressed the button, and any
-- signed-in person may press it. Granting them UPDATE on report_templates to
-- move a counter would also let them rename or re-point a built-in template
-- everyone else relies on. This function moves the two columns it names and
-- nothing else.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.record_template_use(p_template uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  update public.report_templates
     set usage_count  = usage_count + 1,
         last_used_at = now()
   where id = p_template;
end $$;

comment on function app.record_template_use(uuid) is
  'Bumps a template''s usage counter (096). SECURITY DEFINER so pressing a '
  'button does not require UPDATE on the template row itself.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE BUILT-INS
-- ----------------------------------------------------------------------------
-- Every row maps to a generator that runs today. Verified against
-- lib/pdf/report-poster.ts (the four drawn layouts), app/actions/export.ts (the
-- two CSVs) and the meta_* tables from 091–093.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.report_templates
  (slug, name, description, category, engine, kind, format, is_builtin) values

  -- The drawn PDF, one row per layout the composer actually has.
  ('daily-snapshot',
   'Daily Performance Snapshot',
   'Today''s published posts with their live links, who published each one, and the day''s figures against the monthly promise.',
   'performance', 'project_report', 'today', 'pdf', true),

  ('yesterday-wrap',
   'Yesterday''s Wrap-Up',
   'The same daily sheet for yesterday — the one to send when the day has closed and every link is live.',
   'performance', 'project_report', 'yesterday', 'pdf', true),

  ('weekly-performance',
   'Weekly Performance Report',
   'Day by day across the week, with platform distribution and a line per person who published.',
   'performance', 'project_report', 'week', 'pdf', true),

  ('monthly-client-report',
   'Monthly Client Report',
   'Week by week against the month''s agreed assets and reels. The sheet that goes to the client.',
   'executive', 'project_report', 'month', 'pdf', true),

  ('annual-review',
   'Annual Review',
   'Month by month across the year — volume, platforms and the people behind it.',
   'executive', 'project_report', 'year', 'pdf', true),

  -- The two CSVs that already exist.
  ('task-export',
   'Task Export',
   'Every task you can see as a spreadsheet: status, assignee, priority, effort, content kind and dates.',
   'delivery', 'tasks_csv', null, 'csv', true),

  ('workload-export',
   'Team Workload Export',
   'Open work per person with effort points, for deciding who is carrying too much.',
   'delivery', 'workload_csv', null, 'csv', true),

  -- Meta data collected by 091–093.
  ('meta-metrics-export',
   'Meta Daily Metrics',
   'The collected daily series per account — reach, views, engagement and followers, one row per day per metric.',
   'audience', 'meta_metrics_csv', null, 'csv', true),

  ('meta-posts-export',
   'Meta Post Performance',
   'Every collected post with its permalink, surface, reach, views and interactions.',
   'content', 'meta_posts_csv', null, 'csv', true)

on conflict (slug) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- ⚠️ THE TWO TABLES HOLDING CLIENT DATA DELEGATE TO `app.project_is_visible`
-- rather than reimplementing it — a second implementation of that rule is how
-- two screens come to disagree about who may see a client's numbers.
--
-- The template table holds no client data at all: a name, a category and the
-- name of a generator. So it is readable by anyone signed in, and the
-- interesting question there is WRITES.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.report_templates            enable row level security;
alter table public.report_template_favourites  enable row level security;
alter table public.report_schedules            enable row level security;
alter table public.report_exports              enable row level security;

-- ── Templates ───────────────────────────────────────────────────────────────
drop policy if exists report_templates_select on public.report_templates;
create policy report_templates_select on public.report_templates
  for select using (app.current_user_id() is not null);

drop policy if exists report_templates_insert on public.report_templates;
create policy report_templates_insert on public.report_templates
  for insert with check (
    app.current_user_id() is not null
    -- ⚠️ Nobody creates a built-in through the application. A row seeded by a
    -- migration is relied on by every project; one a person makes is theirs.
    and not is_builtin
    and created_by_id = app.current_user_id()
  );

-- ⚠️ A BUILT-IN CANNOT BE EDITED OR DELETED BY ANYONE, INCLUDING A SUPER ADMIN,
-- and that is on purpose. `slug` is a contract: 'monthly-client-report' is what
-- the schedules point at and what a later migration would amend. Letting the
-- name or engine be changed from the UI would break rows that reference it while
-- looking like a harmless rename. Amending a built-in is a migration.
drop policy if exists report_templates_update on public.report_templates;
create policy report_templates_update on public.report_templates
  for update
  using      (not is_builtin and (created_by_id = app.current_user_id()
                                  or app.acting_at_least('admin'::public.user_role)))
  with check (not is_builtin);

drop policy if exists report_templates_delete on public.report_templates;
create policy report_templates_delete on public.report_templates
  for delete
  using (not is_builtin and (created_by_id = app.current_user_id()
                             or app.acting_at_least('admin'::public.user_role)));

-- ── Favourites: own rows, nobody else's ─────────────────────────────────────
drop policy if exists report_favourites_all on public.report_template_favourites;
create policy report_favourites_all on public.report_template_favourites
  for all
  using      (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

-- ── Schedules ───────────────────────────────────────────────────────────────
drop policy if exists report_schedules_select on public.report_schedules;
create policy report_schedules_select on public.report_schedules
  for select using (app.project_is_visible(project_id));

-- ⚠️ Coordinator and above. A standing schedule generates rows for months
-- without anybody pressing anything, which is more than a read of the project.
drop policy if exists report_schedules_write on public.report_schedules;
create policy report_schedules_write on public.report_schedules
  for all
  using      (app.project_is_visible(project_id)
              and app.acting_at_least('team_coordinator'::public.user_role))
  with check (app.project_is_visible(project_id)
              and app.acting_at_least('team_coordinator'::public.user_role));

-- ── Export history: readable with the project, insert-only ──────────────────
drop policy if exists report_exports_select on public.report_exports;
create policy report_exports_select on public.report_exports
  for select using (project_id is null or app.project_is_visible(project_id));

drop policy if exists report_exports_insert on public.report_exports;
create policy report_exports_insert on public.report_exports
  for insert with check (
    (project_id is null or app.project_is_visible(project_id))
    -- Nobody records an export in somebody else's name.
    and requested_by_id = app.current_user_id()
  );

-- ⚠️ NO UPDATE AND NO DELETE POLICY. See the note on the table.

grant select on public.report_templates, public.report_template_favourites,
                public.report_schedules, public.report_exports to cni_app;
grant insert, update, delete on public.report_templates to cni_app;
grant insert, delete         on public.report_template_favourites to cni_app;
grant insert, update, delete on public.report_schedules to cni_app;
grant insert                 on public.report_exports to cni_app;
grant execute on function app.record_template_use(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT TOUCHES NO LIVE ROW. Migration 082's self-check borrowed a real person
-- and cleaned up with a DELETE keyed on TODAY's date, which would have destroyed
-- a genuine attendance row had that person scanned in that morning. This one
-- creates its own project and template, asserts against those, and removes
-- exactly what it made.
--
-- ⚠️ IT RUNS AS `cni_app`. Migrations execute as the schema owner, which BYPASSES
-- RLS entirely — 094's self-check passed its own policy assertion for that
-- reason and proved nothing. Every policy claim below is made under the role the
-- application actually uses.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_project  uuid;
  v_custom   uuid;
  v_builtin  uuid;
  v_before   bigint;
  v_after    bigint;
  n          integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;

  if v_admin is null then
    raise notice '096 · no admin row; tables are in place, self-check skipped';
    return;
  end if;

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('096 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  select id into v_builtin from public.report_templates where slug = 'monthly-client-report';

  -- 1 · Every built-in points at a generator the application implements. This is
  --     the assertion that stops a template being seeded whose button is dead.
  select count(*) into n from public.report_templates
   where is_builtin
     and engine not in ('project_report','tasks_csv','workload_csv','meta_metrics_csv','meta_posts_csv');
  if n > 0 then
    raise exception '096 · % built-in template(s) name an engine nothing implements', n;
  end if;

  -- 2 · The PDF engine has a period and the CSV engines do not. Getting this
  --     wrong means a monthly report generated over an undefined range.
  select count(*) into n from public.report_templates
   where (engine = 'project_report' and kind is null)
      or (engine <> 'project_report' and kind is not null);
  if n > 0 then
    raise exception '096 · % template(s) have a period that disagrees with their engine', n;
  end if;

  -- 3 · A format nothing can write cannot be stored, however plausible it looks.
  begin
    insert into public.report_templates (name, description, category, engine, format, is_builtin, created_by_id)
    values ('096 xlsx', '', 'data', 'tasks_csv', 'xlsx', false, v_admin);
    raise exception '096 · a template was saved as xlsx and nothing can write one';
  exception when check_violation then
    null;
  end;

  -- 4 · The counter function moves the counter.
  insert into public.report_templates (name, description, category, engine, format, is_builtin, created_by_id)
  values ('096 self-check template', '', 'data', 'tasks_csv', 'csv', false, v_admin)
  returning id into v_custom;

  perform app.record_template_use(v_custom);
  perform app.record_template_use(v_custom);
  select usage_count into n from public.report_templates where id = v_custom;
  if n <> 2 then
    raise exception '096 · usage_count is % after two uses, expected 2', n;
  end if;

  -- 5 · A failed export must carry a reason.
  begin
    insert into public.report_exports
      (project_id, template_name, format, file_name, status, requested_by_id)
    values (v_project, '096', 'csv', 'x.csv', 'failed', v_admin);
    raise exception '096 · a failed export was recorded with no reason';
  exception when check_violation then
    null;
  end;

  -- ── The policy assertions, under the application's own role ──────────────
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 6 · ⚠️ A BUILT-IN IS IMMUTABLE EVEN TO AN ADMIN. `slug` is what schedules
  --     point at; a rename from the UI would break them while looking harmless.
  update public.report_templates set name = '096 renamed' where id = v_builtin;
  if found then
    raise exception '096 · a built-in template was renamed through RLS — the update policy is not holding';
  end if;

  delete from public.report_templates where id = v_builtin;
  if found then
    raise exception '096 · a built-in template was deleted through RLS';
  end if;

  -- 7 · An admin's own custom template IS editable. The policy above must not
  --     be so tight that nothing can be edited at all.
  update public.report_templates set name = '096 renamed custom' where id = v_custom;
  if not found then
    raise exception '096 · a custom template could not be renamed by its own author';
  end if;

  -- 8 · The history refuses to be rewritten or tidied. No UPDATE or DELETE
  --     policy exists, so both must fail rather than quietly affect zero rows.
  insert into public.report_exports
    (project_id, template_name, format, file_name, status, requested_by_id, byte_size)
  values (v_project, '096', 'csv', 'x.csv', 'ready', v_admin, 10);

  begin
    update public.report_exports set file_name = 'rewritten' where project_id = v_project;
    raise exception '096 · export history was rewritten — an UPDATE policy exists that should not';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.report_exports where project_id = v_project;
    raise exception '096 · export history was deleted — a DELETE policy exists that should not';
  exception when insufficient_privilege then
    null;
  end;

  reset role;

  -- ── Clean up exactly what was made ──────────────────────────────────────
  delete from public.report_templates where id = v_custom;
  delete from public.projects          where id = v_project;

  -- 9 · The cascade takes the history with the project rather than orphaning it.
  if exists (select 1 from public.report_exports where project_id = v_project) then
    raise exception '096 · export history outlived its project — the cascade is not working';
  end if;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '096 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '096 · report templates, schedules and export history are in place';
end $$;
