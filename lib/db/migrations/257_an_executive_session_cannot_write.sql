-- ============================================================================
-- 257 · AN EXECUTIVE'S SESSION CANNOT WRITE, WHATEVER THE POLICIES SAY
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25: *"regardless of any policy, I am telling you, I want to
-- add this access, specifically for the executive role ... And don't make mess
-- with other things. Keep things synchronized and isolated."*
--
-- 256 closed the eight doors that the new rank had opened. This closes the rest
-- — including every write that is open to ANY signed-in person, which no rank
-- check would ever have caught: commenting on a task, uploading a document,
-- editing your own row. There are 104 tables `cni_app` may insert into.
-- Auditing them one at a time would be a list that rots; this is one sentence
-- that cannot.
--
-- ── ⚠️ HOW: `transaction_read_only`, NOT A POLICY AND NOT A GRANT ─────────
-- Postgres refuses every INSERT, UPDATE, DELETE and DDL in a read-only
-- transaction with SQLSTATE 25006, before any policy is consulted. Reads are
-- untouched. Measured on this database before the migration was written:
--
--     set_config('transaction_read_only','on',true)
--       → flag=on | write refused: 25006 | read OK
--
-- ⚠️ IT CANNOT BE A SECURITY DEFINER FUNCTION THAT DOES ALL THREE SETTINGS.
-- Tried first, and Postgres refuses: "cannot set parameter role within
-- security-definer function". So the role and the user id stay where they are,
-- in `withUser`'s own statement, and only the ROLE LOOKUP is a definer.
--
-- ── ⚠️ WHY THE LOOKUP MUST BE `SECURITY DEFINER` ─────────────────────────
-- `withUser` sets the role, the user id and this flag in ONE statement, because
-- a second round trip to Singapore on every query in the application is not
-- affordable. Within one SELECT list Postgres may evaluate the expressions in
-- ANY order — and if the role lookup ran after `set_config('role','cni_app')`
-- but before `set_config('app.user_id', …)`, it would read `users` as cni_app
-- with no identity, match no row, and conclude the caller is not an Executive.
-- That is a fail-OPEN, produced by evaluation order alone, and it would be
-- invisible until the day it mattered. A definer reads the row whatever the
-- session looks like, so order stops being part of the answer.
--
-- ── ⚠️ WHAT THIS DELIBERATELY DOES NOT TOUCH ─────────────────────────────
-- `withAppRole` — the pre-authentication surface, and the session slide that
-- keeps somebody logged in. Checked: the sliding expiry is written through
-- `withAppRole`, so an Executive can still sign in and stay signed in. Had it
-- gone through `withUser`, this migration would have locked them out on the
-- first page load.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE LOOKUP
-- ----------------------------------------------------------------------------
-- ⚠️ STABLE, NEVER IMMUTABLE. A person's role can change inside the life of a
-- connection; immutable would let one session's answer be reused for another's.
create or replace function app.role_of(p_user uuid)
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $fn$
  select u.role from public.users u where u.id = p_user
$fn$;

comment on function app.role_of(uuid) is
  'The role on a user row, read past RLS so that withUser can decide read-only in one statement without depending on SELECT-list evaluation order (migration 257).';

grant execute on function app.role_of(uuid) to cni_app;

-- ----------------------------------------------------------------------------
-- 2 · THE SENTENCE `withUser` ASKS
-- ----------------------------------------------------------------------------
-- Returns 'on' for an Executive and 'off' for everybody else, so the caller can
-- hand it straight to set_config without a CASE it might get wrong. A user id
-- that matches nothing returns 'off': that is somebody who cannot read anything
-- either, and failing closed on the WRITE flag would not make them safer.
create or replace function app.session_read_only(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case when app.role_of(p_user) = 'executive'::public.user_role
              then 'on' else 'off' end
$fn$;

grant execute on function app.session_read_only(uuid) to cni_app;

-- ----------------------------------------------------------------------------
-- 3 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT RUNS THE REAL STATEMENT. Asserting that the helper returns 'on' proves
-- only that a CASE works. What matters is whether the transaction that
-- `withUser` opens actually refuses a write afterwards, so that is what is
-- tested — with a live Executive, and then with a Member to prove nobody else
-- was caught by it.
do $$
declare
  v_exec uuid;
  v_member uuid;
  v_admin uuid;
  v_flag text;
  v_wrote boolean;
begin
  select id into v_member from public.users where role = 'member' and is_active order by created_at limit 1;
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  if v_member is null or v_admin is null then
    raise exception 'self-check needs an active member and an active admin';
  end if;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 257', 'self-check-257@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  -- ── the helper, both ways round ─────────────────────────────────────────
  if app.session_read_only(v_exec) <> 'on' then
    raise exception 'session_read_only SAID OFF FOR AN EXECUTIVE';
  end if;
  if app.session_read_only(v_member) <> 'off' then
    raise exception 'session_read_only SAID ON FOR A MEMBER';
  end if;
  if app.session_read_only('00000000-0000-0000-0000-000000000000') <> 'off' then
    raise exception 'session_read_only SAID ON FOR A STRANGER';
  end if;

  -- ── a Member is untouched: the flag stays off and a write still works ───
  perform set_config('transaction_read_only', app.session_read_only(v_member), true);
  if current_setting('transaction_read_only') <> 'off' then
    raise exception 'A MEMBER SESSION WAS MADE READ-ONLY';
  end if;

  -- ── and now the Executive, through the statement withUser will run ──────
  -- (role and app.user_id are set the way withUser sets them, so the shape
  --  under test is the shape that ships.)
  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_exec::text, true);
  perform set_config('transaction_read_only', app.session_read_only(v_exec), true);

  select current_setting('transaction_read_only') into v_flag;
  if v_flag <> 'on' then
    raise exception 'THE EXECUTIVE SESSION IS NOT READ-ONLY — flag is %', v_flag;
  end if;

  -- reads still work, which is the entire point of the role
  perform 1 from public.users limit 1;

  v_wrote := true;
  begin
    update public.users set full_name = full_name where id = v_exec;
  exception
    when read_only_sql_transaction then v_wrote := false;
    when insufficient_privilege then v_wrote := false;
  end;
  if v_wrote then
    raise exception 'AN EXECUTIVE WROTE INSIDE A READ-ONLY TRANSACTION';
  end if;

  -- ⚠️ AND THE FLAG CANNOT BE TURNED BACK OFF FROM INSIDE THE SESSION.
  -- Postgres refuses to widen a read-only transaction, which is what makes this
  -- a boundary rather than a suggestion.
  begin
    perform set_config('transaction_read_only', 'off', true);
    raise exception 'AN EXECUTIVE SESSION TURNED ITS OWN READ-ONLY FLAG OFF';
  exception
    when read_only_sql_transaction or feature_not_supported or active_sql_transaction then null;
  end;

  -- ── clean up as an admin; `users` refuses DELETE to anyone else ─────────
  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  raise notice '257 self-check passed: executive sessions refuse writes, members are untouched, the flag cannot be lifted';

  -- ⚠️ The fixture is removed by the exception path below, because this
  -- transaction is still read-only and cannot delete anything.
  raise exception 'SELF_CHECK_DONE';
exception
  when others then
    if sqlerrm <> 'SELF_CHECK_DONE' then
      raise;
    end if;
end $$;

-- ⚠️ OUTSIDE THE BLOCK, because the block left its transaction read-only and a
-- read-only transaction cannot delete a fixture. Same transaction, fresh
-- statement — the flag was set with `is_local`, and the RAISE above unwound it.
delete from public.users where email = 'self-check-257@example.invalid';

do $$
begin
  if exists (select 1 from public.users where email = 'self-check-257@example.invalid') then
    raise exception 'THE 257 FIXTURE SURVIVED — a live Executive account would be left behind';
  end if;
  raise notice '257 fixture removed';
end $$;
