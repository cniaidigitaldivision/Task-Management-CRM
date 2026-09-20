-- ============================================================================
-- 226 · WHAT THE AGENT IS ALLOWED TO SAY
-- ----------------------------------------------------------------------------
-- The fence `docs/crm-ai/02-KNOWLEDGE-AND-GROUNDING.md` describes, built:
-- **every factual claim the agent makes must trace to a row somebody approved.**
--
-- Owner, 2026-09-20: *"any proposals, any quotations, or any document… you have
-- to read them all. You will get basic knowledge about everything."* and
-- *"give me some chatbot or something like that where I can guide, instruct, or
-- give knowledge to my AI agent."*
--
-- Two tables, because the owner's own two examples are not the same kind of
-- thing and must never share a drawer:
--
--   `crm_knowledge`      — FACT.  "What is included in the CRM package?"
--                          Extracted from a document, approved by a person.
--   `crm_pilot_rules`    — STYLE. "Call them sir or ma'am, never by name."
--                          Written by ONE salesperson, for their own threads.
--
-- ── ⚠️ WHY THE SEPARATION IS THE SAFETY, NOT THE TIDINESS ──────────────────
-- The owner's Meta example is a style instruction: *"Next time please call every
-- client with sir or ma'am."* Harmless. But a salesperson typing *"tell them
-- it'll be ready in a month"* into the same box would become a promise the agent
-- repeats to every client, sourced from nothing. A style rule can never become a
-- fact here: `crm_pilot_rules` is injected as tone and is explicitly fenced in
-- the prompt, and only `crm_knowledge` may be cited.
-- ============================================================================

create type public.crm_knowledge_status as enum ('draft', 'approved', 'rejected');

create table public.crm_knowledge (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  question text not null check (btrim(question) <> ''),
  answer   text not null check (btrim(answer) <> ''),

  /* ⚠️ WHERE IT CAME FROM, OR IT CANNOT BE TRUSTED LATER. An answer whose
     source nobody can find is an answer nobody can check when a client disputes
     it. `source_quote` is the sentence the document actually said, kept
     verbatim — it is what the approval screen shows beside the answer. */
  source_document_id uuid references public.crm_documents(id) on delete set null,
  source_quote text,

  status public.crm_knowledge_status not null default 'draft',
  approved_by_id uuid references public.users(id) on delete set null,
  approved_at timestamptz,

  /* ⚠️ AN ENTRY WITH NO EXPIRY BECOMES A LIE ON A SCHEDULE. "Delivery in eight
     weeks" was true when written and is a complaint two quarters later. Null is
     allowed for things that do not date ("what is a CRM"), so this is a prompt
     to think, not a tax on every row. */
  expires_at date,

  created_by_id uuid references public.users(id) on delete set null,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_knowledge is
  'The only source the AI agent may state a fact from. Nothing is usable until a person approves it; an expired row stops being usable on its own.';

create index crm_knowledge_project_idx on public.crm_knowledge (project_id, status);

/* ⚠️ THE SAME QUESTION TWICE IS TWO ANSWERS THAT WILL DISAGREE. Normalised so
   "What is included?" and "what is included" are one row. */
create unique index crm_knowledge_one_question_idx
  on public.crm_knowledge (project_id, lower(regexp_replace(btrim(question), '[^a-zA-Z0-9]+', ' ', 'g')));

alter table public.crm_knowledge enable row level security;

create policy crm_knowledge_select on public.crm_knowledge
  for select using (app.crm_is_open_to_caller());

create policy crm_knowledge_insert on public.crm_knowledge
  for insert with check (app.crm_is_open_to_caller());

create policy crm_knowledge_update on public.crm_knowledge
  for update using (app.crm_is_open_to_caller())
  with check (app.crm_is_open_to_caller());

/* Append-mostly, like every other record in this CRM: a wrong entry is rejected,
   which keeps it visible as a thing somebody decided. */
create policy crm_knowledge_delete on public.crm_knowledge
  for delete using (app.acting_at_least('admin'));

grant select, insert, update on public.crm_knowledge to cni_app;
grant delete on public.crm_knowledge to cni_app;


-- ── The salesperson's own pilot ─────────────────────────────────────────────
create table public.crm_pilot_rules (
  id uuid primary key default gen_random_uuid(),

  /* ⚠️ WHOSE PILOT THIS IS. Owner: *"In Sarah's dashboard he should know that
     it's Sarah's dashboard and how she wants to deal with clients… In the Saud
     dashboard he may want to deal with some other way."* So a rule belongs to a
     person, not to the business, and it only shapes that person's own threads. */
  user_id uuid not null references public.users(id) on delete cascade,

  /* Null = every project this person works. Set = only that project's threads. */
  project_id uuid references public.projects(id) on delete cascade,

  rule text not null check (btrim(rule) <> '' and length(btrim(rule)) <= 400),
  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_pilot_rules is
  'How one salesperson wants their AI agent to WRITE. Tone only — a rule here can never become a fact the agent states; that is crm_knowledge.';

create index crm_pilot_rules_user_idx on public.crm_pilot_rules (user_id, is_active);

/* ⚠️ A CEILING, SO A PROMPT CANNOT BE FILLED WITH INSTRUCTIONS. Twelve rules is
   more than anybody needs to describe how they talk, and an unbounded list is a
   way to push the knowledge out of the model's attention. */
create or replace function app.crm_pilot_rules_capped()
returns trigger
language plpgsql
as $fn$
begin
  if (select count(*) from public.crm_pilot_rules
       where user_id = new.user_id and is_active) > 12 then
    raise exception 'A pilot can hold 12 instructions. Remove one before adding another.'
      using errcode = 'P0226';
  end if;
  return null;
end;
$fn$;

create constraint trigger crm_pilot_rules_cap
  after insert or update on public.crm_pilot_rules
  deferrable initially deferred
  for each row execute function app.crm_pilot_rules_capped();

alter table public.crm_pilot_rules enable row level security;

/* ⚠️ YOUR OWN, AND YOUR TEAM'S ONLY TO READ. A manager coaching a salesperson
   has to be able to see why the agent writes the way it does; nobody but the
   owner of a pilot may change it. */
create policy crm_pilot_rules_select on public.crm_pilot_rules
  for select using (app.crm_is_open_to_caller());

create policy crm_pilot_rules_write on public.crm_pilot_rules
  for insert with check (user_id = app.current_user_id());

create policy crm_pilot_rules_update on public.crm_pilot_rules
  for update using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy crm_pilot_rules_delete on public.crm_pilot_rules
  for delete using (user_id = app.current_user_id());

grant select, insert, update, delete on public.crm_pilot_rules to cni_app;


-- ── What the agent may actually read ────────────────────────────────────────
/*
 * ⚠️ ONE DOOR, AND IT IS NARROW ON PURPOSE. The agent never selects from
 * `crm_knowledge` itself; it asks this, which can only ever return entries that
 * are approved AND unexpired. A filter written at each call site is a filter
 * somebody will forget at one of them.
 */
create or replace function app.crm_knowledge_for(p_project uuid)
returns table(question text, answer text, source_quote text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select k.question, k.answer, k.source_quote
    from public.crm_knowledge k
   where k.project_id = p_project
     and k.status = 'approved'
     and (k.expires_at is null or k.expires_at >= (now() at time zone 'Asia/Karachi')::date)
   order by k.question
$fn$;

grant execute on function app.crm_knowledge_for(uuid) to cni_app;

create or replace function app.crm_pilot_rules_for(p_user uuid, p_project uuid default null)
returns table(rule text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select r.rule
    from public.crm_pilot_rules r
   where r.user_id = p_user
     and r.is_active
     and (r.project_id is null or p_project is null or r.project_id = p_project)
   order by r.sort_order, r.created_at
$fn$;

grant execute on function app.crm_pilot_rules_for(uuid, uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_other uuid;
  n_live int; n_all int; n_rules int; v_capped boolean := false;
  i int;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  select u.id into v_other
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.id <> v_owner limit 1;
  if v_project is null or v_owner is null then
    raise exception '226 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_knowledge (project_id, question, answer, status, is_test_data)
    values
      (v_project, 'SELFCHECK approved', 'yes', 'approved', true),
      (v_project, 'SELFCHECK draft', 'not yet', 'draft', true),
      (v_project, 'SELFCHECK rejected', 'no', 'rejected', true);

    /* ⚠️ AND ONE THAT HAS GONE OUT OF DATE. */
    insert into public.crm_knowledge (project_id, question, answer, status, expires_at, is_test_data)
    values (v_project, 'SELFCHECK expired', 'was true in June', 'approved',
            (now() at time zone 'Asia/Karachi')::date - 1, true);

    select count(*)::int into n_live from app.crm_knowledge_for(v_project)
     where question like 'SELFCHECK%';
    select count(*)::int into n_all from public.crm_knowledge
     where project_id = v_project and question like 'SELFCHECK%';

    /* The pilot: one person's rules are their own. */
    insert into public.crm_pilot_rules (user_id, rule)
    values (v_owner, 'Always say sir or ma''am, never the first name.');
    select count(*)::int into n_rules from app.crm_pilot_rules_for(v_owner);

    /* ⚠️ AND THE CAP HOLDS. Deferred, so it fires at the end of this block. */
    begin
      for i in 1 .. 20 loop
        insert into public.crm_pilot_rules (user_id, rule) values (v_owner, 'rule ' || i);
      end loop;
      /* Force the deferred constraint to fire while we can still catch it. */
      set constraints public.crm_pilot_rules_cap immediate;
    exception when sqlstate 'P0226' then
      v_capped := true;
    end;

    raise exception using errcode = 'P0227', message = '226 rollback';
  exception when sqlstate 'P0227' then
    null;
  end;

  if n_all <> 4 then
    raise exception '226 · expected 4 entries written, got %', n_all;
  end if;
  if n_live <> 1 then
    raise exception '226 · the agent could read % entries; only the approved, unexpired one is allowed', n_live;
  end if;
  if n_rules <> 1 then
    raise exception '226 · a pilot rule did not come back for its owner';
  end if;
  if not v_capped then
    raise exception '226 · a pilot accepted more than 12 instructions';
  end if;

  raise notice '226 · the agent reads only what a person approved, and a pilot holds 12 instructions';
end $chk$;
