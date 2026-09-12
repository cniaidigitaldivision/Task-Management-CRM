-- ============================================================================
-- 111 · THE CRM TABLES — Step 1 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Six tables for lead management: campaigns, lead forms, clients, leads, notes
-- and activity. The full design and the reasoning behind every key is in
-- docs/crm/03-DATA-MODEL.md; this file is that design, applied.
--
-- ── ⚠️ ONE PROJECT'S WORTH OF WORK, NOT ONE PROJECT'S WORTH OF SCHEMA ──────
-- Owner, 2026-09-10: *"just choose one project, like Chitral Royal Homes, and
-- implement this whole CRM. Later on I will do the same thing for the other
-- projects."*
--
-- So only Chitral's data will flow in, and only Chitral appears in the
-- dropdown — but `project_id` is a real column on every table here. Narrowing
-- the SCHEMA to one project would turn "later on I will do the same for the
-- others" into a rewrite instead of a row. The column costs nothing today.
--
-- ── ⚠️ WHAT IS A COLUMN AND WHAT IS JSONB ──────────────────────────────────
-- Verified 2026-09-09: Meta returns whatever field keys the advertiser typed
-- into the form — `which__size_are_you_interested_in?_`, punctuation and all.
-- A column per question would need a migration per campaign.
--
-- So everything the CRM FILTERS, SORTS OR REPORTS ON is a real indexed column,
-- and the whole raw answer set is kept in `answers` so nothing Meta sent is
-- lost. No report ever has to dig into the jsonb.
-- ============================================================================

-- ── The vocabulary ─────────────────────────────────────────────────────────
-- A new type may be created and used in the same transaction; only ALTER TYPE
-- … ADD VALUE on an EXISTING type cannot. That is why 110 is its own file.

do $$ begin
  create type public.crm_lead_source as enum ('meta_lead_ad', 'whatsapp', 'website', 'manual');
exception when duplicate_object then null; end $$;

/* The owner's own words, 2026-09-09, in their order. */
do $$ begin
  create type public.crm_stage as enum (
    'new', 'contacted', 'follow_up', 'qualified',
    'visited', 'scheduled', 'negotiation', 'won', 'lost'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_temperature as enum ('hot', 'warm', 'cold');
exception when duplicate_object then null; end $$;

/* ⚠️ AN ENUM, NOT FREE TEXT. A text box fills with "wrong no.", "Wrong Number"
   and "wrng number", and no report can group it — which is the difference
   between a lost-reason report that means something and a list of typos.

   `revisit_later` is deliberately here even though it is NOT a loss: people who
   were only early must not be written off, and giving it a name is what stops
   somebody filing them under "not serious". */
do $$ begin
  create type public.crm_lost_reason as enum (
    'wrong_number', 'not_serious', 'budget_too_low', 'wrong_location',
    'no_answer', 'bought_elsewhere', 'wants_what_we_dont_offer',
    'duplicate', 'revisit_later'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_activity_kind as enum (
    'imported', 'assigned', 'stage_changed', 'note_added',
    'call_attempted', 'call_connected', 'call_no_answer',
    'whatsapp_sent', 'email_sent', 'won', 'lost'
  );
exception when duplicate_object then null; end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · CAMPAIGNS — where the project mapping lives
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_campaigns (
  id                uuid primary key default gen_random_uuid(),

  /* ⚠️ `on delete restrict`, not cascade. Deleting a project that still has a
     year of lead history under it should fail loudly and make somebody think,
     not silently take the leads with it. */
  project_id        uuid not null references public.projects(id) on delete restrict,

  meta_campaign_id  text not null unique,
  name              text not null,

  ad_account_id     text,
  page_id           text,
  objective         text,
  status            text,

  /* ⚠️ NOT EVERY CAMPAIGN IS A SALES CAMPAIGN. One live campaign in this
     account is "Female model Hiring campaign of attari gourp page" —
     recruitment. Without this flag its applicants land in the sales pipeline
     and quietly ruin every conversion figure the CRM reports. */
  is_sales          boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists crm_campaigns_project_idx on public.crm_campaigns (project_id);

comment on table public.crm_campaigns is
  'One Meta lead campaign, mapped to one Taskly project (111). is_sales = false '
  'keeps recruitment campaigns out of the sales pipeline and its reports.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LEAD FORMS — what a lead is actually attached to
-- ----------------------------------------------------------------------------
-- ⚠️ SEPARATE FROM CAMPAIGNS ON PURPOSE. Meta returns the FORM id on every lead;
-- the campaign has to be resolved separately and is currently unavailable across
-- portfolios (see docs/crm/06-CAMPAIGNS-AND-COVERAGE.md). Keeping them apart
-- means the importer never blocks on attribution it cannot get — and the form
-- still knows its project, so no lead is ever unfiled.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_lead_forms (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete restrict,
  campaign_id   uuid references public.crm_campaigns(id) on delete set null,

  meta_form_id  text not null unique,
  name          text not null,
  page_id       text not null,
  status        text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_lead_forms_project_idx  on public.crm_lead_forms (project_id);
create index if not exists crm_lead_forms_campaign_idx on public.crm_lead_forms (campaign_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · CLIENTS — a lead that engaged
-- ----------------------------------------------------------------------------
-- ⚠️ NO `project_id`, DELIBERATELY. Somebody who enquires about Chitral and then
-- about Executive Housing is one person, not two clients. The link to projects
-- comes through their leads, which is what makes "16 leads across 3 projects"
-- one query instead of a merge problem.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_clients (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(trim(full_name)) between 1 and 200),
  phone_e164      text,
  email           text,
  city            text,
  notes           text,
  first_lead_at   timestamptz,
  converted_at    timestamptz not null default now(),
  converted_by_id uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

/* Partial, because many clients will have no number and NULLs are not equal. */
create unique index if not exists crm_clients_phone_key
  on public.crm_clients (phone_e164) where phone_e164 is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · LEADS — the row everything hangs off
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_leads (
  id                 uuid primary key default gen_random_uuid(),

  -- ── The four relationships the owner asked about by name ────────────────
  project_id         uuid not null references public.projects(id)      on delete restrict,
  form_id            uuid references public.crm_lead_forms(id)         on delete set null,
  campaign_id        uuid references public.crm_campaigns(id)          on delete set null,
  owner_id           uuid references public.users(id)                  on delete set null,
  client_id          uuid references public.crm_clients(id)            on delete set null,

  -- ── Where it came from ──────────────────────────────────────────────────
  source             public.crm_lead_source not null,
  external_id        text,

  -- ── The person ──────────────────────────────────────────────────────────
  full_name          text,
  phone              text,
  /* Derived, and what everything matches on: the same person types
     0300-1234567 once and +92 300 1234567 the next time. Without a normalised
     form there is no duplicate detection, no working WhatsApp link, and two
     salespeople ring the same number. */
  phone_e164         text,
  email              text,
  city               text,

  answers            jsonb not null default '{}'::jsonb,

  -- ── Working it ──────────────────────────────────────────────────────────
  stage              public.crm_stage not null default 'new',
  temperature        public.crm_temperature,
  lost_reason        public.crm_lost_reason,
  next_action        text,
  next_action_at     timestamptz,

  -- ── Time ────────────────────────────────────────────────────────────────
  /* When THEY filled the form — not when we imported it. Response time is
     measured from this, and importing a month of backlog must not make every
     lead look like it arrived today. */
  submitted_at       timestamptz not null,
  imported_at        timestamptz not null default now(),
  first_contacted_at timestamptz,
  closed_at          timestamptz,

  created_by_id      uuid references public.users(id) on delete set null,

  /* ⚠️ THE CONSTRAINT THAT MAKES THE IMPORTER SAFE TO RUN TWICE, and it will be
     run twice — by a retry, by an overlapping cron, by somebody testing.
     Without it every re-run duplicates every lead. */
  constraint crm_leads_source_external_key unique (source, external_id),

  /* ⚠️ EXPLICIT `is not null`, NOT `lost_reason is not null or stage <> 'lost'`.
     A CHECK constraint passes when its expression evaluates to NULL, which is
     how migration 107 accepted twice the exact row it existed to refuse. */
  constraint crm_leads_lost_needs_reason check (
    case when stage = 'lost' then lost_reason is not null else true end
  )
);

/* The list screen is the only query that will ever be hot: "leads for this
   project / this owner, ordered by next action". */
create index if not exists crm_leads_project_next_idx on public.crm_leads (project_id, next_action_at);
create index if not exists crm_leads_owner_next_idx   on public.crm_leads (owner_id, next_action_at);
create index if not exists crm_leads_stage_idx        on public.crm_leads (project_id, stage);
create index if not exists crm_leads_campaign_idx     on public.crm_leads (campaign_id);
create index if not exists crm_leads_form_idx         on public.crm_leads (form_id);
create index if not exists crm_leads_client_idx       on public.crm_leads (client_id);
create index if not exists crm_leads_phone_idx        on public.crm_leads (phone_e164);
create index if not exists crm_leads_submitted_idx    on public.crm_leads (project_id, submitted_at desc);

comment on table public.crm_leads is
  'A person who responded to a campaign (111). Filterable columns are real '
  'columns; answers holds the raw Meta payload so nothing sent is ever lost.';


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · NOTES — "what quotation I have given him"
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.crm_leads(id) on delete cascade,
  /* ⚠️ `set null`, not cascade: a person leaving must not erase what they
     wrote. Same rule project_remarks follows. */
  author_id  uuid references public.users(id) on delete set null,
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists crm_lead_notes_lead_idx on public.crm_lead_notes (lead_id, created_at);


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · ACTIVITY — the timeline
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.crm_lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  kind        public.crm_activity_kind not null,
  outcome     text,
  detail      jsonb,

  /* ⚠️ SEPARATE FROM `created_at`. A call logged an hour later HAPPENED an hour
     ago, and response-time reporting that confuses the two is wrong by however
     long the salesperson took to write it down. */
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists crm_lead_activity_lead_idx on public.crm_lead_activity (lead_id, occurred_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-09: *"Admin will see everything but the staff member who is
-- assigned that lead will definitely have everything… Admin, super admin, plus
-- right now add team coordinator also to it, plus all the sales team."*
--
-- So: Coordinator and above see every lead. Everybody else sees the leads
-- ASSIGNED TO THEM and nothing else — not their project's leads, the ones with
-- their name on.
--
-- ⚠️ Narrow first. Widening later is a decision somebody makes on purpose;
-- narrowing takes access away from people who have grown used to having it.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_campaigns     enable row level security;
alter table public.crm_lead_forms    enable row level security;
alter table public.crm_clients       enable row level security;
alter table public.crm_leads         enable row level security;
alter table public.crm_lead_notes    enable row level security;
alter table public.crm_lead_activity enable row level security;

-- ── Campaigns and forms: not sensitive, and a salesperson needs the name ────
drop policy if exists crm_campaigns_select on public.crm_campaigns;
create policy crm_campaigns_select on public.crm_campaigns
  for select using (app.project_is_visible(project_id));

drop policy if exists crm_campaigns_write on public.crm_campaigns;
create policy crm_campaigns_write on public.crm_campaigns
  for all using      (app.acting_at_least('team_coordinator'::public.user_role))
          with check (app.acting_at_least('team_coordinator'::public.user_role));

drop policy if exists crm_lead_forms_select on public.crm_lead_forms;
create policy crm_lead_forms_select on public.crm_lead_forms
  for select using (app.project_is_visible(project_id));

drop policy if exists crm_lead_forms_write on public.crm_lead_forms;
create policy crm_lead_forms_write on public.crm_lead_forms
  for all using      (app.acting_at_least('team_coordinator'::public.user_role))
          with check (app.acting_at_least('team_coordinator'::public.user_role));

-- ── Leads ──────────────────────────────────────────────────────────────────
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    app.acting_at_least('team_coordinator'::public.user_role)
    or owner_id = app.current_user_id()
  );

drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert with check (app.acting_at_least('team_coordinator'::public.user_role));

/* A salesperson works their own leads: stage, next action, notes, outcome. */
drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    app.acting_at_least('team_coordinator'::public.user_role)
    or owner_id = app.current_user_id()
  )
  with check (
    app.acting_at_least('team_coordinator'::public.user_role)
    or owner_id = app.current_user_id()
  );

/* ⚠️ Admin only. A lead is the record of a real enquiry and the only copy that
   will exist once Meta deletes it at 90 days. */
drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete using (app.acting_at_least('admin'::public.user_role));

-- ── Clients ────────────────────────────────────────────────────────────────
drop policy if exists crm_clients_select on public.crm_clients;
create policy crm_clients_select on public.crm_clients
  for select using (
    app.acting_at_least('team_coordinator'::public.user_role)
    or exists (
      select 1 from public.crm_leads l
       where l.client_id = crm_clients.id and l.owner_id = app.current_user_id()
    )
  );

drop policy if exists crm_clients_write on public.crm_clients;
create policy crm_clients_write on public.crm_clients
  for all using      (app.acting_at_least('team_coordinator'::public.user_role))
          with check (app.acting_at_least('team_coordinator'::public.user_role));

-- ── Notes and activity: visible exactly when their lead is ─────────────────
-- ⚠️ `exists (select … from crm_leads …)` re-applies the LEAD's policy, which
-- is precisely the rule wanted — and cannot recurse, because the lead policy
-- does not reference these tables.

drop policy if exists crm_lead_notes_select on public.crm_lead_notes;
create policy crm_lead_notes_select on public.crm_lead_notes
  for select using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_notes.lead_id)
  );

drop policy if exists crm_lead_notes_insert on public.crm_lead_notes;
create policy crm_lead_notes_insert on public.crm_lead_notes
  for insert with check (
    author_id = app.current_user_id()
    and exists (select 1 from public.crm_leads l where l.id = crm_lead_notes.lead_id)
  );

/* Withdraw your own; an Admin may remove anybody's. ⚠️ NO UPDATE POLICY — a
   note that can be rewritten after somebody acted on it is not a record of what
   was said. And a soft delete cannot work here anyway: PostgreSQL applies
   SELECT policies to the NEW row of an UPDATE, so a row cannot be updated into
   invisibility. Migration 104 proved that. */
drop policy if exists crm_lead_notes_delete on public.crm_lead_notes;
create policy crm_lead_notes_delete on public.crm_lead_notes
  for delete using (
    author_id = app.current_user_id()
    or app.acting_at_least('admin'::public.user_role)
  );

drop policy if exists crm_lead_activity_select on public.crm_lead_activity;
create policy crm_lead_activity_select on public.crm_lead_activity
  for select using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_activity.lead_id)
  );

drop policy if exists crm_lead_activity_insert on public.crm_lead_activity;
create policy crm_lead_activity_insert on public.crm_lead_activity
  for insert with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_activity.lead_id)
  );

/* ⚠️ NO UPDATE AND NO DELETE POLICY, ANYWHERE, FOR ANY RANK. An activity log
   somebody can edit is not evidence of anything — the same rule
   `report_exports` follows. */

grant select, insert, update, delete on public.crm_campaigns     to cni_app;
grant select, insert, update, delete on public.crm_lead_forms    to cni_app;
grant select, insert, update, delete on public.crm_clients       to cni_app;
grant select, insert, update, delete on public.crm_leads         to cni_app;
grant select, insert, delete         on public.crm_lead_notes    to cni_app;
grant select, insert                 on public.crm_lead_activity to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER REAL SESSIONS. A migration executes as the schema
-- owner and bypasses RLS entirely, which is how a check passes while proving
-- nothing — migration 094 did exactly that. Every assertion below is made
-- through the policies, from inside a session that has an identity.
--
-- ⚠️ AND IT REMOVES ITS OWN ROWS BY ID, NEVER BY PREDICATE. Migration 082 ate a
-- live attendance row with a tidy-up delete keyed on a date.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_member   uuid;
  v_project  uuid;
  v_campaign uuid;
  v_form     uuid;
  v_lead     uuid;
  v_note     uuid;
  n          integer;
begin
  select id into v_admin from public.users
   where role = 'super_admin' and is_active order by created_at limit 1;
  select id into v_member from public.users
   where role = 'member' and is_active order by created_at limit 1;
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_member is null or v_project is null then
    raise notice '111 · no admin, member or Chitral project to check against; tables created untested';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 1 · A coordinator-and-above can create the chain.
  insert into public.crm_campaigns (project_id, meta_campaign_id, name, is_sales)
  values (v_project, '111-selfcheck-campaign', '111 self-check', true)
  returning id into v_campaign;

  insert into public.crm_lead_forms (project_id, campaign_id, meta_form_id, name, page_id)
  values (v_project, v_campaign, '111-selfcheck-form', '111 self-check', '0')
  returning id into v_form;

  insert into public.crm_leads
    (project_id, form_id, campaign_id, source, external_id, full_name, phone,
     phone_e164, answers, submitted_at)
  values
    (v_project, v_form, v_campaign, 'meta_lead_ad', '111-selfcheck-lead',
     '111 self-check', '0300-0000000', '+923000000000',
     '{"note":"self-check"}'::jsonb, now())
  returning id into v_lead;

  -- 2 · ⚠️ THE IMPORTER'S SAFETY RAIL. A second import of the same Meta lead
  --     must collide, or every re-run duplicates every lead.
  begin
    insert into public.crm_leads (project_id, source, external_id, submitted_at)
    values (v_project, 'meta_lead_ad', '111-selfcheck-lead', now());
    raise exception '111 · the same Meta lead was accepted twice';
  exception when unique_violation then
    null;
  end;

  -- 3 · ⚠️ A LOST LEAD MUST CARRY A REASON, and the NULL-passes-CHECK trap is
  --     what this asserts. Migration 107 accepted the very row it refused.
  begin
    update public.crm_leads set stage = 'lost' where id = v_lead;
    raise exception '111 · a lead was marked lost with no reason';
  exception when check_violation then
    null;
  end;

  -- 4 · Notes and activity attach.
  insert into public.crm_lead_notes (lead_id, author_id, body)
  values (v_lead, v_admin, 'self-check note') returning id into v_note;

  insert into public.crm_lead_activity (lead_id, actor_id, kind)
  values (v_lead, v_admin, 'imported');

  -- ── Now as an unassigned MEMBER ─────────────────────────────────────────
  perform set_config('app.user_id', v_member::text, true);

  -- 5 · ⚠️ THE RULE THE OWNER ASKED FOR. A member sees leads with their name on
  --     and nothing else.
  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 0 then
    raise exception '111 · a member can read a lead that is not assigned to them';
  end if;

  -- 6 · And its notes and activity are invisible with it.
  select count(*) into n from public.crm_lead_notes where id = v_note;
  if n <> 0 then
    raise exception '111 · a member can read notes on a lead they cannot see';
  end if;

  select count(*) into n from public.crm_lead_activity where lead_id = v_lead;
  if n <> 0 then
    raise exception '111 · a member can read activity on a lead they cannot see';
  end if;

  -- 7 · A member cannot create leads at all.
  begin
    insert into public.crm_leads (project_id, source, external_id, submitted_at)
    values (v_project, 'manual', '111-selfcheck-member', now());
    raise exception '111 · a member was allowed to create a lead';
  exception when insufficient_privilege then
    null;
  end;

  -- ── Assign it to them, and everything opens ─────────────────────────────
  perform set_config('app.user_id', v_admin::text, true);
  update public.crm_leads set owner_id = v_member where id = v_lead;

  perform set_config('app.user_id', v_member::text, true);

  select count(*) into n from public.crm_leads where id = v_lead;
  if n <> 1 then
    raise exception '111 · a member cannot read the lead assigned to them';
  end if;

  select count(*) into n from public.crm_lead_notes where id = v_note;
  if n <> 1 then
    raise exception '111 · a member cannot read notes on their own lead';
  end if;

  -- 8 · ⚠️ AND THE ACTIVITY LOG IS APPEND-ONLY FOR EVERYBODY. There is no
  --     UPDATE or DELETE policy at any rank; a log that can be edited is not
  --     evidence of anything.
  perform set_config('app.user_id', v_admin::text, true);
  begin
    delete from public.crm_lead_activity where lead_id = v_lead;
    raise exception '111 · activity was deleted; the log is meant to be append-only';
  exception when insufficient_privilege then
    null;
  end;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_lead_notes     where id = v_note;
  delete from public.crm_leads          where id = v_lead;
  delete from public.crm_lead_forms     where id = v_form;
  delete from public.crm_campaigns      where id = v_campaign;

  raise notice '111 · six tables, and a member sees only the leads assigned to them';
end $$;
