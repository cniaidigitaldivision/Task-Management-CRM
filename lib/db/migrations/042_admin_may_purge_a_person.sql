-- ============================================================================
-- 042 · AN ADMINISTRATOR MAY REMOVE A PERSON WHO HAS MADE NOTHING
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-23: *"I'm adding someone and I couldn't delete it. I don't
-- want to dump my database with the testing or dummy data."*
--
-- Migration 041 removed the accidental blocker (the append-only trigger firing
-- on the foreign key's own `set null`). This removes the deliberate one, which
-- until now had exactly two settings: break-glass, or never.
--
-- ── WHY NOT JUST CALL withBreakGlass() FROM THE ACTION ───────────────────────
-- Because break-glass is the sealed emergency path. It writes a `critical`
-- security event, it is documented as the thing you reach for when the
-- application cannot help you (doc 16 §6), and lib/db/client.ts says in as many
-- words that nothing in the application calls it. Routing an everyday "remove
-- this test account" through it would make `critical` mean nothing within a
-- week, and would move the authorisation decision OUT of the database and into
-- whichever action remembered to check first — the exact inversion the
-- four-layer model exists to prevent.
--
-- So the rule goes here, where it is enforced against every path including a
-- psql session, and the application asks permission rather than granting it.
--
-- ── THE RULE ─────────────────────────────────────────────────────────────────
-- A DELETE on `users` is permitted when the acting session is identified, holds
-- admin or super_admin, is not deleting itself, and STRICTLY outranks the
-- target. Everything else still raises, with the same message as before.
--
-- Strictly outranks, not "at least": deactivation lets an Admin manage a peer,
-- but a permanent delete between equals is how two Admins remove each other,
-- and it makes the Super Admin row undeletable by construction — its rank is
-- never greater than its own.
--
-- ⚠️ BR-007 IS NOT REPEALED. *"Accounts are deactivated, never deleted"* stays
-- true for every account that has done anything, and the thirteen RESTRICT
-- foreign keys on authored content — tasks created, comments, projects owned,
-- time logged, documents uploaded — enforce that no matter what this function
-- allows. This changes nothing for a person who has worked here. It only stops
-- a mistyped invitation from being permanent.
--
-- The purge is recorded as a `warning` security event, attributed to the actor,
-- naming the address that was removed. `activity_log` cannot carry it: the row
-- it would point at is the one being deleted.
-- ============================================================================

create or replace function app.enforce_users_write_rules()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor       uuid             := app.current_user_id();
  actor_role  public.user_role := app.current_user_role();
  breaking    boolean          := app.break_glass_active();
  auth_only   boolean;
begin

  if tg_op = 'DELETE' then
    if breaking then
      insert into public.security_events (user_id, event_type, severity, details)
      values (old.id, 'break_glass_used', 'critical',
              jsonb_build_object('operation', 'DELETE', 'table', 'users',
                                 'target_role', old.role, 'db_user', current_user));
      return old;
    end if;

    -- Migration 042. An identified administrator, removing somebody below them
    -- who is not themselves. See the header for why this is not break-glass.
    if actor is not null
       and actor_role in ('admin', 'super_admin')
       and actor <> old.id
       and app.role_rank(actor_role) > app.role_rank(old.role)
    then
      insert into public.security_events (user_id, event_type, severity, details)
      values (old.id, 'user_purged', 'warning',
              jsonb_build_object('actor_id', actor,
                                 'actor_role', actor_role,
                                 'target_role', old.role,
                                 'target_email', old.email,
                                 'target_name', old.full_name));
      return old;
    end if;

    raise exception
      'DELETE on users is forbidden: accounts are deactivated, never deleted.'
      using errcode = 'restrict_violation',
            detail  = format('Attempted on user %s (%s) by %s (%s).',
                             old.id, old.role,
                             coalesce(actor::text, 'an unidentified session'),
                             coalesce(actor_role::text, 'no role')),
            hint    = 'Set is_active = false. BR-007, doc 03 §7. An Admin or '
                      'Super Admin may delete somebody strictly below their own '
                      'rank who has authored nothing (migration 042).';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

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
    and new.account_state in ('active', 'locked',
                              'password_reset_required', 'mfa_setup_required');

  if old.role = 'super_admin' then

    if breaking then
      insert into public.security_events (user_id, event_type, severity, details)
      values (old.id, 'break_glass_used', 'critical',
              jsonb_build_object('operation', 'UPDATE', 'table', 'users',
                                 'db_user', current_user));
      return new;

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

  if new.role = 'super_admin' then
    raise exception 'Refused: no account may be promoted to Super Admin.'
      using errcode = 'restrict_violation',
            hint    = 'BR-028, doc 03 §3. A second Super Admin is doc 16 §6 only.';
  end if;

  if new.role <> old.role and actor is not null and actor = old.id then
    raise exception 'Refused: an account cannot change its own role.'
      using errcode = 'insufficient_privilege',
            detail  = format('Attempted %s -> %s on self.', old.role, new.role),
            hint    = 'doc 03 §5.';
  end if;

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
$function$;
