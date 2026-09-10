-- ============================================================================
-- 116 · THE DESK STARTS SAVING — Step 6 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Change the stage, set the next action, log a call, mark the temperature, add a
-- note, mark it lost with a reason. Everything in Step 6 that needs no new
-- integration.
--
-- Until now nothing but the importer had ever written to `crm_leads`. The moment
-- a person's session can, three questions become live at once, and this file
-- answers all three in the database rather than in the code that happens to be
-- calling today:
--
--   1. WHICH COLUMNS may a session change?        → a column-level grant
--   2. WHAT gets written to the timeline?         → triggers, not callers
--   3. WHAT may a session claim happened?         → a narrowed insert policy
--
-- ── ⚠️ THE TIMELINE IS WRITTEN BY THE DATABASE, NOT BY THE CALLER ──────────
-- The obvious build is: the server action updates the lead, then inserts the
-- activity row. It works, and it is wrong here — because the SECOND caller is
-- the one that forgets, and a timeline with a hole in it looks complete. Every
-- derived entry is a trigger, so a stage change writes its own history whether
-- it came from this app, from a future bulk action, from psql, or from a script
-- somebody runs at midnight.
--
-- ⚠️ AND THE GUARDS ARE THE WHOLE TRICK. The importer UPDATEs every one of the
-- 615 leads on every run — name, phone, answers, form. A trigger that logged
-- "updated" would write **615 rows every fifteen minutes, ~59,000 a day**, and
-- bury the handful of rows that mean something. Each branch below fires only on
-- a column a PERSON changes, and the self-check proves an importer-shaped update
-- writes nothing at all.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · CLOSING AND REOPENING, KEPT HONEST
-- ----------------------------------------------------------------------------
-- ⚠️ BEFORE UPDATE, because it edits the row on its way in.
--
-- Reopening matters more than closing here. `crm_leads_lost_needs_reason` makes
-- a lost lead carry a reason; nothing made a REOPENED lead drop it. A lead moved
-- from Lost back to Contacted would sit there still saying "wrong number", and
-- the lost-reason report — the thing that tells you whether the campaign or the
-- audience is at fault — would count a lead nobody lost.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_close_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.stage is distinct from old.stage then
    if new.stage in ('won', 'lost') then
      /* coalesce: a caller that set it explicitly is left alone. */
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
      new.lost_reason := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_leads_close_stamp on public.crm_leads;
create trigger crm_leads_close_stamp
  before update on public.crm_leads
  for each row execute function app.crm_lead_close_stamp();


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE TIMELINE WRITES ITSELF
-- ----------------------------------------------------------------------------
-- ⚠️ `app.current_user_id()` IS THE ACTOR, AND NULL IS A REAL ANSWER. The cron
-- runs with no session, so a row it causes has no actor — which the screen reads
-- as "by the importer", not as a person who left. See 114.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_actor uuid := app.current_user_id();
begin
  /* ── Stage ──────────────────────────────────────────────────────────────
     `won` and `lost` get their own kinds. They are not steps along the
     pipeline, they are exits, and a report that reads the log should not have
     to parse a detail blob to find out that a deal closed. */
  if new.stage is distinct from old.stage then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (
      new.id, v_actor,
      case new.stage
        when 'won'  then 'won'::public.crm_activity_kind
        when 'lost' then 'lost'::public.crm_activity_kind
        else 'stage_changed'::public.crm_activity_kind
      end,
      nullif(new.lost_reason::text, ''),
      jsonb_build_object('from', old.stage::text, 'to', new.stage::text)
    );
  end if;

  if new.temperature is distinct from old.temperature then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (new.id, v_actor, 'temperature_set', new.temperature::text,
            jsonb_build_object('from', old.temperature::text, 'to', new.temperature::text));
  end if;

  /* One row for the pair — the text and its date are one decision a person
     makes, and two rows would read as two. */
  if new.next_action is distinct from old.next_action
     or new.next_action_at is distinct from old.next_action_at then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (new.id, v_actor, 'next_action_set', new.next_action,
            jsonb_build_object('due', new.next_action_at));
  end if;

  /* ⚠️ FREE FOR STEP 7, and deliberately here rather than there. Assignment is
     the one change a salesperson has the strongest reason to dispute — "nobody
     told me it was mine" — and the record of it should not depend on the screen
     that happens to make it. */
  if new.owner_id is distinct from old.owner_id then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, detail)
    values (new.id, v_actor, 'assigned',
            jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;

  return null;   -- AFTER trigger; the return value is ignored
end $$;

drop trigger if exists crm_leads_record_activity on public.crm_leads;
create trigger crm_leads_record_activity
  after update on public.crm_leads
  for each row execute function app.crm_lead_record_activity();


-- ── A note is a thing that happened ─────────────────────────────────────────
-- ⚠️ THE ROW POINTS AT THE NOTE, IT DOES NOT COPY IT. Same rule the project
-- feed follows: the entry says a note was left, the note says what it said. A
-- log that repeats every quotation in full is a log nobody reads — and notes
-- can be deleted by their author, which would leave the copy behind as the only
-- surviving version of something somebody withdrew.
create or replace function app.crm_note_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.crm_lead_activity (lead_id, actor_id, kind, detail)
  values (new.lead_id, new.author_id, 'note_added',
          jsonb_build_object('note_id', new.id));
  return null;
end $$;

drop trigger if exists crm_lead_notes_record_activity on public.crm_lead_notes;
create trigger crm_lead_notes_record_activity
  after insert on public.crm_lead_notes
  for each row execute function app.crm_note_record_activity();


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · RESPONSE TIME IS STAMPED BY THE DATABASE
-- ----------------------------------------------------------------------------
-- `first_contacted_at − submitted_at` is the number Step 12 answers "is it the
-- staff or the campaign?" with, and response time moves conversion more than
-- almost anything else in a CRM. So it is not left to a caller to remember.
--
-- ⚠️ FROM `occurred_at`, NOT `now()`. A call logged an hour later HAPPENED an
-- hour ago, and a response time wrong by however long somebody took to write it
-- down is a response time that flatters whoever writes things down late.
--
-- ⚠️ `call_no_answer` COUNTS. It measures OUR responsiveness, not the lead's —
-- a salesperson who rang within four minutes and got no answer responded in four
-- minutes. Excluding it would score them as if they had never tried.
--
-- ⚠️ `least(...)`, so a backdated entry can only move it EARLIER. Somebody
-- logging Tuesday's call on Thursday must not make the first contact look later
-- than it was.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_activity_stamp_contact()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.kind in ('call_attempted', 'call_connected', 'call_no_answer',
                  'whatsapp_sent', 'email_sent') then
    /* ⚠️ NO RECURSION. This UPDATE touches `first_contacted_at` alone, and every
       branch of crm_lead_record_activity is guarded on a different column, so it
       writes nothing and nothing comes back here. The self-check proves it. */
    update public.crm_leads
       set first_contacted_at = least(coalesce(first_contacted_at, new.occurred_at), new.occurred_at)
     where id = new.lead_id
       and (first_contacted_at is null or first_contacted_at > new.occurred_at);
  end if;
  return null;
end $$;

drop trigger if exists crm_lead_activity_stamp_contact on public.crm_lead_activity;
create trigger crm_lead_activity_stamp_contact
  after insert on public.crm_lead_activity
  for each row execute function app.crm_activity_stamp_contact();


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · WHICH COLUMNS A SESSION MAY CHANGE
-- ----------------------------------------------------------------------------
-- ⚠️ RLS DECIDES WHICH ROWS, NOT WHICH COLUMNS. `crm_leads_update` lets an owner
-- update their own lead — every column of it. Nothing in a policy stops a sales
-- member moving their lead to another project, rewriting the phone number Meta
-- captured, or backdating `first_contacted_at` to make their response time look
-- good. Column privileges are the only mechanism PostgreSQL has for this, and
-- Step 6 is the first time any session updates this table at all — so the
-- narrow start is free today and expensive to retrofit later.
--
-- What is NOT here is the point:
--   · project_id, form_id, campaign_id  — a lead's filing is not a salesperson's
--   · full_name, phone, phone_e164, email, city, answers, submitted_at, external_id
--                                       — Meta's record of what a stranger typed
--   · first_contacted_at, closed_at     — stamped by the triggers above, so the
--                                         response-time figures cannot be doctored
--   · owner_id                          — ⚠️ STEP 7 ADDS THIS, with the rule that
--                                         only a coordinator may reassign. The
--                                         trigger that logs it is already written.
-- ════════════════════════════════════════════════════════════════════════════
revoke update on public.crm_leads from cni_app;
grant update (stage, temperature, lost_reason, next_action, next_action_at)
  on public.crm_leads to cni_app;


-- ── And what a session may CLAIM happened ───────────────────────────────────
-- ⚠️ A session may only log the things a PERSON does. Everything derived — a
-- stage change, an assignment, a note, an import — is written by a trigger,
-- which is SECURITY DEFINER and bypasses this policy.
--
-- Without the `kind` clause, anybody who can see a lead can insert a `won` row
-- into an append-only log that nobody can delete, and the pipeline reports read
-- that log. The rule is not "who may write history" but "what part of history is
-- a person's to assert".
drop policy if exists crm_lead_activity_insert on public.crm_lead_activity;
create policy crm_lead_activity_insert on public.crm_lead_activity
  for insert with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_activity.lead_id)
    and kind in ('call_attempted', 'call_connected', 'call_no_answer',
                 'whatsapp_sent', 'email_sent')
    /* The actor is the caller or nobody — a session cannot log a call under a
       colleague's name. */
    and (actor_id is null or actor_id = app.current_user_id())
  );


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER REAL SESSIONS. A migration executes as the schema
-- owner and bypasses both RLS and column privileges, which is how a check passes
-- while proving nothing — migration 094 did exactly that.
--
-- ⚠️ AND IT REMOVES ITS OWN ROWS BY ID, NEVER BY PREDICATE. Migration 082 ate a
-- live attendance row with a tidy-up delete keyed on a date.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_lead    uuid;
  v_note    uuid;
  v_when    timestamptz := now() - interval '3 hours';
  v_first   timestamptz;
  v_closed  timestamptz;
  v_reason  text;
  n         integer;
  n_before  integer;
begin
  select id into v_admin from public.users
   where role in ('admin', 'super_admin') and is_active order by created_at limit 1;
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_project is null then
    raise notice '116 · no admin or Chitral project to check against; triggers created untested';
    return;
  end if;

  insert into public.crm_leads
    (project_id, source, external_id, full_name, submitted_at)
  values
    (v_project, 'manual', '116-selfcheck-lead', '116 self-check', now() - interval '1 day')
  returning id into v_lead;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 1 · A stage change writes exactly one row, with the actor and both ends.
  update public.crm_leads set stage = 'contacted' where id = v_lead;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'stage_changed'
     and actor_id = v_admin
     and detail->>'from' = 'new' and detail->>'to' = 'contacted';
  if n <> 1 then
    raise exception '116 · a stage change did not write its own timeline row (got %)', n;
  end if;

  -- 2 · ⚠️ THE 59,000-ROWS-A-DAY TRAP. An importer-shaped update writes NOTHING.
  --     The cron updates all 615 leads every fifteen minutes; a trigger that
  --     logged "updated" would bury every row that means something.
  reset role;
  select count(*) into n_before from public.crm_lead_activity where lead_id = v_lead;

  update public.crm_leads
     set full_name = '116 self-check renamed', phone = '03000000000',
         answers = '{"x":"y"}'::jsonb
   where id = v_lead;

  select count(*) into n from public.crm_lead_activity where lead_id = v_lead;
  if n <> n_before then
    raise exception
      '116 · an importer-shaped update wrote % timeline rows; the cron would write ~59,000 a day', n - n_before;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 3 · Logging a call stamps first contact FROM `occurred_at`, not from now().
  insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, outcome)
  values (v_lead, v_admin, 'call_no_answer', v_when, 'rang out');

  select first_contacted_at into v_first from public.crm_leads where id = v_lead;
  if v_first is null then
    raise exception '116 · a logged call did not stamp first_contacted_at';
  end if;
  if abs(extract(epoch from (v_first - v_when))) > 1 then
    raise exception
      '116 · first_contacted_at was stamped from the clock, not from occurred_at (% vs %)', v_first, v_when;
  end if;

  -- 4 · A later call does not move it. Response time is to the FIRST contact.
  insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at)
  values (v_lead, v_admin, 'call_connected', now());

  select first_contacted_at into v_first from public.crm_leads where id = v_lead;
  if abs(extract(epoch from (v_first - v_when))) > 1 then
    raise exception '116 · a later call moved first_contacted_at forward';
  end if;

  -- 5 · A backdated one moves it earlier.
  insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at)
  values (v_lead, v_admin, 'whatsapp_sent', v_when - interval '1 hour');

  select first_contacted_at into v_first from public.crm_leads where id = v_lead;
  if v_first >= v_when then
    raise exception '116 · a backdated contact did not move first_contacted_at earlier';
  end if;

  -- 6 · ⚠️ AND THE SESSION CANNOT STAMP IT ITSELF. This is what stops a response
  --     time being edited by the person it measures.
  begin
    update public.crm_leads set first_contacted_at = now() where id = v_lead;
    raise exception '116 · a session was allowed to write first_contacted_at directly';
  exception when insufficient_privilege then
    null;
  end;

  -- 7 · Nor move the lead to another project, nor rewrite what Meta captured.
  begin
    update public.crm_leads set project_id = v_project where id = v_lead;
    raise exception '116 · a session was allowed to refile a lead';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.crm_leads set phone = '03111111111' where id = v_lead;
    raise exception '116 · a session was allowed to rewrite the number Meta captured';
  exception when insufficient_privilege then
    null;
  end;

  -- 8 · ⚠️ AND CANNOT CLAIM A DEAL CLOSED. The log is append-only and reports
  --     read it, so a forged `won` row could never be taken back out.
  begin
    insert into public.crm_lead_activity (lead_id, actor_id, kind)
    values (v_lead, v_admin, 'won');
    raise exception '116 · a session was allowed to log a win it did not make';
  exception when insufficient_privilege then
    /* ⚠️ `insufficient_privilege` (42501), NOT `check_violation`. A refusal by a
       policy's WITH CHECK and a refusal by a CHECK constraint read almost the
       same in English and are different SQLSTATEs; catching the wrong one here
       let the real error escape and failed a migration whose policy was working
       exactly as intended. */
    null;
  end;

  -- 9 · A note writes its own row, pointing at itself rather than copying itself.
  insert into public.crm_lead_notes (lead_id, author_id, body)
  values (v_lead, v_admin, '116 self-check note — quoted 5 marla')
  returning id into v_note;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'note_added' and (detail->>'note_id')::uuid = v_note;
  if n <> 1 then
    raise exception '116 · a note did not write its own timeline row';
  end if;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'note_added' and detail::text like '%5 marla%';
  if n <> 0 then
    raise exception '116 · the timeline copied the note body instead of pointing at it';
  end if;

  -- 10 · Marking lost closes it and keeps the reason; reopening drops both.
  update public.crm_leads set stage = 'lost', lost_reason = 'wrong_number' where id = v_lead;

  select closed_at, lost_reason::text into v_closed, v_reason
    from public.crm_leads where id = v_lead;
  if v_closed is null then
    raise exception '116 · a lost lead was not closed';
  end if;
  if v_reason <> 'wrong_number' then
    raise exception '116 · the lost reason did not survive being set';
  end if;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'lost' and outcome = 'wrong_number';
  if n <> 1 then
    raise exception '116 · marking a lead lost did not write a `lost` row carrying the reason';
  end if;

  update public.crm_leads set stage = 'contacted' where id = v_lead;

  select closed_at, lost_reason::text into v_closed, v_reason
    from public.crm_leads where id = v_lead;
  if v_closed is not null then
    raise exception '116 · a reopened lead is still closed';
  end if;
  if v_reason is not null then
    raise exception
      '116 · a reopened lead still says why it was lost; the lost-reason report would count it';
  end if;

  -- 11 · Temperature and next action each say so once.
  update public.crm_leads set temperature = 'hot' where id = v_lead;
  update public.crm_leads
     set next_action = 'call back Friday', next_action_at = now() + interval '2 days'
   where id = v_lead;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'temperature_set' and outcome = 'hot';
  if n <> 1 then
    raise exception '116 · marking a lead hot wrote % rows, expected 1', n;
  end if;

  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind = 'next_action_set' and outcome = 'call back Friday';
  if n <> 1 then
    raise exception '116 · setting the next action wrote % rows, expected 1', n;
  end if;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_lead_notes     where id = v_note;
  delete from public.crm_leads          where id = v_lead;

  raise notice '116 · the timeline writes itself, response time is stamped from occurred_at, and a session can change five columns';
end $$;
