'use client';

import * as React from 'react';
import { ArrowLeft, Pencil, Plus, Search, Trash2, Users, UserRound, X, Zap } from 'lucide-react';

import { deleteSavedReplyAction, saveSavedReplyAction, savedRepliesAction } from '@/app/actions/crm-whatsapp';
import { useToast } from '@/components/ui/toast';
import type { SavedReplies, SavedReply } from '@/lib/db/queries/crm-whatsapp';
import { cn } from '@/lib/utils';
import { PLACEHOLDERS, fillReply, type ReplyVariables } from './shared';

/* ============================================================================
 * SAVED REPLIES
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"I am Sarah, sales executive, how can I help you — this
 * type of formal message should be saved for everyone, according to their name."*
 *
 * One reply, filled in for whoever uses it: {{my_first_name}} is Sarah when Sarah
 * sends it and Sahad when Sahad does; {{company}} is the business the lead's
 * WhatsApp number belongs to. Team replies are a manager's to write (184); anyone
 * can keep personal ones. Type "/" in the message box, or press the lightning.
 *
 * ⚠️ LOADED ONCE PER PAGE, in the background when the chat first mounts, and
 * kept — so the list opens instantly for every lead after the first.
 * ========================================================================= */

let cache: SavedReplies | null = null;
let loading: Promise<SavedReplies> | null = null;

export function loadSavedReplies(): Promise<SavedReplies> {
  if (cache) return Promise.resolve(cache);
  loading ??= savedRepliesAction()
    .then((r) => (cache = r))
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useSavedReplies() {
  const [data, setData] = React.useState<SavedReplies | null>(cache);
  React.useEffect(() => {
    if (data) return;
    let live = true;
    void loadSavedReplies().then((r) => live && setData(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, [data]);
  const replace = React.useCallback((next: SavedReplies) => {
    cache = next;
    setData(next);
  }, []);
  return [data, replace] as const;
}

export function matchReplies(replies: readonly SavedReply[], query: string): SavedReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...replies];
  return replies.filter(
    (r) => r.shortcut?.startsWith(q) || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q),
  );
}

export function SavedRepliesPanel({
  data,
  onData,
  vars,
  query,
  activeIndex,
  onPick,
  onClose,
}: {
  data: SavedReplies | null;
  onData: (next: SavedReplies) => void;
  vars: ReplyVariables;
  /** From "/…" in the message box; null when opened by the button. */
  query: string | null;
  activeIndex: number;
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<SavedReply | 'new' | null>(null);
  const q = query ?? search;
  const list = data ? matchReplies(data.replies, q) : [];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (editing) setEditing(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, onClose]);

  if (editing) {
    return (
      <Editor
        reply={editing === 'new' ? null : editing}
        canWriteTeam={data?.canWriteTeam ?? false}
        vars={vars}
        onBack={() => setEditing(null)}
        onSaved={(next) => {
          onData(next);
          setEditing(null);
          toast({ tone: 'ok', text: 'Saved reply updated.' });
        }}
      />
    );
  }

  const section = (title: string, Icon: React.ComponentType<{ className?: string }>, items: SavedReply[]) =>
    items.length > 0 && (
      <section key={title}>
        <h4 className="sticky top-0 z-10 flex items-center gap-1.5 bg-bg-surface px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-text-secondary">
          <Icon className="size-3.5" /> {title}
        </h4>
        {items.map((r) => {
          const idx = list.indexOf(r);
          return (
            <div key={r.id} className={cn('group flex items-start gap-2 px-3 py-2', idx === activeIndex ? 'bg-bg-subtle' : 'hover:bg-bg-subtle')}>
              <button type="button" onClick={() => onPick(fillReply(r.body, vars))} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate text-body-sm font-semibold text-text-primary">{r.title}</span>
                  {r.shortcut && <span className="shrink-0 rounded bg-bg-subtle px-1.5 text-micro text-text-secondary">/{r.shortcut}</span>}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-caption leading-snug text-text-secondary">{fillReply(r.body, vars)}</span>
              </button>
              {r.editable && (
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  aria-label={`Edit ${r.title}`}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-text-secondary opacity-0 hover:bg-bg-surface group-hover:opacity-100"
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </section>
    );

  return (
    <div className="flex max-h-[22rem] w-full flex-col overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Zap className="size-4 text-[#00a884]" aria-hidden="true" />
        {query === null ? (
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="size-3.5 text-text-secondary" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search saved replies"
              className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </label>
        ) : (
          <p className="min-w-0 flex-1 truncate text-caption text-text-secondary">
            Saved replies{query ? ` matching “${query}”` : ''} · ↑↓ then Enter
          </p>
        )}
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold text-text-brand hover:bg-bg-subtle">
          <Plus className="size-3.5" aria-hidden="true" /> New
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {!data ? (
          <p className="px-3 py-6 text-center text-caption text-text-secondary">Loading saved replies…</p>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-center text-caption text-text-secondary">
            {data.replies.length === 0 ? 'No saved replies yet.' : 'Nothing matches.'}
          </p>
        ) : (
          <>
            {section('Mine', UserRound, list.filter((r) => r.scope === 'personal'))}
            {section('Team', Users, list.filter((r) => r.scope === 'team'))}
          </>
        )}
      </div>
    </div>
  );
}

function Editor({
  reply,
  canWriteTeam,
  vars,
  onBack,
  onSaved,
}: {
  reply: SavedReply | null;
  canWriteTeam: boolean;
  vars: ReplyVariables;
  onBack: () => void;
  onSaved: (next: SavedReplies) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = React.useState(reply?.title ?? '');
  const [shortcut, setShortcut] = React.useState(reply?.shortcut ?? '');
  const [body, setBody] = React.useState(reply?.body ?? '');
  const [scope, setScope] = React.useState<'team' | 'personal'>(reply?.scope ?? 'personal');
  const [busy, setBusy] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const next = body.slice(0, at) + token + body.slice(el?.selectionEnd ?? at);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; saved?: SavedReplies }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok && r.saved) onSaved(r.saved);
      else toast({ tone: 'error', text: r.error ?? 'That did not save.' });
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-h-[26rem] w-full flex-col overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <p className="flex-1 text-body-sm font-semibold text-text-primary">{reply ? 'Edit saved reply' : 'New saved reply'}</p>
        {reply && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => deleteSavedReplyAction(reply.id))}
            aria-label="Delete"
            className="grid size-7 place-items-center rounded-md text-feedback-error hover:bg-bg-subtle"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Name — e.g. Greeting" aria-label="Name"
            className="min-w-0 flex-1 rounded-lg border border-border-default bg-bg-base px-3 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none" />
          <label className="flex w-32 items-center rounded-lg border border-border-default bg-bg-base px-2 focus-within:border-accent-primary">
            <span className="text-body-sm text-text-secondary">/</span>
            <input value={shortcut} onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={24} placeholder="shortcut" aria-label="Shortcut"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-body-sm text-text-primary focus:outline-none" />
          </label>
        </div>
        <textarea ref={area} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4096}
          placeholder="AoA Sir, welcome on behalf of {{company}}. I am {{my_first_name}}. Kindly let me know how I can assist you."
          className="w-full resize-y rounded-lg border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none" />
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <button key={p.token} type="button" onClick={() => insert(p.token)} className="rounded-full border border-border-default px-2 py-0.5 text-micro text-text-secondary hover:bg-bg-subtle hover:text-text-primary">
              + {p.label}
            </button>
          ))}
        </div>
        {body.trim() && (
          <div>
            <p className="text-micro font-semibold uppercase tracking-wide text-text-secondary">How it reads for you</p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 text-body-sm" style={{ background: 'var(--wa-bubble-out)', color: 'var(--wa-ink)' }}>
              {fillReply(body, vars)}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {(['personal', 'team'] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={s === 'team' && !canWriteTeam}
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              title={s === 'team' && !canWriteTeam ? 'Only a manager can save a reply for the whole team' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-caption font-medium disabled:opacity-40',
                scope === s ? 'border-accent-primary bg-bg-subtle text-text-primary' : 'border-border-default text-text-secondary',
              )}
            >
              {s === 'team' ? <Users className="size-3.5" /> : <UserRound className="size-3.5" />}
              {s === 'team' ? 'Whole team' : 'Just me'}
            </button>
          ))}
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-border-subtle px-3 py-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle">Cancel</button>
        <button
          type="button"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => void run(() => saveSavedReplyAction({ id: reply?.id ?? null, scope, title, shortcut, body }))}
          className="rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  );
}
