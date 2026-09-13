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

const WA_GREEN = '#25D366';
const WA_BUBBLE_INK = '#0b271a';

/** WhatsApp's own glyph. An inline path, because the CSP admits no icon host. */
function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.21 8.21 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function WhatsAppChat({
  leadId,
  leadName,
  messages,
  canSend,
  reason,
}: {
  leadId: string;
  leadName: string;
  messages: readonly CrmMessage[];
  /** False when the project has no number configured. */
  canSend: boolean;
  /** Why it cannot send, said plainly rather than by a disabled box. */
  reason?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

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
