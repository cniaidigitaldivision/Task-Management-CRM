-- ============================================================================
-- 248 · DELETING A SOURCE TAKES ITS ANSWERS WITH IT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-22:
--
--   *"Let's also let him upload a source or delete a source. Now it's a
--   previous source. I am starting a new campaign. This information is old
--   information and I want to delete it. I want my agent to respond with the
--   latest information so I can delete the previous source or any source and
--   upload as many."*
--
-- ── ⚠️ THE TRAP A PLAIN DELETE WOULD HAVE SHIPPED ──────────────────────────
-- `crm_knowledge.source_document_id` is `ON DELETE SET NULL`. Deleting only the
-- document row would leave every answer drafted from it still APPROVED, now
-- with no source at all — and the agent would go on telling clients the old
-- information, which is the exact thing the owner is deleting it to stop.
--
-- So `app.crm_delete_source` does it as one transaction: the answers drawn
-- from the document (when asked to), the document from every follow-up step
-- that attaches it, then the document itself. It returns the storage path so
-- the app removes the file only AFTER the rows are gone — a crash between the
-- two leaves an orphaned file, never a row pointing at nothing.
--
-- ── ⚠️ WHO MAY: THE SAME PEOPLE AS BEFORE ──────────────────────────────────
-- `crm_documents_delete` and `crm_knowledge_delete` are both
-- `app.acting_at_least('admin')`. A definer bypasses RLS, so it repeats that
-- test itself rather than widening who can delete by being convenient.
--
-- ── ⚠️ TWO THINGS IT REFUSES ───────────────────────────────────────────────
-- · A LEAD'S file (lead_id set). That is a message attachment, not a project
--   source, and this screen never shows one.
-- · A project's ONLY letterhead. Every quotation prints on it; the replacement
--   goes up first.
-- ============================================================================

create or replace function app.crm_delete_source(p_document uuid, p_with_answers boolean default true)
returns table (
  storage_path     text,
  title            text,
  approved_removed integer,
  drafts_removed   integer,
  steps_detached   integer
)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  d record;
  n_approved integer := 0;
  n_drafts integer := 0;
  n_steps integer := 0;
begin
  if not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an admin can delete a source.' using errcode = 'CR248';
  end if;

  select x.id, x.project_id, x.lead_id, x.kind::text as kind, x.title, x.storage_path
    into d
    from public.crm_documents x
   where x.id = p_document
   for update;

  if not found then
    raise exception 'That source no longer exists.' using errcode = 'CR248';
  end if;
  if d.lead_id is not null then
    raise exception 'That file belongs to a conversation, not to the project''s sources.' using errcode = 'CR248';
  end if;
  if d.kind = 'letterhead' and not exists (
    select 1 from public.crm_documents o
     where o.project_id = d.project_id and o.kind = 'letterhead' and o.lead_id is null and o.id <> d.id
  ) then
    raise exception 'This is the project''s only letterhead, and every quotation prints on it. Upload the new one first.'
      using errcode = 'CR248';
  end if;

  if p_with_answers then
    select count(*) filter (where k.status = 'approved'), count(*) filter (where k.status = 'draft')
      into n_approved, n_drafts
      from public.crm_knowledge k
     where k.source_document_id = d.id;
    delete from public.crm_knowledge k where k.source_document_id = d.id;
  end if;

  /* ⚠️ A STEP THAT ATTACHES IT STOPS ATTACHING IT. The sender already skips a
     missing id (it joins crm_documents), but a step listing a file that no
     longer exists is a promise the screen would keep making. */
  update public.crm_sequence_steps s
     set document_ids = array_remove(s.document_ids, d.id)
   where d.id = any (s.document_ids);
  get diagnostics n_steps = row_count;

  delete from public.crm_documents x where x.id = d.id;

  return query select d.storage_path, d.title, n_approved, n_drafts, n_steps;
end;
$fn$;

grant execute on function app.crm_delete_source(uuid, boolean) to public;

-- ============================================================================
-- SELF-CHECK — against throwaway rows, every one of which is gone at the end
-- ============================================================================
do $chk$
declare
  v_admin uuid;
  v_member uuid;
  v_project uuid;
  v_doc uuid;
  v_doc2 uuid;
  r record;
  n integer;
begin
  select u.id into v_admin from public.users u where u.is_active and u.role in ('admin', 'super_admin') limit 1;
  select u.id into v_member from public.users u where u.is_active and u.role = 'member' limit 1;
  select p.id into v_project from public.projects p
   where exists (select 1 from public.crm_leads l where l.project_id = p.id) limit 1;

  if v_admin is null or v_project is null then
    raise notice '248 · ⚠ no admin or no CRM project to check against — shape only, behaviour NOT checked';
    return;
  end if;

  /* A source with one approved and one draft answer drawn from it. */
  insert into public.crm_documents (project_id, kind, title, storage_path, mime, size_bytes, is_test_data)
  values (v_project, 'brochure', '248 self-check', '248-self-check/none.pdf', 'application/pdf', 1, true)
  returning id into v_doc;
  insert into public.crm_knowledge (project_id, question, answer, source_document_id, status, approved_at, is_test_data)
  values (v_project, '248 q1', '248 a1', v_doc, 'approved', now(), true),
         (v_project, '248 q2', '248 a2', v_doc, 'draft', null, true);

  /* ── A member is refused, and nothing moves ──────────────────────────── */
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    begin
      perform * from app.crm_delete_source(v_doc, true);
      raise exception '248 · a member deleted a source' using errcode = 'CR248';
    exception when sqlstate 'CR248' then
      if sqlerrm = '248 · a member deleted a source' then raise; end if;
    end;
    select count(*) into n from public.crm_documents where id = v_doc;
    if n <> 1 then raise exception '248 · the refused delete still removed the row' using errcode = 'CR248'; end if;
  else
    raise notice '248 · ⚠ no member account — the refusal was NOT checked';
  end if;

  /* ── An admin deletes it, and the answers go too ─────────────────────── */
  perform set_config('app.user_id', v_admin::text, true);
  select * into r from app.crm_delete_source(v_doc, true);
  if r.approved_removed <> 1 or r.drafts_removed <> 1 then
    raise exception '248 · expected 1 approved + 1 draft removed, got % + %', r.approved_removed, r.drafts_removed
      using errcode = 'CR248';
  end if;
  select count(*) into n from public.crm_knowledge where source_document_id = v_doc or question like '248 q%';
  if n <> 0 then
    raise exception '248 · % answer(s) outlived their source — the agent would still say them', n using errcode = 'CR248';
  end if;
  select count(*) into n from public.crm_documents where id = v_doc;
  if n <> 0 then raise exception '248 · the source row survived' using errcode = 'CR248'; end if;
  raise notice '248 · ✓ deleting a source removed it and both answers drawn from it';

  /* ── Keeping the answers keeps them ──────────────────────────────────── */
  insert into public.crm_documents (project_id, kind, title, storage_path, mime, size_bytes, is_test_data)
  values (v_project, 'brochure', '248 self-check 2', '248-self-check/none2.pdf', 'application/pdf', 1, true)
  returning id into v_doc2;
  insert into public.crm_knowledge (project_id, question, answer, source_document_id, status, is_test_data)
  values (v_project, '248 keep', '248 keep', v_doc2, 'approved', true);
  select * into r from app.crm_delete_source(v_doc2, false);
  select count(*) into n from public.crm_knowledge where question = '248 keep';
  if n <> 1 then raise exception '248 · "keep the answers" did not keep them' using errcode = 'CR248'; end if;
  delete from public.crm_knowledge where question = '248 keep';
  raise notice '248 · ✓ keeping the answers keeps them (and the throwaway is cleaned up)';

  perform set_config('app.user_id', '', true);
  raise notice '248 · ✓ deleting a source takes its answers with it; admins only, as before';
end
$chk$;
