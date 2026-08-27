-- ============================================================================
-- 048 · A DOCUMENT LIVES IN THE SUPABASE BUCKET. DRIVE IS OPTIONAL.
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24:
--
--   "I told you that it would not be saved in Google Drive. It will be saved in
--    Supabase, in the bucket related to any official document related to any
--    project… Anything uploaded by admin, anything uploaded by the team
--    coordinator, will not be sent to approval. It will be automatically
--    uploaded. For all the members anything they upload will be sent to admin
--    for approval."
--
-- ── WHAT WAS ACTUALLY WRONG, AND IT WAS THIS CONSTRAINT ─────────────────────
-- Migration 025 encoded "Drive is where a document ends up" as a CHECK, not as a
-- convention:
--
--     when 'approved' then drive_file_id is not null and storage_path is null
--
-- So an approved document was *required* to be in Drive and *required* not to be
-- in the bucket. `approveDocumentAction` did exactly what that demanded: pulled
-- the bytes back out of Supabase, pushed them to Drive, then DELETED the object.
-- Which is why "save it in Supabase" could not be done by editing the action —
-- the database would have refused the row.
--
-- After this, `approved` means: somebody decided, and the bytes are somewhere.
--
--     approved  has a decider, and at least one of storage_path / drive_file_id
--
-- ── ⚠️ THIS IS A RELAXATION, SO READ WHAT IT STOPS GUARANTEEING ─────────────
-- The old rule made "a row cannot claim to hold the file in both Supabase and
-- Drive" a property of the table. That is now permitted, and it has to be,
-- because a file that was approved into Drive last week and a file approved into
-- the bucket today are both legitimately `approved` and the second must not be
-- forced to invent a `drive_file_id`.
--
-- What is still guaranteed, and is the part that matters: an approved row always
-- has a decider, and always has SOMEWHERE the bytes can be fetched from. A row
-- with neither was the real corruption — a document the register swears was
-- accepted and which nobody can open.
--
-- ── EXISTING ROWS ARE UNTOUCHED AND KEEP WORKING ────────────────────────────
-- Every document approved before today has `drive_file_id` set and
-- `storage_path` null. That still satisfies the new rule, so nothing is migrated
-- and nothing breaks — the Files tab already prefers `driveWebLink` when it is
-- present and falls back to a signed bucket URL when it is not.
--
-- Drive is NOT removed. The folder registry, the access levels and the sync stay
-- exactly as they are; they are simply no longer on the path a document must
-- travel to be accepted. Nobody has to configure Google OAuth to file a contract
-- any more, which is the other thing this fixes: approval used to fail outright
-- with "no Google OAuth client is configured".
-- ============================================================================

alter table public.documents
  drop constraint if exists documents_state_is_coherent;

alter table public.documents
  add constraint documents_state_is_coherent check (
    case state
      -- Unchanged: a pending file is in our bucket, undecided.
      when 'pending' then
        storage_path is not null and drive_file_id is null and decided_at is null

      -- ⚠️ Relaxed. Decided, and retrievable from at least one place.
      when 'approved' then
        decided_by_id is not null
        and decided_at is not null
        and (storage_path is not null or drive_file_id is not null)

      -- Unchanged: a refusal must say why.
      when 'rejected' then
        decided_by_id is not null and decided_at is not null
        and length(btrim(coalesce(decision_reason, ''))) > 0
    end
  );

comment on constraint documents_state_is_coherent on public.documents is
  'The pending -> approved/rejected lifecycle as a property of the table. Revised '
  '2026-08-24: an approved document lives in the Supabase bucket by default and may '
  'also or instead be in Drive, so the check now requires a decider plus at least one '
  'retrievable location rather than requiring Drive specifically. A rejected row still '
  'cannot exist without a reason.';

comment on table public.documents is
  'The document register. Files live in the private Supabase bucket. An upload by a '
  'Team Coordinator or above is approved on arrival; a Member''s upload is pending '
  'until an Admin accepts it, and acceptance flips the state without moving the bytes. '
  'Copying into Google Drive is an optional extra, not the destination. A rejected row '
  'is kept with its reason — "why was this refused" is a question people ask.';
