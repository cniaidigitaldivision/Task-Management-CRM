-- ============================================================================
-- CNI CRM — MIGRATION 003 · AUDIT LOG & SECURITY EVENTS  (APPEND-ONLY)
-- ----------------------------------------------------------------------------
-- Creates:  audit_log · security_events
-- Applies:  append-only enforcement to audit_log, security_events and
--           login_attempts (created in 002)
--
-- Specification:  docs/04-DATA-MODEL.md §2, §2b
--                 docs/16-SECURITY-AND-IDENTITY.md §10
--                 docs/19-MASTER-SPECIFICATION-REGISTRY.md §6 (append-only set)
--                 docs/20-IMPLEMENTATION-CONTRACTS.md §5, §9 step 2.4
--                 FR-153, SA-10
--
-- ⛔ Never edit an applied migration (doc 20 §7).
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY A TRIGGER AND NOT ONLY REVOKED GRANTS
--
-- doc 19 §6 requires "no UPDATE or DELETE grant for any role, including
-- super_admin", and doc 16 §10 explains what that buys: "if the most
-- privileged account could edit history, the log would prove nothing."
--
-- Revoking grants alone does not achieve it. In Postgres the table OWNER holds
-- its privileges implicitly — REVOKE against the owner is a no-op — so a
-- grants-only approach leaves the log editable by exactly the account with the
-- most reason to edit it. A trigger fires for the owner too.
--
-- So both are applied: grants revoked in migration 005, and these triggers.
-- ────────────────────────────────────────────────────────────────────────────
-- ============================================================================


create type public.security_severity as enum ('info', 'warning', 'critical');

-- doc 16 §10: authorisation *denials* are logged as well as actions, so the
-- log answers "what was attempted?", not only "what succeeded?".
create type public.audit_outcome as enum ('success', 'denied', 'failed');


-- ----------------------------------------------------------------------------
-- 1 · audit_log — every privileged action
-- ----------------------------------------------------------------------------
-- doc 16 §10 fixes the shape: who, what, when, from where (IP + device),
-- before-value, after-value, outcome.
--
-- Actor identity is SNAPSHOTTED and carries no foreign key. Three reasons:
--   1. An evidence log must stay true after the actor's row changes. "Admin"
--      at the time of the act is the fact; their role today is not.
--   2. An ON DELETE SET NULL would be a system-performed UPDATE of a row this
--      table forbids updating — the constraint would fight the invariant.
--   3. doc 03 §7 requires purging to anonymise history rather than delete it.
--      A snapshot already is that: purge the user row and the log keeps a
--      standalone record with nothing to dangle.

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),

  -- WHO (snapshotted — see above)
  actor_id      uuid,
  actor_email   text,
  actor_role    public.user_role,

  -- WHAT
  entity_type   text not null,
  entity_id     uuid,
  action        text not null,
  before        jsonb,
  after         jsonb,

  -- Mandatory for every override, forced reassignment, role change and
  -- permanent delete (doc 03 §5). Enforced per-action at layer 3, because
  -- which actions require it is a permission-matrix question.
  reason        text,
  outcome       public.audit_outcome not null default 'success',

  -- FROM WHERE
  ip_address    inet,
  user_agent    text,
  session_id    uuid,

  -- WHEN
  created_at    timestamptz not null default now(),

  constraint audit_log_entity_type_present
    check (length(btrim(entity_type)) > 0),
  constraint audit_log_action_present
    check (length(btrim(action)) > 0),
  constraint audit_log_actor_email_lowercase
    check (actor_email is null or actor_email = lower(actor_email))
);

-- "Everything that ever happened to this task / user / project" — the
-- per-entity timeline (FR-092) and the incident-response reads in doc 16 §12.
create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

-- "Everything this person did" — the review after a compromise.
create index audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc);

-- The audit viewer's default ordering (FR-093).
create index audit_log_recent_idx
  on public.audit_log (created_at desc);

create index audit_log_action_idx
  on public.audit_log (action, created_at desc);

comment on table public.audit_log is
  'APPEND-ONLY. FR-153, SA-10. Every privileged action: who, what, when, from where, '
  'before, after, outcome (doc 16 §10). No UPDATE or DELETE for any role, enforced by trigger.';
comment on column public.audit_log.actor_id is
  'Snapshot, no foreign key. The log must remain true after the actor row changes or is purged.';


-- ----------------------------------------------------------------------------
-- 2 · security_events — the alerting stream
-- ----------------------------------------------------------------------------
-- Deliberately separate from audit_log. audit_log answers "what did people
-- do?"; this answers "what should someone be woken up about?" Merging them
-- means either the alert stream is full of routine writes, or the audit trail
-- is filtered — and a filtered audit trail is not evidence.
--
-- event_type stays free text rather than an enum so a new detection can ship
-- without a migration. The known set (doc 04 §2b):
--   login_success · login_failed · account_locked · account_unlocked
--   mfa_enrolled · mfa_disabled · password_changed · role_changed
--   new_device · new_country · impossible_travel · break_glass_used
--   step_up_failed · bulk_export · permanent_purge
--   super_admin_write_blocked · super_admin_mfa_removal_blocked

create table public.security_events (
  id            uuid primary key default gen_random_uuid(),

  -- Snapshot, no foreign key — same reasoning as audit_log.actor_id. NULL for
  -- events with no identified account (an attempt on an unknown address).
  user_id       uuid,

  event_type    text not null,
  severity      public.security_severity not null default 'info',

  ip_address    inet,
  ip_country    text,

  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint security_events_type_present
    check (length(btrim(event_type)) > 0)
);

create index security_events_recent_idx
  on public.security_events (created_at desc);

create index security_events_user_idx
  on public.security_events (user_id, created_at desc)
  where user_id is not null;

create index security_events_type_idx
  on public.security_events (event_type, created_at desc);

-- The security dashboard's "needs attention now" query (FR-159).
create index security_events_critical_idx
  on public.security_events (created_at desc)
  where severity = 'critical';

comment on table public.security_events is
  'APPEND-ONLY. The security alert stream (doc 16 §10). Separate from audit_log so the '
  'alert feed stays signal and the audit trail stays complete.';


-- ----------------------------------------------------------------------------
-- 3 · APPEND-ONLY ENFORCEMENT
-- ----------------------------------------------------------------------------

create or replace function app.reject_row_mutation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  -- doc 16 §6. The one documented exception, and it is loud: it requires
  -- direct database access, and it records itself as critical before
  -- proceeding. See app.break_glass_active().
  if app.break_glass_active() then
    insert into public.security_events (event_type, severity, details)
    values (
      'break_glass_used',
      'critical',
      jsonb_build_object(
        'table',        tg_table_schema || '.' || tg_table_name,
        'operation',    tg_op,
        'db_user',      current_user,
        'session_user', session_user,
        'app_user_id',  app.current_user_id()
      )
    );
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception
    '% on %.% is forbidden: this table is append-only.',
    tg_op, tg_table_schema, tg_table_name
    using
      errcode = 'restrict_violation',
      detail  = 'Corrections are made by inserting a new row, never by altering an existing one.',
      hint    = 'docs/19-MASTER-SPECIFICATION-REGISTRY.md §6, FR-153, SA-10.';
end
$$;

comment on function app.reject_row_mutation() is
  'BEFORE UPDATE OR DELETE trigger for append-only tables. Fires for the table OWNER too, '
  'which revoked grants cannot achieve. FR-153.';


create or replace function app.reject_truncate()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if app.break_glass_active() then
    insert into public.security_events (event_type, severity, details)
    values (
      'break_glass_used',
      'critical',
      jsonb_build_object(
        'table',        tg_table_schema || '.' || tg_table_name,
        'operation',    'TRUNCATE',
        'db_user',      current_user,
        'session_user', session_user
      )
    );
    return null;
  end if;

  raise exception
    'TRUNCATE on %.% is forbidden: this table is append-only.',
    tg_table_schema, tg_table_name
    using
      errcode = 'restrict_violation',
      hint    = 'docs/19-MASTER-SPECIFICATION-REGISTRY.md §6, FR-153.';
end
$$;

comment on function app.reject_truncate() is
  'Statement-level TRUNCATE guard. Without it, "append-only" is defeated by one statement '
  'that deletes no rows individually.';


-- audit_log
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.reject_row_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function app.reject_truncate();

-- security_events
create trigger security_events_append_only
  before update or delete on public.security_events
  for each row execute function app.reject_row_mutation();

create trigger security_events_no_truncate
  before truncate on public.security_events
  for each statement execute function app.reject_truncate();

-- login_attempts (table created in migration 002; doc 19 §6 marks it append-only)
create trigger login_attempts_append_only
  before update or delete on public.login_attempts
  for each row execute function app.reject_row_mutation();

create trigger login_attempts_no_truncate
  before truncate on public.login_attempts
  for each statement execute function app.reject_truncate();
