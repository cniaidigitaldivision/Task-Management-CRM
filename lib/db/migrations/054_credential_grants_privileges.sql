-- ============================================================================
-- 054 · THE GRANT MIGRATION 050 FORGOT
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24, looking at the Access tab: a red banner reading *"Who has been
-- given this credential could not be read, so the list below shows only the people
-- who can open it by role."*
--
-- ── ⚠️ WHAT WENT WRONG: A POLICY WITHOUT A PRIVILEGE ─────────────────────────
-- Migration 050 created `public.credential_grants`, enabled row-level security on
-- it, and wrote three policies `to cni_app`. What it never did was
--
--     grant select, insert, delete on public.credential_grants to cni_app;
--
-- and RLS only ever NARROWS what a grant already permits. With no grant there was
-- nothing to narrow, so every read failed with
--
--     42501: permission denied for table credential_grants
--
-- Migration 005 says this in as many words — *"a policy cannot permit what no grant
-- allows"* — and grants `select, insert, update, delete on ALL TABLES IN SCHEMA
-- public`, which covers the tables existing in 005 and nothing created afterwards.
-- Its `alter default privileges` block only REVOKES from `anon` and `authenticated`
-- for future tables; it does not grant to `cni_app`. So every table added since has
-- had to grant explicitly, and migration 023 duly did for `public.credentials`.
-- 050 did not.
--
-- ── HOW IT SURVIVED THE CHECKS ──────────────────────────────────────────────
-- Every verification of 050 ran as the migration owner, which bypasses both the
-- grant and the policies: the table existed, the policies were right, the read rule
-- returned the correct answers for every role. The one thing not tested was the one
-- thing that was broken — a query issued the way the application issues it, as
-- `cni_app` with `app.user_id` set. Reproduced afterwards in three lines.
--
-- ── ⚠️ NO UPDATE PRIVILEGE, DELIBERATELY ────────────────────────────────────
-- Migration 050 states that a grant has nothing worth editing and gave it no UPDATE
-- policy. Migration 052 then added `effect` and made the write an UPSERT, so UPDATE
-- is now genuinely needed — and it needs a policy as well as a privilege, which is
-- added below. Changing your mind about one person is an update of their row, not a
-- delete and a re-insert, so that the primary key keeps its promise that nobody can
-- be allowed and denied at once.
--
-- ── TWO OTHER TABLES LACK THE PRIVILEGE AND MUST KEEP LACKING IT ────────────
-- `public.drive_connection` and `public.reference_counters` are also unreachable by
-- `cni_app`, and that is deliberate rather than the same mistake:
-- `lib/db/queries/drive.ts` says outright that the privilege is withheld so a
-- direct select cannot reach the refresh token, and both are read through
-- SECURITY DEFINER functions instead. They are named here so that whoever next runs
-- the "which tables can cni_app not see" query does not helpfully grant them.
-- ============================================================================

grant select, insert, update, delete on public.credential_grants to cni_app;

-- ── THE UPDATE POLICY THAT THE UPSERT NEEDS ─────────────────────────────────
-- Same rank test as insert and delete: Admin and above. `with check` as well as
-- `using` — without the second half an Admin could update a row into naming
-- somebody else as its author, which is the one fact the row exists to record.
drop policy if exists credential_grants_update on public.credential_grants;
create policy credential_grants_update on public.credential_grants
  for update to cni_app
  using (app.acting_at_least('admin'::public.user_role))
  with check (
    app.acting_at_least('admin'::public.user_role)
    and granted_by_id = app.current_user_id()
  );

-- ⚠️ A verification block, because the failure this fixes was invisible to every
-- check that ran as the owner. This one runs as the application does.
do $$
declare n int;
begin
  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', (select id::text from public.users
                                      where role = 'super_admin' and is_active limit 1), true);
  select count(*) into n from public.credential_grants;
  reset role;
  raise notice 'credential_grants is readable as cni_app (% rows).', n;
exception when insufficient_privilege then
  reset role;
  raise exception 'credential_grants is STILL not readable as cni_app — the grant did not take.';
end $$;
