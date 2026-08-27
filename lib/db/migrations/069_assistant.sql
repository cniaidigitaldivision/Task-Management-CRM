-- ============================================================================
-- 069 · THE ASSISTANT — WHO MAY ASK, AND WHAT WAS ASKED
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26:
--
--   "I want to create an AI assistance page [...] I'm not providing this
--    facility to all of the company. This facility will only be provided to
--    upper levels, like this super admin, admin, or team coordinator [...]
--    Later on maybe I can have a radio button for each member, in the name of
--    each member, that I can switch on and off at my choice."
--
--   "Usage is very important because maybe one person uses all the credits and
--    someone didn't use it so I should have some check and balance."
--
-- ── ⚠️ WHAT THIS SCHEMA DOES NOT CONTAIN, AND WHY THAT IS THE DESIGN ────────
-- There is no cache of answers, no copy of business data, no embedding, no
-- vector column. The assistant reads the live tables through the SAME query
-- functions every screen uses, under the SAME identity, so row-level security
-- answers every question about who may see what.
--
-- That is the whole security model, and it is worth stating here because this
-- migration is where somebody would be tempted to break it. A table of
-- pre-computed answers, or a "knowledge base" mirroring the database, would be
-- a second copy of the data with none of the policies attached — and the first
-- question a Coordinator asked would read out of it. Nothing here stores an
-- answer to anything. It stores WHO ASKED, WHAT THEY ASKED, and WHAT IT COST.
--
-- ── ⚠️ THE MESSAGES TABLE HOLDS FREE TEXT FROM A LANGUAGE MODEL ────────────
-- Which is why the tool layer may never call `revealCredential`. A decrypted
-- password written into `content` would be a plaintext secret sitting in an
-- ordinary table, searchable, exportable, and outliving the moment it was
-- needed. Migration 052 removed the step-up prompt from reveals, so the audit
-- row is now the only control on one; a chat transcript would defeat even that.
-- ============================================================================

-- ── Which way a per-person switch points ────────────────────────────────────
-- Two values, not a boolean, for the reason migration 052 gives on credential
-- exclusions: a boolean column cannot tell "explicitly turned off" from "no row
-- yet", and those mean opposite things when a role default sits underneath.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'assistant_effect') then
    create type public.assistant_effect as enum ('allow', 'deny');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'assistant_role') then
    create type public.assistant_role as enum ('user', 'assistant');
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- WHO MAY ASK
-- ════════════════════════════════════════════════════════════════════════════
-- Modelled on `credential_grants` (migration 050), which is the mature
-- precedent in this schema for "an Admin decided this person may do this".
create table if not exists public.assistant_access (
  user_id uuid primary key
    references public.users(id) on delete cascade,

  effect public.assistant_effect not null,

  -- ⚠️ NOT nullable and NOT `on delete set null`. "Who decided this person may
  -- interrogate the division's data" is the entire value of the row after the
  -- fact. `restrict` is safe here because users are deactivated, never deleted.
  granted_by_id uuid not null
    references public.users(id) on delete restrict,

  granted_at timestamptz not null default now(),
  note text
);

comment on table public.assistant_access is
  'Per-person override for assistant access. A row WINS over the role default: '
  'an `allow` row turns a Member on, a `deny` row turns one Coordinator off. No '
  'row means "use the role default" (assistant.use — Coordinator and above).';

alter table public.assistant_access enable row level security;

-- ⚠️ A person may read their OWN row — that is what lets the launcher decide
-- whether to render for them without asking an Admin-only question.
create policy assistant_access_select on public.assistant_access
  for select to cni_app
  using (user_id = app.current_user_id() or app.acting_at_least('admin'));

-- ⚠️ `granted_by_id = app.current_user_id()` — a row must name its author
-- honestly. Without this half an Admin could write somebody else's name into
-- the one field that exists to say who is answerable.
create policy assistant_access_insert on public.assistant_access
  for insert to cni_app
  with check (app.acting_at_least('admin') and granted_by_id = app.current_user_id());

create policy assistant_access_delete on public.assistant_access
  for delete to cni_app
  using (app.acting_at_least('admin'));

-- ⚠️ NO UPDATE POLICY HERE — AND THAT TURNED OUT TO BE WRONG. SEE 070 AND 071.
-- The intent was that a grant could not be quietly edited to point at a
-- different author. The mechanism was mistaken: withholding the policy does not
-- prevent re-authoring, it prevents `insert ... on conflict do update` from
-- running at all, so the owner's on/off switch was dead for anybody who already
-- had a row. Migration 071 adds the policy with a WITH CHECK that pins
-- `granted_by_id` to the caller, which is what actually delivers the protection.
--
-- Left as written, with the correction recorded, because the reasoning is worth
-- reading before somebody removes that policy again for the same good reason.
grant select, insert, delete on public.assistant_access to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- CONVERSATIONS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.assistant_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  -- The first question, trimmed. Written by the app, never by the model.
  title      text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_threads_by_user
  on public.assistant_threads (user_id, updated_at desc);

alter table public.assistant_threads enable row level security;

-- ⚠️ OWN THREADS ONLY, INCLUDING FOR AN ADMIN. Owner's choice, 2026-08-26:
-- admins see usage and questions, not other people's conversations. The
-- question text is exposed through `assistant_messages` below, which is a
-- narrower thing than handing over the whole thread.
create policy assistant_threads_all on public.assistant_threads
  for all to cni_app
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

grant select, insert, update, delete on public.assistant_threads to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- MESSAGES, AND WHAT EACH ONE COST
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.assistant_messages (
  id        uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,

  -- ⚠️ Denormalised from the thread on purpose. Every usage query groups by
  -- person, and the RLS predicate below reads it on every row — a join to
  -- `assistant_threads` inside a policy would recurse into that table's own
  -- policy, which is the recursion migration 005 created SECURITY DEFINER
  -- helpers to avoid. Keeping the id here means the predicate is a column test.
  user_id   uuid not null references public.users(id) on delete cascade,

  role      public.assistant_role not null,
  content   text not null,

  -- Which tools ran to produce this answer. The audit trail of an answer:
  -- without it "where did that figure come from" is unanswerable.
  tools_used text[] not null default '{}',

  -- A ChartSpec the model asked for, rendered by the app's own components.
  -- ⚠️ jsonb, written with tx.json() and never JSON.stringify — registry C-22.
  chart jsonb,

  -- ⚠️ Figures in the prose that did not appear in any tool result, from
  -- `verifyFigures`. The model is told not to compute; this records where it
  -- did anyway, so the chat can show a caveat rather than the reader trusting
  -- a fluent sentence.
  unverified_figures text[] not null default '{}',

  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  -- 6 decimal places: a single question costs around $0.015, so cents would
  -- round every message to zero and the usage total would always read $0.
  cost_usd          numeric(10, 6),
  latency_ms        integer,

  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_by_thread
  on public.assistant_messages (thread_id, created_at);

-- Usage is always "per person, over a period", so this is the shape it wants.
create index if not exists assistant_messages_usage
  on public.assistant_messages (user_id, created_at desc);

alter table public.assistant_messages enable row level security;

-- ── ⚠️ THE HISTORY RULE, AS ONE PREDICATE ──────────────────────────────────
-- Owner chose: *"Admins see usage; everyone reads their own chats."*
--
--   your own rows            → everything, both sides of the conversation
--   an Admin, role = 'user'  → everybody's QUESTIONS
--   an Admin, role = 'assistant' → nothing that is not already theirs
--
-- Expressing it here rather than in a query means the two halves cannot drift:
-- there is no way to write a SELECT that returns somebody else's answer.
create policy assistant_messages_select on public.assistant_messages
  for select to cni_app
  using (
    user_id = app.current_user_id()
    or (app.acting_at_least('admin') and role = 'user')
  );

-- ⚠️ You may only write messages as yourself. The app writes both the question
-- and the answer, but both belong to the person who asked.
create policy assistant_messages_insert on public.assistant_messages
  for insert to cni_app
  with check (user_id = app.current_user_id());

-- ⚠️ NO UPDATE POLICY. A transcript that can be edited after the fact is not a
-- transcript. Deleting your own conversation is allowed; rewriting it is not.
create policy assistant_messages_delete on public.assistant_messages
  for delete to cni_app
  using (user_id = app.current_user_id());

grant select, insert, delete on public.assistant_messages to cni_app;


-- ── Keep `updated_at` honest on a thread ───────────────────────────────────
create or replace function public.touch_assistant_thread()
returns trigger
language plpgsql
as $$
begin
  update public.assistant_threads
     set updated_at = now()
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists assistant_messages_touch_thread on public.assistant_messages;
create trigger assistant_messages_touch_thread
  after insert on public.assistant_messages
  for each row execute function public.touch_assistant_thread();


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This migration runs as the owning role, which bypasses RLS entirely, so
-- nothing tried while writing it proves what a Coordinator can see. What
-- follows asserts the SHAPE of what was created — the same self-check
-- migrations 047 and 058 end with, and for the same reason.
do $$
declare
  predicate text;
begin
  -- The history rule is the one thing here somebody could relax without
  -- noticing, so it is checked by content and not merely by existence.
  select coalesce(qual, '') into predicate
    from pg_policies
   where tablename = 'assistant_messages' and cmd = 'SELECT';

  if predicate is null or predicate = '' then
    raise exception 'assistant_messages has no select policy at all.';
  end if;

  if predicate not like '%current_user_id%' then
    raise exception 'The assistant_messages select policy does not scope to the caller.';
  end if;

  -- An Admin must be admitted to QUESTIONS only. If the role test disappears,
  -- admins can read everybody's answers and the owner's choice is silently
  -- reversed.
  if predicate like '%acting_at_least%' and predicate not like '%role%' then
    raise exception
      'The assistant_messages select policy admits an Admin without restricting '
      'to role = user. Admins may read questions, never other people''s answers.';
  end if;

  -- A transcript must not be editable.
  if exists (
    select 1 from pg_policies where tablename = 'assistant_messages' and cmd = 'UPDATE'
  ) then
    raise exception 'assistant_messages has an UPDATE policy. A transcript is not editable.';
  end if;

  -- ⚠️ The check that USED to be here asserted `assistant_access` had no UPDATE
  -- policy. Migration 071 adds one — deliberately, because the upsert cannot
  -- run without it — so that assertion would now fail on a fresh install and
  -- block the whole schema. What matters is not the policy's absence but its
  -- WITH CHECK, and 071 asserts that instead.

  raise notice 'Assistant: own threads, own answers, admins see questions only.';
end $$;
