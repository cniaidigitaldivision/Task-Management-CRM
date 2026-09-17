'use client';

import * as React from 'react';
import { FileText, Headphones, Image as ImageIcon, Mic, Pause, Plus, Send, Smile, Trash2, X, Zap } from 'lucide-react';

import { useToast } from '@/components/ui/toast';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import type { SavedReplies } from '@/lib/db/queries/crm-whatsapp';
import { cn } from '@/lib/utils';
import { EmojiPicker } from './emoji-picker';
import { SavedRepliesPanel, matchReplies } from './saved-replies';
import { fillReply, formatDuration, snippet, type ReplyVariables } from './shared';
import { useVoiceRecorder, type VoiceResult } from './use-voice-recorder';

/* ============================================================================
 * THE WHATSAPP COMPOSER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"when I click on attach, it's not working… send voice,
 * video, images, documents, PDF… and the saved reply."* Laid out the way WhatsApp
 * Web is, so nobody has to learn it: attach, emoji, the box, and a microphone
 * that becomes a send arrow the moment there is something to send.
 *
 * ⚠️ ENTER SENDS, SHIFT+ENTER BREAKS THE LINE. Typing "/" opens saved replies;
 * ↑↓ and Enter choose one, Escape closes.
 * ========================================================================= */

export function WhatsAppComposer({
  disabledReason,
  replyTo,
  replyName,
  onCancelReply,
  draft,
  onDraft,
  saved,
  onSaved,
  vars,
  onSendText,
  onPickFiles,
  onSendVoice,
  inputRef,
}: {
  /** Why nothing can be sent right now — no number, still loading. Null when it can. */
  disabledReason: string | null;
  replyTo: CrmMessage | null;
  replyName: string;
  onCancelReply: () => void;
  draft: string;
  onDraft: (v: string) => void;
  saved: SavedReplies | null;
  onSaved: (next: SavedReplies) => void;
  vars: ReplyVariables;
  onSendText: (text: string) => void;
  onPickFiles: (files: File[]) => void;
  onSendVoice: (voice: VoiceResult) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const toast = useToast();
  const [panel, setPanel] = React.useState<null | 'emoji' | 'attach' | 'saved'>(null);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const docInput = React.useRef<HTMLInputElement>(null);
  const mediaInput = React.useRef<HTMLInputElement>(null);
  const audioInput = React.useRef<HTMLInputElement>(null);
  const onRecorderError = React.useCallback((m: string) => toast({ tone: 'error', text: m }), [toast]);
  const recorder = useVoiceRecorder(onRecorderError);

  const slash = /^\/([a-z0-9-]*)$/i.exec(draft);
  const slashQuery = slash ? slash[1].toLowerCase() : null;
  const slashList = slashQuery !== null && saved ? matchReplies(saved.replies, slashQuery) : [];
  const showSaved = panel === 'saved' || slashQuery !== null;

  const blocked = Boolean(disabledReason);
  const recording = recorder.state === 'recording' || recorder.state === 'paused';

  const insertAtCursor = (text: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    onDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const pickSaved = (text: string) => {
    onDraft(text);
    setPanel(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(text.length, text.length);
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    onSendText(text);
  };

  const files = (list: FileList | null) => {
    setPanel(null);
    if (list && list.length) onPickFiles(Array.from(list));
  };

  const finishVoice = async () => {
    const result = await recorder.finish();
    if (result) onSendVoice(result);
  };

  return (
    <div className="relative">
      {/* ── Popovers above the box ── */}
      {panel === 'emoji' && (
        <div className="absolute bottom-full left-0 z-30 mb-2">
          <EmojiPicker onPick={insertAtCursor} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'attach' && (
        <AttachMenu
          onClose={() => setPanel(null)}
          onDocument={() => docInput.current?.click()}
          onMedia={() => mediaInput.current?.click()}
          onAudio={() => audioInput.current?.click()}
        />
      )}
      {showSaved && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-2">
          <SavedRepliesPanel
            data={saved}
            onData={onSaved}
            vars={vars}
            query={slashQuery}
            activeIndex={slashQuery !== null ? Math.min(slashIndex, Math.max(0, slashList.length - 1)) : -1}
            onPick={pickSaved}
            onClose={() => {
              setPanel(null);
              if (slashQuery !== null) onDraft('');
            }}
          />
        </div>
      )}

      <input ref={docInput} type="file" multiple hidden onChange={(e) => { files(e.target.files); e.target.value = ''; }} />
      <input ref={mediaInput} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => { files(e.target.files); e.target.value = ''; }} />
      <input ref={audioInput} type="file" multiple hidden accept="audio/*" onChange={(e) => { files(e.target.files); e.target.value = ''; }} />

      {/* ── Replying to ── */}
      {replyTo && (
        <div className="mb-1.5 flex items-stretch overflow-hidden rounded-lg" style={{ background: 'color-mix(in oklab, var(--wa-ink) 6%, var(--bg-surface))' }}>
          <span className="w-1 shrink-0" style={{ background: replyTo.direction === 'outbound' ? '#06cf9c' : '#53bdeb' }} />
          <div className="min-w-0 flex-1 px-2.5 py-1.5">
            <p className="text-caption font-semibold" style={{ color: replyTo.direction === 'outbound' ? '#06cf9c' : '#53bdeb' }}>
              {replyTo.direction === 'outbound' ? 'You' : replyName}
            </p>
            <p className="truncate text-caption text-text-secondary">{snippet(replyTo)}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="grid w-9 place-items-center text-text-secondary hover:text-text-primary">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {recording ? (
        /* ── Recording ── */
        <div className="flex items-center gap-2 rounded-full border border-border-default bg-bg-surface px-2 py-1.5">
          <button type="button" onClick={recorder.cancel} aria-label="Delete recording" className="grid size-9 place-items-center rounded-full text-text-secondary hover:bg-bg-subtle hover:text-feedback-error">
            <Trash2 className="size-5" aria-hidden="true" />
          </button>
          <span className={cn('size-2.5 shrink-0 rounded-full bg-feedback-error', recorder.state === 'recording' && 'animate-pulse')} />
          <span className="w-11 shrink-0 text-body-sm tabular-nums text-text-primary">{formatDuration(recorder.elapsed)}</span>
          <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden="true">
            {recorder.levels.map((l, i) => (
              <span key={i} className="w-[3px] shrink-0 rounded-full bg-text-secondary" style={{ height: `${Math.max(12, l * 100)}%`, opacity: 0.35 + l * 0.65 }} />
            ))}
          </div>
          <button
            type="button"
            onClick={recorder.state === 'recording' ? recorder.pause : recorder.resume}
            aria-label={recorder.state === 'recording' ? 'Pause' : 'Resume'}
            className="grid size-9 place-items-center rounded-full text-feedback-error hover:bg-bg-subtle"
          >
            {recorder.state === 'recording' ? <Pause className="size-5" fill="currentColor" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => void finishVoice()} aria-label="Send voice message" className="grid size-10 place-items-center rounded-full bg-[#00a884] text-white hover:brightness-95">
            <Send className="size-5 translate-x-px" aria-hidden="true" />
          </button>
        </div>
      ) : (
        /* ── The box ── */
        <div className="flex items-end gap-1">
          <IconButton label="Attach" active={panel === 'attach'} disabled={blocked} onClick={() => setPanel((p) => (p === 'attach' ? null : 'attach'))}>
            <Plus className={cn('size-6 transition-transform', panel === 'attach' && 'rotate-45')} aria-hidden="true" />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-end rounded-3xl border border-border-default bg-bg-surface pl-1 focus-within:border-accent-primary">
            <IconButton label="Emoji" active={panel === 'emoji'} onClick={() => setPanel((p) => (p === 'emoji' ? null : 'emoji'))}>
              <Smile className="size-5" aria-hidden="true" />
            </IconButton>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                onDraft(e.target.value);
                setSlashIndex(0);
              }}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files);
                if (pasted.length) {
                  e.preventDefault();
                  onPickFiles(pasted);
                }
              }}
              onKeyDown={(e) => {
                if (slashQuery !== null && slashList.length) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashList.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + slashList.length) % slashList.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    pickSaved(fillReply(slashList[Math.min(slashIndex, slashList.length - 1)].body, vars));
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === 'Escape' && replyTo) onCancelReply();
              }}
              placeholder={disabledReason ?? 'Type a message — or / for saved replies'}
              disabled={blocked}
              className="max-h-36 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-body-sm leading-5 text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <IconButton label="Saved replies" active={panel === 'saved'} disabled={blocked} onClick={() => setPanel((p) => (p === 'saved' ? null : 'saved'))}>
              <Zap className="size-5" aria-hidden="true" />
            </IconButton>
          </div>
          {draft.trim() ? (
            <button type="button" onClick={send} disabled={blocked} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-[#00a884] text-white hover:brightness-95 disabled:opacity-40">
              <Send className="size-5 translate-x-px" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void recorder.start()}
              disabled={blocked || recorder.state === 'asking'}
              aria-label="Record a voice message"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[#00a884] text-white hover:brightness-95 disabled:opacity-40"
            >
              <Mic className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40',
        active ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function AttachMenu({
  onClose,
  onDocument,
  onMedia,
  onAudio,
}: {
  onClose: () => void;
  onDocument: () => void;
  onMedia: () => void;
  onAudio: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (label: string, hint: string, color: string, Icon: React.ComponentType<{ className?: string }>, run: () => void) => (
    <button type="button" onClick={run} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-subtle">
      <span className="grid size-9 place-items-center rounded-full text-white" style={{ background: color }}>
        <Icon className="size-[18px]" />
      </span>
      <span>
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-micro text-text-secondary">{hint}</span>
      </span>
    </button>
  );

  return (
    <div ref={ref} className="absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1.5 shadow-xl">
      {item('Document', 'PDF, Word, Excel — up to 25 MB', '#7f66ff', FileText, onDocument)}
      {item('Photos & videos', 'Photos up to 5 MB · MP4 up to 16 MB', '#007bfc', ImageIcon, onMedia)}
      {item('Audio', 'MP3, M4A, OGG — up to 16 MB', '#fa6533', Headphones, onAudio)}
      <p className="border-t border-border-subtle px-3 pt-1.5 text-micro leading-relaxed text-text-secondary">
        Or drop files onto the chat, or paste a screenshot.
      </p>
    </div>
  );
}
