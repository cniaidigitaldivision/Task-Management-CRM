-- ============================================================================
-- 053 · DELETING A PROJECT, REVERSIBLY
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24: *"on the project page there is no delete button. I want there
-- to be a delete button… right now I'm testing on some dummy projects. After my
-- testing when I deploy this project, I have to delete all these data… if you have
-- added some project, a random project, don't want to add some accidentally wrong
-- project, or have added two projects at the same time, there is an option to
-- delete one."*
--
-- ── ⚠️ WHY THIS IS A FLAG AND NOT A `DELETE` ────────────────────────────────
-- Asked which of three behaviours they wanted, the owner chose delete-with-Trash
-- over a permanent delete. The schema already agreed with that choice before anyone
-- asked it — `tasks.project_id` is ON DELETE **RESTRICT**, so the database refuses
-- to remove a project that any task points at. Every one of the five projects in
-- this division has tasks (4, 1, 11, 9 and 0 live, plus 14–33 soft-deleted ones
-- that still hold the reference), so a real DELETE would have been refused for all
-- of them and the button would have looked broken on day one.
--
-- The rest of the foreign keys are worth reading too, because they already encode
-- what belongs to a project and what merely mentions one:
--
--   CASCADE   project_members, project_platforms, project_reports,
--             project_services   -- parts OF the project; they go with it
--   RESTRICT  tasks              -- work is not disposable
--   SET NULL  credentials, documents, drive_folders
--                                -- a client's password and a signed contract
--                                   outlive the project record that filed them
--
-- A flag sidesteps all of it: nothing is destroyed, so nothing can be refused, and
-- Restore is possible because the rows were never touched.
--
-- ── ⚠️ WHAT THIS DOES NOT ADD ───────────────────────────────────────────────
-- A purge. `project.purge` is Super Admin only in `lib/domain/permissions.ts` and
-- is in `STEP_UP_ACTIONS`; the permanent erase on the Trash screen calls it, and it
-- is the one path that will still hit the RESTRICT above. That is correct: erasing a
-- project's history for ever should be hard, and should be blocked while the work is
-- still there.
--
-- ── WHY NOT REUSE `status = 'archived'` OR `'cancelled'` ────────────────────
-- Both are real states of a live project that people report on — an archived
-- project is finished, not deleted, and the Projects screen has a filter for each.
-- Overloading one to also mean "removed" would make every status filter lie and
-- would make "restore" indistinguishable from "un-archive".
-- ============================================================================

alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_id uuid references public.users(id) on delete set null;

comment on column public.projects.deleted_at is
  'When somebody deleted this project. Null for a live one. Nothing is destroyed — '
  'the tasks, credentials and documents are all still attached — so restoring is '
  'clearing this column. Permanent removal is project.purge, Super Admin only.';

comment on column public.projects.deleted_by_id is
  'Who deleted it. Kept so the Trash screen can say who, and so a project that '
  'vanished is answerable rather than mysterious.';

-- ⚠️ BOTH HALVES MATTER. Every list filters `deleted_at is null`, which is the hot
-- path; the Trash screen filters `is not null`, which is rare but should not scan.
create index if not exists projects_live_idx
  on public.projects (status) where deleted_at is null;

create index if not exists projects_deleted_idx
  on public.projects (deleted_at desc) where deleted_at is not null;

-- ⚠️ A DELETED PROJECT MUST NOT BE THE CATCH-ALL. `is_permanent` marks the row that
-- unassigned work falls back to (the division's own project); deleting it would
-- leave that work pointing at something no screen shows. Refused by the table
-- rather than by whoever remembers.
alter table public.projects
  drop constraint if exists projects_permanent_is_not_deletable;

alter table public.projects
  add constraint projects_permanent_is_not_deletable
    check (not (is_permanent and deleted_at is not null));

comment on constraint projects_permanent_is_not_deletable on public.projects is
  'The permanent catch-all project cannot be deleted — unassigned work falls back '
  'to it, and hiding it would hide that work with no way to reach it.';
