-- ============================================================================
-- 086 · A REPEAT IS A SERIES, AND A SERIES NEEDS A NAME
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03: *"if I say that he create a task and make it to a daily,
-- right? Or repeat daily, right? Or a repeat weekly, then set a tracker…
-- exactly 12 AM on every day that task will be generated."*
--
-- The nightly runner has to answer one question per series: DOES TODAY'S
-- INSTANCE ALREADY EXIST? Cron delivery is at-least-once, so a run that fires
-- twice must create nothing the second time — the same property the retired
-- schedule generator relied on.
--
-- ── ⚠️ WHY A COLUMN AND NOT A MATCH ON (project, title, assignee, rule) ─────
-- That was the alternative, and it needs no migration, which is its only
-- advantage. It breaks the first time somebody edits the title of a repeating
-- task: the runner then sees a series it has never met, creates today's
-- instance under the new title, and the person gets two copies of the same job
-- every morning with no obvious cause. Identity by coincidence is not identity.
--
-- A task that starts a series is its own root (`recurrence_series_id = id`) and
-- every instance it spawns carries the same value. So the runner groups by one
-- indexed column and the title is free to change.
--
-- Cheap to add: exactly TWO tasks in the live database carry a recurrence rule
-- today, so the backfill is two rows.
-- ============================================================================

alter table public.tasks
  add column if not exists recurrence_series_id uuid;

comment on column public.tasks.recurrence_series_id is
  'Groups the instances of one repeating task. The task that starts a series holds its own id; every instance generated from it carries the same value. Null for a task that does not repeat. Used by the nightly repeat runner to decide whether today''s instance already exists.';

-- ⚠️ Every existing repeating task becomes its own root. Correct rather than
-- merely convenient: `spawnNextOccurrence` (now retired) copied the rule onto
-- each child without recording the parent, so the history of which task came
-- from which is not in the database to recover. Treating each as a root is the
-- honest reading of what is actually known.
update public.tasks
   set recurrence_series_id = id
 where recurrence_rule is not null
   and recurrence_series_id is null;

-- Partial: only repeating tasks are ever looked up this way, and they are a
-- handful of rows out of thousands.
create index if not exists tasks_recurrence_series_idx
  on public.tasks (recurrence_series_id, due_date)
  where recurrence_series_id is not null;

-- ⚠️ A repeating task must always carry a series, or the runner silently skips
-- it — a task that quietly stops repeating is the hardest kind of bug to
-- notice, because nothing appears anywhere. Enforced rather than remembered.
alter table public.tasks
  drop constraint if exists tasks_repeat_has_a_series;

alter table public.tasks
  add constraint tasks_repeat_has_a_series
  check (recurrence_rule is null or recurrence_series_id is not null);

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
do $$
declare
  v_orphans integer;
  v_roots   integer;
begin
  select count(*) into v_orphans from public.tasks
   where recurrence_rule is not null and recurrence_series_id is null;
  if v_orphans > 0 then
    raise exception '086: % repeating tasks have no series id', v_orphans;
  end if;

  select count(*) into v_roots from public.tasks
   where recurrence_series_id is not null;

  -- ⚠️ The constraint is verified from the catalogue, not by attempting an
  -- insert. The first version of this probed with a real INSERT and failed for
  -- an unrelated reason — `tasks.reference` is NOT NULL and the probe did not
  -- supply one, so a not_null_violation escaped the `when check_violation`
  -- handler and took the whole migration down. A probe that has to construct a
  -- valid row is testing the row, not the constraint.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.tasks'::regclass
       and c.conname = 'tasks_repeat_has_a_series'
       and pg_get_constraintdef(c.oid) ilike '%recurrence_rule is null%'
       and pg_get_constraintdef(c.oid) ilike '%recurrence_series_id is not null%'
  ) then
    raise exception '086: the series constraint is missing or does not say what it should';
  end if;

  raise notice '086: % repeating task(s) carry a series id, and the constraint holds', v_roots;
end $$;
