-- ============================================================================
-- 152 · APPOINTMENTS — calls, meetings and site visits
-- ----------------------------------------------------------------------------
-- Phase E. This is what the "Today's plan" rail on the sales desk reads, and
-- what `visit_scheduled` (148) means when a lead wears it.
--
-- ── ⚠️ AN APPOINTMENT IS NOT A FOLLOW-UP, AND THE DIFFERENCE MATTERS ───────
-- A follow-up is something WE will do — send a message, make a call, chase a
-- quotation. An appointment is a commitment BOTH sides made to be somewhere at a
-- time. One can be rescheduled silently; the other cannot, because the client
-- has put it in their diary too.
--
-- That is also why `scheduled` was retired as a lead stage in 149: it was trying
-- to be this table.
--
-- ── ⚠️ IT CARRIES ITS OWN OWNER ────────────────────────────────────────────
-- Usually the lead's owner, but not always — a site visit is often walked by
-- whoever is at the plot that day, and the manager sometimes takes a meeting
-- personally. Reading the owner off the lead would make the rail show a visit to
-- the wrong person's day.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_appointment_kind') then
    create type public.crm_appointment_kind as enum ('call', 'meeting', 'site_visit');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_appointment_status') then
    create type public.crm_appointment_status as enum (
      'scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled'
    );
  end if;
end $$;

create table if not exists public.crm_appointments (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  property_id uuid references public.crm_properties (id) on delete set null,

  kind        public.crm_appointment_kind not null default 'site_visit',
  status      public.crm_appointment_status not null default 'scheduled',

  /* ⚠️ `timestamptz`, and every screen renders it in Asia/Karachi. A visit at
     "3 PM" stored without a zone is a visit at 3 PM in whatever zone the server
     felt like — and for five hours each evening Karachi is a different DATE from
     UTC, so the rail would show tomorrow's visits today. */
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  location    text,

  /* ⚠️ WHOSE DAY IT SITS IN — see the header. Not derived from the lead. */
  owner_id    uuid references public.users (id) on delete set null,

  /* Filled in afterwards. Null while it is still ahead. */
  outcome     text,
  outcome_at  timestamptz,
  notes       text,

  /* When a rescheduled appointment becomes a new row, this points back. */
  replaces_id uuid references public.crm_appointments (id) on delete set null,

  is_test_data boolean not null default false,

  created_by_id uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_appointments_duration_sane check (duration_minutes between 5 and 600),
  /* ⚠️ A COMPLETED APPOINTMENT HAS AN OUTCOME. "It happened" with nothing
     recorded is the same as not recording it — and the site-visit outcome is
     what moves a lead to `visited` or to `negotiation`. */
  constraint crm_appointments_outcome_complete check (
    status not in ('completed', 'no_show') or outcome_at is not null
  )
);

create index if not exists crm_appointments_lead_idx
  on public.crm_appointments (lead_id, scheduled_at desc);
/* The rail's own query: whose day, which day. */
create index if not exists crm_appointments_day_idx
  on public.crm_appointments (owner_id, scheduled_at)
  where status in ('scheduled', 'confirmed');

comment on table public.crm_appointments is
  'A commitment both sides made — a call, a meeting, a site visit. NOT a '
  'follow-up: a follow-up is something we will do, this is somewhere two people '
  'agreed to be. Migration 152.';

alter table public.crm_appointments enable row level security;

do $$
begin
  /* Delegated to the lead, like every other child table here. */
  if not exists (select 1 from pg_policy where polname = 'crm_appointments_select') then
    create policy crm_appointments_select on public.crm_appointments
      for select to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;

  /* ⚠️ A SALESPERSON BOOKS AND COMPLETES THEIR OWN. The owner's Phase 1 rules
     put "create tasks, notes, reminders and follow-ups" squarely with them — an
     appointment is the same class of thing, and needing a manager to book a site
     visit would make the feature unusable. */
  if not exists (select 1 from pg_policy where polname = 'crm_appointments_write') then
    create policy crm_appointments_write on public.crm_appointments
      for all to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
end $$;

grant select, insert, update, delete on public.crm_appointments to cni_app;
revoke all on public.crm_appointments from anon, authenticated;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead uuid; v_proj uuid; v_owner uuid; v_appt uuid;
  n int; bad boolean;
begin
  select l.id, l.project_id, l.owner_id into v_lead, v_proj, v_owner
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null limit 1;

  if v_lead is null then
    raise notice '152 · no owned demo lead — table created, nothing to measure';
    return;
  end if;

  insert into public.crm_appointments
    (lead_id, project_id, kind, scheduled_at, owner_id, is_test_data)
  values (v_lead, v_proj, 'site_visit', now() + interval '1 day', v_owner, true)
  returning id into v_appt;

  -- 1 · ⚠️ "COMPLETED" WITH NOTHING RECORDED IS REFUSED.
  bad := false;
  begin
    update public.crm_appointments set status = 'completed' where id = v_appt;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '152 · an appointment was completed with no outcome recorded';
  end if;

  -- 2 · With an outcome it is accepted.
  update public.crm_appointments
     set status = 'completed', outcome = 'Attended, wants the corner plot',
         outcome_at = now()
   where id = v_appt;

  -- 3 · ⚠️ A NONSENSE DURATION IS REFUSED. A "0 minute" visit and a 3-day one
  --     are both data-entry slips, and both make a day rail unreadable.
  bad := false;
  begin
    update public.crm_appointments set duration_minutes = 0 where id = v_appt;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '152 · a zero-minute appointment was allowed';
  end if;

  -- 4 · ⚠️ AND THE LEAD'S OWNER CAN SEE IT. The rail is useless otherwise, and
  --     this is the check that six previous migrations were written to add.
  if v_owner is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    select count(*) into n from public.crm_appointments where id = v_appt;
    reset role;
    if n <> 1 then
      raise exception '152 · a salesperson cannot see their own appointment';
    end if;
  end if;

  delete from public.crm_appointments where id = v_appt;
  raise notice '152 · appointments in; empty completions and nonsense durations refused';
end $$;
