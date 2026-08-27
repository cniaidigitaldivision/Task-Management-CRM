-- ⛔ SUPERSEDED BY MIGRATION 058 — DO NOT APPLY.
--
-- This was written on 2026-08-24 to give Team Coordinators write access to
-- credentials, per the owner's instruction that day. On 2026-08-25 they reversed
-- it: *"only the admin is able to assign, add, delete, or manage who can view."*
-- Migration 058 makes all three write policies admin-only. Running this file
-- afterwards would hand Coordinators the access 058 removed, and whichever ran
-- last would win.
--
-- ⚠️ KEPT ON DISK RATHER THAN DELETED because its header below diagnoses a real
-- bug — migration 047 moved SELECT and forgot the three write policies, which is
-- why they looked the way they did. Deleting the file would delete the diagnosis.
--
-- ============================================================================
-- 049 · THE WRITE HALF OF MIGRATION 047, WHICH 047 FORGOT
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24: *"Access can only be added by admins or team coordinators.
-- Only these people can add them."*
-- Owner, 2026-08-23: *"he can also manage all these things."*
--
-- ── ⚠️ WHAT WAS ACTUALLY BROKEN, AND IT FAILED SILENTLY ─────────────────────
-- Migration 047 rewrote `app.can_read_credential` to "Coordinator and above, full
-- stop" and changed NOTHING ELSE. So SELECT moved and the three write policies
-- stayed as migration 023 left them:
--
--     credentials_insert   admin OR I own this project
--     credentials_update   admin OR I own this project
--     credentials_delete   admin
--
-- while `lib/domain/permissions.ts` says `credential.manage` and
-- `credential.delete` are allowed for a Team Coordinator. The application and the
-- database therefore disagreed, and the application is the one people see:
--
--   · A Coordinator saw Add credential and Edit, pressed Save, and was told
--     "Saved." An UPDATE that matches no row raises no error, so nothing detected
--     it. `updateCredential` returned void.
--   · A Coordinator pressed Delete and got "That credential is no longer there",
--     which reads as "somebody else deleted it" rather than "you may not".
--   · Clearing a stored password reported the password gone while it was still
--     there — the worst of the three, because somebody then stops treating a live
--     secret as live.
--
-- The query layer now returns whether a row was written and the actions report a
-- refusal honestly. That makes the failure visible. THIS makes it not happen.
--
-- ── WHY THE "I OWN THIS PROJECT" BRANCH IS REMOVED RATHER THAN KEPT ─────────
-- It is incoherent after 047. `projects.owner_id` can be any active user,
-- including a Member — and a Member cannot SELECT a credential at all any more.
-- So the surviving branch granted "may create and edit a credential they are
-- forbidden to read". A write permission wider than the matching read permission
-- is not generosity, it is a way to store a secret nobody can retrieve.
--
-- One rule, the same one `app.can_read_credential` uses:
--
--     acting_at_least('team_coordinator')
--
-- ── ⚠️ THIS IS A WIDENING. WHO GAINS ────────────────────────────────────────
-- A Team Coordinator may now create, edit and DELETE any credential, on any
-- project, not only ones they own. That is what both quotes above ask for, and it
-- matches what the interface has been offering them since 2026-08-23. It is called
-- out because delete is destructive and the audit log is the only record
-- afterwards — `credential.deleted` carries the label and the actor.
--
-- A Member gains nothing here and still cannot read, write or delete.
--
-- Nothing is migrated: policies are replaced, rows are untouched.
-- ============================================================================

drop policy if exists credentials_insert on public.credentials;
drop policy if exists credentials_update on public.credentials;
drop policy if exists credentials_delete on public.credentials;

create policy credentials_insert on public.credentials
  for insert to cni_app
  with check (app.acting_at_least('team_coordinator'::public.user_role));

create policy credentials_update on public.credentials
  for update to cni_app
  using (app.acting_at_least('team_coordinator'::public.user_role));

create policy credentials_delete on public.credentials
  for delete to cni_app
  using (app.acting_at_least('team_coordinator'::public.user_role));

comment on table public.credentials is
  'The credentials vault. Readable and writable by Team Coordinator and above, and by '
  'nobody else — one rank test for select (migration 047) and for insert, update and '
  'delete (migration 049). Project ownership is deliberately NOT a route in either '
  'direction: a project can be owned by a Member, who may not read a credential at all. '
  'The secret is sealed by the application before it arrives and is decrypted in exactly '
  'one function; revealing one requires a fresh step-up and is audited as critical.';
