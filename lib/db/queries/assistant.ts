import { withUser } from '@/lib/db/client';
import type { AssistantAccessRow, AssistantEffect } from '@/lib/domain/assistant-access';
import type { ChartSpec } from '@/lib/domain/report-charts';

/* ============================================================================
 * THE ASSISTANT'S OWN READS AND WRITES
 * ----------------------------------------------------------------------------
 * Conversations, usage, and the per-person switch. Nothing about the business
 * data the assistant answers questions about — that goes through the existing
 * query functions, untouched, in lib/ai/assistant/tools.ts.
 *
 * ── ⚠️ NO ROLE CHECK IN THIS FILE, AND THAT IS CORRECT ─────────────────────
 * Everything goes through `withUser`, and migration 069's policies do the work:
 * a person reads their own thread, an Admin reads everybody's questions and
 * nobody else's answers, only an Admin may write an access row. A Coordinator
 * calling `listUsage` gets their own rows and no error.
 *
 * That is ADR-003. A redundant `if` here would be harmless today and dangerous
 * later, because it would look like the boundary and then drift from it.
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * Who may ask
 * ------------------------------------------------------------------------- */

/**
 * The caller's own override, or null.
 *
 * ⚠️ Takes NO user id — it always asks about the actor. Pointing this at
 * another person is the one mistake that would silently answer the wrong
 * question, so the signature makes it impossible. The access SCREEN uses
 * `listAccessOverrides` below, which is a different, Admin-only question.
 */
export async function assistantAccessFor(actorId: string): Promise<AssistantAccessRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.user_id, a.effect, a.granted_at, a.note,
           u.full_name as granted_by_name
      from public.assistant_access a
      left join public.users u on u.id = a.granted_by_id
     where a.user_id = ${actorId}
     limit 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? toAccessRow(row) : null;
}

/** Every override, for the access panel. Admin+ by policy; others get [] . */
export async function listAccessOverrides(actorId: string): Promise<AssistantAccessRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.user_id, a.effect, a.granted_at, a.note,
           u.full_name as granted_by_name
      from public.assistant_access a
      left join public.users u on u.id = a.granted_by_id
  `);
  return (rows as Array<Record<string, unknown>>).map(toAccessRow);
}

/**
 * Switch one person on or off.
 *
 * ⚠️ An upsert, because migration 069 gives the table no UPDATE policy — with
 * RLS on and no policy, an UPDATE is refused for everybody. That is deliberate:
 * it stops a grant being quietly edited to name a different author. `on
 * conflict do update` runs under the INSERT policy's `with check`, which
 * requires `granted_by_id = app.current_user_id()`, so the row always names
 * whoever last touched it.
 */
export async function setAssistantAccess(
  actorId: string,
  userId: string,
  effect: AssistantEffect,
  note?: string | null,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.assistant_access (user_id, effect, granted_by_id, note)
    values (${userId}, ${effect}, ${actorId}, ${note ?? null})
    on conflict (user_id) do update
       set effect        = excluded.effect,
           granted_by_id = excluded.granted_by_id,
           granted_at    = now(),
           note          = excluded.note
  `);
}

/**
 * Remove an override, returning the person to their role default.
 *
 * ⚠️ Returns WHICH effect was cleared, because one function has two opposite
 * meanings: clearing an `allow` takes access away, clearing a `deny` gives it
 * back. The screen needs to say which happened. Same reasoning as
 * `clearCredentialAccess`.
 */
export async function clearAssistantAccess(
  actorId: string,
  userId: string,
): Promise<AssistantEffect | null> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.assistant_access where user_id = ${userId}
    returning effect
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? (row.effect as AssistantEffect) : null;
}

/* ---------------------------------------------------------------------------
 * Conversations
 * ------------------------------------------------------------------------- */

export interface ThreadRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface MessageRow {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly toolsUsed: readonly string[];
  readonly chart: ChartSpec | null;
  readonly unverifiedFigures: readonly string[];
  readonly createdAt: string;
}

/** The caller's own conversations, newest first. */
export async function listThreads(actorId: string, limit = 30): Promise<ThreadRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.title, t.updated_at,
           (select count(*) from public.assistant_messages m where m.thread_id = t.id)::int as n
      from public.assistant_threads t
     order by t.updated_at desc
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    updatedAt: iso(row.updated_at),
    messageCount: Number(row.n ?? 0),
  }));
}

/**
 * One conversation's messages, oldest first.
 *
 * ⚠️ An Admin reading somebody else's thread gets the QUESTIONS only — the
 * select policy admits them to `role = 'user'` rows and no others. That is not
 * a bug to work around; it is the owner's choice, and the reason this returns a
 * plain list rather than pairing each question with its answer.
 */
export async function listMessages(actorId: string, threadId: string): Promise<MessageRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, role, content, tools_used, chart, unverified_figures, created_at
      from public.assistant_messages
     where thread_id = ${threadId}
     order by created_at
  `);
  return (rows as Array<Record<string, unknown>>).map(toMessage);
}

/** Start a conversation. The title is the first question, trimmed by the caller. */
export async function createThread(actorId: string, title: string): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.assistant_threads (user_id, title)
    values (${actorId}, ${title})
    returning id
  `);
  return (rows as Array<Record<string, unknown>>)[0].id as string;
}

export interface NewMessage {
  readonly threadId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly toolsUsed?: readonly string[];
  readonly chart?: ChartSpec | null;
  readonly unverifiedFigures?: readonly string[];
  readonly model?: string | null;
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
  readonly costUsd?: number | null;
  readonly latencyMs?: number | null;
}

export async function recordMessage(actorId: string, input: NewMessage): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.assistant_messages
      (thread_id, user_id, role, content, tools_used, chart, unverified_figures,
       model, prompt_tokens, completion_tokens, cost_usd, latency_ms)
    values (
      ${input.threadId},
      ${actorId},
      ${input.role},
      ${input.content},
      ${(input.toolsUsed ?? []) as unknown as string[]},
      /* ⚠️ tx.json(), never JSON.stringify — postgres.js serialises jsonb
         itself, and pre-stringifying double-encodes so the column silently
         holds a string. Registry C-22; it broke type_fields for a week. */
      ${input.chart ? tx.json(input.chart as never) : null},
      ${(input.unverifiedFigures ?? []) as unknown as string[]},
      ${input.model ?? null},
      ${input.promptTokens ?? null},
      ${input.completionTokens ?? null},
      ${input.costUsd ?? null},
      ${input.latencyMs ?? null}
    )
  `);
}

/** Remove one of the caller's own conversations. Messages cascade. */
export async function deleteThread(actorId: string, threadId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.assistant_threads where id = ${threadId}
  `);
}

/* ---------------------------------------------------------------------------
 * Usage
 * ------------------------------------------------------------------------- */

export interface UsageLine {
  readonly userId: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
  readonly asks: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly lastAskedAt: string | null;
}

/**
 * Spend per person over a period.
 *
 * ── ⚠️ COUNTED ON THE ASSISTANT'S REPLIES, NOT THE QUESTIONS ───────────────
 * A question costs nothing until it is answered, and only the reply row carries
 * the token counts. Counting `role = 'user'` rows would give the right number
 * of asks and a cost of zero.
 *
 * ⚠️ Which means this returns the caller's OWN figures only, because the select
 * policy hides other people's `assistant` rows from them. Kept, and still used
 * for "your spend" — but it is no longer the whole story: `teamSpend` below
 * goes through migration 072's aggregate function to answer the same question
 * for everybody, without reaching a word of anybody's answer.
 */
export async function myUsage(actorId: string, from: string, to: string): Promise<UsageLine[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.user_id,
           u.full_name, u.role_title, u.avatar_url,
           count(*)::int                              as asks,
           coalesce(sum(m.prompt_tokens), 0)::int     as prompt_tokens,
           coalesce(sum(m.completion_tokens), 0)::int as completion_tokens,
           coalesce(sum(m.cost_usd), 0)               as cost_usd,
           max(m.created_at)                          as last_asked_at
      from public.assistant_messages m
      join public.users u on u.id = m.user_id
     where m.role = 'assistant'
       and m.created_at >= ${from}::date
       and m.created_at < (${to}::date + 1)
     group by m.user_id, u.full_name, u.role_title, u.avatar_url
     order by cost_usd desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toUsage);
}

/**
 * What everybody asked, and how much of it there was.
 *
 * ── ⚠️ WHY THIS IS A SEPARATE FUNCTION FROM `myUsage` ──────────────────────
 * An Admin can read everybody's QUESTIONS and only their own ANSWERS. So the
 * count of asks is available for the whole team, and the token cost is not.
 *
 * Rather than pretend otherwise, this returns asks and last-asked for everyone
 * — from the `user` rows the policy does admit — and leaves cost to `myUsage`.
 * The screen shows both and says which is which. The alternative was a policy
 * exception for aggregates, and an aggregate that leaks is how "just the
 * totals" becomes "one row's value" the moment somebody filters to one person.
 */
export async function usageSummary(actorId: string, from: string, to: string): Promise<UsageLine[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.user_id,
           u.full_name, u.role_title, u.avatar_url,
           count(*)::int as asks,
           0::int        as prompt_tokens,
           0::int        as completion_tokens,
           0::numeric    as cost_usd,
           max(m.created_at) as last_asked_at
      from public.assistant_messages m
      join public.users u on u.id = m.user_id
     where m.role = 'user'
       and m.created_at >= ${from}::date
       and m.created_at < (${to}::date + 1)
     group by m.user_id, u.full_name, u.role_title, u.avatar_url
     order by asks desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toUsage);
}

/**
 * Per-person cost over a period, for everybody.
 *
 * ── ⚠️ THE ONE READ HERE THAT IS NOT A PLAIN `select` ──────────────────────
 * It goes through `app.assistant_spend`, a SECURITY DEFINER function added in
 * migration 072, because the token counts live on the ANSWER row and migration
 * 069 keeps other people's answers private to them. `myUsage` above returns the
 * caller's own figures and nothing else, which made a usage screen that
 * reported one person.
 *
 * The function returns AGGREGATES ONLY — counts, tokens, cost, a timestamp. No
 * message text is reachable through it at any grouping, which is what lets the
 * owner see what the division spent without seeing what anybody was told. The
 * rank check lives inside the function and refuses with `42501`, so a
 * Coordinator calling this gets an error rather than a quietly empty list; the
 * action above only calls it for somebody with `assistant.view_usage`.
 *
 * ⚠️ The join to `public.users` is NOT inside the definer function — it runs as
 * the caller, under `users`' own policy. So a name only appears here if the
 * reader could already look that person up.
 */
export async function teamSpend(actorId: string, from: string, to: string): Promise<UsageLine[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.user_id,
           u.full_name, u.role_title, u.avatar_url,
           s.asks, s.prompt_tokens, s.completion_tokens, s.cost_usd,
           s.last_at as last_asked_at
      from app.assistant_spend(${from}::date, ${to}::date) s
      join public.users u on u.id = s.user_id
     order by s.cost_usd desc, s.asks desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toUsage);
}

export interface AskedQuestion {
  readonly id: string;
  readonly askedById: string;
  readonly askedBy: string;
  readonly avatarUrl: string | null;
  readonly roleTitle: string | null;
  readonly content: string;
  readonly createdAt: string;
}

/**
 * Recent questions, so an Admin can see what the tool is used for.
 *
 * ⚠️ Carries the asker's ID as well as their name, because every row on the
 * activity screen opens that person's detail. Matching a display name back to a
 * person in the browser is how two people called Ahmed end up sharing a
 * transcript.
 */
export async function recentQuestions(actorId: string, limit = 40): Promise<AskedQuestion[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.id, m.content, m.created_at,
           m.user_id as asked_by_id,
           u.full_name as asked_by, u.avatar_url, u.role_title
      from public.assistant_messages m
      join public.users u on u.id = m.user_id
     where m.role = 'user'
     order by m.created_at desc
     limit ${limit}
  `);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    askedById: row.asked_by_id as string,
    askedBy: row.asked_by as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    roleTitle: (row.role_title as string | null) ?? null,
    content: row.content as string,
    createdAt: iso(row.created_at),
  }));
}

export interface TranscriptLine {
  readonly id: string;
  readonly threadId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly toolsUsed: readonly string[];
  readonly costUsd: number | null;
  readonly latencyMs: number | null;
  readonly createdAt: string;
}

/**
 * Everything one person has said to the assistant that the CALLER may read.
 *
 * ── ⚠️ ONE QUERY, TWO VERY DIFFERENT ANSWERS, AND THE POLICY DECIDES ───────
 * Asked about yourself it returns the whole conversation, both sides. Asked
 * about somebody else — even by a Super Admin — it returns their QUESTIONS and
 * not one answer, because migration 069's select predicate admits an Admin to
 * `role = 'user'` rows only.
 *
 * That difference is not implemented here and must not be. There is no `if` in
 * this function that could be got wrong, no branch to forget when a fourth role
 * appears; the same SQL simply returns less. The screen reads what came back
 * and says which of the two it is looking at.
 */
export async function personTranscript(
  actorId: string,
  userId: string,
  limit = 200,
): Promise<TranscriptLine[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, thread_id, role, content, tools_used, cost_usd, latency_ms, created_at
      from public.assistant_messages
     where user_id = ${userId}
     order by created_at desc
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>)
    .map((row) => ({
      id: row.id as string,
      threadId: row.thread_id as string,
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
      toolsUsed: (row.tools_used as string[] | null) ?? [],
      /* numeric arrives as a string — see `toUsage`. */
      costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
      latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
      createdAt: iso(row.created_at),
    }))
    /* ⚠️ Newest first in SQL so the LIMIT keeps the recent end, then reversed
       so a conversation reads downward. Ordering ascending and limiting would
       silently show somebody the oldest 200 messages and call it their
       activity. */
    .reverse();
}

/**
 * How many questions the caller has asked in the last hour.
 *
 * ⚠️ Counted in the DATABASE's clock, not the server's. `lib/domain/rate-limit.ts`
 * records why (registry C-19): the timestamps were written by Postgres, and a
 * few seconds of skew between it and Node is enough to discard every fresh row
 * and silently disable the limit.
 */
export async function asksInLastHour(actorId: string): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*)::int as n
      from public.assistant_messages
     where user_id = ${actorId}
       and role = 'user'
       and created_at >= now() - interval '1 hour'
  `);
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
}

/* ---------------------------------------------------------------------------
 * Mapping
 * ------------------------------------------------------------------------- */

function toAccessRow(row: Record<string, unknown>): AssistantAccessRow {
  return {
    userId: row.user_id as string,
    effect: row.effect as AssistantEffect,
    grantedByName: (row.granted_by_name as string | null) ?? null,
    grantedAt: iso(row.granted_at),
    note: (row.note as string | null) ?? null,
  };
}

function toMessage(row: Record<string, unknown>): MessageRow {
  return {
    id: row.id as string,
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    toolsUsed: (row.tools_used as string[] | null) ?? [],
    /* jsonb comes back parsed; no JSON.parse here. */
    chart: (row.chart as ChartSpec | null) ?? null,
    unverifiedFigures: (row.unverified_figures as string[] | null) ?? [],
    createdAt: iso(row.created_at),
  };
}

function toUsage(row: Record<string, unknown>): UsageLine {
  return {
    userId: row.user_id as string,
    fullName: row.full_name as string,
    roleTitle: (row.role_title as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    asks: Number(row.asks ?? 0),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    /* ⚠️ `numeric` arrives from pg as a STRING. Without the explicit Number()
       every total downstream concatenates instead of adding — and produces no
       error, just a spectacularly wrong figure. */
    costUsd: Number(row.cost_usd ?? 0),
    lastAskedAt: row.last_asked_at ? iso(row.last_asked_at) : null,
  };
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
