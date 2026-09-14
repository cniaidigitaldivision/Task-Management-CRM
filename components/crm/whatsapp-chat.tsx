'use client';

import * as React from 'react';
import { Paperclip, Send, X, Check, CheckCheck, AlertTriangle, FileText, Image as ImageIcon } from 'lucide-react';


import {
  readWhatsAppThreadAction,
  sendWhatsAppFileAction,
  sendWhatsAppTextAction,
} from '@/app/actions/crm-whatsapp';
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

/** ⚠️ 5s while the panel is open and the tab is in front. Fast enough that a
 *  reply feels like it arrived, cheap enough that it is one small query — and
 *  paused entirely when the tab is hidden, which is where a naive poll spends
 *  most of its budget. */
const POLL_MS = 5_000;

/* ============================================================================
 * META'S 24-HOUR WINDOW, SAID OUT LOUD
 * ----------------------------------------------------------------------------
 * WhatsApp allows free-form text only within 24 hours of the CUSTOMER'S last
 * message. Outside it Meta refuses everything but an approved template — refuses
 * at the API, not as a guideline.
 *
 * ⚠️ IT WAS INVISIBLE UNTIL THE MOMENT IT COST SOMETHING. The composer looked
 * identical whether the window was open or three days shut, so the way a
 * salesperson found out was by writing a message, pressing send, and reading a
 * refusal. During the weeks of tester use this is the friction they will meet
 * most often, and "it stopped working" is what it looks like from the outside.
 *
 * ⚠️ AND THE CLOCK STARTS AT THEIR MESSAGE, NOT OURS. Replying does not extend
 * it — only the customer writing again does. Measuring from the last message of
 * either direction would show a window that is open when Meta thinks it is shut,
 * which is worse than showing nothing.
 *
 * ⚠️ WARNED, NOT BLOCKED. Meta is the authority on its own window: our copy of
 * the conversation can be missing a message, and a clock can drift. So a closed
 * window greys nothing out — it says what will happen, and the refusal in Meta's
 * own words is still the backstop.
 * ========================================================================= */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function freeWindow(messages: readonly CrmMessage[], nowMs: number) {
  let lastInbound = 0;
  for (const m of messages) {
    if (m.direction === 'inbound') {
      lastInbound = Math.max(lastInbound, Date.parse(m.occurredAt));
    }
  }
  /* Nobody has ever written to us: there is no window, and there never was one.
     A lead who only ever filled in a form can be reached by template only. */
  if (lastInbound === 0) return { state: 'never' as const, leftMs: 0 };

  const leftMs = lastInbound + WINDOW_MS - nowMs;
  return leftMs > 0
    ? { state: 'open' as const, leftMs }
    : { state: 'closed' as const, leftMs: 0 };
}

function humanLeft(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function WhatsAppChat({
  leadId,
  leadName,
  messages: initialMessages,
  canSend,
  reason,
  defaultOpen = false,
}: {
  leadId: string;
  leadName: string;
  /** The thread as the server rendered it. Kept as the starting point; the
   *  panel polls for anything that arrives after. */
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
  const [open, setOpen] = React.useState(defaultOpen);
  const [messages, setMessages] = React.useState<readonly CrmMessage[]>(initialMessages);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  /* ⚠️ ADJUSTED DURING RENDER, NOT IN AN EFFECT. A fresh server render wins —
     a navigation has just read the thread and it is newer than whatever was
     polled — but doing that in an effect paints the stale thread first and then
     replaces it, and `react-hooks/set-state-in-effect` refuses it outright.
     This is React's documented shape for reconciling state with a prop. */
  const [seededFrom, setSeededFrom] = React.useState(initialMessages);
  if (seededFrom !== initialMessages) {
    setSeededFrom(initialMessages);
    setMessages(initialMessages);
  }

  /* ── ⚠️ THE REPLY HAS TO ARRIVE BY ITSELF ─────────────────────────────────
     Owner, 2026-09-13: *"when I reply back from there, it is not receiving in a
     chat."* Half of that was migration 142 — the reply was filed against a
     sibling lead sharing the number. The other half is here: nothing on the page
     ever asked again, so a message that landed after render stayed invisible
     until a reload.

     ⚠️ ONLY WHILE OPEN AND ONLY WHILE THE TAB IS IN FRONT. A CRM tab sits
     abandoned for hours; a poll that keeps running behind it spends the whole
     day's queries on a panel nobody is looking at. `visibilitychange` also
     fires a read on the way back, so returning to the tab is instant rather
     than up to POLL_MS late. */
  React.useEffect(() => {
    if (!open) return;

    let alive = true;
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const fresh = await readWhatsAppThreadAction(leadId);
        /* ⚠️ Guarded — the panel can close, or the lead change, while this is in
           flight, and writing then would resurrect a dead thread. */
        if (alive) setMessages(fresh);
      } catch {
        /* A dropped poll is not worth a toast. The next one is 5s away, and the
           thread on screen is still the last thing that was true. */
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    const onVisible = () => void read();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, leadId]);

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
    /* ⚠️ The thread, not the page. This used to be `router.refresh()`, which
       re-ran the record, the roster and the cached AI reading to show one
       bubble — and took the router hook with it. */
    setMessages(await readWhatsAppThreadAction(leadId));
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
    setMessages(await readWhatsAppThreadAction(leadId));
  }

  /* ⚠️ "THEY SAID SOMETHING YOU HAVE NOT ANSWERED", not "how many times they
     have ever written". Counting every inbound message put a permanent 4 on the
     button of a conversation that was finished, which reads as a fault. There is
     no read-state column and this needs none: anything inbound after the last
     thing we said is, by definition, still owed a reply. */
  const lastOutboundAt = messages.reduce(
    (latest, m) =>
      m.direction === 'outbound' ? Math.max(latest, Date.parse(m.occurredAt)) : latest,
    0,
  );
  /* ⚠️ A TICKING CLOCK, NOT A RENDER-TIME SNAPSHOT. "closes in 1 hour" that
     still says an hour later is worse than no number at all. One minute is
     plenty — the thing being counted is 24 hours long — and it only runs while
     the panel is open. */
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [open]);

  const windowState = freeWindow(messages, nowMs);

  const unread = messages.filter(
    (m) => m.direction === 'inbound' && Date.parse(m.occurredAt) > lastOutboundAt,
  ).length;

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
              {windowState.state !== 'open' && (
                /* ⚠️ ABOVE THE BOX, NOT AFTER THE SEND. The point is to be read
                   before somebody spends a paragraph on it. */
                <p className="mb-1.5 flex items-start gap-1.5 rounded-lg bg-bg-subtle px-2 py-1.5 text-caption text-text-secondary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {windowState.state === 'closed'
                      ? 'They last wrote over 24 hours ago, so WhatsApp will refuse a free message. Only an approved template can reach them now.'
                      : 'They have never messaged us, so WhatsApp will only accept an approved template.'}
                  </span>
                </p>
              )}
              {windowState.state === 'open' && windowState.leftMs < 3 * 60 * 60 * 1000 && (
                /* ⚠️ ONLY IN THE LAST THREE HOURS. A badge that is always there
                   is furniture; one that appears when the clock matters is a
                   prompt. */
                <p className="mb-1.5 text-caption text-text-secondary">
                  Free reply closes in {humanLeft(windowState.leftMs)}.
                </p>
              )}
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

/* ============================================================================
 * THE ATTACHMENT ITSELF
 * ----------------------------------------------------------------------------
 * ⚠️ THE BYTES COME FROM OUR OWN ROUTE, NOT FROM META. A WhatsApp media URL
 * needs the system-user bearer token, so it is not something a browser can
 * fetch — putting one in an `src` gives a 401 that looks exactly like a broken
 * image. `/api/whatsapp/media/<message id>` holds the token server-side and is
 * scoped by the same RLS that decides whether this thread is readable at all.
 *
 * ⚠️ AND A MESSAGE WITH NO `media_id` IS NORMAL, NOT BROKEN — every outbound
 * file sent before the id was kept (2026-09-14) is in that state. It shows as
 * the chip it always was rather than as a link that 404s.
 * ========================================================================= */
function Attachment({ message, mine }: { message: CrmMessage; mine: boolean }) {
  const label = message.mediaFilename ?? message.kind;
  const isImage = message.mediaMime?.startsWith('image/') ?? message.kind === 'image';

  if (!message.mediaId) {
    return (
      <span className="mb-1 flex items-center gap-1.5 text-caption opacity-80">
        {isImage ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
        {label}
      </span>
    );
  }

  const href = `/api/whatsapp/media/${message.id}`;

  if (isImage) {
    return (
      /* Opens full size in a new tab — the panel is 24rem wide and a floor plan
         is unreadable at that size, which is most of what a property buyer
         sends. */
      <a href={href} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element -- not a static
            asset: it is fetched per message through an authorised route, and
            next/image would try to optimise a URL it cannot reach. */}
        <img
          src={href}
          alt={message.mediaFilename ?? 'Photo sent on WhatsApp'}
          loading="lazy"
          className="max-h-64 w-full rounded-lg object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'mb-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-caption underline underline-offset-2',
        mine ? 'bg-black/10' : 'bg-bg-subtle',
      )}
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
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
        {message.kind !== 'text' && <Attachment message={message} mine={mine} />}

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
