'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { decideAgentReply } from '@/lib/ai/agent-brain';
import { extractKnowledge, type ProductKey as ExtractProduct } from '@/lib/ai/knowledge-extract';
import { readPdfText } from '@/lib/crm/pdf-text';
import {
  addKnowledge,
  decideKnowledge,
  draftKnowledge,
  knowledgeBoard,
  PRODUCT_KEYS,
  saveAgentSettings,
  setDocumentProduct,
  type KnowledgeBoard,
  type ProductKey,
} from '@/lib/db/queries/crm-knowledge';
import { downloadObject } from '@/lib/storage/bucket';
import { withUser } from '@/lib/db/client';

/* ============================================================================
 * THE KNOWLEDGE BASE — what a person does to it
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20: *"give me some chatbot or something like that where I can
 * guide, instruct, or give knowledge to my AI agent."*
 *
 * ⚠️ READING A DOCUMENT NEVER APPROVES ANYTHING. Every drafted answer lands as
 * `draft` and stays unusable until a person presses Approve. That is the whole
 * arrangement: the model proposes, a person decides, and the agent may only say
 * what the person decided.
 * ========================================================================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isProduct(value: string): value is ProductKey {
  return (PRODUCT_KEYS as readonly string[]).includes(value);
}

export async function knowledgeBoardAction(projectId: string): Promise<KnowledgeBoard | null> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(projectId)) return null;
  return knowledgeBoard(user.id, projectId);
}

export async function decideKnowledgeAction(input: {
  id: string;
  status: 'approved' | 'rejected' | 'draft';
  question?: string;
  answer?: string;
  product?: string;
  expiresAt?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.id)) return { ok: false, error: 'That entry could not be found.' };
  if (input.product !== undefined && !isProduct(input.product)) {
    return { ok: false, error: 'That is not one of our products.' };
  }
  if (input.answer !== undefined && !input.answer.trim()) {
    return { ok: false, error: 'An answer cannot be empty.' };
  }

  const done = await decideKnowledge(user.id, {
    ...input,
    product: input.product as ProductKey | undefined,
  });
  if (done.ok) revalidatePath('/knowledge');
  return done;
}

export async function addKnowledgeAction(input: {
  projectId: string;
  product: string;
  question: string;
  answer: string;
  expiresAt?: string | null;
  approve?: boolean;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.projectId)) return { ok: false, error: 'That project could not be found.' };
  if (!isProduct(input.product)) return { ok: false, error: 'That is not one of our products.' };
  if (!input.question.trim() || !input.answer.trim()) {
    return { ok: false, error: 'A question and an answer are both needed.' };
  }

  const done = await addKnowledge(user.id, {
    projectId: input.projectId,
    product: input.product,
    question: input.question,
    answer: input.answer,
    expiresAt: input.expiresAt ?? null,
    /* ⚠️ A PERSON WRITING THE ANSWER IS THE APPROVAL. They are the source; asking
       them to approve their own sentence on a second screen is ceremony. */
    approve: input.approve !== false,
  });
  if (done.ok) revalidatePath('/knowledge');
  return done;
}

export interface ReadDocumentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly added?: number;
  readonly dropped?: number;
  readonly invented?: number;
  readonly gaps?: readonly string[];
}

/**
 * Read one PDF and draft answers from it.
 *
 * ⚠️ IT REPORTS WHAT IT DISCARDED. An extractor that keeps three of fifteen and
 * says nothing looks like a thin document rather than a broken read — which is
 * exactly how the two-column bug hid on 2026-09-20.
 */
export async function readDocumentAction(input: {
  projectId: string;
  documentId: string;
  /** Omitted = the document's own product (231). */
  product?: string;
}): Promise<ReadDocumentResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.projectId) || !UUID.test(input.documentId)) {
    return { ok: false, error: 'That document could not be found.' };
  }
  if (input.product !== undefined && !isProduct(input.product)) {
    return { ok: false, error: 'That is not one of our products.' };
  }

  /* ⚠️ THE PATH IS READ UNDER THE CALLER, so a document on a project they cannot
     see returns nothing rather than being read for them. */
  const rows = (await withUser(user.id, (tx) => tx`
    select d.title, d.storage_path, d.mime, d.product::text as product
      from public.crm_documents d
     where d.id = ${input.documentId}::uuid
       and d.project_id = ${input.projectId}::uuid
  `)) as Array<{ title: string; storage_path: string; mime: string; product: string }>;
  const doc = rows[0];
  if (!doc) return { ok: false, error: 'That document could not be found.' };
  if (doc.mime !== 'application/pdf') {
    return { ok: false, error: 'Only PDFs can be read for answers. It can still be sent from a lead’s Files.' };
  }
  const product = (input.product ?? doc.product) as ProductKey;

  const file = await downloadObject(doc.storage_path);
  if (!file.ok) return { ok: false, error: file.message ?? 'That file could not be read back.' };

  let text: string;
  try {
    text = await readPdfText(new Uint8Array(file.value.data), 20);
  } catch {
    return { ok: false, error: 'That file could not be opened as a PDF.' };
  }
  if (text.trim().length < 200) {
    return {
      ok: false,
      error: 'This PDF has almost no readable text — it looks like a scan. Upload the original.',
    };
  }

  let read;
  try {
    read = await extractKnowledge(text, doc.title, product as ExtractProduct);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The document could not be read.' };
  }

  const added = await draftKnowledge(
    user.id,
    input.projectId,
    input.documentId,
    product,
    read.entries.map((e) => ({ question: e.question, answer: e.answer, sourceQuote: e.sourceQuote })),
  );

  revalidatePath('/knowledge');
  return {
    ok: true,
    added,
    dropped: read.dropped,
    invented: read.invented,
    gaps: read.gaps,
  };
}

/** 232 · what a campaign sells, and who answers its new leads. */
export async function saveAgentSettingsAction(input: {
  projectId: string;
  product: string | null;
  mode: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.projectId)) return { ok: false, error: 'That project could not be found.' };
  if (input.mode !== 'off' && input.mode !== 'suggest' && input.mode !== 'agent') {
    return { ok: false, error: 'That is not a reply mode.' };
  }
  const product = input.product && ['taskly', 'crm', 'erp', 'whatsapp'].includes(input.product) ? input.product : null;
  const done = await saveAgentSettings(user.id, input.projectId, product, input.mode);
  if (done.ok) revalidatePath('/knowledge');
  return done;
}

/** 232 · correct which product a shared document is about. */
export async function setDocumentProductAction(documentId: string, product: string): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(documentId)) return { ok: false, error: 'That document could not be found.' };
  if (!isProduct(product)) return { ok: false, error: 'That is not one of our products.' };
  const ok = await setDocumentProduct(user.id, documentId, product);
  if (ok) revalidatePath('/knowledge');
  return ok ? { ok: true } : { ok: false, error: 'That document could not be changed.' };
}

/* ============================================================================
 * 248 · ASK AS A CUSTOMER
 * ----------------------------------------------------------------------------
 * Owner's design, 2026-09-22: a box on the AI Knowledge page that asks the
 * agent a question the way a client would, and shows what it would say.
 *
 * ⚠️ IT IS THE REAL AGENT, NOT A LOOK-UP. A search over the approved answers
 * would pass questions the live agent fails and fail questions it passes — and
 * the whole point of this box is to find out what a client would actually get.
 * So it builds the same brief the runner builds and calls the same
 * `decideAgentReply`.
 *
 * ⚠️ AND IT SENDS NOTHING. No lead, no WhatsApp, no run row, no follow-up:
 * this action returns the decision and ends. The thread it passes is one
 * imaginary inbound message.
 *
 * ⚠️ BOOKING IS OFF for the test, deliberately. Offering times out of a
 * salesperson's real diary to a question nobody asked would be a confusing way
 * to answer "can your CRM connect to WhatsApp?".
 * ========================================================================= */

export interface AskAgentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly answer?: string;
  readonly handover?: string;
  readonly product?: string | null;
  readonly documents?: readonly string[];
}

export async function askAgentAction(projectId: string, question: string): Promise<AskAgentResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(projectId)) return { ok: false, error: 'That project could not be found.' };
  const asked = question.trim();
  if (!asked) return { ok: false, error: 'Type a question first.' };
  if (asked.length > 500) return { ok: false, error: 'Keep the question under 500 characters.' };

  const board = await knowledgeBoard(user.id, projectId);
  if (!board) return { ok: false, error: 'That project could not be read.' };
  if (board.approvedCount === 0) {
    return {
      ok: true,
      handover: 'Nothing is approved for this project yet, so the agent would hand every question to a person.',
    };
  }

  const knowledge = board.entries
    .filter((e) => e.status === 'approved')
    .map((e) => ({ question: e.question, answer: e.answer, product: e.product }));

  const decision = await decideAgentReply({
    business: board.projectName,
    product: board.settings.product,
    clientFirstName: 'there',
    stage: 'new',
    knowledge,
    pilotRules: [],
    documents: board.documents
      .filter((d) => d.mime === 'application/pdf')
      .map((d) => ({ id: d.id, title: d.title, kind: d.kind, product: d.product })),
    thread: [{ direction: 'inbound', kind: 'text', body: asked, file: null, byAgent: false }],
    booking: null,
  });

  return {
    ok: true,
    ...(decision.action === 'reply'
      ? { answer: decision.reply ?? '' }
      : { handover: decision.handoverReason ?? 'It would hand this to a salesperson.' }),
    product: decision.product,
    documents: decision.documentIds
      .map((id) => board.documents.find((d) => d.id === id)?.title)
      .filter((t): t is string => Boolean(t)),
  };
}
