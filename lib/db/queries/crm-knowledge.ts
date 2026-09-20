import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * THE KNOWLEDGE BASE — reading and deciding
 * ----------------------------------------------------------------------------
 * 226 built the table, 227 gave every entry a product. This is how a person
 * works with it: see what was drafted from the documents, approve the true ones,
 * fix the nearly-right ones, reject the rest.
 *
 * ── ⚠️ NOTHING HERE MAY SEND A MESSAGE ─────────────────────────────────────
 * This module reads and writes rows a person is looking at. The agent reads
 * through `app.crm_knowledge_for()` instead, which returns only approved and
 * unexpired entries — one narrow door, so nothing in this file can widen what a
 * client can be told.
 * ========================================================================= */

export const PRODUCT_KEYS = ['any', 'taskly', 'crm', 'erp', 'whatsapp'] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export interface KnowledgeEntry {
  readonly id: string;
  readonly product: ProductKey;
  readonly question: string;
  readonly answer: string;
  readonly sourceQuote: string | null;
  readonly sourceTitle: string | null;
  readonly status: 'draft' | 'approved' | 'rejected';
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface KnowledgeBoard {
  readonly projectId: string;
  readonly projectName: string;
  readonly entries: readonly KnowledgeEntry[];
  /** Documents this project holds, so the screen can say what there is to read. */
  readonly documents: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly mime: string;
    readonly readAt: string | null;
  }>;
}

function row(r: Record<string, unknown>): KnowledgeEntry {
  return {
    id: String(r.id),
    product: String(r.product) as ProductKey,
    question: String(r.question),
    answer: String(r.answer),
    sourceQuote: (r.source_quote as string | null) ?? null,
    sourceTitle: (r.source_title as string | null) ?? null,
    status: String(r.status) as KnowledgeEntry['status'],
    approvedByName: (r.approved_by_name as string | null) ?? null,
    approvedAt: r.approved_at ? new Date(String(r.approved_at)).toISOString() : null,
    expiresAt: r.expires_at ? String(r.expires_at).slice(0, 10) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

export async function knowledgeBoard(actorId: string, projectId: string): Promise<KnowledgeBoard | null> {
  return withUser(actorId, async (tx) => {
    /* ⚠️ ONE WAVE. Rule Zero law 4 — the entries and the documents have no
       dependency on each other, so they do not queue behind one another.
       (Inside `withUser` they share a connection and run in series anyway, so
       they are written as two statements, not two awaits in a chain.) */
    const projects = (await tx`
      select p.id, p.name from public.projects p where p.id = ${projectId}::uuid
    `) as Array<{ id: string; name: string }>;
    const project = projects[0];
    if (!project) return null;

    const entries = (await tx`
      select k.id, k.product::text as product, k.question, k.answer,
             k.source_quote, k.status::text as status, k.approved_at, k.expires_at, k.created_at,
             d.title as source_title,
             u.full_name as approved_by_name
        from public.crm_knowledge k
        left join public.crm_documents d on d.id = k.source_document_id
        left join public.users u on u.id = k.approved_by_id
       where k.project_id = ${projectId}::uuid
       order by
         /* Drafts first: they are the only rows that need a decision. */
         case k.status when 'draft' then 0 when 'approved' then 1 else 2 end,
         k.product, k.question
    `) as Array<Record<string, unknown>>;

    const documents = (await tx`
      select d.id, d.title, d.mime,
             (select max(k.created_at) from public.crm_knowledge k
               where k.source_document_id = d.id) as read_at
        from public.crm_documents d
       where d.project_id = ${projectId}::uuid
         and d.lead_id is null
         and d.mime = 'application/pdf'
       order by d.created_at desc
    `) as Array<Record<string, unknown>>;

    return {
      projectId: project.id,
      projectName: project.name,
      entries: entries.map(row),
      documents: documents.map((d) => ({
        id: String(d.id),
        title: String(d.title),
        mime: String(d.mime),
        readAt: d.read_at ? new Date(String(d.read_at)).toISOString() : null,
      })),
    };
  });
}

/**
 * Approve, reject, or edit and approve in one move.
 *
 * ⚠️ APPROVING STAMPS WHO AND WHEN, ALWAYS. An approved entry with no approver
 * is an entry nobody can be asked about when a client quotes it back.
 */
export async function decideKnowledge(
  actorId: string,
  input: {
    id: string;
    status: 'approved' | 'rejected' | 'draft';
    question?: string;
    answer?: string;
    product?: ProductKey;
    expiresAt?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  return withUser(actorId, async (tx) => {
    const done = (await tx`
      update public.crm_knowledge
         set question = coalesce(${input.question ?? null}, question),
             answer = coalesce(${input.answer ?? null}, answer),
             product = coalesce(${input.product ?? null}, product)::public.crm_product,
             /* ⚠️ A DELIBERATE CLEAR MUST STICK. Passing null to mean "no
                expiry" and null to mean "leave it alone" are different
                intentions, and coalesce cannot tell them apart — so the caller
                omitting the field is what means "leave it alone".
                (No backticks in here: this is inside a tagged template.) */
             expires_at = case
               when ${input.expiresAt === undefined}::boolean then expires_at
               else ${input.expiresAt ?? null}::date
             end,
             status = ${input.status}::public.crm_knowledge_status,
             approved_by_id = case when ${input.status} = 'approved' then app.current_user_id() else null end,
             approved_at = case when ${input.status} = 'approved' then now() else null end,
             updated_at = now()
       where id = ${input.id}::uuid
      returning id
    `) as Array<{ id: string }>;
    return done[0] ? { ok: true } : { ok: false, error: 'That entry could not be found.' };
  });
}

/** A brand-new answer, written by a person rather than drafted from a document. */
export async function addKnowledge(
  actorId: string,
  input: {
    projectId: string;
    product: ProductKey;
    question: string;
    answer: string;
    expiresAt?: string | null;
    /** A person writing an answer IS the approval — they are the source. */
    approve: boolean;
  },
): Promise<{ ok: boolean; error?: string; id?: string }> {
  return withUser(actorId, async (tx) => {
    try {
      const done = (await tx`
        insert into public.crm_knowledge
          (project_id, product, question, answer, source_quote, status,
           approved_by_id, approved_at, expires_at, created_by_id)
        values (
          ${input.projectId}::uuid,
          ${input.product}::public.crm_product,
          ${input.question.trim()},
          ${input.answer.trim()},
          'Written by a salesperson, not taken from a document.',
          ${input.approve ? 'approved' : 'draft'}::public.crm_knowledge_status,
          case when ${input.approve}::boolean then app.current_user_id() else null end,
          case when ${input.approve}::boolean then now() else null end,
          ${input.expiresAt ?? null}::date,
          app.current_user_id()
        )
        returning id
      `) as Array<{ id: string }>;
      return { ok: true, id: done[0]?.id };
    } catch (error) {
      /* ⚠️ THE ONE ERROR WORTH NAMING. 227's index refuses the same question
         twice for one product, and "that failed" would send somebody hunting. */
      if (error instanceof Error && /crm_knowledge_one_question/.test(error.message)) {
        return { ok: false, error: 'There is already an answer to that question for this product. Edit that one instead.' };
      }
      throw error;
    }
  });
}

/** Store a batch the extractor drafted. Duplicates are skipped, not fatal. */
export async function draftKnowledge(
  actorId: string,
  projectId: string,
  documentId: string | null,
  product: ProductKey,
  drafts: ReadonlyArray<{ question: string; answer: string; sourceQuote: string }>,
): Promise<number> {
  if (drafts.length === 0) return 0;
  return withUser(actorId, async (tx) => {
    /* ⚠️ ONE STATEMENT, NOT ONE PER DRAFT. Inside `withUser` every query runs in
       series on one connection, so fifteen inserts is fifteen round trips.
       `on conflict do nothing` makes re-reading a document safe — it adds what
       is new and leaves every decision already made alone. */
    const written = (await tx`
      insert into public.crm_knowledge
        (project_id, product, question, answer, source_quote, source_document_id, status, created_by_id)
      select ${projectId}::uuid,
             ${product}::public.crm_product,
             d.question, d.answer, d.source_quote,
             ${documentId}::uuid,
             'draft',
             app.current_user_id()
        from json_to_recordset(${JSON.stringify(drafts.map((d) => ({
          question: d.question,
          answer: d.answer,
          source_quote: d.sourceQuote,
        })))}::json)
          as d(question text, answer text, source_quote text)
      on conflict do nothing
      returning id
    `) as Array<{ id: string }>;
    return written.length;
  });
}
