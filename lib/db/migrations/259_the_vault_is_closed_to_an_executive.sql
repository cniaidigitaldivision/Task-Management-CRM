-- ============================================================================
-- 259 · THE VAULT IS CLOSED TO AN EXECUTIVE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25, on the Vault: *"Yeah store credentials in our case.
-- Definitely hide it. We don't need to show which credentials we are working
-- on."*
--
-- ── ⚠️ HIDING THE MENU ITEM DID NOT HIDE THE DATA ────────────────────────
-- The sidebar stopped offering /vault, and that was the whole of it. But
-- `app.can_read_credential()` grants on a RANK FLOOR of `team_coordinator`
-- (migration 047), and the Executive sits above that at 3 — so every stored
-- credential in the business was readable by them. `/vault` guards with
-- `requireUser`, deliberately, because RLS is supposed to decide; typing the
-- URL would have been enough.
--
-- This was found by reading the policy, not by testing the menu. A hidden link
-- is a decoration; the predicate is the door.
--
-- ⚠️ THE READ-ONLY SESSION DOES NOT HELP HERE. 257 stops an Executive WRITING
-- anything. A credential is damaging to READ.
--
-- ── ⚠️ AND A DELIBERATE GRANT IS REFUSED TOO, WHICH I DID NOT EXPECT ────
-- The first draft of this file closed only the rank arm, on the reasoning that
-- an Admin naming an Executive on ONE credential is a decision somebody makes
-- on purpose. The self-check proved otherwise: `credential_grants` carries a
-- trigger that refuses a grant to anybody above a Member —
--
--     "A grant is only meaningful for a Member — everybody more senior can
--      already read every credential by rank."
--
-- That sentence stopped being true for the Executive the moment the rank arm
-- closed above, so the trigger now refuses a grant that WOULD have meant
-- something. It is left alone deliberately: the owner said *"definitely hide
-- it"*, and an Executive who can hold no grant and inherit no rank holds
-- nothing at all. The check below asserts the refusal rather than assuming it.
--
-- ── ⚠️ ONE NAME FOR ONE IDEA ─────────────────────────────────────────────
-- `app.acting_writes()` already meant "is not an Executive", but reading that
-- name inside a SELECT policy would be nonsense. `acting_is_executive()` is
-- added and `acting_writes()` is redefined in terms of it, so there is one
-- source of truth and two readable names rather than two drifting copies.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE NAME
-- ----------------------------------------------------------------------------
create or replace function app.acting_is_executive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(app.current_user_role(), 'member'::public.user_role)
         = 'executive'::public.user_role
$fn$;

comment on function app.acting_is_executive() is
  'True only for the Executive role. The single source of truth behind acting_writes() and the vault''s rank floor (migration 259).';

-- ⚠️ REDEFINED, NOT DUPLICATED. Same answer as before, now expressed once.
create or replace function app.acting_writes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select not app.acting_is_executive()
$fn$;

grant execute on function app.acting_is_executive() to cni_app;
grant execute on function app.acting_writes() to cni_app;

-- ----------------------------------------------------------------------------
-- 2 · THE RANK FLOOR STOPS AT THE EXECUTIVE
-- ----------------------------------------------------------------------------
-- ⚠️ THE FIRST ARM IS UNTOUCHED. Somebody named IN on a credential keeps it,
-- whatever their rank — that is migration 050's rule and closing it here would
-- be a change nobody asked for.
create or replace function app.can_read_credential(
  p_credential_id uuid,
  p_project_id uuid,
  p_issued_to_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
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
      -- ⚠️ ADDED 2026-09-25. An Executive outranks a Coordinator and must not
      -- inherit the vault with the rank.
      and not app.acting_is_executive()
      and not exists (
        select 1 from public.credential_grants g
         where g.credential_id = p_credential_id
           and g.user_id = app.current_user_id()
           and g.effect = 'deny'
      )
    );
  -- p_project_id and p_issued_to_id remain unused, as since migration 047.
$fn$;

-- ----------------------------------------------------------------------------
-- 3 · AND THE LIST OF WHO HOLDS WHAT
-- ----------------------------------------------------------------------------
-- Otherwise an Executive could still read `credential_grants` and learn which
-- credentials exist and who can open them — the other half of what the owner
-- asked to hide.
drop policy if exists credential_grants_select on public.credential_grants;
create policy credential_grants_select on public.credential_grants
  for select
  using (
    (app.acting_at_least('team_coordinator'::public.user_role) and not app.acting_is_executive())
    or user_id = app.current_user_id()
  );

-- ----------------------------------------------------------------------------
-- 4 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_coord uuid;
  v_admin uuid;
  v_cred uuid;
  v_seen int;
  v_coord_seen int;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_coord from public.users where role = 'team_coordinator' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'self-check needs an active admin'; end if;

  /* ⚠️ IT MAKES ITS OWN CREDENTIAL RATHER THAN SKIPPING. The vault is empty
     today, so a check that looked for one would have printed a tick for a rule
     it never ran — the failure recorded in `self-checks-that-skip-silently`.
     The fixture is a label and an empty secret, and it is deleted below. */
  insert into public.credentials (label, kind, secret_encrypted, created_by_id)
  values ('Self-check 259 — not a real credential', 'other', '', v_admin)
  returning id into v_cred;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 259', 'self-check-259@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  perform set_config('role', 'cni_app', true);

  -- ── the Executive sees nothing in the vault ─────────────────────────────
  perform set_config('app.user_id', v_exec::text, true);
  if app.acting_is_executive() is not true then
    raise exception 'acting_is_executive() SAID NO TO AN EXECUTIVE';
  end if;
  select count(*) into v_seen from public.credentials;
  if v_seen <> 0 then
    raise exception 'AN EXECUTIVE CAN STILL READ % CREDENTIALS', v_seen;
  end if;
  select count(*) into v_seen from public.credential_grants;
  if v_seen <> 0 then
    raise exception 'AN EXECUTIVE CAN STILL READ % CREDENTIAL GRANTS', v_seen;
  end if;

  -- ── and cannot be handed one either ─────────────────────────────────────
  -- ⚠️ ASSERTED, NOT ASSUMED. The first draft of this file expected a grant to
  -- succeed; `credential_grants` refused it, which is how the note above got
  -- written. An Executive therefore holds nothing in the vault by any route.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.credential_grants (credential_id, user_id, effect)
    values (v_cred, v_exec, 'allow');
    raise exception 'AN EXECUTIVE WAS GRANTED A CREDENTIAL';
  exception
    when others then
      /* Matched on the sentence, not on a code, because the trigger chooses its
         own. Anything else is a real failure and must not be swallowed. */
      if sqlerrm not like '%grant is only meaningful%' then
        raise;
      end if;
  end;
  perform set_config('role', 'cni_app', true);

  -- ── and nobody else moved ───────────────────────────────────────────────
  if v_coord is not null then
    perform set_config('app.user_id', v_coord::text, true);
    select count(*) into v_coord_seen from public.credentials;
    if v_coord_seen = 0 then
      raise exception 'A COORDINATOR LOST THE VAULT — this migration was meant to narrow one role';
    end if;
  end if;

  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into v_seen from public.credentials;
  if v_seen = 0 then
    raise exception 'AN ADMIN LOST THE VAULT';
  end if;

  -- ── clean up ────────────────────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  delete from public.credential_grants where credential_id = v_cred;
  delete from public.credentials where id = v_cred;
  delete from public.users where id = v_exec;
  if exists (select 1 from public.credentials where id = v_cred) then
    raise exception 'THE 259 CREDENTIAL FIXTURE SURVIVED';
  end if;
  if exists (select 1 from public.users where id = v_exec) then
    raise exception 'THE 259 FIXTURE SURVIVED';
  end if;

  raise notice '259 self-check passed: the vault is closed to an executive by rank AND by grant, and unchanged for everybody else';
end $$;
