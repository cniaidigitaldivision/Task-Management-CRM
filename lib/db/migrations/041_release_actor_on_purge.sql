-- ============================================================================
-- 041 · A DELETED PERSON RELEASES THEIR HISTORY, RATHER THAN BEING UNDELETABLE
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-23:
--
--   *"I want that super admin and admin to be able to delete a team member…
--   I'm having a lot of difficulty maintaining things because I'm just testing.
--   I'm adding someone and I couldn't delete it. I don't want to dump my
--   database with the testing or dummy data."*
--
-- ── WHY IT WAS IMPOSSIBLE, WHICH IS NOT THE REASON ANYONE ASSUMED ────────────
-- `user.purge` has existed in the permission matrix since doc 03 and nothing
-- ever implemented it. But even a perfect implementation would have failed,
-- because of an interaction nobody designed and nobody would guess:
--
--   · `activity_log.actor_id` is `on delete set null` — history is meant to
--     survive the person, holding what happened with the actor released.
--   · `activity_log` carries an append-only trigger firing on DELETE **and
--     UPDATE**, raising unconditionally (doc 19 §6, history is not editable).
--
-- A `set null` IS an update. So the foreign key's own repair work tripped the
-- guard, and deleting anybody who had ever done a single thing — including
-- signing in once — failed with "activity_log is append-only". Five accounts
-- were sitting deactivated-but-undeletable when this was written, each held
-- there by as few as two log rows.
--
-- ── THE EXCEPTION IS ONE SHAPE, AND IT PRESERVES THE RULE ────────────────────
-- Permitted: an update that releases a non-null actor to null and changes
-- NOTHING else. What happened, when, to which entity, and the before/after
-- payloads are all still immutable. The history is not edited; a pointer to a
-- row that no longer exists is dropped, which is the only honest thing it can
-- hold once the person is gone.
--
-- Every other update and every delete still raises, exactly as before.
--
-- ── ⚠️ AND IT CANNOT BE REACHED FROM THE APPLICATION AT ALL ─────────────────
-- Checked before writing this rather than assumed. `activity_log` has RLS
-- enabled with exactly two policies — `activity_insert` and `activity_select`.
-- There is no UPDATE policy, so `cni_app` is denied every direct update no
-- matter what this trigger would allow. A referential action taken by the
-- foreign key runs as the constraint's own internal operation and is not
-- subject to RLS, which is why the `set null` gets through and a request
-- pretending to be one never will.
--
-- So this does not open a way to quietly anonymise an audit trail. The only
-- path to it is deleting the user the trail points at, which is itself gated by
-- `user.purge` and by the thirteen RESTRICT foreign keys on authored content.
--
-- ── WHAT STILL BLOCKS A DELETE, DELIBERATELY ─────────────────────────────────
-- Nothing here weakens those. A person who created a task, wrote a comment,
-- owns a project, logged time or uploaded a document is still undeletable, and
-- should be: their work would have to be destroyed or orphaned to remove them.
-- Deactivation is the answer for those, and the application now says so by
-- name instead of failing with a database error.
-- ============================================================================

-- Dedicated to this table rather than a change to `app.reject_mutation`, which
-- is shared by every other append-only table and must keep raising for all of
-- them without exception.
create or replace function app.activity_log_append_only()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE'
     -- Releasing an actor, not assigning or swapping one.
     and old.actor_id is not null
     and new.actor_id is null
     -- …and every other column byte-identical. `is not distinct from` rather
     -- than `=` so a null-to-null comparison is true instead of unknown, which
     -- with `=` would fall through to the raise for any row with a null summary.
     and new.id          is not distinct from old.id
     and new.entity_type is not distinct from old.entity_type
     and new.entity_id   is not distinct from old.entity_id
     and new.action      is not distinct from old.action
     and new.summary     is not distinct from old.summary
     and new.before      is not distinct from old.before
     and new.after       is not distinct from old.after
     and new.created_at  is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception '% is append-only.', tg_table_name
    using errcode = 'insufficient_privilege',
          hint = 'doc 19 §6 — history is not editable by any role. The only '
                 'permitted update releases actor_id to null when a user is '
                 'deleted (migration 041).';
end
$$;

comment on function app.activity_log_append_only() is
  'Append-only guard for activity_log, with one exception: the foreign key''s '
  'on-delete-set-null may release actor_id when a user is purged. Migration 041.';

drop trigger if exists activity_log_append_only on public.activity_log;

create trigger activity_log_append_only
  before delete or update on public.activity_log
  for each row execute function app.activity_log_append_only();
