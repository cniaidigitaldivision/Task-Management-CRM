'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import * as A from '@/lib/db/queries/assistant';
import { ask } from '@/lib/ai/assistant/run';
import { chatgptKey } from '@/lib/ai/narrative';
import { mayUseAssistant, type AssistantEffect } from '@/lib/domain/assistant-access';
import { can } from '@/lib/domain/permissions';
import type { ChartSpec } from '@/lib/domain/report-charts';

/* ============================================================================
 * ASKING, AND WHO MAY ASK
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE ACTOR ID IS TAKEN FROM THE SESSION, NEVER FROM AN ARGUMENT ──────
 * `requireUser()` on every action, and its id is what reaches `ask()` and every
 * tool beneath it. No action here accepts a user id for the person asking — so
 * there is no request shape that runs a question as somebody else.
 *
 * The one action that DOES take a user id is `setAssistantAccessAction`, which
 * is about a third party by definition and is Admin-only both here and in
 * migration 069's insert policy.
 * ========================================================================= */

export type AssistantResult = { ok: true; message: string } | { ok: false; error: string };

/* ⚠️ A ceiling on questions per person per hour. Not primarily abuse — this is
   an internal tool for seven people — but a runaway loop or an enthusiastic
   afternoon should not be able to spend the month's budget before anybody
   notices. Refuses with a sentence and a wait, never silently. */
const ASKS_PER_HOUR = 30;

export interface AskResponse {
  readonly ok: true;
  readonly threadId: string;
  readonly answer: string;
  readonly chart: ChartSpec | null;
  readonly toolsUsed: readonly string[];
  readonly unverifiedFigures: readonly string[];
  readonly latencyMs: number;
}

/** Karachi's today, matching every other date in this product. */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

/**
 * Ask a question.
 *
 * ⚠️ Both the question and the answer are recorded, and the question is
 * recorded BEFORE the model runs. A model call that fails or times out still
 * leaves a record that somebody asked — otherwise the usage screen would show
 * only the questions that happened to succeed, which is the wrong number for
 * "who is using this".
 */
export async function askAssistantAction(
  question: string,
  threadId?: string | null,
): Promise<AskResponse | { ok: false; error: string }> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const override = await A.assistantAccessFor(user.id);
  if (!mayUseAssistant(actor, override)) {
    return { ok: false, error: 'The assistant is not switched on for your account.' };
  }

  if (!chatgptKey()) {
    return {
      ok: false,
      error: 'No OpenAI key is configured, so the assistant cannot answer. An Admin sets CHATGPT_API_KEY.',
    };
  }

  const asked = question.trim();
  if (asked === '') return { ok: false, error: 'Ask something.' };
  if (asked.length > 2000) {
    return { ok: false, error: 'That question is too long. Try asking it in a sentence or two.' };
  }

  /* ⚠️ Counted in the DATABASE's clock — see `asksInLastHour`. Comparing
     against Node's would silently disable the limit under a few seconds of
     skew, which is registry C-19's lesson from the login limiter. */
  const recent = await A.asksInLastHour(user.id);
  if (recent >= ASKS_PER_HOUR) {
    return {
      ok: false,
      error: `That is ${recent} questions in an hour, which is the limit. Try again shortly.`,
    };
  }

  /* A new conversation is titled with the question, trimmed — the app writes
     it, never the model, so a thread cannot be named by something it read. */
  const thread =
    threadId ?? (await A.createThread(user.id, asked.slice(0, 80)));

  const history = threadId ? await A.listMessages(user.id, threadId) : [];

  await A.recordMessage(user.id, { threadId: thread, role: 'user', content: asked });

  try {
    const result = await ask({
      actorId: user.id,
      role: user.role,
      fullName: user.fullName,
      question: asked,
      today: today(),
      nowMs: Date.now(),
      history: history.map((m) => ({ role: m.role, content: m.content })),
    });

    await A.recordMessage(user.id, {
      threadId: thread,
      role: 'assistant',
      content: result.answer,
      toolsUsed: result.toolsUsed,
      chart: result.chart,
      unverifiedFigures: result.unverifiedFigures,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    });

    return {
      ok: true,
      threadId: thread,
      answer: result.answer,
      chart: result.chart,
      toolsUsed: result.toolsUsed,
      unverifiedFigures: result.unverifiedFigures,
      latencyMs: result.latencyMs,
    };
  } catch (error) {
    /* ⚠️ The message is shown to somebody, so it must not carry an upstream
       body — `run.ts` already truncates those, because a key can appear in an
       echoed request. What reaches here is safe to print. */
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The assistant could not answer.',
    };
  }
}

/* ---------------------------------------------------------------------------
 * Conversations
 * ------------------------------------------------------------------------- */

export async function listThreadsAction(): Promise<A.ThreadRow[]> {
  const user = await requireUser();
  return A.listThreads(user.id);
}

export async function loadThreadAction(threadId: string): Promise<A.MessageRow[]> {
  const user = await requireUser();
  return A.listMessages(user.id, threadId);
}

export async function deleteThreadAction(threadId: string): Promise<AssistantResult> {
  const user = await requireUser();
  await A.deleteThread(user.id, threadId);
  /* Both: the chat is on one page and the counts it feeds are on the other. */
  revalidatePath('/assistant');
  revalidatePath('/assistant/activity');
  return { ok: true, message: 'Conversation removed.' };
}

/* ---------------------------------------------------------------------------
 * Who may ask
 * ------------------------------------------------------------------------- */

/**
 * Switch the assistant on or off for one person.
 *
 * Owner, 2026-08-26: *"a radio button for each member, in the name of each
 * member, that I can switch on and off at my choice [...] on admin or super
 * admin choice."*
 */
export async function setAssistantAccessAction(
  userId: string,
  effect: AssistantEffect | 'reset',
): Promise<AssistantResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'assistant.manage_access')) {
    return { ok: false, error: 'Only an Admin can change who may use the assistant.' };
  }

  if (effect === 'reset') {
    /* ⚠️ Reports WHICH effect was cleared, because one action has two opposite
       meanings: clearing an `allow` takes access away, clearing a `deny` gives
       it back. A single "Reset." would leave somebody guessing which. */
    const was = await A.clearAssistantAccess(user.id, userId);

    await auditAlone(user, {
      entityType: 'user',
      entityId: userId,
      action: 'assistant.access_reset',
      before: { effect: was },
    });

    revalidatePath('/assistant/activity');
    return {
      ok: true,
      message:
        was === 'allow'
          ? 'Removed. They are back to whatever their role allows.'
          : was === 'deny'
            ? 'Exclusion removed. Their role decides again.'
            : 'Nothing to remove — they were already on their role default.',
    };
  }

  await A.setAssistantAccess(user.id, userId, effect);

  await auditAlone(user, {
    entityType: 'user',
    entityId: userId,
    action: effect === 'allow' ? 'assistant.access_granted' : 'assistant.access_revoked',
    after: { effect },
  });

  revalidatePath('/assistant/activity');
  return {
    ok: true,
    message: effect === 'allow' ? 'Switched on for them.' : 'Switched off for them.',
  };
}

/* ---------------------------------------------------------------------------
 * Usage
 * ------------------------------------------------------------------------- */

export interface UsageReport {
  readonly asks: readonly A.UsageLine[];
  readonly spend: readonly A.UsageLine[];
  readonly mine: readonly A.UsageLine[];
  readonly questions: readonly A.AskedQuestion[];
}

/**
 * What the tool is being used for, and what it costs.
 *
 * ── THREE LISTS, AND EACH ANSWERS A DIFFERENT QUESTION ──────────────────────
 *   · `asks`      — how many questions each person asked. From the `user` rows,
 *                   which migration 069 admits an Admin to.
 *   · `spend`     — what each person's answers cost. Through migration 072's
 *                   aggregate function, which is Admin-only and returns no text.
 *   · `mine`      — the caller's own figures, read straight from the table.
 *
 * ⚠️ `asks` and `spend` will not always agree on the count, and that is not a
 * bug to reconcile. A question recorded when the model then failed or timed out
 * has no answer row, so it is an ask that cost nothing. The screen shows both
 * and the gap is real information — it is how a run of failures becomes
 * visible.
 */
export async function assistantUsageAction(
  from: string,
  to: string,
): Promise<UsageReport | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'assistant.view_usage')) {
    return { ok: false, error: 'You cannot view assistant usage.' };
  }

  const [asks, spend, mine, questions] = await Promise.all([
    A.usageSummary(user.id, from, to),
    A.teamSpend(user.id, from, to),
    A.myUsage(user.id, from, to),
    A.recentQuestions(user.id),
  ]);

  return { asks, spend, mine, questions };
}

/* ---------------------------------------------------------------------------
 * One person, in detail
 * ------------------------------------------------------------------------- */

export interface PersonActivity {
  readonly ok: true;
  /** True when the caller is looking at themselves, in which case the
   *  transcript below carries both sides of the conversation. */
  readonly isSelf: boolean;
  readonly lines: readonly A.TranscriptLine[];
}

/**
 * Everything one person has asked, for the drill-down on the activity screen.
 *
 * Owner, 2026-08-27: *"when I click on someone's specific chat or something
 * like activity, I can see more and every detail."*
 *
 * ── ⚠️ THE ACTION DECIDES WHO MAY LOOK; THE POLICY DECIDES WHAT COMES BACK ──
 * Two separate things, and conflating them is how this goes wrong. The check
 * here is only about whether an ADMIN SCREEN may be opened for a third party —
 * anybody may always look at themselves, which is their own chat history.
 *
 * What the query then returns is not decided here at all. Ask about somebody
 * else and migration 069 hands back their questions and none of their answers,
 * whatever this action believes. So a mistake in the line below cannot leak an
 * answer; at worst it shows an Admin a list of questions they were entitled to
 * see on the same screen anyway.
 */
export async function assistantPersonActivityAction(
  userId: string,
): Promise<PersonActivity | { ok: false; error: string }> {
  const user = await requireUser();

  const isSelf = userId === user.id;
  if (!isSelf && !can({ role: user.role, id: user.id }, 'assistant.view_usage')) {
    return { ok: false, error: 'You cannot view somebody else’s assistant activity.' };
  }

  return { ok: true, isSelf, lines: await A.personTranscript(user.id, userId) };
}
