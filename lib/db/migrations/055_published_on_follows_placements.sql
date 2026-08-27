-- ============================================================================
-- 055 · A PUBLISHED PLACEMENT NOW MARKS ITS ASSET AS PUBLISHED
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24, looking at a daily report that listed a Facebook reel and an
-- Instagram reel under "Published today" and said ACHIEVED 0 in the same panel:
--
--   "Was it really published?… I have seen that it is achieved 0. Why is it 0? He
--    has published it, right? Why is it not showing that it is published? Plus the
--    total posts on the right side in today's activity are also 0."
--
-- ── ⚠️ THE REPORT WAS READING A COLUMN NOTHING EVER WROTE ───────────────────
-- Two dates, and only one of them was being filled in:
--
--   task_placements.published_on   set when a placement is recorded. Populated.
--   tasks.published_on             what EVERY target report counts on. Always null.
--
-- `projectReportData` asks for assets `where t.published_on is not null`, and asks
-- for placements `where tp.published_on is not null`. So the placement query
-- returned the two reels — which is why "Published today" and the platform shares
-- rendered — and the asset query returned nothing, which is why Achieved, Total
-- posts and every day-by-day row read 0. The report was not broken arithmetic; it
-- was two questions asked of two columns, one of which nobody was answering.
--
-- Confirmed across the whole project: `tasks.published_on` is NULL on every single
-- row, including a `done` reel with two placements both dated 2026-08-24.
--
-- ── WHY A TRIGGER AND NOT A FIX IN THE ACTION ───────────────────────────────
-- `lib/db/queries/placements.ts` could set it, and that would fix the app. But the
-- column is written from three places already — the placements upsert, `updateTask`
-- when somebody edits the field by hand, and any future import or script — and the
-- rule "an asset went live on the date its first placement went live" is a property
-- of the data, not of one code path. Migration 033's own comment says every target
-- report measures on this column; a column that load-bearing should not depend on
-- whoever remembers.
--
-- ── ⚠️ PLACEMENTS SET IT AND NEVER UNSET IT ─────────────────────────────────
-- The earliest placement date wins while any placement has one. Deleting the last
-- placement leaves the task's date ALONE rather than nulling it, because a value
-- somebody typed by hand must not be destroyed by tidying up a placement — and a
-- report that silently lost an asset is the bug this migration exists to fix.
--
-- ⚠️ It does NOT touch `completed_at` or `due_date`. Migration 033 was explicit that
-- these are three different dates: a reel finished Monday and posted Friday counts
-- against Friday.
-- ============================================================================

create or replace function app.task_published_on_from_placements()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  affected uuid;
  earliest date;
begin
  -- On delete the row is in OLD; otherwise NEW. Both paths recompute the one task.
  affected := coalesce(new.task_id, old.task_id);

  select min(tp.published_on) into earliest
    from public.task_placements tp
   where tp.task_id = affected and tp.published_on is not null;

  -- ⚠️ Only ever writes a date, never a null. See the header.
  if earliest is not null then
    update public.tasks t
       set published_on = earliest
     where t.id = affected
       and (t.published_on is distinct from earliest);
  end if;

  return null; -- AFTER trigger; the return value is ignored.
end
$$;

comment on function app.task_published_on_from_placements() is
  'Keeps tasks.published_on equal to the earliest published placement date. Added '
  '2026-08-24: every target report counts on that column and nothing was writing '
  'it, so a reel published to two platforms reported as ACHIEVED 0. Never nulls the '
  'column — a hand-entered date survives a placement being deleted.';

drop trigger if exists task_placements_publish_date on public.task_placements;
create trigger task_placements_publish_date
  after insert or update or delete on public.task_placements
  for each row execute function app.task_published_on_from_placements();

-- ============================================================================
-- BACKFILL
-- ----------------------------------------------------------------------------
-- ⚠️ Every existing deliverable is affected, not just today's. The whole history of
-- this division has been reporting zero achieved against its targets, so the
-- backfill is the half of this migration that changes what people see.
--
-- Only rows where the task has no date and a placement does. A task somebody
-- already dated by hand is left exactly as it is.
-- ============================================================================

do $$
declare
  updated int;
begin
  with earliest as (
    select tp.task_id, min(tp.published_on) as on_date
      from public.task_placements tp
     where tp.published_on is not null
     group by tp.task_id
  )
  update public.tasks t
     set published_on = e.on_date
    from earliest e
   where t.id = e.task_id
     and t.published_on is null;

  get diagnostics updated = row_count;
  raise notice 'Backfilled published_on on % task(s) from their placements.', updated;
end $$;

-- A count worth seeing in the migration output, because "the reports are all zero"
-- was the symptom and this is the number that fixes it.
do $$
declare
  still_null int;
begin
  select count(*) into still_null
    from public.tasks t
   where t.content_kind is not null
     and not t.is_deleted
     and t.status = 'done'
     and t.published_on is null;
  raise notice '% completed deliverable(s) still have no published_on — they have no '
              'placement with a date, so nothing can be inferred. Recording a '
              'placement, or setting the date on the task, will count them.', still_null;
end $$;
