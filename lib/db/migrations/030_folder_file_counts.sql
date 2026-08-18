-- =============================================================================
-- 030 · HOW MANY FILES ARE ACTUALLY IN THE FOLDER — owner report, 2026-08-18
-- -----------------------------------------------------------------------------
-- Owner: *"the list of all the folders is appearing but showing a zero document.
-- I don't know why this is. Every folder has some documents."*
--
-- Because the number was counting the wrong thing. `listFolders` reported
--
--     (select count(*) from public.documents d where d.folder_id = f.id)
--
-- which is documents REGISTERED IN THE CRM. The owner's folders are full of files
-- put there directly in Drive, which the CRM has never seen. So "0 documents" was
-- true and useless: a folder you know holds ten files, reported as empty.
--
-- ── TWO DIFFERENT NUMBERS, AND THE SCREEN NEEDS BOTH ─────────────────────────
--   drive_file_count   what is in Drive. What somebody looking at the folder
--                      means by "how many documents are in here".
--   the register count  what the CRM knows about — uploaded through it, approved,
--                      auditable. Still the number that matters for approvals.
--
-- Conflating them is what caused the confusion, so they are stored and shown
-- separately rather than one being made to stand in for the other.
--
-- ── ⚠️ THIS COLUMN IS A CACHE, AND IS ALLOWED TO BE STALE ────────────────────
-- It is whatever Drive said at `files_counted_at`. Somebody adding a file in
-- Drive does not notify us, and polling every folder to keep a display number
-- honest would be a lot of requests for a small benefit. NULL means never
-- counted, which is why it is nullable rather than `default 0` — "we have not
-- looked" and "we looked and it was empty" must not render identically.
-- =============================================================================

alter table public.drive_folders
  add column if not exists drive_file_count  integer,
  add column if not exists files_counted_at  timestamptz,
  /* True when the folder held more children than one page reports, so the count
     is a floor. Displayed as "1000+" rather than as a wrong exact number. */
  add column if not exists file_count_partial boolean not null default false;

alter table public.drive_folders
  drop constraint if exists drive_folders_file_count_sane;
alter table public.drive_folders
  add constraint drive_folders_file_count_sane check (
    drive_file_count is null or drive_file_count >= 0
  );

/* Counted and when are written together, exactly like the sharing attribution:
   a count with no timestamp is a number nobody can judge the age of. */
alter table public.drive_folders
  drop constraint if exists drive_folders_count_is_timed;
alter table public.drive_folders
  add constraint drive_folders_count_is_timed check (
    (drive_file_count is null) = (files_counted_at is null)
  );

comment on column public.drive_folders.drive_file_count is
  'Files directly in this Drive folder as of files_counted_at. A CACHE, allowed '
  'to be stale — Drive does not notify us. NULL means never counted, which must '
  'not look the same as counted-and-empty. Added in 030.';
comment on column public.drive_folders.file_count_partial is
  'The folder has more children than one page reports, so drive_file_count is a '
  'floor. Show it as "N+".';


-- -----------------------------------------------------------------------------
-- SELF-CHECK — the paired-nullability constraint actually binds
-- -----------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  insert into public.drive_folders (drive_folder_id, name)
  values ('__m030_selfcheck__', 'Migration 030 self-check')
  returning id into v_id;

  -- A count with no timestamp must be refused.
  begin
    update public.drive_folders set drive_file_count = 5 where id = v_id;
    raise exception '030 · a count was accepted with no files_counted_at';
  exception when check_violation then null;
  end;

  -- A timestamp with no count, likewise.
  begin
    update public.drive_folders set files_counted_at = now() where id = v_id;
    raise exception '030 · a files_counted_at was accepted with no count';
  exception when check_violation then null;
  end;

  -- Negative counts refused.
  begin
    update public.drive_folders
       set drive_file_count = -1, files_counted_at = now() where id = v_id;
    raise exception '030 · a negative count was accepted';
  exception when check_violation then null;
  end;

  -- Both together, accepted.
  update public.drive_folders
     set drive_file_count = 0, files_counted_at = now() where id = v_id;
  if not found then raise exception '030 · a valid count was refused'; end if;

  delete from public.drive_folders where id = v_id;
  raise notice '030 · file count columns bind correctly';
end
$$;
