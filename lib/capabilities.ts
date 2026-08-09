/* ============================================================================
 * WHAT THE DATABASE CAN ACTUALLY DO YET
 * ----------------------------------------------------------------------------
 * Flags for features whose code is complete but whose SCHEMA is not, because
 * the missing piece is a migration and migrations wait for the owner's
 * go-ahead (rule R1).
 *
 * Deliberately NOT in lib/db/ — both a server action and a client component
 * need to read these, and everything under lib/db/ starts with `import
 * 'server-only'`, which makes importing it from a client component a build
 * error. That guard is correct and is not being worked around; this module
 * simply holds no server code, so it is safe on both sides.
 *
 * Each flag is one line to flip, and each names exactly what has to exist first.
 * ========================================================================= */

/**
 * Can a task be destroyed permanently? **Yes, since migration 019.**
 *
 * ── WHAT THIS FLAG IS A MONUMENT TO ──────────────────────────────────────────
 * `public.tasks` had row-level security enabled and only `tasks_select`,
 * `tasks_insert` and `tasks_update` policies. With RLS on, a command with NO
 * policy is refused for every row — and the refusal is silent: the statement
 * succeeds and reports zero rows. The DELETE privilege was already granted to
 * `cni_app`, so it looked permitted while every row was refused.
 *
 * Measured before the migration, as the Super Admin through `cni_app`: **0 rows
 * deleted.** The same shape Session 11 hit, where a Super-Admin-only delete
 * policy meant an Admin's Reset deleted zero rows with no error.
 *
 * Migration 019 added `tasks_delete`, restricted to
 * `app.current_user_role() = 'super_admin'`, and
 * `test/integration/task-purge.test.ts` now proves all of it against the real
 * database: the Super Admin can, an Admin and a Member cannot, the children
 * cascade, and the audit trail survives because it holds a snapshot rather than
 * a foreign key.
 *
 * The flag is kept rather than deleted — it is the one place that records why
 * this was ever broken, and if the policy is dropped it is the switch that
 * turns the feature off honestly instead of letting it fail silently again.
 */
export const PURGE_IS_AVAILABLE = true;
