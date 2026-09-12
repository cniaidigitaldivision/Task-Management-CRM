-- ============================================================================
-- 134 · A BROKEN IMPORTER STOPS BEING SILENT
-- ----------------------------------------------------------------------------
-- The oldest open gap in this CRM, flagged in the tracker since 2026-09-10 and
-- never closed: if the Meta token breaks, `crm_lead_sync_runs.errors` records it
-- and **nobody is told**. Step 8 notifies about leads going quiet, not about the
-- thing that feeds them dying.
--
-- ── ⚠️ AND WE ALREADY LIVED THROUGH THE FAILURE THIS MUST CATCH ────────────
-- Between 2026-09-09 and 2026-09-12 the importer was dead for three days. The
-- cron fired every fifteen minutes and got a 404 every time, because the route
-- existed only on an undeployed branch.
--
-- ⚠️ **IT WROTE NO ERROR ROWS AT ALL.** `crm_lead_sync_runs` stayed empty,
-- because nothing ever reached the code that records a run. An alert that
-- watched `errors` would have looked at an empty table and reported everything
-- healthy for three days straight.
--
-- So SILENCE is the first thing this checks, and the error column is the
-- second. The failure that actually happened is the one most alerts miss:
-- absence looks identical to "nothing has gone wrong yet".
--
-- ── ⚠️ WHY NOT A NEW NOTIFICATION KIND ─────────────────────────────────────
-- `notification_kind` is an enum and adding a value is permanent. This is an
-- operational fault rather than a lead event, and `security_alert` already
-- exists for "something about the system needs an Admin" — it is what the
-- session and account warnings use. One less permanent value for one more
-- message.
-- ============================================================================

/* How long the importer may be silent before it counts as broken.
   ⚠️ A PARAMETER, NOT A CONSTANT. The job runs every fifteen minutes, so three
   hours is twelve consecutive missed runs — long enough that a deploy, a Meta
   blip or a Vercel cold start never cries wolf, short enough that a broken
   token is caught the same working day. It is a judgement, and judgements in
   this system live where they can be changed without a migration. */
create or replace function app.crm_notify_import_health(p_silent_hours int default 3)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_ok   timestamptz;
  v_last_run  timestamptz;
  v_errors    jsonb;
  v_failed    int;
  v_today     date := (now() at time zone 'Asia/Karachi')::date;
  v_title     text;
  v_body      text;
  v_admin     record;
  n_sent      int := 0;
begin
  select max(started_at) into v_last_ok
    from public.crm_lead_sync_runs
   where failed = 0 and jsonb_array_length(coalesce(errors, '[]'::jsonb)) = 0;

  select started_at, errors, failed
    into v_last_run, v_errors, v_failed
    from public.crm_lead_sync_runs
   order by started_at desc limit 1;

  /* ── 1 · SILENCE. The failure we actually had. ────────────────────────────
     ⚠️ `v_last_ok IS NULL` is deliberately included: a table with no successful
     run has never worked, which is exactly the three-day state of September and
     must not read as healthy. */
  if v_last_ok is null or v_last_ok < now() - make_interval(hours => p_silent_hours) then
    v_title := 'The lead importer has gone quiet';
    v_body := case
      when v_last_ok is null then
        'No lead import has ever completed successfully. Check that the CRM is deployed and that /api/crm/lead-sync answers.'
      else
        'The last successful import was '
        || to_char(v_last_ok at time zone 'Asia/Karachi', 'DD Mon HH24:MI')
        || '. Leads are still arriving at Meta and are not being collected.'
    end;

  /* ── 2 · Or it ran and complained. ────────────────────────────────────────── */
  elsif v_failed > 0 or jsonb_array_length(coalesce(v_errors, '[]'::jsonb)) > 0 then
    v_title := 'The lead importer reported an error';
    v_body := 'The run at '
      || to_char(v_last_run at time zone 'Asia/Karachi', 'DD Mon HH24:MI')
      || ' failed on '
      || coalesce(v_failed, 0)
      || ' source(s). The Meta token is the usual cause.';

  else
    /* Healthy. ⚠️ Returns 0 rather than raising — a health check that throws
       when everything is fine is a health check somebody switches off. */
    return 0;
  end if;

  /* ── Tell the Admins, once a day ──────────────────────────────────────────
     ⚠️ ADMINS, NOT THE SALES TEAM. A salesperson can do nothing about a Meta
     token, and a daily alarm nobody can act on is how a notification feed
     becomes wallpaper — `feed.ts`: *"a feed that is mostly noise gets ignored,
     which then costs you the one notification that mattered."* */
  for v_admin in
    select id from public.users
     where role in ('admin', 'super_admin') and is_active
  loop
    /* Once a day, read from the notifications table itself rather than from a
       new "last warned" column — a second record of what was sent is a second
       thing to get wrong. Same rule as 123. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = v_admin.id
         and n.kind = 'security_alert'
         and n.title = v_title
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to)
    values (v_admin.id, 'security_alert', v_title, v_body, '/leads');

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $$;

comment on function app.crm_notify_import_health(int) is
  'Warns Admins when the lead importer is silent or erroring. ⚠️ Checks SILENCE '
  'first: the three-day outage of September 2026 wrote no error rows at all, so '
  'an alert watching only `errors` would have reported healthy throughout. '
  'Migration 134.';

revoke all on function app.crm_notify_import_health(int) from public;

/* ── The schedule ────────────────────────────────────────────────────────────
   ⚠️ NO HTTP ROUTE, the same as 123 and for the same reason: this calls nothing
   outside the database, so pg_cron invokes it directly. That removes the
   CRON_SECRET, the bearer token, the unread pg_net response — and the
   404-until-deployed problem, which is precisely the fault being watched for.
   An alert that could be taken out by the outage it monitors is not an alert.

   Hourly, 08:00–19:00 Karachi (03:00–14:00 UTC), matching the follow-ups job:
   a fault found at 3am is read at 9am either way, and the once-a-day guard
   means twelve firings are still one message. */
select cron.unschedule('crm-import-health')
 where exists (select 1 from cron.job where jobname = 'crm-import-health');

select cron.schedule(
  'crm-import-health',
  '10 3-14 * * *',
  $$ select app.crm_notify_import_health() $$
);

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  n        int;
  v_admins int;
  v_last   timestamptz;
begin
  select count(*) into v_admins from public.users
   where role in ('admin','super_admin') and is_active;

  select max(started_at) into v_last from public.crm_lead_sync_runs
   where failed = 0 and jsonb_array_length(coalesce(errors,'[]'::jsonb)) = 0;

  -- 1 · It runs and returns a number rather than throwing.
  select app.crm_notify_import_health() into n;

  -- 2 · ⚠️ THE STATE RIGHT NOW IS HEALTHY, so it must say nothing. The importer
  --     has been running clean every fifteen minutes since 2026-09-12.
  if v_last is not null and v_last > now() - interval '3 hours' then
    if n <> 0 then
      raise exception '134 · the importer is healthy and % admins were warned anyway', n;
    end if;
  end if;

  -- 3 · ⚠️ AND IT FIRES ON SILENCE. Asked with a zero-hour window, every healthy
  --     history looks stale — which proves the silence branch works without
  --     having to break the importer to find out.
  select app.crm_notify_import_health(0) into n;
  if v_admins > 0 and n <> v_admins then
    raise exception '134 · silence went unreported: % admins, % warned', v_admins, n;
  end if;

  -- 4 · Asked twice on the same day, it stays quiet the second time.
  select app.crm_notify_import_health(0) into n;
  if n <> 0 then
    raise exception '134 · the same warning was sent twice in one day (% more)', n;
  end if;

  -- 5 · Clean up the check's own noise. ⚠️ Deleted by TITLE and DATE, never by
  --     kind: `security_alert` carries real session and account warnings that
  --     must survive a migration's self-check.
  delete from public.notifications
   where kind = 'security_alert'
     and title in ('The lead importer has gone quiet', 'The lead importer reported an error')
     and (created_at at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date;

  -- 6 · The job is scheduled and active.
  if not exists (select 1 from cron.job where jobname = 'crm-import-health' and active) then
    raise exception '134 · the health job is not scheduled';
  end if;

  raise notice '134 · a silent importer now warns % admins, once a day', v_admins;
end $$;
