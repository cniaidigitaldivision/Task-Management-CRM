-- ============================================================================
-- 052 · TAKING ONE CREDENTIAL AWAY FROM ONE PERSON
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24, of the "Who can see this credential" modal:
--
--   "as an admin: I can't delete super admin but I can delete or add more people.
--    I can delete team coordinator and members also, right? Right now you just
--    give me an option for adding not deleting."
--
-- ── ⚠️ THIS IS THE OPTION I ARGUED AGAINST, AND THE OWNER HAS NOW ASKED TWICE ─
-- Offered three access models on 2026-08-24, the owner chose "rank plus named
-- grants" and I explicitly recommended AGAINST the third — rank plus grants plus
-- exclusions — on the grounds that an allow-list and a deny-list together make
-- "why can't I see this?" genuinely hard to answer. That objection stands and is
-- restated below so whoever debugs it next knows it was foreseen.
--
-- The owner has since asked for it directly and in detail, naming who may be
-- removed (Coordinators, Members) and who may not (the Super Admin). That is their
-- call to make. What this migration does is make the dangerous half — a silent,
-- invisible loss of access — as visible as it can be:
--
--   · an exclusion is a ROW, with an author and a timestamp, not a missing row;
--   · it lives in the same table as a grant, so "what has been done to this
--     credential's access" is one query;
--   · the modal draws an excluded person struck through rather than removing them
--     from the list, so the answer to "why can't Kashif see this" is on screen
--     rather than requiring somebody to know exclusions exist.
--
-- ── WHY ONE TABLE AND NOT `credential_exclusions` ───────────────────────────
-- `effect` on the existing row rather than a second table, because the primary key
-- (credential_id, user_id) then makes "allowed AND denied at once" IMPOSSIBLE
-- rather than merely unlikely. Two tables would permit that contradiction and the
-- resolution order would become a thing to remember. Here there is one row per
-- person per credential and it says one thing.
--
-- ── ⚠️ THE SUPER ADMIN CANNOT BE EXCLUDED, AND THE DATABASE ENFORCES IT ──────
-- Owner: *"I can't delete super admin."* A trigger, not a UI rule, because it is
-- the one exclusion that could lock the division out of its own vault: there is
-- exactly one Super Admin (`users_single_super_admin_idx`, BR-028) and if a
-- credential could be hidden from them, nobody could recover it.
-- ============================================================================

alter table public.credential_grants
  add column if not exists effect text not null default 'allow';

alter table public.credential_grants
  drop constraint if exists credential_grants_effect_known;

alter table public.credential_grants
  add constraint credential_grants_effect_known
    check (effect in ('allow', 'deny'));

comment on column public.credential_grants.effect is
  '''allow'' — this person may read this credential even though their rank would not '
  'let them (migration 050). ''deny'' — this person may NOT read it even though their '
  'rank would (migration 052). One row per person per credential, so the two cannot '
  'both be true. A Super Admin can never be denied; see the trigger below.';

comment on table public.credential_grants is
  'Per-credential exceptions to the rank rule in app.can_read_credential. A row is '
  'either a grant to somebody below Coordinator or a removal from somebody at or '
  'above it, with the admin who decided it and when. Absence of a row means "rank '
  'decides", which is the case for almost every credential and person.';

-- ============================================================================
-- THE SUPER ADMIN IS NOT EXCLUDABLE
-- ============================================================================

create or replace function app.credential_grant_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_role public.user_role;
begin
  select u.role into target_role from public.users u where u.id = new.user_id;

  if new.effect = 'deny' and target_role = 'super_admin' then
    -- ⚠️ Refused in the database, not just in the interface. There is exactly one
    -- Super Admin and a credential they cannot read is a credential nobody can
    -- recover. Owner, 2026-08-24: "I can't delete super admin."
    raise exception
      'The Super Admin cannot be excluded from a credential — they are the last '
      'route back into the vault.'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ A grant to somebody who already has rank is a no-op row that would then sit
  -- in the list implying it could be revoked. The action refuses it too; this is
  -- what stops a script or a stale client writing one.
  if new.effect = 'allow' and target_role <> 'member' then
    raise exception
      'A grant is only meaningful for a Member — everybody more senior can already '
      'read every credential by rank.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists credential_grants_guard on public.credential_grants;
create trigger credential_grants_guard
  before insert or update on public.credential_grants
  for each row execute function app.credential_grant_guard();

-- ============================================================================
-- THE READ RULE
-- ----------------------------------------------------------------------------
-- ⚠️ AN EXPLICIT GRANT BEATS A DENY BY CONSTRUCTION, not by ordering: the primary
-- key means a person cannot hold both. The `allow` branch is first only because it
-- is the cheaper test.
-- ============================================================================

create or replace function app.can_read_credential(
  p_credential_id uuid,
  p_project_id    uuid,
  p_issued_to_id  uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    -- Named in, regardless of rank (migration 050).
    exists (
      select 1 from public.credential_grants g
       where g.credential_id = p_credential_id
         and g.user_id = app.current_user_id()
         and g.effect = 'allow'
    )
    -- Or the rank floor from migration 047, unless named OUT of this one.
    or (
      app.acting_at_least('team_coordinator'::public.user_role)
      and not exists (
        select 1 from public.credential_grants g
         where g.credential_id = p_credential_id
           and g.user_id = app.current_user_id()
           and g.effect = 'deny'
      )
    );
  -- p_project_id and p_issued_to_id remain unused, as since migration 047.
$$;

comment on function app.can_read_credential(uuid, uuid, uuid) is
  'Coordinator and above by rank (047), plus named grants (050), minus named '
  'exclusions (052). A Super Admin can never be excluded. Project and issued-to are '
  'deliberately ignored — see 047 for why "issued to me" was a leak.';
