import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';

/* ============================================================================
 * ASK AI — a draft reply to one message
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, listing WhatsApp's message menu: *"…pin or ask Meta AI."*
 * Meta AI is a phone feature with no API. The CRM's equivalent is what a
 * salesperson actually wants from it on a client's message: what does this mean,
 * and what do I say back.
 *
 * ⚠️ A DRAFT, NEVER A SEND. It goes into the reply box for a person to read,
 * change and press send — `docs/crm-ai/05-GUARDRAILS.md` and 137's rule.
 *
 * ⚠️ IN THE CLIENT'S LANGUAGE; THE MEANING IN ENGLISH. The owner's rule: speak to
 * the client in English, Urdu or Roman Urdu, mirroring them; record in English.
 * So the reply mirrors, and the explanation shown to the salesperson is English.
 *
 * ⚠️ AND IT PROMISES NOTHING. No price, discount, date or availability that is
 * not already in the conversation — a model inventing a discount on a client's
 * phone is the incident the guardrails exist for.
 * ========================================================================= */

const MODEL = 'gpt-4o';

const SYSTEM = `You help a salesperson reply to one WhatsApp message from a client of a Pakistani business.

You are given the recent conversation (oldest first; US = our side, CLIENT = the client) and the one message to reply to.

Return JSON with exactly these keys:
  "meaning" - if the message is not in English, what it says in plain English (one or two sentences). If it is already in English, null.
  "reply"   - a reply the salesperson can send, under 400 characters.

Rules for the reply:
- Write in the SAME language and script the client used: English, Urdu script, or Roman Urdu.
- Polite and professional, the way a Pakistani business writes on WhatsApp. Warm, direct. No emoji.
- NEVER invent a price, discount, payment term, date, availability or promise that is not already in the conversation.
- Do not describe how a product, payment plan, booking or process works unless those details are written in the conversation above. If the client asks about something the conversation does not answer, say you will share the details or confirm and come back to them — nothing more.
- Do not sign with a name.`;

export interface ReplySuggestion {
  readonly meaning: string | null;
  readonly reply: string;
}

export function buildReplyBrief(input: {
  leadName: string | null;
  projectName: string;
  stage: string;
  thread: ReadonlyArray<{ direction: 'inbound' | 'outbound'; body: string | null; kind: string; occurredAt: string }>;
  target: { direction: 'inbound' | 'outbound'; body: string | null; kind: string };
}): string {
  const line = (m: { direction: string; body: string | null; kind: string }) =>
    `${m.direction === 'outbound' ? 'US' : 'CLIENT'}: ${(m.body ?? `[${m.kind}]`).slice(0, 800)}`;
  return [
    `Business / project: ${input.projectName}`,
    input.leadName ? `Client: ${input.leadName}` : null,
    `Stage: ${input.stage}`,
    '',
    'RECENT CONVERSATION:',
    ...input.thread.slice(-30).map(line),
    '',
    'REPLY TO THIS MESSAGE:',
    line(input.target),
  ].filter((l) => l !== null).join('\n');
}

export async function suggestReply(brief: string): Promise<ReplySuggestion> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so AI cannot draft a reply.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
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
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 1000) : '';
  if (!reply) throw new Error('OpenAI returned no reply.');
  const meaning = typeof parsed.meaning === 'string' && parsed.meaning.trim() ? parsed.meaning.trim() : null;
  return { meaning, reply };
}
