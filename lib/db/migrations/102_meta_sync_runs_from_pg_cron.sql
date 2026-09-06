-- ============================================================================
-- 102 · THE META SYNC IS SCHEDULED BY THE DATABASE — owner, 2026-09-06
-- ----------------------------------------------------------------------------
-- *"Why are you using a cron job on Vercel or GitHub? I want to put a cron job
-- on Supabase, my database."*
--
-- The right call, and it removes a constraint rather than working around one.
-- Vercel's Hobby plan permits ONE cron run per day and refused the two-hourly
-- schedule outright, so collection had been reduced to daily. `pg_cron` has no
-- such limit: the database schedules the pull itself, every two hours, and the
-- plan stops being part of the design.
--
-- ── ⚠️ THE SECRET LIVES IN SUPABASE VAULT, NEVER IN THIS FILE ──────────────
-- The endpoint is guarded by `CRON_SECRET` compared in constant time. Writing
-- that token into a migration would put a live credential into version control
-- for good — git keeps it even after a later commit removes it. So the job reads
-- it from `vault.decrypted_secrets` at call time, and the value is put there by
-- a human, once, outside this file.
--
-- ⚠️ A MISSING SECRET IS A LOUD FAILURE, NOT A SILENT ONE. If the vault entry is
-- absent the function raises rather than firing an unauthenticated request that
-- would 401 into a void nobody reads. The job then appears as a failure in
-- `cron.job_run_details`, which is where somebody would actually look.
--
-- ── ⚠️ WHY `pg_net` AND NOT `http` ─────────────────────────────────────────
-- Both are available. `http` is SYNCHRONOUS: the cron worker would hold a
-- database connection open for the whole sync — a minute or more of Graph API
-- calls — for no benefit. `pg_net` queues the request and returns immediately,
-- so the scheduler is never blocked by how slow Meta happens to be.
--
-- The consequence is that this job cannot see the result, and does not pretend
-- to: the outcome is recorded by the endpoint itself, per account, in
-- `meta_sync_runs` and on `meta_accounts.last_error` — which the Studio already
-- reads and displays. `net._http_response` holds the raw reply for a while if
-- somebody needs to debug the call rather than the collection.
-- ============================================================================

create extension if not exists pg_cron  with schema pg_catalog;
create extension if not exists pg_net   with schema extensions;


-- ════════════════════════════════════════════════════════════════════════════
-- THE CALLER
-- ----------------------------------------------------------------------------
-- ⚠️ THE URL IS HARDCODED AND THAT IS DELIBERATE. It is public — it appears in
-- every browser address bar — so there is nothing to protect, and putting it in
-- a settings table would mean one more place to look when the job stops working.
-- A grep for the domain finds this file.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.trigger_meta_sync()
returns bigint
language plpgsql
security definer
set search_path = public, app, extensions, vault, pg_temp
as $$
declare
  v_secret  text;
  v_request bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'CRON_SECRET'
   limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    -- ⚠️ Raised, not swallowed. See the header: an unauthenticated call would
    -- 401 somewhere nobody is watching, and the sync would appear to be running.
    raise exception
      'app.trigger_meta_sync: no CRON_SECRET in Supabase Vault. Add it under that exact name, or this job cannot authenticate.';
  end if;

  select net.http_get(
    url     := 'https://taskly.aidigitaldivision.com/api/meta-sync',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'User-Agent',    'taskly-pg-cron/1'
               ),
    -- ⚠️ GENEROUS, BECAUSE THE ENDPOINT IS SLOW BY NATURE. A full pull walks
    -- every metric for every account a day at a time; two minutes is comfortable
    -- and the request is queued rather than blocking anything if it overruns.
    timeout_milliseconds := 120000
  ) into v_request;

  return v_request;
end $$;

comment on function app.trigger_meta_sync() is
  'Calls /api/meta-sync with the vault CRON_SECRET (102). Scheduled by pg_cron '
  'every two hours — Vercel''s Hobby plan permits only one cron run per day.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE SCHEDULE
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY TWO HOURS ON THE HOUR, IN UTC. `pg_cron` reads its schedule in the
-- database's own timezone, which is UTC — so this fires at 02:00, 04:00 … in
-- Karachi terms, and there is no daylight saving anywhere in the chain to shift
-- it. Every DATE this system stores is still Karachi's; only the firing instants
-- are UTC, and a two-hourly job does not care which hour it starts on.
--
-- ⚠️ UNSCHEDULED FIRST. `cron.schedule` on an existing name updates it, but the
-- unschedule makes re-running this migration safe even if the job was created by
-- hand with a different definition.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  perform cron.unschedule('meta-sync');
exception when others then
  -- No such job. Expected on a first run.
  null;
end $$;

select cron.schedule(
  'meta-sync',
  '0 */2 * * *',
  $job$ select app.trigger_meta_sync() $job$
);


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT DOES NOT CALL THE ENDPOINT. A migration that fired a real sync would
-- make applying it a side-effecting act, and re-running it would re-pull. What
-- is asserted is that the job EXISTS, is active, and is on the intended
-- schedule — and whether the secret is in place, reported as a notice rather
-- than a failure so the migration can be applied before the vault entry.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_schedule text;
  v_active   boolean;
  n          integer;
begin
  select schedule, active into v_schedule, v_active
    from cron.job where jobname = 'meta-sync';

  if v_schedule is null then
    raise exception '102 · the meta-sync job was not scheduled';
  end if;
  if v_schedule <> '0 */2 * * *' then
    raise exception '102 · meta-sync is on schedule %, expected 0 */2 * * *', v_schedule;
  end if;
  if not v_active then
    raise exception '102 · the meta-sync job exists but is not active';
  end if;

  select count(*) into n from vault.decrypted_secrets where name = 'CRON_SECRET';

  if n = 0 then
    raise notice '102 · scheduled every 2 hours. ⚠️ CRON_SECRET IS NOT IN THE VAULT YET — the job will fail until it is added under that exact name.';
  else
    raise notice '102 · scheduled every 2 hours, and CRON_SECRET is in the vault.';
  end if;
end $$;
