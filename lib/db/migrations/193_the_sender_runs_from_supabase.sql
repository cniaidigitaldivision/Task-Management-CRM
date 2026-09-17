-- ============================================================================
-- 193 · THE SENDER RUNS FROM SUPABASE, NOT FROM VERCEL
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"why are you using the cron job on Vercel? Please use the
-- cron job in Supabase."*
--
-- They are right, and this project already works that way: `meta-sync` and
-- `crm-lead-sync` are `pg_cron` jobs that call the app over `pg_net`, reading
-- `CRON_SECRET` from Supabase Vault. Putting this one on Vercel's scheduler would
-- have been a second scheduler, in a second place, with a second set of logs —
-- and Vercel's own cron cannot run every fifteen minutes on every plan.
--
-- So the sender joins the other five, in the same style as 102's
-- `app.trigger_meta_sync` and `app.trigger_crm_lead_sync`.
--
-- ── ⚠️ THE SECRET IS NOT IN THIS FILE, AND MUST NOT BE ─────────────────────
-- It is read from Vault at call time (`scripts/vault-secret.mjs` puts it there).
-- A migration is committed to git; a bearer token in one is a token published.
--
-- ── ⚠️ AND A MISSING SECRET RAISES RATHER THAN SENDING NOTHING ─────────────
-- An unauthenticated call would 401 somewhere nobody watches, and the follow-ups
-- would look scheduled while nothing ever went out. The same reasoning 102 gave.
-- ============================================================================

create or replace function app.trigger_crm_followup_sender()
returns bigint
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_secret  text;
  v_request bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'CRON_SECRET'
   limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    raise exception
      'app.trigger_crm_followup_sender: no CRON_SECRET in Supabase Vault. Add it under that exact name, or no follow-up can be sent.';
  end if;

  select net.http_get(
    /* The deployed app, written out for the same reason 102 writes it out: a
       scheduled job that resolves its own target from a table is a job nobody
       can read six months later. */
    url     := 'https://taskly.aidigitaldivision.com/api/cron/crm-followups',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'User-Agent',    'taskly-pg-cron/1'
               ),
    /* ⚠️ LONGER THAN THE ROUTE'S OWN CEILING. The route sends serially — one
       client is never messaged twice because two rows raced — and caps itself at
       25 messages and 60 seconds. `pg_net` queues the request; it blocks
       nothing here either way. */
    timeout_milliseconds := 120000
  ) into v_request;

  return v_request;
end
$fn$;

revoke all on function app.trigger_crm_followup_sender() from public;

comment on function app.trigger_crm_followup_sender() is
  'Calls /api/cron/crm-followups with the Vault CRON_SECRET, so due follow-ups are actually sent. Scheduled as crm-followup-sender. 193.';

/* ── The schedule ─────────────────────────────────────────────────────────
   ⚠️ FIVE MINUTES, NOT FIFTEEN. `crm-sequences` (170) decides what is due every
   fifteen; this delivers. Two fifteen-minute clocks that do not line up can add
   half an hour to a step somebody scheduled to the minute — and the route
   advances the sequences itself before sending, so a five-minute beat makes the
   whole chain at most five minutes late.

   ⚠️ AND IT COSTS NOTHING WHEN THERE IS NOTHING TO DO: the queue is one indexed
   query and the route returns `due: 0`. */
do $$
begin
  perform cron.unschedule('crm-followup-sender');
exception when others then
  null;
end $$;

select cron.schedule(
  'crm-followup-sender',
  '*/5 * * * *',
  $job$ select app.trigger_crm_followup_sender(); $job$
);

-- ============================================================================
-- SELF-CHECK
-- ⚠️ IT DOES NOT CALL THE ROUTE. A migration that sent live WhatsApp messages
-- as a side effect of proving its own schedule would be the worst self-check in
-- this repository. It checks that the job exists, that the function is there,
-- and that the secret it needs is in Vault.
-- ============================================================================
do $chk$
declare
  v_schedule text;
  v_active boolean;
  v_secret text;
begin
  select schedule, active into v_schedule, v_active
    from cron.job where jobname = 'crm-followup-sender';
  if v_schedule is null then
    raise exception '193 · the sender is not scheduled';
  end if;
  if v_schedule <> '*/5 * * * *' or not v_active then
    raise exception '193 · the sender is scheduled wrongly (% / active %)', v_schedule, v_active;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'trigger_crm_followup_sender'
  ) then
    raise exception '193 · the function the job calls does not exist';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
  if v_secret is null or length(trim(v_secret)) = 0 then
    raise exception '193 · CRON_SECRET is not in Vault — the job would raise on its first run';
  end if;

  /* ⚠️ The engine stays on its own schedule as well. The route asks it first, so
     this is belt and braces: if the app is down for an hour, the steps are still
     queued and go out when it returns. */
  if not exists (select 1 from cron.job where jobname = 'crm-sequences' and active) then
    raise exception '193 · the sequence engine is no longer scheduled';
  end if;

  raise notice '193 · the sender runs from Supabase every five minutes, with the secret it needs, and the engine keeps its own beat';
end $chk$;
