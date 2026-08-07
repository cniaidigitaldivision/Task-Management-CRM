-- ============================================================================
-- 018 · READING SOMEBODY ELSE'S NOTIFICATION PREFERENCES
-- ----------------------------------------------------------------------------
-- Adds:  app.notification_prefs_for(uuid)
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- `users_select` (migration 005) is
--
--     id = app.current_user_id() or app.acting_at_least('team_coordinator')
--
-- which is right: a Member has no business reading colleagues' rows. But
-- `notify()` has to ask "does this person want to hear about this?", and it
-- runs inside the ACTOR's transaction. So when Yusra — a Member — comments on
-- a task assigned to Kashif, the lookup returns nothing and the preference
-- falls back to the default.
--
-- The result would be a switch that works when a Coordinator triggers the
-- notification and silently does not when a Member does. That is worse than
-- having no switch: the person turns something off, it keeps arriving
-- sometimes, and they stop trusting every other control on the screen.
--
-- ── WHY THIS IS SAFE ─────────────────────────────────────────────────────────
-- It returns ONE jsonb column for ONE row and nothing else — no name, no email,
-- no role, no capacity. The content is a set of booleans about which
-- notifications somebody wants; there is no version of that which is sensitive,
-- and the caller already knows the user id because they are about to notify
-- them.
--
-- It cannot be used to enumerate: an unknown id returns an empty object, the
-- same answer as a real user who has changed nothing. And it cannot write.
-- ============================================================================

create or replace function app.notification_prefs_for(target_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select u.notification_prefs from public.users u where u.id = target_id),
    '{}'::jsonb
  )
$$;

comment on function app.notification_prefs_for(uuid) is
  'One user''s notification preferences, and nothing else about them. SECURITY '
  'DEFINER so notify() can honour a recipient''s choices when the actor is a '
  'Member who cannot read their row. Returns {} for an unknown id, so it cannot '
  'be used to test whether an account exists.';

revoke all on function app.notification_prefs_for(uuid) from public;
grant execute on function app.notification_prefs_for(uuid) to cni_app;
