'use client';

import * as React from 'react';
import { Check, ChevronDown, Pencil, RefreshCw, Sparkles, WandSparkles, X } from 'lucide-react';

import { suggestReplyAction } from '@/app/actions/crm-whatsapp';
import type { AgentMode, CrmMessage } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHO WRITES THE REPLY — the owner's three modes
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-19, with a screenshot of Meta's own agent on WhatsApp Web:
 *
 *   My reply      No AI assistance
 *   Suggestions   AI suggests, you send
 *   AI agent      AI writes and sends messages for you
 *
 * and in the chat list, `All · AI handoff · AI responding` with a badge on each
 * row. That is exactly what this file draws.
 *
 * ── ⚠️ AI AGENT IS SHOWN, AND SAYS WHY IT CANNOT BE CHOSEN YET ─────────────
 * Nothing answers a client yet — the agent needs a knowledge base saying what
 * the business sells and what it will not promise (`docs/crm-ai/02`). Hiding the
 * option would make the owner's design look forgotten; enabling it would put
 * "AI responding" on a thread nobody is responding to, and a salesperson trusts
 * that label. So it is there, greyed, with the reason on it — and the server
 * refuses it too (`setAgentModeAction`), because a disabled button is only a
 * suggestion to a request built by hand.
 *
 * ── ⚠️ SUGGESTIONS WORKS TODAY ─────────────────────────────────────────────
 * `lib/ai/reply-suggestion.ts` already drafts a reply for a person to read and
 * send (Ask AI, 2026-09-17). This mode offers that draft on its own, the moment
 * a client's message is the last thing in the thread, instead of waiting to be
 * asked from a message menu.
 * ========================================================================= */

interface ModeMeta {
  readonly key: AgentMode;
  readonly label: string;
  readonly hint: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** Set when the mode cannot be chosen yet — shown, never hidden. */
  readonly unavailable?: string;
}

export const AGENT_MODES: readonly ModeMeta[] = [
  { key: 'off', label: 'My reply', hint: 'No AI assistance', icon: Pencil },
  { key: 'suggest', label: 'Suggestions', hint: 'AI suggests, you send', icon: WandSparkles },
  {
    key: 'agent',
    label: 'AI agent',
    /* ⚠️ NO LONGER GREYED OUT (2026-09-21). The agent exists and answers only
       from approved knowledge; the server refuses it, with the reason, on a
       project that has none approved yet — so the label can never promise a
       reply nobody sends. */
    hint: 'AI answers from what you approved, and hands over when unsure',
    icon: Sparkles,
  },
];

export function modeMeta(mode: AgentMode): ModeMeta {
  return AGENT_MODES.find((m) => m.key === mode) ?? AGENT_MODES[0];
}

/* ── The dropdown under the reply box ─────────────────────────────────────── */

export function AgentModeControl({
  mode,
  onChange,
}: {
  mode: AgentMode;
  onChange: (next: AgentMode) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const current = modeMeta(mode);
  const Icon = current.icon;

  /* Closes on a click anywhere else, and on Escape — a menu that has to be
     dismissed by finding its own button again is one that stays open. */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-caption font-semibold transition-colors',
          mode === 'off'
            ? 'border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle'
            : 'border-accent-primary/40 text-accent-primary',
        )}
        style={
          mode === 'off'
            ? undefined
            : { background: 'color-mix(in oklab, var(--accent-primary) 8%, var(--bg-surface))' }
        }
      >
        <Icon className="size-3.5" />
        {current.label}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        /* ⚠️ OPENS UPWARD. It sits at the foot of the chat; a menu opening down
           would be cut off by the bottom of the window. */
        <div
          role="menu"
          aria-label="Who writes the reply"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1.5 shadow-xl"
        >
          {AGENT_MODES.map((m) => {
            const on = m.key === mode;
            const MIcon = m.icon;
            const blocked = Boolean(m.unavailable);
            return (
              <button
                key={m.key}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                aria-disabled={blocked}
                disabled={blocked}
                title={m.unavailable}
                onClick={() => {
                  setOpen(false);
                  if (!on) onChange(m.key);
                }}
                className={cn(
                  'flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors',
                  blocked ? 'cursor-not-allowed' : 'hover:bg-bg-subtle',
                )}
              >
                <span className="grid w-4 shrink-0 place-items-center pt-0.5">
                  {on && <Check className="size-4 text-accent-primary" aria-hidden="true" />}
                </span>
                <MIcon className={cn('mt-0.5 size-4 shrink-0', blocked ? 'text-text-tertiary' : 'text-text-primary')} />
                <span className="min-w-0">
                  <span className={cn('block text-body-sm font-medium', blocked ? 'text-text-tertiary' : 'text-text-primary')}>
                    {m.label}
                  </span>
                  <span className="block text-caption leading-snug text-text-secondary">{m.hint}</span>
                  {m.unavailable && (
                    <span className="mt-0.5 block text-caption leading-snug" style={{ color: 'var(--feedback-warning)' }}>
                      {m.unavailable}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── In place of the reply box, while the agent is answering ─────────────── */

/**
 * What the reply box becomes when the chat is on "AI agent".
 *
 * ⚠️ TWO VOICES IN ONE CHAT IS THE FAILURE THIS PREVENTS. The owner's
 * WhatsApp Business screenshot shows the box replaced by "Waiting for reply…"
 * with a stop button: while the agent answers, nobody types over it. Taking
 * over is one click, back to "My reply" — and a person sending a message by any
 * other route switches the agent off anyway (212).
 */
export function AgentAtWork({ onTakeOver }: { onTakeOver: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-4 py-3"
      style={{
        borderColor: 'color-mix(in oklab, var(--feedback-success) 45%, transparent)',
        background: 'color-mix(in oklab, var(--feedback-success) 6%, var(--bg-surface))',
      }}
      role="status"
    >
      <Sparkles className="size-5 shrink-0" style={{ color: 'var(--feedback-success)' }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-text-primary">The AI agent is answering this chat</p>
        <p className="text-caption leading-snug text-text-secondary">
          It replies only from what you approved, and hands over to you — with a red mark and a notification — when
          it is unsure, gets a voice note, or is asked for a person.
        </p>
      </div>
      <button
        type="button"
        onClick={onTakeOver}
        className="shrink-0 rounded-xl border border-border-default bg-bg-surface px-3.5 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
      >
        Take over
      </button>
    </div>
  );
}

/* ── The badge on a chat-list row ─────────────────────────────────────────── */

/**
 * `AI HANDOFF` outranks everything, because it means a client is waiting on a
 * person right now. Then `AI RESPONDING`, then the quieter `AI SUGGESTS`.
 * Nothing at all for My reply — a badge on every row says nothing.
 */
export function AgentBadge({ mode, handoffAt }: { mode: AgentMode; handoffAt: string | null }) {
  if (handoffAt) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide"
        style={{
          background: 'color-mix(in oklab, var(--feedback-error) 12%, var(--bg-surface))',
          color: 'var(--feedback-error)',
        }}
      >
        <span className="size-1.5 rounded-full bg-feedback-error" aria-hidden="true" />
        AI handoff
      </span>
    );
  }
  if (mode === 'agent') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide"
        style={{
          background: 'color-mix(in oklab, var(--feedback-success) 12%, var(--bg-surface))',
          color: 'var(--feedback-success)',
        }}
      >
        AI responding
      </span>
    );
  }
  if (mode === 'suggest') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-bg-subtle px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-text-secondary">
        <WandSparkles className="size-3" /> AI suggests
      </span>
    );
  }
  return null;
}

/* ── The suggestion, offered above the reply box ─────────────────────────── */

type Suggestion =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly reply: string; readonly meaning: string | null }
  | { readonly state: 'failed'; readonly error: string };

/**
 * ⚠️ ONE REQUEST PER MESSAGE PER PAGE LOAD. Every suggestion is a paid call to
 * the model; switching between two conversations and back must not pay twice
 * for the same message. Held at module level so it outlives the component, and
 * keyed by message id so a NEW message from the client asks again.
 */
const asked = new Map<string, Promise<Suggestion>>();

function askFor(messageId: string, fresh = false): Promise<Suggestion> {
  if (!fresh) {
    const held = asked.get(messageId);
    if (held) return held;
  }
  const p = suggestReplyAction(messageId)
    .then((r): Suggestion =>
      r.ok && r.suggestion
        ? { state: 'ready', reply: r.suggestion.reply, meaning: r.suggestion.meaning }
        : { state: 'failed', error: r.error ?? 'AI could not draft a reply.' },
    )
    .catch((): Suggestion => ({ state: 'failed', error: 'The connection dropped.' }));
  asked.set(messageId, p);
  return p;
}

export function SuggestedReply({
  message,
  onUse,
  onDismiss,
}: {
  /** The client's message being answered — the last thing in the thread. */
  message: CrmMessage;
  onUse: (reply: string) => void;
  onDismiss: () => void;
}) {
  const [s, setS] = React.useState<Suggestion>({ state: 'loading' });
  const [round, setRound] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void askFor(message.id, round > 0).then((next) => {
      if (live) setS(next);
    });
    return () => {
      live = false;
    };
  }, [message.id, round]);

  return (
    <div
      className="mb-2 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: 'color-mix(in oklab, var(--accent-primary) 30%, transparent)',
        background: 'color-mix(in oklab, var(--accent-primary) 5%, var(--bg-surface))',
      }}
      aria-busy={s.state === 'loading'}
    >
      <div className="flex items-center gap-2">
        <WandSparkles className="size-3.5 shrink-0 text-accent-primary" />
        <p className="min-w-0 flex-1 text-caption font-semibold text-accent-primary">Suggested reply</p>
        {s.state !== 'loading' && (
          <button
            type="button"
            onClick={() => {
              setS({ state: 'loading' });
              setRound((r) => r + 1);
            }}
            aria-label="Suggest another"
            title="Suggest another"
            className="grid size-6 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the suggestion"
          title="Dismiss"
          className="grid size-6 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {s.state === 'loading' ? (
        /* ⚠️ SAID IN WORDS, AND THE BARS ARE TINTED. Grey bars on this card's own
           tint were invisible in the first screenshot — the card read as an empty
           box, which is the one thing a loading state must never look like. */
        <div className="mt-2 space-y-1.5" aria-label="Drafting a reply">
          <p className="text-caption text-text-secondary">Drafting a reply to their last message…</p>
          {['w-11/12', 'w-2/3'].map((w) => (
            <span key={w} className={cn('block h-3 animate-pulse rounded bg-accent-primary/15', w)} />
          ))}
        </div>
      ) : s.state === 'failed' ? (
        <p className="mt-1.5 text-caption text-feedback-error">{s.error}</p>
      ) : (
        <>
          {s.meaning && (
            <p className="mt-1 text-caption italic leading-snug text-text-secondary">They said: {s.meaning}</p>
          )}
          <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-body-sm leading-relaxed text-text-primary">
            {s.reply}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* ⚠️ SAID EVERY TIME, not once in a help page: it goes into the box,
                never to the client, and a figure in it is the model's guess. */}
            <p className="text-micro text-text-secondary">Goes into your reply box — check any price or date first.</p>
            <button
              type="button"
              onClick={() => onUse(s.reply)}
              className="shrink-0 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white transition-opacity hover:opacity-90"
            >
              Use this
            </button>
          </div>
        </>
      )}
    </div>
  );
}
