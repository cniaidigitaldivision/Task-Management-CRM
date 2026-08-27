-- ============================================================================
-- 059 · A CREDENTIAL CAN BE ISSUED TO SEVERAL PEOPLE
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-25, looking at the "Issued to" dropdown on the credential form:
--
--   "I have to assign only Kashif and Larip so how can I select them? I want that
--    dropdown to show the team names with checkboxes so I can select multiple team
--    members and select 'Nobody' instead of using 'Everyone'. It is more
--    understandable."
--
-- `credentials.issued_to_id` is one uuid. Two people cannot both hold a login in
-- one column, so this is a join table.
--
-- ── ⚠️ THIS IS CUSTODY. IT IS NOT ACCESS. ───────────────────────────────────
-- The distinction is load-bearing and migration 047 exists because of it. Before
-- 047, `app.can_read_credential` let somebody read a password BECAUSE it was
-- issued to them — access as a side effect of a custody field nobody thought of as
-- a permission. 047 removed that route deliberately, and migration 050's header
-- spells it out: issued-to "means custody rather than access — 047's whole
-- complaint".
--
-- So this table is READ BY NOTHING IN RLS, on purpose. Adding Kashif and Lareeb
-- here records that they hold the login. It does not decide who may decrypt it —
-- that is rank (Coordinator and above) plus named grants and exclusions in
-- `credential_grants`.
--
-- ⚠️ The owner's worry was *"nobody is particularly selected. That means everybody
-- can do it"*. It does not: with nobody named here, access is still Coordinator and
-- above, exactly as it was. But that is not obvious from a form, so the form now
-- says which control does which — a field people believe restricts access while it
-- does not is worse than no field.
--
-- ── WHY NOT JUST USE `credential_grants` FOR THIS ───────────────────────────
-- Because they answer different questions and one of them is a security boundary.
-- A grant is "an Admin decided this person may read it", recorded with who decided
-- and when, and revocable. Custody is "this is whose account it is" — a fact about
-- the outside world, editable by anybody who may edit the credential. Merging them
-- would mean editing a description silently changes who can read a password, which
-- is precisely the 047 bug in a new shape.
-- ============================================================================

create table if not exists public.credential_holders (
  credential_id uuid not null
    references public.credentials(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  -- ⚠️ No `granted_by` and no timestamp, unlike `credential_grants`. That table
  -- needs an author because it records a DECISION about access that somebody may
  -- later have to answer for. This one records a fact, and the credential's own
  -- `updated_by_id` already says who last edited it. Adding an author here would
  -- invite somebody to read this table as an access trail.
  primary key (credential_id, user_id)
);

comment on table public.credential_holders is
  'Who a credential is issued to — CUSTODY, not access. Read by nothing in RLS, '
  'deliberately: migration 047 removed issued-to as a read route because it '
  'granted access as a side effect of a description. Access is rank plus '
  'credential_grants. Replaces the single credentials.issued_to_id column (059).';

-- ── Privileges ──────────────────────────────────────────────────────────────
-- ⚠️ GRANTED EXPLICITLY. RLS only narrows what a GRANT already permits, and
-- migration 050 shipped a table with policies and no privileges — every read came
-- back `42501 permission denied` and the Access tab showed an empty list. Every
-- check had been run as the migration owner, which bypasses both.
grant select, insert, delete on public.credential_holders to cni_app;

alter table public.credential_holders enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────
-- ⚠️ Visibility follows the CREDENTIAL, not the person. Somebody who can see the
-- credential can see whose it is; somebody who cannot must not learn that a
-- credential exists by finding their own name attached to it.
drop policy if exists credential_holders_select on public.credential_holders;
create policy credential_holders_select on public.credential_holders
  for select
  using (
    exists (
      select 1 from public.credentials c
       where c.id = credential_holders.credential_id
    )
  );

-- Writes follow migration 058: editing a credential is an Admin act, and so is
-- editing who holds it.
drop policy if exists credential_holders_write on public.credential_holders;
create policy credential_holders_write on public.credential_holders
  for insert
  with check (app.acting_at_least('admin'::public.user_role));

drop policy if exists credential_holders_delete on public.credential_holders;
create policy credential_holders_delete on public.credential_holders
  for delete
  using (app.acting_at_least('admin'::public.user_role));

-- ── Backfill, then leave the old column alone ───────────────────────────────
-- ⚠️ `issued_to_id` is NOT dropped. Three RLS functions take it as a parameter
-- (`app.can_read_credential`, and the policies in 050 and 052 that call it) and
-- ignore it — dropping the column would mean rewriting all three to prove they
-- never used it, on a security boundary, for no behavioural gain. It stops being
-- read by the application here and its comment says so.
insert into public.credential_holders (credential_id, user_id)
select c.id, c.issued_to_id
  from public.credentials c
 where c.issued_to_id is not null
on conflict do nothing;

do $$
declare
  moved int;
begin
  select count(*) into moved from public.credential_holders;
  raise notice 'credential_holders now holds % row(s), backfilled from issued_to_id.', moved;
end $$;

comment on column public.credentials.issued_to_id is
  'SUPERSEDED by public.credential_holders (059) — a credential can be issued to '
  'several people. Kept because three RLS functions accept it as a parameter and '
  'ignore it (047), so dropping it would mean rewriting a security boundary to '
  'prove a negative. No longer read by the application.';
