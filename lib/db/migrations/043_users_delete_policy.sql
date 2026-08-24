-- ============================================================================
-- 043 · THE ROW-LEVEL HALF OF "AN ADMIN MAY REMOVE A PERSON"
-- ----------------------------------------------------------------------------
-- Migration 042 taught the trigger to permit an administrator's DELETE. It was
-- not enough, and the way it failed is worth recording because it is silent.
--
-- `users` had policies for SELECT, INSERT and UPDATE — and none for DELETE.
-- With RLS enabled, a command with no policy is not an error: the rows simply
-- do not exist as far as that command is concerned. So the delete "succeeded",
-- reported zero rows affected, the trigger never fired, and nothing was
-- removed. A caller that did not check `row_count` would have shown a cheerful
-- confirmation and left the account exactly where it was.
--
-- ⚠️ THAT IS WHY THE ACTION CHECKS THE ROW COUNT and treats zero as a refusal.
-- Nothing else in the stack would have told it.
--
-- ── THE POLICY DELIBERATELY RESTATES THE TRIGGER ─────────────────────────────
-- The same rule now lives in three places: the permission matrix, this policy,
-- and `enforce_users_write_rules`. That is the four-layer model working as
-- intended (doc 04) rather than duplication to be tidied away — the policy
-- decides which rows are visible to a DELETE, the trigger decides whether the
-- operation is legitimate and records it, and neither can be reached around.
--
-- Break-glass is unaffected: it runs as the connection's own role rather than
-- `cni_app`, and RLS does not apply to it.
-- ============================================================================

create policy users_delete on public.users
  for delete
  using (
    -- An identified session. An anonymous one deletes nothing.
    app.current_user_id() is not null
    and app.current_user_role() in ('admin', 'super_admin')
    -- Never yourself: deactivation is reversible, this is not.
    and id <> app.current_user_id()
    -- Strictly below. Makes the Super Admin row undeletable by construction,
    -- and stops two Admins from being able to remove each other.
    and app.role_rank(app.current_user_role()) > app.role_rank(role)
  );

comment on policy users_delete on public.users is
  'Migration 043. An Admin or Super Admin may delete somebody strictly below '
  'their own rank, never themselves. The RESTRICT foreign keys on authored '
  'content still refuse anybody who has made anything; BR-007 stands for them.';
