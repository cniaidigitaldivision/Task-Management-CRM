import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';

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
}

export interface AgentDecision {
  readonly action: 'reply' | 'handover';
  readonly reply: string | null;
  readonly documentIds: readonly string[];
  readonly followUp: { readonly purpose: AgentPurpose; readonly inDays: number } | null;
  readonly product: 'taskly' | 'crm' | 'erp' | 'whatsapp' | null;
  readonly handoverReason: string | null;
}

const PRODUCTS = `The business sells four separate software products, each on its own or merged into one system:
- Taskly: task and project management (teams, projects, customers, finance, expenses, attendance, performance).
- CRM: lead management.
- ERP: inventory management.
- WhatsApp Automation: WhatsApp Business API automation.
Never invent a combined product name such as "Taskly CRM".`;

const SYSTEM = `You are the WhatsApp assistant of a business, answering one client on its behalf. A salesperson can take over at any moment.

You will receive: the business name, what the client is interested in, KNOWLEDGE (the only facts you may state), DOCUMENTS (files you may send), STYLE (how the salesperson likes to write), and the conversation so far.

Decide ONE of two things for the client's latest message(s):
  "reply"    — answer, using only KNOWLEDGE, optionally sending DOCUMENTS and scheduling one follow-up.
  "handover" — stop and pass to a person, with a short reason a salesperson can act on.

HAND OVER (do not reply) when the client:
- asks for a person, a call, or a meeting time you cannot confirm from KNOWLEDGE;
- asks for a discount, a lower price, custom pricing, payment terms not in KNOWLEDGE, or wants to negotiate price;
- is ready to buy, pay or sign now;
- complains, is upset, or the conversation is going badly;
- asks anything whose answer is not in KNOWLEDGE.

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
- Write in the SAME language and script the client uses (English, Urdu, or Roman Urdu). Warm, brief, professional. No markdown, no emoji, under 600 characters.
- Do not sign with a name and never claim to be a human.

Return JSON with exactly these keys:
  "action": "reply" or "handover"
  "reply": the message text, or null for a handover
  "documents": an array of DOCUMENTS ids to send (at most 2), or []
  "follow_up": {"purpose": one of "proposal","quotation","missing_information","no_response","meeting_feedback","negotiation","agreement", "in_days": 1-7} or null
  "product": "taskly","crm","erp","whatsapp" or null
  "handover_reason": short reason, or null`;

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
  context: { readonly leadProduct?: string | null; readonly latestClientText?: string | null } = {},
): AgentDecision {
  const handover = (reason: string): AgentDecision => ({
    action: 'handover', reply: null, documentIds: [], followUp: null, product: null, handoverReason: reason,
  });
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

  return {
    action: 'reply',
    reply: reply.slice(0, 900),
    documentIds,
    followUp,
    product,
    handoverReason: null,
  };
}

export async function decideAgentReply(brief: AgentBrief): Promise<AgentDecision> {
  const key = chatgptKey();
  if (!key) {
    return {
      action: 'handover', reply: null, documentIds: [], followUp: null, product: null,
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
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildAgentPrompt(brief) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);

  if (!response || !response.ok) {
    return {
      action: 'handover', reply: null, documentIds: [], followUp: null, product: null,
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
  return validateDecision(parsed, brief.documents, { leadProduct: brief.product, latestClientText: latest?.body ?? null });
}
