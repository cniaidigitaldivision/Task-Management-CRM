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
 * Can a task be destroyed permanently?
 *
 * **No, until a `tasks_delete` RLS policy exists.** `public.tasks` has
 * row-level security enabled and only `tasks_select`, `tasks_insert` and
 * `tasks_update` policies. With RLS on, a command with no policy is refused for
 * every row — so a delete affects **nothing and raises nothing**. Measured
 * against the real database as the Super Admin through `cni_app`: 0 rows.
 *
 * That is the same trap Session 11 hit, where a Super-Admin-only delete policy
 * meant an Admin's Reset deleted zero rows with no error at all.
 *
 * To turn this on: a migration adding
 *
 *     create policy tasks_delete on public.tasks for delete to cni_app
 *       using (app.current_user_role() = 'super_admin');
 *
 * then flip this to `true`. The application side — permission check, step-up,
 * impact dialog, storage cleanup, audit entry — is already written and waiting.
 */
export const PURGE_IS_AVAILABLE = false;
