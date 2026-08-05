-- ============================================================================
-- CNI CRM — MIGRATION 005 · ROW-LEVEL SECURITY & SUPER ADMIN IMMUTABILITY
-- ----------------------------------------------------------------------------
-- Creates:  role cni_app · identity helpers · user_directory view
--           RLS policies on every Phase 1 table
--           the Super Admin immutability trigger (BR-027, FR-140, FR-156)
--           the Super Admin MFA protection trigger (FR-146)
--
-- Specification:  docs/03-ROLES-AND-PERMISSIONS.md §2, §3, §5
--                 docs/04-DATA-MODEL.md §5
--                 docs/16-SECURITY-AND-IDENTITY.md §2, §7
--                 docs/19-MASTER-SPECIFICATION-REGISTRY.md §3 (BR-027, BR-028)
--                 docs/20-IMPLEMENTATION-CONTRACTS.md §5, §9 step 2.6
--                 ADR-002, ADR-003
--
-- ✅ GATE (doc 20 §9): the trigger blocks a foreign write to a super_admin row.
--    Proof: lib/db/verify/005_super_admin_immutability.sql
--
-- ⛔ Never edit an applied migration (doc 20 §7). RLS lives in its own
--    migration so security changes get reviewed as security changes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE TWO LAYERS, AND WHY BOTH
--
-- doc 16 §7 requires two fully independent authorisation layers so that a bug
-- in one is not a breach. This file is the second one. It is not a restatement
-- of the permission matrix — it is a different mechanism reaching the same
-- conclusions, and where the two disagree the request is refused.
--
-- RLS has one structural limitation worth naming up front: an UPDATE policy
-- sees the OLD row in USING and the NEW row in WITH CHECK, but never both at
-- once. Every rule of the form "you may not change X into Y" is therefore a
-- TRIGGER, not a policy. That is why the Super Admin rule — the one rule the
-- brief calls absolute — is enforced by a trigger and only *supported* by RLS.
-- ────────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ============================================================================
-- PART 1 · THE APPLICATION ROLE
-- ============================================================================
-- Registry C-14. `postgres` has BYPASSRLS: every policy below is invisible to
-- it. So the application must not act as `postgres` — it acts as `cni_app`,
-- which does not bypass anything.
--
-- How the server adopts it (see lib/db/README.md):
--   • the connection string carries  options=-c role=cni_app , so the session
--     starts as cni_app even if application code forgets, and
--   • each transaction declares its user:  SET LOCAL app.user_id = '<uuid>'
--
-- Honest limitation: `SET LOCAL ROLE` / a startup role is defence in depth,
-- not a sandbox — a session whose session_user is postgres can RESET ROLE. The
-- hard boundary is the trigger layer, which fires for every role including the
-- table owner. If a hard role boundary is wanted later, granting cni_app LOGIN
-- with its own password is a one-line migration and no application change.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cni_app') then
    create role cni_app nologin noinherit;
  end if;
end
$$;

-- (No COMMENT ON ROLE: commenting on a shared object requires superuser, which
--  the `postgres` role on Supabase is not. The explanation above is the record.)

-- So a session connected as postgres can SET ROLE cni_app.
grant cni_app to postgres;

grant usage on schema public to cni_app;
grant usage on schema app    to cni_app;


-- Close the PostgREST surface.
--
-- Supabase grants `anon` and `authenticated` privileges on everything in
-- `public` by default, and the `anon` key ships inside the browser bundle.
-- We use neither role — authentication is our own (registry C-13) and the app
-- speaks SQL, not REST. Leaving those grants in place would mean the entire
-- identity schema is reachable with a public key, with RLS as the only thing
-- standing in the way. Two locks are better than one.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;

-- And for tables created by future migrations.
alter default privileges in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

-- `service_role` retains access: it is a server-only key and the documented
-- administrative path. It must never reach the browser. doc 16 §8.


-- ============================================================================
-- PART 2 · IDENTITY HELPERS FOR POLICIES
-- ============================================================================

-- Rank, most to least privileged.
--
-- ⚠️ This mirrors ROLE_RANK in lib/domain/constants.ts. It is the one value in
-- the system deliberately stated twice, because a policy cannot import
-- TypeScript. If the two ever disagree the registry decides — doc 19 §4.
create or replace function app.role_rank(r public.user_role)
  returns integer
  language sql
  immutable
as $$
  select case r
    when 'super_admin'      then 4
    when 'admin'            then 3
    when 'team_coordinator' then 2
    when 'member'           then 1
  end
$$;


-- The acting user's role.
--
-- SECURITY DEFINER because it reads `users`, and `users` is itself protected by
-- policies that call this function. Running as the owner (which bypasses RLS)
-- is what stops that from recursing.
--
-- Deactivated accounts resolve to NULL: FR-006 / BR-006. A NULL role makes
-- every predicate below false, which is the fail-closed default.
create or replace function app.current_user_role()
  returns public.user_role
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select u.role
  from public.users u
  where u.id = app.current_user_id()
    and u.is_active
$$;

comment on function app.current_user_role() is
  'The acting user''s role, or NULL if unidentified or deactivated. SECURITY DEFINER '
  'to avoid recursion through the users policies. Registry C-14.';


create or replace function app.acting_at_least(minimum public.user_role)
  returns boolean
  language sql
  stable
as $$
  -- NULL rank (no identity) yields NULL, which a policy treats as false.
  select coalesce(app.role_rank(app.current_user_role()) >= app.role_rank(minimum), false)
$$;


-- Strictly outranks the target. This is the shape doc 03 uses repeatedly:
-- "Admin ⚠️ Coordinator/Member only" — an Admin manages below them, never
-- sideways into another Admin and never upward.
create or replace function app.acting_outranks(target_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    app.role_rank(app.current_user_role())
      > app.role_rank((select u.role from public.users u where u.id = target_user_id)),
    false
  )
$$;

comment on function app.acting_outranks(uuid) is
  'True when the acting user''s role strictly outranks the target user''s. Encodes '
  'doc 03''s "Coordinator/Member only" qualifier: manage downward, never sideways.';

-- Helpers are for the application role only, not for PUBLIC.
revoke execute on function app.current_user_id()                      from public;
revoke execute on function app.break_glass_active()                   from public;
revoke execute on function app.role_rank(public.user_role)            from public;
revoke execute on function app.current_user_role()                    from public;
revoke execute on function app.acting_at_least(public.user_role)      from public;
revoke execute on function app.acting_outranks(uuid)                  from public;

grant execute on function app.current_user_id()                       to cni_app;
grant execute on function app.role_rank(public.user_role)             to cni_app;
grant execute on function app.current_user_role()                     to cni_app;
grant execute on function app.acting_at_least(public.user_role)       to cni_app;
grant execute on function app.acting_outranks(uuid)                   to cni_app;


-- ============================================================================
-- PART 3 · THE SUPER ADMIN IMMUTABILITY TRIGGER   ★ THE GATE
-- ============================================================================
-- BR-027 · FR-140 · FR-156 · BR-028 · doc 03 §2, §5 · doc 16 §2
--
--   "The super admin can never be altered or managed by anyone else rather
--    than the super admin himself."
--
-- Layer 1 of the four in doc 03 §2. It fires for every role — including
-- `postgres`, including `service_role`, including a hand-typed statement in the
-- Supabase SQL editor. That is the whole point: it holds when the application
-- is wrong.
--
-- A note on why blocked attempts are not logged here: this is a BEFORE trigger
-- that raises, so anything it inserted would be rolled back with the very
-- exception it is reporting. Denials are recorded by the server when it catches
-- the error (doc 16 §10, "all authorisation denials"). The break-glass path is
-- different — there the statement succeeds, so its log entry commits.

create or replace function app.enforce_users_write_rules()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, app, pg_temp
as $$
declare
  actor       uuid             := app.current_user_id();
  actor_role  public.user_role := app.current_user_role();
  breaking    boolean          := app.break_glass_active();
  -- True when the statement touches nothing but authentication bookkeeping.
  -- The automatic 3-attempt lockout (FR-155a) happens *pre-authentication* —
  -- by definition nobody is identified — so it cannot present an actor. This
  -- predicate is how an actor-less lockout is distinguished from an actor-less
  -- attempt to seize the account.
  auth_only   boolean;
begin

  -- ==========================================================================
  -- DELETE — never, for anybody, at any rank
  -- ==========================================================================
  -- BR-007 and doc 03 §7: "Deactivation ≠ deletion. Removing someone preserves
  -- all their tasks, comments and time logs." A deleted row takes its history
  -- with it and leaves every audit entry pointing at nothing.
  if tg_op = 'DELETE' then
    if breaking then
      insert into public.security_events (user_id, event_type, severity, details)
      values (old.id, 'break_glass_used', 'critical',
              jsonb_build_object('operation', 'DELETE', 'table', 'users',
                                 'target_role', old.role, 'db_user', current_user));
      return old;
    end if;

    raise exception
      'DELETE on users is forbidden: accounts are deactivated, never deleted.'
      using errcode = 'restrict_violation',
            detail  = format('Attempted on user %s (%s).', old.id, old.role),
            hint    = 'Set is_active = false. BR-007, doc 03 §7.';
  end if;

  -- ==========================================================================
  -- INSERT
  -- ==========================================================================
  -- BR-028 ("no in-app path creates a Super Admin") is enforced structurally by
  -- users_single_super_admin_idx, which permits exactly one such row ever.
  -- Nothing further is needed here.
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- ==========================================================================
  -- UPDATE
  -- ==========================================================================

  -- An account's identity is not editable. Changing it would silently reassign
  -- every audit entry, task and comment that references it.
  if new.id <> old.id then
    raise exception 'users.id is immutable.'
      using errcode = 'restrict_violation';
  end if;

  auth_only :=
        new.role                   =              old.role
    and new.is_active              =              old.is_active
    and new.email                  =              old.email
    and new.full_name              =              old.full_name
    and new.weekly_capacity_points =              old.weekly_capacity_points
    and new.max_concurrent_tasks   =              old.max_concurrent_tasks
    and new.timezone               =              old.timezone
    and new.theme                  =              old.theme
    and new.notification_prefs     =              old.notification_prefs
    and new.role_title    is not distinct from    old.role_title
    and new.avatar_url    is not distinct from    old.avatar_url
    and new.phone         is not distinct from    old.phone
    and new.created_by_id is not distinct from    old.created_by_id
    -- and the new state is one authentication can legitimately produce.
    -- Never `suspended` or `deactivated`: those are administrative acts and
    -- require an identified actor.
    and new.account_state in ('active', 'locked',
                              'password_reset_required', 'mfa_setup_required');

  -- --------------------------------------------------------------------------
  -- 3.1 · THE SUPER ADMIN ROW
  -- --------------------------------------------------------------------------
  if old.role = 'super_admin' then

    if breaking then
      insert into public.security_events (user_id, event_type, severity, details)
      values (old.id, 'break_glass_used', 'critical',
              jsonb_build_object('operation', 'UPDATE', 'table', 'users',
                                 'db_user', current_user));
      return new;

    -- BR-027 · the absolute rule. Anyone who is not this account is refused,
    -- whatever their role, and so is an unidentified session — except for the
    -- narrow authentication-bookkeeping case described above.
    elsif actor is null then
      if not auth_only then
        raise exception
          'Refused: an unidentified session may not modify the Super Admin account.'
          using errcode = 'insufficient_privilege',
                detail  = 'No app.user_id is set for this transaction.',
                hint    = 'BR-027, FR-140. Only the Super Admin may write their own row.';
      end if;

    elsif actor <> old.id then
      raise exception
        'Refused: the Super Admin account can only be modified by itself.'
        using errcode = 'insufficient_privilege',
              detail  = format('Actor %s (%s) attempted to write Super Admin row %s.',
                               actor, coalesce(actor_role::text, 'unknown'), old.id),
              hint    = 'BR-027, FR-140, doc 03 §2. Enforced at the database, not the UI.';

    else
      -- The Super Admin, writing his own row. FR-156 / doc 03 §2: he may change
      -- his credentials and his profile, and he may not destroy the account.
      -- This guards against two things at once — a mistake, and coercion.
      if new.role <> 'super_admin' then
        raise exception 'Refused: the Super Admin cannot demote their own account.'
          using errcode = 'restrict_violation', hint = 'FR-156, doc 03 §2.';
      end if;

      if new.is_active = false then
        raise exception 'Refused: the Super Admin cannot deactivate their own account.'
          using errcode = 'restrict_violation', hint = 'FR-156, doc 03 §2.';
      end if;

      if new.account_state in ('suspended', 'deactivated', 'locked')
         and old.account_state <> new.account_state then
        raise exception
          'Refused: the Super Admin cannot suspend, deactivate or lock their own account.'
          using errcode = 'restrict_violation',
                detail  = format('Attempted state change %s -> %s.',
                                 old.account_state, new.account_state),
                hint    = 'FR-156, doc 03 §2. Recovery is doc 16 §6, not self-destruction.';
      end if;
    end if;

    return new;
  end if;

  -- --------------------------------------------------------------------------
  -- 3.2 · NOBODY IS PROMOTED INTO super_admin
  -- --------------------------------------------------------------------------
  -- BR-028, doc 03 §3: "Promote anyone to Super Admin — ❌ (no such control
  -- exists)", for every role including the Super Admin. Belt and braces with
  -- users_single_super_admin_idx: the index stops a *second* one, this stops
  -- the *first* one being moved sideways into an existing account.
  if new.role = 'super_admin' then
    raise exception 'Refused: no account may be promoted to Super Admin.'
      using errcode = 'restrict_violation',
            hint    = 'BR-028, doc 03 §3. A second Super Admin is doc 16 §6 only.';
  end if;

  -- --------------------------------------------------------------------------
  -- 3.3 · NO SELF-ELEVATION, AT ANY LEVEL
  -- --------------------------------------------------------------------------
  -- doc 03 §5. Not just "no promoting yourself to Admin" — no changing your own
  -- role at all, in either direction, because a role change you authored is a
  -- role change nobody reviewed.
  if new.role <> old.role and actor is not null and actor = old.id then
    raise exception 'Refused: an account cannot change its own role.'
      using errcode = 'insufficient_privilege',
            detail  = format('Attempted %s -> %s on self.', old.role, new.role),
            hint    = 'doc 03 §5.';
  end if;

  -- --------------------------------------------------------------------------
  -- 3.4 · ADMINS MANAGE DOWNWARD ONLY
  -- --------------------------------------------------------------------------
  -- doc 03 §3: "Edit / suspend / delete an Admin — Super Admin only", and
  -- "Promote anyone to Admin — Super Admin only".
  if actor_role = 'admin' then
    if old.role = 'admin' and old.id <> actor then
      raise exception 'Refused: only the Super Admin may modify an Admin account.'
        using errcode = 'insufficient_privilege', hint = 'doc 03 §3.';
    end if;

    if new.role = 'admin' and old.role <> 'admin' then
      raise exception 'Refused: only the Super Admin may grant the Admin role.'
        using errcode = 'insufficient_privilege', hint = 'doc 03 §3.';
    end if;
  end if;

  return new;
end
$$;

comment on function app.enforce_users_write_rules() is
  'Layer 1 of the four in doc 03 §2. Super Admin immutability (BR-027, FR-140), '
  'no self-destruction (FR-156), no promotion to Super Admin (BR-028), no self-elevation '
  '(doc 03 §5), Admins manage downward only (doc 03 §3), and no deletion ever (BR-007). '
  'Fires for every role, including the table owner.';

create trigger users_enforce_write_rules
  before insert or update or delete on public.users
  for each row execute function app.enforce_users_write_rules();


-- ============================================================================
-- PART 4 · SUPER ADMIN MFA CANNOT BE REMOVED   (FR-146)
-- ============================================================================
--   "Super Admin MFA cannot be disabled by any account, including his own."
--
-- Read literally, that would also forbid replacing a lost phone, which would
-- turn a mandatory control into a trap. What the requirement actually protects
-- is the *invariant*: the Super Admin always has at least one working second
-- factor. So rotation is permitted — enrol the new factor, verify it, then
-- retire the old — and reaching zero is not.

create or replace function app.protect_super_admin_mfa()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, app, pg_temp
as $$
declare
  owner_id        uuid := coalesce(old.user_id, new.user_id);
  owner_role      public.user_role;
  remaining       integer;
  losing_a_factor boolean;
begin
  select u.role into owner_role from public.users u where u.id = owner_id;

  if owner_role is distinct from 'super_admin' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- Deleting a verified factor, or un-verifying one, both reduce the count.
  losing_a_factor :=
    (tg_op = 'DELETE' and old.verified_at is not null)
    or (tg_op = 'UPDATE' and old.verified_at is not null and new.verified_at is null);

  if not losing_a_factor then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select count(*) into remaining
  from public.mfa_factors f
  where f.user_id = owner_id
    and f.verified_at is not null
    and f.id <> old.id;

  if remaining > 0 then
    -- Rotation. Fine.
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if app.break_glass_active() then
    insert into public.security_events (user_id, event_type, severity, details)
    values (owner_id, 'break_glass_used', 'critical',
            jsonb_build_object('operation', tg_op, 'table', 'mfa_factors',
                               'note', 'last verified Super Admin factor removed',
                               'db_user', current_user));
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception
    'Refused: the Super Admin must always retain at least one verified MFA factor.'
    using errcode = 'restrict_violation',
          detail  = 'This is the last verified factor on the account.',
          hint    = 'FR-146. Enrol and verify a replacement first, then retire this one.';
end
$$;

comment on function app.protect_super_admin_mfa() is
  'FR-146. The Super Admin''s MFA cannot be reduced to zero verified factors by anyone, '
  'including himself. Rotation is permitted; disablement is not.';

create trigger mfa_factors_protect_super_admin
  before update or delete on public.mfa_factors
  for each row execute function app.protect_super_admin_mfa();


-- ============================================================================
-- PART 5 · THE TEAM DIRECTORY VIEW
-- ============================================================================
-- ADR-003 / doc 16 §7: a Member reads "their own row in full. Other users:
-- name and avatar only — no role, no capacity, no workload, no skills."
--
-- RLS filters rows, not columns, so it cannot express that on its own. The
-- policy below therefore restricts a Member to their own row, and everybody
-- reaches other people's display identity exclusively through this view, which
-- exposes four harmless columns and nothing else.
--
-- security_invoker = false deliberately: the view runs as its owner, so the
-- users policies do not apply to it. That is what lets a Member resolve the
-- name on a comment without being able to see that person's capacity.

create view public.user_directory
  with (security_invoker = false)
as
  select
    u.id,
    u.full_name,
    u.avatar_url,
    u.is_active
  from public.users u;

comment on view public.user_directory is
  'Display identity only: id, name, avatar, active. The ONLY path by which a Member '
  'may see another person (ADR-003, doc 16 §7). Runs as owner by design — it is the '
  'column filter that RLS cannot be.';

grant select on public.user_directory to cni_app;
revoke all on public.user_directory from anon, authenticated;


-- ============================================================================
-- PART 6 · ENABLE ROW-LEVEL SECURITY
-- ============================================================================
-- Enabling RLS with no matching policy denies everything. Every table below is
-- switched on first, so a policy that is forgotten fails closed rather than
-- open.

alter table public.users            enable row level security;
alter table public.auth_identities  enable row level security;
alter table public.invitations      enable row level security;
alter table public.sessions         enable row level security;
alter table public.mfa_factors      enable row level security;
alter table public.recovery_codes   enable row level security;
alter table public.login_attempts   enable row level security;
alter table public.break_glass      enable row level security;
alter table public.audit_log        enable row level security;
alter table public.security_events  enable row level security;
alter table public.skills           enable row level security;
alter table public.user_skills      enable row level security;
alter table public.system_settings  enable row level security;


-- ============================================================================
-- PART 7 · POLICIES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
-- doc 04 §5: "Member reads their own row in full; for all other users, name and
-- avatar only. Admin+ reads all and writes non-Super-Admin rows."
-- Coordinators read all (doc 03: "View another user's profile ✅").

create policy users_select on public.users
  for select to cni_app
  using (
    id = app.current_user_id()
    or app.acting_at_least('team_coordinator')
  );

-- The provisioning chain, FR-141: Super Admin creates Admins, Admins create
-- Coordinators and Members. Nobody creates a Super Admin — the one-time setup
-- route (doc 20 §9 step 5.1) runs through the pre-auth SECURITY DEFINER surface
-- and is capped at a single row by users_single_super_admin_idx.
create policy users_insert on public.users
  for insert to cni_app
  with check (
    case app.current_user_role()
      when 'super_admin' then role in ('admin', 'team_coordinator', 'member')
      when 'admin'       then role in ('team_coordinator', 'member')
      else false
    end
  );

-- USING sees the OLD row, WITH CHECK the NEW one. Between them they express
-- "Admin+ may write anyone except a Super Admin, and may not create one";
-- everything requiring both halves at once is in the trigger (Part 3).
create policy users_update on public.users
  for update to cni_app
  using (
    id = app.current_user_id()
    or (app.acting_at_least('admin') and role <> 'super_admin')
  )
  with check (
    id = app.current_user_id()
    or (app.acting_at_least('admin') and role <> 'super_admin')
  );

-- No DELETE policy, by design. BR-007: deactivate, never delete. The trigger
-- refuses it as well.


-- ----------------------------------------------------------------------------
-- auth_identities
-- ----------------------------------------------------------------------------
-- doc 04 §5: "Readable only by the owning user."
--
-- Asymmetric on purpose. Read is the owner alone — an Admin has no business
-- reading anybody's password hash. Write extends to Admin+ over lower ranks,
-- because doc 03 grants them "Force a password reset" and doc 16 §3 Option B
-- (a temporary password, screen-only) is a write to this table.

create policy auth_identities_select on public.auth_identities
  for select to cni_app
  using (user_id = app.current_user_id());

create policy auth_identities_insert on public.auth_identities
  for insert to cni_app
  with check (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  );

create policy auth_identities_update on public.auth_identities
  for update to cni_app
  using (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  )
  with check (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  );

-- No DELETE: an identity is disabled by clearing its credential, not removed.


-- ----------------------------------------------------------------------------
-- invitations
-- ----------------------------------------------------------------------------
-- "Resend an activation invitation — Super Admin ✅, Admin ✅" (doc 03).
-- Self-service reset and unlock are pre-auth and go through the definer
-- surface (registry C-15), so they need no policy here.

create policy invitations_select on public.invitations
  for select to cni_app
  using (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  );

create policy invitations_insert on public.invitations
  for insert to cni_app
  with check (app.acting_at_least('admin') and app.acting_outranks(user_id));

-- Invalidating a superseded token (FR-155) and consuming one.
create policy invitations_update on public.invitations
  for update to cni_app
  using (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  )
  with check (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  );


-- ----------------------------------------------------------------------------
-- sessions
-- ----------------------------------------------------------------------------
-- doc 04 §5: "User reads and revokes only their own. Super Admin reads all."
-- The Super Admin also writes, because doc 16 §12's first move in every
-- incident is "revoke all sessions".

create policy sessions_select on public.sessions
  for select to cni_app
  using (
    user_id = app.current_user_id()
    or app.current_user_role() = 'super_admin'
  );

create policy sessions_insert on public.sessions
  for insert to cni_app
  with check (user_id = app.current_user_id());

create policy sessions_update on public.sessions
  for update to cni_app
  using (
    user_id = app.current_user_id()
    or app.current_user_role() = 'super_admin'
  )
  with check (
    user_id = app.current_user_id()
    or app.current_user_role() = 'super_admin'
  );

-- No DELETE: sessions are revoked (revoked_at), never erased. A deleted session
-- row is a deleted piece of the sign-in history.


-- ----------------------------------------------------------------------------
-- mfa_factors
-- ----------------------------------------------------------------------------
-- Owner-managed. DELETE additionally allows Admin+ over lower ranks, matching
-- doc 03's "Reset another user's MFA — Super Admin ✅🔒, Admin ⚠️
-- Coordinator/Member only". FR-146 is enforced by the trigger in Part 4, above
-- and independent of this.

create policy mfa_factors_select on public.mfa_factors
  for select to cni_app
  using (user_id = app.current_user_id());

create policy mfa_factors_insert on public.mfa_factors
  for insert to cni_app
  with check (user_id = app.current_user_id());

create policy mfa_factors_update on public.mfa_factors
  for update to cni_app
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy mfa_factors_delete on public.mfa_factors
  for delete to cni_app
  using (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and app.acting_outranks(user_id))
  );


-- ----------------------------------------------------------------------------
-- recovery_codes
-- ----------------------------------------------------------------------------
-- Owner only. Redemption happens pre-auth through the definer surface.
-- Re-issuing replaces the set, which is a delete followed by ten inserts.

create policy recovery_codes_select on public.recovery_codes
  for select to cni_app
  using (user_id = app.current_user_id());

create policy recovery_codes_insert on public.recovery_codes
  for insert to cni_app
  with check (user_id = app.current_user_id());

create policy recovery_codes_delete on public.recovery_codes
  for delete to cni_app
  using (user_id = app.current_user_id());


-- ----------------------------------------------------------------------------
-- login_attempts   (append-only; UPDATE/DELETE blocked by trigger and grant)
-- ----------------------------------------------------------------------------
-- Members see their own, which is what powers doc 16 §4's "3 failed sign-in
-- attempts on your account since your last login" notice. Admin+ see all,
-- which is what powers "5+ failed logins on any account → Admins" (doc 16 §10).

create policy login_attempts_select on public.login_attempts
  for select to cni_app
  using (
    app.acting_at_least('admin')
    or user_id = app.current_user_id()
  );

create policy login_attempts_insert on public.login_attempts
  for insert to cni_app
  with check (true);


-- ----------------------------------------------------------------------------
-- break_glass   —   NO POLICIES, DELIBERATELY
-- ----------------------------------------------------------------------------
-- doc 04 §5: "No client read path at all. Server-side verification only."
-- RLS is enabled and nothing is granted, so the application role cannot read,
-- write or even count these rows. Privileges are revoked below as well.


-- ----------------------------------------------------------------------------
-- audit_log   (append-only)
-- ----------------------------------------------------------------------------
-- doc 03: "See the system audit log — Super Admin ✅🔒, Admin ⚠️ read-only,
-- own scope, Coordinator ❌, Member ❌."
--
-- "Own scope" is interpreted here as: an Admin may not read entries whose actor
-- was the Super Admin. An audit trail the audited party's subordinate can read
-- in full is not much of a control in either direction. Raised as Q-054 for
-- confirmation.

create policy audit_log_select on public.audit_log
  for select to cni_app
  using (
    app.current_user_role() = 'super_admin'
    or (
      app.current_user_role() = 'admin'
      and coalesce(actor_role, 'member') <> 'super_admin'
    )
  );

-- Any identified actor may append. What gets written is layer 3's business
-- (I-6: server actions call audit.record() inside the same transaction).
create policy audit_log_insert on public.audit_log
  for insert to cni_app
  with check (app.current_user_id() is not null);


-- ----------------------------------------------------------------------------
-- security_events   (append-only)
-- ----------------------------------------------------------------------------
-- doc 03: "See the security dashboard — Super Admin ✅🔒" and nobody else.
-- Inserts are unrestricted because the most important security events —
-- a failed sign-in, an unknown account, a locked account — happen when nobody
-- is authenticated at all.

create policy security_events_select on public.security_events
  for select to cni_app
  using (app.current_user_role() = 'super_admin');

create policy security_events_insert on public.security_events
  for insert to cni_app
  with check (true);


-- ----------------------------------------------------------------------------
-- skills
-- ----------------------------------------------------------------------------
-- Readable by anyone signed in: a Member's own profile lists their skills, and
-- that join has to resolve. Writable by Admin+ ("Edit the skills library —
-- Super Admin ✅, Admin ✅").

create policy skills_select on public.skills
  for select to cni_app
  using (app.current_user_id() is not null);

create policy skills_write on public.skills
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));


-- ----------------------------------------------------------------------------
-- user_skills
-- ----------------------------------------------------------------------------
-- ADR-003: a Member reads only their own. Coordinator+ read all — doc 03 gives
-- them "See another member's skills or capacity ✅", which is what lets them
-- assign work. Only Admin+ may set them (doc 03: "Set capacity, skills, max
-- concurrent tasks"); self-rated proficiency would corrupt the scoring input
-- the assignment engine depends on most (skill = 0.38).

create policy user_skills_select on public.user_skills
  for select to cni_app
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('team_coordinator')
  );

create policy user_skills_write on public.user_skills
  for all to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));


-- ----------------------------------------------------------------------------
-- system_settings
-- ----------------------------------------------------------------------------
-- doc 04 §5: "Read by all authenticated users; write by Super Admin (some keys
-- by Admin)."
--
-- This is deliberately the coarse half of the two layers. doc 19 §5 assigns
-- each individual key to Super Admin or Admin; expressing that here would mean
-- copying the key list into a policy and maintaining it in two places. The
-- per-key rule lives in lib/domain/permissions.ts and is applied by the server
-- action. Registry §9a records the split.

create policy system_settings_select on public.system_settings
  for select to cni_app
  using (app.current_user_id() is not null);

create policy system_settings_insert on public.system_settings
  for insert to cni_app
  with check (app.acting_at_least('admin'));

create policy system_settings_update on public.system_settings
  for update to cni_app
  using (app.acting_at_least('admin'))
  with check (app.acting_at_least('admin'));

-- Deleting an override means "return this setting to its documented default",
-- which is a Super Admin act.
create policy system_settings_delete on public.system_settings
  for delete to cni_app
  using (app.current_user_role() = 'super_admin');


-- ============================================================================
-- PART 8 · TABLE PRIVILEGES FOR cni_app
-- ============================================================================
-- RLS decides which ROWS. Grants decide which OPERATIONS. Both are needed:
-- a policy cannot permit what no grant allows, and a grant cannot narrow what
-- a policy permits.

grant select, insert, update, delete on all tables in schema public to cni_app;

-- Append-only (doc 19 §6). The trigger from migration 003 is the real guard —
-- it binds the owner too — but removing the grant means the ordinary path
-- fails at the privilege check, before a trigger ever has to intervene.
revoke update, delete, truncate on public.audit_log       from cni_app;
revoke update, delete, truncate on public.security_events from cni_app;
revoke update, delete, truncate on public.login_attempts  from cni_app;

-- BR-007. Deactivation, never deletion.
revoke delete, truncate on public.users from cni_app;

-- Sessions are revoked, not erased.
revoke delete, truncate on public.sessions from cni_app;

-- doc 04 §5: no client path to the sealed credential, in either direction.
revoke all on public.break_glass from cni_app;

-- ⚠️ user_directory must be READ-ONLY.
--
-- A simple single-table view is auto-updatable in Postgres, and this one runs as
-- its owner. Writable, it would be a complete RLS bypass on `users`: any Member
-- could INSERT or UPDATE through it with no policy consulted. The blanket grant
-- above covers views, so the write privileges have to come back off explicitly.
-- (The users trigger would still catch a Super Admin write, but the other
-- policies would simply not be evaluated.)
revoke insert, update, delete, truncate on public.user_directory from cni_app;

-- Skills are retired via is_active, not deleted — the RESTRICT foreign key on
-- user_skills would refuse anyway, but this says so at the privilege level.
revoke delete, truncate on public.skills from cni_app;
