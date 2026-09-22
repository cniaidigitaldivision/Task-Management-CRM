/* ============================================================================
 * GREETINGS, "ONE MORE THING", AND THANK-YOU — the agent talks like a person
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"a basic greeting or a basic engagement with a client is
 * not working… 'Hey I want to know one more thing.' Instead of replying … he
 * hands it over to the salesperson. … he should respond … 'Yes what do you
 * want to know now?' or 'How can I help you?' After the client wraps up, a
 * thank-you message and a response to a thank-you, such as any emoji, a smiley,
 * or a thumbs up."*
 *
 * The prompt now says so. This is the net under it: when the model still hands
 * over a message that is ONLY a greeting, an opener or a thank-you, the code
 * answers it instead — a person would never pass "thank you" to a manager.
 *
 * ⚠️ ONLY WHEN THE WHOLE MESSAGE IS SOCIAL. "ok send me the quotation" contains
 * "ok" and is a request; every word must be one of these for it to count, and
 * a thank-you never carries a question mark.
 * ========================================================================= */

export type SocialKind = 'greeting' | 'opener' | 'thanks';

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/* ⚠️ A REAL EMOJI, NOT JUST PUNCTUATION. Live, 2026-09-21: a bare "?" matched
   this and the client was told "You're welcome! 😊" twice. Punctuation alone is
   somebody wondering where we are — an opener, not a thank-you. */
const EMOJI_ONLY = /^[\s\p{Extended_Pictographic}‍️\p{P}]+$/u;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
const PUNCT_ONLY = /^[\s\p{P}]+$/u;

const FILLER = new Set([
  'amm', 'ammm', 'hmm', 'hmmm', 'umm', 'um', 'uh', 'well', 'so', 'and', 'also', 'sir', 'madam', 'maam', 'ji', 'g',
  'bhai', 'dear', 'very', 'so', 'much', 'many', 'a', 'lot', 'again', 'for', 'the', 'help', 'your', 'info',
  'information', 'jee', 'haan', 'oh',
]);

/* A thank-you or a wrap-up needs one of these… */
const THANKS_CORE = new Set([
  'thanks', 'thank', 'thanku', 'thankyou', 'thnx', 'thx', 'ty', 'tysm', 'shukriya', 'shukria', 'shukrya',
  'jazakallah', 'jazak', 'meherbani', 'ok', 'okay', 'okk', 'okkk', 'kk', 'alright', 'great', 'perfect', 'noted',
  'cool', 'fine', 'nice', 'good', 'done', 'understood', 'thats', 'theek', 'thik', 'acha', 'achha',
]);
/* …and may carry only these besides. */
const THANKS_OK = new Set([
  ...THANKS_CORE, 'you', 'u', 'allah', 'khair', 'khairan', 'all', 'right', 'it', 'that', 'is', 'no', 'nope',
  'nothing', 'else', 'bas', 'theek', 'hai', 'acha', 'achha', 'got', 'samajh', 'gaya', 'gayi', 'aa', 'ho',
  'sounds', 'ill', 'will', 'wait', 'see', 'bye', 'take', 'care', 'allah hafiz', 'hafiz', 'khuda',
]);

const GREET_CORE = new Set([
  'hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'heyy', 'salam', 'salaam', 'aoa', 'assalam', 'assalamualaikum',
  'assalamoalaikum', 'asalam', 'asalamualaikum', 'aslam', 'walaikum', 'wslm', 'morning', 'afternoon', 'evening',
]);
const GREET_OK = new Set([
  ...GREET_CORE, 'o', 'u', 'alaikum', 'alykum', 'alaykum', 'wa', 'good', 'there', 'everyone', 'team', 'how', 'are',
  'you', 'kaise', 'kese', 'hain', 'ho', 'aap',
]);

/* "I want to know one thing", "one more question", "can I ask something?",
   "ek baat poochni hai", "are you there?" — an invitation, not a question. */
const OPENERS: readonly RegExp[] = [
  /^(i\s+)?(want|wanna|would like|need)\s+to\s+(know|ask)\s+(1|one|some|a|another)?\s*(more\s+)?(thing|things|question|questions|something)$/,
  /^(i\s+have\s+)?(1|one|another|a)\s+(more\s+)?(thing|question|query)$/,
  /^(can|could|may)\s+i\s+ask\s+(you\s+)?(something|a question|1 question|one question|one thing|1 thing)?$/,
  /^are\s+you\s+there$/,
  /^(mujhe|mujhy|mjhe|mujy)?\s*(ek|aik|1)\s+(baat|sawal|cheez)\s*(poochni|puchni|pochni|janni|jan ni|karni)?\s*(hai|thi|he)?$/,
  /^(kuch|kuj)\s+(poochna|puchna|pochna|jan+na)\s*(hai|tha)?$/,
];

export function socialKind(text: string | null, kind = 'text'): SocialKind | null {
  if (kind === 'sticker') return 'thanks';
  if (kind !== 'text' || !text) return null;
  const raw = text.trim();
  if (!raw) return null;
  if (PUNCT_ONLY.test(raw)) return 'opener';
  if (EMOJI_ONLY.test(raw) && HAS_EMOJI.test(raw)) return 'thanks';
  if (raw.length > 90) return null;

  const w = words(raw).filter((x) => !FILLER.has(x));
  /* "Hey, I want to know one more thing" — the greeting in front does not make
     it a question. */
  const joined = w.filter((x) => !GREET_CORE.has(x)).join(' ');
  if (OPENERS.some((re) => re.test(joined))) return 'opener';
  if (raw.includes('?')) return null;
  if (w.length > 0 && w.some((x) => GREET_CORE.has(x)) && w.every((x) => GREET_OK.has(x))) return 'greeting';
  if (w.length > 0 && w.some((x) => THANKS_CORE.has(x)) && w.every((x) => THANKS_OK.has(x))) return 'thanks';
  return null;
}

/** Roman Urdu or English, the way the client wrote. */
function romanUrdu(text: string): boolean {
  return /\b(hai|hain|mujhe|mujhy|mjhe|aap|ap|shukriya|shukria|theek|acha|achha|ji|baat|sawal|poochni|puchni|kya|nahi|bas|kuch|ek|aik)\b/i.test(text);
}

/** The reply a person would give — used when the model hands a social message over. */
export function socialReply(kind: SocialKind, text: string | null): string {
  const urdu = romanUrdu(text ?? '');
  const salam = /\b(salam|salaam|aoa|assalam\w*|asalam\w*|aslam)\b/i.test(text ?? '');
  switch (kind) {
    case 'greeting':
      if (urdu || salam) return `${salam ? 'Wa alaikum assalam! ' : ''}Ji, batayein — main aap ki kya madad karun?`;
      return 'Hello! How can I help you today?';
    case 'opener':
      if (PUNCT_ONLY.test((text ?? '').trim())) {
        return urdu ? 'Ji, main yahin hoon — batayein, kya madad kar sakta hoon?' : 'I’m here — how can I help?';
      }
      return urdu ? 'Ji zaroor, batayein — kya jaan’na chahte hain?' : 'Sure, what would you like to know?';
    case 'thanks':
      return urdu
        ? 'Aap ka bhi shukriya! 😊 Kabhi bhi zaroorat ho to message kar dijiye ga.'
        : 'You’re welcome! 😊 Message us anytime you need anything.';
  }
}

/* ============================================================================
 * WHAT THE CLIENT IS TOLD WHEN IT HANDS OVER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"Instead of saying [nothing], 'For any change of
 * appointment our team will contact you' — this type of message must be sent to
 * the client and then handed over to the same person."*
 *
 * One line, chosen from the reason, then the salesperson takes it. Never a
 * promise about what will be done — only that a person is coming.
 *
 * ⚠️ THE REASON IS PARTLY THE MODEL'S OWN WORDS, so this matches on meaning,
 * not on an exact string, and falls back to a line that is true of every
 * handover.
 * ========================================================================= */

const HOLDING: ReadonlyArray<[RegExp, string]> = [
  /* ⚠️ A CHANGE, NOT ANY MENTION OF AN APPOINTMENT. This pattern used to be
     `appointment|visit|meeting|demo|timing|time of`, so a client who asked
     *"Meri aj appointment kitny bjy ha?"* was told, twice, that we would
     contact them about a CHANGE they had never asked for (owner, 2026-09-22).
     A question about an appointment is answered now — see the prompt's
     "THEIR OWN APPOINTMENT" rule — and only a change reaches this line. */
  [
    /reschedul|postpone|cancel|change|add to the|move it|another time|different time|second appointment|already have|shift the|tabdeel|badal/i,
    'Noted. For any change to your appointment, our team will contact you shortly to arrange it.',
  ],
  /* And if it really was only a question that the assistant could not answer
     — nothing booked, or a detail we do not hold — say THAT, not "a change". */
  [
    /appointment|visit|meeting|demo|booking|slot|timing|time of/i,
    'Let me confirm your appointment details with my colleague — they will message you shortly with the exact time.',
  ],
  [
    /discount|price|pricing|negotiat|payment terms|instal|cheaper|budget/i,
    'Thank you — our team will get back to you on this shortly.',
  ],
  [
    /voice note|audio|listen/i,
    'Thank you for the voice note — my colleague will listen to it and reply shortly.',
  ],
  [
    /photo|image|document|file|see it|cannot see/i,
    'Thank you — my colleague will look at this and reply shortly.',
  ],
  [
    /ready to buy|ready to pay|sign|book now|purchase/i,
    'That is great to hear — our team will contact you shortly to take this forward.',
  ],
  [
    /complain|upset|angry|unhappy|sorry/i,
    'I am sorry about that. Our team will contact you shortly.',
  ],
  /* ⚠️ THE GENERIC LINE GOES LAST. The model's reasons routinely end
     "…which requires a salesperson to handle", so while this sat above the
     specific topics it won every time: the Test agent drawer showed a DISCOUNT
     question answered with "I am passing you to my colleague" (2026-09-22). A
     topic line says something true about what happens next; this one is only
     for when the client simply asked for a person. */
  [
    /person|human|salesperson|colleague|call you|phone|speak to|talk to|baat|insaan/i,
    'Of course — I am passing you to my colleague. They will message you shortly.',
  ],
];

/** The one line the client gets before a person takes over. */
export function holdingLine(reason: string | null): string {
  const text = (reason ?? '').trim();
  for (const [re, line] of HOLDING) {
    if (re.test(text)) return line;
  }
  return 'Thank you — let me check this with my colleague. They will message you shortly.';
}
