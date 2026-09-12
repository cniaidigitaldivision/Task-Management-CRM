-- ============================================================================
-- 123 · NOTHING SITS UNTOUCHED WITHOUT SOMEBODY BEING TOLD — Step 8
-- ----------------------------------------------------------------------------
-- 08-TWELVE-STEPS: *"Due next actions surface on the dashboard and in the bell.
-- Overdue and neglect alerts: '14 leads assigned to Ali, no activity in 6
-- days.' ⚠️ Rules, not AI. Instant, free, and it cannot hallucinate."*
--
-- ── ⚠️ NO HTTP ROUTE, AND THAT IS THE DESIGN ───────────────────────────────
-- The lead sync needs a route because it has to call Meta. This calls nothing —
-- it reads two tables and writes notifications — so pg_cron invokes the function
-- directly. Which removes, for free, every one of the sync's operational
-- problems: no `CRON_SECRET` to keep in three places, no bearer token, no
-- `pg_net` request whose response nobody sees, and **no 404 until the branch is
-- deployed**. It works the moment this migration lands.
--
-- ⚠️ `app/api/digest/route.ts` says in its header *"There is no cron in this
-- application and adding one would mean a long-running process to own it."*
-- That stopped being true at migration 102. It is left alone here because the
-- digest sends EMAIL and its schedule is somebody else's decision, but the
-- sentence is stale and this note is where a reader will find that out.
--
-- ── ⚠️ ONE NOTIFICATION PER PERSON, NOT ONE PER LEAD ───────────────────────
-- A salesperson with twenty leads due today does not want twenty notifications;
-- they want to be told once that today has twenty. The codebase already knows
-- what happens otherwise — `feed.ts`: *"a notification feed that is mostly noise
-- gets ignored — which then costs you the one notification that mattered."*
--
-- ── ⚠️ AND ONCE A DAY, PROVED FROM THE NOTIFICATIONS TABLE ─────────────────
-- The job is scheduled hourly so it does not depend on a single firing landing;
-- what stops it repeating is a check against what was already sent TODAY. No
-- `last_reminded_at` column, because the notifications table already IS the
-- record of what was sent, and a second copy is a second thing to get wrong.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · WOULD THIS PERSON WANT IT?
-- ----------------------------------------------------------------------------
-- ⚠️ DEFAULTS TO TRUE WHEN THE KEY IS ABSENT, and that is load-bearing rather
-- than lazy. Every existing account stored its preferences BEFORE `lead_due`
-- existed, so none of them has a key for it. Defaulting to false would silently
-- deliver nothing to the entire company, and the only symptom would be a bell
-- that never rang. `defaultPrefs()` in TypeScript agrees: everything in-app on.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.wants_in_app(p_user uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (app.notification_prefs_for(p_user) -> p_kind ->> 'inApp')::boolean,
    true
  )
$$;

grant execute on function app.wants_in_app(uuid, text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · WHAT IS OWED TODAY
-- ----------------------------------------------------------------------------
-- ⚠️ "TODAY" IS KARACHI. `next_action_at` is a timestamptz and the desk sets it
-- to the END of the chosen day in Karachi (23:59:59). Comparing against a UTC
-- day would call a Friday task overdue from 5am Friday, and 109 of the 615 leads
-- already sit on that fault line.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_notify_due_leads()
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r        record;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
  n_sent   integer := 0;
  v_title  text;
begin
  for r in
    select l.owner_id,
           count(*) filter (
             where (l.next_action_at at time zone 'Asia/Karachi')::date < v_today
           ) as overdue,
           count(*) filter (
             where (l.next_action_at at time zone 'Asia/Karachi')::date = v_today
           ) as due_today
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
     where l.owner_id is not null
       and l.next_action_at is not null
       and l.stage not in ('won', 'lost')
       and u.is_active
       and (l.next_action_at at time zone 'Asia/Karachi')::date <= v_today
     group by l.owner_id
  loop
    /* ⚠️ ALREADY TOLD THEM TODAY? The job runs hourly so that one missed firing
       does not cost a day; this is what stops it becoming an hourly nag. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.owner_id
         and n.kind = 'lead_due'
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    if not app.wants_in_app(r.owner_id, 'lead_due') then
      continue;
    end if;

    /* ⚠️ THE OVERDUE ONES ARE NAMED FIRST, because they are the ones that have
       already gone wrong. A single count of "23 leads" hides whether that is a
       normal Tuesday or three weeks of neglect. */
    v_title := case
      when r.overdue > 0 and r.due_today > 0 then
        r.overdue || ' overdue and ' || r.due_today || ' due today'
      when r.overdue > 0 then
        r.overdue || case when r.overdue = 1 then ' lead is overdue' else ' leads are overdue' end
      else
        r.due_today || case when r.due_today = 1 then ' lead needs you today' else ' leads need you today' end
    end;

    insert into public.notifications (user_id, kind, title, body, link_to)
    values (
      r.owner_id, 'lead_due', v_title,
      'Open the desk to see which, sorted by what is owed first.',
      /* ⚠️ No lead id — this is about several. The desk already sorts by next
         action, so it opens on exactly the right rows. */
      '/leads'
    );

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $$;

comment on function app.crm_notify_due_leads() is
  'Tells each salesperson once a day what is owed (123). Karachi dates; one '
  'notification per person, not per lead; never twice in a day.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · WHAT HAS GONE QUIET
-- ----------------------------------------------------------------------------
-- The owner's example: *"14 leads assigned to Ali, no activity in 6 days."* That
-- is phrased as something the MANAGER reads about Ali, so that is who gets it.
--
-- ⚠️ THE THRESHOLD IS A JUDGEMENT AND IS A PARAMETER FOR THAT REASON. Nothing
-- in this division's data says five days is the line — there is not yet a single
-- closed lead to learn it from. It is a default a person can change in the cron
-- schedule without a migration, and Step 12 should replace it with the interval
-- that actually predicts a lost deal.
--
-- ⚠️ AND "ACTIVITY" MEANS THE LEAD WAS TOUCHED, NOT IMPORTED. Every one of the
-- 615 leads has an `imported` row; counting that as activity would make a lead
-- nobody has ever rung look freshly worked on the day it arrived.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_notify_neglect(p_days integer default 5)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r        record;
  v_mgr    uuid;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
  n_sent   integer := 0;
begin
  select u.id into v_mgr
    from public.users u
    join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.department_role = 'manager' and u.is_active
   limit 1;

  /* ⚠️ NO MANAGER, NO ALERT — and no error either. A department between managers
     is an ordinary state, not a fault, and raising here would make the whole
     hourly job fail on something nobody needs to fix urgently. */
  if v_mgr is null then
    return 0;
  end if;

  if not app.wants_in_app(v_mgr, 'lead_neglected') then
    return 0;
  end if;

  for r in
    select l.owner_id, u.full_name, count(*) as stale
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
     where l.owner_id is not null
       and l.owner_id <> v_mgr          -- the manager's own leads are their business
       and l.stage not in ('won', 'lost')
       and u.is_active
       and not exists (
         select 1 from public.crm_lead_activity a
          where a.lead_id = l.id
            and a.kind <> 'imported'     -- see the header
            and a.occurred_at > now() - make_interval(days => p_days)
       )
     group by l.owner_id, u.full_name
     having count(*) > 0
  loop
    /* ⚠️ ONCE A DAY PER PERSON REPORTED ON, not once per run. `entity_id` is the
       salesperson, so two colleagues going quiet produce two notifications and
       the same colleague produces one. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = v_mgr
         and n.kind = 'lead_neglected'
         and n.entity_id = r.owner_id
         and (n.created_at at time zone 'Asia/Karachi')::date = v_today
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (
      v_mgr, 'lead_neglected',
      r.stale || case when r.stale = 1 then ' lead of ' else ' leads of ' end
        || r.full_name || ' have gone quiet',
      'No call, message or note on them for ' || p_days || ' days.',
      '/leads',
      r.owner_id
    );

    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $$;

comment on function app.crm_notify_neglect(integer) is
  'Tells the sales manager whose leads have gone untouched (123). The interval '
  'is a parameter because it is a judgement, not a measurement.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · THE SCHEDULE
-- ----------------------------------------------------------------------------
-- ⚠️ HOURLY, NOT DAILY, AND THE FUNCTIONS ARE WHAT MAKE THAT SAFE. A single
-- daily firing that is missed — a restart, a slow database, a job that overran —
-- costs a whole day of reminders and nobody finds out. Running hourly means any
-- one firing is enough, and the once-a-day check inside each function is what
-- stops twenty-four of them becoming twenty-four notifications.
--
-- ⚠️ FROM 08:00 KARACHI, WHICH IS 03:00 UTC. Nothing useful is served by a
-- reminder that arrives at 2am and sits on somebody's lock screen until morning;
-- the first firing of the working day is the one that should carry it.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  perform cron.unschedule('crm-follow-ups');
exception when others then
  null;   -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'crm-follow-ups',
  /* 03:00–14:00 UTC = 08:00–19:00 Karachi, on the hour. */
  '0 3-14 * * *',
  $job$ select app.crm_notify_due_leads(), app.crm_notify_neglect(); $job$
);


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ REMOVES ITS OWN ROWS BY ID, NEVER BY PREDICATE. Migration 082 ate a live
-- attendance row with a tidy-up delete keyed on a date — and this file writes to
-- `notifications`, where a predicate delete could take somebody's real bell.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_mgr    uuid;
  v_a      uuid;
  v_project uuid;
  v_due    uuid;
  v_stale  uuid;
  v_notes  uuid[] := '{}';
  n        integer;
  m        integer;
  v_title  text;
begin
  select id into v_mgr from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_a   from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_mgr is null or v_a is null or v_project is null then
    raise notice '123 · the sales team is missing; follow-ups created untested';
    return;
  end if;

  /* One lead due YESTERDAY in Karachi, owned by the salesperson. */
  insert into public.crm_leads
    (project_id, owner_id, source, external_id, full_name, submitted_at,
     next_action, next_action_at)
  values
    (v_project, v_a, 'manual', '123-due', '123 due', now() - interval '10 days',
     'ring them', ((now() at time zone 'Asia/Karachi')::date - 1
                   + interval '23 hours 59 minutes') at time zone 'Asia/Karachi')
  returning id into v_due;

  /* One lead nobody has touched since it was imported a fortnight ago. */
  insert into public.crm_leads
    (project_id, owner_id, source, external_id, full_name, submitted_at)
  values
    (v_project, v_a, 'manual', '123-stale', '123 stale', now() - interval '14 days')
  returning id into v_stale;

  -- ⚠️ Both leads got an `assigned` row from 116's trigger just now, which would
  --    make them look freshly worked. Backdate it: the point of the check is a
  --    lead nobody has touched.
  update public.crm_lead_activity
     set occurred_at = now() - interval '14 days'
   where lead_id in (v_due, v_stale);

  -- 1 · The salesperson is told once, and the overdue one is named.
  n := app.crm_notify_due_leads();
  if n < 1 then
    raise exception '123 · nobody was told about an overdue lead';
  end if;

  select title into v_title from public.notifications
   where user_id = v_a and kind = 'lead_due'
   order by created_at desc limit 1;
  if v_title not like '%overdue%' then
    raise exception '123 · the reminder did not say the lead was overdue (got %)', v_title;
  end if;

  -- 2 · ⚠️ AND NOT AGAIN. The job runs hourly; this is what stops it nagging.
  m := app.crm_notify_due_leads();
  if m <> 0 then
    raise exception '123 · a second run sent % more reminders in the same day', m;
  end if;

  -- 3 · The manager hears that the leads have gone quiet.
  n := app.crm_notify_neglect(5);
  if n < 1 then
    raise exception '123 · the manager was not told about untouched leads';
  end if;

  select title into v_title from public.notifications
   where user_id = v_mgr and kind = 'lead_neglected' and entity_id = v_a
   order by created_at desc limit 1;
  if v_title not like '%gone quiet%' then
    raise exception '123 · the neglect alert did not name what happened (got %)', v_title;
  end if;

  -- 4 · And not again today either.
  m := app.crm_notify_neglect(5);
  if m <> 0 then
    raise exception '123 · a second neglect run sent % more', m;
  end if;

  -- 5 · ⚠️ TOUCHING A LEAD CLEARS IT. Without this the alert would keep firing
  --     at somebody who had just done the work.
  insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at)
  values (v_due, v_a, 'call_connected', now()),
         (v_stale, v_a, 'call_connected', now());

  delete from public.notifications
   where user_id = v_mgr and kind = 'lead_neglected' and entity_id = v_a;

  n := app.crm_notify_neglect(5);
  if n <> 0 then
    raise exception '123 · a lead rung an hour ago is still counted as neglected';
  end if;

  -- 6 · ⚠️ AND AN IMPORT IS NOT ACTIVITY. Every one of the 615 leads has an
  --     `imported` row; counting it would make an untouched lead look worked.
  delete from public.crm_lead_activity
   where lead_id in (v_due, v_stale) and kind = 'call_connected';
  insert into public.crm_lead_activity (lead_id, kind, occurred_at)
  values (v_due, 'imported', now()), (v_stale, 'imported', now());

  n := app.crm_notify_neglect(5);
  if n <> 1 then
    raise exception '123 · an import today was counted as somebody working the lead';
  end if;

  -- 7 · A won lead is nobody's problem any more.
  update public.crm_leads set stage = 'won' where id in (v_due, v_stale);
  delete from public.notifications
   where user_id = v_mgr and kind = 'lead_neglected' and entity_id = v_a;

  n := app.crm_notify_neglect(5);
  if n <> 0 then
    raise exception '123 · a closed lead is still being chased';
  end if;

  -- 8 · The job is scheduled and active.
  select count(*) into n from cron.job where jobname = 'crm-follow-ups' and active;
  if n <> 1 then
    raise exception '123 · the crm-follow-ups job is not scheduled';
  end if;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.notifications
   where (user_id = v_a and kind = 'lead_due')
      or (user_id = v_mgr and kind = 'lead_neglected' and entity_id = v_a);
  delete from public.crm_lead_activity where lead_id in (v_due, v_stale);
  delete from public.crm_leads where id in (v_due, v_stale);

  raise notice '123 · a salesperson is told once a day what is owed, the manager hears what has gone quiet, and neither repeats';
end $$;
