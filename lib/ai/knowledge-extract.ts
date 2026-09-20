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
- 8 to 20 entries. Fewer is fine if the document is thin.`;

export interface KnowledgeDraft {
  readonly question: string;
  readonly answer: string;
  readonly sourceQuote: string;
}

export interface Extraction {
  readonly entries: readonly KnowledgeDraft[];
  readonly gaps: readonly string[];
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
export function verifyQuotes(
  entries: readonly KnowledgeDraft[],
  documentText: string,
): { kept: KnowledgeDraft[]; dropped: KnowledgeDraft[] } {
  const haystack = flatten(documentText);
  const kept: KnowledgeDraft[] = [];
  const dropped: KnowledgeDraft[] = [];
  for (const entry of entries) {
    const needle = flatten(entry.sourceQuote);
    /* A quote of two words proves nothing — it would match almost any document. */
    if (needle.length >= 12 && haystack.includes(needle)) kept.push(entry);
    else dropped.push(entry);
  }
  return { kept, dropped };
}

export async function extractKnowledge(
  documentText: string,
  about: string,
): Promise<Extraction & { dropped: number }> {
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
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `DOCUMENT: ${about}\n\n${text}` },
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

  const { kept, dropped } = verifyQuotes(entries, documentText);
  return { entries: kept, gaps, dropped: dropped.length };
}
