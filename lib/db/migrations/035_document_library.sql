-- =============================================================================
-- 035 · THE DOCUMENT LIBRARY — owner request 2026-08-19
-- -----------------------------------------------------------------------------
-- *"I want you to maintain all these packages in PDF format so I can see, when I
-- want to, what packages they are… put them in a Supabase bucket where I can
-- easily manage them, or where you can easily show me which document has which
-- thing… For example a package card in which the front and back have just
-- packages. A package detail card in which each page has one package in detail.
-- In the same way, some are booklets."*
--
-- *"Whenever I want to see a document… I click it. It gives me a proper PDF view
-- like that or opens a next tab, a blank tab, or a PDF view instead of
-- downloading each time."*
--
-- So: a private bucket, a row per document with a CATEGORY, and inline viewing.
--
-- ── ⚠️ WHY THIS IS NOT `documents` ────────────────────────────────────────────
-- `public.documents` is the client-upload queue: a thing somebody submitted, that
-- an Admin approves, that then goes to Google Drive. None of that applies here.
-- These are the agency's OWN reference material — they are not uploaded by a
-- member, not approved, not destined for Drive, and they are read by everybody
-- rather than filtered per project. Forcing them through that table would mean a
-- `state` column that is always 'approved' and an approval flow nobody uses.
--
-- ── ⚠️ WHY A CATEGORY AND NOT A FOLDER PATH ───────────────────────────────────
-- The owner's ask is "show me the packages" as one click. A path is a string
-- somebody has to get right and nothing can group by reliably — the same mistake
-- as `channel: "Instagram + YouTube"`. A category is an enum a filter can use.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'library_category') then
    create type public.library_category as enum (
      /* Front/back card listing every package at a glance. */
      'package_card',
      /* One page per package, in detail. */
      'package_detail',
      /* Multi-section combined booklet. */
      'booklet',
      /* Slide deck. */
      'deck',
      /* Rate card / price list. */
      'rate_card',
      /* .ai / .eps / .svg — a design SOURCE, not a readable document. */
      'design_source',
      'other'
    );
  end if;
end
$$;

create table if not exists public.library_documents (
  id            uuid primary key default gen_random_uuid(),

  title         text not null,
  category      public.library_category not null default 'other',

  /* The path inside the `cni-library` bucket. Unique, because two rows pointing
     at one object means deleting either breaks the other. */
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    bigint,

  /* ⚠️ WHAT IS ACTUALLY IN IT, in the owner's words — "which document has which
     thing". The category says what SHAPE it is; this says what it covers, so a
     search for "SPARK" finds the booklet page that describes it. */
  summary       text,
  page_count    integer,

  /* False for design sources and anything a browser cannot render. The library
     then offers a download instead of a view that would fail — the owner asked
     for viewing "instead of downloading each time", which means the two have to
     be distinguishable. */
  is_viewable   boolean not null default true,

  uploaded_by_id uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint library_title_present check (length(btrim(title)) > 0),
  constraint library_path_present  check (length(btrim(storage_path)) > 0),
  constraint library_size_sane     check (size_bytes is null or size_bytes > 0),
  constraint library_pages_sane    check (page_count is null or page_count > 0)
);

create unique index if not exists library_documents_path_key
  on public.library_documents (storage_path);
create index if not exists library_documents_category_idx
  on public.library_documents (category, title);

comment on table public.library_documents is
  'The agency''s own reference material — rate cards, booklets, decks. Distinct '
  'from public.documents, which is the client-upload approval queue. Read by '
  'everyone, managed by Admin+.';
comment on column public.library_documents.is_viewable is
  'False where a browser cannot render it (.ai, .eps). The library offers a '
  'download rather than a view that would fail.';


-- -----------------------------------------------------------------------------
-- RLS — everyone reads, Admin+ manages
-- -----------------------------------------------------------------------------
-- The whole point is that the team can find the rate card. Restricting reads
-- would defeat it. Writing is Admin+ because this is company collateral.

alter table public.library_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'library_documents_select') then
    create policy library_documents_select on public.library_documents
      for select to cni_app
      using (app.current_user_id() is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'library_documents_write') then
    create policy library_documents_write on public.library_documents
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.library_documents to cni_app;
revoke all on public.library_documents from anon, authenticated;

drop trigger if exists library_documents_touch_updated_at on public.library_documents;
create trigger library_documents_touch_updated_at
  before update on public.library_documents
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- SELF-CHECK
-- -----------------------------------------------------------------------------

do $$
declare v_admin uuid; v_member uuid; v_doc uuid; n int;
begin
  select id into v_admin  from public.users where role in ('super_admin','admin') limit 1;
  select id into v_member from public.users where role = 'member' and is_active limit 1;

  insert into public.library_documents (title, category, storage_path, mime_type, uploaded_by_id)
  values ('035 self-check', 'rate_card', 'selfcheck/035.pdf', 'application/pdf', v_admin)
  returning id into v_doc;

  -- Two rows for one object would make deleting either break the other.
  begin
    insert into public.library_documents (title, category, storage_path, mime_type)
    values ('duplicate', 'other', 'selfcheck/035.pdf', 'application/pdf');
    raise exception '035 · two rows were allowed to point at one stored object';
  exception when unique_violation then null;
  end;

  if v_member is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_member::text, true);

    -- Everybody must be able to FIND the rate card.
    select count(*) into n from public.library_documents where id = v_doc;
    if n <> 1 then raise exception '035 · a member cannot read the library'; end if;

    -- ...and must not be able to change the company's collateral.
    begin
      update public.library_documents set title = 'tampered' where id = v_doc;
      if found then raise exception '035 · A MEMBER EDITED THE LIBRARY'; end if;
    exception when insufficient_privilege then null;
    end;

    reset role;
  end if;

  delete from public.library_documents where id = v_doc;
  raise notice '035 · library ready: readable by all, writable by Admin+, one row per object';
end
$$;
