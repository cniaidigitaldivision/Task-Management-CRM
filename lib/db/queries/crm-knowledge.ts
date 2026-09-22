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
  readonly documents: ReadonlyArray<KnowledgeDocument>;
  /** 232 · what this campaign sells, and who answers its new leads. */
  readonly settings: {
    readonly product: Exclude<ProductKey, 'any'> | null;
    readonly agentModeDefault: 'off' | 'suggest' | 'agent';
  };
  /** Approved, unexpired answers — the agent answers only when this is above 0. */
  readonly approvedCount: number;
  /**
   * 248 · What the agent actually did with this project's clients, last 90
   * days.
   *
   * ⚠️ THIS IS WHERE "READINESS" AND "GAPS" COME FROM, and it is the only
   * honest source for either. A percentage invented from the number of
   * approved answers would say a project is ready when nobody has ever asked
   * it anything. Coverage is measured: of the questions it was given, how many
   * it could answer from approved knowledge.
   */
  readonly runs: readonly AgentRun[];
  /** May this person change the campaign settings? A manager's call (232). */
  readonly canManage: boolean;
}

/** One thing the agent did, and what the client was asking about. */
export interface AgentRun {
  readonly id: string;
  readonly action: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly leadId: string;
  readonly leadName: string | null;
  /** The product the LEAD is filed under — handovers carry no detail of their own. */
  readonly product: ProductKey | null;
  /** What the client had just said, so a gap can be read as a question. */
  readonly question: string | null;
}

export interface KnowledgeDocument {
  readonly id: string;
  readonly title: string;
  readonly mime: string;
  readonly kind: string;
  readonly product: ProductKey;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly readAt: string | null;
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
    /* ⚠️⚠️ NOT `select … from public.projects`. THIS RETURNS ZERO ROWS FOR THE
       PEOPLE THIS SCREEN IS FOR. `projects_select` is
       `app.project_is_visible(id)`, which needs project MEMBERSHIP — and the
       sales team are not members of the projects whose leads they work. Measured
       as Sarah, 2026-09-20: a direct read of the demo project returned **0
       rows**, so this returned null and the screen sat on "Reading this
       project's knowledge…" for ever.

       This is the same bug `listCrmProjects` carries a warning about, and the
       same shape as the "Former member" one before it. The definer is the way to
       read a project's name from the CRM. */
    const named = (await tx`
      select app.crm_project_name(${projectId}::uuid) as name,
             app.crm_is_open_to_caller() as allowed
    `) as Array<{ name: string | null; allowed: boolean }>;
    if (!named[0]?.allowed || !named[0].name) return null;
    const project = { id: projectId, name: named[0].name };

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

    /* ⚠️ EVERY SHARED DOCUMENT, NOT ONLY PDFs. The agent reads PDFs; the
       drawer sends anything. Moved here from the Documents page (2026-09-21),
       so this is now the one place a project's sales documents are kept — the
       letterhead included, first, since every quotation prints on it. */
    const documents = (await tx`
      select d.id, d.title, d.mime, d.kind::text as kind, d.product::text as product,
             d.size_bytes, d.created_at,
             (select max(k.created_at) from public.crm_knowledge k
               where k.source_document_id = d.id) as read_at
        from public.crm_documents d
       where d.project_id = ${projectId}::uuid
         and d.lead_id is null
       order by (d.kind = 'letterhead') desc, d.created_at desc
    `) as Array<Record<string, unknown>>;

    /* ⚠️ 90 DAYS AND 500 ROWS, and the screen says so. An unbounded read of
       every run a project has ever had is the kind of query that is instant
       today and a minute wide next year (law 5). */
    const runs = (await tx`
      select r.id, r.action, r.reason, r.created_at, r.lead_id,
             l.full_name as lead_name, l.product::text as product,
             (select m.body from public.crm_lead_messages m
               where m.id = r.message_id) as question
        from public.crm_agent_runs r
        join public.crm_leads l on l.id = r.lead_id
       where l.project_id = ${projectId}::uuid
         and r.created_at >= now() - interval '90 days'
       order by r.created_at desc
       limit 500
    `) as Array<Record<string, unknown>>;

    const extra = (await tx`
      select s.product::text as product,
             coalesce(s.agent_mode_default::text, 'off') as agent_mode_default,
             app.crm_agent_ready(${projectId}::uuid) as approved,
             (app.acting_at_least('admin'::public.user_role)
              or app.crm_manages_project(${projectId}::uuid)
              or app.crm_manages_own_department()) as can_manage
        from (select 1) one
        left join public.crm_project_settings s on s.project_id = ${projectId}::uuid
    `) as Array<Record<string, unknown>>;
    const e = extra[0] ?? {};

    return {
      projectId: project.id,
      projectName: project.name,
      entries: entries.map(row),
      documents: documents.map((d) => ({
        id: String(d.id),
        title: String(d.title),
        mime: String(d.mime),
        kind: String(d.kind),
        product: String(d.product) as ProductKey,
        sizeBytes: Number(d.size_bytes ?? 0),
        createdAt: new Date(String(d.created_at)).toISOString(),
        readAt: d.read_at ? new Date(String(d.read_at)).toISOString() : null,
      })),
      settings: {
        product: (['taskly', 'crm', 'erp', 'whatsapp'].includes(String(e.product)) ? e.product : null) as
          Exclude<ProductKey, 'any'> | null,
        agentModeDefault: (['off', 'suggest', 'agent'].includes(String(e.agent_mode_default))
          ? e.agent_mode_default
          : 'off') as 'off' | 'suggest' | 'agent',
      },
      runs: runs.map((r) => ({
        id: String(r.id),
        action: String(r.action),
        reason: (r.reason as string | null) ?? null,
        createdAt: new Date(String(r.created_at)).toISOString(),
        leadId: String(r.lead_id),
        leadName: (r.lead_name as string | null) ?? null,
        product: (PRODUCT_KEYS as readonly string[]).includes(String(r.product))
          ? (String(r.product) as ProductKey)
          : null,
        question: (r.question as string | null) ?? null,
      })),
      approvedCount: Number(e.approved ?? 0),
      canManage: e.can_manage === true,
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
       is new and leaves every decision already made alone.

       ⚠️⚠️ THREE ARRAYS, NOT ONE JSON STRING. This was written as
       `json_to_recordset(${JSON.stringify(rows)}::json)` and it failed on the
       owner's first click:

           PostgresError: cannot call json_to_recordset on a scalar

       postgres.js encodes the value it is given, and a JS string bound as json
       arrives as a JSON *string* — a scalar — not as the array the text happens
       to spell. The same family as the `${'now()'}` bug: everything in a hole is
       a VALUE, and its type is decided by the driver, not by the cast written
       after it. Arrays are the shape the driver renders natively, and `unnest`
       zips them back into rows. */
    const written = (await tx`
      insert into public.crm_knowledge
        (project_id, product, question, answer, source_quote, source_document_id, status, created_by_id)
      select ${projectId}::uuid,
             ${product}::public.crm_product,
             d.question, d.answer, d.source_quote,
             ${documentId}::uuid,
             'draft',
             app.current_user_id()
        from unnest(
               ${drafts.map((d) => d.question)}::text[],
               ${drafts.map((d) => d.answer)}::text[],
               ${drafts.map((d) => d.sourceQuote)}::text[]
             ) as d(question, answer, source_quote)
      on conflict do nothing
      returning id
    `) as Array<{ id: string }>;
    return written.length;
  });
}

/** 232 · what a campaign sells, and who answers its new leads. */
export async function saveAgentSettings(
  actorId: string,
  projectId: string,
  product: string | null,
  mode: 'off' | 'suggest' | 'agent',
): Promise<{ ok: boolean; error?: string }> {
  try {
    await withUser(actorId, (tx) => tx`
      select app.crm_set_agent_settings(${projectId}::uuid, ${product}, ${mode})
    `);
    return { ok: true };
  } catch (error) {
    /* ⚠️ THE FUNCTION'S OWN SENTENCE. Both refusals (not a manager; the agent
       with nothing approved) are written for a person to read. */
    const code = (error as { code?: string }).code;
    if (code === 'CRM95' || code === 'CRM96') return { ok: false, error: (error as Error).message };
    throw error;
  }
}

/** 232 · correct which product a shared document is about. */
export async function setDocumentProduct(actorId: string, documentId: string, product: ProductKey): Promise<boolean> {
  const rows = (await withUser(actorId, (tx) => tx`
    select app.crm_set_document_product(${documentId}::uuid, ${product}) as ok
  `)) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok === true;
}
