import 'server-only';

/* ============================================================================
 * THE WRITTEN ANALYSIS — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Send it to ChatGPT to make it presentable."*
 *
 * ── ⚠️ WHAT THIS MODULE IS ALLOWED TO PRODUCE ─────────────────────────────────
 * Sentences. Nothing else. The figures, the tables and the charts on the report
 * page are rendered from the database by `lib/domain/ceo-report.ts`; this call
 * supplies the commentary that sits around them.
 *
 * The reason is not stylistic. A language model asked to total a column is
 * occasionally wrong and always fluent, so a bad figure arrives in the same
 * confident voice as a good one — and on a page the CEO forwards to a client,
 * nobody re-checks it. The prompt therefore hands over totals that are already
 * computed and instructs the model not to compute.
 *
 * That instruction is a request, not a guarantee: a model can still write a number
 * we never gave it. `verifyFigures()` below is the actual enforcement — it reads
 * the returned prose back and reports any figure that is not in the fact sheet, so
 * the page can show a warning rather than the reader having to trust the prompt.
 *
 * The same reasoning rules out asking an IMAGE model to draw the report. Image
 * models render digits unreliably, so a generated "dashboard" would look finished
 * and be wrong in the one way that matters.
 *
 * ── WHY `fetch` AND NOT THE `openai` PACKAGE ──────────────────────────────────
 * Two endpoints are used. A dependency, its transitive tree and its release
 * cadence is a poor trade for that, and the REST shape is stable.
 *
 * ── THE KEY NEVER REACHES THE BROWSER ─────────────────────────────────────────
 * `server-only`, and the variable is deliberately NOT prefixed `NEXT_PUBLIC_`.
 * Every call is made from a server action or a route handler.
 * ========================================================================= */

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/* ── ⚠️ gpt-4o, AND NOT gpt-5. MEASURED, NOT GUESSED (2026-08-19) ─────────────
   gpt-5 was tried first and is the wrong tool here:

     gpt-5   — trivial prompt: 27.9s, 192 reasoning tokens. The real fact sheet:
               never returned. Node's undici gave up at its 300s header timeout
               with UND_ERR_HEADERS_TIMEOUT.
     gpt-4o  — the same fact sheet: 3.7s, 253 completion tokens, every rule
               obeyed, zero unverified figures.

   The 300s ceiling is not incidental: a Vercel function tops out there too, so the
   gpt-5 version would have failed in production rather than merely been slow.

   And the reasoning it spends that time on buys nothing. The judgements — met,
   behind, short on reels, who ranks where — are already made in
   `lib/domain/ceo-report.ts` and handed over decided. What is left is composition,
   which gpt-4o does well. Reasoning tokens would only be earning their cost if we
   were asking the model to work the figures out, which is precisely what this
   design refuses to do.

   If this is ever revisited, measure it against a real fact sheet, not a toy
   prompt — the toy prompt is what made gpt-5 look viable. */
const MODEL = 'gpt-4o';

/** Null when the owner has not set the key. The report still renders — it simply
 *  shows its figures without commentary, which is the honest degradation. */
export function chatgptKey(): string | null {
  return process.env.CHATGPT_API_KEY?.trim() || null;
}

export interface Narrative {
  /** One line, for the top of the report. */
  readonly headline: string;
  /** 2–4 short paragraphs: what happened this month. */
  readonly summary: readonly string[];
  /** What is going well, in the CEO's language. */
  readonly strengths: readonly string[];
  /** What needs a decision. Drawn from the attention list. */
  readonly risks: readonly string[];
  /** Concrete next actions. */
  readonly recommendations: readonly string[];
  /** Set when the model wrote a figure that is not in the fact sheet. */
  readonly unverifiedFigures: readonly string[];
  readonly model: string;
}

const SYSTEM = `You are writing the monthly performance commentary for the AI & Digital Division of Crescent Nova International, part of the Attari Group of Companies. Your reader is the CEO.

You will be given a FACT SHEET containing every figure for the period, already totalled and already ranked.

HARD RULES:
1. Do not calculate anything. Do not add, subtract, average, or compute percentages. Every number you write must appear verbatim in the fact sheet.
2. If a figure you want is not in the fact sheet, describe the situation in words instead of estimating it.
3. Do not reorder the rankings. They were computed deliberately.
4. Do not invent client names, people, platforms, packages or events that are not in the fact sheet.
5. Where the fact sheet says a figure is excluded or unrecorded, say so rather than glossing over it.

STYLE: Direct, specific, unhurried. Full sentences. No marketing language, no emoji, no headings inside the text, no bullet characters. Refer to projects and people by the names given. Where something is behind, say what the shortfall is and what would close it. Where nothing is wrong, say so briefly rather than manufacturing concern.

Reply with JSON only, matching exactly:
{"headline": string, "summary": [string], "strengths": [string], "risks": [string], "recommendations": [string]}

headline: one sentence, under 120 characters.
summary: 2 to 4 paragraphs.
strengths, risks, recommendations: 2 to 4 items each, one sentence each. Use an empty array only if the fact sheet genuinely supports nothing.`;

/**
 * Asks the model for the commentary. Throws on a failed call so the caller can
 * decide whether to surface the failure or render the figures alone — silently
 * swallowing it would leave the CEO looking at a report that is quietly less than
 * it should be.
 */
export async function writeNarrative(factSheet: string): Promise<Narrative> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set.');

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      /* JSON mode, so a stray sentence before the object cannot break parsing.
         Without it the model occasionally prefixes "Here is the report:". */
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `FACT SHEET\n\n${factSheet}` },
      ],
      /* `max_completion_tokens`, not `max_tokens`: the newer models reject the
         old name outright, and this one accepts both. */
      max_completion_tokens: 4000,
    }),
    /* ⚠️ An explicit timeout, because the default is not ours to rely on. Node's
       undici gives up at 300s with UND_ERR_HEADERS_TIMEOUT — which is how the
       gpt-5 attempt failed, and is also where a Vercel function dies, so the
       failure would have arrived as a dead request with no explanation. 60s is
       generous against a measured 3.7s and still returns an error the report page
       can actually show. */
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    /* ⚠️ The key can appear in an echoed request on some error shapes, so the
       body is truncated and never logged wholesale. */
    throw new Error(
      `OpenAI refused the request (${response.status}). ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (!content) {
    /* A reasoning model that spends its whole budget thinking returns an empty
       message with finish_reason 'length'. Saying that is more useful than
       "no content". */
    throw new Error(
      choice?.finish_reason === 'length'
        ? 'The model ran out of room before it finished writing. Try again.'
        : 'The model returned nothing.',
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error('The model did not return usable JSON.');
  }

  const narrative = {
    headline: str(parsed.headline) || 'Monthly performance summary',
    summary: list(parsed.summary),
    strengths: list(parsed.strengths),
    risks: list(parsed.risks),
    recommendations: list(parsed.recommendations),
    model: MODEL,
  };

  return {
    ...narrative,
    unverifiedFigures: verifyFigures(narrative, factSheet),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Tolerant of the model returning a single string where an array was asked for,
 *  which it occasionally does for a one-item section. */
function list(value: unknown): string[] {
  if (typeof value === 'string') {
    const one = value.trim();
    return one ? [one] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((s) => s.length > 0);
}

/* ----------------------------------------------------------------------------
 * THE ENFORCEMENT
 * ----------------------------------------------------------------------------
 * Rule 1 told the model not to compute. This checks whether it obeyed.
 *
 * Every run of digits in the prose is looked up in the fact sheet. Anything not
 * found is returned, and the page shows it as a caveat. The check is deliberately
 * one-directional and deliberately crude — it cannot prove the model reasoned
 * correctly, only that it did not introduce a figure from nowhere, which is the
 * failure that actually happens.
 *
 * Exported so it can be tested without a network call.
 * ------------------------------------------------------------------------- */
export function verifyFigures(
  narrative: Omit<Narrative, 'unverifiedFigures' | 'model'>,
  factSheet: string,
): string[] {
  const prose = [
    narrative.headline,
    ...narrative.summary,
    ...narrative.strengths,
    ...narrative.risks,
    ...narrative.recommendations,
  ].join(' ');

  /* ⚠️ WHOLE TOKENS, NOT SUBSTRINGS. The obvious implementation — asking whether
     the fact sheet CONTAINS the string "25" — passes for any invented figure whose
     digits happen to sit inside a larger one: "25" is inside "1250000", so an
     invented 25 would be silently approved by a fee total. A test caught exactly
     that. Both sides are therefore reduced to sets of number tokens and compared
     token to token. */
  const known = new Set((factSheet.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normalise));

  const unverified = new Set<string>();
  for (const raw of prose.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const token = raw.replace(/[.,]+$/, '');
    if (!token) continue;

    /* Small integers are skipped. "the 4 platforms", "2 to 4 items", ordinary
       counting inside a sentence — flagging those would bury a real invention in
       noise, and a figure that small is verifiable at a glance anyway. */
    if (/^\d$/.test(token)) continue;

    /* A year in a date is not a claim about performance. */
    if (/^(19|20)\d{2}$/.test(token)) continue;

    if (known.has(normalise(token))) continue;
    unverified.add(token);
  }

  return [...unverified];
}

/** Separators dropped and trailing punctuation trimmed, so PKR 1,250,000 in the
 *  sheet and 1250000 in the prose are recognised as one figure. */
function normalise(token: string): string {
  return token.replace(/[.,]+$/, '').replace(/,/g, '');
}
