-- ============================================================================
-- 254 · A GOAL IS AGREED WITH SOMEBODY, AND CHECKED IN ON
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25, with the Goals & development reference: agreed goals with
-- a baseline, a target and a current value; a check-in history with a progress
-- note and evidence; the employee's own comments and the manager's reply; and
-- "Mark achieved", which the reference itself says is only available "once
-- target is met and evidence is present".
--
-- ── ⚠️ WHY THIS IS NOT THE FOLLOW-UP ON `performance_assessments` ─────────
-- 253 stores ONE agreed follow-up per review period, because that is what is
-- agreed in that review. The reference here is a different object: several
-- goals live at once, each with its own due date, its own running value and its
-- own check-in history that outlives any one week's review. Squeezing three
-- goals into one review row would mean a goal disappearing when the period
-- rolled over, which is the opposite of what a goal is for.
--
-- ── ⚠️ THE EMPLOYEE SEES THEIR GOALS. A DRAFT REVIEW THEY DO NOT ──────────
-- The visibility rule here is deliberately NOT the one in 253. A review is
-- written about somebody and published to them when it is finished; a goal is
-- agreed WITH them, and one they cannot see is not a goal. So the subject reads
-- their goals from the moment one exists, adds check-ins against them and
-- comments on them — and may not move the target, which is the manager's.
--
-- ── ⚠️ `subject_id` IS DENORMALISED ONTO CHECK-INS AND COMMENTS ───────────
-- Law 5. The natural predicate for a check-in is "may I see its goal", which is
-- a subquery per row. Carrying the subject on the child row makes every policy
-- a column comparison against a set computed once per statement. A trigger
-- copies it from the goal so it cannot drift, and the column is refused if a
-- caller tries to set it themselves.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE STATES
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type public.goal_status as enum ('not_started', 'in_progress', 'achieved', 'archived');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2 · THE GOAL
-- ----------------------------------------------------------------------------
create table if not exists public.performance_goals (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.users(id) on delete cascade,

  title text not null,

  /* ⚠️ THREE NUMBERS ON ONE SCALE, plus the words for what is being counted.
     The reference shows "60% → 80%, currently 70% (7/10)" and also "0/10 →
     10/10". Both are a baseline, a target and a running value; only the unit
     and the sentence differ, so the sentence is stored rather than a second
     shape being invented for it. */
  baseline numeric not null default 0,
  target numeric not null default 0,
  /* '%', 'tasks', '' — appended to a figure when it is written out. */
  unit text not null default '',
  /* "reviewed submissions accepted first pass" */
  measure text not null default '',

  due_date date,
  next_checkin_on date,
  status public.goal_status not null default 'not_started',

  /* "Agreed actions" — one per line in the reference. */
  actions text[] not null default '{}',

  set_by_id uuid references public.users(id) on delete set null,
  agreed_on date not null default ((now() at time zone 'Asia/Karachi')::date),
  project_id uuid references public.projects(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_goals_title_present check (length(btrim(title)) > 0)
);

create index if not exists performance_goals_subject_idx
  on public.performance_goals (subject_id, status, due_date);

-- ----------------------------------------------------------------------------
-- 3 · THE CHECK-IN, AND THE CONVERSATION
-- ----------------------------------------------------------------------------
create table if not exists public.goal_checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.performance_goals(id) on delete cascade,
  /* Copied from the goal by a trigger; see the file header. */
  subject_id uuid not null references public.users(id) on delete cascade,

  on_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  by_id uuid references public.users(id) on delete set null,
  note text not null default '',
  /* Where the goal stood at this check-in. Null when the note is not a number. */
  value numeric,
  evidence_label text not null default '',
  evidence_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists goal_checkins_goal_idx
  on public.goal_checkins (goal_id, on_date desc, created_at desc);

create table if not exists public.goal_comments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.performance_goals(id) on delete cascade,
  subject_id uuid not null references public.users(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  body text not null,
  /* A manager's reply hangs off the comment it answers. */
  parent_id uuid references public.goal_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint goal_comments_body_present check (length(btrim(body)) > 0)
);

create index if not exists goal_comments_goal_idx
  on public.goal_comments (goal_id, created_at);

-- ----------------------------------------------------------------------------
-- 4 · THE SUBJECT IS THE GOAL'S, NEVER THE CALLER'S TO CHOOSE
-- ----------------------------------------------------------------------------
create or replace function app.goal_child_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_subject uuid;
begin
  select g.subject_id into v_subject
    from public.performance_goals g
   where g.id = new.goal_id;

  if v_subject is null then
    raise exception 'That goal does not exist.' using errcode = '23503';
  end if;

  /* ⚠️ OVERWRITTEN, NOT VALIDATED. A caller who sends somebody else's id is not
     refused with a message that tells them the id was wrong; it is simply set
     to the truth. There is no version of this where the client decides. */
  new.subject_id := v_subject;
  return new;
end
$fn$;

drop trigger if exists goal_checkins_subject on public.goal_checkins;
create trigger goal_checkins_subject
  before insert or update on public.goal_checkins
  for each row execute function app.goal_child_subject();

drop trigger if exists goal_comments_subject on public.goal_comments;
create trigger goal_comments_subject
  before insert or update on public.goal_comments
  for each row execute function app.goal_child_subject();

create or replace function app.touch_performance_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

drop trigger if exists performance_goals_touch on public.performance_goals;
create trigger performance_goals_touch
  before update on public.performance_goals
  for each row execute function app.touch_performance_goal();

-- ----------------------------------------------------------------------------
-- 5 · WHO SEES AND WHO WRITES
-- ----------------------------------------------------------------------------
alter table public.performance_goals enable row level security;
alter table public.goal_checkins enable row level security;
alter table public.goal_comments enable row level security;

-- ⚠️ `(select app.fn())` is an InitPlan — computed once per statement, not per
-- row (CLAUDE.md law 5). `= any (coalesce((select …), '{}'::uuid[]))` is the
-- form that compiles: a bare `= any ((select …))` is parsed as a subquery of
-- rows and raises "operator does not exist: uuid = uuid[]". 252 records that
-- trap and 253 hit it anyway.
drop policy if exists performance_goals_select on public.performance_goals;
create policy performance_goals_select on public.performance_goals
  for select using (
    (select app.acting_at_least('team_coordinator'::public.user_role))
    or subject_id = (select app.current_user_id())
  );

drop policy if exists performance_goals_insert on public.performance_goals;
create policy performance_goals_insert on public.performance_goals
  for insert with check (
    subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
  );

drop policy if exists performance_goals_update on public.performance_goals;
create policy performance_goals_update on public.performance_goals
  for update
  using (subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[])))
  with check (subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[])));

drop policy if exists performance_goals_delete on public.performance_goals;
create policy performance_goals_delete on public.performance_goals
  for delete using ((select app.acting_at_least('admin'::public.user_role)));

-- ── Check-ins: the person doing the work reports on it ──────────────────────
drop policy if exists goal_checkins_select on public.goal_checkins;
create policy goal_checkins_select on public.goal_checkins
  for select using (
    (select app.acting_at_least('team_coordinator'::public.user_role))
    or subject_id = (select app.current_user_id())
  );

drop policy if exists goal_checkins_insert on public.goal_checkins;
create policy goal_checkins_insert on public.goal_checkins
  for insert with check (
    subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
    or subject_id = (select app.current_user_id())
  );

drop policy if exists goal_checkins_delete on public.goal_checkins;
create policy goal_checkins_delete on public.goal_checkins
  for delete using ((select app.acting_at_least('admin'::public.user_role)));

-- ── Comments: both sides talk ───────────────────────────────────────────────
drop policy if exists goal_comments_select on public.goal_comments;
create policy goal_comments_select on public.goal_comments
  for select using (
    (select app.acting_at_least('team_coordinator'::public.user_role))
    or subject_id = (select app.current_user_id())
  );

drop policy if exists goal_comments_insert on public.goal_comments;
create policy goal_comments_insert on public.goal_comments
  for insert with check (
    (subject_id = any (coalesce((select app.users_the_caller_outranks()), '{}'::uuid[]))
     or subject_id = (select app.current_user_id()))
    /* ⚠️ AND YOU MAY ONLY SIGN YOUR OWN NAME. */
    and author_id = (select app.current_user_id())
  );

drop policy if exists goal_comments_delete on public.goal_comments;
create policy goal_comments_delete on public.goal_comments
  for delete using (
    author_id = (select app.current_user_id())
    or (select app.acting_at_least('admin'::public.user_role))
  );

grant select, insert, update, delete on public.performance_goals to cni_app;
grant select, insert, delete on public.goal_checkins to cni_app;
grant select, insert, delete on public.goal_comments to cni_app;
grant execute on function app.goal_child_subject() to cni_app;
grant execute on function app.touch_performance_goal() to cni_app;

-- ----------------------------------------------------------------------------
-- 6 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ It asserts its fixtures before it tests anything. A check that quietly
-- skips because it could not find a member prints a tick it never earned.
do $$
declare
  v_member uuid;
  v_coord uuid;
  v_goal uuid;
  v_check uuid;
  v_seen int;
begin
  select id into v_member from public.users where role = 'member' and is_active order by created_at limit 1;
  select id into v_coord from public.users
   where role in ('team_coordinator', 'admin', 'super_admin') and is_active order by created_at limit 1;

  if v_member is null then raise exception 'self-check needs an active member and found none'; end if;
  if v_coord is null then raise exception 'self-check needs an active coordinator or above and found none'; end if;

  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_coord::text, true);

  insert into public.performance_goals (subject_id, title, baseline, target, unit, set_by_id)
  values (v_member, 'self-check goal', 0, 10, '', v_coord)
  returning id into v_goal;

  -- ── The subject sees their own goal, unlike a draft review ──────────────
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into v_seen from public.performance_goals where id = v_goal;
  if v_seen <> 1 then
    raise exception 'THE SUBJECT CANNOT SEE THEIR OWN GOAL — % rows', v_seen;
  end if;

  -- ── They may report progress ────────────────────────────────────────────
  insert into public.goal_checkins (goal_id, note, value, by_id)
  values (v_goal, 'halfway', 5, v_member)
  returning id into v_check;

  -- ── And the subject on the child row is the GOAL'S, whatever was sent ───
  perform set_config('app.user_id', v_coord::text, true);
  insert into public.goal_checkins (goal_id, subject_id, note, by_id)
  values (v_goal, v_coord, 'manager note', v_coord);
  if exists (select 1 from public.goal_checkins where goal_id = v_goal and subject_id <> v_member) then
    raise exception 'A CHECK-IN KEPT A CALLER-SUPPLIED SUBJECT — the trigger is broken';
  end if;

  -- ── A member may not move the target ────────────────────────────────────
  perform set_config('app.user_id', v_member::text, true);
  begin
    update public.performance_goals set target = 1 where id = v_goal;
    if found then
      raise exception 'A MEMBER MOVED THEIR OWN TARGET — the update policy is broken';
    end if;
  exception
    when insufficient_privilege then null;
  end;
  if (select target from public.performance_goals where id = v_goal) <> 10 then
    raise exception 'A MEMBER MOVED THEIR OWN TARGET — the update policy is broken';
  end if;

  -- ── A member may not write a goal for somebody else ─────────────────────
  begin
    insert into public.performance_goals (subject_id, title, set_by_id)
    values (v_coord, 'self-check forbidden', v_member);
    raise exception 'A MEMBER SET A GOAL FOR THEIR MANAGER — the insert policy is broken';
  exception
    when insufficient_privilege then null;
  end;

  -- ── A comment must be signed by its author ──────────────────────────────
  begin
    insert into public.goal_comments (goal_id, author_id, body)
    values (v_goal, v_coord, 'pretending to be the manager');
    raise exception 'A COMMENT WAS SIGNED WITH SOMEBODY ELSE''S NAME';
  exception
    when insufficient_privilege then null;
  end;

  insert into public.goal_comments (goal_id, author_id, body)
  values (v_goal, v_member, 'a fair point');

  perform set_config('role', 'postgres', true);
  delete from public.performance_goals where id = v_goal;

  raise notice '254 self-check passed: subject reads and checks in, target and authorship refused, child subject forced';
end $$;
