-- ============================================================================
-- 169 · THE FIRST-RESPONSE CLOCK — the owner's own step two, finally built
-- ----------------------------------------------------------------------------
-- Owner's description of the flow, 2026-09-16: *"After the lead is assigned…
-- here a task is created for Sarah: you have to respond to this new lead."*
--
-- It was the second thing they described and the only step with nothing behind
-- it. Measured the day this was written: **641 real leads, 0 ever contacted,
-- average age 58 days.** Meta deletes lead data at 90.
--
-- ⚠️ THIS IS THE HIGHEST-RETURN THING IN THE SYSTEM AND IT IS ALSO THE
-- CHEAPEST. The widely-cited lead-response research finds the odds of reaching
-- somebody collapse after the first hour, and a Meta lead ad is a person who
-- tapped a form while scrolling — their intent decays in minutes. Nothing else
-- in this CRM moves the number as much as somebody ringing back the same hour.
--
-- ── ⚠️ THE CLOCK STARTS AT ASSIGNMENT, NOT AT SUBMISSION ───────────────────
-- A lead imported from Meta three days after it was submitted cannot have been
-- answered on day one, and starting the clock at `submitted_at` would breach it
-- before any human could see it — an alert that is always red is an alert
-- nobody reads. The clock starts when it becomes somebody's.
--
-- ── ⚠️ AND IT RUNS ON THE WALL CLOCK, NOT ON WORKING HOURS ─────────────────
-- Owner: *"the sales team should reply. That's their duty… definitely they must
-- be logged in from mobile and can reply to anyone from their mobile."* So a
-- lead arriving at 9pm is still owed a reply. The NIGHT WINDOW below is the one
-- concession — see `crm_project_settings.sla_night_*`.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · WHERE CRM POLICY LIVES
-- ----------------------------------------------------------------------------
-- ⚠️ ITS OWN `crm_*` TABLE, NOT COLUMNS ON `projects`. `16-EXTRACTING-THE-CRM.md`
-- says the CRM must stay liftable, and the contract it names is that a new host
-- provides `projects` with an `id` and `lead_department_id`. Every CRM policy
-- column bolted onto that table widens what the next home has to supply. A
-- `crm_*` table with a foreign key TO `projects` is the direction the contract
-- already allows, and it travels with the module.
-- ════════════════════════════════════════════════════════════════════════════

create table public.crm_project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,

  -- The target, in minutes from assignment. 60 is a deliberate starting point,
  -- not a measurement: there is no response-time history to derive one from yet.
  first_response_minutes integer not null default 60
    check (first_response_minutes between 5 and 2880),

  /* ⚠️ THE NIGHT WINDOW PAUSES THE CLOCK, IT DOES NOT PAUSE ASSIGNMENT.
     Two different things the owner rightly separates: a lead may be handed to
     somebody at 2am — they pick it up on mobile and that is the job — but
     holding them to a 3am deadline would breach every overnight lead by
     morning. Stored as local hours in `Asia/Karachi`. */
  sla_night_from smallint not null default 22 check (sla_night_from between 0 and 23),
  sla_night_to   smallint not null default 8  check (sla_night_to   between 0 and 23),

  /* ── Decided by the owner 2026-09-16, READ BY NOTHING YET ────────────────
     ⚠️ RECORDED HERE RATHER THAN IN A LATER MIGRATION, because both are
     decisions already taken and the stage list has already been churned once.
     They are inert columns until the code that reads them exists — the same
     honest state as `crm_quotations.pdf_path` and `crm_appointments.replaces_id`,
     and the tracker lists all of them as unbuilt. */

  /* Which comes first for this project. ⚠️ FALSE FOR CHITRAL, and the owner was
     right about it: measured over 641 real leads, only ~18% live near enough to
     visit easily — 30% are in the Peshawar corridor, 24% in Islamabad, 7% in the
     Gulf and will never come. You cannot ask that market to travel before it
     knows the price. A scheme beside a city would set this true. */
  visit_before_quotation boolean not null default false,

  /* How long before an appointment its reminder goes out. ⚠️ 120 is the owner's
     own choice — *"send a reminder 1 or 2 hours before"*. Flagged once and
     recorded: two hours is too late to refill a slot somebody cancels, so a
     T-24h confirmation belongs beside it later. */
  visit_reminder_minutes integer not null default 120
    check (visit_reminder_minutes between 15 and 10080),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_project_settings is
  'Per-project CRM policy. Its own table rather than columns on `projects`, so the CRM stays liftable — see docs/crm/16-EXTRACTING-THE-CRM.md.';

alter table public.crm_project_settings enable row level security;

/* ⚠️ READ BY ANYONE WHO MAY USE THE CRM, WRITTEN BY NOBODY THROUGH THE APP.
   A salesperson must be able to read their own SLA — a deadline you cannot see
   is not a target, it is a trap. Changing it is an admin act with no screen yet,
   so there is deliberately no INSERT or UPDATE policy: a grant that exists
   before the screen that uses it is a grant nobody is checking. */
create policy crm_project_settings_select on public.crm_project_settings
  for select using (app.crm_is_open_to_caller());

grant select on public.crm_project_settings to cni_app;

/* Every lead-routed project gets the defaults, so nothing reads NULL. */
insert into public.crm_project_settings (project_id)
select p.id from public.projects p
 where p.lead_department_id is not null
on conflict (project_id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE DEADLINE ON THE LEAD
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_leads
  add column first_response_due_at timestamptz;

comment on column public.crm_leads.first_response_due_at is
  'When the first reply is owed by. Stamped on assignment; compared against first_contacted_at. NULL means unassigned or already answered before it was set.';

/* ⚠️ PARTIAL, AND ON THE BREACH CONDITION ITSELF. The hourly job asks one
   question — who is past their deadline and still unanswered — and this index is
   that question. Indexing `first_response_due_at` alone would still scan every
   lead ever answered, and by law 5 that gets worse every month. */
create index crm_leads_sla_open_idx
  on public.crm_leads (first_response_due_at)
  where first_contacted_at is null and first_response_due_at is not null;

create or replace function app.crm_stamp_first_response_due()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_minutes integer;
  v_from    smallint;
  v_to      smallint;
  v_due     timestamptz;
  v_hour    integer;
begin
  /* Only when it BECOMES somebody's, and only once. Re-assigning a lead to a
     colleague does not restart the clock — the client has been waiting since the
     first assignment and a handover is our problem, not theirs. */
  if new.owner_id is null
     or new.first_response_due_at is not null
     or new.first_contacted_at is not null
     or (tg_op = 'UPDATE' and old.owner_id is not null)
  then
    return new;
  end if;

  select s.first_response_minutes, s.sla_night_from, s.sla_night_to
    into v_minutes, v_from, v_to
    from public.crm_project_settings s
   where s.project_id = new.project_id;

  /* ⚠️ NO SETTINGS ROW MEANS NO CLOCK, not a guessed one. A project nobody has
     configured should not start breaching alerts at a default somebody never
     chose — the same reason `users.crm_max_open_leads` is NULL for everybody. */
  if v_minutes is null then
    return new;
  end if;

  v_due := now() + make_interval(mins => v_minutes);

  /* ⚠️ THE NIGHT WINDOW PUSHES THE DEADLINE TO THE MORNING. A lead arriving at
     11pm with a 60-minute target would be breached at midnight and sit red until
     somebody opened the desk — so the alert would be describing the night, not a
     salesperson. Assignment itself is untouched: they still get it at 11pm and
     may well answer it. */
  v_hour := extract(hour from (v_due at time zone 'Asia/Karachi'))::integer;
  if (v_from < v_to and v_hour >= v_from and v_hour < v_to)
     or (v_from > v_to and (v_hour >= v_from or v_hour < v_to))
  then
    v_due := date_trunc('day', (v_due at time zone 'Asia/Karachi'))
             + make_interval(hours => v_to);
    /* Past midnight means the morning of the NEXT day. */
    if v_hour >= v_from and v_from > v_to then
      v_due := v_due + interval '1 day';
    end if;
    v_due := v_due at time zone 'Asia/Karachi';
  end if;

  new.first_response_due_at := v_due;
  return new;
end;
$fn$;

create trigger crm_leads_stamp_sla
  before insert or update of owner_id on public.crm_leads
  for each row execute function app.crm_stamp_first_response_due();


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · TELLING SOMEBODY
-- ----------------------------------------------------------------------------
-- ⚠️ THE SALESPERSON FIRST, THE MANAGER ONLY WHEN IT IS BADLY LATE. An alert
-- that copies in a manager on every breach turns a five-minute slip into a
-- performance conversation, and the predictable response is that people stop
-- trusting the tool that reports them. Double the target is the escalation.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_notify_sla_breaches()
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r      record;
  n_sent integer := 0;
begin
  for r in
    select l.id, l.owner_id, l.full_name, l.first_response_due_at,
           extract(epoch from (now() - l.first_response_due_at)) / 60 as late_minutes
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
     where l.first_contacted_at is null
       and l.first_response_due_at is not null
       and l.first_response_due_at < now()
       and l.stage not in ('won', 'lost')
       and u.is_active
     order by l.first_response_due_at
  loop
    /* ⚠️ ONCE PER LEAD, EVER — keyed on the lead, not on the day. The job runs
       hourly so a missed firing does not cost the lead; without this it would
       tell somebody about the same unanswered enquiry every hour for a week,
       which is how a bell gets switched off. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.owner_id
         and n.kind = 'lead_sla_breach'
         and n.link_to = '/leads/' || r.id::text
    ) then
      continue;
    end if;

    if not app.wants_in_app(r.owner_id, 'lead_sla_breach') then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to)
    values (
      r.owner_id,
      'lead_sla_breach',
      coalesce(nullif(trim(r.full_name), ''), 'A new lead') || ' is still waiting',
      /* ⚠️ NAMES THE PERSON AND THE DELAY, not a count. "3 leads breached" is a
         statistic; "Faisal Rehman has been waiting 2 hours" is somebody to ring. */
      'Nobody has contacted them yet — '
        || case
             when r.late_minutes < 60 then round(r.late_minutes)::text || ' minutes'
             else round(r.late_minutes / 60)::text || ' hours'
           end
        || ' past the target.',
      '/leads/' || r.id::text
    );
    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end;
$$;

revoke all on function app.crm_notify_sla_breaches() from public;

do $$
begin
  perform cron.unschedule('crm-sla-breaches');
exception when others then
  null;   -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'crm-sla-breaches',
  /* ⚠️ EVERY 15 MINUTES, not hourly like the digest. A 60-minute target checked
     once an hour means the alert can arrive 59 minutes after the miss, by which
     point the research this whole migration rests on says the lead is gone. */
  '*/15 * * * *',
  $job$ select app.crm_notify_sla_breaches(); $job$
);


-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ REMOVES ITS OWN ROWS BY ID, NEVER BY PREDICATE. Migration 082 ate a live
-- attendance row with a tidy-up keyed on a date, and this file writes to
-- `notifications`, where a predicate delete could take somebody's real bell.
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_note uuid;
  v_due timestamptz; v_sent integer; v_again integer;
  v_seen boolean;
begin
  select p.id into v_project
    from public.projects p
    join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]'
   limit 1;
  if v_project is null then
    raise exception '169 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then
    raise exception '169 · nobody eligible, so the clock cannot be proved against a real person';
  end if;

  -- 1 · Every lead-routed project got its defaults.
  if not exists (select 1 from public.crm_project_settings where project_id = v_project) then
    raise exception '169 · the demo project has no settings row';
  end if;

  -- 2 · ⚠️ A SALESPERSON CAN READ THEIR OWN TARGET. A deadline you cannot see is
  --     a trap rather than a target, and RLS is what decides that.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  select exists (
    select 1 from public.crm_project_settings where project_id = v_project
  ) into v_seen;
  reset role;
  if not v_seen then
    raise exception '169 · a salesperson cannot read the SLA that is being applied to them';
  end if;

  -- 3 · Assigning a lead starts the clock.
  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, stage, is_test_data, submitted_at)
  values
    (v_project, v_sales, 'manual', 'SELFCHECK-169', '+920000000169', 'new', true, now())
  returning id, first_response_due_at into v_lead, v_due;

  if v_due is null then
    delete from public.crm_leads where id = v_lead;
    raise exception '169 · assigning a lead did not start the clock';
  end if;

  -- 4 · ⚠️ RE-ASSIGNMENT DOES NOT RESTART IT. The client has been waiting since
  --     the first assignment; a handover is our problem, not theirs.
  update public.crm_leads set owner_id = v_sales where id = v_lead;
  if (select first_response_due_at from public.crm_leads where id = v_lead) <> v_due then
    delete from public.crm_leads where id = v_lead;
    raise exception '169 · re-assigning restarted the clock and reset the client''s wait';
  end if;

  -- 5 · A breach notifies, once, and names the lead.
  update public.crm_leads
     set first_response_due_at = now() - interval '90 minutes'
   where id = v_lead;

  v_sent := app.crm_notify_sla_breaches();
  select id into v_note from public.notifications
   where kind = 'lead_sla_breach' and link_to = '/leads/' || v_lead::text
   limit 1;

  if v_note is null then
    delete from public.crm_leads where id = v_lead;
    raise exception '169 · a breached lead produced no notification (% sent)', v_sent;
  end if;

  -- 6 · ⚠️ AND IT DOES NOT SAY IT AGAIN. The job runs four times an hour; without
  --     the guard this becomes ninety-six notifications a day about one lead.
  v_again := app.crm_notify_sla_breaches();
  if (select count(*) from public.notifications
       where kind = 'lead_sla_breach' and link_to = '/leads/' || v_lead::text) > 1 then
    delete from public.notifications where id = v_note;
    delete from public.crm_leads where id = v_lead;
    raise exception '169 · the same breach notified twice — the bell would be unusable';
  end if;

  -- 7 · ⚠️ AND A LEAD THAT HAS BEEN ANSWERED IS NOT BREACHED, however late the
  --     deadline says it is. `first_contacted_at` is the stop condition.
  delete from public.notifications where id = v_note;
  update public.crm_leads set first_contacted_at = now() where id = v_lead;
  if app.crm_notify_sla_breaches() > 0
     and exists (select 1 from public.notifications
                  where kind = 'lead_sla_breach' and link_to = '/leads/' || v_lead::text) then
    delete from public.notifications where kind = 'lead_sla_breach' and link_to = '/leads/' || v_lead::text;
    delete from public.crm_leads where id = v_lead;
    raise exception '169 · an answered lead still counted as a breach';
  end if;

  delete from public.notifications where kind = 'lead_sla_breach' and link_to = '/leads/' || v_lead::text;
  delete from public.crm_leads where id = v_lead;

  raise notice '169 · the clock starts on assignment, survives a handover, breaches once, names the lead, and stops the moment somebody makes contact';
end $chk$;
