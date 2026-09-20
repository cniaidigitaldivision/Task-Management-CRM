import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';

/* ============================================================================
 * TURNING A DOCUMENT INTO ANSWERS SOMEBODY CAN APPROVE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20: *"any proposals, any quotations, or any document… you have
 * to read them all. You will get basic knowledge about everything."* and, on
 * where the fifteen answers come from: *"How can I give you answers? Please ask
 * me so I can provide them."*
 *
 * So the documents are read and the answers are DRAFTED here — and every one of
 * them arrives as `draft`, with the sentence it came from attached, for a person
 * to approve, edit or reject. The model proposes; it never decides.
 *
 * ── ⚠️ EVERY ANSWER CARRIES THE LINE IT CAME FROM ──────────────────────────
 * `sourceQuote` must be text that appears in the document, because it is the
 * only way anybody can check the answer later — and because an answer whose
 * quote cannot be found in the source is, by definition, one the model made up.
 * `verifyQuotes` below drops exactly those, which is cheaper and more reliable
 * than asking the model not to do it.
 *
 * ── ⚠️ AND IT IS ASKED FOR GAPS, NOT ONLY ANSWERS ──────────────────────────
 * A knowledge base that only knows what a proposal happens to mention has holes
 * in the shape of the questions clients actually ask. The model returns those
 * separately as `gaps` — questions it could NOT answer from the document — and
 * the approval screen puts them to the owner as empty boxes to fill. That is the
 * "ask me so I can provide them" they asked for, as a finishable list rather
 * than a conversation to remember.
 * ========================================================================= */

const MODEL = 'gpt-4o';

/**
 * What this business sells — and it is not one thing.
 *
 * ⚠️ THE MODEL COINED A PRODUCT THAT DOES NOT EXIST. The first extraction named
 * every answer after **"Taskly CRM"**, a compound of two separate products,
 * because the proposal's title said CRM and the folder said Taskly. The owner
 * corrected it on 2026-09-20: *"That's not the Taskly CRM. We have three
 * separate software programs."* An agent opening with an invented product name
 * is wrong in its first sentence, and wrong in a way a client repeats back.
 *
 * ⚠️ AND THE MERGING IS THE COMMERCIAL MODEL, NOT A FOOTNOTE. *"If someone says
 * that I want all these things in one software program, we can merge them."*
 * That is the answer to "can it also do inventory?" from any conversation, so
 * the extractor is told it rather than left to infer it from a proposal that
 * only describes one product.
 */
export const PRODUCTS = {
  taskly: 'Taskly — task and project management: teams, projects, customers, finance, monthly expenses, attendance and performance management. Paid.',
  crm: 'CRM — lead management.',
  erp: 'ERP — inventory management.',
  whatsapp: 'WhatsApp Automation — WhatsApp Business API automation.',
  any: 'the business as a whole, across all of its products',
} as const;

export type ProductKey = keyof typeof PRODUCTS;

const HOUSE_RULES = `THE PRODUCTS THIS BUSINESS SELLS — each is SEPARATE software, sold on its own:
- Taskly: ${PRODUCTS.taskly}
- CRM: ${PRODUCTS.crm}
- ERP: ${PRODUCTS.erp}
- WhatsApp Automation: ${PRODUCTS.whatsapp}

Any combination of them can be merged and delivered as ONE system when a client asks for that.

NEVER invent a combined product name. There is no "Taskly CRM", no "Taskly ERP" and no "CRM Suite".
Call each product by exactly the name above. This document is about ONE of them; name only that one.`;

const SYSTEM = `You read a business document and turn it into a FAQ that a sales assistant may quote from.

Return JSON with exactly these keys:
  "entries" - an array of objects, each with:
      "question"    - a question a real client would ask, in plain English
      "answer"      - the answer, ONLY from this document, under 500 characters
      "sourceQuote" - the exact sentence or phrase FROM THE DOCUMENT that the answer rests on, copied verbatim
  "gaps"    - an array of question strings a client would very likely ask that this document does NOT answer

Rules:
- Write every answer using ONLY what this document states. Never add industry knowledge, never infer, never generalise.
- "sourceQuote" must be copied WORD FOR WORD from the document. If you cannot copy one, do not include the entry.
- Do NOT create entries about one named customer's own pricing, discount or contract terms. Those are that customer's terms, not facts about the business.
- Prefer questions about: what the product is, what is included, how it works, what the process is, timelines, support, and what is explicitly excluded.
- Answers are for WhatsApp: short, plain, no markdown, no bullet characters, no emoji.
- 8 to 20 entries. Fewer is fine if the document is thin.
- Name the product exactly as the house rules name it. Never coin a combined name.`;

export interface KnowledgeDraft {
  readonly question: string;
  readonly answer: string;
  readonly sourceQuote: string;
}

export interface Extraction {
  readonly entries: readonly KnowledgeDraft[];
  readonly gaps: readonly string[];
}

/**
 * Product names this business does not sell.
 *
 * ⚠️ THE PROMPT WAS TOLD NOT TO, AND IT DID ANYWAY. Two runs, with the rule
 * stated plainly and then stated twice, both produced *"Taskly CRM"* — a
 * compound of two separate products. The document's title says CRM, the folder
 * says Taskly, and the model helpfully joins them. So this is checked rather
 * than requested, for the same reason `verifyQuotes` exists: an instruction is
 * a preference and a filter is a rule.
 */
const INVENTED_NAMES = /\b(taskly[-\s]+(crm|erp|whatsapp)|crm[-\s]+erp|erp[-\s]+crm|taskly\s+suite|crm\s+suite)\b/i;

/** Entries naming a product that does not exist, separated from the rest. */
export function rejectInventedProducts(
  entries: readonly KnowledgeDraft[],
): { kept: KnowledgeDraft[]; invented: KnowledgeDraft[] } {
  const kept: KnowledgeDraft[] = [];
  const invented: KnowledgeDraft[] = [];
  for (const e of entries) {
    if (INVENTED_NAMES.test(e.question) || INVENTED_NAMES.test(e.answer)) invented.push(e);
    else kept.push(e);
  }
  return { kept, invented };
}

/** Letters and digits only, lower case — for comparing a quote to its source. */
function flatten(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Drop every entry whose quote is not actually in the document.
 *
 * ⚠️ THIS IS THE GUARD THAT MATTERS, AND IT IS NOT A PROMPT. A model told to
 * copy verbatim mostly does; "mostly" is not a fence. Comparing on letters and
 * digits alone forgives the things a PDF does to text — line breaks mid-sentence,
 * double spaces, a hyphen that was a line wrap — while still catching a sentence
 * that was never there.
 */
/** The shortest run of text that proves an answer came from the document. */
const PROOF = 40;

/**
 * Is a long enough run of this quote actually in the document?
 *
 * ⚠️ DEMANDING THE WHOLE QUOTE VERBATIM FAILED IN PRACTICE, AND FAILED QUIETLY.
 * Measured on the owner's proposal: twelve of fifteen answers rejected, and the
 * quotes were real — the model had appended four words ("Connect an approved
 * WhatsApp Business Platform number **to the CRM**") or tightened the
 * punctuation. A fence that rejects four true answers for every false one is not
 * a strict fence, it is a broken one, and the damage is invisible: it looks like
 * a thin document.
 *
 * So the rule is a CONTIGUOUS RUN of 40 characters — eight to ten words that
 * appear in the document exactly, in order. That is far more than an invented
 * sentence ever accidentally shares with its source, and it forgives the edges,
 * which is where a model tidies.
 */
function groundedIn(quote: string, haystack: string): boolean {
  const needle = flatten(quote);
  /* A quote of two words proves nothing — it would match almost any document. */
  if (needle.length < 24) return false;
  if (needle.length <= PROOF) return haystack.includes(needle);

  for (let i = 0; i + PROOF <= needle.length; i += 8) {
    if (haystack.includes(needle.slice(i, i + PROOF))) return true;
  }
  /* The tail, which a stride of 8 can step past. */
  return haystack.includes(needle.slice(-PROOF));
}

export function verifyQuotes(
  entries: readonly KnowledgeDraft[],
  documentText: string,
): { kept: KnowledgeDraft[]; dropped: KnowledgeDraft[] } {
  const haystack = flatten(documentText);
  const kept: KnowledgeDraft[] = [];
  const dropped: KnowledgeDraft[] = [];
  for (const entry of entries) {
    if (groundedIn(entry.sourceQuote, haystack)) kept.push(entry);
    else dropped.push(entry);
  }
  return { kept, dropped };
}

export async function extractKnowledge(
  documentText: string,
  about: string,
  /** Which of the four this document describes — named for the model, not guessed. */
  product: ProductKey = 'any',
): Promise<Extraction & {
  dropped: number;
  invented: number;
  droppedEntries: readonly KnowledgeDraft[];
  inventedEntries: readonly KnowledgeDraft[];
}> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so documents cannot be read.');

  /* ⚠️ A CEILING ON WHAT IS SENT. A 40-page proposal is more than the model can
     use in one pass and more than the owner wants to pay for; the first pages of
     a proposal carry what it offers, which is what a client asks about. */
    const text = documentText.slice(0, 24_000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: 3000,
      messages: [
        { role: 'system', content: `${SYSTEM}\n\n${HOUSE_RULES}` },
        {
          role: 'user',
          content: `THIS DOCUMENT IS ABOUT: ${PRODUCTS[product]}\nDOCUMENT: ${about}\n\n${text}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI refused the request (${response.status}). ${detail.slice(0, 160)}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '') as Record<string, unknown>;
  } catch {
    throw new Error('OpenAI returned something that is not JSON.');
  }

  /* ⚠️ READ DEFENSIVELY. JSON mode guarantees valid JSON, not the shape asked
     for — this codebase has already shipped an empty summary because a strict
     parser met a different point shape. Anything malformed is skipped, not
     thrown. */
  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const entries: KnowledgeDraft[] = [];
  for (const row of rawEntries) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const question = typeof r.question === 'string' ? r.question.trim() : '';
    const answer = typeof r.answer === 'string' ? r.answer.trim() : '';
    const sourceQuote = typeof r.sourceQuote === 'string' ? r.sourceQuote.trim() : '';
    if (!question || !answer || !sourceQuote) continue;
    entries.push({ question: question.slice(0, 300), answer: answer.slice(0, 900), sourceQuote: sourceQuote.slice(0, 600) });
  }

  const gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : [])
    .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    .map((g) => g.trim().slice(0, 300))
    .slice(0, 12);

  const verified = verifyQuotes(entries, documentText);
  const named = rejectInventedProducts(verified.kept);
  return {
    entries: named.kept,
    gaps,
    dropped: verified.dropped.length,
    invented: named.invented.length,
    /* ⚠️ RETURNED, NOT SWALLOWED. The approval screen says how many answers were
       discarded and why — an extractor that silently keeps three of fifteen
       looks like a thin document rather than a broken read. */
    droppedEntries: verified.dropped,
    inventedEntries: named.invented,
  };
}
