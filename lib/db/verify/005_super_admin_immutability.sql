-- ============================================================================
-- CNI CRM — GATE PROOF FOR PHASE 1, STEP 2
-- ----------------------------------------------------------------------------
--   doc 20 §9, STEP 2:
--     "✅ GATE: trigger blocks a foreign write to a super_admin row
--              (proven by test)"
--
-- This is that proof, and rather more: 35 assertions covering every invariant
-- migrations 003, 005 and 006 claim to enforce.
--
-- Last run: 2026-08-06, Session 07 — 35 assertions, 35 PASS, GATE PASSED.
--
-- ----------------------------------------------------------------------------
-- HOW TO RUN IT
--
--   Supabase SQL editor, psql, or the Supabase MCP — paste the whole file.
--   It is wrapped in BEGIN … ROLLBACK, so:
--     • every fixture it creates disappears
--     • no row is left in users, audit_log or security_events
--     • it is safe to run against production, repeatedly
--
--   Read the output: every row must say PASS.
--
-- ----------------------------------------------------------------------------
-- WHY THE ASSERTIONS RUN AS `postgres`, NOT AS `cni_app`
--
-- Because that is the harder claim. `postgres` has BYPASSRLS, so during these
-- assertions the second enforcement layer is switched off entirely and the
-- trigger is on its own. Passing as `postgres` proves the rule holds even when
-- the application is wrong, the RLS is wrong, or someone is typing SQL straight
-- into the dashboard — which is what doc 03 §2 means by "enforced in the
-- database, not just the UI".
--
-- Assertions 21–30 then switch to `cni_app` to check the RLS layer separately.
-- ============================================================================

begin;

create temporary table _v (
  n            integer,
  requirement  text,
  assertion    text,
  expected     text,
  observed     text,
  verdict      text
) on commit drop;


do $$
declare
  sa   uuid;   -- super admin
  ad   uuid;   -- admin
  ad2  uuid;   -- a second admin
  co   uuid;   -- coordinator
  me   uuid;   -- member
  f1   uuid;   -- an MFA factor
  f2   uuid;   -- a second MFA factor
  al   uuid;   -- an audit_log row
  sev  uuid;   -- a security_events row
  la   uuid;   -- a login_attempts row
  total_users integer;
  seen        integer;
begin
  ---------------------------------------------------------------------------
  -- FIXTURES
  ---------------------------------------------------------------------------
  -- Reuse the real Super Admin if one exists (a stronger test, and the only
  -- option once the system is live — users_single_super_admin_idx permits
  -- exactly one). Everything rolls back either way.
  select u.id into sa from public.users u where u.role = 'super_admin' limit 1;
  if sa is null then
    insert into public.users (full_name, email, role, account_state)
    values ('Verify Super Admin', 'verify.superadmin@cni.test', 'super_admin', 'active')
    returning id into sa;
  end if;

  insert into public.users (full_name, email, role, account_state)
  values ('Verify Admin', 'verify.admin@cni.test', 'admin', 'active')
  returning id into ad;

  insert into public.users (full_name, email, role, account_state)
  values ('Verify Admin Two', 'verify.admin2@cni.test', 'admin', 'active')
  returning id into ad2;

  insert into public.users (full_name, email, role, account_state)
  values ('Verify Coordinator', 'verify.coord@cni.test', 'team_coordinator', 'active')
  returning id into co;

  insert into public.users (full_name, email, role, account_state)
  values ('Verify Member', 'verify.member@cni.test', 'member', 'active')
  returning id into me;

  insert into public.auth_identities (user_id, provider, password_hash)
  values (sa, 'password', 'argon2id-fixture-hash-not-a-real-credential');
  insert into public.auth_identities (user_id, provider, password_hash)
  values (me, 'password', 'argon2id-fixture-hash-not-a-real-credential');

  select count(*) into total_users from public.users;


  -- =========================================================================
  -- SECTION A · SUPER ADMIN IMMUTABILITY   (BR-027, FR-140)   ★ THE GATE
  -- =========================================================================

  -- A1 ── the gate itself
  perform set_config('app.user_id', ad::text, true);
  begin
    update public.users set full_name = 'Hijacked by Admin' where id = sa;
    insert into _v values (1, 'BR-027 / FR-140', 'Admin writes the Super Admin row',
      'blocked', 'ALLOWED — the write succeeded', 'FAIL');
  exception when others then
    insert into _v values (1, 'BR-027 / FR-140', 'Admin writes the Super Admin row',
      'blocked', sqlerrm, 'PASS');
  end;

  -- A2
  perform set_config('app.user_id', co::text, true);
  begin
    update public.users set role_title = 'Hijacked' where id = sa;
    insert into _v values (2, 'BR-027 / FR-140', 'Coordinator writes the Super Admin row',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (2, 'BR-027 / FR-140', 'Coordinator writes the Super Admin row',
      'blocked', sqlerrm, 'PASS');
  end;

  -- A3
  perform set_config('app.user_id', me::text, true);
  begin
    update public.users set email = 'stolen@cni.test' where id = sa;
    insert into _v values (3, 'BR-027 / FR-140', 'Member writes the Super Admin row',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (3, 'BR-027 / FR-140', 'Member writes the Super Admin row',
      'blocked', sqlerrm, 'PASS');
  end;

  -- A4 ── an unidentified session (no app.user_id): fail closed
  perform set_config('app.user_id', '', true);
  begin
    update public.users set role = 'member' where id = sa;
    insert into _v values (4, 'BR-027 / FR-140', 'Unidentified session demotes the Super Admin',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (4, 'BR-027 / FR-140', 'Unidentified session demotes the Super Admin',
      'blocked', sqlerrm, 'PASS');
  end;

  -- A5 ── the Super Admin may write his own row
  perform set_config('app.user_id', sa::text, true);
  begin
    update public.users set role_title = 'Founder' where id = sa;
    insert into _v values (5, 'BR-027 (converse)', 'Super Admin edits their OWN profile',
      'allowed', 'allowed', 'PASS');
  exception when others then
    insert into _v values (5, 'BR-027 (converse)', 'Super Admin edits their OWN profile',
      'allowed', 'BLOCKED — ' || sqlerrm, 'FAIL');
  end;


  -- =========================================================================
  -- SECTION B · NO SELF-DESTRUCTION   (FR-156, doc 03 §2)
  -- =========================================================================
  -- Guards against the accident and the coerced act equally.

  -- B6
  perform set_config('app.user_id', sa::text, true);
  begin
    update public.users set role = 'admin' where id = sa;
    insert into _v values (6, 'FR-156', 'Super Admin demotes themselves',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (6, 'FR-156', 'Super Admin demotes themselves',
      'blocked', sqlerrm, 'PASS');
  end;

  -- B7
  begin
    update public.users set is_active = false where id = sa;
    insert into _v values (7, 'FR-156', 'Super Admin deactivates themselves',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (7, 'FR-156', 'Super Admin deactivates themselves',
      'blocked', sqlerrm, 'PASS');
  end;

  -- B8
  begin
    update public.users set account_state = 'suspended' where id = sa;
    insert into _v values (8, 'FR-156', 'Super Admin suspends themselves',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (8, 'FR-156', 'Super Admin suspends themselves',
      'blocked', sqlerrm, 'PASS');
  end;

  -- B9
  begin
    update public.users set account_state = 'locked', locked_at = now() where id = sa;
    insert into _v values (9, 'FR-156', 'Super Admin locks themselves',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (9, 'FR-156', 'Super Admin locks themselves',
      'blocked', sqlerrm, 'PASS');
  end;

  -- B10 ── DELETE of the Super Admin, by himself
  begin
    delete from public.users where id = sa;
    insert into _v values (10, 'FR-156 / BR-007', 'Super Admin deletes their own row',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (10, 'FR-156 / BR-007', 'Super Admin deletes their own row',
      'blocked', sqlerrm, 'PASS');
  end;


  -- =========================================================================
  -- SECTION C · NO PATH TO super_admin   (BR-028)
  -- =========================================================================

  -- C11 ── promotion by the Super Admin himself
  perform set_config('app.user_id', sa::text, true);
  begin
    update public.users set role = 'super_admin' where id = ad;
    insert into _v values (11, 'BR-028', 'Super Admin promotes an Admin to Super Admin',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (11, 'BR-028', 'Super Admin promotes an Admin to Super Admin',
      'blocked', sqlerrm, 'PASS');
  end;

  -- C12 ── a second super_admin row, inserted directly
  perform set_config('app.user_id', '', true);
  begin
    insert into public.users (full_name, email, role, account_state)
    values ('Second Super Admin', 'verify.second.sa@cni.test', 'super_admin', 'active');
    insert into _v values (12, 'BR-028', 'A second super_admin row is inserted',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (12, 'BR-028', 'A second super_admin row is inserted',
      'blocked', sqlerrm, 'PASS');
  end;


  -- =========================================================================
  -- SECTION D · THE REST OF THE users RULES
  -- =========================================================================

  -- D13 ── no self-elevation, doc 03 §5
  perform set_config('app.user_id', me::text, true);
  begin
    update public.users set role = 'team_coordinator' where id = me;
    insert into _v values (13, 'doc 03 §5', 'Member changes their own role',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (13, 'doc 03 §5', 'Member changes their own role',
      'blocked', sqlerrm, 'PASS');
  end;

  -- D14 ── Admins manage downward only
  perform set_config('app.user_id', ad::text, true);
  begin
    update public.users set is_active = false where id = ad2;
    insert into _v values (14, 'doc 03 §3', 'Admin suspends another Admin',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (14, 'doc 03 §3', 'Admin suspends another Admin',
      'blocked', sqlerrm, 'PASS');
  end;

  -- D15
  begin
    update public.users set role = 'admin' where id = co;
    insert into _v values (15, 'doc 03 §3', 'Admin grants the Admin role',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (15, 'doc 03 §3', 'Admin grants the Admin role',
      'blocked', sqlerrm, 'PASS');
  end;

  -- D16 ── the converse: an Admin may promote a Member to Coordinator
  begin
    update public.users set role = 'team_coordinator' where id = me;
    insert into _v values (16, 'doc 03 §3 (converse)', 'Admin promotes Member to Coordinator',
      'allowed', 'allowed', 'PASS');
    update public.users set role = 'member' where id = me;   -- restore
  exception when others then
    insert into _v values (16, 'doc 03 §3 (converse)', 'Admin promotes Member to Coordinator',
      'allowed', 'BLOCKED — ' || sqlerrm, 'FAIL');
  end;

  -- D17 ── no user row is ever deleted, whoever asks
  perform set_config('app.user_id', sa::text, true);
  begin
    delete from public.users where id = me;
    insert into _v values (17, 'BR-007 / doc 03 §7', 'Super Admin deletes a Member',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (17, 'BR-007 / doc 03 §7', 'Super Admin deletes a Member',
      'blocked', sqlerrm, 'PASS');
  end;

  -- D18 ── the pre-auth lockout path must still work.
  -- The automatic 3-attempt lock (FR-155a) happens before anybody is
  -- authenticated, so it presents no actor. If A4's fail-closed rule had been
  -- written too broadly, the Super Admin could never be locked out and
  -- brute-force against the crown jewel would be unlimited.
  perform set_config('app.user_id', '', true);
  begin
    update public.users
       set account_state = 'locked', locked_at = now(), last_login_at = now()
     where id = sa;
    insert into _v values (18, 'FR-155a', 'Unidentified session applies the automatic lockout',
      'allowed', 'allowed', 'PASS');
  exception when others then
    insert into _v values (18, 'FR-155a', 'Unidentified session applies the automatic lockout',
      'allowed', 'BLOCKED — ' || sqlerrm, 'FAIL');
  end;

  -- D19 ── but that narrow path must not become a general one
  begin
    update public.users
       set account_state = 'active', locked_at = null, weekly_capacity_points = 999
     where id = sa;
    insert into _v values (19, 'BR-027', 'Unidentified session smuggles a capacity change into a lockout write',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (19, 'BR-027', 'Unidentified session smuggles a capacity change into a lockout write',
      'blocked', sqlerrm, 'PASS');
  end;


  -- =========================================================================
  -- SECTION E · SUPER ADMIN MFA CANNOT BE DISABLED   (FR-146)
  -- =========================================================================

  insert into public.mfa_factors (user_id, type, secret_encrypted, friendly_name, is_primary, verified_at)
  values (sa, 'totp', 'encrypted-fixture', 'Fixture Authenticator', true, now())
  returning id into f1;

  -- E20 ── removing the only verified factor
  perform set_config('app.user_id', sa::text, true);
  begin
    delete from public.mfa_factors where id = f1;
    insert into _v values (20, 'FR-146', 'Super Admin deletes their only verified MFA factor',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (20, 'FR-146', 'Super Admin deletes their only verified MFA factor',
      'blocked', sqlerrm, 'PASS');
  end;

  -- E21 ── un-verifying it is the same attack by another name
  begin
    update public.mfa_factors set verified_at = null where id = f1;
    insert into _v values (21, 'FR-146', 'Super Admin un-verifies their only MFA factor',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (21, 'FR-146', 'Super Admin un-verifies their only MFA factor',
      'blocked', sqlerrm, 'PASS');
  end;

  -- E22 ── rotation must remain possible, or a lost phone locks him out forever
  insert into public.mfa_factors (user_id, type, credential_id, public_key, friendly_name, verified_at)
  values (sa, 'webauthn', 'fixture-credential-id', 'fixture-public-key', 'Replacement Passkey', now())
  returning id into f2;
  begin
    delete from public.mfa_factors where id = f1;
    insert into _v values (22, 'FR-146 (converse)', 'Super Admin retires an old factor while another remains verified',
      'allowed', 'allowed', 'PASS');
  exception when others then
    insert into _v values (22, 'FR-146 (converse)', 'Super Admin retires an old factor while another remains verified',
      'allowed', 'BLOCKED — ' || sqlerrm, 'FAIL');
  end;


  -- =========================================================================
  -- SECTION F · APPEND-ONLY LOGS   (FR-153, SA-10, doc 19 §6)
  -- =========================================================================
  -- Run as postgres, the table OWNER. That is the point: doc 19 §6 requires
  -- "no UPDATE or DELETE grant for any role", and a REVOKE cannot bind an
  -- owner. Only a trigger can.

  insert into public.audit_log (actor_id, actor_role, entity_type, entity_id, action)
  values (sa, 'super_admin', 'user', me, 'fixture') returning id into al;

  insert into public.security_events (user_id, event_type, severity)
  values (sa, 'fixture', 'info') returning id into sev;

  insert into public.login_attempts (email_attempted, user_id, outcome)
  values ('verify.member@cni.test', me, 'bad_password') returning id into la;

  -- F23
  begin
    update public.audit_log set action = 'tampered' where id = al;
    insert into _v values (23, 'FR-153 / SA-10', 'Table OWNER updates audit_log',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (23, 'FR-153 / SA-10', 'Table OWNER updates audit_log',
      'blocked', sqlerrm, 'PASS');
  end;

  -- F24
  begin
    delete from public.audit_log where id = al;
    insert into _v values (24, 'FR-153 / SA-10', 'Table OWNER deletes from audit_log',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (24, 'FR-153 / SA-10', 'Table OWNER deletes from audit_log',
      'blocked', sqlerrm, 'PASS');
  end;

  -- F25
  begin
    update public.security_events set severity = 'info' where id = sev;
    insert into _v values (25, 'FR-153', 'Table OWNER updates security_events',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (25, 'FR-153', 'Table OWNER updates security_events',
      'blocked', sqlerrm, 'PASS');
  end;

  -- F26
  begin
    delete from public.login_attempts where id = la;
    insert into _v values (26, 'FR-148 / FR-155a', 'Table OWNER deletes a login attempt',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (26, 'FR-148 / FR-155a', 'Table OWNER deletes a login attempt',
      'blocked', sqlerrm, 'PASS');
  end;

  -- F27 ── TRUNCATE deletes no rows individually, so a row trigger never sees it
  begin
    truncate table public.audit_log;
    insert into _v values (27, 'FR-153', 'Table OWNER truncates audit_log',
      'blocked', 'ALLOWED', 'FAIL');
  exception when others then
    insert into _v values (27, 'FR-153', 'Table OWNER truncates audit_log',
      'blocked', sqlerrm, 'PASS');
  end;


  -- =========================================================================
  -- SECTION G · ROW-LEVEL SECURITY   (ADR-003, FR-157, doc 16 §7)
  -- =========================================================================
  -- Now switch to cni_app, which does NOT bypass RLS, and check the second
  -- layer on its own. Results are captured into variables first: cni_app has
  -- no privileges on the temp table.

  -- G28 ── "A Member cannot read another Member's data via direct database
  --         query" — the Phase 1 exit criterion, doc 20 §8.
  perform set_config('app.user_id', me::text, true);
  perform set_config('role', 'cni_app', true);
  select count(*) into seen from public.users;
  perform set_config('role', 'postgres', true);
  insert into _v values (28, 'ADR-003 / FR-157',
    format('Member SELECTs users (%s rows exist)', total_users),
    'exactly 1 row — their own', format('%s row(s)', seen),
    case when seen = 1 then 'PASS' else 'FAIL' end);

  -- G29 ── but names and avatars must still resolve, or every comment renders
  --        as an anonymous blank
  perform set_config('role', 'cni_app', true);
  select count(*) into seen from public.user_directory;
  perform set_config('role', 'postgres', true);
  insert into _v values (29, 'ADR-003 / doc 16 §7',
    'Member SELECTs user_directory (name + avatar only)',
    format('all %s rows', total_users), format('%s row(s)', seen),
    case when seen = total_users then 'PASS' else 'FAIL' end);

  -- G30 ── credentials are the owner's alone
  perform set_config('role', 'cni_app', true);
  select count(*) into seen from public.auth_identities;
  perform set_config('role', 'postgres', true);
  insert into _v values (30, 'doc 04 §5',
    'Member SELECTs auth_identities (2 rows exist)',
    'exactly 1 row — their own', format('%s row(s)', seen),
    case when seen = 1 then 'PASS' else 'FAIL' end);

  -- G31 ── a Coordinator legitimately sees the whole team
  perform set_config('app.user_id', co::text, true);
  perform set_config('role', 'cni_app', true);
  select count(*) into seen from public.users;
  perform set_config('role', 'postgres', true);
  insert into _v values (31, 'doc 03 §3 (converse)',
    'Coordinator SELECTs users',
    format('all %s rows', total_users), format('%s row(s)', seen),
    case when seen = total_users then 'PASS' else 'FAIL' end);

  -- G32 ── the security stream is the Super Admin's alone
  perform set_config('app.user_id', ad::text, true);
  perform set_config('role', 'cni_app', true);
  select count(*) into seen from public.security_events;
  perform set_config('role', 'postgres', true);
  insert into _v values (32, 'doc 03 (security dashboard)',
    'Admin SELECTs security_events',
    '0 rows', format('%s row(s)', seen),
    case when seen = 0 then 'PASS' else 'FAIL' end);

  -- G33 ── the sealed credential has no client path at all, in any direction
  perform set_config('role', 'cni_app', true);
  begin
    select count(*) into seen from public.break_glass;
    perform set_config('role', 'postgres', true);
    insert into _v values (33, 'doc 04 §5', 'Application role SELECTs break_glass',
      'permission denied', format('ALLOWED — %s row(s) readable', seen), 'FAIL');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into _v values (33, 'doc 04 §5', 'Application role SELECTs break_glass',
      'permission denied', sqlerrm, 'PASS');
  end;

  -- G34 ── a Member cannot manufacture an account
  perform set_config('app.user_id', me::text, true);
  perform set_config('role', 'cni_app', true);
  begin
    insert into public.users (full_name, email, role, account_state)
    values ('Self Promoted', 'verify.selfmade@cni.test', 'admin', 'active');
    perform set_config('role', 'postgres', true);
    insert into _v values (34, 'FR-141 / doc 03 §3', 'Member INSERTs an Admin account',
      'blocked by RLS', 'ALLOWED', 'FAIL');
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into _v values (34, 'FR-141 / doc 03 §3', 'Member INSERTs an Admin account',
      'blocked by RLS', sqlerrm, 'PASS');
  end;

  -- G35 ── and cannot edit a colleague. RLS filters the row out, so this is a
  --        silent zero-row UPDATE rather than an error — which is why the
  --        assertion checks the row count, not for an exception.
  perform set_config('role', 'cni_app', true);
  update public.users set full_name = 'Renamed by a peer' where id = co;
  get diagnostics seen = row_count;
  perform set_config('role', 'postgres', true);
  insert into _v values (35, 'ADR-003 / FR-157', 'Member UPDATEs a Coordinator''s row',
    '0 rows affected', format('%s row(s) affected', seen),
    case when seen = 0 then 'PASS' else 'FAIL' end);

end
$$;


-- ----------------------------------------------------------------------------
-- RESULTS
-- ----------------------------------------------------------------------------
select
  n,
  verdict,
  requirement,
  assertion,
  expected,
  left(observed, 120) as observed
from _v
order by n;

select
  count(*)                                          as assertions,
  count(*) filter (where verdict = 'PASS')           as passed,
  count(*) filter (where verdict = 'FAIL')           as failed,
  case when count(*) filter (where verdict = 'FAIL') = 0
       then 'GATE PASSED'
       else 'GATE FAILED'
  end                                               as gate
from _v;

-- Nothing this script did is kept.
rollback;
