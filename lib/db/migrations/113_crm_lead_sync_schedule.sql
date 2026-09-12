-- ============================================================================
-- 113 · THE LEAD IMPORT RUNS ITSELF — Step 3 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-10: *"make sure that this cron job is set on Supabase."*
--
-- Same arrangement as migration 102, which moved the Meta sync off Vercel for
-- the same reason: **the Vercel Hobby plan permits one cron run per day**, and
-- it refuses a deployment carrying anything more frequent outright. A lead that
-- arrives at 9am and is called at 9am tomorrow is a lost lead — response time
-- moves conversion more than almost anything else in a CRM.
--
-- So `pg_cron` runs it from inside Postgres, `pg_net` makes the HTTP call, and
-- the bearer token comes from Supabase Vault.
--
-- ── ⚠️ EVERY FIFTEEN MINUTES, AND WHY NOT FASTER ───────────────────────────
-- The real answer for speed is a leadgen webhook — under 5 seconds instead of
-- up to 15 minutes — but that needs Meta App Review and a public callback, and
-- **webhooks fail silently**, so a poller is needed as reconciliation anyway.
-- This poller is that reconciliation, built first. When the webhook lands
-- (Step 12's parked list) this stays exactly as it is.
--
-- Fifteen minutes rather than five: each run walks every form and pages every
-- lead, which is ~30 seconds of Graph calls for one page today. Five-minute runs
-- would triple the API budget to shave ten minutes off a response time nobody
-- is measuring in minutes yet.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · A RECORD OF EVERY RUN
-- ----------------------------------------------------------------------------
-- ⚠️ WITHOUT THIS, A BROKEN IMPORT IS INVISIBLE. The job returns a request id
-- and nothing else; the response arrives asynchronously in `net._http_response`
-- and is garbage-collected. If the token is revoked or a page loses access, the
-- leads simply stop arriving and the first person to notice is whoever wonders
-- why the list has gone quiet — which in a CRM is weeks.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_lead_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  sources       integer not null default 0,
  succeeded     integer not null default 0,
  failed        integer not null default 0,
  leads_new     integer not null default 0,
  leads_updated integer not null default 0,
  /* One line per source that failed, so the reason survives the run. */
  errors        jsonb not null default '[]'::jsonb,
  trigger       text not null default 'cron'   -- cron | manual | backfill
);

create index if not exists crm_lead_sync_runs_recent_idx
  on public.crm_lead_sync_runs (started_at desc);

alter table public.crm_lead_sync_runs enable row level security;

/* Readable by anyone who may see the CRM; written only by the importer's
   SECURITY DEFINER function below. */
drop policy if exists crm_lead_sync_runs_select on public.crm_lead_sync_runs;
create policy crm_lead_sync_runs_select on public.crm_lead_sync_runs
  for select using (app.acting_at_least('team_coordinator'::public.user_role));

grant select on public.crm_lead_sync_runs to cni_app;


-- ── The importer records its own run ───────────────────────────────────────
create or replace function app.crm_record_sync_run(
  p_sources       integer,
  p_succeeded     integer,
  p_failed        integer,
  p_leads_new     integer,
  p_leads_updated integer,
  p_errors        jsonb default '[]'::jsonb,
  p_trigger       text  default 'cron'
)
returns uuid
language sql
security definer
set search_path = public, app, pg_temp
as $$
  insert into public.crm_lead_sync_runs
    (finished_at, sources, succeeded, failed, leads_new, leads_updated, errors, trigger)
  values
    (now(), p_sources, p_succeeded, p_failed, p_leads_new, p_leads_updated, p_errors, p_trigger)
  returning id;
$$;

grant execute on function app.crm_record_sync_run(integer, integer, integer, integer, integer, jsonb, text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE TRIGGER
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.trigger_crm_lead_sync()
returns bigint
language plpgsql
security definer
set search_path = public, app, extensions, vault, pg_temp
as $$
declare
  v_secret  text;
  v_project uuid;
  v_url     text;
  v_request bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'CRON_SECRET'
   limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    /* ⚠️ Raised, not swallowed. An unauthenticated call would 401 somewhere
       nobody is watching, and the import would appear to be running. */
    raise exception
      'app.trigger_crm_lead_sync: no CRON_SECRET in Supabase Vault. Add it under that exact name, or this job cannot authenticate.';
  end if;

  /* ── ⚠️ SCOPED TO ONE PROJECT, BY NAME, ON PURPOSE ────────────────────────
     Owner, 2026-09-10: *"just choose one project, like Chitral Royal Homes, and
     implement this whole CRM. Later on I will do the same thing for the other
     projects."*

     Resolved by NAME rather than a uuid pasted into a job definition, because a
     uuid in a cron schedule is unreadable and unverifiable six months from now.

     ⚠️ ADDING THE SECOND PROJECT: either change this name, or delete the
     `?project=` parameter entirely — the endpoint imports every readable page
     when it is absent. Nothing else needs to change; the schema was never
     narrowed. */
  select id into v_project from public.projects
   where name = 'Chitral Royal Homes' limit 1;

  v_url := 'https://taskly.aidigitaldivision.com/api/crm/lead-sync';
  if v_project is not null then
    v_url := v_url || '?project=' || v_project::text;
  end if;

  select net.http_get(
    url     := v_url,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'User-Agent',    'taskly-pg-cron/1'
               ),
    /* ⚠️ Generous. A full pass pages every lead on every form — the first
       Chitral run walked 615 leads across 6 forms. The request is queued rather
       than blocking anything if it overruns. */
    timeout_milliseconds := 180000
  ) into v_request;

  return v_request;
end $$;

comment on function app.trigger_crm_lead_sync() is
  'Calls /api/crm/lead-sync with the vault CRON_SECRET (113). Scoped to one '
  'project by name; drop the ?project= parameter to import every readable page.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE SCHEDULE
-- ⚠️ Unscheduled first, so re-running this migration replaces the job rather
-- than failing on a duplicate name or, worse, leaving two jobs racing.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  perform cron.unschedule('crm-lead-sync');
exception when others then
  null;   -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'crm-lead-sync',
  '*/15 * * * *',
  $job$ select app.trigger_crm_lead_sync(); $job$
);


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n       integer;
  v_sched text;
begin
  -- 1 · The job exists, is active, and runs when it says it does.
  select count(*), max(schedule) into n, v_sched
    from cron.job where jobname = 'crm-lead-sync' and active;
  if n <> 1 then
    raise exception '113 · the crm-lead-sync job is not scheduled';
  end if;
  if v_sched <> '*/15 * * * *' then
    raise exception '113 · crm-lead-sync runs on %, expected every 15 minutes', v_sched;
  end if;

  -- 2 · ⚠️ THE SECRET IS THERE. Scheduling a job that cannot authenticate is
  --     worse than not scheduling one: it looks healthy and does nothing.
  select count(*) into n from vault.decrypted_secrets where name = 'CRON_SECRET';
  if n <> 1 then
    raise exception '113 · CRON_SECRET is not in the vault; the job would 401 every run';
  end if;

  -- 3 · The project it is scoped to actually exists, or the URL silently loses
  --     its filter and imports everything.
  select count(*) into n from public.projects where name = 'Chitral Royal Homes';
  if n <> 1 then
    raise exception '113 · the project this job is scoped to was not found by name';
  end if;

  -- 4 · The run recorder works with no session, as the importer will call it.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  perform app.crm_record_sync_run(1, 1, 0, 0, 0, '[]'::jsonb, 'selfcheck');
  reset role;

  delete from public.crm_lead_sync_runs where trigger = 'selfcheck';

  raise notice '113 · crm-lead-sync scheduled every 15 minutes, secret present, runs recordable';
end $$;
