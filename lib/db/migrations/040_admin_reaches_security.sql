-- =============================================================================
-- 040 · THE ADMIN REACHES THE SECURITY SCREEN
-- -----------------------------------------------------------------------------
-- Owner, 2026-08-22: *"the admin today cannot open security … I want the admin to
-- be able to do it … Definitely I want that."*
--
-- ── ⚠️ WHY A MIGRATION AT ALL, WHEN THIS IS A PERMISSION CHANGE ───────────────
-- Because `can()` is one of four enforcement layers (doc 03 §2) and it is not the
-- one that decides which ROWS come back. Flipping `security_dashboard.view` to
-- 'allow' for an Admin opens the route — and then every panel on it renders empty,
-- because the policies below still answered `super_admin` only.
--
-- An empty security dashboard does not read as "you may not see this". It reads as
-- a broken page, and the person who granted the permission goes looking for a bug
-- in the query. That is the specific failure this migration prevents, and it is why
-- the matrix change and this file have to land together.
--
-- ── WHAT IS DELIBERATELY NOT CHANGED ─────────────────────────────────────────
--   · `audit_log_select` already admits an Admin and already HIDES the Super
--     Admin's own entries from them (Q-054). That asymmetry is the point and it
--     stays: an Admin can audit the team, not the person above them.
--   · `login_attempts_select` already admits an Admin. Untouched.
--   · `users_update` still refuses any write to a Super Admin row (migration 005).
--     An Admin can now END a Super Admin's session; they still cannot edit,
--     demote, lock or deactivate the account. Being signed out is recoverable.
--   · `system_settings_delete` stays Super Admin only. Changing a setting is
--     running the division; deleting the row that holds it is not.
--
-- ── ⚠️ `sessions_update` IS THE ONE WITH REAL TEETH ──────────────────────────
-- It is what lets the screen's "revoke" button work, and it does not distinguish
-- whose session is being ended. Granting it means an Admin can sign the Super
-- Admin out. The owner was told this in those words and chose full parity.
--
-- To reverse JUST that — Admin sees every session, revokes only their own —
-- restore the original expression on `sessions_update` and leave the other two:
--
--     alter policy sessions_update on public.sessions
--       using       (user_id = app.current_user_id()
--                    or app.current_user_role() = 'super_admin')
--       with check  (user_id = app.current_user_id()
--                    or app.current_user_role() = 'super_admin');
-- =============================================================================

-- ⚠️ No `begin`/`commit` here. scripts/migrate.mjs already wraps the file in a
-- transaction, and nesting one makes Postgres warn "there is already a
-- transaction in progress" and then "there is no transaction in progress" —
-- harmless, but it reads like the migration half-failed.

-- 1 · The event feed — the dashboard's main panel.
alter policy security_events_select on public.security_events
  using (app.acting_at_least('admin'::public.user_role));

-- 2 · Live sessions. Without this an Admin opens the Sessions panel and sees
--     only their own — which looks like the feature is broken, not restricted.
alter policy sessions_select on public.sessions
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );

-- 3 · Revoking. `sessions_update` is how a session is ended, so without it the
--     panel lists sessions it cannot act on.
alter policy sessions_update on public.sessions
  using (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  )
  with check (
    user_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );
