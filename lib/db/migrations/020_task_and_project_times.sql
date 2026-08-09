-- =============================================================================
-- 020 · A TIME TO GO WITH THE DATE
-- =============================================================================
-- Owner instruction, CHANGE-PLAN 3.1: *"there should be a date, day and then
-- also a time option as well, to set the time from this time to that time, AM
-- or PM."* Approved 2026-08-09.
--
-- ── WHY NEW COLUMNS RATHER THAN CHANGING date TO timestamptz ─────────────────
-- Turning `start_date` and `due_date` into timestamps is the obvious move and
-- the wrong one. Those two columns are load-bearing in more places than the
-- form that writes them:
--
--   · `tasks_dates_ordered` and `projects_dates_ordered` compare them
--   · `tasks_due_date_idx` is a partial index on `due_date`
--   · lib/domain/recurrence.ts computes every next instance from a DATE, and
--     its whole test suite is written in UTC calendar days — Step 6 was already
--     bitten once by `new Date('2026-03-29').getDay()` answering locally, which
--     silently turned "every Monday" into every Sunday west of Greenwich
--   · the calendar groups by day, and the workload window is a Monday-to-Saturday
--     span of DATES (ADR-004)
--
-- Changing the type would quietly re-interpret all of that, and a timestamp
-- compared against a date is a class of bug that shows up as work appearing on
-- the wrong day for people in the wrong timezone — months later.
--
-- So the time is ADDITIVE. Every existing behaviour keeps reading the same date
-- it always did, and a NULL time means exactly what it means today: a day with
-- no particular hour attached.
--
-- ── `time` AND NOT `timetz` ──────────────────────────────────────────────────
-- `timetz` stores an offset with no date, which is not enough to resolve
-- daylight saving and is discouraged by Postgres' own documentation. This
-- division works one timezone (Asia/Karachi, ADR-004), so a wall-clock time is
-- what is actually meant: "the shoot starts at 2pm" is 2pm in Karachi whatever
-- the server thinks. The application pairs it with the date and the fixed
-- division timezone when it needs a real instant.
-- =============================================================================

alter table public.tasks
  add column if not exists start_time time,
  add column if not exists due_time   time;

alter table public.projects
  add column if not exists start_time      time,
  add column if not exists target_end_time time;

comment on column public.tasks.start_time is
  'Optional wall-clock time paired with start_date. NULL = a day with no hour. '
  'Asia/Karachi (ADR-004), so `time` rather than `timetz`. Added in 020.';
comment on column public.tasks.due_time is
  'Optional wall-clock time paired with due_date. NULL = end of that day.';
comment on column public.projects.start_time is
  'Optional wall-clock time paired with start_date. Added in 020.';
comment on column public.projects.target_end_time is
  'Optional wall-clock time paired with target_end_date. Added in 020.';

-- ── The ordering rule has to cover the time as well ──────────────────────────
-- `tasks_dates_ordered` already refuses a due date before a start date. With
-- times in play, the same day is no longer automatically fine: 09:00 → 17:00 is
-- legitimate and 17:00 → 09:00 is not, and only the time can tell them apart.
--
-- Written to be true when anything is NULL, because an unset time is not a
-- violation — it is the normal case.

alter table public.tasks
  drop constraint if exists tasks_times_ordered;
alter table public.tasks
  add constraint tasks_times_ordered check (
    start_date is null
    or due_date is null
    or start_date <> due_date
    or start_time is null
    or due_time is null
    or due_time >= start_time
  );

alter table public.projects
  drop constraint if exists projects_times_ordered;
alter table public.projects
  add constraint projects_times_ordered check (
    start_date is null
    or target_end_date is null
    or start_date <> target_end_date
    or start_time is null
    or target_end_time is null
    or target_end_time >= start_time
  );

comment on constraint tasks_times_ordered on public.tasks is
  'On a single day, the due time cannot precede the start time. Across days the '
  'existing date ordering already covers it. NULLs pass — an unset time is normal.';
