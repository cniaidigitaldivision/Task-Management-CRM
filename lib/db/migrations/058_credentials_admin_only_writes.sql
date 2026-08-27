-- ============================================================================
-- 058 · WRITING A CREDENTIAL IS AN ADMIN ACT. NOBODY ELSE.
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-25:
--
--   "there is no option in the admin panel where I can assign these credentials
--    to somebody. Also only the admin is able to assign, add, delete, or manage
--    who can view this whole project: credential plus any specific credential."
--
-- ── ⚠️ THIS REVERSES AN INSTRUCTION FROM THE DAY BEFORE, ON PURPOSE ─────────
-- Owner, 2026-08-24: *"Access can only be added by admins or team coordinators."*
-- Migration 049 was written to implement exactly that and was never applied. It
-- is now SUPERSEDED and must not be run — applying it after this would hand
-- Coordinators back the write access this migration takes away, and the two would
-- fight depending on which ran last.
--
-- ⚠️ 049 IS LEFT ON DISK RATHER THAN DELETED. Its header explains a real bug it
-- found — that migration 047 moved SELECT and forgot the three write policies —
-- and that explanation is why the policies looked the way they did. Deleting the
-- file would delete the diagnosis with it. Its opening comment says it is
-- superseded.
--
-- ── WHAT ACTUALLY CHANGES ───────────────────────────────────────────────────
-- Before this, from migration 023:
--
--     credentials_insert   admin+  OR  I own the project it belongs to   ⚠️
--     credentials_update   admin+  OR  I own the project it belongs to   ⚠️
--     credentials_delete   admin+                                        (kept)
--
-- The project-owner route is what goes. It let whoever owns a project add and edit
-- the credentials attached to it — which for this division can be a Coordinator or
-- a Member, since project ownership is not a rank. That is precisely the hole the
-- owner is closing: "only the admin".
--
-- ⚠️ READING IS NOT TOUCHED. `app.can_read_credential` still admits Coordinator
-- and above, plus anybody holding a named grant (migrations 047 and 050). The
-- owner named four verbs — assign, add, delete, manage who can view — and looking
-- is not among them. A Coordinator can still see a credential to do their job and
-- can no longer change one.
--
-- ⚠️ THE APPLICATION MATRIX IS CHANGED IN THE SAME BREATH. Before today
-- `credential.manage` and `credential.delete` were `allow` for a Team Coordinator
-- in lib/domain/permissions.ts while `credentials_delete` here was admin-only — so
-- a Coordinator was shown a Delete button that the database then refused. An
-- application more permissive than its policies does not leak anything; it just
-- lies to somebody about what they can do. Both halves now say admin.
-- ============================================================================

-- ── INSERT ──────────────────────────────────────────────────────────────────
drop policy if exists credentials_insert on public.credentials;
create policy credentials_insert on public.credentials
  for insert
  with check (app.acting_at_least('admin'::public.user_role));

-- ── UPDATE ──────────────────────────────────────────────────────────────────
-- ⚠️ `using` AND `with check`, not just `using`. Without the check half a row
-- could pass the policy on the way in and be updated into a shape that would not
-- pass it again — for credentials that means re-pointing one at another project.
-- Both sides are the same rank test, which is what makes that impossible.
drop policy if exists credentials_update on public.credentials;
create policy credentials_update on public.credentials
  for update
  using (app.acting_at_least('admin'::public.user_role))
  with check (app.acting_at_least('admin'::public.user_role));

-- ── DELETE ──────────────────────────────────────────────────────────────────
-- Already admin-only from migration 023. Restated so all three write policies read
-- from one place rather than two migrations apart.
drop policy if exists credentials_delete on public.credentials;
create policy credentials_delete on public.credentials
  for delete
  using (app.acting_at_least('admin'::public.user_role));

comment on table public.credentials is
  'Client and project logins the division holds. READ: Coordinator and above, or '
  'anybody with a named grant (047, 050). WRITE: Admin and above only (058) — the '
  'project-owner route was removed because project ownership is not a rank. '
  'Migration 049 would re-grant Coordinator writes and is superseded.';

-- ── Prove it, rather than assuming ──────────────────────────────────────────
-- ⚠️ Every check I ran while building the credential grants was as the migration
-- owner, which bypasses both RLS and table privileges — that is how migration 050
-- shipped with policies and no GRANT and broke the Access tab. So this asserts the
-- shape of what was just created instead of trusting that it took.
do $$
declare
  bad text;
begin
  select string_agg(policyname || ' (' || cmd || ')', ', ')
    into bad
    from pg_policies
   where tablename = 'credentials'
     and cmd in ('INSERT', 'UPDATE', 'DELETE')
     and coalesce(qual, '') || coalesce(with_check, '') like '%owner_id%';

  if bad is not null then
    raise exception 'a project-owner route survived on: %', bad;
  end if;

  raise notice 'Credential writes are admin-only on all three policies.';
end $$;
