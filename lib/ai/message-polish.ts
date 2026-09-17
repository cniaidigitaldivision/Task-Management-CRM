import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';

/* ============================================================================
 * POLISH A MESSAGE — improve the wording, shorten it, change the tone
 * ----------------------------------------------------------------------------
 * The three buttons on the owner's compose design. They rewrite what a person
 * has already written, for a message that person will still read and approve.
 *
 * ⚠️ IT REWRITES; IT DOES NOT ADD. No price, no date, no discount, no promise
 * that was not in the text it was given — the rule `lib/ai/reply-suggestion.ts`
 * learned when it invented a payment plan on a client's chat.
 *
 * ⚠️ AND IT KEEPS THE PLACEHOLDERS. `{{lead_first_name}}` is filled per client
 * at the moment of sending; a model that "helpfully" replaced it with a name
 * would freeze one client's name into a plan used for everybody.
 * ========================================================================= */

export type PolishMode = 'improve' | 'shorten' | 'warmer' | 'formal';

const INSTRUCTION: Record<PolishMode, string> = {
  improve: 'Improve the wording. Keep the meaning, the language and roughly the length.',
  shorten: 'Make it shorter and easier to read on a phone. Keep every fact.',
  warmer: 'Make the tone warmer and more personal, still professional.',
  formal: 'Make the tone more formal and businesslike.',
};

const SYSTEM = `You rewrite one short business message for a Pakistani sales team.

Rules:
- Reply with the rewritten message ONLY. No preamble, no quotes, no explanation.
- Keep the SAME language and script (English, Urdu, or Roman Urdu).
- NEVER add a price, discount, date, payment term, availability or promise that is not already in the text.
- NEVER remove or rename a {{placeholder}} — copy each one through exactly as written.
- Keep it under 1200 characters.`;

export async function polishMessage(input: {
  text: string;
  mode: PolishMode;
  channel: 'whatsapp' | 'email';
}): Promise<string> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so AI cannot rewrite this.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.3,
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${INSTRUCTION[input.mode]}\nIt is a ${input.channel === 'email' ? 'business email' : 'WhatsApp message'}.\n\n${input.text}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI refused the request (${response.status}). ${detail.slice(0, 160)}`);
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = (body.choices?.[0]?.message?.content ?? '').trim();
  if (!out) throw new Error('OpenAI returned nothing.');
  return out.slice(0, 1500);
}
