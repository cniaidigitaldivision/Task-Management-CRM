-- =============================================================================
-- 019 · THE MISSING DELETE POLICY ON public.tasks
-- =============================================================================
-- Owner approved 2026-08-09, CHANGE-PLAN Batch 2.
--
-- `task.purge` has been in doc 03 §3 as Super-Admin-with-step-up since Step 3.
-- The application side was written in Batch 2 — permission check, step-up gate,
-- impact dialog, storage cleanup, and an audit entry that names what is being
-- destroyed while it still exists to be named. None of it could work, because
-- of a gap nothing in the codebase pointed at.
--
-- ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────
-- Migration 013 gave `public.tasks` three policies — select, insert, update —
-- and no DELETE policy. Row-level security is enabled on the table, and with
-- RLS on, a command with NO policy is refused for every row.
--
-- The refusal is silent. It is not an error; the statement succeeds and reports
-- zero rows. Measured against this database as the Super Admin through
-- `cni_app`, before this migration:
--
--     rows deleted → 0
--
-- The DELETE privilege was already granted to `cni_app`. Only the policy was
-- missing, so the grant made it look permitted while RLS refused every row.
--
-- ── THIS IS THE SECOND TIME ──────────────────────────────────────────────────
-- Session 11: "the RLS delete policy being Super-Admin-only meant an Admin's
-- Reset deleted zero rows with no error." Same shape, different table. A
-- delete that quietly affects nothing is the most expensive kind of bug this
-- schema can have, because the calling code writes its audit entry and reports
-- success.
--
-- Worse here: `purgeTasksAction` removes the attachment STORAGE OBJECTS first,
-- deliberately — Postgres cascades every child table but cannot reach into
-- Supabase Storage, so deleting rows first would lose the only record of which
-- objects to remove. Without this policy the files would have been destroyed
-- and the tasks left in place.
--
-- ── WHY SUPER ADMIN ONLY, AND NOTHING ELSE ───────────────────────────────────
-- doc 03 §3 gives `task.purge` to the Super Admin alone. Everybody else has
-- FR-095's soft delete, which hides a task for 30 days and is recoverable — the
-- right answer almost always. Purge exists for the one case a soft delete
-- cannot serve: something that should never have been recorded at all, carrying
-- a client name or a note that must not sit in the database for a month.
--
-- The application checks the same rule through lib/domain/permissions.ts, and
-- that is not duplication for its own sake: doc 16 §7 requires two independent
-- enforcement layers. This is the one that holds when the application is wrong.
--
-- ── WHAT GOES WITH IT ────────────────────────────────────────────────────────
-- `comments`, `attachments`, `checklist_items`, `time_entries`,
-- `task_dependencies`, `task_watchers` and `task_skills` are all
-- `on delete cascade` from `tasks`, and subtasks cascade through
-- `parent_task_id`. Referential actions are performed by the system and are NOT
-- subject to row-level security, so the cascade completes regardless of the
-- child tables' own policies. One delete is genuinely one delete.
--
-- `activity_log` and `audit_log` hold `entity_id` as a plain uuid with no
-- foreign key — deliberately, since Step 6 — so the record of the purge
-- SURVIVES the purge. That is the whole point of it being a snapshot.
-- =============================================================================

create policy tasks_delete on public.tasks
  for delete to cni_app
  using (app.current_user_role() = 'super_admin');

comment on policy tasks_delete on public.tasks is
  'doc 03 §3 task.purge — Super Admin only. Everyone else has FR-095''s soft '
  'delete. Added in 019: the table had RLS on and no DELETE policy, so every '
  'delete was silently refused (0 rows, no error).';
