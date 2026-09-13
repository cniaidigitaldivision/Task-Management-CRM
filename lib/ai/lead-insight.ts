import 'server-only';

import { createHash } from 'node:crypto';

import { chatgptKey } from '@/lib/ai/narrative';

/* ============================================================================
 * READING ONE LEAD — Step 11
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-09: *"if I click to some lead, it will read everything about
 * it. It will tell me: this is what you have, this is what you can improve,
 * this is the way you can talk."*
 *
 * ── ⚠️ THREE THINGS, AND A DRAFT IS NEVER A SEND ───────────────────────────
 * A summary, three openers, and a first message. The message is PUT IN A BOX
 * for somebody to edit — `07-AI-PLAN.md` refuses auto-sending outright: *"One
 * bad generated message goes to a real client under the division's name."*
 *
 * ── ⚠️ WHAT LEAVES OUR SERVERS, AND WHAT DOES NOT ──────────────────────────
 * Q18, answered 2026-09-12: the owner is content for identifiers to be sent.
 * So the NAME goes — it is the one identifier a feature here actually reads,
 * because a drafted message that opens "Dear Customer" is worthless.
 *
 * ⚠️ THE PHONE NUMBER DOES NOT, and that is a deliberate narrowing of a
 * permission rather than a refusal of it. Nothing in this module reads a phone
 * number: the model never dials anyone, and no sentence it writes is improved
 * by knowing the digits. Sending it would be gratuitous — permitted, and still
 * pointless. One line below if that is ever wanted.
 *
 * ── ⚠️ AND IT IS TOLD WHAT IT MAY NOT INVENT ───────────────────────────────
 * The model is given the answers and nothing else, and is instructed to say
 * "not discussed" rather than guess. A confident sentence about a budget nobody
 * mentioned is worse than no sentence, because a salesperson will repeat it to
 * the client.
 * ========================================================================= */

const MODEL = 'gpt-4o';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM = `You are helping a salesperson at a Pakistani digital agency prepare for one enquiry.

You are given ONLY what the person actually submitted, plus any notes colleagues have written. Work from that and nothing else.

Return JSON with exactly these keys:
  "summary"       - at most two sentences on what this person wants. Plain, specific, no adjectives.
  "talkingPoints" - exactly three short strings: things to open with or ask. Each under 90 characters.
  "draftMessage"  - a first WhatsApp message, under 400 characters, in the register a Pakistani business would use. Warm, direct, no emoji.

Rules you must follow:
- NEVER invent a budget, a timeline, a price, or an availability. If it was not stated, the summary says so plainly, e.g. "budget not discussed".
- NEVER promise anything: no discounts, no delivery dates, no "we can definitely".
- If there is very little to go on, say so rather than padding.
- The draft must read as written by a person, not by a system. It may greet them by name.
- Write in English unless the enquiry itself is in Urdu or Roman Urdu, in which case match it.`;

export interface LeadInsight {
  readonly summary: string;
  readonly talkingPoints: string[];
  readonly draftMessage: string | null;
  readonly model: string;
}

/** What the model is shown. Exported so a test can assert what is NOT in it. */
export function buildLeadBrief(input: {
  fullName: string | null;
  city: string | null;
  projectName: string;
  formName: string | null;
  stage: string;
  submittedAt: string;
  answers: Record<string, unknown>;
  notes: readonly string[];
}): string {
  const lines: string[] = [];

  lines.push(`Enquiry about: ${input.projectName}`);
  if (input.formName) lines.push(`Came from: ${input.formName}`);
  lines.push(`Arrived: ${input.submittedAt.slice(0, 10)}`);
  lines.push(`Current stage: ${input.stage}`);
  if (input.fullName) lines.push(`Their name: ${input.fullName}`);
  if (input.city) lines.push(`City: ${input.city}`);

  /* ⚠️ NO PHONE NUMBER. See the header — nothing here reads one. */

  lines.push('', 'WHAT THEY ANSWERED ON THE FORM:');
  const entries = Object.entries(input.answers ?? {});
  if (entries.length === 0) {
    lines.push('  (the form captured nothing beyond their contact details)');
  } else {
    for (const [question, answer] of entries) {
      /* Meta's keys are whatever the advertiser typed, punctuation and all —
         `which__size_are_you_interested_in?_`. Turned back into words so the
         model reads a question rather than a column name. */
      const asked = question.replace(/_+/g, ' ').replace(/\s*\?\s*$/, '').trim();
      lines.push(`  ${asked}: ${String(answer)}`);
    }
  }

  if (input.notes.length > 0) {
    lines.push('', 'WHAT COLLEAGUES HAVE WRITTEN:');
    /* ⚠️ Capped. A lead with forty notes would otherwise push the whole
       conversation past the context window and cost proportionally more, and
       the oldest notes are the least useful for the next call. */
    for (const note of input.notes.slice(0, 10)) lines.push(`  - ${note}`);
  } else {
    lines.push('', 'No notes have been written yet.');
  }

  return lines.join('\n');
}

/**
 * Ask the model. Throws on failure so the caller decides whether to show the
 * error or the lead alone — a silently swallowed failure leaves somebody
 * looking at a panel that is quietly less than it should be.
 */
export async function readLead(brief: string): Promise<LeadInsight> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so a lead cannot be read.');

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      /* JSON mode — without it the model occasionally prefixes "Here you go:",
         which breaks parsing. Same reason `narrative.ts` uses it. */
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief },
      ],
      /* Short on purpose. Three fields, none of them long — and tokens are the
         bill. */
      max_completion_tokens: 700,
    }),
    /* ⚠️ Explicit, because the default is not ours to rely on: undici gives up
       at 300s and a Vercel function dies before that, so the failure would
       arrive as a dead request with no explanation. */
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    /* ⚠️ Truncated, never logged wholesale — the key can appear in an echoed
       request on some error shapes. */
    throw new Error(`OpenAI refused the request (${response.status}). ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned nothing to read.');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('OpenAI returned something that is not JSON.');
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary) throw new Error('OpenAI returned no summary.');

  /* ⚠️ Coerced rather than trusted. The model is asked for exactly three short
     strings and usually obliges; a page that assumed it always would breaks on
     the day it returns four, or an object. */
  const points = Array.isArray(parsed.talkingPoints)
    ? parsed.talkingPoints
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const draft =
    typeof parsed.draftMessage === 'string' && parsed.draftMessage.trim()
      ? parsed.draftMessage.trim()
      : null;

  return { summary, talkingPoints: points, draftMessage: draft, model: MODEL };
}

/* ⚠️ LIVES HERE, NOT IN THE ACTION, AND FOR A HARD REASON: a `'use server'`
   module may export ONLY async functions. A synchronous export beside the
   action failed the build outright — which is the good version of that mistake,
   since the alternative is a server action being reachable as an endpoint. */
/**
 * What the reading was generated FROM.
 *
 * ⚠️ MATERIAL FACTS ONLY. `next_action_at` moving by a day, or a temperature
 * being flipped, does not change what this person wants — and including them
 * would offer a paid refresh every time somebody touched the lead at all. The
 * stage IS included: a lead that has reached `negotiation` needs different
 * openers from one still at `new`.
 */
export function fingerprint(input: {
  answers: Record<string, string>;
  stage: string;
  noteCount: number;
  city: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        a: input.answers,
        s: input.stage,
        n: input.noteCount,
        c: input.city,
      }),
    )
    .digest('hex')
    .slice(0, 32);
}
