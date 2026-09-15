-- ============================================================================
-- 153 · FOLLOW-UPS AND SEQUENCES — one planned action, and many conditional ones
-- ----------------------------------------------------------------------------
-- Phase G's schema. ⚠️ THE SCHEDULER IS NOT BUILT AND NOTHING SENDS — this
-- migration gives the engine somewhere to live, and 147's `sequence_state` on
-- the lead becomes a cached summary of `crm_lead_sequences` rather than the only
-- record of it.
--
-- ── ⚠️ A FOLLOW-UP AND A SEQUENCE ARE DIFFERENT THINGS ─────────────────────
-- The owner's §8 separation, and it is right:
--
--     Follow-up   ONE planned next action. A date, a purpose, a channel.
--     Sequence    A TEMPLATE of conditional steps — "day 1, day 3, day 7".
--
-- `crm_leads.next_action` already carries the single next thing, and it stays
-- there: it is read on every row of every desk and a join per row would cost
-- more than the column. `crm_follow_ups` is the HISTORY — what was planned, what
-- happened, what is still open.
--
-- ── ⚠️ AND A SEQUENCE IS A TEMPLATE, ITS RUN IS A DIFFERENT ROW ────────────
-- Three tables rather than one, because "the quotation follow-up sequence" is a
-- thing the company owns, and "Faisal is on step 2 of it, paused since Tuesday"
-- is a thing one lead owns. Collapsing them means editing the template rewrites
-- what already happened to forty people.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_followup_purpose') then
    create type public.crm_followup_purpose as enum (
      'no_response', 'quotation', 'appointment_reminder', 'missing_information',
      'approved_offer', 'payment_reminder', 'site_visit_checkin', 're_engage',
      'custom'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_followup_channel') then
    create type public.crm_followup_channel as enum ('whatsapp', 'email', 'call', 'task');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_followup_status') then
    create type public.crm_followup_status as enum (
      'planned', 'due', 'done', 'skipped', 'cancelled', 'failed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_followup_mode') then
    /* The owner's three execution modes. ⚠️ `auto_send` is the only one that ever
       sends without a human, and every stop-condition exists to gate it. */
    create type public.crm_followup_mode as enum ('remind_me', 'review_first', 'auto_send');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · ONE PLANNED ACTION
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_follow_ups (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.crm_leads (id) on delete cascade,

  purpose    public.crm_followup_purpose not null default 'custom',
  channel    public.crm_followup_channel not null default 'whatsapp',
  mode       public.crm_followup_mode not null default 'remind_me',
  status     public.crm_followup_status not null default 'planned',

  title      text not null,
  body       text,
  due_at     timestamptz not null,

  /* Set when it actually happened, by whom. */
  done_at    timestamptz,
  done_by_id uuid references public.users (id) on delete set null,
  /* Why it was skipped or failed — Meta's own words for a refusal. */
  outcome_note text,

  /* When this follow-up came from a sequence step rather than a person. */
  lead_sequence_id uuid,
  sequence_step_no integer,

  assigned_to_id uuid references public.users (id) on delete set null,
  created_by_id  uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_follow_ups_title_present check (btrim(title) <> ''),
  /* ⚠️ A FINISHED FOLLOW-UP HAS A TIME. Otherwise "done" is a claim with no
     evidence, and the response-time figures the rota reads are computed from
     exactly these timestamps. */
  constraint crm_follow_ups_done_complete check (
    status <> 'done' or done_at is not null
  )
);

create index if not exists crm_follow_ups_lead_idx
  on public.crm_follow_ups (lead_id, due_at desc);
create index if not exists crm_follow_ups_due_idx
  on public.crm_follow_ups (assigned_to_id, due_at)
  where status in ('planned', 'due');

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE TEMPLATE
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_sequences (
  id         uuid primary key default gen_random_uuid(),
  /* Null means "available to every project". */
  project_id uuid references public.projects (id) on delete cascade,
  name       text not null,
  purpose    public.crm_followup_purpose not null default 'quotation',
  /* ⚠️ THE OWNER'S OWN RULE, AS A COLUMN: *"stop_on_reply: true"*. Off by
     default would be the dangerous default. */
  stop_on_reply boolean not null default true,
  is_active  boolean not null default true,
  is_test_data boolean not null default false,
  created_by_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint crm_sequences_name_present check (btrim(name) <> '')
);

create table if not exists public.crm_sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.crm_sequences (id) on delete cascade,
  step_no     integer not null,
  channel     public.crm_followup_channel not null default 'whatsapp',
  delay_days  integer not null,
  purpose     text not null,
  /* ⚠️ THE META TEMPLATE NAME, and it is the reason nothing can send yet. Past
     WhatsApp's 24-hour window only an APPROVED template may go out, and that
     approval is Meta's to give. A step with a null template can only run inside
     the window. */
  wa_template_name text,
  body        text,

  constraint crm_sequence_steps_delay_sane check (delay_days >= 0),
  constraint crm_sequence_steps_no_sane check (step_no >= 1)
);

create unique index if not exists crm_sequence_steps_order_uq
  on public.crm_sequence_steps (sequence_id, step_no);

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · ONE LEAD'S RUN THROUGH IT
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_lead_sequences (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads (id) on delete cascade,
  sequence_id uuid not null references public.crm_sequences (id) on delete cascade,
  /* The same five words as 147's `sequence_state`, which this table now feeds. */
  state       public.crm_sequence_state not null default 'scheduled',
  current_step integer not null default 0,
  total_steps  integer not null,

  started_at  timestamptz not null default now(),
  paused_at   timestamptz,
  /* ⚠️ WHY IT PAUSED, IN WORDS. "Client replied", "Quotation expired", "Stopped
     by Sarah". A paused sequence with no reason is one nobody dares restart. */
  pause_reason text,
  stopped_at  timestamptz,

  /* The quotation this run is chasing, when it is a quotation sequence. */
  quotation_id uuid references public.crm_quotations (id) on delete set null,

  created_by_id uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_lead_sequences_step_sane
    check (current_step >= 0 and current_step <= total_steps and total_steps > 0),
  /* ⚠️ A PAUSED RUN CARRIES ITS REASON AND ITS TIME. Both, or neither. */
  constraint crm_lead_sequences_pause_complete check (
    state <> 'paused' or (paused_at is not null and pause_reason is not null)
  )
);

/* ⚠️ ONE ACTIVE RUN PER LEAD. Two sequences chasing the same person means two
   messages on the same morning from the same business — the fastest way to be
   reported as spam and lose the number for every other client. */
create unique index if not exists crm_lead_sequences_one_live
  on public.crm_lead_sequences (lead_id)
  where state in ('scheduled', 'active', 'paused');

alter table public.crm_follow_ups
  drop constraint if exists crm_follow_ups_sequence_fk;
alter table public.crm_follow_ups
  add constraint crm_follow_ups_sequence_fk
  foreign key (lead_sequence_id) references public.crm_lead_sequences (id) on delete set null;

-- ════════════════════════════════════════════════════════════════════════════
-- POLICIES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.crm_follow_ups     enable row level security;
alter table public.crm_sequences      enable row level security;
alter table public.crm_sequence_steps enable row level security;
alter table public.crm_lead_sequences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'crm_follow_ups_select') then
    create policy crm_follow_ups_select on public.crm_follow_ups
      for select to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_follow_ups_write') then
    create policy crm_follow_ups_write on public.crm_follow_ups
      for all to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;

  /* ⚠️ A SEQUENCE TEMPLATE IS COMPANY PROPERTY — readable by anybody who works
     leads, editable by a manager. The owner's rules put "modify approved
     templates globally" firmly out of a salesperson's reach, and a sequence is
     the thing that decides what goes out under the business's name. */
  if not exists (select 1 from pg_policy where polname = 'crm_sequences_select') then
    create policy crm_sequences_select on public.crm_sequences
      for select to cni_app using (app.current_user_id() is not null);
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_sequences_write') then
    create policy crm_sequences_write on public.crm_sequences
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role)
             or (project_id is not null and app.crm_manages_project(project_id)))
      with check (app.acting_at_least('admin'::public.user_role)
             or (project_id is not null and app.crm_manages_project(project_id)));
  end if;

  if not exists (select 1 from pg_policy where polname = 'crm_sequence_steps_select') then
    create policy crm_sequence_steps_select on public.crm_sequence_steps
      for select to cni_app
      using (exists (select 1 from public.crm_sequences s where s.id = sequence_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_sequence_steps_write') then
    create policy crm_sequence_steps_write on public.crm_sequence_steps
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;

  /* ⚠️ BUT STARTING, PAUSING AND STOPPING A RUN IS THE SALESPERSON'S. They are
     the one who knows the client replied. */
  if not exists (select 1 from pg_policy where polname = 'crm_lead_sequences_select') then
    create policy crm_lead_sequences_select on public.crm_lead_sequences
      for select to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
  if not exists (select 1 from pg_policy where polname = 'crm_lead_sequences_write') then
    create policy crm_lead_sequences_write on public.crm_lead_sequences
      for all to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;
end $$;

grant select, insert, update, delete on public.crm_follow_ups     to cni_app;
grant select, insert, update, delete on public.crm_sequences      to cni_app;
grant select, insert, update, delete on public.crm_sequence_steps to cni_app;
grant select, insert, update, delete on public.crm_lead_sequences to cni_app;
revoke all on public.crm_follow_ups, public.crm_sequences,
              public.crm_sequence_steps, public.crm_lead_sequences
  from anon, authenticated;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead uuid; v_owner uuid; v_seq uuid; v_run uuid;
  bad boolean; n int;
begin
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null limit 1;

  if v_lead is null then
    raise notice '153 · no owned demo lead — tables created, nothing to measure';
    return;
  end if;

  insert into public.crm_sequences (name, purpose, stop_on_reply, is_test_data)
  values ('153 self-check', 'quotation', true, true) returning id into v_seq;

  insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose)
  values (v_seq, 1, 'whatsapp', 1, 'Quotation check-in'),
         (v_seq, 2, 'email', 3, 'Payment-plan clarification'),
         (v_seq, 3, 'email', 7, 'Final check-in');

  -- 1 · ⚠️ TWO STEPS CANNOT SHARE A NUMBER — "step 2" must mean one thing.
  bad := false;
  begin
    insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose)
    values (v_seq, 2, 'whatsapp', 5, 'Duplicate');
    bad := true;
  exception when unique_violation then null;
  end;
  if bad then raise exception '153 · a sequence had two step 2s'; end if;

  insert into public.crm_lead_sequences (lead_id, sequence_id, total_steps, state)
  values (v_lead, v_seq, 3, 'active') returning id into v_run;

  -- 2 · ⚠️ ONE LIVE RUN PER LEAD. Two sequences chasing the same person is two
  --     messages on one morning from one business — and a spam report.
  bad := false;
  begin
    insert into public.crm_lead_sequences (lead_id, sequence_id, total_steps, state)
    values (v_lead, v_seq, 3, 'scheduled');
    bad := true;
  exception when unique_violation then null;
  end;
  if bad then raise exception '153 · a lead was put on two live sequences'; end if;

  -- 3 · ⚠️ PAUSED WITHOUT A REASON IS REFUSED. A paused run nobody can explain
  --     is one nobody dares restart.
  bad := false;
  begin
    update public.crm_lead_sequences set state = 'paused' where id = v_run;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then raise exception '153 · a sequence paused with no reason recorded'; end if;

  update public.crm_lead_sequences
     set state = 'paused', paused_at = now(), pause_reason = 'Client replied'
   where id = v_run;

  -- 4 · ⚠️ STEP 4 OF 3 IS REFUSED.
  bad := false;
  begin
    update public.crm_lead_sequences set current_step = 4 where id = v_run;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then raise exception '153 · a run reached step 4 of 3'; end if;

  -- 5 · ⚠️ A "DONE" FOLLOW-UP HAS A TIME — the response-time figures are
  --     computed from exactly these.
  bad := false;
  begin
    insert into public.crm_follow_ups (lead_id, title, due_at, status)
    values (v_lead, '153 self-check', now(), 'done');
    bad := true;
  exception when check_violation then null;
  end;
  if bad then raise exception '153 · a follow-up was marked done with no timestamp'; end if;

  -- 6 · And the lead's owner can read their own run.
  if v_owner is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    select count(*) into n from public.crm_lead_sequences where id = v_run;
    reset role;
    if n <> 1 then
      raise exception '153 · a salesperson cannot see their own lead''s sequence';
    end if;
  end if;

  delete from public.crm_lead_sequences where id = v_run;
  delete from public.crm_sequences where id = v_seq;

  raise notice '153 · follow-ups, sequence templates and runs in; duplicates, silent pauses and step 4-of-3 all refused';
end $$;
