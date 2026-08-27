-- ============================================================================
-- 072 · WHAT THE ASSISTANT COSTS, PER PERSON
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-26:
--
--   "Usage is very important because maybe one person uses all the credits and
--    someone didn't use it so I should have some check and balance."
--
-- Owner, 2026-08-27, on the activity screen:
--
--   "make a button on the top right of this page where I can see who is asking,
--    the spend, our views, and all these types of things."
--
-- ── ⚠️ THE PROBLEM THIS SOLVES, AND WHY IT IS NOT A POLICY CHANGE ───────────
-- Migration 069 decided the history rule: an Admin reads everybody's QUESTIONS
-- and nobody else's ANSWERS. That is still right and is not touched here.
--
-- But the token counts and the dollar cost live on the ANSWER row. So the rule
-- had a consequence nobody chose: the person who asked for a check on the
-- credits could see only their OWN spend, and the screen had to say so. A
-- "usage" page that reports one person's usage does not answer the question it
-- exists to answer.
--
-- The two requirements are not actually in conflict, because they are about
-- different things:
--
--   · the CONTENT of an answer  → private to the asker. Unchanged.
--   · what an answer COST       → operational metadata. The owner pays for it.
--
-- So instead of widening the select policy — which would hand over the prose
-- along with the numbers — this adds one narrow, SECURITY DEFINER function that
-- returns AGGREGATES ONLY: a row per person with counts, tokens, cost and a
-- last-asked timestamp. There is no way to reach a word of `content` through
-- it, at any grouping, because `content` is not in the return type.
--
-- ── ⚠️ WHY A FUNCTION RATHER THAN A VIEW ────────────────────────────────────
-- A view would need `security_invoker = false` to see past the policy, at which
-- point it is a definer with none of the guard rails, and the rank check would
-- have to be a WHERE clause somebody could later "optimise" away. A function
-- can REFUSE, loudly, before it reads anything — and the refusal is asserted at
-- the bottom of this file.
--
-- ⚠️ `search_path` is pinned. A definer function without it is the classic
-- privilege-escalation hole: a caller who can create a schema on their own
-- search path can shadow `public.assistant_messages` and have the elevated
-- function read their table instead.
-- ============================================================================

create or replace function app.assistant_spend(from_date date, to_date date)
  returns table (
    user_id           uuid,
    asks              integer,
    prompt_tokens     integer,
    completion_tokens integer,
    cost_usd          numeric,
    last_at           timestamptz
  )
  language plpgsql
  security definer
  set search_path = public, app, pg_temp
as $$
begin
  -- ⚠️ FIRST STATEMENT, BEFORE ANY READ. `acting_at_least` is null-safe: a
  -- session with no `app.user_id` set yields false, so an unidentified caller
  -- is refused rather than admitted by an unset variable.
  if not app.acting_at_least('admin') then
    raise exception 'Only an Admin may read assistant spend.'
      using errcode = '42501';
  end if;

  return query
    select m.user_id,
           count(*)::int,
           coalesce(sum(m.prompt_tokens), 0)::int,
           coalesce(sum(m.completion_tokens), 0)::int,
           coalesce(sum(m.cost_usd), 0)::numeric,
           max(m.created_at)
      from public.assistant_messages m
     -- ⚠️ The ANSWER rows, not the questions. A question costs nothing until it
     -- is answered, and only the reply carries the token counts — counting
     -- `role = 'user'` would give the right number of asks and a cost of zero.
     where m.role = 'assistant'
       and m.created_at >= from_date
       and m.created_at < (to_date + 1)
     group by m.user_id;
end $$;

comment on function app.assistant_spend(date, date) is
  'Per-person assistant cost over a period. Admin only, aggregates only — no '
  'message content is reachable through it. Exists because token counts live on '
  'the answer row, which migration 069 keeps private to the asker; the owner is '
  'entitled to what it cost without being entitled to what it said.';

revoke execute on function app.assistant_spend(date, date) from public;
grant  execute on function app.assistant_spend(date, date) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- PROVE IT REFUSES, RATHER THAN ASSUMING
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ This migration runs as the owning role, which bypasses RLS — so nothing
-- tried here proves what a Coordinator sees through a POLICY. It does prove
-- this function's own guard, because the guard reads `app.user_id`, which is
-- unset in a migration session. That makes the migration itself a caller with
-- no identity, which is the case that must be refused.
do $$
begin
  perform 1 from app.assistant_spend(current_date, current_date);
  raise exception 'app.assistant_spend answered a caller with no identity.';
exception
  when insufficient_privilege then
    raise notice 'assistant_spend refuses a caller who is not an Admin.';
end $$;

-- And the return type carries no content column, checked by name rather than by
-- reading the body — a later edit that adds `content` to the select would have
-- to add it here too, and this is where that gets stopped.
do $$
begin
  if exists (
    select 1
      from information_schema.parameters
     where specific_schema = 'app'
       and specific_name like 'assistant_spend%'
       and parameter_mode = 'TABLE'
       and parameter_name in ('content', 'question', 'answer', 'title')
  ) then
    raise exception
      'app.assistant_spend returns message text. It may return aggregates only.';
  end if;

  raise notice 'Assistant spend: admin-only, aggregates only.';
end $$;
