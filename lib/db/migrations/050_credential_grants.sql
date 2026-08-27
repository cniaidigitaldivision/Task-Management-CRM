-- ============================================================================
-- 050 · GIVING ONE PERSON ACCESS TO ONE CREDENTIAL
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24, of the "Who can see this credential" modal: *"In this modal
-- only admins and super admins can add someone and can delete someone from
-- here."*
--
-- ── ⚠️ THIS REOPENS MIGRATION 047, AND THAT IS THE POINT WORTH READING ──────
-- 047 made access to a credential RANK ALONE, from the owner's own words: *"it is
-- only shown to team coordinators and admins. Not even the person who is working
-- on this project can show that credential to them."* The modal had nothing to
-- add or remove precisely because of that.
--
-- Asked directly which model to use, the owner chose rank PLUS named grants over
-- an explicit per-credential list. So 047 is not reversed — it becomes the FLOOR:
--
--     Coordinator and above      every credential, by rank, as before
--     anyone with a grant here   that one credential, and only that one
--
-- Nobody loses access, no backfill is needed, and "who can see this" is still
-- answerable without reading a table for the common case.
--
-- ⚠️ WHAT IT DOES MEAN is that a MEMBER can now be given a password, which 047
-- explicitly forbade. It is deliberate and it is narrow: one person, one
-- credential, granted by an Admin, recorded with who granted it and when, and
-- revocable. That is a different thing from "a Member may read a credential
-- because it was issued to them", which is the leak 047 closed — that granted
-- access as a side effect of a custody field nobody thought of as a permission.
-- This one is somebody deciding, on the record.
--
-- ── WHY A TABLE AND NOT A COLUMN ────────────────────────────────────────────
-- `issued_to_id` already exists and is exactly the wrong shape: one person, and
-- it means custody rather than access — 047's whole complaint. A grant is
-- many-to-many, needs its own author and timestamp for the audit trail, and has
-- to be revocable without touching the credential row.
-- ============================================================================

create table if not exists public.credential_grants (
  credential_id uuid not null
    references public.credentials(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  -- ⚠️ NOT nullable and NOT `on delete set null`. "Who decided this person may
  -- read a client's password" is the entire value of this row after the fact; a
  -- grant whose author had been deleted would be an unanswerable question. The
  -- restrict is deliberate: `users` are deactivated rather than deleted in this
  -- system (see the delete rule), so this should never actually block anything.
  granted_by_id uuid not null
    references public.users(id) on delete restrict,
  granted_at timestamptz not null default now(),

  -- One grant per person per credential. Also the lookup index for the read
  -- policy below, which is the hot path: it runs for every credential row a
  -- Member's query touches.
  primary key (credential_id, user_id)
);

-- The other direction: "what has this person been given", for a future screen and
-- for answering the question when somebody leaves.
create index if not exists credential_grants_user_idx
  on public.credential_grants (user_id);

comment on table public.credential_grants is
  'Named per-credential access, on top of the rank floor in app.can_read_credential. '
  'A row means: this user may read this one credential, granted by that admin at that '
  'time. Granting and revoking are Admin and above (owner, 2026-08-24); rank-based '
  'access is not represented here and cannot be revoked from here.';

alter table public.credential_grants enable row level security;

-- ── READING THE GRANT LIST ──────────────────────────────────────────────────
-- Coordinator and above, because that is who can see the credential itself and
-- therefore the modal that lists them. Plus the grantee, so a Member can be told
-- why they can see something — a permission somebody cannot see the source of is
-- one they cannot query when it is wrong.
drop policy if exists credential_grants_select on public.credential_grants;
create policy credential_grants_select on public.credential_grants
  for select to cni_app
  using (
    app.acting_at_least('team_coordinator'::public.user_role)
    or user_id = app.current_user_id()
  );

-- ── WRITING ─────────────────────────────────────────────────────────────────
-- ⚠️ ADMIN AND ABOVE, NOT COORDINATOR, and this is the one place in the vault
-- where those two differ. `credential.manage` lets a Coordinator edit a stored
-- password; handing READ ACCESS to a third person is a bigger act than changing a
-- value, because it cannot be undone by changing it back — the person has seen it.
-- The owner said "only admins and super admins" and this is why that is right.
drop policy if exists credential_grants_insert on public.credential_grants;
create policy credential_grants_insert on public.credential_grants
  for insert to cni_app
  with check (
    app.acting_at_least('admin'::public.user_role)
    -- The grant must name its author honestly. Without this an Admin could write
    -- somebody else's name into `granted_by_id` and the audit trail would blame
    -- the wrong person for the one decision it exists to record.
    and granted_by_id = app.current_user_id()
  );

drop policy if exists credential_grants_delete on public.credential_grants;
create policy credential_grants_delete on public.credential_grants
  for delete to cni_app
  using (app.acting_at_least('admin'::public.user_role));

-- ⚠️ NO UPDATE POLICY, deliberately. A grant has nothing worth editing: changing
-- the person means revoking one and granting another, and both should appear in
-- the audit log as what they are. With RLS enabled and no policy, UPDATE is
-- refused for everyone.

-- ============================================================================
-- THE READ RULE, NOW WITH THE CREDENTIAL'S OWN ID
-- ----------------------------------------------------------------------------
-- ⚠️ THE SIGNATURE HAD TO CHANGE, which migration 047 went out of its way to
-- avoid. It kept `(p_project_id, p_issued_to_id)` — ignoring both — so that
-- `credentials_select` would not need recreating. A grant is per credential, so
-- the function now genuinely needs to know WHICH credential, and no amount of
-- signature-preserving gets around that.
--
-- The two-argument version is dropped rather than left behind: its only caller was
-- the policy replaced below, and a second copy of "who may read a credential" is
-- the kind of thing that gets edited in isolation six months from now.
-- ============================================================================

create or replace function app.can_read_credential(
  p_credential_id uuid,
  p_project_id    uuid,
  p_issued_to_id  uuid
) returns boolean
language sql
stable
-- ⚠️ `security definer` so the rank test and the grant lookup both run regardless
-- of the caller's own rights on `credential_grants`. A Member has no reason to be
-- able to read that table wholesale, and this function must still be able to.
security definer
set search_path = public, pg_catalog
as $$
  select
    -- The floor from migration 047. Unchanged, and still the common case.
    app.acting_at_least('team_coordinator'::public.user_role)
    -- Or somebody was given this one, by name.
    or exists (
      select 1 from public.credential_grants g
       where g.credential_id = p_credential_id
         and g.user_id = app.current_user_id()
    );
  -- p_project_id and p_issued_to_id remain UNUSED, as they have since 047: a
  -- credential's project and the person holding it do not decide who may read it.
  -- They stay in the signature because dropping them would be a third change to
  -- this policy for no gain, and because `issued_to_id` being irrelevant here is
  -- the exact bug 047 fixed and is worth keeping visible.
$$;

comment on function app.can_read_credential(uuid, uuid, uuid) is
  'Coordinator and above by rank (migration 047), or a named grant in '
  'credential_grants (migration 050). Project and issued-to are deliberately '
  'ignored — see migration 047 for why "issued to me" was a leak rather than a '
  'permission.';

drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to cni_app
  using (app.can_read_credential(id, project_id, issued_to_id));

drop function if exists app.can_read_credential(uuid, uuid);
