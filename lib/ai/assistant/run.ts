import 'server-only';

import { chatgptKey, verifyFigures } from '@/lib/ai/narrative';
import { TOOLS_BY_NAME, toolSchemas, type ToolContext } from '@/lib/ai/assistant/tools';
import { systemPrompt, type PromptContext } from '@/lib/ai/assistant/prompt';
import type { ChartSpec } from '@/lib/domain/report-charts';
import type { Actor } from '@/lib/domain/permissions';
import type { Role } from '@/lib/domain/constants';

/* ============================================================================
 * ASKING THE ASSISTANT
 * ----------------------------------------------------------------------------
 * One question in, one answer out. Between them the model may ask for tools,
 * which are run here — under the asker's identity — and handed back.
 *
 * ── ⚠️ BUILT ON lib/ai/narrative.ts, WHICH ALREADY LEARNED THIS ────────────
 * Everything about the HTTP call follows that module, including the parts that
 * look arbitrary:
 *
 *   gpt-4o                  measured, not chosen. gpt-5 never returned on a
 *                           real prompt — it died at undici's 300s header
 *                           timeout, which is also where a Vercel function
 *                           dies, so it would have failed in production rather
 *                           than merely been slow.
 *   raw fetch               two endpoints do not justify a dependency tree.
 *   max_completion_tokens   newer models reject the old `max_tokens` name.
 *   AbortSignal.timeout     the default is not ours to rely on.
 *   detail.slice(0, 300)    the API key can appear in an echoed request body
 *                           on some error shapes. Never log one wholesale.
 *
 * ── ⚠️ THE MODEL COMPOSES; IT NEVER COMPUTES ───────────────────────────────
 * narrative.ts states the governing rule: *"a language model asked to total a
 * column is occasionally wrong and always fluent."* Tools return figures the
 * domain layer already worked out, the prompt forbids arithmetic, and
 * `verifyFigures` reads the answer back and reports any number that did not
 * come from a tool result. The first two are requests; the third is the
 * enforcement, and it is reused here unchanged.
 * ========================================================================= */

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

/* ── ⚠️ A CEILING ON TOOL ROUNDS ────────────────────────────────────────────
   Each round is a full model call. Without a cap, a model that keeps asking
   for one more lookup turns a 4-second question into a 40-second one and
   spends the budget doing it. Four is comfortably more than any real question
   here has needed — most take two. */
const MAX_ROUNDS = 4;

/* Per million tokens, gpt-4o, 2026-08. Stored per message so the usage screen
   shows real spend; update these together if the model changes. */
const USD_PER_INPUT_TOKEN = 2.5 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 10 / 1_000_000;

export interface AskInput {
  readonly actorId: string;
  readonly role: Role;
  readonly fullName: string;
  readonly question: string;
  readonly today: string;
  readonly nowMs: number;
  /** Earlier turns in this thread, oldest first, so follow-ups make sense. */
  readonly history?: readonly { role: 'user' | 'assistant'; content: string }[];
}

export interface AskResult {
  readonly answer: string;
  readonly chart: ChartSpec | null;
  readonly toolsUsed: readonly string[];
  readonly unverifiedFigures: readonly string[];
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}

type Message = Record<string, unknown>;

/**
 * Ask a question and get an answer.
 *
 * Throws on a failed call so the action can decide whether to surface it —
 * swallowing it would leave somebody looking at a blank reply with no reason.
 */
export async function ask(input: AskInput): Promise<AskResult> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so the assistant cannot answer.');

  const started = Date.now();

  const actor: Actor = { id: input.actorId, role: input.role };
  const ctx: ToolContext = {
    actorId: input.actorId,
    actor,
    today: input.today,
    nowMs: input.nowMs,
  };

  const promptCtx: PromptContext = {
    fullName: input.fullName,
    role: input.role,
    today: input.today,
  };

  const messages: Message[] = [
    { role: 'system', content: systemPrompt(promptCtx) },
    /* ⚠️ History is trimmed to the last few turns. A long thread otherwise
       grows the prompt without bound, and the older turns rarely change the
       answer — the tools are re-run either way, so nothing goes stale. */
    ...(input.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.question },
  ];

  const toolsUsed: string[] = [];
  /* Every tool result, kept so `verifyFigures` can check the answer's numbers
     against what was actually fetched. */
  const evidence: string[] = [];

  /* ⚠️ One memo per question, not a shared cache. Two people asking the same
     thing are entitled to different data, so a cache across askers would be an
     RLS bypass wearing a performance costume. Within one question, the same
     tool with the same arguments cannot return two different things, so
     running it twice is pure waste. */
  const memo = new Map<string, string>();

  let promptTokens = 0;
  let completionTokens = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const isLast = round === MAX_ROUNDS - 1;

    const payload = await callModel(key, {
      model: MODEL,
      messages,
      /* ⚠️ Tools are withheld on the final round, which forces an answer. Left
         available, a model that wants a fifth lookup returns another tool call
         and the loop exits with nothing to show. */
      ...(isLast
        ? { response_format: { type: 'json_object' } }
        : { tools: toolSchemas(), tool_choice: 'auto' }),
      max_completion_tokens: 2000,
    });

    promptTokens += payload.usage?.prompt_tokens ?? 0;
    completionTokens += payload.usage?.completion_tokens ?? 0;

    const choice = payload.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error('The model returned nothing.');

    const calls = message.tool_calls ?? [];

    if (calls.length === 0) {
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      if (!content) {
        throw new Error(
          choice?.finish_reason === 'length'
            ? 'The model ran out of room before it finished. Try a narrower question.'
            : 'The model returned nothing.',
        );
      }

      const parsed = parseAnswer(content);
      const factSheet = evidence.join('\n');

      return {
        answer: parsed.answer,
        chart: parsed.chart,
        toolsUsed,
        /* ⚠️ Checked against the TOOL RESULTS, not against the question. The
           same enforcement narrative.ts applies to the monthly report, and it
           compares whole number tokens rather than substrings — "25" sits
           inside "1250000", so a substring check silently approves an invented
           figure. A test caught exactly that. */
        unverifiedFigures: evidence.length
          ? verifyFigures(
              {
                headline: parsed.answer,
                summary: [],
                strengths: [],
                risks: [],
                recommendations: [],
              },
              factSheet,
            )
          : [],
        model: MODEL,
        promptTokens,
        completionTokens,
        costUsd: promptTokens * USD_PER_INPUT_TOKEN + completionTokens * USD_PER_OUTPUT_TOKEN,
        latencyMs: Date.now() - started,
      };
    }

    /* The assistant turn that asked for the tools has to go back verbatim, or
       the follow-up messages have nothing to attach to. */
    messages.push(message as Message);

    for (const call of calls) {
      const name = call.function?.name ?? '';
      const tool = TOOLS_BY_NAME.get(name);

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: `There is no tool called "${name}".` }),
        });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        /* A malformed argument object is the model's mistake, not a crash. */
        args = {};
      }

      const cacheKey = `${name}:${JSON.stringify(args)}`;
      let result = memo.get(cacheKey);

      if (result === undefined) {
        try {
          /* ⚠️ `ctx` — the actor id came from the session, never from `args`.
             There is no shape of model output that can ask as somebody else. */
          const value = await tool.run(ctx, args);
          result = JSON.stringify(value);
        } catch (error) {
          /* A failing tool must not kill the answer. The model is told what
             went wrong and can say so, or try a different tool. */
          result = JSON.stringify({
            error: error instanceof Error ? error.message : 'That lookup failed.',
          });
        }
        memo.set(cacheKey, result);
        if (!toolsUsed.includes(name)) toolsUsed.push(name);
        evidence.push(result);
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  /* Unreachable: the final round withholds tools, so it always answers. */
  throw new Error('The assistant could not settle on an answer. Try a narrower question.');
}

/* ---------------------------------------------------------------------------
 * The HTTP call
 * ------------------------------------------------------------------------- */

interface ModelPayload {
  readonly choices?: {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: {
        readonly id: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason?: string;
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

async function callModel(key: string, body: Record<string, unknown>): Promise<ModelPayload> {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    /* ⚠️ 45s per round, four rounds. Node's undici gives up at 300s with
       UND_ERR_HEADERS_TIMEOUT and a Vercel function dies there too, so the
       whole loop has to finish inside that — generous against a measured ~3s
       and still leaves an error somebody can read. */
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    /* ⚠️ Truncated: the key can appear in an echoed request on some error
       shapes, so the body is never surfaced or logged wholesale. */
    throw new Error(`OpenAI refused the request (${response.status}). ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as ModelPayload;
}

/* ---------------------------------------------------------------------------
 * Reading the reply
 * ------------------------------------------------------------------------- */

export interface ParsedAnswer {
  readonly answer: string;
  readonly chart: ChartSpec | null;
}

/**
 * ⚠️ Tolerant on purpose. JSON mode is only requested on the final round — the
 * tool rounds cannot use `response_format` and also offer tools — so a model
 * that answers early may reply with prose. Treating that as a failure would
 * throw away a perfectly good answer.
 *
 * ── ⚠️ THE FALLBACK USED TO PRINT RAW JSON AT SOMEBODY, AND THAT IS THE BUG
 *    THIS FUNCTION NOW EXISTS TO PREVENT ──────────────────────────────────
 * Caught in a screenshot, not by a test: an answer arrived as clean prose with
 * `{"kind":"bars","title":"Weekly Utilisation",...}` appended to it. The whole
 * string was not valid JSON, so `JSON.parse` threw, the fallback returned the
 * content verbatim, and forty lines of chart specification were rendered into
 * the chat as a paragraph. The chart itself never drew.
 *
 * There are two failures there and both are handled below:
 *
 *   1. A reply wrapped in ```json fences, or with a sentence before the object.
 *      Recoverable — find the object and parse it. That is what `extractJson`
 *      does, and it turns a discarded answer AND a discarded chart into both.
 *   2. Genuinely unparseable output with a JSON-looking tail. Not recoverable,
 *      but the tail must still never reach a reader: prose is what they asked
 *      for and a serialised object is noise at best. It is cut.
 *
 * ⚠️ The cut is deliberately conservative — it only removes a trailing brace
 * block that mentions one of the chart's own keys. An answer that happens to
 * contain a brace, or a project genuinely named `{something}`, is left alone.
 */
export function parseAnswer(content: string): ParsedAnswer {
  const parsed = extractJson(content);

  if (parsed === null) {
    return { answer: stripTrailingSpec(content), chart: null };
  }

  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  return {
    /* ⚠️ `stripTrailingSpec` on this branch TOO. A model that puts the chart
       inside the `answer` string as well as in `chart` is not hypothetical —
       it is what produced the screenshot. */
    answer: stripTrailingSpec(answer || content),
    chart: validChart(parsed.chart),
  };
}

/**
 * The reply as an object, or null.
 *
 * ⚠️ Not `JSON.parse` alone. Handles a ```json fence and a leading sentence,
 * both of which a model produces occasionally and neither of which is a reason
 * to throw the answer away.
 */
function extractJson(content: string): Record<string, unknown> | null {
  const attempt = (text: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(text);
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const trimmed = content.trim();

  const direct = attempt(trimmed);
  if (direct) return direct;

  /* A fenced block, with or without the `json` tag. */
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    const inside = attempt(fenced[1].trim());
    if (inside) return inside;
  }

  /* ⚠️ First `{` to LAST `}` — not a lazy match. A chart spec is full of nested
     objects, so stopping at the first closing brace cuts the reply in half and
     parses nothing. */
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return attempt(trimmed.slice(first, last + 1));
  }

  return null;
}

/** The chart shape's own keys — what identifies a stray spec as a spec. */
const SPEC_KEYS = /"(kind|bars|slices|series|centreLabel|centreValue|labels)"\s*:/;

/**
 * Remove a chart specification the model left in the prose.
 *
 * ⚠️ Anchored to the END and required to look like a spec. Cutting from the
 * first `{` would truncate an answer that merely mentions one.
 */
function stripTrailingSpec(text: string): string {
  const start = text.indexOf('{"kind"');
  const candidate = start === -1 ? null : text.slice(start);

  if (candidate !== null && SPEC_KEYS.test(candidate)) {
    return text.slice(0, start).trim();
  }
  return text.trim();
}

/**
 * A chart the app is willing to draw, or null.
 *
 * ⚠️ Validated rather than trusted. The spec is written straight into a jsonb
 * column and rendered by a component that assumes its shape — a malformed one
 * would be a runtime error on somebody's screen days later. Anything not
 * recognised is dropped and the prose stands on its own, which is a complete
 * answer regardless.
 */
function validChart(raw: unknown): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const spec = raw as Record<string, unknown>;

  const title = typeof spec.title === 'string' ? spec.title : '';
  const question = typeof spec.question === 'string' ? spec.question : '';
  if (!title) return null;

  const data = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
          .map((d) => ({
            label: String(d.label ?? ''),
            value: Number(d.value),
            token: typeof d.token === 'string' ? d.token : 'accent-primary',
          }))
          .filter((d) => d.label !== '' && Number.isFinite(d.value))
      : [];

  if (spec.kind === 'bars') {
    const bars = data(spec.bars);
    return bars.length ? { kind: 'bars', title, question, bars, format: 'integer' } : null;
  }

  if (spec.kind === 'donut') {
    const slices = data(spec.slices).filter((s) => s.value > 0);
    return slices.length
      ? {
          kind: 'donut',
          title,
          question,
          slices,
          centreLabel: typeof spec.centreLabel === 'string' ? spec.centreLabel : 'Total',
          centreValue:
            typeof spec.centreValue === 'string'
              ? spec.centreValue
              : String(slices.reduce((sum, s) => sum + s.value, 0)),
        }
      : null;
  }

  if (spec.kind === 'trend') {
    const labels = Array.isArray(spec.labels) ? spec.labels.map((l) => String(l)) : [];
    const series = Array.isArray(spec.series)
      ? spec.series
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map((s) => ({
            label: String(s.label ?? ''),
            token: typeof s.token === 'string' ? s.token : 'accent-primary',
            points: Array.isArray(s.points) ? s.points.map((p) => Number(p)) : [],
          }))
          /* ⚠️ A series whose length disagrees with the labels draws a line that
             stops halfway across the axis. Dropped rather than rendered. */
          .filter((s) => s.points.length === labels.length && s.points.every(Number.isFinite))
      : [];

    return labels.length > 1 && series.length
      ? { kind: 'trend', title, question, labels, series, format: 'integer' }
      : null;
  }

  return null;
}
