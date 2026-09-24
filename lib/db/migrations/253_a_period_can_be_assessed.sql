-- ============================================================================
-- 253 · A PERIOD CAN BE ASSESSED, AND THE PERSON SEES IT WHEN IT IS FINISHED
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-24, with the Performance history reference: an "Assessment
-- record" card (reviewer, state, strengths, improvement areas, the employee's
-- own response, evidence links), an "Agreed follow-up" card (goal, acceptance
-- checklist, baseline, target, review date, owner, support) and a "Review
-- visibility" card that states the rule in words:
--
--     Published review (employee visible) — becomes visible to Abdul Moiz
--     after it is finalized.
--     Private draft (only admins and reviewers) — current draft is not
--     visible to the employee.
--
-- ── ⚠️ EVERY OTHER PANEL ON THAT PAGE IS DERIVED. THIS ONE CANNOT BE ──────
-- Completed, on-time, overdue-at-cutoff and reviewed all come out of `tasks`
-- and `activity_log`. An assessment is two people's words about a period and a
-- thing they agreed to do next. Nothing computes that, and drawing those three
-- cards as empty frames is exactly the "stuffing with a lot of things but
-- nothing meaningful" the owner has objected to twice. So it is stored.
--
-- ── ⚠️ ONE TABLE, NOT THREE ───────────────────────────────────────────────
-- The follow-up is not a separate object with its own life: it is what was
-- agreed IN this review, for this period. Splitting it into `performance_goals`
-- would buy a join and an orphan state — a goal whose review was deleted — for
-- nothing. The Goals tab reads the newest row per person.
--
-- ── ⚠️ THE SUBJECT MAY ANSWER, AND MAY NOT EDIT ───────────────────────────
-- RLS cannot restrict a policy to particular COLUMNS, so the policy lets the
-- subject through and a trigger decides what they may change: their own
-- response, and only once the review is published. Everything else raises.
-- The same trigger is why nobody can assess themselves — a coordinator who is
-- the subject of a row is still a subject, not a reviewer.
--
-- ── ⚠️ POLICY DDL WAS BLOCKED WHEN 250 WAS WRITTEN. IT IS NOT NOW ─────────
-- Migration 250 had to route everything through SECURITY DEFINER functions
-- because a stuck `CREATE INDEX CONCURRENTLY` on `storage.objects` held every
-- relation that has policies (T-07). Checked again before writing this, on a
-- throwaway table: create policy / drop policy both returned immediately. So
-- this migration uses ordinary policies, which is the readable form.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE STATES
-- ----------------------------------------------------------------------------
-- draft     — being written. The subject cannot see it.
-- reviewed  — the reviewer is done; still not the subject's to see. This is the
--             step where a second manager reads it before it is handed over.
-- published — final. The subject sees it and may write their response.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'assessment_state') then
    create type public.assessment_state as enum ('draft', 'reviewed', 'published');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2 · THE RECORD
-- ----------------------------------------------------------------------------
create table if not exists public.performance_assessments (
  id uuid primary key default gen_random_uuid(),

  /* Who it is about. Cascade: a deleted person takes their reviews. */
  subject_id uuid not null references public.users(id) on delete cascade,

  /* ⚠️ THE PERIOD IS STORED AS ITS DATES, NOT AS "2026-W38". A week label is a
     locale and an ISO-week convention away from being a different week, and
     this row is read back months later. The label is computed for display. */
  period_kind text not null check (period_kind in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  constraint performance_assessments_period_order check (period_end >= period_start),

  reviewer_id uuid references public.users(id) on delete set null,
  state public.assessment_state not null default 'draft',

  /* The manager's two halves, in the reference's own words. */
  strengths text not null default '',
  improvement_areas text not null default '',

  /* The subject's reply. Theirs alone to write — see the trigger. */
  employee_response text not null default '',

  /* ── The agreed follow-up ─────────────────────────────────────────────── */
  goal text not null default '',
  /* Each line of the acceptance checklist. */
  acceptance text[] not null default '{}',
  baseline text not null default '',
  target text not null default '',
  review_date date,
  owner_id uuid references public.users(id) on delete set null,
  support text not null default '',

  created_by_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,

  /* One assessment per person per period. A second one for the same week is a
     mistake, not a revision. */
  constraint performance_assessments_once unique (subject_id, period_start, period_end)
);

create index if not exists performance_assessments_subject_idx
  on public.performance_assessments (subject_id, period_start desc);

-- ----------------------------------------------------------------------------
-- 3 · WHAT THE SUBJECT MAY CHANGE
-- ----------------------------------------------------------------------------
-- ⚠️ `to_jsonb(new) - 'employee_response' - 'updated_at'` rather than a column
-- list. A column added later would silently become editable under a list; this
-- way a new column is protected the moment it exists.
create or replace function app.guard_performance_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    /* Nobody assesses themselves. The insert policy already says so through
       `users_the_caller_outranks()`; this is the same sentence at the table, so
       it holds for the owner connection and the nightly runner too. */
    if new.subject_id = app.current_user_id() then
      raise exception 'An assessment cannot be written about yourself.' using errcode = '42501';
    end if;
    if new.state = 'published' then
      new.published_at := now();
    end if;
    return new;
  end if;

  new.updated_at := now();

  if new.subject_id = app.current_user_id() then
    /* The subject is answering. Two rules. */
    if old.state <> 'published' then
      raise exception 'This review has not been published yet.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - 'employee_response' - 'updated_at')
       is distinct from (to_jsonb(old) - 'employee_response' - 'updated_at') then
      raise exception 'A published review can be answered, not edited.' using errcode = '42501';
    end if;
    return new;
  end if;

  /* A reviewer. Publishing stamps the moment; un-publishing clears it, because
     a published_at on a draft would make the history lie. */
  if new.state = 'published' and old.state <> 'published' then
    new.published_at := now();
  elsif new.state <> 'published' then
    new.published_at := null;
  end if;

  return new;
end
$fn$;

drop trigger if exists performance_assessments_guard on public.performance_assessments;
create trigger performance_assessments_guard
  before insert or update on public.performance_assessments
  for each row execute function app.guard_performance_assessment();

-- ----------------------------------------------------------------------------
-- 4 · WHO SEES IT
-- ----------------------------------------------------------------------------
alter table public.performance_assessments enable row level security;

-- ⚠️ `(select app.fn())` — an InitPlan, computed once per statement and reused
-- as a constant, not a function call per row. CLAUDE.md law 5; the argument-free
-- set helper `users_the_caller_outranks()` exists for exactly this and was
-- added by 252.
--
-- ⚠️ AND IT MUST BE WRAPPED IN `coalesce(…, '{}'::uuid[])`. `= any ((select f()))`
-- does not compile: the parser reads a parenthesised SELECT in ANY position as a
-- subquery of ROWS, so it compares uuid with uuid[] and raises "operator does not
-- exist". 252 records the same trap in its own comments, and this migration hit
-- it anyway.
drop policy if exists performance_assessments_select on public.performance_assessments;
create policy performance_assessments_select
  on public.performance_assessments
  for select
  using (
    (select app.acting_at_least('team_coordinator'::public.user_role))
    or (subject_id = (select app.current_user_id()) and state = 'published')
  );

drop policy if exists performance_assessments_insert on public.performance_assessments;
create policy performance_assessments_insert
  on public.performance_assessments
  for insert
  with check (subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[])));

-- The subject is let through so they can answer; the trigger decides what they
-- may actually change.
drop policy if exists performance_assessments_update on public.performance_assessments;
create policy performance_assessments_update
  on public.performance_assessments
  for update
  using (
    subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
    or subject_id = (select app.current_user_id())
  )
  with check (
    subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
    or subject_id = (select app.current_user_id())
  );

drop policy if exists performance_assessments_delete on public.performance_assessments;
create policy performance_assessments_delete
  on public.performance_assessments
  for delete
  using ((select app.acting_at_least('admin'::public.user_role)));

-- ⚠️ THE GRANT, WHICH IS NOT THE POLICY. "permission denied for table" is a
-- missing GRANT and no amount of policy work fixes it (memory: definers hide
-- missing grants).
grant select, insert, update, delete on public.performance_assessments to cni_app;
grant execute on function app.guard_performance_assessment() to cni_app;

-- ----------------------------------------------------------------------------
-- 5 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT REFUSES TO COMMIT RATHER THAN PRINTING A TICK IT DID NOT EARN. Every
-- fixture it needs is asserted first: a check that quietly skips because it
-- could not find a member is the failure mode recorded in
-- `self-checks-that-skip-silently`, and it has shipped here before.
do $$
declare
  v_member uuid;
  v_coord uuid;
  v_row uuid;
  v_seen int;
begin
  select id into v_member from public.users where role = 'member' and is_active order by created_at limit 1;
  select id into v_coord from public.users
   where role in ('team_coordinator', 'admin', 'super_admin') and is_active order by created_at limit 1;

  if v_member is null then raise exception 'self-check needs an active member and found none'; end if;
  if v_coord is null then raise exception 'self-check needs an active coordinator or above and found none'; end if;

  -- ── As the coordinator: write a draft about the member ──────────────────
  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_coord::text, true);

  insert into public.performance_assessments
    (subject_id, period_kind, period_start, period_end, reviewer_id, state, strengths, created_by_id)
  values
    (v_member, 'week', date '1999-01-04', date '1999-01-10', v_coord, 'draft', 'self-check', v_coord)
  returning id into v_row;

  if v_row is null then raise exception 'a coordinator could not write a draft'; end if;

  -- ── As the member: the draft must be invisible ──────────────────────────
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into v_seen from public.performance_assessments where id = v_row;
  if v_seen <> 0 then
    raise exception 'THE SUBJECT CAN SEE THEIR OWN DRAFT — the visibility rule is broken';
  end if;

  -- ── A member may not write one about anybody ────────────────────────────
  begin
    insert into public.performance_assessments (subject_id, period_kind, period_start, period_end)
    values (v_coord, 'week', date '1999-01-04', date '1999-01-10');
    raise exception 'A MEMBER WROTE AN ASSESSMENT — the insert policy is broken';
  exception
    when insufficient_privilege then null;   -- the policy refused, as it must
  end;

  -- ── Publish it as the coordinator ───────────────────────────────────────
  perform set_config('app.user_id', v_coord::text, true);
  update public.performance_assessments set state = 'published' where id = v_row;

  -- ── Now the member sees it, and may answer but not edit ─────────────────
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into v_seen from public.performance_assessments where id = v_row;
  if v_seen <> 1 then
    raise exception 'THE SUBJECT CANNOT SEE THEIR PUBLISHED REVIEW — % rows', v_seen;
  end if;

  update public.performance_assessments set employee_response = 'noted' where id = v_row;

  begin
    update public.performance_assessments set strengths = 'I am wonderful' where id = v_row;
    raise exception 'THE SUBJECT EDITED THE MANAGER''S WORDS — the guard is broken';
  exception
    when insufficient_privilege then null;   -- the trigger refused, as it must
  end;

  -- ── Nobody assesses themselves ──────────────────────────────────────────
  perform set_config('app.user_id', v_coord::text, true);
  begin
    insert into public.performance_assessments (subject_id, period_kind, period_start, period_end)
    values (v_coord, 'week', date '1999-02-01', date '1999-02-07');
    raise exception 'SOMEBODY ASSESSED THEMSELVES — the guard is broken';
  exception
    when insufficient_privilege then null;
  end;

  -- ── Clean up the fixture ────────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  delete from public.performance_assessments where id = v_row;

  raise notice '253 self-check passed: draft hidden, publish visible, answer allowed, edit refused, self-assessment refused';
end $$;
