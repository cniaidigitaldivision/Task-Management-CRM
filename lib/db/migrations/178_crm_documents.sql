-- ============================================================================
-- 178 · SOMEWHERE TO PUT THE LETTERHEAD
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, twice: *"Please give me some place where I can go and see
-- all the documents this project has, or documents related to leads."* and then
-- *"You didn't provide me a place where I can upload these documents."*
--
-- Fair. The letterhead has been the top blocking item on all 18 projects for a
-- day and there was nowhere to put one.
--
-- ── ⚠️ NO NEW BUCKET. The existing one already allows PDFs, PNG, JPEG and SVG,
-- already has signed URLs working and is already configured. A second bucket
-- means new policies, new plumbing and a second thing to get wrong, for no
-- benefit. CRM files live under a `crm/` path prefix, which keeps them
-- identifiable when the module is lifted — rule 4 of 16-EXTRACTING-THE-CRM,
-- applied to storage.
--
-- ── ⚠️ PROJECT DOCUMENTS AND LEAD DOCUMENTS ARE ONE TABLE ──────────────────
-- A letterhead belongs to the project; a signed booking form belongs to one
-- lead. Two tables would mean every "show me the documents" screen merges two
-- sources, and the lead's own page would have to know about both. `lead_id` is
-- nullable and that is the whole difference.
-- ============================================================================

create type public.crm_document_kind as enum (
  'letterhead',    -- ⚠️ the blocking one. A quotation cannot be printed without it.
  'brochure',
  'site_plan',
  'price_list',
  'legal',         -- ⚠️ NOC, approvals. Uploaded, NEVER generated — see below.
  'quotation',     -- a rendered quotation PDF
  'other'
);

create table public.crm_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  /* NULL = it belongs to the project. Set = it belongs to one lead. */
  lead_id uuid references public.crm_leads(id) on delete cascade,

  kind public.crm_document_kind not null default 'other',
  title text not null check (btrim(title) <> ''),

  /* ⚠️ UNIQUE. The path carries a uuid, so a collision cannot happen by
     accident — which is exactly why one would mean something is wrong. */
  storage_path text not null unique,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),

  uploaded_by_id uuid references public.users(id) on delete set null,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.crm_documents is
  'Files a project or a lead owns. ⚠️ Legal documents are UPLOADED, never generated — a plausible NOC with a filename is a forged government document.';

create index crm_documents_project_idx on public.crm_documents (project_id, created_at desc);
create index crm_documents_lead_idx on public.crm_documents (lead_id, created_at desc)
  where lead_id is not null;

/* ⚠️ ONE LETTERHEAD PER PROJECT. Two would mean the PDF generator picks one and
   nobody can say which — and the owner would upload a corrected letterhead and
   see the old one keep printing. */
create unique index crm_documents_one_letterhead_idx
  on public.crm_documents (project_id) where kind = 'letterhead';

alter table public.crm_documents enable row level security;

/* ⚠️ A LEAD'S DOCUMENT FOLLOWS THE LEAD, and the subquery below is how. It runs
   under the caller, so `crm_leads`'s own policy applies to it — a salesperson
   sees the documents on their own leads and nobody else's, without this file
   restating the membership rule and getting it wrong for the ninth time. */
create policy crm_documents_select on public.crm_documents
  for select using (
    case
      when lead_id is null then app.crm_is_open_to_caller()
      else exists (select 1 from public.crm_leads l where l.id = lead_id)
    end
  );

create policy crm_documents_insert on public.crm_documents
  for insert with check (
    case
      when lead_id is null then app.crm_is_open_to_caller()
      else exists (select 1 from public.crm_leads l where l.id = lead_id)
    end
  );

/* ⚠️ DELETE IS ADMIN-ONLY AND THAT IS DELIBERATE. A letterhead or a signed
   booking form removed by accident is not recoverable from this table, and the
   append-only stance is the same one `crm_lead_activity` takes. */
create policy crm_documents_delete on public.crm_documents
  for delete using (app.acting_at_least('admin'));

grant select, insert on public.crm_documents to cni_app;
grant delete on public.crm_documents to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE LETTERHEAD POINTER STAYS IN STEP
-- ----------------------------------------------------------------------------
-- ⚠️ ONE PLACE TO UPLOAD, ONE POINTER TO READ. 171 gave
-- `crm_project_settings.letterhead_path` to the PDF generator and to the
-- readiness report. Rather than asking the owner to upload in one place and set
-- a path in another — which is how they end up disagreeing — the upload
-- maintains the pointer.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_sync_letterhead()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'letterhead' then
      update public.crm_project_settings
         set letterhead_path = null, updated_at = now()
       where project_id = old.project_id;
    end if;
    return old;
  end if;

  if new.kind = 'letterhead' then
    /* ⚠️ A PROJECT MAY HAVE NO SETTINGS ROW YET — only lead-routed projects got
       one in 171. Upserting means uploading a letterhead cannot fail on a
       project nobody has configured. */
    insert into public.crm_project_settings (project_id, letterhead_path)
    values (new.project_id, new.storage_path)
    on conflict (project_id) do update
      set letterhead_path = excluded.letterhead_path, updated_at = now();
  end if;

  return new;
end;
$fn$;

create trigger crm_documents_sync_letterhead
  after insert or delete on public.crm_documents
  for each row execute function app.crm_sync_letterhead();


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_other uuid; v_lead uuid;
  v_doc uuid; v_lead_doc uuid; v_path text; n_seen integer; refused boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then raise exception '178 · no demo sales project'; end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '178 · nobody eligible'; end if;

  select u.id into v_other from public.users u
    join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.id <> v_sales and u.department_role = 'member'
     and u.is_active limit 1;

  -- 1 · ⚠️ A SALESPERSON CAN UPLOAD A PROJECT DOCUMENT, through the application's
  --     own grant. 162 and 166 both exist because a grant was assumed.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  insert into public.crm_documents
    (project_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
  values (v_project, 'letterhead', 'SELFCHECK-178 letterhead',
          'crm/selfcheck-178/letterhead.png', 'image/png', 1234, v_sales, true)
  returning id into v_doc;
  reset role;

  if v_doc is null then
    raise exception '178 · a salesperson could not upload a project document';
  end if;

  -- 2 · ⚠️ AND IT SET THE POINTER THE PDF GENERATOR READS. One upload place.
  select letterhead_path into v_path
    from public.crm_project_settings where project_id = v_project;
  if v_path is distinct from 'crm/selfcheck-178/letterhead.png' then
    delete from public.crm_documents where id = v_doc;
    raise exception '178 · uploading a letterhead did not set letterhead_path (got %)', v_path;
  end if;

  -- 3 · ⚠️ AND READINESS STOPPED COMPLAINING, which is the whole point.
  if exists (select 1 from app.crm_project_readiness(v_project) where code = 'no_letterhead') then
    delete from public.crm_documents where id = v_doc;
    raise exception '178 · readiness still reports a missing letterhead after one was uploaded';
  end if;

  -- 4 · ⚠️ ONE LETTERHEAD PER PROJECT. Two means the generator picks one and the
  --     owner watches a corrected letterhead fail to take effect.
  refused := false;
  begin
    insert into public.crm_documents
      (project_id, kind, title, storage_path, mime, size_bytes, is_test_data)
    values (v_project, 'letterhead', 'A second one',
            'crm/selfcheck-178/letterhead-2.png', 'image/png', 1234, true);
  exception when unique_violation then refused := true;
  end;
  if not refused then
    delete from public.crm_documents where project_id = v_project and is_test_data;
    raise exception '178 · a project was allowed two letterheads';
  end if;

  -- 5 · A LEAD'S document follows the lead.
  select id into v_lead from public.crm_leads
   where project_id = v_project and owner_id = v_sales and is_test_data limit 1;
  if v_lead is not null and v_other is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    insert into public.crm_documents
      (project_id, lead_id, kind, title, storage_path, mime, size_bytes, is_test_data)
    values (v_project, v_lead, 'legal', 'SELFCHECK-178 booking form',
            'crm/selfcheck-178/booking.pdf', 'application/pdf', 4321, true)
    returning id into v_lead_doc;
    reset role;

    -- ⚠️ A COLLEAGUE SEES THE PROJECT'S LETTERHEAD AND NOT THE LEAD'S PAPERS.
    set local role cni_app;
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into n_seen from public.crm_documents where id = v_lead_doc;
    reset role;
    if n_seen > 0 then
      delete from public.crm_documents where is_test_data;
      raise exception '178 · a colleague could read another salesperson''s lead document';
    end if;

    set local role cni_app;
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into n_seen from public.crm_documents where id = v_doc;
    reset role;
    if n_seen <> 1 then
      delete from public.crm_documents where is_test_data;
      raise exception '178 · a colleague could NOT read the project letterhead, which is shared';
    end if;
  end if;

  -- 6 · Removing it puts the pointer back, so readiness complains again.
  delete from public.crm_documents where id = v_doc;
  select letterhead_path into v_path
    from public.crm_project_settings where project_id = v_project;
  if v_path is not null then
    delete from public.crm_documents where is_test_data;
    raise exception '178 · deleting the letterhead left a dangling pointer';
  end if;

  delete from public.crm_documents where is_test_data;

  raise notice '178 · a salesperson can upload, the letterhead sets the pointer readiness and the PDF read, a second letterhead is refused, a lead document stays private to its owner while the project letterhead is shared, and deleting it puts the pointer back';
end $chk$;
