import 'server-only';

import { withUser } from '@/lib/db/client';

/* ⚠️ The vocabulary lives in `lib/domain/crm-documents` because the upload form
   is a client component and this module is `server-only`. Re-exported so a
   server caller has one import rather than two. */
export { DOCUMENT_KINDS, documentKindLabel, type DocumentKind } from '@/lib/domain/crm-documents';

/* ============================================================================
 * CRM DOCUMENTS — migration 178
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"Please give me some place where I can go and see all the
 * documents this project has, or documents related to leads."*
 *
 * ⚠️ NO DEFINER ANYWHERE IN THIS FILE. 178's policies are the whole access
 * model: a project document is visible to anybody who may use the desk, and a
 * LEAD's document is visible only through that lead — the policy asks
 * `crm_leads` itself, under the caller, so this layer never restates the
 * membership rule and never gets it wrong for the tenth time.
 * ========================================================================= */

export interface CrmDocument {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly leadId: string | null;
  readonly leadName: string | null;
  readonly kind: string;
  readonly title: string;
  readonly storagePath: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly uploadedByName: string | null;
  readonly createdAt: string;
}

/**
 * Everything this person may see, newest first.
 *
 * ⚠️ THE PROJECT NAME COMES FROM THE DEFINER, not a join. `projects_select`
 * asks for membership and a salesperson is a member of nothing — a join would
 * blank the project on every row and the shelf would look merely unlabelled.
 * Tenth occurrence guarded.
 */
export async function crmDocuments(actorId: string, projectId?: string | null): Promise<CrmDocument[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.id, d.project_id, d.lead_id, d.kind::text, d.title, d.storage_path,
           d.mime, d.size_bytes, d.created_at,
           app.crm_project_name(d.project_id) as project_name,
           l.full_name as lead_name,
           (select o.full_name from app.crm_lead_owners() o where o.id = d.uploaded_by_id)
             as uploaded_by_name
      from public.crm_documents d
      left join public.crm_leads l on l.id = d.lead_id
     where ${projectId ? tx`d.project_id = ${projectId}::uuid` : tx`true`}
     order by d.created_at desc
     limit 300
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: (r.project_name as string | null) ?? null,
    leadId: (r.lead_id as string | null) ?? null,
    leadName: (r.lead_name as string | null) ?? null,
    kind: String(r.kind),
    title: String(r.title),
    storagePath: String(r.storage_path),
    mime: String(r.mime),
    sizeBytes: Number(r.size_bytes ?? 0),
    uploadedByName: (r.uploaded_by_name as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/** The projects this person may file a document against. */
export async function crmDocumentProjects(
  actorId: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_project_options()
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
  }));
}

/**
 * Record an uploaded file.
 *
 * ⚠️ CALLED ONLY AFTER THE BYTES ARE IN STORAGE. A row written first would list
 * a document nobody can open, and the owner would click a letterhead that 404s.
 */
export async function crmRecordDocument(
  actorId: string,
  input: {
    projectId: string;
    leadId: string | null;
    kind: string;
    title: string;
    storagePath: string;
    mime: string;
    sizeBytes: number;
  },
): Promise<{ id: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_documents
      (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id)
    values (${input.projectId}::uuid, ${input.leadId}::uuid,
            ${input.kind}::public.crm_document_kind, ${input.title}::text,
            ${input.storagePath}::text, ${input.mime}::text,
            ${input.sizeBytes}::bigint, ${actorId}::uuid)
    returning id
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  return r ? { id: String(r.id) } : null;
}

/** Where the bytes live. ⚠️ Read back under RLS, so a path cannot be guessed. */
export async function crmDocumentPath(actorId: string, id: string): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select storage_path from public.crm_documents where id = ${id}::uuid limit 1
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  return r ? String(r.storage_path) : null;
}
