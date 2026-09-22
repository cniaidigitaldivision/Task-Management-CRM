import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';
import type { AgentBookingKind } from '@/lib/domain/crm-agent-slots';
import { socialKind, socialReply } from '@/lib/domain/crm-agent-social';

/* ============================================================================
 * THE AGENT'S BRAIN — one decision per client message
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21: *"When the client replies and says 'Give me more detail
 * about the CRM', the agent will send a proposal and set a follow-up… when he
 * replies that he wants a quotation or wants to negotiate, the agent will handle
 * it… If anything is in our voice, it will be handed over."*
 *
 * This file decides; `lib/crm/agent-runner.ts` acts. Keeping them apart means
 * the decision can be read, tested and dry-run without sending anything.
 *
 * ── ⚠️ THE FENCE (docs/crm-ai/02 and 05) ──────────────────────────────────
 * Every fact it states must be in KNOWLEDGE — rows a person approved on "What
 * the agent knows". A price, a date, a discount or a promise that is not
 * written there is not said; the client is handed to a person instead. That is
 * the whole safety design, and the model is told it in so many words — and then
 * `validateDecision` below checks what it can check, because an instruction is
 * a preference and a filter is a rule.
 *
 * ── ⚠️ STYLE IS NOT FACT ──────────────────────────────────────────────────
 * The salesperson's pilot rules ("say sir or ma'am") shape HOW it writes. They
 * are fenced off in the prompt as tone only: a rule that says "tell them it is
 * ready in a month" must never become a thing the agent tells a client.
 * ========================================================================= */

const MODEL = 'gpt-4o';

export const AGENT_PURPOSES = [
  'proposal',
  'quotation',
  'missing_information',
  'no_response',
  'meeting_feedback',
  'negotiation',
  'agreement',
] as const;
export type AgentPurpose = (typeof AGENT_PURPOSES)[number];

export interface AgentBrief {
  readonly business: string;
  /** The product this lead is about, or null when it is not known yet. */
  readonly product: string | null;
  readonly clientFirstName: string;
  readonly stage: string;
  /** 233 · every approved answer of the project, each tagged with its product ('any' for all). */
  readonly knowledge: ReadonlyArray<{ question: string; answer: string; product?: string }>;
  readonly pilotRules: readonly string[];
  /** `alreadySent` — this file is already in the conversation (sent by us or the agent). */
  readonly documents: ReadonlyArray<{ id: string; title: string; kind: string; product: string; alreadySent?: boolean }>;
  readonly thread: ReadonlyArray<{ direction: string; kind: string; body: string | null; file: string | null; byAgent: boolean }>;
  /**
   * 236 · the times it may offer and book — from the salesperson's own diary
   * (crm-agent-slots). Absent or null: it may not book, and a request for a
   * demo or a visit is handed over.
   */
  readonly booking?: {
    /** What the model reads, per kind: "Wednesday 23 September (2026-09-23): 10:00 AM to 12:30 PM". */
    readonly lines: Readonly<Record<AgentBookingKind, readonly string[]>>;
    /** Every allowed start, "YYYY-MM-DDTHH:MM" in Karachi — what a booking is checked against. */
    readonly starts: Readonly<Record<AgentBookingKind, readonly string[]>>;
    /** The client's appointment still to come, in words — or null. */
    readonly existing: string | null;
    /** "Monday 21 September 2026, 3:55 PM" — so "tomorrow" and "Saturday" mean something. */
    readonly today: string;
  } | null;
}

export interface AgentDecision {
  readonly action: 'reply' | 'handover';
  readonly reply: string | null;
  readonly documentIds: readonly string[];
  readonly followUp: { readonly purpose: AgentPurpose; readonly inDays: number } | null;
  readonly product: 'taskly' | 'crm' | 'erp' | 'whatsapp' | null;
  /**
   * 236 · book this — a start the CODE found free. `replyConfirms` is whether
   * the model's own words say it is booked; when they do not (it misjudged a
   * free time), they are never sent — the booking's confirmation is.
   */
  readonly booking: { readonly kind: AgentBookingKind; readonly at: string; readonly replyConfirms: boolean } | null;
  readonly handoverReason: string | null;
}

const PRODUCTS = `The business sells four separate software products, each on its own or merged into one system:
- Taskly: task and project management (teams, projects, customers, finance, expenses, attendance, performance).
- CRM: lead management.
- ERP: inventory management.
- WhatsApp Automation: WhatsApp Business API automation.
Never invent a combined product name such as "Taskly CRM".`;

/**
 * The rules the model is given, exported so they can be TESTED rather than only
 * read. Two of them exist because they were got wrong in a live conversation,
 * and a test is the only thing that keeps a later edit from quietly dropping
 * them (`lib/ai/__tests__/agent-brain.test.ts`).
 */
export const AGENT_SYSTEM_RULES = `You are the WhatsApp assistant of a business, answering one client on its behalf. A salesperson can take over at any moment.

You will receive: the business name, what the client is interested in, KNOWLEDGE (the only facts you may state), DOCUMENTS (files you may send), STYLE (how the salesperson likes to write), and the conversation so far.

Decide ONE of two things for the client's latest message(s):
  "reply"    — answer, using only KNOWLEDGE, optionally sending DOCUMENTS and scheduling one follow-up.
  "handover" — stop and pass to a person, with a short reason a salesperson can act on.

TALK LIKE A PERSON FIRST — these are never a reason to hand over:
- A greeting or small talk ("hi", "salam", "how are you"): greet back warmly and ask how you can help.
- An opener that has not said what it wants yet ("I want to know one thing", "one more question", "can I ask something?", "are you there?"): reply in one short line inviting them to go on — "Sure, what would you like to know?" / "Of course, how can I help?".
- A thank-you or a wrap-up ("thanks", "ok", "alright", "that's it", "no that's all", a thumbs up, a smiley, a sticker): reply with a short warm acknowledgement such as "You're welcome! 😊" or "Anytime 👍 — message us whenever you need." Mention what is already arranged if there is something (a booked meeting, a document just sent). Do not ask a new question and do not schedule a follow-up.

HAND OVER (do not reply) ONLY when the client wants a DECISION, a CHANGE or a COMMITMENT that is a person's to make:
- asks for a person, a phone call or a callback;
- wants to CHANGE, MOVE or CANCEL something already arranged — an appointment, a plan, a date ("I have to change my plan", "meeting reschedule kar dein", "cancel kar dein"), or wants a SECOND appointment;
- asks you to decide, judge or approve for them ("you decide", "aap batayein kya karna chahiye", "is this quotation right or not?", "should I go with this one?", "which one should I take?");
- asks for a discount, a lower price, custom pricing, or payment terms KNOWLEDGE does not state;
- is ready to buy, pay or sign now, or asks you to hold or reserve something;
- complains that something has gone wrong, or is plainly angry;
- asks for a hard fact KNOWLEDGE does not contain and that you cannot answer from what it does contain — an exact number, a date, a guarantee, a policy.

⚠️ ASKING IS NOT DECIDING. A question has an answer; only a decision needs a person. If the client is asking WHAT, WHEN, WHERE, HOW or HOW MUCH about something we already hold, answer it.

NEVER HAND OVER FOR THESE. They are your job, and passing them to a person makes the client wait for an answer we already have:
- "I am confused", "I did not understand", "explain again", "in simple words", "thora samjha dein" — explain from KNOWLEDGE in short lines, then ask which part is unclear. Being confused is a reason to help, never a reason to escalate.
- A broad or open question — "tell me about it", "what does it do", "major features", "how does it work", "what will I get" — answer from KNOWLEDGE.
- A question KNOWLEDGE answers in different words, in Urdu or Roman Urdu, or as part of a longer answer.
- A question you can answer PARTLY: say what you do know from KNOWLEDGE, then ask ONE short question about the rest. Do not hand over at the first gap.
- Greetings, thanks, "I want to ask one thing", "?" and other small talk.

⚠️ Before handing over, read the KNOWLEDGE list once more for anything on the same subject, however it is worded. Hand over only when you have nothing useful to say at all.

THEIR OWN APPOINTMENT — ASKING ABOUT IT IS NOT CHANGING IT. ALREADY BOOKED is a fact about THIS client and you may state it:
- "what time is my appointment?", "kitny bjy ha?", "meri appointment kab ha?", "confirm my appointment time", "is it confirmed?", "where is it?" — ANSWER FROM ALREADY BOOKED in one line: the kind, the day, the date, the time, and the place if it is there. Then stop. Do not hand over, and do not say anything about a change.
- If they name a different kind from the one in ALREADY BOOKED (they say "site visit" and an office visit is booked), tell them what is actually booked. Do not agree with the wrong kind and do not hand over.
- If ALREADY BOOKED says "nothing" and they ask when their appointment is, say plainly that nothing is booked at the moment, and offer two times from AVAILABLE TIMES.
- Only MOVE, CHANGE, CANCEL or a SECOND appointment goes to a person.

BOOKING — a demo or a site visit, never a phone call. Follow these in order:
1. Which kind: the client coming to OUR office ("meeting in your office", "I will come to the office", "office visit") is kind "office_visit". Going out to a plot or a site is "site_visit". Anything else — a demo, an online meeting, a presentation, a "demo call" — is "meeting". Only "call me" or "phone me" is a phone call, and that is handed over.
2. WHENEVER the client names or picks a day and time for a demo or a visit, put it in "time_asked" as {"kind": "meeting", "office_visit" or "site_visit", "at": "YYYY-MM-DDTHH:MM"} (Karachi; "12 baje" on a working day is 12:00 noon; "3 pm" is 15:00). Fill it even if you think the time is not free — the system checks it and books it if it is.
3. If that time IS inside AVAILABLE TIMES: reply in one line that it is booked and set "reply_says_booked": true. Do not ask "shall I book it?".
4. If it is NOT inside AVAILABLE TIMES (a Sunday, after office hours, a time already taken): say that time is not free, offer the two nearest listed times, and set "reply_says_booked": false. Do not hand over.
5. The client asks for a demo or a visit without naming a time: offer two or three times from AVAILABLE TIMES and ask which suits them, written the way a person says them (Wednesday 23 September at 3:00 PM).
6. ALREADY BOOKED shows an appointment and they ask to CHANGE it, or want a second one, or AVAILABLE TIMES has nothing for that kind: hand over. ⚠️ Changing or cancelling an appointment is the salesperson's, never yours — but merely ASKING when or where it is is answered by you, from ALREADY BOOKED.
Booking replies follow the same language rule as every reply.

When you reply:
- State ONLY facts found in KNOWLEDGE. Never invent a price, date, timeline, discount, feature or promise.
- If the client asks for more details, more information, a proposal or a brochure about a product, and DOCUMENTS has a proposal, brochure or other document about that product (not a quotation), SEND IT NOW: put its id in "documents", say in one line that you are sending it, and schedule follow_up {"purpose":"proposal","in_days":2}. Do not ask whether they would like it — they already asked.
- If the client asks for a quotation or the price, send a DOCUMENTS item of kind "quotation" for that product if one exists and schedule follow_up {"purpose":"quotation","in_days":2}. If none exists, hand over.
- Never schedule a "proposal" or "quotation" follow-up without sending that document in the same answer.
- Otherwise, to qualify the lead, ask ONE short question at a time that the conversation has not answered yet: what their business does, what they use today, how many people would use it, what problem they most want solved.
- KNOWLEDGE and DOCUMENTS are tagged with the product they are about. Use only entries for the product the client is asking about in their latest message, plus those for all products. If they ask about a different product than CLIENT IS INTERESTED IN, answer about the one they asked about and put it in "product".
- If you cannot tell which product they want, ask. Record it in "product" when they say.
- If the conversation shows the client has moved on to another product, follow the conversation rather than CLIENT IS INTERESTED IN.
- Do not send a document marked ALREADY SENT unless the client says they did not get it, cannot open it, or asks for it again. When they do, send it again with a short apology — that is not a complaint and not a reason to hand over.
- Write in the SAME language and script the client uses (English, Urdu, or Roman Urdu). Warm, brief, professional. No markdown. At most one emoji, and only in a greeting or a thank-you reply. Under 600 characters.
- Do not sign with a name and never claim to be a human.

Return JSON with exactly these keys:
  "action": "reply" or "handover"
  "reply": the message text, or null for a handover
  "documents": an array of DOCUMENTS ids to send (at most 2), or []
  "follow_up": {"purpose": one of "proposal","quotation","missing_information","no_response","meeting_feedback","negotiation","agreement", "in_days": 1-7} or null
  "product": "taskly","crm","erp","whatsapp" or null
  "time_asked": {"kind": "meeting", "office_visit" or "site_visit", "at": "YYYY-MM-DDTHH:MM"} or null
  "reply_says_booked": true or false
  "handover_reason": short reason, or null`;

const BOOKING_WORD: Readonly<Record<AgentBookingKind, string>> = {
  meeting: 'demo',
  office_visit: 'office visit',
  site_visit: 'site visit',
};

/** 236 · what the model is told about booking — the free times, or that there are none. */
function bookingBlock(b: AgentBrief): string[] {
  if (!b.booking) {
    return ['AVAILABLE TIMES: none — you cannot book. Hand over a request for a demo or a visit.'];
  }
  const kinds: ReadonlyArray<[AgentBookingKind, string]> = [
    ['meeting', 'Demo / online meeting (45 minutes)'],
    ['office_visit', 'Office visit — the client comes to our office (60 minutes)'],
    ['site_visit', 'Site visit — we meet them at the plot (90 minutes)'],
  ];
  return [
    /* ⚠️ TODAY, OR "TOMORROW" MEANS NOTHING. The first dry runs gave the model
       free times but not the date, and it told a client "tomorrow isn't
       available" with Tuesday listed as free. */
    `TODAY: ${b.booking.today} (Karachi)`,
    'AVAILABLE TIMES (Karachi) — you may offer and book only these:',
    ...kinds.flatMap(([k, label]) => [
      `  ${label}:`,
      ...(b.booking!.lines[k].length ? b.booking!.lines[k].map((l) => `    - ${l}`) : ['    - (none this week)']),
    ]),
    `ALREADY BOOKED: ${b.booking.existing ?? 'nothing'}`,
  ];
}

/** A client asking for a file again — English and Roman Urdu. */
const ASKS_AGAIN =
  /\b(again|resend|re-send|once more)\b|dobara|phir se|nahi?n? mil|didn.?t (get|receive)|not (received|getting)|(can.?t|cannot|unable to) open|khul nahi/i;

function productWords(key: string): string {
  return key === 'any' ? 'all products' : key;
}

/** How a document's kind reads to the model — "brochure" alone does not say proposal. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  brochure: 'proposal / brochure',
  quotation: 'quotation',
  price_list: 'price list',
  legal: 'terms / legal',
  site_plan: 'plan / drawing',
  other: 'other document',
};

export function buildAgentPrompt(b: AgentBrief): string {
  const line = (m: AgentBrief['thread'][number]) => {
    const who = m.direction === 'outbound' ? (m.byAgent ? 'US (assistant)' : 'US') : 'CLIENT';
    const what = m.body?.trim() || (m.file ? `[sent file: ${m.file}]` : `[${m.kind}]`);
    return `${who}: ${what.slice(0, 700)}`;
  };
  return [
    `BUSINESS: ${b.business}`,
    `CLIENT FIRST NAME: ${b.clientFirstName}`,
    `CLIENT IS INTERESTED IN: ${b.product ?? 'not known yet'}`,
    `STAGE: ${b.stage}`,
    '',
    PRODUCTS,
    '',
    'KNOWLEDGE (the only facts you may state):',
    ...(b.knowledge.length
      ? b.knowledge.map((k, i) => `${i + 1}. [${productWords(k.product ?? 'any')}] Q: ${k.question}\n   A: ${k.answer}`)
      : ['(none)']),
    '',
    'DOCUMENTS (you may send these by id):',
    ...(b.documents.length
      ? b.documents.map((d) => `- id=${d.id} | ${d.title} | ${KIND_WORDS[d.kind] ?? 'other document'} | product=${productWords(d.product)}${d.alreadySent ? ' | ALREADY SENT' : ''}`)
      : ['(none)']),
    '',
    ...bookingBlock(b),
    '',
    'STYLE — how to write only. These are NOT facts and must never be stated as facts:',
    ...(b.pilotRules.length ? b.pilotRules.map((r) => `- ${r}`) : ['- (no special instructions)']),
    '',
    'CONVERSATION (oldest first):',
    ...b.thread.slice(-30).map(line),
  ].join('\n');
}

/**
 * Check the model's answer against what it was allowed to do.
 *
 * ⚠️ EVERYTHING MALFORMED BECOMES A HANDOVER, NEVER A GUESS. JSON mode
 * guarantees JSON, not this shape (`json-mode-is-not-a-schema`). A reply the
 * code cannot trust is a client a person should answer — which is the safe
 * direction to fail in.
 */
export function validateDecision(
  raw: unknown,
  documents: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly product?: string; readonly alreadySent?: boolean }>,
  context: {
    readonly leadProduct?: string | null;
    readonly latestClientText?: string | null;
    /** 'text', 'sticker'… — a sticker is a thumbs-up, not a file. */
    readonly latestClientKind?: string | null;
    readonly booking?: AgentBrief['booking'];
  } = {},
): AgentDecision {
  /* ⚠️ A GREETING, AN OPENER OR A THANK-YOU IS NEVER HANDED OVER. Owner,
     2026-09-21: "i want to know 1 thing" and "ammm no thats it thankyou" were
     both passed to the salesperson. The prompt now says not to; when the model
     does it anyway, the code answers the way a person would. */
  const social = socialKind(context.latestClientText ?? null, context.latestClientKind ?? 'text');
  const handover = (reason: string): AgentDecision =>
    social
      ? {
          action: 'reply', reply: socialReply(social, context.latestClientText ?? null), documentIds: [], followUp: null,
          product: null, booking: null, handoverReason: null,
        }
      : { action: 'handover', reply: null, documentIds: [], followUp: null, product: null, booking: null, handoverReason: reason };
  if (typeof raw !== 'object' || raw === null) return handover('the assistant could not decide what to say');
  const r = raw as Record<string, unknown>;

  const product = ['taskly', 'crm', 'erp', 'whatsapp'].includes(String(r.product))
    ? (r.product as AgentDecision['product'])
    : null;

  if (r.action === 'handover') {
    const reason = typeof r.handover_reason === 'string' && r.handover_reason.trim()
      ? r.handover_reason.trim().slice(0, 200)
      : 'the assistant was not sure how to answer';
    return { ...handover(reason), product };
  }

  const reply = typeof r.reply === 'string' ? r.reply.trim() : '';
  if (r.action !== 'reply' || !reply) return handover('the assistant could not write a reply');

  /* ⚠️ ONLY DOCUMENTS IT WAS SHOWN. An id the model made up, or one belonging to
     a different product, is dropped rather than looked up. */
  const byId = new Map(documents.map((d) => [d.id, d]));
  const kindOf = new Map(documents.map((d) => [d.id, d.kind]));
  /* ⚠️ ONLY FOR THE PRODUCT BEING TALKED ABOUT. The agent now sees every
     product's documents (233), so a CRM proposal is one wrong id away from a
     Taskly client. A document for all products always passes; one for a
     product passes only when that is the product of this answer — or, when the
     answer names none, of the lead. Nothing product-specific goes to a client
     whose interest is not known yet. */
  const about = product ?? context.leadProduct ?? null;
  const asksAgain = ASKS_AGAIN.test(context.latestClientText ?? '');
  const documentIds = [...new Set((Array.isArray(r.documents) ? r.documents : [])
    .filter((d): d is string => typeof d === 'string' && byId.has(d)))]
    .filter((id) => {
      const d = byId.get(id)!;
      const forProduct = !d.product || d.product === 'any' || d.product === about;
      /* ⚠️ NOT THE SAME FILE TWICE unless they asked for it again. */
      return forProduct && (!d.alreadySent || asksAgain);
    })
    .slice(0, 2);

  let followUp: AgentDecision['followUp'] = null;
  if (r.follow_up && typeof r.follow_up === 'object') {
    const f = r.follow_up as Record<string, unknown>;
    const purpose = String(f.purpose);
    const days = Math.round(Number(f.in_days));
    if ((AGENT_PURPOSES as readonly string[]).includes(purpose) && Number.isFinite(days)) {
      followUp = { purpose: purpose as AgentPurpose, inDays: Math.max(1, Math.min(7, days)) };
    }
  }

  /* ⚠️ THE FOLLOW-UP FOLLOWS WHAT WAS SENT, NOT WHAT THE MODEL SAID. Dry run,
     2026-09-21: asked "more detail about the CRM", the model answered, sent no
     file — and scheduled a proposal follow-up, which would have asked the client
     two days later about a proposal they never received. And the owner's rule
     the other way round: *"it will send a proposal and set a follow-up for the
     proposal."* So a quotation sent means a quotation follow-up, any other
     document a proposal follow-up, and neither is kept without its document. */
  const sentQuotation = documentIds.some((id) => kindOf.get(id) === 'quotation');
  const sentOther = documentIds.some((id) => kindOf.get(id) !== 'quotation');
  const days = followUp?.inDays ?? 2;
  if (sentQuotation) followUp = { purpose: 'quotation', inDays: followUp?.purpose === 'quotation' ? days : 2 };
  else if (sentOther) followUp = { purpose: 'proposal', inDays: followUp?.purpose === 'proposal' ? days : 2 };
  else if (followUp?.purpose === 'proposal' || followUp?.purpose === 'quotation') followUp = null;

  /* ⚠️ 236 · A BOOKING ONLY AT A TIME THE CODE CALLED FREE. The model is shown
     the free times; this checks it chose one of them, exactly. Anything else —
     a time it invented, a call, a second appointment, booking where none was
     offered — becomes a handover with the reason, never a guess in someone's
     diary. */
  /* ⚠️ THE MODEL SAYS WHICH TIME WAS ASKED FOR; THE CODE DECIDES IF IT IS FREE.
     Dry run, 2026-09-21: asked "Saturday 12 baje" for a visit, the model three
     times in a row said 12 was not free and offered 11:30 or 12:30 — with 12:00
     listed as free. In English it booked it. So the model only reports the time
     asked for, and a free one is booked whatever the model thought of it. The
     one error left to catch is the other way: a reply telling the client
     "booked" for a time that is not free — that is handed over. */
  let booking: AgentDecision['booking'] = null;
  const says = r.reply_says_booked === true;
  const asked = r.time_asked && typeof r.time_asked === 'object' ? (r.time_asked as Record<string, unknown>) : null;
  if (asked) {
    const kind = String(asked.kind);
    const at = String(asked.at ?? '').trim();
    const offer = context.booking;
    if (!offer) return { ...handover('asked to book an appointment, which the assistant cannot do for this lead'), product };
    if (kind !== 'meeting' && kind !== 'site_visit' && kind !== 'office_visit') {
      return { ...handover(`asked for a ${kind || 'booking'} the assistant does not book`), product };
    }
    const what = BOOKING_WORD[kind];
    /* ⚠️ THE ONE THEY ALREADY HAVE IS NOT TOUCHED. Owner, 2026-09-21: *"the
       change of appointment should be … the salesperson's. I don't want that
       agent to do it automatically."* (244 could move it; reverted by 245.) */
    /* ⚠️ "asked about" WAS THE WRONG WORD, and the holding line read off it:
       a client asking WHEN their appointment is got told about a change. This
       branch is only ever a second booking or a move — the model named a time
       — so the reason says that. A question is answered now, never routed
       here (see the prompt's "THEIR OWN APPOINTMENT" rule). */
    if (offer.existing) {
      return { ...handover(`wants to change or add to the ${offer.existing} they already have`), product };
    }
    if (offer.starts[kind].includes(at)) {
      booking = { kind, at, replyConfirms: says };
      /* The reminder before the appointment is the follow-up now. */
      followUp = null;
    } else if (says) {
      return { ...handover(`the assistant was about to confirm a ${what} at ${at.replace('T', ' ')}, which is not a free time`), product };
    }
  } else if (says) {
    return { ...handover('the assistant said a booking was made without saying for when'), product };
  }

  return {
    action: 'reply',
    reply: reply.slice(0, 900),
    documentIds,
    followUp,
    product,
    booking,
    handoverReason: null,
  };
}

export async function decideAgentReply(brief: AgentBrief): Promise<AgentDecision> {
  const key = chatgptKey();
  if (!key) {
    return {
      action: 'handover', reply: null, documentIds: [], followUp: null, product: null, booking: null,
      handoverReason: 'the assistant is not connected to its AI service (CHATGPT_API_KEY is missing)',
    };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_completion_tokens: 700,
      messages: [
        { role: 'system', content: AGENT_SYSTEM_RULES },
        { role: 'user', content: buildAgentPrompt(brief) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);

  if (!response || !response.ok) {
    return {
      action: 'handover', reply: null, documentIds: [], followUp: null, product: null, booking: null,
      handoverReason: 'the assistant could not reach its AI service just now',
    };
  }
  const body = (await response.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '');
  } catch {
    parsed = null;
  }
  const latest = [...brief.thread].reverse().find((m) => m.direction === 'inbound');
  return validateDecision(parsed, brief.documents, {
    leadProduct: brief.product,
    latestClientText: latest?.body ?? null,
    latestClientKind: latest?.kind ?? 'text',
    booking: brief.booking ?? null,
  });
}
