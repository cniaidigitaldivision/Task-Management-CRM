import 'server-only';

import { chatgptKey } from '@/lib/ai/narrative';
import type { CrmSummaryPoint, CrmSummaryPointKind } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * SUMMARISING ONE CONVERSATION — migration 180
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"the AI will also summarize my chat. I want there to be a
 * summary of my chat that will be auto-summarized."* And the headings are theirs,
 * from the message before: *"I have told him this, I have heard this, and we are
 * in agreement on this."*
 *
 * ── ⚠️ ALWAYS ENGLISH, WHATEVER THE CONVERSATION WAS IN ───────────────────
 * The owner's standing rule for anything recorded (`06-CONVERSATION-MEMORY.md`):
 * speak to the client in English, Urdu or Roman Urdu, record in English. A
 * summary half in Roman Urdu cannot be searched or compared with the next one.
 *
 * ── ⚠️ "AGREED" MEANS BOTH SIDES SAID YES ──────────────────────────────────
 * The one heading a model will over-fill. "I can do Sunday" is a proposal until
 * the other side accepts it, and a salesperson who reads "Agreed: visit on
 * Sunday" will turn up for a visit the client never confirmed. The prompt says
 * so explicitly, and the headings exist to keep a proposal out of that list.
 *
 * ── ⚠️ WHAT IS SENT, AND WHAT IS NOT ───────────────────────────────────────
 * The message bodies, which side said each one, the channel and the date — the
 * minimum a summary needs. NOT the phone number, which no sentence here is
 * improved by (the same narrowing `lead-insight.ts` makes). NOT a message that
 * FAILED to send: the client never saw it, and a summary built on it would say
 * we told them something we did not.
 * ========================================================================= */

const MODEL = 'gpt-4o';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/* ⚠️ The newest sixty. A three-week thread can run to hundreds of messages, and
   past a point every extra one is cost with no change to what the next call
   needs; the notes carry the older history a salesperson thought worth keeping. */
const MAX_MESSAGES = 60;
const MAX_BODY = 1_000;

const SYSTEM = `You summarise one sales conversation for the salesperson who owns it, so the next call starts from what has already been said.

The conversation may be in English, Urdu, or Roman Urdu. ALWAYS WRITE IN ENGLISH, whatever language the messages were in. Translate faithfully. Keep figures, prices, dates, plot numbers and names exactly as they were said.

Lines marked US are our side. Lines marked CLIENT are the client. Notes are written by our salesperson and are our side's own account of calls that are not in the messages.

Return JSON with exactly these keys:
  "overview" - two or three plain sentences: what they want, where it stands now, and what is waiting on whom.
  "points"   - an array of {"kind": ..., "text": ...} objects, where kind is exactly one of:
      "we_said"   - what our side told them: prices quoted, terms explained, things sent or promised
      "they_said" - what they told us: needs, budget, objections, constraints, what they asked for
      "agreed"    - something BOTH sides clearly accepted: a visit, a call time, a price, a next step
      "open"      - a question they asked that nobody has answered yet, or a decision still pending
    One fact per point, each under 140 characters, at most 5 per kind. Leave a kind out rather than padding it.

The shape, exactly — every point is an object with BOTH a "kind" key and a "text" key:
  {"overview": "...", "points": [{"kind": "we_said", "text": "..."}, {"kind": "they_said", "text": "..."}]}

Rules you must follow:
- Use ONLY what is in the messages and notes. Never invent a price, a date, a budget, a name or an agreement.
- "agreed" requires both sides to have said yes. If only one side proposed it, it belongs under "we_said" or "they_said".
- When one side proposed something and the other side accepted it, write it ONCE under "agreed" — not as a "we_said" and a "they_said" point.
- Anything we said we would check or come back on, and anything they asked that we have not answered, goes under "open".
- The overview obeys the same rule. A client asking to be called is a REQUEST, not a scheduled call. Never write "scheduled", "confirmed", "booked" or "agreed" unless both sides said yes in the messages.
- If the conversation is only greetings or an automatic reply, say that plainly in the overview and return few or no points.
- No advice, no recommendations, no adjectives about the client, no emoji.`;

export interface SummaryMessage {
  readonly direction: 'inbound' | 'outbound';
  readonly channel: string;
  readonly subject: string | null;
  readonly body: string | null;
  readonly mediaFilename: string | null;
  readonly status: string | null;
  readonly occurredAt: string;
  readonly sentByName: string | null;
}

/** What the model is shown. Exported so a test can pin what is — and is not — in it. */
export function buildConversationBrief(input: {
  leadName: string | null;
  projectName: string;
  stage: string;
  messages: readonly SummaryMessage[];
  notes: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push(`Project: ${input.projectName}`);
  if (input.leadName) lines.push(`Client: ${input.leadName}`);
  lines.push(`Current stage: ${input.stage}`);

  /* ⚠️ A FAILED SEND NEVER REACHED THEM, so it is not something we said. */
  const delivered = input.messages.filter((m) => m.status !== 'failed');
  const shown = delivered.slice(-MAX_MESSAGES);

  lines.push('', 'MESSAGES, OLDEST FIRST:');
  if (delivered.length > shown.length) {
    lines.push(`  (${delivered.length - shown.length} earlier messages not shown)`);
  }
  for (const m of shown) {
    const when = new Date(m.occurredAt).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Karachi',
    });
    const who = m.direction === 'outbound' ? `US${m.sentByName ? ` (${m.sentByName})` : ''}` : 'CLIENT';
    const channel = m.channel === 'email' ? 'Email' : 'WhatsApp';
    const text = (m.body ?? '').trim().slice(0, MAX_BODY);
    const parts = [
      m.subject ? `subject "${m.subject}"` : null,
      text || null,
      m.mediaFilename ? `[attachment: ${m.mediaFilename}]` : null,
    ].filter(Boolean);
    lines.push(`[${when} · ${channel} · ${who}] ${parts.join(' — ') || '[no text]'}`);
  }

  if (input.notes.length > 0) {
    lines.push('', "OUR SALESPERSON'S NOTES, NEWEST FIRST:");
    for (const note of input.notes.slice(0, 10)) lines.push(`  - ${note.slice(0, MAX_BODY)}`);
  }

  return lines.join('\n');
}

/**
 * What the summary was written FROM. The screen computes the same thing from
 * the thread it holds, so "is this current?" needs no round trip.
 */
export function summaryFingerprint(input: {
  messageCount: number;
  lastMessageId: string | null;
  noteCount: number;
}): string {
  return `${input.messageCount}:${input.lastMessageId ?? '-'}:${input.noteCount}`;
}

export interface WrittenSummary {
  readonly overview: string;
  readonly points: CrmSummaryPoint[];
  readonly model: string;
}

const KINDS: readonly CrmSummaryPointKind[] = ['we_said', 'they_said', 'agreed', 'open'];

/**
 * Ask the model. Throws, so the action reports WHICH thing went wrong — no key,
 * a refusal, a timeout — rather than a summary panel that quietly stays empty.
 */
export async function summariseConversation(brief: string): Promise<WrittenSummary> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so the conversation cannot be summarised.');

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief },
      ],
      max_completion_tokens: 900,
      /* ⚠️ Low, not zero. The same thread should read the same way twice —
         `06-CONVERSATION-MEMORY.md`'s objection to summaries was exactly that
         they come out different every time. */
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI refused the request (${response.status}). ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned nothing to read.');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('OpenAI returned something that is not JSON.');
  }

  const overview = typeof parsed.overview === 'string' ? parsed.overview.trim() : '';
  if (!overview) throw new Error('OpenAI returned no overview.');

  /* ⚠️ Coerced, never trusted — an unknown kind, a non-string, or a sixth point
     under one heading are dropped rather than rendered.

     ⚠️ AND BOTH SHAPES ARE READ. Asked for {"kind", "text"}, gpt-4o's first live
     answer (2026-09-17, the demo lead) came back as {"we_said": "..."} — kind as
     the KEY. JSON mode guarantees JSON, not the schema. The strict parser dropped
     every point without a word, and the summary rendered as an overview with no
     headings under it: correct-looking, and missing its whole point. The prompt
     now shows the shape; this reads either, so the next drift is not silent. */
  const perKind = new Map<CrmSummaryPointKind, number>();
  const points = (Array.isArray(parsed.points) ? parsed.points : []).flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const keyed = KINDS.find((k) => typeof o[k] === 'string');
    const kind = KINDS.includes(o.kind as CrmSummaryPointKind)
      ? (o.kind as CrmSummaryPointKind)
      : keyed;
    const raw = typeof o.text === 'string' ? o.text : keyed ? (o[keyed] as string) : null;
    if (!kind || raw === null) return [];
    const text = raw.trim().slice(0, 240);
    const n = perKind.get(kind) ?? 0;
    if (!text || n >= 5) return [];
    perKind.set(kind, n + 1);
    return [{ kind, text }];
  });

  return { overview, points, model: MODEL };
}
