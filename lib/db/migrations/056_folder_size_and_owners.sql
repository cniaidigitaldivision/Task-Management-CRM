-- ============================================================================
-- 056 · WHAT DRIVE ACTUALLY SAYS ABOUT A FOLDER
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-25, on being shown a folder table with three empty columns:
--
--   "One thing I must say is that the things should be real. Even the real drive
--    size, folder size, anything should be real. If you need something, Google
--    Drive is integrated with it so go and get everything."
--
-- Migration 030 added `drive_file_count` for exactly this reason — every folder
-- read "0 documents" because nothing had ever asked Drive what was in it. This is
-- the same fix for the next three columns of the same table: size, when the files
-- last changed, and who owns them.
--
-- ── ⚠️ A CACHE, LIKE `drive_file_count`, AND ALLOWED TO BE STALE ─────────────
-- These are whatever Drive said at `files_counted_at`. Somebody adding a file in
-- Drive does not notify this system, so the display is "as of the last sync" and
-- the screen says so. That was migration 030's decision and it is unchanged here;
-- the alternative is calling Google on every page render.
--
-- All three are written in the SAME request that already counted the files, so a
-- sync makes exactly as many round trips as it did before this migration.
--
-- ── ⚠️ A DRIVE FOLDER HAS NO SIZE OF ITS OWN ────────────────────────────────
-- Google does not report one. `drive_size_bytes` is the sum of the files DIRECTLY
-- in the folder, matching `drive_file_count` — a recursive total would mean
-- walking every subtree on every sync, and the two numbers in one row would then
-- be counting different things.
--
-- ⚠️ GOOGLE-NATIVE FILES HAVE NO SIZE. Docs, Sheets and Slides live in Google's
-- own format and the API omits the field, so they add nothing to the sum while
-- still counting as files. That is why `drive_sized_file_count` exists: without
-- it, a folder of twelve Google Docs reads "12 files · 0 B" and looks broken,
-- when the honest reading is "12 files, none of which has a byte size".
-- ============================================================================

alter table public.drive_folders
  add column if not exists drive_size_bytes       bigint,
  -- How many of `drive_file_count` reported a size. See the header.
  add column if not exists drive_sized_file_count integer,
  -- The newest modifiedTime among the files directly inside.
  add column if not exists drive_modified_at      timestamptz,
  -- ⚠️ jsonb, not a join table. These are GOOGLE accounts — a display name, an
  -- email and Google's own avatar URL — and most of them will never correspond to
  -- a row in public.users. A foreign key would be wrong, and a table of
  -- unreferenced Google identities is a table nobody maintains. They are a cached
  -- projection of what Drive said, so they live with the rest of that cache.
  add column if not exists drive_owners           jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drive_folders_size_non_negative'
  ) then
    alter table public.drive_folders
      add constraint drive_folders_size_non_negative
      check (drive_size_bytes is null or drive_size_bytes >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'drive_folders_sized_count_sane'
  ) then
    -- ⚠️ The sized count can never exceed the file count: it counts a subset of
    -- the same children. A violation means the two were written from different
    -- requests, which is the bug this catches.
    alter table public.drive_folders
      add constraint drive_folders_sized_count_sane
      check (
        drive_sized_file_count is null
        or drive_file_count is null
        or drive_sized_file_count <= drive_file_count
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'drive_folders_owners_is_array'
  ) then
    -- A jsonb column will happily hold a string or a number. The reader maps over
    -- it, so anything but an array is a runtime failure in a page render.
    alter table public.drive_folders
      add constraint drive_folders_owners_is_array
      check (drive_owners is null or jsonb_typeof(drive_owners) = 'array');
  end if;
end $$;

comment on column public.drive_folders.drive_size_bytes is
  'Sum of the sizes of files DIRECTLY in this Drive folder as of files_counted_at. '
  'A CACHE, allowed to be stale. Null means never counted, which is not the same '
  'as 0. Google-native files (Docs, Sheets, Slides) report no size and so add '
  'nothing — see drive_sized_file_count.';

comment on column public.drive_folders.drive_sized_file_count is
  'How many of drive_file_count reported a byte size. Lets the screen distinguish '
  '"an empty folder" from "a folder of Google Docs, which have no size".';

comment on column public.drive_folders.drive_modified_at is
  'The newest modifiedTime among the files directly in this folder. Deliberately '
  'excludes subfolders: Drive touches a folder whenever its contents change, so '
  'including them would make every ancestor look edited whenever anything deep '
  'inside moved.';

comment on column public.drive_folders.drive_owners is
  'Cached projection of the Google accounts owning the files in this folder, most '
  'recently active first, capped at five. Objects of {name, email, photo}. NOT '
  'public.users — most will never have an account here, which is why there is no '
  'foreign key.';
