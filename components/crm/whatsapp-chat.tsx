'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Send, X, Check, CheckCheck, AlertTriangle, FileText, Image as ImageIcon } from 'lucide-react';


import { sendWhatsAppFileAction, sendWhatsAppTextAction } from '@/app/actions/crm-whatsapp';
import { useToast } from '@/components/ui/toast';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE WHATSAPP CONVERSATION, DOCKED BOTTOM-RIGHT — Step 8
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-13: *"please use the WhatsApp green icon… when you click on it
 * and he wants to chat, the proper chat will pop up and it should stick to the
 * right bottom, like a proper chatbot… He can message. He can send an image. He
 * can send files."*
 *
 * ── ⚠️ THE GREEN IS WHATSAPP'S OWN #25D366, NOT A DESIGN TOKEN ─────────────
 * Every other colour on this screen comes from `tokens.css`, and that is the
 * rule. This one is a BRAND MARK — the thing that makes somebody recognise the
 * button without reading it — and a themed approximation of it is just a green
 * circle. It is therefore hard-coded, once, and used only for the mark and the
 * outgoing bubble.
 *
 * ⚠️ AND THE OUTGOING BUBBLE CARRIES DARK INK ON IT. #25D366 is a light,
 * saturated green: white text on it measures about 2.1:1, far under the 4.5
 * floor. WhatsApp itself puts near-black text on its outgoing bubbles for
 * exactly this reason.
 * ========================================================================= */

import { OPEN_WHATSAPP_EVENT } from '@/components/crm/open-whatsapp-button';
import { WA_BUBBLE_INK, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';

export function WhatsAppChat({
  leadId,
  leadName,
  messages,
  canSend,
  reason,
  defaultOpen = false,
}: {
  leadId: string;
  leadName: string;
  messages: readonly CrmMessage[];
  /** False when the project has no number configured. */
  canSend: boolean;
  /** Why it cannot send, said plainly rather than by a disabled box. */
  reason?: string;
  /** ⚠️ Opened by `?chat=1`, which is how the desk's WhatsApp icon arrives
   *  here — so one click from the list lands on an open conversation rather
   *  than on a page with a button still to find. */
  defaultOpen?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  /* ⚠️ OPENED FROM ELSEWHERE ON THE PAGE. The record's "WhatsApp" button is a
     sibling, not a parent — see `open-whatsapp-button.tsx` for why the state
     cannot simply be lifted — so it asks through a window event instead. */
  React.useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_WHATSAPP_EVENT, show);
    return () => window.removeEventListener(OPEN_WHATSAPP_EVENT, show);
  }, []);

  /* ⚠️ Scrolls the THREAD, not the page. `scrollIntoView` on a nested scroller
     drags the whole document when the panel is near the bottom of the viewport,
     which is exactly where this one lives. */
  React.useEffect(() => {
    if (!open) return;
    const end = endRef.current;
    const box = end?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [open, messages.length]);

  async function sendText() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const result = await sendWhatsAppTextAction(leadId, body);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not send.' });
      return;
    }
    /* Cleared only on success — a refused message stays in the box so nobody
       has to retype what WhatsApp would not take. */
    setDraft('');
    router.refresh();
  }

  async function sendFile(file: File) {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    if (draft.trim()) form.append('caption', draft.trim());
    const result = await sendWhatsAppFileAction(leadId, form);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That file did not send.' });
      return;
    }
    setDraft('');
    router.refresh();
  }

  const unread = messages.filter((m) => m.direction === 'inbound').length;

  return (
    <>
      {/* ── The mark ───────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close the WhatsApp chat' : `Open the WhatsApp chat with ${leadName}`}
        className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ backgroundColor: WA_GREEN }}
      >
        {open ? <X className="size-6" /> : <WhatsAppMark className="size-7" />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-bg-surface px-1 text-caption font-semibold text-text-primary shadow">
            {unread}
          </span>
        )}
      </button>

      {/* ── The panel ──────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-24 right-5 z-40 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
          /* ⚠️ Capped against the VIEWPORT, not a fixed height. On a laptop at
             768px this would otherwise run off the top of the screen and the
             oldest messages would be unreachable. */
          style={{ maxHeight: 'min(32rem, calc(100vh - 8rem))' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ backgroundColor: WA_GREEN }}>
            <WhatsAppMark className="size-5" />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold">{leadName}</p>
              <p className="text-caption opacity-90">WhatsApp</p>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto bg-bg-subtle px-3 py-3">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-caption text-text-secondary">
                No messages yet. Anything you send appears here, and so does their reply.
              </p>
            ) : (
              messages.map((m) => <Bubble key={m.id} message={m} />)
            )}
            <div ref={endRef} />
          </div>

          {canSend ? (
            <div className="border-t border-border-subtle p-2">
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  aria-label="Attach an image or a file"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-text-secondary hover:bg-bg-subtle"
                >
                  <Paperclip className="size-4" />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void sendFile(file);
                    /* ⚠️ Reset, or choosing the SAME file twice fires no change
                       event and the second send silently never happens. */
                    e.target.value = '';
                  }}
                />

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    /* Enter sends, Shift+Enter makes a line — what WhatsApp does. */
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendText();
                    }
                  }}
                  rows={1}
                  placeholder="Write a message"
                  disabled={busy}
                  className="max-h-24 min-h-9 flex-1 resize-none rounded-2xl border border-border-subtle bg-bg-surface px-3 py-2 text-body text-text-primary"
                />

                <button
                  type="button"
                  onClick={() => void sendText()}
                  disabled={busy || !draft.trim()}
                  aria-label="Send"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
                  style={{ backgroundColor: WA_GREEN }}
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          ) : (
            /* ⚠️ THE REASON, NOT A DEAD BOX. A composer that does nothing reads
               as broken; a sentence saying which number is missing is something
               somebody can act on. */
            <div className="border-t border-border-subtle px-4 py-3">
              <p className="text-caption text-text-secondary">
                {reason ?? 'This project has no WhatsApp number set up yet.'}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Bubble({ message }: { message: CrmMessage }) {
  const mine = message.direction === 'outbound';
  const failed = message.status === 'failed';

  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2',
          mine ? 'rounded-br-sm' : 'rounded-bl-sm border border-border-subtle bg-bg-surface',
        )}
        /* ⚠️ Dark ink on the green — white measures ~2.1:1 on #25D366. */
        style={mine ? { backgroundColor: WA_GREEN, color: WA_BUBBLE_INK } : undefined}
      >
        {message.kind !== 'text' && (
          <span className="mb-1 flex items-center gap-1.5 text-caption opacity-80">
            {message.mediaMime?.startsWith('image/') ? (
              <ImageIcon className="size-3.5" />
            ) : (
              <FileText className="size-3.5" />
            )}
            {message.mediaFilename ?? message.kind}
          </span>
        )}

        {message.body && (
          /* ⚠️ `whitespace-pre-wrap` — WhatsApp messages carry real line breaks
             and collapsing them turns a price list into a paragraph. */
          <p className={cn('whitespace-pre-wrap break-words text-body', !mine && 'text-text-primary')}>
            {message.body}
          </p>
        )}

        <span
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-caption',
            mine ? 'opacity-70' : 'text-text-tertiary',
          )}
        >
          {message.sentByName && <span className="mr-auto">{message.sentByName}</span>}
          {new Date(message.occurredAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {mine && !failed && (message.status === 'read' ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />)}
          {failed && <AlertTriangle className="size-3.5" />}
        </span>

        {/* ⚠️ Meta's own words. "Re-engagement message" means the 24-hour window
            has closed and a template is needed — a paraphrase would cost the
            reader the one sentence that says what to do. */}
        {failed && message.errorDetail && (
          <p className="mt-1 text-caption" style={{ color: 'var(--feedback-error)' }}>
            {message.errorDetail}
          </p>
        )}
      </div>
    </div>
  );
}
