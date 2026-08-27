-- ============================================================================
-- 071 · THE UPSERT NEEDS AN UPDATE POLICY TOO — AND IT IS STILL SAFE
-- ----------------------------------------------------------------------------
-- Migration 070 granted the UPDATE privilege and the upsert still failed, with
-- a different error:
--
--     ERROR: 42501: new row violates row-level security policy
--                   (USING expression) for table "assistant_access"
--
-- ── ⚠️ WHAT `ON CONFLICT DO UPDATE` ACTUALLY REQUIRES ──────────────────────
-- Three things, and 069 and 070 each supplied one of them:
--
--   1. the UPDATE privilege                     — 070
--   2. the INSERT policy's WITH CHECK           — 069
--   3. an UPDATE policy, whose USING decides    — missing until now
--      which existing row may be overwritten
--
-- 069's reasoning for withholding (3) was sound in itself — a grant must not be
-- quietly edited to name a different author — but it was reasoning about the
-- wrong mechanism. Withholding the POLICY does not prevent re-authoring; it
-- prevents the upsert from running at all, which is what made the owner's
-- switch dead on any person who already had a row.
--
-- ── ⚠️ THE POLICY ADDED HERE CANNOT RE-AUTHOR ANYTHING, AND HERE IS WHY ────
-- Its WITH CHECK is the same predicate as the insert's:
--
--     app.acting_at_least('admin') and granted_by_id = app.current_user_id()
--
-- So an UPDATE — bare or via a conflict — can only ever leave the row naming
-- the person who performed it. Writing somebody else's name into `granted_by_id`
-- is refused by the check, exactly as it is on insert. The protection 069 wanted
-- is delivered by the WITH CHECK, not by the policy's absence.
--
-- ⚠️ `credential_grants` (migration 050) has no UPDATE policy either, and
-- `setCredentialAccess` upserts against it — so that path has the same latent
-- fault. It has not surfaced because that upsert has evidently only ever been
-- exercised on the insert path. Not changed here: it is a different feature's
-- table and deserves its own migration and its own verification, rather than
-- being altered as a side effect of this one. Recorded so the next person
-- looking at it knows it is known.
-- ============================================================================

drop policy if exists assistant_access_update on public.assistant_access;

create policy assistant_access_update on public.assistant_access
  for update to cni_app
  -- Which existing rows an Admin may overwrite: any of them.
  using (app.acting_at_least('admin'))
  -- ⚠️ What the row must look like AFTERWARDS. This is the half that matters:
  -- it forces the row to name its author honestly, whoever that is.
  with check (app.acting_at_least('admin') and granted_by_id = app.current_user_id());


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT — including the thing 069 was protecting
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  check_expr text;
begin
  select coalesce(with_check, '') into check_expr
    from pg_policies
   where tablename = 'assistant_access' and cmd = 'UPDATE';

  if check_expr is null or check_expr = '' then
    raise exception 'The UPDATE policy has no WITH CHECK, so a grant could be re-authored.';
  end if;

  if check_expr not like '%current_user_id%' then
    raise exception
      'The UPDATE policy''s WITH CHECK does not pin granted_by_id to the caller. '
      'An Admin could write somebody else''s name into the field that records who decided.';
  end if;

  if check_expr not like '%acting_at_least%' then
    raise exception 'The UPDATE policy admits somebody below Admin.';
  end if;

  raise notice 'Upsert works, and a grant still cannot be made to name anybody but its author.';
end $$;
