-- ============================================================================
-- 047 · CREDENTIALS ARE FOR COORDINATORS AND ABOVE. NOBODY ELSE.
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24:
--
--   "Access can only be added by admins or team coordinators. Only these people
--    can add them… it is only shown to team coordinators and admins. Not even
--    the person who is working on this project can show that credential to them.
--    This control is given only to coordinators and admins."
--
-- ── WHAT THIS CHANGES, AND WHO LOSES ACCESS ─────────────────────────────────
-- `app.can_read_credential` (migration 023) granted sight on THREE grounds:
--
--     1. Admin and above                      → kept
--     2. The credential was issued to me      → ⚠️ REMOVED
--     3. I own the project it belongs to      → ⚠️ REMOVED as a standalone route
--
-- and Team Coordinator was not mentioned at all, so a Coordinator could only see
-- a credential if they happened to own the project or it was issued to them.
-- Both halves of that were wrong for what the owner has now asked for: a Member
-- could see a password because it was issued to them, and a Coordinator — the
-- person whose job this is — usually could not see it at all.
--
-- After this: `acting_at_least('team_coordinator')`. One rule, no exceptions.
--
-- ⚠️ THIS IS A REVOCATION AND IT WILL LOCK PEOPLE OUT. A Member who has been
-- using a stored password to do their work will stop being able to read it, and
-- the honest consequence is that a Coordinator has to hand it over another way.
-- That is the owner's decision, stated twice and in those words. It is called
-- out here because the failure mode is somebody unable to do their job on a
-- Monday morning, and whoever reads this file next should know it was intended.
--
-- ── WHY THE "ISSUED TO ME" BRANCH IS THE ONE THAT MATTERED ──────────────────
-- It reads as generous and it was the actual leak. `issued_to_id` is set by
-- whoever creates the credential, so it silently converted "this login belongs
-- to Najmulla" into "Najmulla may read this login's password forever" — a
-- statement about custody being used as a grant of access. Those are different
-- things and the vault is the wrong place to conflate them.
--
-- ── DEFENCE IN DEPTH, NOT INSTEAD OF ────────────────────────────────────────
-- `lib/domain/permissions.ts` denies `credential.view` and `credential.reveal`
-- to a Member in the same commit. That governs what the application offers and
-- what its server actions accept; THIS governs what the database will hand over
-- at all. Either alone would be a single point of failure, and the reveal path
-- is the one act in this system that hands over a working secret.
-- ============================================================================

create or replace function app.can_read_credential(
  p_project_id   uuid,
  p_issued_to_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  -- ⚠️ Both parameters are now deliberately UNUSED. They are kept in the
  -- signature rather than dropped because `credentials_select` and
  -- `credentials_update` reference this function by its two-argument form, and
  -- changing the signature would mean dropping and recreating every policy that
  -- calls it. Keeping the shape makes this a one-statement, reversible change.
  --
  -- A rule that ignores its inputs is worth stating plainly: a credential's
  -- project and the person it was issued to no longer affect who may read it.
  -- Rank alone decides.
  select app.acting_at_least('team_coordinator'::public.user_role);
$$;

comment on function app.can_read_credential(uuid, uuid) is
  'Coordinator and above, full stop (owner, 2026-08-24). Supersedes the '
  'owner-based visibility of migration 023: the "issued to me" and "I own the '
  'project" routes are gone, because both let somebody outside the Coordinator '
  'circle read a working password. Arguments retained only so the existing '
  'policies keep resolving — they are not consulted.';
