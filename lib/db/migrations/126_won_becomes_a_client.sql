-- ============================================================================
-- 126 · WINNING A LEAD MAKES A CLIENT — Step 9 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-09: *"Once he is interested, or we give some quotation and he
-- accepted… that would become our client."*
--
-- ── ⚠️ Q17, ANSWERED — AND THE OWNER'S FIRST PROPOSAL WAS DECLINED ─────────
-- Asked on 2026-09-10 what converts a lead, the owner said: *"We will contact a
-- lead and give relevant information. If they engage and we show some intro,
-- definitely that will convert the lead, right? According to me I think so…
-- maybe you are a sales expert or you know better."*
--
-- Put back to them, with the reasoning: **engagement is too early.** If engaging
-- makes somebody a client then within a month there are two hundred "clients"
-- who have paid nothing, and the word stops carrying information — the whole
-- value of this table is that "we have 14 clients" is a sentence somebody can
-- act on. Their own earlier answer was better, and they agreed:
--
--     **Reaching `won` IS the conversion.** One moment, one action, nothing to
--     remember. And "they engaged after we sent the intro" already has a home:
--     the `qualified` stage.
--
-- ⚠️ IT ALSO PROTECTS STEP 12. The owner's headline question is *"6,000 leads
-- and not one closed — is it the staff or the campaign?"* That only means
-- something if "closed" means money. If it meant "replied to us", the diagnosis
-- would be worthless.
--
-- ── ⚠️ A TRIGGER, NOT A BUTTON ─────────────────────────────────────────────
-- The same reasoning as 116's timeline: the SECOND caller is the one that
-- forgets. A "convert to client" button beside the stage dropdown would mean a
-- won lead that is not a client, which is a state nobody can explain and every
-- report has to allow for.
--
-- ── ⚠️ AND REOPENING A LEAD DOES NOT UNMAKE THE CLIENT ─────────────────────
-- 116 clears `closed_at` and `lost_reason` when a lead leaves an exit stage,
-- because those describe the lead. A client is a different kind of fact: they
-- are a person, they may have notes on them, and they may hold other leads. A
-- trigger that deleted people on a stage change would turn one mis-click into
-- data loss. So a mistake leaves a client who should not be one — visible, and
-- removable by an Admin — which is the recoverable direction.
-- ============================================================================

create or replace function app.crm_won_becomes_client()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client uuid;
begin
  /* Only on the way IN to `won`, and only when the lead is not already tied to
     somebody. A lead won, reopened and won again must not make a second client. */
  if new.stage <> 'won' or new.client_id is not null then
    return new;
  end if;

  /* ── ⚠️ THE SAME NUMBER IS THE SAME PERSON ────────────────────────────────
     Measured on the live table: 615 leads carry 597 distinct numbers, so ~18
     people enquired twice. Somebody who bought a plot and comes back for a
     second is ONE client with two leads — the *"Khurram · 16 Leads"* column in
     the owner's reference screenshot. Creating a second client row for them
     would make that column impossible to build.

     Matched on `phone_e164`, never the raw `phone`: `0300-1234567` and
     `+92 300 1234567` are one person and two strings. */
  if new.phone_e164 is not null then
    select id into v_client from public.crm_clients
     where phone_e164 = new.phone_e164 limit 1;
  end if;

  if v_client is null then
    insert into public.crm_clients
      (full_name, phone_e164, email, city, first_lead_at, converted_by_id)
    values (
      /* ⚠️ `crm_clients.full_name` IS NOT NULL, and three of the 615 leads have
         no name at all. A won lead must not fail to convert because Meta's form
         did not ask — so the number stands in, and it is at least something a
         person can act on. */
      coalesce(nullif(trim(coalesce(new.full_name, '')), ''),
               new.phone_e164,
               'Unnamed client'),
      new.phone_e164, new.email, new.city,
      new.submitted_at,
      /* Null for the importer, which has no session. */
      app.current_user_id()
    )
    returning id into v_client;
  else
    /* ⚠️ FILLS GAPS, OVERWRITES NOTHING. A returning client may have given a
       city this time and not last time; what they told us before is not
       improved by being replaced with a blank. And `first_lead_at` moves only
       EARLIER — it is when they first came to us, and a later lead does not
       change that. */
    update public.crm_clients c
       set email         = coalesce(c.email, new.email),
           city          = coalesce(c.city, new.city),
           first_lead_at = least(coalesce(c.first_lead_at, new.submitted_at), new.submitted_at)
     where c.id = v_client;
  end if;

  new.client_id := v_client;
  return new;
end $$;

/* ⚠️ BEFORE, because it sets `client_id` on the row on its way in. An AFTER
   trigger would need a second UPDATE, which would re-fire 116's activity
   trigger and write a spurious timeline entry. */
drop trigger if exists crm_leads_won_becomes_client on public.crm_leads;
create trigger crm_leads_won_becomes_client
  before insert or update on public.crm_leads
  for each row execute function app.crm_won_becomes_client();


-- ════════════════════════════════════════════════════════════════════════════
-- WHO THE CLIENTS ARE
-- ----------------------------------------------------------------------------
-- ⚠️ A DEFINER READER, FOR THE REASON 125 SPELLS OUT AT LENGTH. This joins
-- `crm_leads` and `projects` to say which projects a client has bought on, and
-- `projects_select` needs project MEMBERSHIP — which the sales team does not
-- have. Read directly, the project names would come back empty for exactly the
-- people whose job this is. Third occurrence, and now anticipated rather than
-- discovered.
--
-- ⚠️ AND THE VISIBILITY RULE IS THE LEADS', NOT A NEW ONE. A client is visible
-- when one of their leads is — so a salesperson sees the clients they closed,
-- and a department manager sees their department's. Written as `exists` against
-- `crm_leads` under the caller's own rules rather than as a fourth copy of the
-- routing predicate.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_client_list()
returns table (
  id            uuid,
  full_name     text,
  phone_e164    text,
  email         text,
  city          text,
  first_lead_at timestamptz,
  converted_at  timestamptz,
  lead_count    bigint,
  won_count     bigint,
  projects      text[]
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select c.id, c.full_name, c.phone_e164, c.email, c.city,
         c.first_lead_at, c.converted_at,
         count(l.id),
         count(l.id) filter (where l.stage = 'won'),
         array_agg(distinct p.name order by p.name)
    from public.crm_clients c
    join public.crm_leads l on l.client_id = c.id
    join public.projects p  on p.id = l.project_id
   where app.crm_manages_project(l.project_id)
      or (app.crm_in_project_department(l.project_id)
          and l.owner_id = app.current_user_id())
   group by c.id, c.full_name, c.phone_e164, c.email, c.city,
            c.first_lead_at, c.converted_at
   order by c.converted_at desc
$$;

comment on function app.crm_client_list() is
  'Clients, with how many leads each holds and which projects (126). SECURITY '
  'DEFINER because projects_select needs project membership; visibility follows '
  'the leads, so it inherits 124''s routing rather than restating it.';

grant execute on function app.crm_client_list() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ REMOVES ITS OWN ROWS BY ID. Migration 082 ate a live attendance row with a
-- tidy-up delete keyed on a date — and this file creates PEOPLE.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  v_sp     uuid;
  v_chit   uuid;
  v_l1     uuid;
  v_l2     uuid;
  v_l3     uuid;
  v_client uuid;
  v_other  uuid;
  n        integer;
  v_name   text;
  v_first  timestamptz;
  v_city   text;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_sp from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_chit from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_sp is null or v_chit is null then
    raise notice '126 · people or Chitral missing; conversion created untested';
    return;
  end if;

  /* Two leads sharing a number — the repeat enquirer — and one with no name. */
  insert into public.crm_leads
    (project_id, owner_id, source, external_id, full_name, phone, phone_e164, city, submitted_at)
  values
    (v_chit, v_sp, 'manual', '126-a', '126 Khurram', '0300-1260001', '+923001260001',
     'Islamabad', now() - interval '60 days')
  returning id into v_l1;

  insert into public.crm_leads
    (project_id, owner_id, source, external_id, full_name, phone, phone_e164, submitted_at)
  values
    (v_chit, v_sp, 'manual', '126-b', '126 Khurram', '0300 1260001', '+923001260001',
     now() - interval '3 days')
  returning id into v_l2;

  insert into public.crm_leads
    (project_id, owner_id, source, external_id, phone, phone_e164, submitted_at)
  values
    (v_chit, v_sp, 'manual', '126-c', '0300-1260002', '+923001260002', now())
  returning id into v_l3;

  -- 1 · Winning the first lead makes a client, with the lead pointing at them.
  update public.crm_leads set stage = 'won' where id = v_l1;

  select client_id into v_client from public.crm_leads where id = v_l1;
  if v_client is null then
    raise exception '126 · a won lead did not become a client';
  end if;

  select full_name, first_lead_at, city into v_name, v_first, v_city
    from public.crm_clients where id = v_client;
  if v_name <> '126 Khurram' then
    raise exception '126 · the client got the wrong name (%)', v_name;
  end if;
  if v_city <> 'Islamabad' then
    raise exception '126 · the client did not take the city from the lead';
  end if;

  -- 2 · ⚠️ THE SAME NUMBER IS THE SAME PERSON. Winning their SECOND lead links
  --     to the client that exists rather than making a twin — which is what
  --     makes "Khurram · 2 leads" possible at all.
  update public.crm_leads set stage = 'won' where id = v_l2;

  select client_id into v_other from public.crm_leads where id = v_l2;
  if v_other is distinct from v_client then
    raise exception '126 · the same number produced two different clients';
  end if;

  select count(*) into n from public.crm_clients where phone_e164 = '+923001260001';
  if n <> 1 then
    raise exception '126 · % client rows exist for one number', n;
  end if;

  -- 3 · ⚠️ AND `first_lead_at` STAYED AT THE EARLIER LEAD. It is when they first
  --     came to us; a later enquiry does not change that.
  select first_lead_at into v_first from public.crm_clients where id = v_client;
  if v_first > now() - interval '50 days' then
    raise exception '126 · first_lead_at moved forward to the later lead';
  end if;

  -- 4 · ⚠️ A LEAD WITH NO NAME STILL CONVERTS. `full_name` is NOT NULL and three
  --     of the 615 have none — a won lead must not fail because Meta did not ask.
  update public.crm_leads set stage = 'won' where id = v_l3;

  select c.full_name into v_name
    from public.crm_clients c join public.crm_leads l on l.client_id = c.id
   where l.id = v_l3;
  if v_name is null or v_name = '' then
    raise exception '126 · a nameless lead produced a client with no name';
  end if;
  if v_name <> '+923001260002' then
    raise exception '126 · the nameless client should fall back to the number, got %', v_name;
  end if;

  -- 5 · ⚠️ REOPENING DOES NOT UNMAKE THE CLIENT. They became one; that happened.
  update public.crm_leads set stage = 'negotiation' where id = v_l2;

  select count(*) into n from public.crm_clients where id = v_client;
  if n <> 1 then
    raise exception '126 · reopening a lead deleted the client';
  end if;

  -- 6 · And winning it again does not make a second.
  update public.crm_leads set stage = 'won' where id = v_l2;
  select count(*) into n from public.crm_clients where phone_e164 = '+923001260001';
  if n <> 1 then
    raise exception '126 · winning the same lead twice made % clients', n;
  end if;

  -- ── The list, under the salesperson's own session ───────────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_sp::text, true);

  -- 7 · They see the client they closed, with the lead count and the project.
  select lead_count, projects[1] into n, v_name
    from app.crm_client_list() where id = v_client;
  if n <> 2 then
    raise exception '126 · the client shows % leads, expected 2', n;
  end if;
  if v_name <> 'Chitral Royal Homes' then
    raise exception '126 · the client list lost the project name (got %)', v_name;
  end if;

  -- 8 · ⚠️ AND THE PROJECT NAME IS WHY THIS IS A DEFINER READER. Through the
  --     table the salesperson cannot see the project at all — 125's lesson,
  --     asserted here so the reader is not quietly made redundant.
  select count(*) into n from public.projects where id = v_chit;
  if n <> 0 then
    raise exception
      '126 · a salesperson can now read projects directly — this reader and 125''s can both go';
  end if;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_lead_activity where lead_id in (v_l1, v_l2, v_l3);
  delete from public.crm_leads where id in (v_l1, v_l2, v_l3);
  delete from public.crm_clients where phone_e164 in ('+923001260001', '+923001260002');

  raise notice '126 · winning a lead makes a client, the same number stays one person, and reopening does not unmake them';
end $$;
