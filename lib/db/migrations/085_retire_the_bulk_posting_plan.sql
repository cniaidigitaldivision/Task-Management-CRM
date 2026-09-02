-- ============================================================================
-- 085 · RETIRE THE BULK POSTING PLAN
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03: *"all the backlog tasks which of the like a whole month you
-- have created bulk task delete them all"*, and in the same breath, twice, about
-- what must survive: *"these two September tasks, right? Of a done task, do not
-- change them"* and *"delete all the tasks unless the to do tasks would keep as
-- it is of a two September."*
--
-- On 2026-09-02 the "Generate schedule" button was pressed across eleven
-- projects, filling every day to 30 September from each project's agreed
-- rhythm. 304 content tasks, all Backlog, all unassigned. They are the reason
-- the Tasks board was slow, the reason nobody but Kashif could act on the day's
-- work, and they are being replaced by a tracker that watches the target instead
-- of pre-writing the month.
--
-- ── ⚠️ SOFT DELETE, NOT `DELETE FROM` ──────────────────────────────────────
-- `is_deleted = true, deleted_at = now()`, exactly as `softDeleteTask`
-- (lib/db/queries/tasks.ts) does. Three reasons, in order of importance:
--   1. 304 rows of somebody else's live system. Recoverable beats tidy.
--   2. Every read path in the application already filters `not is_deleted`, so
--      the outcome the owner asked for — they are gone — is achieved either way.
--   3. `DELETE` would cascade into placements, comments, checklists and the
--      activity log, destroying the record that these were ever created.
-- The old worry about a heavy table no longer applies: the board reads a due
-- window now, not the whole table.
--
-- ── ⚠️ WHAT THIS REFUSES TO TOUCH, AND ASSERTS AFTERWARDS ──────────────────
-- Only `status = 'backlog' AND assignee_id IS NULL AND content_kind IS NOT NULL`.
-- So: nothing anybody owns, nothing anybody has started, nothing that is not a
-- generated content post. Plus an explicit exclusion for anything carrying a
-- live placement link — an unassigned Backlog task should never have one, and if
-- one does then somebody published it and it is real work, whatever its status
-- says.
--
-- The keep-counts are measured before and compared after. If 2 September's done
-- or To Do rows move by a single row, this raises and the whole file rolls back
-- rather than committing a half-correct cleanup.
-- ============================================================================

do $$
declare
  v_admin        uuid;
  v_done_before  integer;
  v_todo_before  integer;
  v_links_before integer;
  v_owned_before integer;
  v_done_after   integer;
  v_todo_after   integer;
  v_links_after  integer;
  v_owned_after  integer;
  v_deleted      integer;
begin
  select id into v_admin from public.users where role = 'super_admin' limit 1;
  if v_admin is null then
    select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  end if;
  -- Identity set so any trigger that asks has an answer, and so the write is
  -- attributable rather than anonymous.
  perform set_config('app.user_id', v_admin::text, true);

  -- ── What must survive, measured now ──────────────────────────────────────
  select count(*) into v_done_before  from public.tasks
   where not is_deleted and due_date = '2026-09-02' and status = 'done';
  select count(*) into v_todo_before  from public.tasks
   where not is_deleted and due_date = '2026-09-02' and status = 'todo';
  select count(*) into v_links_before from public.tasks t
   where not t.is_deleted
     and exists (select 1 from public.task_placements p
                  where p.task_id = t.id and p.url is not null);
  select count(*) into v_owned_before from public.tasks
   where not is_deleted and assignee_id is not null;

  raise notice '085: before — 2 Sep done=%, 2 Sep todo=%, with a live link=%, owned=%',
    v_done_before, v_todo_before, v_links_before, v_owned_before;

  -- ── The cleanup ──────────────────────────────────────────────────────────
  update public.tasks t
     set is_deleted = true,
         deleted_at = now()
   where t.is_deleted = false
     and t.status = 'backlog'
     and t.assignee_id is null
     and t.content_kind is not null
     -- ⚠️ Real work is never swept up, whatever the status column claims.
     and not exists (
       select 1 from public.task_placements p
        where p.task_id = t.id and p.url is not null
     );

  get diagnostics v_deleted = row_count;
  raise notice '085: soft-deleted % unassigned backlog content tasks', v_deleted;

  -- ── And what actually survived ───────────────────────────────────────────
  select count(*) into v_done_after  from public.tasks
   where not is_deleted and due_date = '2026-09-02' and status = 'done';
  select count(*) into v_todo_after  from public.tasks
   where not is_deleted and due_date = '2026-09-02' and status = 'todo';
  select count(*) into v_links_after from public.tasks t
   where not t.is_deleted
     and exists (select 1 from public.task_placements p
                  where p.task_id = t.id and p.url is not null);
  select count(*) into v_owned_after from public.tasks
   where not is_deleted and assignee_id is not null;

  if v_done_after <> v_done_before then
    raise exception '085: 2 September done tasks went from % to %. The owner said twice not to change them.',
      v_done_before, v_done_after;
  end if;
  if v_todo_after <> v_todo_before then
    raise exception '085: 2 September To Do tasks went from % to %.', v_todo_before, v_todo_after;
  end if;
  if v_links_after <> v_links_before then
    raise exception '085: tasks holding a live link went from % to %. Published work was swept up.',
      v_links_before, v_links_after;
  end if;
  if v_owned_after <> v_owned_before then
    raise exception '085: assigned tasks went from % to %. Somebody lost work they owned.',
      v_owned_before, v_owned_after;
  end if;

  raise notice '085: kept — 2 Sep done=%, 2 Sep todo=%, live links=%, owned=% (all unchanged)',
    v_done_after, v_todo_after, v_links_after, v_owned_after;
end $$;
