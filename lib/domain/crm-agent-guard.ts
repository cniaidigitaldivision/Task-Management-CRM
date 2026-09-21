/* ============================================================================
 * WHEN THE AGENT MUST NOT EVEN TRY — decided before any model is asked
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"If anything is in our voice and all that stuff, it will be
 * handed over and a red mark will appear properly and be visible."*
 *
 * These are rules, not judgement, so they live in code where they can be tested
 * exactly — not in a prompt the model may or may not follow. Anything here
 * hands the conversation to a person at once, with the reason on the red chip
 * and in the bell.
 * ========================================================================= */

/** More agent messages than this since a person last wrote is too long alone. */
export const MAX_AGENT_RUN = 8;

const WANTS_A_PERSON = [
  /\b(call me|give me a call|phone me|ring me)\b/i,
  /\b(talk|speak|chat)\s+(to|with)\s+(a |an |some |your )?(person|human|someone|somebody|agent|representative|manager|salesperson|sales person|team)\b/i,
  /\b(real|actual)\s+(person|human)\b/i,
  /\bare you (a )?(bot|robot|machine|ai)\b/i,
  /* Roman Urdu: "baat karwa dein", "call karein", "kisi insaan se". */
  /\bbaat\s*kar(wa|wao|wa\s*dein|ain|en|ni)\b/i,
  /\bcall\s*kar(ein|en|o|lo|na|ain)\b/i,
  /\binsaan\b/i,
];

const KIND_WORDS: Record<string, string> = {
  image: 'a photo',
  video: 'a video',
  document: 'a document',
  sticker: 'a sticker',
  location: 'a location',
  contacts: 'a contact card',
  unknown: 'something the assistant cannot read',
};

export interface GuardInput {
  readonly kind: string;
  readonly body: string | null;
  readonly voice: boolean;
  /** Agent messages since a person last wrote in this thread. */
  readonly agentRunLength: number;
}

/**
 * The reason to hand over without asking the model, or null to let it answer.
 *
 * ⚠️ A FILE IS HANDED OVER EVEN WITH A CAPTION. The agent cannot see a photo or
 * read an attached PDF; answering the caption alone ("is this the one you
 * meant?") would be answering a question about something it never saw.
 */
export function handoverBeforeModel(m: GuardInput): string | null {
  if (m.kind === 'audio') {
    return m.voice ? 'sent a voice note — the assistant cannot listen to it' : 'sent an audio file';
  }
  /* ⚠️ A STICKER IS A THUMBS-UP, NOT A FILE (owner, 2026-09-21: "a response to
     a thank-you, such as any emoji, a smiley, or a thumbs up"). It goes to the
     model like any message, and crm-agent-social answers it if the model will not. */
  if (m.kind !== 'text' && m.kind !== 'sticker') {
    const what = KIND_WORDS[m.kind] ?? `a ${m.kind}`;
    return `sent ${what} — the assistant cannot see it`;
  }
  const text = (m.body ?? '').trim();
  if (!text) return 'sent an empty message';
  if (WANTS_A_PERSON.some((re) => re.test(text))) return 'asked to speak to a person';
  if (m.agentRunLength >= MAX_AGENT_RUN) {
    return `the assistant has sent ${m.agentRunLength} messages without a person — time for a salesperson`;
  }
  return null;
}
