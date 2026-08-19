-- =============================================================================
-- 036 · THE POSTING RHYTHM — cadence replaces a monthly guess
-- -----------------------------------------------------------------------------
-- Owner, 2026-08-19: *"Reels of a Month… how many reels in a week or a month?
-- Definitely depending on a week. Daily Static Post: that should be mentioned,
-- right? Daily 1 post or 2 posts or reels. If 1 reel then show a month, show a
-- week, and on which days you want."*
--
-- And: *"If that task is not completed, make it empty, like a Sunday for example:
-- there is no post. Mention that this is Sunday."*
--
-- ── ⚠️ THE CADENCE IS THE TRUTH; THE MONTHLY FIGURES ARE DERIVED ──────────────
-- Owner decision, 2026-08-19, chosen over keeping both: the division agrees a
-- RHYTHM with a client — "one static post a day, two reels a week on Monday and
-- Wednesday, Sundays off" — and the monthly total is a consequence of that rhythm
-- and the length of the month.
--
-- So `static_posts_per_day`, `reels_per_week`, `reel_days` and `posting_days` are
-- what a human enters. `assets_target_min`, `assets_target_max` and
-- `reels_target_min` from migration 033 STAY, and stay exactly where every report
-- already reads them — but they are now written by the application from the
-- cadence rather than typed. The form shows them read-only.
--
-- Why keep them at all rather than computing on read: a month has 28, 30 or 31
-- days and a variable count of Mondays, so the monthly figure is a function of the
-- month as well as the cadence. Recomputing it inside every report would make the
-- *contract* figure drift with the calendar — and the contract is what the client
-- was promised, which must not change because February is short. It is computed
-- once, at the moment somebody agrees it, and stored. That is the same principle
-- as migration 033's: the project holds what was agreed, and nothing upstream may
-- silently rewrite it.
--
-- ── WEEKDAYS ARE STORED AS ISO NUMBERS, NOT NAMES ─────────────────────────────
-- 1 = Monday … 7 = Sunday, matching `extract(isodow from …)`. Names would need a
-- locale to compare against a date, and "Sun" vs "Sunday" vs "sunday" is three
-- bugs waiting. A smallint[] compares directly against isodow in one expression.
--
-- ── WHY `posting_days` AND NOT `off_days` ─────────────────────────────────────
-- The generator asks "should something go out on this date", so it needs the days
-- that ARE working. Storing the complement would mean every read inverting a set,
-- and an empty array would be ambiguous — no off days, or no working days? As
-- posting days, empty means exactly one thing: nothing is scheduled.
-- =============================================================================

alter table public.projects
  -- Null, not 0: null is "no daily rhythm agreed", 0 would be "agreed to post
  -- nothing on a working day", which is a different and stranger claim. The same
  -- null-is-not-zero rule the target columns already follow.
  add column if not exists static_posts_per_day smallint,
  add column if not exists reels_per_week       smallint,
  -- Which weekdays reels go out. Owner: *"if it's, say, 2 reels in a week, then
  -- only 2 days of the week should be selectable"* — so the LENGTH of this array
  -- is expected to equal `reels_per_week`. Enforced below.
  add column if not exists reel_days            smallint[],
  -- The working week for this project. Defaulted to Mon–Sat because that is this
  -- division's own week; a client wanting Sunday posts ticks it on.
  add column if not exists posting_days         smallint[];

comment on column public.projects.static_posts_per_day is
  'Static posts on each posting day. Null = no daily rhythm agreed.';
comment on column public.projects.reels_per_week is
  'Reels each week. reel_days must name exactly this many weekdays.';
comment on column public.projects.reel_days is
  'ISO weekdays (1=Mon..7=Sun) reels are published on.';
comment on column public.projects.posting_days is
  'ISO weekdays (1=Mon..7=Sun) anything is published on. Days absent are off days.';

-- ── The rules, in the database rather than only in the form ───────────────────
-- A form validates one browser. A constraint validates every path in — the server
-- action, a future import, a fix somebody runs by hand at 2am.

alter table public.projects
  drop constraint if exists projects_cadence_sane;

alter table public.projects
  add constraint projects_cadence_sane check (
    (static_posts_per_day is null or static_posts_per_day between 0 and 20)
    -- ⚠️ 7, not 21. `projects_reel_days_match_count` below requires one DISTINCT
    -- weekday per reel, and there are only seven, so 8–21 was an unreachable range
    -- that no row could ever satisfy. Found by a property test asserting that a
    -- suggested cadence always passes its own validator. A range the database
    -- advertises and then refuses is worse than a narrower honest one.
    -- More than one reel on the same day is a different model — it would need a
    -- count per day rather than a set of days, and nobody has asked for it.
    and (reels_per_week is null or reels_per_week between 0 and 7)
  );

-- ⚠️ A HELPER FUNCTION, BECAUSE A CHECK CONSTRAINT MAY NOT CONTAIN A SUBQUERY.
-- The duplicate test needs `count(distinct …) from unnest(…)`, and writing that
-- inline fails with "cannot use subquery in check constraint" — which is exactly
-- how this was found. A subquery inside an IMMUTABLE function is fine, and the
-- function is what the constraint calls.
--
-- IMMUTABLE is honest here: the answer depends only on the argument. `search_path`
-- is pinned empty per the project's SECURITY-DEFINER convention, so nothing can be
-- shadowed by a caller's path.
create or replace function app.weekdays_ok(days smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select days is null
      or (
        days <@ array[1,2,3,4,5,6,7]::smallint[]
        and array_length(days, 1) = (select count(distinct d) from unnest(days) as d)
      )
$$;

comment on function app.weekdays_ok(smallint[]) is
  'True when every element is an ISO weekday 1-7 and none repeats. Called by the projects weekday constraints.';

alter table public.projects
  drop constraint if exists projects_weekdays_valid;

alter table public.projects
  add constraint projects_weekdays_valid check (
    -- Every element a real ISO weekday, and no duplicates. `Sunday twice` would
    -- make a 2-reels-a-week project generate both on the same day.
    app.weekdays_ok(reel_days) and app.weekdays_ok(posting_days)
  );

alter table public.projects
  drop constraint if exists projects_reel_days_match_count;

alter table public.projects
  add constraint projects_reel_days_match_count check (
    -- ⚠️ The owner's rule, enforced: two reels a week means exactly two named
    -- days. Not "at most" — a project claiming 2 reels with 1 day chosen would
    -- generate half of what was sold, and the shortfall would only surface in a
    -- report weeks later.
    reels_per_week is null
    or reels_per_week = 0
    or coalesce(array_length(reel_days, 1), 0) = reels_per_week
  );

alter table public.projects
  drop constraint if exists projects_reel_days_are_posting_days;

alter table public.projects
  add constraint projects_reel_days_are_posting_days check (
    -- A reel scheduled on an off day is a contradiction the generator would have
    -- to resolve by guessing. Refused here so the form has to be coherent.
    reel_days is null
    or posting_days is null
    or reel_days <@ posting_days
  );

-- ── Mon–Sat for anything that already exists ──────────────────────────────────
-- Only touches rows with nothing set, so re-running cannot overwrite a decision.
update public.projects
   set posting_days = array[1,2,3,4,5,6]::smallint[]
 where posting_days is null;

-- =============================================================================
-- SELF-CHECK
-- -----------------------------------------------------------------------------
-- ⚠️ Runs as `cni_app`, not as the migration's own role. Every check in this
-- project that ran as `postgres` proved nothing about table GRANTs — `postgres`
-- bypasses them — and `/documents` shipped broken exactly that way. The whole
-- block is one transaction that raises, so a failure aborts the migration.
-- =============================================================================
do $$
declare
  v_project uuid;
  v_user    uuid;
begin
  select id into v_user from public.users where is_active order by created_at limit 1;
  if v_user is null then
    raise notice '036 · no users yet, skipping the row-level self-check';
    return;
  end if;

  -- A coherent cadence is accepted.
  insert into public.projects
    (name, code, type, status, created_by_id, owner_id,
     static_posts_per_day, reels_per_week, reel_days, posting_days)
  values
    ('036 cadence check', 'OTH', 'other', 'planning', v_user, v_user,
     1, 2, array[1,3]::smallint[], array[1,2,3,4,5,6]::smallint[])
  returning id into v_project;

  -- 2 reels a week with 3 named days is refused.
  begin
    update public.projects set reel_days = array[1,3,5]::smallint[] where id = v_project;
    raise exception '036 · 3 reel days were accepted for 2 reels a week';
  exception when check_violation then null;
  end;

  -- A reel on a day the project does not post is refused.
  begin
    update public.projects set reel_days = array[1,7]::smallint[] where id = v_project;
    raise exception '036 · a reel was accepted on an off day';
  exception when check_violation then null;
  end;

  -- Weekday 8 does not exist.
  begin
    update public.projects set posting_days = array[1,8]::smallint[] where id = v_project;
    raise exception '036 · weekday 8 was accepted';
  exception when check_violation then null;
  end;

  -- The same day twice is refused — it would double a week's reels onto one date.
  begin
    update public.projects
       set reels_per_week = 2, reel_days = array[3,3]::smallint[]
     where id = v_project;
    raise exception '036 · a duplicated reel day was accepted';
  exception when check_violation then null;
  end;

  -- Null cadence stays legal: a project may exist before anything is agreed.
  update public.projects
     set static_posts_per_day = null, reels_per_week = null, reel_days = null
   where id = v_project;

  -- Zero reels a week needs no days, and must not trip the count rule.
  update public.projects
     set reels_per_week = 0, reel_days = null
   where id = v_project;

  delete from public.projects where id = v_project;

  raise notice '036 · cadence works: counts match their days, off days refuse reels';
end
$$;
