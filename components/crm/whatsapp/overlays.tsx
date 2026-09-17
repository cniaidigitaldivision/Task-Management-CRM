'use client';

import * as React from 'react';
import { Check, CheckCheck, Forward, LoaderCircle, Mic, RefreshCw, Search, Send, Sparkles, Trash2, X } from 'lucide-react';

import { forwardMessageAction, forwardTargetsAction, suggestReplyAction } from '@/app/actions/crm-whatsapp';
import { useToast } from '@/components/ui/toast';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import type { ForwardTarget } from '@/lib/db/queries/crm-whatsapp';
import { cn } from '@/lib/utils';
import { EmojiPicker } from './emoji-picker';
import { momentLabel, snippet } from './shared';

/* ============================================================================
 * THE PANELS A MESSAGE'S MENU OPENS
 * ----------------------------------------------------------------------------
 * Each sits over the chat area, inside the drawer — never a browser dialog, and
 * never a second window. Escape or the cross closes it in the same frame.
 * ========================================================================= */

function useEscape(onClose: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

function Sheet({
  title,
  onClose,
  children,
  className,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  useEscape(onClose);
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/25" onMouseDown={onClose}>
      <div
        className={cn('flex max-h-full flex-col overflow-hidden rounded-t-2xl border border-border-subtle bg-bg-surface shadow-2xl', className)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h3 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ── Message info ─────────────────────────────────────────────────────────── */

export function MessageInfo({ message, leadName, nowMs, onClose }: { message: CrmMessage; leadName: string; nowMs: number; onClose: () => void }) {
  const mine = message.direction === 'outbound';
  const row = (icon: React.ReactNode, label: string, at: string | null, pending: string) => (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{at ? momentLabel(at, nowMs) : pending}</span>
      </span>
    </li>
  );
  return (
    <Sheet title="Message info" onClose={onClose}>
      <div className="border-b border-border-subtle px-4 py-3">
        <p className="line-clamp-3 rounded-lg px-3 py-2 text-body-sm" style={{ background: mine ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)', color: 'var(--wa-ink)' }}>
          {snippet(message)}
        </p>
        {mine && message.sentByName && <p className="mt-1.5 text-caption text-text-secondary">Sent by {message.sentByName}</p>}
      </div>
      <ul className="py-1">
        {mine ? (
          <>
            {row(<CheckCheck className="size-4" style={{ color: 'var(--wa-tick-read)' }} />, 'Read', message.readAt, message.status === 'failed' ? '—' : `Not yet read by ${leadName}`)}
            {message.mediaVoice && row(<Mic className="size-4" style={{ color: 'var(--wa-tick-read)' }} />, 'Played', message.playedAt, 'Not yet played')}
            {row(<CheckCheck className="size-4 text-text-secondary" />, 'Delivered', message.deliveredAt ?? message.readAt, message.status === 'failed' ? 'Not delivered' : 'Not yet delivered')}
            {row(<Check className="size-4 text-text-secondary" />, 'Sent', message.occurredAt, '—')}
          </>
        ) : (
          row(<Check className="size-4 text-text-secondary" />, 'Received', message.occurredAt, '—')
        )}
      </ul>
      {message.status === 'failed' && message.errorDetail && (
        <p className="border-t border-border-subtle px-4 py-2.5 text-caption text-feedback-error">{message.errorDetail}</p>
      )}
    </Sheet>
  );
}

/* ── Delete ───────────────────────────────────────────────────────────────── */

export function DeleteConfirm({ leadName, busy, onConfirm, onClose }: { leadName: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/30 p-6" onMouseDown={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-surface p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-label="Delete message">
        <h3 className="text-body font-semibold text-text-primary">Delete this message?</h3>
        {/* ⚠️ SAID BEFORE THE BUTTON, not discovered after it. */}
        <p className="mt-1.5 text-body-sm leading-relaxed text-text-secondary">
          It disappears from this chat for everyone at CNI. It cannot be unsent: the WhatsApp Business API that the CRM
          sends through has no &ldquo;delete for everyone&rdquo;, so{' '}
          <span className="font-medium text-text-primary">{leadName}</span> will still see it on their phone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border-default px-3.5 py-2 text-caption font-semibold text-text-primary hover:bg-bg-subtle">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-feedback-error px-3.5 py-2 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete in CRM
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── More reactions ───────────────────────────────────────────────────────── */

export function ReactionSheet({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-end justify-center bg-black/20 pb-3" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <EmojiPicker onPick={onPick} onClose={onClose} />
      </div>
    </div>
  );
}

/* ── Forward ──────────────────────────────────────────────────────────────── */

export function ForwardPanel({ message, leadId, onClose }: { message: CrmMessage; leadId: string; onClose: () => void }) {
  const toast = useToast();
  const [query, setQuery] = React.useState('');
  const [targets, setTargets] = React.useState<readonly ForwardTarget[] | null>(null);
  const [chosen, setChosen] = React.useState<readonly ForwardTarget[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      void forwardTargetsAction(leadId, query).then((r) => live && setTargets(r));
    }, query ? 220 : 0);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [leadId, query]);

  const toggle = (t: ForwardTarget) =>
    setChosen((c) => (c.some((x) => x.id === t.id) ? c.filter((x) => x.id !== t.id) : c.length >= 5 ? c : [...c, t]));

  const send = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const r = await forwardMessageAction(message.id, chosen.map((c) => c.id));
      const sent = r.results?.filter((x) => x.ok).length ?? 0;
      const failed = r.results?.filter((x) => !x.ok) ?? [];
      if (!r.ok && !r.results) toast({ tone: 'error', text: r.error ?? 'That could not be forwarded.' });
      else if (failed.length === 0) toast({ tone: 'ok', text: `Forwarded to ${sent === 1 ? chosen[0].name : `${sent} leads`}.` });
      else toast({ tone: sent ? 'warn' : 'error', text: `${sent} sent, ${failed.length} not delivered — ${failed[0].error ?? 'refused'}` });
      if (r.ok) onClose();
    } catch {
      toast({ tone: 'error', text: 'That could not be forwarded — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={<span className="flex items-center gap-2"><Forward className="size-4" aria-hidden="true" /> Forward message</span>} onClose={onClose} className="h-full rounded-t-none">
      <div className="border-b border-border-subtle px-4 py-2.5">
        <p className="truncate rounded-lg bg-bg-subtle px-3 py-1.5 text-caption text-text-secondary">{snippet(message)}</p>
        <label className="mt-2 flex items-center gap-2 rounded-lg border border-border-default px-3 py-1.5 focus-within:border-accent-primary">
          <Search className="size-4 text-text-secondary" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your leads by name or number"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        {message.direction === 'inbound' && (
          <p className="mt-2 text-micro leading-relaxed text-text-secondary">
            This was written by the client. Forwarding shares their words with somebody else.
          </p>
        )}
      </div>
      <ul className="min-h-[8rem] flex-1 overflow-y-auto py-1">
        {targets === null ? (
          <li className="px-4 py-6 text-center text-caption text-text-secondary">Loading your leads…</li>
        ) : targets.length === 0 ? (
          <li className="px-4 py-6 text-center text-caption text-text-secondary">No leads match.</li>
        ) : (
          targets.map((t) => {
            const on = chosen.some((c) => c.id === t.id);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => toggle(t)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bg-subtle">
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded border', on ? 'border-transparent bg-[#00a884] text-white' : 'border-border-default')}>
                    {on && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-text-primary">{t.name}</span>
                    <span className="block truncate text-caption text-text-secondary">{t.projectName}</span>
                  </span>
                  {/* ⚠️ SAID BEFORE SENDING: outside the window WhatsApp will refuse it. */}
                  <span className={cn('shrink-0 text-micro', t.windowOpen ? 'text-feedback-success' : 'text-text-tertiary')}>
                    {t.windowOpen ? 'Chat open' : '24 h window closed'}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      <footer className="flex items-center gap-2 border-t border-border-subtle px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-caption text-text-secondary">
          {chosen.length ? chosen.map((c) => c.name).join(', ') : 'Choose up to 5 leads'}
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!chosen.length || busy}
          aria-label="Forward"
          className="grid size-10 place-items-center rounded-full bg-[#00a884] text-white disabled:opacity-40"
        >
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
        </button>
      </footer>
    </Sheet>
  );
}

/* ── Ask AI ───────────────────────────────────────────────────────────────── */

export function AskAIPanel({
  message,
  onUse,
  onClose,
}: {
  message: CrmMessage;
  onUse: (reply: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = React.useState<{ loading: boolean; meaning: string | null; reply: string; error: string | null }>({
    loading: true, meaning: null, reply: '', error: null,
  });
  const [round, setRound] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void suggestReplyAction(message.id)
      .then((r) => {
        if (!live) return;
        setState(r.ok && r.suggestion
          ? { loading: false, meaning: r.suggestion.meaning, reply: r.suggestion.reply, error: null }
          : { loading: false, meaning: null, reply: '', error: r.error ?? 'AI could not draft a reply.' });
      })
      .catch(() => live && setState({ loading: false, meaning: null, reply: '', error: 'The connection dropped.' }));
    return () => {
      live = false;
    };
  }, [message.id, round]);

  const again = () => {
    setState({ loading: true, meaning: null, reply: '', error: null });
    setRound((r) => r + 1);
  };

  return (
    <Sheet title={<span className="flex items-center gap-2"><Sparkles className="size-4" aria-hidden="true" /> Ask AI</span>} onClose={onClose}>
      <div className="space-y-3 px-4 py-3">
        <p className="line-clamp-2 rounded-lg px-3 py-2 text-body-sm" style={{ background: 'var(--wa-bubble-in)', color: 'var(--wa-ink)', boxShadow: '0 1px 0.5px var(--wa-shadow)' }}>
          {snippet(message)}
        </p>
        {state.loading ? (
          <div className="space-y-2 py-1" aria-busy="true">
            {['w-11/12', 'w-full', 'w-2/3'].map((w) => <span key={w} className={cn('block h-3 animate-pulse rounded bg-bg-subtle', w)} />)}
          </div>
        ) : state.error ? (
          <p className="text-caption text-feedback-error">{state.error}</p>
        ) : (
          <>
            {state.meaning && (
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-text-secondary">What it means</p>
                <p className="mt-0.5 text-body-sm text-text-primary">{state.meaning}</p>
              </div>
            )}
            <div>
              <p className="text-micro font-semibold uppercase tracking-wide text-text-secondary">Suggested reply</p>
              <textarea
                value={state.reply}
                onChange={(e) => setState((s) => ({ ...s, reply: e.target.value }))}
                rows={4}
                className="mt-1 w-full resize-y rounded-lg border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>
          </>
        )}
        <p className="text-micro leading-relaxed text-text-secondary">
          A draft from AI — it goes into your reply box, never straight to the client. Check any price or date before you send.
        </p>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-2.5">
        <button type="button" onClick={again} disabled={state.loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-2 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50">
          <RefreshCw className="size-4" aria-hidden="true" /> Try again
        </button>
        <button
          type="button"
          onClick={() => onUse(state.reply)}
          disabled={state.loading || !state.reply.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-2 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          Use this reply
        </button>
      </footer>
    </Sheet>
  );
}
