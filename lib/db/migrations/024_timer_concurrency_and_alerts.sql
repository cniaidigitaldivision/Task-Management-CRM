-- =============================================================================
-- 024 · THREE CONCURRENT TIMERS, AND ALERTS THAT FIRE ONCE
-- =============================================================================
-- Owner request 2026-08-13: *"a timer feature that can hold three concurrent
-- tasks at once… when someone tries to start another they should know the three
-- are still running."* Plus notifications at ten minutes left, five minutes left,
-- and time up.
--
-- ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ─────────────────────────────────
-- `tasks.timer_state` and `timer_started_at` have existed since migration 012,
-- and `app.tasks_pause_timer_on_status_change` already pauses a clock when a task
-- leaves In Progress. Two things were missing:
--
--   1. **No cap at all.** `startTimer` set `timer_state = 'running'` with no
--      count, so a person could have twenty running. "Three" was not a rule
--      anybody had written down; it is now.
--   2. **Nowhere to record that an alert had been delivered.** Without that, a
--      countdown re-fires "5 minutes left" on every page load, and a warning that
--      arrives six times is a warning nobody reads.
--
-- ── WHY THE ALERT MEMORY IS A COLUMN AND NOT A TABLE ─────────────────────────
-- A run has at most three alerts and they belong to exactly one run. A table
-- would need its own key on (task, run start), its own cleanup, and its own
-- policies — for three enum values that are meaningless the moment the timer
-- stops. The array is cleared when a run starts, so "which alerts has THIS run
-- sent" needs no join and cannot go stale.
-- =============================================================================

alter table public.tasks
  add column if not exists timer_alerts_sent text[] not null default '{}';

do $$
begin
  -- Only the three known alerts, so a typo cannot silently suppress a real one by
  -- occupying its place in the array.
  if not exists (select 1 from pg_constraint where conname = 'tasks_timer_alerts_known') then
    alter table public.tasks
      add constraint tasks_timer_alerts_known
      check (timer_alerts_sent <@ array['ten_minutes', 'five_minutes', 'time_up']::text[]);
  end if;
end
$$;

comment on column public.tasks.timer_alerts_sent is
  'Which countdown alerts have been delivered for the CURRENT timer run. Cleared by '
  'app.timer_start so a later run warns again. Migration 024.';


-- ----------------------------------------------------------------------------
-- STARTING A TIMER — the cap lives here, not only in the action
-- ----------------------------------------------------------------------------
-- The application checks first so the refusal can name the three tasks that are
-- running, which is the useful part. This function is the backstop: it is what
-- makes three a property of the system rather than of one code path, the same
-- reasoning as the three-times-checked provisioning chain (doc 16 §3).
--
-- ⚠️ It counts the timers on tasks ASSIGNED TO the person starting one, which is
-- who a concurrency limit is about — a person can only do one thing at a time,
-- and three is the owner's allowance for switching between them. An unassigned
-- task somebody starts a clock on counts too, via the actor.
-- ----------------------------------------------------------------------------

create or replace function app.timer_start(p_task_id uuid)
returns text
language plpgsql
security invoker           -- runs as the caller, so RLS still applies to the row
set search_path = public, pg_catalog
as $$
declare
  actor    uuid := app.current_user_id();
  running  integer;
begin
  if actor is null then
    return 'no_actor';
  end if;

  /* Already running is success, not an error: two clicks on a start button must
     not spend one of the three slots or report a failure. */
  if exists (
    select 1 from public.tasks
     where id = p_task_id and timer_state = 'running'::public.timer_state
  ) then
    return 'ok';
  end if;

  select count(*) into running
    from public.tasks t
   where t.timer_state = 'running'::public.timer_state
     and not t.is_deleted
     and t.assignee_id = actor;

  if running >= 3 then
    return 'at_limit';
  end if;

  update public.tasks
     set timer_state       = 'running'::public.timer_state,
         timer_started_at   = now(),
         timer_pause_reason = null,
         /* A new run warns again. Without this, a task that once hit its limit
            would never warn on any later run. */
         timer_alerts_sent  = '{}'
   where id = p_task_id
     and not is_deleted
     and timer_state <> 'running'::public.timer_state;

  if not found then
    /* Either invisible to this actor under RLS, deleted, or it became running
       between the check and the update. Indistinguishable on purpose. */
    return 'not_updated';
  end if;

  return 'ok';
end
$$;

comment on function app.timer_start(uuid) is
  'Starts a timer, refusing a fourth concurrent run for the same person (owner decision, '
  'migration 024). Returns ok | at_limit | not_updated | no_actor. SECURITY INVOKER, so a '
  'task the caller cannot see cannot be started.';

revoke all on function app.timer_start(uuid) from public;
grant execute on function app.timer_start(uuid) to cni_app;


-- ----------------------------------------------------------------------------
-- RECORDING THAT AN ALERT WAS DELIVERED
-- ----------------------------------------------------------------------------
-- Appends idempotently. The browser is what notices a threshold crossing, and a
-- browser can call twice — two tabs open, or a retry after a dropped response —
-- so "already sent" has to be decided here rather than trusted from the caller.
--
-- Returns whether THIS call was the one that recorded it, which is what tells the
-- caller whether to write the notification. Without that, two tabs produce two
-- copies of "5 minutes left".
-- ----------------------------------------------------------------------------

create or replace function app.timer_mark_alert(p_task_id uuid, p_alert text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  claimed boolean;
begin
  if p_alert not in ('ten_minutes', 'five_minutes', 'time_up') then
    return false;
  end if;

  update public.tasks
     set timer_alerts_sent = timer_alerts_sent || p_alert
   where id = p_task_id
     and not is_deleted
     /* Only while it is still running: a stopped timer has nothing to warn
        about, and a stale request must not resurrect an alert. */
     and timer_state = 'running'::public.timer_state
     and not (p_alert = any (timer_alerts_sent));

  claimed := found;
  return claimed;
end
$$;

comment on function app.timer_mark_alert(uuid, text) is
  'Claims one countdown alert for the current run. True only for the call that recorded it, so '
  'two open tabs cannot both notify. Migration 024.';

revoke all on function app.timer_mark_alert(uuid, text) from public;
grant execute on function app.timer_mark_alert(uuid, text) to cni_app;
