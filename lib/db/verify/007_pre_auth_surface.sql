-- ============================================================================
-- CNI CRM — GATE PROOF FOR THE PRE-AUTHENTICATION SURFACE (Step 4, part 1)
-- ----------------------------------------------------------------------------
-- 32 assertions over migrations 007–009: identity lookup, attempt recording,
-- the lockout cache, tokens, MFA factor selection, session creation, refresh
-- reuse detection, and privilege isolation.
--
-- HOW TO RUN IT
--   Paste the whole file into the Supabase SQL editor, psql, or the MCP.
--   Wrapped in BEGIN … ROLLBACK, so every fixture disappears and it is safe to
--   run against production, repeatedly. Every row must read PASS.
--
-- Last run: 2026-08-06, Session 08 — 32 assertions, 32 PASS.
--
-- ────────────────────────────────────────────────────────────────────────────
-- THIS SCRIPT FOUND TWO REAL DEFECTS ON ITS FIRST RUN
--
--   1. `auth_record_attempt` — 42804, enum cast. Under `search_path = ''` the
--      bare CASE literals stayed `text`, so every FAILED sign-in would have
--      raised instead of being recorded, leaving the ledger that the lockout,
--      rate limiting and anomaly detection all read permanently empty.
--      Fixed by migration 008.
--
--   2. `auth_detect_reuse` — 42702, ambiguous column. The RETURNS TABLE OUT
--      parameters are plpgsql variables in scope for the whole body, so the
--      unqualified `where user_id = …` was ambiguous. FR-150's response to a
--      STOLEN token would have thrown instead of revoking anything — while the
--      happy path worked perfectly.
--      Fixed by migration 009.
--
-- Both functions compiled, deployed and read correctly. plpgsql does not
-- name-resolve or type-check statement bodies until they execute, so neither
-- defect was visible until something called them. That is the argument for
-- proving a migration rather than reviewing it.
-- ============================================================================

begin;

create temporary table _v (
  n           integer,
  requirement text,
  assertion   text,
  expected    text,
  observed    text,
  verdict     text
) on commit drop;

do $$
declare
  u        uuid;
  admin_id uuid;
  tok_ok   text := md5('tok-ok-a')  || md5('tok-ok-b');
  tok_exp  text := md5('tok-exp-a') || md5('tok-exp-b');
  tok_sup  text := md5('tok-sup-a') || md5('tok-sup-b');
  tok_unl  text := md5('tok-unl-a') || md5('tok-unl-b');
  sess_a   uuid;
  rt_a     text := md5('rt-a-1') || md5('rt-a-2');
  rt_b     text := md5('rt-b-1') || md5('rt-b-2');
  r record; n integer; b boolean; ts timestamptz; txt text;
begin
  ---------------------------------------------------------------- fixtures
  insert into public.users (full_name, email, role, account_state)
  values ('Verify Member', 'verify.auth@cni.test', 'member', 'active') returning id into u;
  insert into public.users (full_name, email, role, account_state)
  values ('Verify Admin', 'verify.auth.admin@cni.test', 'admin', 'active') returning id into admin_id;
  insert into public.auth_identities (user_id, provider, password_hash)
  values (u, 'password', 'argon2id-fixture-hash');

  -- ===== 1 · IDENTITY LOOKUP =====
  select * into r from app.auth_find_identity('verify.auth@cni.test');
  insert into _v values (1,'registry C-15','auth_find_identity returns the account and its hash',
    'one row with the hash', coalesce(r.email,'(none)')||' / '||coalesce(r.password_hash,'(null)'),
    case when r.user_id=u and r.password_hash='argon2id-fixture-hash' then 'PASS' else 'FAIL' end);

  select count(*) into n from app.auth_find_identity('VERIFY.AUTH@CNI.TEST');
  insert into _v values (2,'doc 04 §2','lookup is case-insensitive on the address',
    '1 row', n||' row(s)', case when n=1 then 'PASS' else 'FAIL' end);

  select count(*) into n from app.auth_find_identity('nobody@cni.test');
  insert into _v values (3,'FR-155e','unknown address returns zero rows, does not raise',
    '0 rows', n||' row(s)', case when n=0 then 'PASS' else 'FAIL' end);

  select f.has_verified_mfa into b from app.auth_find_identity('verify.auth@cni.test') f;
  insert into _v values (4,'FR-145','reports that no MFA factor is enrolled yet',
    'false', coalesce(b::text,'null'), case when b=false then 'PASS' else 'FAIL' end);

  -- ===== 2 · ATTEMPTS =====
  perform app.auth_record_attempt('verify.auth@cni.test',u,'bad_password','203.0.113.9'::inet,'PK','test');
  perform app.auth_record_attempt('verify.auth@cni.test',u,'bad_password','203.0.113.9'::inet,'PK','test');
  perform app.auth_record_attempt('verify.auth@cni.test',u,'bad_password','203.0.113.9'::inet,'PK','test');

  select count(*) into n from public.login_attempts where user_id=u;
  insert into _v values (5,'FR-148','attempts are appended to the ledger','3',n::text,
    case when n=3 then 'PASS' else 'FAIL' end);

  select count(*) into n from public.security_events where user_id=u and event_type='login_failed';
  insert into _v values (6,'doc 16 §10','each failure raises a security event','3',n::text,
    case when n=3 then 'PASS' else 'FAIL' end);

  perform app.auth_record_attempt('ghost@cni.test',null,'unknown_account','203.0.113.9'::inet,'PK','test');
  select count(*) into n from public.login_attempts where email_attempted='ghost@cni.test';
  insert into _v values (7,'FR-152','attempts on unknown addresses are still recorded','1',n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  select count(*) into n from app.auth_recent_attempts(u, now()-interval '1 hour');
  insert into _v values (8,'lockout inputs','auth_recent_attempts feeds the domain rule',
    '3 ordered rows', n::text, case when n=3 then 'PASS' else 'FAIL' end);

  -- ===== 3 · CACHING THE LOCK — the actor-less bookkeeping path =====
  -- Proves migration 005's users trigger still permits exactly this write and
  -- nothing wider. Assertion 18/19 of the Step 2 gate proof is the other half.
  perform app.auth_set_lock(u, now());
  select count(*) into n from public.users where id=u and account_state='locked' and locked_at is not null;
  insert into _v values (9,'FR-155a','auth_set_lock caches the verdict through the users trigger',
    'locked with a timestamp', 'rows matching = '||n, case when n=1 then 'PASS' else 'FAIL' end);

  select count(*) into n from public.security_events where user_id=u and event_type='account_locked';
  insert into _v values (10,'doc 16 §10','locking raises a warning-level security event','1',n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  perform app.auth_set_lock(u, null);
  select count(*) into n from public.users where id=u and account_state='active' and locked_at is null;
  insert into _v values (11,'Q-048','auth_set_lock(null) clears the lock',
    'active, no timestamp', 'rows matching = '||n, case when n=1 then 'PASS' else 'FAIL' end);

  -- ===== 4 · TOKENS =====
  insert into public.invitations (user_id,token_hash,purpose,sent_to_email,expires_at)
  values (u,tok_ok,'password_reset','verify.auth@cni.test',now()+interval '15 minutes');
  select t.status into txt from app.auth_consume_token(tok_ok,'password_reset') t;
  insert into _v values (12,'FR-155','a live token is consumed once','ok',txt,
    case when txt='ok' then 'PASS' else 'FAIL' end);

  select t.status into txt from app.auth_consume_token(tok_ok,'password_reset') t;
  insert into _v values (13,'FR-142','the same token cannot be used twice','already_used',txt,
    case when txt='already_used' then 'PASS' else 'FAIL' end);

  insert into public.invitations (user_id,token_hash,purpose,sent_to_email,created_at,expires_at)
  values (u,tok_exp,'password_reset','verify.auth@cni.test',now()-interval '30 minutes',now()-interval '1 minute');
  select t.status into txt from app.auth_consume_token(tok_exp,'password_reset') t;
  insert into _v values (14,'FR-155','an expired token is refused','expired',txt,
    case when txt='expired' then 'PASS' else 'FAIL' end);

  insert into public.invitations (user_id,token_hash,purpose,sent_to_email,expires_at)
  values (u,tok_sup,'password_reset','verify.auth@cni.test',now()+interval '15 minutes');
  select app.auth_invalidate_tokens(u,'password_reset') into n;
  select t.status into txt from app.auth_consume_token(tok_sup,'password_reset') t;
  insert into _v values (15,'FR-155','requesting a new code supersedes the previous one','superseded',txt,
    case when txt='superseded' then 'PASS' else 'FAIL' end);

  select t.status into txt from app.auth_consume_token(md5('nope')||md5('nope'),'password_reset') t;
  insert into _v values (16,'FR-155e','an unknown token is refused without raising','not_found',txt,
    case when txt='not_found' then 'PASS' else 'FAIL' end);

  insert into public.invitations (user_id,token_hash,purpose,sent_to_email,expires_at)
  values (u,tok_unl,'account_unlock','verify.auth@cni.test',now()+interval '15 minutes');
  perform app.auth_consume_token(tok_unl,'account_unlock');
  select app.auth_last_unlock_at(u) into ts;
  insert into _v values (17,'registry C-17','a consumed unlock token IS the clearedAt the rule needs',
    'a timestamp', coalesce(ts::text,'null'), case when ts is not null then 'PASS' else 'FAIL' end);

  select app.auth_register_token_attempt(md5('x')||md5('y')) into n;
  insert into _v values (18,'FR-155','counting an attempt on a non-existent token is harmless','0',n::text,
    case when n=0 then 'PASS' else 'FAIL' end);

  -- ===== 5 · MFA =====
  insert into public.mfa_factors (user_id,type,secret_encrypted,friendly_name,is_primary,verified_at)
  values (u,'totp','enc-seed','Verified authenticator',true,now());
  insert into public.mfa_factors (user_id,type,secret_encrypted,friendly_name,verified_at)
  values (u,'totp','enc-seed-2','Never verified',null);

  select count(*) into n from app.auth_verified_factors(u);
  insert into _v values (19,'FR-145','only VERIFIED factors are offered at sign-in','1 of 2',n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  select f.has_verified_mfa into b from app.auth_find_identity('verify.auth@cni.test') f;
  insert into _v values (20,'FR-145','the identity lookup now reports MFA enrolled','true',
    coalesce(b::text,'null'), case when b then 'PASS' else 'FAIL' end);

  -- ===== 6 · SESSIONS AND REUSE DETECTION =====
  select app.auth_create_session(u,rt_a,'device-a',now()+interval '7 days',now()+interval '30 days',
                                 'test-agent','203.0.113.9'::inet,'PK','AS17557',null) into sess_a;
  insert into _v values (21,'FR-150','a session is created after successful authentication','a session id',
    coalesce(sess_a::text,'null'), case when sess_a is not null then 'PASS' else 'FAIL' end);

  select d.outcome into txt from app.auth_detect_reuse(rt_a) d;
  insert into _v values (22,'FR-150','a live refresh token is accepted','ok',txt,
    case when txt='ok' then 'PASS' else 'FAIL' end);

  -- Rotate: revoke the old, issue the new, then replay the OLD one. That is theft.
  update public.sessions set revoked_at=now(), revoked_reason='rotated' where id=sess_a;
  perform app.auth_create_session(u,rt_b,'device-a',now()+interval '7 days',now()+interval '30 days',
                                  'test-agent','203.0.113.9'::inet,'PK','AS17557',sess_a);

  select d.outcome into txt from app.auth_detect_reuse(rt_a) d;
  insert into _v values (23,'FR-150','replaying a rotated token is detected as reuse','reuse_detected',txt,
    case when txt='reuse_detected' then 'PASS' else 'FAIL' end);

  select count(*) into n from public.sessions where user_id=u and revoked_at is null;
  insert into _v values (24,'FR-150','reuse revokes EVERY session on the account','0 live sessions',n::text,
    case when n=0 then 'PASS' else 'FAIL' end);

  select count(*) into n from public.security_events
   where user_id=u and event_type='refresh_token_reuse' and severity='critical';
  insert into _v values (25,'doc 16 §10','reuse raises a CRITICAL security event','1',n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  select d.outcome into txt from app.auth_detect_reuse(md5('no')||md5('such')) d;
  insert into _v values (26,'FR-150','an unknown refresh token is refused without raising','unknown',txt,
    case when txt='unknown' then 'PASS' else 'FAIL' end);

  perform app.auth_create_session(admin_id,md5('rt-c1')||md5('rt-c2'),'device-x',
                                  now()+interval '1 day',now()+interval '30 days');
  select app.auth_revoke_all_sessions(admin_id,'password reset') into n;
  insert into _v values (27,'FR-155c','a reset revokes every session on the account','1 revoked',n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  -- ===== 7 · PRIVILEGE ISOLATION =====
  -- auth_find_identity returns password hashes. If any of these three fail,
  -- nothing else in this file matters.
  insert into _v values (28,'registry C-15','PUBLIC cannot execute the identity lookup','false',
    has_function_privilege('public','app.auth_find_identity(text)','execute')::text,
    case when not has_function_privilege('public','app.auth_find_identity(text)','execute') then 'PASS' else 'FAIL' end);

  insert into _v values (29,'doc 16 §8','anon (the key in the browser bundle) cannot execute it','false',
    has_function_privilege('anon','app.auth_find_identity(text)','execute')::text,
    case when not has_function_privilege('anon','app.auth_find_identity(text)','execute') then 'PASS' else 'FAIL' end);

  insert into _v values (30,'registry C-14','the application role CAN execute it','true',
    has_function_privilege('cni_app','app.auth_find_identity(text)','execute')::text,
    case when has_function_privilege('cni_app','app.auth_find_identity(text)','execute') then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='app' and p.proname like 'auth\_%' and has_function_privilege('anon',p.oid,'execute');
  insert into _v values (31,'doc 16 §8','NO pre-auth function is reachable by anon','0',n::text,
    case when n=0 then 'PASS' else 'FAIL' end);

  -- ⚠️ Postgres stores `SET search_path = ''` as the string search_path=""
  -- (with the quotes), not search_path=. Checking for the wrong one reported
  -- all 13 functions as unpinned when every one of them was correct — the
  -- assertion was broken, not the code.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='app' and p.proname like 'auth\_%'
     and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)));
  insert into _v values (32,'doc 16 §9 A05','every pre-auth function pins an empty search_path',
    '0 unpinned', n::text, case when n=0 then 'PASS' else 'FAIL' end);
end
$$;

-- ----------------------------------------------------------------------------
-- RESULTS
-- ----------------------------------------------------------------------------
select n, verdict, requirement, assertion, expected, left(observed, 90) as observed
from _v order by n;

select
  count(*)                                        as assertions,
  count(*) filter (where verdict = 'PASS')        as passed,
  count(*) filter (where verdict = 'FAIL')        as failed,
  case when count(*) filter (where verdict = 'FAIL') = 0
       then 'PASSED' else 'FAILED' end            as gate
from _v;

-- Nothing this script did is kept.
rollback;
