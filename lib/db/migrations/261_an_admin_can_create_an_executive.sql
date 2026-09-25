-- ============================================================================
-- 261 · AN ADMIN CAN CREATE AN EXECUTIVE, NOT ONLY PROMOTE ONE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25: *"Can you now tell me that an admin can create an executive
-- role persona for him? ... Plus also can edit it."*
--
-- Asked, and checked rather than answered from the dropdown. The answer was
-- half yes:
--
--     admin CREATE executive   → 42501, new row violates row-level security
--     admin PROMOTE to executive → OK
--     coordinator PROMOTE      → refused
--
-- ── ⚠️ THE ROLE DROPDOWN OFFERED SOMETHING THE DATABASE REFUSED ──────────
-- `assignableRolesFor()` was widened to offer Executive (branch commit a3208e8)
-- and `users_insert` was not. That policy is not a rank comparison — it is an
-- explicit list per creating role:
--
--     super_admin → admin, team_coordinator, member
--     admin       → team_coordinator, member
--
-- A rank ladder would have let the new role in by itself. A whitelist does not,
-- and that is the whole point of writing it as one: a role nobody has thought
-- about cannot be created by accident. So it is added deliberately, here.
--
-- ⚠️ AND THE INVITE PATH HAS NO DEFINER TO HIDE BEHIND. `lib/db/queries/
-- provisioning.ts` inserts through `withUser`, so this policy is the thing that
-- answers — the invite form would have failed at the last step with a raw
-- Postgres error.
--
-- ── ⚠️ EDITING ALREADY WORKED, AND IS ASSERTED HERE ANYWAY ───────────────
-- `users_update` admits `acting_at_least('admin')` for any row that is not the
-- Super Admin, so an Admin could always edit or deactivate an Executive. The
-- self-check proves it rather than leaving the owner's second question answered
-- by reading.
--
-- ⚠️ A SUPER ADMIN IS STILL UNCREATABLE by anybody, including themselves. That
-- arm is untouched (BR-028).
-- ============================================================================

set local lock_timeout = '5s';

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert
  with check (
    case app.current_user_role()
      -- ⚠️ EXECUTIVE ADDED 2026-09-25, to both arms that already existed.
      when 'super_admin'::public.user_role
        then role = any (array['admin'::public.user_role,
                               'executive'::public.user_role,
                               'team_coordinator'::public.user_role,
                               'member'::public.user_role])
      when 'admin'::public.user_role
        then role = any (array['executive'::public.user_role,
                               'team_coordinator'::public.user_role,
                               'member'::public.user_role])
      else false
    end
  );

-- ----------------------------------------------------------------------------
-- THE SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT ANSWERS BOTH OF THE OWNER'S QUESTIONS AND THE ONE THEY DID NOT ASK:
-- create, edit, and "can anybody else". A check that only proved the happy path
-- would have passed just as well on a policy that let everybody in.
do $$
declare
  v_admin uuid;
  v_coord uuid;
  v_new uuid;
  v_name text;
begin
  select id into v_admin from public.users
   where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_coord from public.users
   where role = 'team_coordinator' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'self-check needs an active admin'; end if;

  perform set_config('role', 'cni_app', true);

  -- ── 1 · an Admin creates one ────────────────────────────────────────────
  perform set_config('app.user_id', v_admin::text, true);
  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 261', 'self-check-261@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_new;
  if v_new is null then
    raise exception 'AN ADMIN STILL CANNOT CREATE AN EXECUTIVE';
  end if;

  -- ── 2 · and can edit one ────────────────────────────────────────────────
  update public.users set full_name = 'Self-check Executive 261 (edited)'
   where id = v_new;
  select full_name into v_name from public.users where id = v_new;
  if v_name <> 'Self-check Executive 261 (edited)' then
    raise exception 'AN ADMIN CANNOT EDIT AN EXECUTIVE — name reads %', v_name;
  end if;

  -- ── 3 · and can deactivate one, which is how accounts end here ──────────
  update public.users set is_active = false where id = v_new;
  if (select is_active from public.users where id = v_new) then
    raise exception 'AN ADMIN CANNOT DEACTIVATE AN EXECUTIVE';
  end if;
  update public.users set is_active = true where id = v_new;

  -- ── 4 · a Coordinator can do none of it ─────────────────────────────────
  if v_coord is not null then
    perform set_config('app.user_id', v_coord::text, true);
    begin
      insert into public.users (full_name, email, role)
      values ('Should not exist 261', 'nope-261@example.invalid', 'executive');
      raise exception 'A COORDINATOR CREATED AN EXECUTIVE';
    exception
      when insufficient_privilege then null;
    end;

    update public.users set full_name = 'tampered' where id = v_new;
    if (select full_name from public.users where id = v_new) = 'tampered' then
      raise exception 'A COORDINATOR EDITED AN EXECUTIVE';
    end if;
  end if;

  -- ── 5 · and a Super Admin is still uncreatable by anybody ───────────────
  perform set_config('app.user_id', v_admin::text, true);
  begin
    insert into public.users (full_name, email, role)
    values ('Should not exist 261b', 'nope-261b@example.invalid', 'super_admin');
    raise exception 'A SUPER ADMIN WAS CREATED — BR-028 is broken';
  exception
    when insufficient_privilege then null;
  end;

  -- ── clean up ────────────────────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.users where id = v_new;
  if exists (select 1 from public.users where id = v_new) then
    raise exception 'THE 261 FIXTURE SURVIVED';
  end if;

  raise notice '261 self-check passed: an admin creates, edits and deactivates an executive; a coordinator does none of it; a super admin is still uncreatable';
end $$;
