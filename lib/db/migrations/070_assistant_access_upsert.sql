-- ============================================================================
-- 070 · AN UPSERT NEEDS THE UPDATE PRIVILEGE, EVEN WITH NO UPDATE POLICY
-- ----------------------------------------------------------------------------
-- Found by switching the assistant on for a Member, 2026-08-27:
--
--     ERROR: 42501: permission denied for table assistant_access
--
-- ── ⚠️ TWO DIFFERENT MECHANISMS, AND MIGRATION 069 CONFLATED THEM ──────────
-- 069 deliberately gave `assistant_access` no UPDATE **policy**, so that a
-- grant cannot be quietly edited to name a different author. That reasoning is
-- correct and is kept.
--
-- What it also did — by omission — was withhold the UPDATE **privilege**:
--
--     grant select, insert, delete on public.assistant_access to cni_app;
--
-- Those are separate layers. A GRANT decides whether the command may be
-- attempted at all; a POLICY decides which rows it may touch. Postgres checks
-- the grant FIRST, and refuses with a bare `permission denied` — not an RLS
-- message — so the failure looks nothing like a policy problem and sends
-- whoever debugs it to the wrong file.
--
-- `insert ... on conflict do update` is an UPDATE for grant purposes. So the
-- upsert in `setAssistantAccess` could never run, and the owner's switch was
-- dead on every row that already had one.
--
-- ── WHAT THIS CHANGES, AND WHAT IT DOES NOT ────────────────────────────────
-- The privilege is granted. The absence of an UPDATE policy still stands, and
-- still does its job: with RLS enabled and no policy for a command, that
-- command matches zero rows. So a bare `update public.assistant_access set ...`
-- is refused exactly as before — it simply now fails as "no rows" rather than
-- as "permission denied".
--
-- The upsert works because `on conflict do update` runs under the INSERT
-- policy's `with check`, which requires `granted_by_id = app.current_user_id()`.
-- The row still cannot be made to name somebody else, which was the whole point.
--
-- ⚠️ `credential_grants` (migration 050) has the identical shape and the
-- identical grant — `setCredentialAccess` upserts against it — which is why
-- that one works and this one did not. The difference was one word in a GRANT.
-- ============================================================================

grant update on public.assistant_access to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  -- The privilege must now be there.
  if not has_table_privilege('cni_app', 'public.assistant_access', 'UPDATE') then
    raise exception 'cni_app still cannot UPDATE assistant_access, so the upsert will fail.';
  end if;

  -- ...and the policy must still be absent, or the protection 069 added is gone.
  if exists (
    select 1 from pg_policies
     where tablename = 'assistant_access' and cmd = 'UPDATE'
  ) then
    raise exception
      'An UPDATE policy appeared on assistant_access. The privilege is enough for the '
      'upsert; a policy would also permit a bare UPDATE, which could re-author a grant.';
  end if;

  raise notice 'Upsert enabled: UPDATE granted, no UPDATE policy. A bare update still matches nothing.';
end $$;
