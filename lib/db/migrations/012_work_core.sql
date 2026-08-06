-- =============================================================================
-- MIGRATION 012 — THE WORK CORE: projects, tasks and everything on them
-- Traces to: doc 04 §2, doc 05, doc 06, doc 15, doc 17, ADR-006, ADR-010.
-- -----------------------------------------------------------------------------
-- Everything up to migration 011 was identity and security. This is the part of
-- the database the CRM is actually *for*.
--
-- ── FIVE DECISIONS WORTH READING BEFORE CHANGING ANYTHING HERE ───────────────
--
-- 1. STATUSES ARE AN ENUM, NOT A TABLE.
--    Doc 04 §2 specifies a `statuses` table with colour, sort_order, category
--    and counts_toward_load. But `lib/domain/constants.ts` already holds all of
--    that as STATUS_META, and registry §4 names that file the single source of
--    truth for every enum. A table would be a *second* declaration of the same
--    eight rows, and the capacity engine would then have two places to read
--    loadWeight from — guaranteed drift, by exactly the reasoning that produced
--    C-16. So: the *set* of statuses is a Postgres enum (the database enforces
--    it), and the *metadata* lives in TypeScript (one copy, unit-tested).
--    Recorded as C-20 in doc 19 §9.
--
-- 2. REFERENCES ARE PER-PREFIX AND GAPLESS-ENOUGH.
--    `EVT-142` has to be sayable out loud and has to identify the *kind* of
--    work (FR-113, Q-026). A shared sequence per project-type code gives that.
--    It is a counter row taken with FOR UPDATE rather than a Postgres sequence,
--    because a sequence would burn numbers on every rolled-back insert and the
--    references would visibly skip. Two concurrent inserts serialise for a few
--    milliseconds; at seven users that is free.
--
-- 3. A TASK'S CAPACITY COST IS STORED, ITS LOAD IS NOT.
--    `effort_points` is stored — it is an estimate a human made. The *load* a
--    task places on someone (effort × priority weight × status weight) is
--    derived on read, never stored, per doc 20: workload stores nothing. If it
--    were stored, every status change would have to remember to recompute it.
--
-- 4. REASONS ARE CHECK CONSTRAINTS, NOT UI VALIDATION.
--    Blocked requires a reason; Cancelled requires a reason; a project on hold
--    requires a reason (FR-043, doc 15). Put in the UI, that rule is one
--    forgotten code path away from a blocked task nobody can explain. Put here,
--    it is not possible to write the row at all.
--
-- 5. NOTHING IS EVER HARD-DELETED.
--    Tasks soft-delete with a 30-day purge window (FR-095). Projects archive.
--    The append-only ledgers from migration 004 keep their triggers. A CRM whose
--    history can be quietly edited cannot answer "what happened", which is most
--    of why it exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · ENUMS — the sets, mirroring lib/domain/constants.ts exactly
-- -----------------------------------------------------------------------------
create type public.project_type as enum (
  'event', 'client', 'business', 'self_promotion', 'other'
);

create type public.project_status as enum (
  'planning', 'active', 'on_hold', 'completed', 'archived', 'cancelled'
);

create type public.task_status as enum (
  'backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'revisions', 'done', 'cancelled'
);

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create type public.effort_size as enum ('XS', 'S', 'M', 'L', 'XL');

create type public.dependency_type as enum ('blocks', 'relates_to');

create type public.availability_type as enum ('leave', 'holiday', 'half_day', 'unavailable');

create type public.timer_state as enum ('not_started', 'running', 'paused', 'stopped');

create type public.timer_pause_reason as enum (
  'status_change', 'outside_hours', 'leave', 'idle', 'manual'
);

create type public.time_entry_source as enum ('timer', 'manual', 'adjustment');

create type public.extension_status as enum (
  'pending', 'approved', 'partially_approved', 'declined', 'cancelled'
);

create type public.notification_kind as enum (
  'task_assigned',
  'task_reassigned',
  'task_status_changed',
  'task_blocked',
  'task_due_soon',
  'task_overdue',
  'task_comment',
  'task_mention',
  'review_requested',
  'review_approved',
  'revisions_requested',
  'capacity_warning',
  'time_limit_warning',
  'time_extension_requested',
  'time_extension_decided',
  'project_status_changed',
  'security_alert'
);

-- -----------------------------------------------------------------------------
-- 2 · REFERENCE COUNTERS — how EVT-142 gets its 142
-- -----------------------------------------------------------------------------
create table public.reference_counters (
  code       text primary key,
  last_value integer not null default 0,
  constraint reference_counters_code_format check (code ~ '^[A-Z]{3}$'),
  constraint reference_counters_non_negative check (last_value >= 0)
);

comment on table public.reference_counters is
  'One row per project-type prefix. A counter row, not a sequence: a sequence burns a number on every rolled-back insert and the references would visibly skip.';

-- Seeded with the five prefixes from PROJECT_TYPE_META. Starting values are
-- deliberately non-zero so the very first reference does not read as "EVT-1",
-- which looks like test data in a screenshot.
insert into public.reference_counters (code, last_value) values
  ('EVT', 100), ('CLI', 100), ('BIZ', 100), ('PRM', 100), ('OTH', 100);

create or replace function app.next_reference(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_next integer;
begin
  update public.reference_counters
     set last_value = last_value + 1
   where code = upper(p_code)
  returning last_value into v_next;

  if v_next is null then
    raise exception 'Unknown reference prefix %', p_code
      using errcode = 'foreign_key_violation';
  end if;

  return upper(p_code) || '-' || v_next::text;
end
$$;

comment on function app.next_reference(text) is
  'FR-032, FR-113: the next human-sayable reference for a project-type prefix. SECURITY DEFINER because cni_app must not be able to write the counter directly.';

-- -----------------------------------------------------------------------------
-- 3 · PROJECTS — required in v1 (ADR-006). Every task belongs to one (BR-011).
-- -----------------------------------------------------------------------------
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              public.project_type not null,
  code              text not null,
  description       text,
  status            public.project_status not null default 'planning',
  status_reason     text,
  owner_id          uuid not null references public.users(id) on delete restrict,
  start_date        date,
  target_end_date   date,

  -- The always-present "Misc / Ad-hoc" Other project (Q-024). Cannot be
  -- archived or deleted, because ad-hoc work has to have somewhere to land or
  -- it goes back to being invisible, which is the problem doc 15 exists to fix.
  is_permanent      boolean not null default false,

  -- Type-specific fields (doc 04 §2, doc 15 §3). jsonb rather than 40 mostly-
  -- null columns: only one shape is ever relevant to a given row, and the shape
  -- is validated in the domain layer where the rules are already written.
  type_fields       jsonb not null default '{}'::jsonb,

  created_by_id     uuid not null references public.users(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_code_format check (code ~ '^[A-Z]{3}$'),

  -- FR-043's sibling for projects (doc 15): you may put work on hold or cancel
  -- it, but you may not do so silently.
  constraint projects_reason_required check (
    status not in ('on_hold', 'cancelled') or btrim(coalesce(status_reason, '')) <> ''
  ),
  constraint projects_dates_ordered check (
    start_date is null or target_end_date is null or target_end_date >= start_date
  ),
  -- The permanent catch-all is an Other project by definition.
  constraint projects_permanent_is_other check (not is_permanent or type = 'other')
);

comment on table public.projects is
  'doc 15, ADR-006. Every task belongs to exactly one project (BR-011). Projects archive; they are never deleted.';

create unique index projects_single_permanent_idx
  on public.projects ((true)) where is_permanent;

comment on index public.projects_single_permanent_idx is
  'Q-024: exactly one permanent catch-all project, structurally — the same technique as users_single_super_admin_idx.';

create index projects_status_idx on public.projects (status) where status <> 'archived';
create index projects_owner_idx  on public.projects (owner_id);
create index projects_type_idx   on public.projects (type);

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4 · TASKS
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  title              text not null,
  description        text,

  project_id         uuid not null references public.projects(id) on delete restrict,

  -- BR-012: mandatory when the project's type is `other`. Enforced by trigger
  -- below, because the rule depends on another table.
  other_description  text,

  parent_task_id     uuid references public.tasks(id) on delete cascade,

  -- BR-001: exactly one assignee, or none while it is unassigned.
  assignee_id        uuid references public.users(id) on delete set null,
  created_by_id      uuid not null references public.users(id) on delete restrict,

  status             public.task_status not null default 'backlog',
  priority           public.task_priority not null default 'medium',

  -- The capacity cost. effort_size is the shortcut that fills it (doc 05 §5);
  -- points are what the engine reads, so points are what is stored.
  effort_size        public.effort_size,
  effort_points      numeric(6,2) not null,

  start_date         date,
  due_date           date,
  completed_at       timestamptz,

  blocked_reason     text,
  cancelled_reason   text,

  -- BR-003: set only when a hard capacity threshold was overridden. Its
  -- presence is the audit trail for "who decided to overload this person".
  assignment_override_reason text,
  assignment_score           numeric(5,2),

  recurrence_rule    text,

  -- ── Timers (doc 17) ──────────────────────────────────────────────────────
  time_limit_minutes        integer,
  time_spent_minutes        integer not null default 0,
  timer_state               public.timer_state not null default 'not_started',
  timer_started_at          timestamptz,
  timer_pause_reason        public.timer_pause_reason,
  extension_minutes_granted integer not null default 0,
  over_limit_acknowledged_at timestamptz,

  -- FR-095: soft delete with a 30-day purge window.
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_effort_positive check (effort_points > 0),
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),

  -- FR-043. Not UI validation — a blocked task that cannot say why is useless
  -- to the person who has to unblock it.
  constraint tasks_blocked_needs_reason check (
    status <> 'blocked' or btrim(coalesce(blocked_reason, '')) <> ''
  ),
  constraint tasks_cancelled_needs_reason check (
    status <> 'cancelled' or btrim(coalesce(cancelled_reason, '')) <> ''
  ),

  -- `completed_at` and `status = done` must agree. Two sources of truth for
  -- "is this finished" is how completion reports start disagreeing with boards.
  constraint tasks_completed_at_matches_status check (
    (status = 'done') = (completed_at is not null)
  ),
  constraint tasks_deleted_at_matches_flag check (
    is_deleted = (deleted_at is not null)
  ),
  constraint tasks_dates_ordered check (
    start_date is null or due_date is null or due_date >= start_date
  ),
  constraint tasks_time_non_negative check (
    time_spent_minutes >= 0
    and extension_minutes_granted >= 0
    and (time_limit_minutes is null or time_limit_minutes > 0)
  ),
  -- A running timer must know when it started, or the elapsed time is a guess.
  constraint tasks_running_timer_has_start check (
    timer_state <> 'running' or timer_started_at is not null
  )
);

comment on table public.tasks is
  'doc 05. One assignee (BR-001), one project (BR-011). Soft-deleted only (FR-095). Load is DERIVED from effort × priority × status weight and never stored.';

create index tasks_assignee_open_idx on public.tasks (assignee_id)
  where not is_deleted and status not in ('done', 'cancelled');
create index tasks_project_idx  on public.tasks (project_id)  where not is_deleted;
create index tasks_status_idx   on public.tasks (status)      where not is_deleted;
create index tasks_due_date_idx on public.tasks (due_date)
  where not is_deleted and status not in ('done', 'cancelled');
create index tasks_parent_idx   on public.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_created_by_idx on public.tasks (created_by_id);

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function app.touch_updated_at();

-- ── BR-012: ad-hoc work must explain itself ──────────────────────────────────
-- The rule reads across to `projects`, so it cannot be a CHECK constraint.
-- Without it, "Other" becomes the drawer everything gets shoved into, and doc
-- 15's whole purpose — making invisible work visible — quietly fails.
create or replace function app.enforce_other_task_description()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_type public.project_type;
begin
  select type into v_type from public.projects where id = new.project_id;

  if v_type = 'other' and btrim(coalesce(new.other_description, '')) = '' then
    raise exception 'A task in an Other project must say what the work is.'
      using errcode = 'check_violation',
            hint = 'BR-012, doc 15 §4 — this is what keeps ad-hoc work visible.';
  end if;

  return new;
end
$$;

create trigger tasks_enforce_other_description
  before insert or update of project_id, other_description on public.tasks
  for each row execute function app.enforce_other_task_description();

-- -----------------------------------------------------------------------------
-- 5 · TASK SATELLITES
-- -----------------------------------------------------------------------------

-- What the task NEEDS. Drives the match score (doc 07 §3).
create table public.task_skills (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete restrict,
  weight   integer not null default 2,
  primary key (task_id, skill_id),
  constraint task_skills_weight_range check (weight between 1 and 3)
);

-- People who want updates but are not the assignee.
create table public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create table public.task_dependencies (
  task_id            uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  type               public.dependency_type not null default 'blocks',
  created_at         timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id)
);

comment on table public.task_dependencies is
  'FR-028. Only direct self-dependency is blocked here; longer cycles are detected in the domain layer, where a readable error can name the loop.';

create index task_dependencies_reverse_idx
  on public.task_dependencies (depends_on_task_id);

create table public.checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  text       text not null,
  is_done    boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint checklist_items_text_not_blank check (btrim(text) <> '')
);

create index checklist_items_task_idx on public.checklist_items (task_id, sort_order);

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  author_id         uuid not null references public.users(id) on delete restrict,
  body              text not null,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  mentions          uuid[] not null default '{}',
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  constraint comments_body_not_blank check (btrim(body) <> '')
);

create index comments_task_idx on public.comments (task_id, created_at);

create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  comment_id     uuid references public.comments(id) on delete cascade,
  uploaded_by_id uuid not null references public.users(id) on delete restrict,
  file_path      text not null,
  file_name      text not null,
  mime_type      text,
  size_bytes     bigint,
  created_at     timestamptz not null default now(),
  constraint attachments_size_sane check (size_bytes is null or size_bytes >= 0)
);

create index attachments_task_idx on public.attachments (task_id);

-- -----------------------------------------------------------------------------
-- 6 · TIME (doc 17)
-- -----------------------------------------------------------------------------
create table public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete restrict,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  minutes         integer,
  source          public.time_entry_source not null default 'timer',
  reason          text,
  created_at      timestamptz not null default now(),

  -- BR-020: a timer everyone quietly edits is worse than no timer. Manual and
  -- adjustment entries must say why, and the UI shows them flagged.
  constraint time_entries_manual_needs_reason check (
    source = 'timer' or btrim(coalesce(reason, '')) <> ''
  ),
  constraint time_entries_minutes_sane check (minutes is null or minutes >= 0),
  constraint time_entries_ordered check (ended_at is null or ended_at >= started_at)
);

create index time_entries_task_idx on public.time_entries (task_id, started_at);
create index time_entries_user_idx on public.time_entries (user_id, started_at);

create table public.time_extension_requests (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks(id) on delete cascade,
  requested_by_id    uuid not null references public.users(id) on delete restrict,
  requested_minutes  integer not null,
  reason             text not null,
  status             public.extension_status not null default 'pending',
  decided_by_id      uuid references public.users(id) on delete restrict,
  granted_minutes    integer,
  decision_note      text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,

  constraint tx_requested_positive check (requested_minutes > 0),
  constraint tx_reason_not_blank check (btrim(reason) <> ''),
  constraint tx_granted_sane check (granted_minutes is null or granted_minutes >= 0),
  -- A decision must record who made it and when. FR-184, BR-018.
  constraint tx_decision_complete check (
    status = 'pending'
    or status = 'cancelled'
    or (decided_by_id is not null and decided_at is not null)
  )
);

create index tx_task_idx    on public.time_extension_requests (task_id);
create index tx_pending_idx on public.time_extension_requests (status) where status = 'pending';

-- -----------------------------------------------------------------------------
-- 7 · AVAILABILITY (FR-014) — leave, holidays, half days
-- -----------------------------------------------------------------------------
create table public.availability (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  start_date          date not null,
  end_date            date not null,
  type                public.availability_type not null,
  capacity_multiplier numeric(3,2) not null default 0,
  note                text,
  approved_by_id      uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint availability_ordered check (end_date >= start_date),
  constraint availability_multiplier_range check (capacity_multiplier between 0 and 1)
);

create index availability_user_idx on public.availability (user_id, start_date, end_date);

-- -----------------------------------------------------------------------------
-- 8 · ACTIVITY LOG — the human-readable feed (FR-092)
-- -----------------------------------------------------------------------------
-- Distinct from `audit_log`, deliberately. `audit_log` is the tamper-evident
-- record of privileged actions and is append-only by trigger. This is "Yusra
-- moved CLI-091 to Blocked, 2 minutes ago" — a feed. Keeping them apart is what
-- lets the feed stay readable while the audit trail stays complete (doc 19 §6).
create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  summary     text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now(),
  constraint activity_log_entity_known check (
    entity_type in ('task', 'project', 'user', 'setting', 'comment', 'time')
  )
);

create index activity_log_recent_idx on public.activity_log (created_at desc);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id, created_at desc);

-- Append-only, by trigger, for the same reason as the migration-004 ledgers: a
-- REVOKE cannot bind a table owner, and "who changed what" is worthless if it
-- can be rewritten afterwards.
create or replace function app.reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only.', tg_table_name
    using errcode = 'insufficient_privilege',
          hint = 'doc 19 §6 — history is not editable by any role.';
end
$$;

create trigger activity_log_append_only
  before update or delete on public.activity_log
  for each row execute function app.reject_mutation();

-- -----------------------------------------------------------------------------
-- 9 · NOTIFICATIONS
-- -----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       public.notification_kind not null,
  title      text not null,
  body       text,
  link_to    text,
  entity_id  uuid,
  is_read    boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_read_at_matches check (is_read = (read_at is not null))
);

create index notifications_inbox_idx
  on public.notifications (user_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (user_id) where not is_read;

-- -----------------------------------------------------------------------------
-- 10 · GRANTS
-- -----------------------------------------------------------------------------
-- `cni_app` gets table privileges; RLS in migration 013 is what actually
-- decides which rows. Supabase's `anon` and `authenticated` get nothing —
-- migration 005 set default privileges to revoke, but say it explicitly since
-- the anon key ships inside the browser bundle.
grant select, insert, update, delete on all tables in schema public to cni_app;
revoke all on all tables in schema public from anon, authenticated;

grant execute on function app.next_reference(text) to cni_app;
revoke execute on function app.next_reference(text) from public;
revoke execute on function app.enforce_other_task_description() from public;
revoke execute on function app.reject_mutation() from public;

-- -----------------------------------------------------------------------------
-- 11 · SELF-CHECK
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_ref     text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'projects','tasks','task_skills','task_watchers','task_dependencies',
    'checklist_items','comments','attachments','time_entries',
    'time_extension_requests','availability','activity_log','notifications',
    'reference_counters'
  ]) as t
  where not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = t
  );

  if v_missing is not null then
    raise exception 'Migration 012 incomplete — missing: %', v_missing;
  end if;

  -- Prove the reference generator actually produces the shape people will say
  -- out loud. Rolled back with the rest of this DO block's effects? No — this
  -- consumes a number, deliberately: better a burnt EVT-101 than an unproven
  -- generator.
  v_ref := app.next_reference('EVT');
  if v_ref !~ '^EVT-[0-9]+$' then
    raise exception 'next_reference returned %, expected EVT-<n>', v_ref;
  end if;

  raise notice 'Migration 012 OK — 14 tables, reference generator returns %', v_ref;
end
$$;
