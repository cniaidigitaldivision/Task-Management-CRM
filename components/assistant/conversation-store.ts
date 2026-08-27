'use client';

import type { ChatTurn } from '@/components/assistant/assistant-chat';

/* ============================================================================
 * ONE CONVERSATION, WHEREVER IT IS BEING READ
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"right now the chat is open at the bottom. For example if
 * I minimize, I want to minimize it where the chat will continue where I left
 * off. Even if I cross-edit or in the same session, it will be the same chat,
 * right? [...] when it pops up the chat will continue."*
 *
 * ── ⚠️ WHY THIS IS NOT COMPONENT STATE, AND WHY IT IS NOT CONTEXT EITHER ───
 * It was `useState` inside `AssistantChat`, which is the obvious place and is
 * wrong for a reason that only shows up when you use the thing: closing the
 * panel UNMOUNTS the component, and unmounting throws the conversation away.
 * Reopening greeted the person by name and had never heard of the question they
 * asked ninety seconds earlier.
 *
 * React Context would fix that only if a provider sat above every mount point —
 * and there are two, in different subtrees: the floating panel, rendered by the
 * shell outside the layout column, and the full page. A provider high enough to
 * cover both is the root layout, which would re-render the entire application
 * on every keystroke of every answer.
 *
 * A module-scoped store has neither problem. It outlives any component, it is
 * shared by both mount points by construction, and a change notifies only what
 * subscribed. It is the pattern `app-shell.tsx` already uses for the rail pin,
 * for the same reason: state that belongs to the SESSION rather than to a
 * component.
 *
 * ── ⚠️ THE PANEL AND THE PAGE ARE THE SAME CONVERSATION ────────────────────
 * Deliberate, and it is what the owner asked for. Ask something in the floating
 * panel, click "Open full page", and the thread is there — same `threadId`, so
 * the server appends to the same row rather than starting a second one.
 *
 * ── ⚠️ WHAT IT DOES NOT SURVIVE, STATED PLAINLY ────────────────────────────
 * A full page reload. A module lives as long as the JavaScript context does, so
 * F5 starts an empty transcript. That is a deliberate stopping point rather than
 * an oversight: the messages are already durable in `assistant_messages`, and
 * restoring them means a thread picker, which is a feature and not a detail.
 * Client-side navigation — every link in the product — keeps the conversation,
 * because the module is not re-evaluated.
 *
 * ── ⚠️ AND A REQUEST IN FLIGHT IS NOT LOST ─────────────────────────────────
 * `pending` lives here too, so closing the panel mid-question and reopening it
 * shows the same "reading the database" line, and the answer lands in the store
 * whether or not anything is mounted to see it arrive.
 * ========================================================================= */

export interface Conversation {
  readonly turns: readonly ChatTurn[];
  /** The server's thread id, once the first question has created one. */
  readonly threadId: string | null;
  /** A question is in flight. */
  readonly pending: boolean;
}

const EMPTY: Conversation = { turns: [], threadId: null, pending: false };

/* ⚠️ `let`, and every write REPLACES it rather than mutating it.
   `useSyncExternalStore` compares snapshots by identity — mutating this object
   in place would leave the reference unchanged and React would never re-render.
   The inverse mistake is just as bad: returning a fresh object from
   `getSnapshot` on every call makes React think it changed on every render and
   loops. So: one object, replaced only on a real change. */
let current: Conversation = EMPTY;

const listeners = new Set<() => void>();

export function subscribeConversation(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getConversation(): Conversation {
  return current;
}

/** ⚠️ The server has no conversation, and must return a STABLE value — a fresh
 *  object here is a hydration mismatch on every render. */
export function getServerConversation(): Conversation {
  return EMPTY;
}

function publish(next: Conversation): void {
  current = next;
  for (const listener of listeners) listener();
}

export function updateConversation(
  change: (previous: Conversation) => Conversation,
): void {
  publish(change(current));
}

/** Start again. Used by the "New chat" control. */
export function clearConversation(): void {
  publish(EMPTY);
}

/* ── ⚠️ THE ID COUNTER LIVES HERE TOO ───────────────────────────────────────
   It was a `useRef` inside the component, which reset to 0 on every remount —
   so closing the panel and asking again produced a second turn keyed `q-1`,
   colliding with the `q-1` already in the transcript. React then reused the
   wrong DOM node and the two questions swapped places.

   ⚠️ A counter, not `Date.now()` or `Math.random()`. These ids only key a list;
   a clock read makes a render non-deterministic, which the react-compiler lint
   refuses — correctly. */
let sequence = 0;

export function nextTurnId(kind: string): string {
  sequence += 1;
  return `${kind}-${sequence}`;
}
