'use client';

import * as React from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileText,
  Info,
  Mail,
  MessageSquareQuote,
  NotebookPen,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

import {
  readWhatsAppThreadAction,
  sendWhatsAppTextAction,
} from '@/app/actions/crm-whatsapp';
import { summariseConversationAction } from '@/app/actions/crm-conversation-summary';
import { addNoteAction } from '@/app/actions/crm-leads';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type {
  CrmConversationSummary,
  CrmLeadNote,
  CrmMessage,
  CrmSender,
  CrmSummaryPointKind,
} from '@/lib/db/queries/crm-leads';
import { displayPhone } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CONVERSATIONS — built to the owner's reference of 2026-09-17
 * ----------------------------------------------------------------------------
 * One thread carrying both channels, a banner when a reply has paused the chase,
 * and a composer that says which number it would send from.
 *
 * ── ⚠️ ONE THREAD, TWO CHANNELS — migration 175 ────────────────────────────
 * An email and a WhatsApp message are rows in the same table with a `channel`.
 * The filter above is client state over rows already on the page; asking the
 * server to hide some of what it just sent would be a round trip to perform a
 * `filter()` (Rule Zero, law 3).
 *
 * ── ⚠️ THE SENDING NUMBER IS THE PROJECT'S, AND IT IS NAMED ────────────────
 * Owner: *"its WhatsApp business number will be auto-selected, and if it is
 * anything other than that, then its WhatsApp automation number."* So the
 * composer prints who the client will see it from — and where a project has no
 * number it says so plainly rather than offering a reply box that cannot send.
 * Chitral has none today: 641 real leads, nothing able to message them.
 * ========================================================================= */

type Filter = 'all' | 'whatsapp' | 'email' | 'summary';

/**
 * When a message happened, as one right-aligned string.
 *
 * ⚠️ DATE AND TIME TOGETHER, ONE BLOCK, ONE SIDE. Owner, 2026-09-17: *"time
 * and date both should be right-aligned in one"*, and the reference prints
 * exactly that at the end of the sender's own line — `12 Sep 2026, 11:20 AM`.
 * An earlier pass split them, dropped the date into a separator pill and left
 * the time under the bubble; that is what WhatsApp does on a phone, and it is
 * wrong here, because this thread carries EMAIL too and an email is filed by
 * its date rather than read by its minute.
 *
 * ⚠️ KARACHI, AND "Today" FOR THE DAY SOMEBODY IS READING ON. A line that
 * called this morning "17 Sept 2026" would be correct and read as history.
 */
function stampLabel(iso: string): string {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const at = new Date(iso);
  const now = new Date();
  const time = at.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi',
  });
  if (key(at) === key(now)) return `Today, ${time}`;
  if (key(at) === key(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  /* ⚠️ ASSEMBLED, because en-GB now abbreviates September as "Sept" and the
     reference reads "12 Sep 2026". Day and year are locale-neutral; only the
     month name is borrowed from en-US. */
  const part = (o: Intl.DateTimeFormatOptions, locale = 'en-GB') =>
    at.toLocaleDateString(locale, { ...o, timeZone: 'Asia/Karachi' });
  return `${part({ day: 'numeric' })} ${part({ month: 'short' }, 'en-US')} ${part({ year: 'numeric' })}, ${time}`;
}

export interface ConversationSummaryState {
  readonly summary: CrmConversationSummary | null;
  readonly working: boolean;
  readonly failure: string | null;
  readonly retry: () => void;
}

/**
 * The AI summary for the open drawer — kept current, and started early.
 *
 * ⚠️⚠️ WHY IT NEVER ARRIVED BEFORE. Owner, 2026-09-17: *"the AI summary is
 * rotating or loading but nothing is displayed. I waited a lot."* The request was
 * scheduled in an effect that recorded "already asked" BEFORE its timer fired,
 * and cleared the timer on cleanup. React runs every effect twice in development:
 * run one marked it asked, cleanup cancelled the call, run two saw "already
 * asked" and did nothing — and the skeleton pulsed forever. With no `finally`,
 * a server error would have done the same. "Asked" is now recorded only when the
 * call actually leaves, and the spinner always stops. Verified in the running
 * app with the stored summary deleted: it appears.
 *
 * ⚠️ OWNED BY THE DRAWER, SO IT STARTS BEFORE ANYBODY LOOKS. Measured: the model
 * takes 2.4–4.1 s and the reads ~50 ms in production. Waiting for the Summary
 * view to open made that the visible wait. Now:
 *   · the drawer has been open a little over a second, on any tab → write it;
 *     quick peeks down a list pay for nothing
 *   · the Conversations tab opens → write it now
 * and by the time somebody has read the Overview and pressed Summary, it is
 * normally there. It is kept with the lead's drawer afterwards (`onSummary`),
 * so reopening the lead asks for nothing until a new message or note arrives.
 */
export function useConversationSummary({
  leadId,
  messages,
  noteCount,
  stored,
  loading,
  eager,
  onSummary,
}: {
  leadId: string;
  messages: readonly CrmMessage[];
  noteCount: number;
  stored: CrmConversationSummary | null;
  loading: boolean;
  /** True on the Conversations tab — start without the dwell. */
  eager: boolean;
  onSummary?: (summary: CrmConversationSummary) => void;
}): ConversationSummaryState {
  const [summary, setSummary] = React.useState(stored);
  const [seen, setSeen] = React.useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setSummary(stored);
  }
  const [working, setWorking] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const newest = messages.length > 0 ? messages[messages.length - 1] : null;
  /* Current = written after the newest message and with every note. The COUNT
     is left to the server's own check — the thread on screen is capped. */
  const current =
    summary !== null &&
    summary.lastMessageId === (newest?.id ?? null) &&
    summary.noteCount === noteCount;
  const key = `${newest?.id ?? '-'}:${noteCount}`;
  const askedFor = React.useRef<string | null>(null);

  const write = React.useCallback(
    async (forKey: string) => {
      askedFor.current = forKey;
      setWorking(true);
      setFailure(null);
      try {
        const result = await summariseConversationAction(leadId);
        if (result.ok && result.summary) {
          setSummary(result.summary);
          onSummary?.(result.summary);
        } else {
          setFailure(result.error ?? 'The summary could not be written.');
        }
      } catch {
        setFailure('The summary could not be written — the connection dropped.');
      } finally {
        setWorking(false);
      }
    },
    [leadId, onSummary],
  );

  React.useEffect(() => {
    if (loading || messages.length === 0 || current) return;
    if (askedFor.current === key) return;
    const t = setTimeout(() => void write(key), eager ? 0 : 1_200);
    return () => clearTimeout(t);
  }, [loading, messages.length, current, key, eager, write]);

  const retry = React.useCallback(() => void write(key), [write, key]);
  return { summary, working, failure, retry };
}

export function LeadConversationTab({
  leadId,
  messages,
  notes,
  summary,
  loading = false,
  sender,
  sequencePaused,
  leadName,
  onReviewFollowUp,
}: {
  leadId: string;
  messages: readonly CrmMessage[];
  /** The salesperson's own notes — optional, and shown under the AI summary. */
  notes: readonly CrmLeadNote[];
  /** The AI summary and its progress — owned by the drawer, see `useConversationSummary`. */
  summary: ConversationSummaryState;
  /**
   * The drawer opened from the clicked row and the record is still on its way.
   * ⚠️ Everything that would otherwise claim an absence — "nothing has been
   * sent", "no WhatsApp number" — says it is loading instead. Either would be a
   * lie for the half-second it showed, and somebody would act on it.
   */
  loading?: boolean;
  sender: CrmSender | null;
  /** Why the chase stopped, when it has — migration 170 pauses on a reply. */
  sequencePaused: string | null;
  leadName: string;
  onReviewFollowUp: () => void;
}) {
  const toast = useToast();
  const [sending, setSending] = React.useState(false);
  /* ⚠️ THE THREAD IS LOCAL STATE SEEDED FROM THE SERVER, so a sent message
     appears in the frame it was sent rather than after a round trip to
     Singapore and a full page render — Rule Zero.

     ⚠️ AND IT RESEEDS WHENEVER THE SERVER'S ARRAY CHANGES, not only when the
     lead does. It used to key on the lead id — which was fine while the tab
     only ever mounted with its data. Now the drawer opens on the row and the
     messages arrive into a tab that is already mounted for the SAME lead, so
     an id guard would have kept the empty thread it started with forever. */
  const [thread, setThread] = React.useState<readonly CrmMessage[]>(messages);
  const [seen, setSeen] = React.useState(messages);
  if (seen !== messages) {
    setSeen(messages);
    setThread(messages);
  }

  const [filter, setFilter] = React.useState<Filter>('all');
  const [oldestFirst, setOldestFirst] = React.useState(true);
  const [dismissed, setDismissed] = React.useState(false);
  const [channel, setChannel] = React.useState<'whatsapp' | 'email'>('whatsapp');
  const [draft, setDraft] = React.useState('');

  const counts = {
    whatsapp: thread.filter((m) => m.channel === 'whatsapp').length,
    email: thread.filter((m) => m.channel === 'email').length,
  };

  /* ⚠️ THE CHAT LAYOUT BELONGS TO THE WHATSAPP VIEW ALONE. Owner, 2026-09-17:
     *"this view that you have actually implemented should be in WhatsApp… all
     the things you displayed previously should be left-aligned."* And they are
     right about why: **All** is a TIMELINE across channels — read top to bottom
     like a history — while **WhatsApp** is a CONVERSATION, where side is the
     fastest way to see who spoke. Sides in a mixed timeline would make an email
     and a WhatsApp reply look like two halves of one exchange. */
  const chat = filter === 'whatsapp';

  /* ⚠⚠ WHY THE OWNER COULD NEVER SEE THIS BANNER. Owner, 2026-09-17: *"I told
     you to show a notification over here also. I want to see what the
     notification will look like."* The banner was gated on `sequencePaused`,
     which is only ever set
     when a CHASE was running and 170 stopped it. A lead somebody has simply
     been messaging — which is every lead being worked by hand, including the
     one the owner was looking at — has no sequence row at all, so the notice
     and its button were unreachable.

     ⚠️ THE REAL CONDITION IS "THEY SPOKE LAST". That is what *"new reply
     received"* claims, it is true whether a sequence exists or not, and it is
     readable straight off the thread already on the page — no query (law 3).
     The pause is EXTRA INFORMATION on the second line, not the trigger. */
  const newest = thread.length > 0 ? thread[thread.length - 1] : null;
  const theySpokeLast = newest?.direction === 'inbound';
  const showBanner = !loading && (theySpokeLast || sequencePaused !== null) && !dismissed;

  /* ⚠️ THE CHAT OPENS AT THE BOTTOM. Owner, 2026-09-17: *"when I switch to
     WhatsApp its scrollbar is stuck at the top — it should be at the bottom so
     I can see the latest message."* A conversation is joined at the end: the
     newest message is the one being answered, and a thread that opens on a
     greeting from three weeks ago makes somebody scroll before they can work.

     ⚠️ ONLY IN THE CHAT VIEW, AND ONLY WHEN NEWEST IS LAST. **All** is a
     history read downwards and jumping it to the foot would hide where it
     starts; and somebody who has asked for newest-first has deliberately put
     the latest message at the TOP, so the foot is the oldest thing there.

     ⚠️ AND IT IS A LAYOUT EFFECT. `useEffect` runs after the browser has
     painted, so the thread would be drawn at the top for one frame and then
     jump — visible, and exactly the flicker Rule Zero exists to prevent. */
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (!chat || !oldestFirst) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, oldestFirst, thread.length]);

  const shown = React.useMemo(() => {
    const kept = filter === 'all' ? thread : thread.filter((m) => m.channel === filter);
    /* ⚠️ A COPY BEFORE SORTING. `messages` is the server's array and reversing it
       in place would reorder the prop for every other reader of it. */
    return oldestFirst ? [...kept] : [...kept].reverse();
  }, [thread, filter, oldestFirst]);

  /**
   * Send it.
   *
   * ⚠️ THIS CALLS THE ACTION THAT WAS ALREADY THERE AND PROVEN LIVE.
   * `sendWhatsAppTextAction` has worked since 2026-09-13 — it checks the
   * number, the project's config, sends through Meta and records the row
   * EITHER WAY, because a refusal is part of the conversation and a failure
   * that leaves no trace looks like a message nobody wrote. The composer
   * simply never called it, which is why pressing send did nothing.
   */
  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    const result =
      channel === 'whatsapp'
        ? await sendWhatsAppTextAction(leadId, text)
        : { ok: false, error: 'Email replies are not wired yet — send a quotation by email from the Related tab.' };

    /* ⚠️ RE-READ EITHER WAY. The action records a refusal as a row, so the
       thread is how somebody finds out the 24-hour window shut — refreshing
       only on success would hide exactly the message that explains it. */
    const fresh = await readWhatsAppThreadAction(leadId);
    setThread(fresh);
    setSending(false);

    if (result.ok) {
      setDraft('');
    } else {
      toast({ tone: 'error', text: result.error ?? 'That did not send.' });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Channel filter ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        {/* ⚠️ THE MARKS CARRY THEIR OWN BRAND COLOUR AND ARE BIG ENOUGH TO BE
            ONE. Owner: *"the WhatsApp icon and the email icon are particularly
            very small… make sure the email icon is blue."* A 16px teal envelope
            is a decoration; a 20px blue one is a channel. */}
        <Chip active={filter === 'whatsapp'} onClick={() => setFilter('whatsapp')}>
          <span style={{ color: filter === 'whatsapp' ? '#ffffff' : WA_GREEN }}>
            <WhatsAppMark className="size-5" />
          </span>
          WhatsApp
          {counts.whatsapp > 0 && <span className="tabular-nums opacity-70">{counts.whatsapp}</span>}
        </Chip>
        <Chip active={filter === 'email'} onClick={() => setFilter('email')}>
          <Mail
            className="size-5"
            style={{ color: filter === 'email' ? '#ffffff' : MAIL_BLUE }}
            aria-hidden="true"
          />
          Email
          {counts.email > 0 && <span className="tabular-nums opacity-70">{counts.email}</span>}
        </Chip>

        {/* ⚠️ WRITTEN BY AI, KEPT, AND LABELLED AS SUCH. Owner, 2026-09-17: *"the
            AI will also summarize my chat. I want there to be a summary of my
            chat that will be auto-summarized."* See `SummaryView` for when it is
            rewritten and why it is never mistaken for a person's note. */}
        <Chip active={filter === 'summary'} onClick={() => setFilter('summary')}>
          <Sparkles className="size-5" aria-hidden="true" />
          Summary
        </Chip>

        {/* ⚠️ THE LABEL SAYS WHAT THE ORDER ACTUALLY IS. The reference reads
            "Newest first" above a thread running oldest to newest; a conversation
            is read downwards, so the default is oldest-first and the control is
            honest about it. */}
        {/* ⚠️ IT LOOKS LIKE THE CHOICE IT IS. A bare label reads as a status
            line; the chevron is what says it can be changed. */}
        {/* ⚠️ NOT ON THE SUMMARY, which is newest-first and has no thread to
            order. A control that changes nothing is one somebody presses twice. */}
        {filter !== 'summary' && (
          <button
            type="button"
            onClick={() => setOldestFirst((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
            Sort: {oldestFirst ? 'Oldest first' : 'Newest first'}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── They answered, and nobody has answered back ─────────────────── */}
      {showBanner && (
        <div
          className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--feedback-success) 35%, transparent)',
            background: 'color-mix(in oklab, var(--feedback-success) 8%, transparent)',
          }}
        >
          {/* ⚠️ A FILLED DISC, not a bare glyph. The reference draws the mark
              reversed out of WhatsApp's own green, which is what makes the
              banner readable as "they messaged you" before any of it is read. */}
          <span
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-white"
            style={{ background: WA_GREEN }}
          >
            <WhatsAppMark className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            {/* ⚠️ THE HEADLINE ONLY CLAIMS THE PART THAT IS TRUE. "Follow-up
                paused" on a lead that never had a sequence would be a sentence
                about machinery that was never running. */}
            <p className="text-body-sm font-semibold text-text-primary">
              New reply received{sequencePaused ? ' — follow-up paused' : ''}
            </p>
            <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
              {/* ⚠️ THE REASON THE ENGINE GAVE, not a sentence written here. 170
                  records why it stopped, and repeating a guess beside it is how
                  two explanations start disagreeing. */}
              {!sequencePaused || sequencePaused === 'the client replied'
                ? 'A new message was received from the lead. Review and respond when ready.'
                : `The chase stopped — ${sequencePaused}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onReviewFollowUp}
            className="shrink-0 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white transition-opacity hover:opacity-90"
          >
            Review follow-up
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── The thread ─────────────────────────────── */}
      {/* ⚠️ THE CHAT IS ANCHORED TO ITS FOOT, not just scrolled there. A
          three-message thread has nothing to scroll, and left at the top it
          sits under a hand-span of empty drawer with the composer far below
          it. `mt-auto` puts the newest message just above the reply box
          whether the thread is three messages or three hundred, so the eye
          lands in the same place either way — which is the actual point of
          the owner's *"I can see the latest message"*, and what WhatsApp
          itself does. It costs nothing when the thread overflows: `auto`
          margins only spend space that is spare. */}
      <div
        ref={scroller}
        className={cn('min-h-0 flex-1 overflow-y-auto', chat && 'flex flex-col')}
      >
        {filter === 'summary' ? (
          <SummaryView
            leadId={leadId}
            messageCount={thread.length}
            notes={notes}
            summary={summary.summary}
            working={summary.working}
            failure={summary.failure}
            onRetry={summary.retry}
            loading={loading}
          />
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-body-sm text-text-secondary">
            {loading
              ? 'Loading the conversation…'
              : thread.length === 0
              ? 'Nothing has been sent or received yet.'
              : `No ${filter} messages on this lead.`}
          </p>
        ) : (
          <ol className={cn('space-y-4', chat && 'mt-auto')}>
            {shown.map((m, i) => (
              <Entry
                key={m.id}
                message={m}
                leadName={leadName}
                chat={chat}
                /* The spine joins one icon to the next, so the last row has
                   nothing to join to. */
                spine={!chat && i < shown.length - 1}
                /* 1rem — the list's own gap, which the spine has to bridge. */
              />
            ))}
          </ol>
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────────────── */}
      {/* ⚠️ ABSENT ON THE SUMMARY. That view has its own box, and two writing
          boxes on one screen is how a note gets sent to the client. */}
      {filter !== 'summary' && (
      <div className="mt-3 shrink-0 border-t border-border-subtle pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border-default">
            <button
              type="button"
              onClick={() => setChannel('whatsapp')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-caption font-medium',
                channel === 'whatsapp' ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary',
              )}
            >
              <span style={{ color: WA_GREEN }}><WhatsAppMark className="size-5" /></span>
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setChannel('email')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-r-lg border-l border-border-default px-2.5 py-1.5 text-caption font-medium',
                channel === 'email' ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary',
              )}
            >
              <Mail className="size-5" style={{ color: MAIL_BLUE }} aria-hidden="true" />
              Email
            </button>
          </div>

          {/* ⚠️ WHO IT WOULD COME FROM, above the box rather than discovered
              afterwards. A salesperson working three projects sends from three
              different businesses, and the client sees the number, not the CRM. */}
          {channel === 'whatsapp' && (
            <p className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
              {loading ? (
                <span>Checking which number this sends from…</span>
              ) : sender?.configured ? (
                <>
                  <span className="truncate font-medium text-text-primary">
                    {sender.displayName}
                  </span>
                  {sender.displayNumber ? (
                    <span className="tabular-nums">{displayPhone(sender.displayNumber)}</span>
                  ) : (
                    /* Configured to send, but nobody has said what the client
                       sees. Readiness asks for this; the composer says it too. */
                    <span className="italic">number not set</span>
                  )}
                  <Info className="size-3.5 shrink-0" aria-hidden="true" />
                </>
              ) : (
                /* ⚠️ NOT A DISABLED BOX. This project genuinely cannot send —
                   Chitral, with 641 real leads, is in exactly this state — so it
                   says which thing is missing rather than greying out a control
                   somebody will press twice. */
                <span className="text-feedback-error">
                  No WhatsApp number on this project — nothing can be sent from here.
                </span>
              )}
            </p>
          )}
        </div>

        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          /* ⚠️ ENTER SENDS, SHIFT+ENTER BREAKS THE LINE — what every messaging
             app does. A reply box that needs the mouse is one people stop
             using mid-conversation. */
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={sending}
          placeholder="Write a reply…"
          className="mt-2 w-full resize-y rounded-lg border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <Paperclip className="size-4" aria-hidden="true" />
            Attach
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <FileText className="size-4" aria-hidden="true" />
            Saved reply
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim() || (channel === 'whatsapp' && !sender?.configured)}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-2 text-caption font-semibold text-white transition-opacity',
              (sending || !draft.trim() || (channel === 'whatsapp' && !sender?.configured)) &&
                'opacity-40',
            )}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

/* ---- One entry ----------------------------------------------------------- */

function Entry({
  message,
  leadName,
  chat,
  spine,
}: {
  message: CrmMessage;
  leadName: string;
  /** True only in the WhatsApp view — see the note where it is set. */
  chat: boolean;
  /** Draw the connector down to the next row. */
  spine: boolean;
}) {
  /* `mine` still decides the bubble's tint and the ticks everywhere; only the
     SIDE is conditional. */
  const mine = message.direction === 'outbound';
  const onRight = chat && mine;
  const isEmail = message.channel === 'email';
  const stamp = stampLabel(message.occurredAt);

  return (
    <li className={cn('relative flex gap-3', onRight && 'flex-row-reverse')}>
      {/* ⚠️ THE SPINE. Owner, 2026-09-17: *"you can see that there is a vertical
          line"* — and the reference runs one down the icon column, joining the
          email mark to each WhatsApp mark below it. It is what makes the column
          read as ONE conversation moving through time rather than four unrelated
          cards, which is the whole claim the tab makes.

          ⚠️ AND IT IS ABSENT IN THE CHAT VIEW, because there the icons alternate
          sides: a spine would zig-zag across the drawer and join nothing. The
          reference draws it in **All**, which is the view it belongs to.

          Geometry: the icon is `size-8` with `mt-0.5`, so it ends 34px down.
          The line starts below it and runs to the foot of the row plus the
          list's 1rem gap, reaching the next icon exactly. */}
      {spine && (
        <span
          aria-hidden="true"
          className="absolute left-4 top-[2.375rem] h-[calc(100%_-_2.375rem_+_1rem)] w-px -translate-x-1/2 bg-border-subtle"
        />
      )}

      {/* The channel, as a mark rather than a word repeated on every line. */}
      <span
        className="relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full"
        style={{
          background: isEmail
            ? 'color-mix(in oklab, #2563EB 12%, transparent)'
            : 'color-mix(in oklab, #25D366 16%, transparent)',
          color: isEmail ? MAIL_BLUE : WA_GREEN,
        }}
      >
        {isEmail ? <Mail className="size-5" aria-hidden="true" /> : <WhatsAppMark className="size-5" />}
      </span>

      <div className={cn('min-w-0 flex-1', onRight && 'flex flex-col items-end')}>
        {/* ⚠️ THE SENDER AND THE STAMP ON ONE ROW, the stamp pushed to the far
            end. The reference does this and it is right for a MIXED thread: the
            names are ragged-left so they can be scanned, and the dates are
            flush-right so they can be scanned separately. Putting the stamp
            under each bubble instead cost a line per message and read as part of
            what was said. */}
        <div
          className={cn(
            'flex w-full items-baseline gap-3',
            onRight ? 'flex-row-reverse' : 'justify-between',
          )}
        >
          <p className="min-w-0 truncate text-body-sm font-semibold text-text-primary">
            {mine ? `You · ${message.sentByName ?? 'you'}` : leadName}{' '}
            <span className="font-normal text-text-secondary">
              {isEmail ? (mine ? 'sent an email' : 'replied by email') : '(WhatsApp)'}
            </span>
          </p>
          <Stamp label={stamp} message={message} mine={mine} />
        </div>

        {isEmail ? (
          <div className={cn('mt-1 flex w-full flex-col', onRight && 'items-end text-right')}>
            {message.subject && (
              <p className="text-body-sm font-semibold text-text-primary">{message.subject}</p>
            )}
            {message.body && (
              /* One line, as the reference has it — the email is a record of what
                 was sent; the attachment is the thing, and the preview only has
                 to say which email this was. */
              <p className="mt-0.5 truncate text-caption leading-relaxed text-text-secondary">
                {message.body}
              </p>
            )}
            {/* ⚠️ A LINK TO THE RLS-SCOPED ROUTE. `/api/whatsapp/media/[id]`
                answers 404 for a message the caller cannot read — the same 404 as
                one that does not exist — so the URL cannot be used to find out
                which ids are real. */}
            {message.mediaFilename && (
              <a
                href={`/api/whatsapp/media/${message.id}`}
                target="_blank"
                rel="noopener noreferrer"
                /* ⚠️ CONSTRAINED, NOT FULL WIDTH. It stretched edge to edge under
                   a right-aligned email, so the attachment sat on the opposite
                   side of the drawer from the message it belongs to. */
                className={cn(
                  'mt-1.5 inline-flex max-w-[85%] items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-default',
                  onRight && 'self-end',
                )}
              >
                <FileText className="size-5 shrink-0 text-feedback-error" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
                  {message.mediaFilename}
                </span>
              </a>
            )}
          </div>
        ) : (
          /* ⚠⚠ THE GREY HAD TO BE MIXED, NOT TOKENISED. Owner, 2026-09-17: *"our
             grey message is not properly showing."* Exactly right, and the cause
             is worth writing down: `--bg-subtle` is **#f1f6f7** against a
             **#ffffff** surface. That is under 3% apart — a bubble that is only
             a bubble on a good monitor, and no bubble at all on a laptop at an
             angle, which is where this is actually read.

             So the inbound bubble mixes its own grey off `--text-primary` at 9% —
             no border, as the reference has none; the fill alone now carries
             the edge. The tint follows the palette in both themes instead of
             freezing one hex. */
          /* ⚠️ A FLOOR ON THE WIDTH, as the reference has: every bubble there is
             roughly the same ~60% of the column however short the message, so a
             two-word reply is still a bubble rather than a pill hugging its
             words, and the stamp column to its right stays a column. */
          <div
            className="mt-1.5 inline-block min-w-[60%] max-w-[85%] rounded-xl px-3.5 py-2.5"
            style={{
              background: mine
                ? 'color-mix(in oklab, #25D366 16%, var(--bg-surface))'
                : 'color-mix(in oklab, var(--text-primary) 9%, var(--bg-surface))',
            }}
          >
            <p className="whitespace-pre-wrap break-words text-left text-body-sm leading-relaxed text-text-primary">
              {message.body ?? (message.mediaFilename ?? 'Attachment')}
            </p>
            {message.mediaId && (
              <a
                href={`/api/whatsapp/media/${message.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-caption font-medium text-text-brand underline underline-offset-2"
              >
                Open {message.mediaFilename ?? 'attachment'}
              </a>
            )}
          </div>
        )}

        {/* ⚠️ A FAILURE IS SHOWN ON THE MESSAGE, not in a toast that has gone.
            "Did it send?" is asked about a message days later. */}
        {message.status === 'failed' && (
          <p className={cn('mt-1 text-caption text-feedback-error', onRight && 'text-right')}>
            Not delivered{message.errorDetail ? ` — ${message.errorDetail}` : ''}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * When it happened, and the ticks when it was ours.
 *
 * ⚠️ THE TICKS TRAVEL WITH THE STAMP, which is where the reference puts them
 * — `12 Sep 2026, 11:35 AM ✓✓`. Delivery state belongs beside the time it is a
 * statement about, not beside the words.
 *
 * ⚠️ AND THEY ARE OURS ONLY. An inbound message has no delivery state we own,
 * and drawing one would be inventing a receipt.
 */
function Stamp({
  label,
  message,
  mine,
}: {
  label: string;
  message: CrmMessage;
  mine: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-micro tabular-nums text-text-secondary">
      {label}
      {mine && message.status === 'read' && (
        <span className="text-text-brand" title="Read">
          <Check className="-mr-2 inline size-3" strokeWidth={3} />
          <Check className="inline size-3" strokeWidth={3} />
        </span>
      )}
      {mine && message.status === 'delivered' && (
        <span title="Delivered">
          <Check className="-mr-2 inline size-3" strokeWidth={3} />
          <Check className="inline size-3" strokeWidth={3} />
        </span>
      )}
      {mine && message.status === 'sent' && (
        <span title="Sent">
          <Check className="inline size-3" strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

/* ---- The summary ---------------------------------------------------------- */

const HEADINGS: ReadonlyArray<{
  kind: CrmSummaryPointKind;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  ink: string;
}> = [
  /* ⚠️ THE OWNER'S OWN ORDER — *"I have told him this, I have heard this, and we
     are in agreement on this"* — and then what is still open, because that is
     the thing the next call exists to settle. */
  { kind: 'we_said', label: 'What we told them', icon: Send, ink: 'var(--accent-primary)' },
  { kind: 'they_said', label: 'What they told us', icon: MessageSquareQuote, ink: MAIL_BLUE },
  { kind: 'agreed', label: 'Agreed', icon: CheckCircle2, ink: 'var(--feedback-success)' },
  { kind: 'open', label: 'Still open', icon: CircleHelp, ink: 'var(--feedback-warning)' },
];

/**
 * The conversation, summarised by AI — and the salesperson's own notes under it.
 *
 * ⚠️ AUTOMATIC MEANS "WHEN SOMEBODY LOOKS AND IT IS OUT OF DATE". Opening this
 * view compares the stored summary with the thread already on screen — message
 * count, newest message, note count — and asks for a new one only if they
 * differ. No button, as the owner asked; and no model call for a drawer opened
 * on the Overview, or for a summary that is already current.
 *
 * ⚠️ THE OLD SUMMARY STAYS ON SCREEN WHILE THE NEW ONE IS WRITTEN. Blanking it
 * for the ten seconds a model takes would hide the part that is still true in
 * order to show a spinner — the stale version is dimmed and says how many
 * messages it has not read yet.
 *
 * ⚠️ AND IT NEVER PASSES FOR A PERSON'S NOTE. `06-CONVERSATION-MEMORY.md`: *"an
 * agent-written note and a salesperson-written note must be distinguishable at a
 * glance."* The summary lives in its own table (180), carries an AI label and
 * says what it was written from; the notes below it are only ever typed.
 */
function SummaryView({
  leadId,
  messageCount,
  notes,
  summary,
  working,
  failure,
  onRetry,
  loading,
}: {
  leadId: string;
  messageCount: number;
  notes: readonly CrmLeadNote[];
  summary: CrmConversationSummary | null;
  working: boolean;
  failure: string | null;
  onRetry: () => void;
  loading: boolean;
}) {
  const unread = summary ? Math.max(0, messageCount - summary.messageCount) : messageCount;

  return (
    <div className="space-y-3">
      <section
        className="rounded-xl border border-border-subtle bg-bg-surface p-4"
        aria-busy={loading || working}
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-body-sm font-semibold text-text-primary">Conversation summary</h3>
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold"
            style={{
              background: 'color-mix(in oklab, var(--accent-primary) 12%, transparent)',
              color: 'var(--accent-primary)',
            }}
          >
            <Sparkles className="size-3" aria-hidden="true" />
            AI
          </span>
          <span className="ml-auto text-micro text-text-secondary">
            {loading
              ? 'Loading…'
              : working || (!summary && !failure && messageCount > 0)
                ? summary
                  ? `Updating — ${unread > 0 ? `${unread} new message${unread === 1 ? '' : 's'}` : 'notes changed'}…`
                  : `Reading ${messageCount} message${messageCount === 1 ? '' : 's'}…`
                : summary
                  ? `From ${summary.messageCount} message${summary.messageCount === 1 ? '' : 's'} · ${stampLabel(summary.generatedAt)}`
                  : null}
          </span>
        </header>

        {loading ? (
          <SummarySkeleton />
        ) : messageCount === 0 ? (
          <p className="mt-2 text-caption leading-relaxed text-text-secondary">
            Nothing has been said yet. The summary starts with the first message, and keeps
            itself up to date after that.
          </p>
        ) : !summary && working ? (
          <SummarySkeleton />
        ) : !summary ? (
          failure ? null : <SummarySkeleton />
        ) : (
          <div className={cn('transition-opacity', working && 'opacity-60')}>
            <p className="mt-2 text-body-sm leading-relaxed text-text-primary">{summary.overview}</p>

            {HEADINGS.map((h) => {
              const items = summary.points.filter((p) => p.kind === h.kind);
              if (items.length === 0) return null;
              const Icon = h.icon;
              return (
                <div key={h.kind} className="mt-3">
                  <p
                    className="flex items-center gap-1.5 text-caption font-semibold"
                    style={{ color: h.ink }}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {h.label}
                  </p>
                  <ul className="mt-1 space-y-1 pl-[1.375rem]">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className="list-disc text-body-sm leading-relaxed text-text-primary marker:text-text-tertiary"
                      >
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {failure && !working && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-feedback-error/30 px-3 py-2">
            <p className="min-w-0 flex-1 text-caption text-feedback-error">{failure}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-caption font-medium text-text-primary hover:bg-bg-subtle"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Retry
            </button>
          </div>
        )}

        {/* ⚠️ SAID ONCE, IN SMALL TYPE, WHERE IT IS READ. A summary is a model's
            reading of the messages; the figure somebody repeats to a client
            should come from the quotation or the message itself. */}
        {summary && !loading && (
          <p className="mt-3 border-t border-border-subtle pt-2 text-micro leading-relaxed text-text-secondary">
            Written by AI from the messages, always in English. Check a price or a date
            against the conversation before repeating it to the client.
          </p>
        )}
      </section>

      <NotesBox leadId={leadId} notes={notes} loading={loading} />
    </div>
  );
}

function SummarySkeleton() {
  /* Grey bars only where nothing true can be shown yet — the heading above is real. */
  return (
    <div className="mt-3 space-y-2" aria-hidden="true">
      {['w-full', 'w-11/12', 'w-2/3'].map((w) => (
        <span key={w} className={cn('block h-3 animate-pulse rounded bg-bg-subtle', w)} />
      ))}
      <span className="mt-4 block h-3 w-1/3 animate-pulse rounded bg-bg-subtle" />
      <span className="block h-3 w-3/4 animate-pulse rounded bg-bg-subtle" />
    </div>
  );
}

/**
 * The salesperson's own notes — optional.
 *
 * ⚠️ BEHIND A BUTTON NOW, NOT AN OPEN BOX. Owner, 2026-09-17: *"I will not add
 * the summary. If I want to add it, I can add it."* The AI writes the summary;
 * a textarea waiting at the top of the view asked for work the owner has said
 * they will not do routinely.
 *
 * ⚠️ IN ENGLISH, WHATEVER THE CALL WAS IN — and the AI reads these too, as our
 * side's account of calls that never appear in the thread.
 */
function NotesBox({
  leadId,
  notes,
  loading,
}: {
  leadId: string;
  notes: readonly CrmLeadNote[];
  loading: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  /* ⚠️ SHOWN AT ONCE, AND DROPPED WHEN THE SERVER'S LIST ARRIVES. The action
     revalidates, so the new note comes back inside `notes` — without clearing
     this, it would be drawn twice. */
  const [added, setAdded] = React.useState<readonly string[]>([]);
  const [seenNotes, setSeenNotes] = React.useState(notes);
  if (seenNotes !== notes) {
    setSeenNotes(notes);
    setAdded([]);
  }

  async function add() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const result = await addNoteAction(leadId, text);
    setSaving(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    setAdded((v) => [text, ...v]);
    setDraft('');
    setOpen(false);
    toast({ tone: 'ok', text: 'Note added.' });
  }

  const count = notes.length + added.length;

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
      <header className="flex items-center gap-2">
        <NotebookPen className="size-4 text-text-secondary" aria-hidden="true" />
        <h3 className="text-body-sm font-semibold text-text-primary">Your notes</h3>
        {!loading && count > 0 && (
          <span className="text-caption tabular-nums text-text-secondary">{count}</span>
        )}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add a note
          </button>
        )}
      </header>

      {open && (
        <div className="mt-3">
          <textarea
            rows={3}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            maxLength={4000}
            aria-label="Note"
            placeholder="Anything the messages do not show — what was said on a call, why a price was offered."
            className="w-full resize-y rounded-lg border border-border-default bg-bg-base px-3 py-2 text-body-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-micro text-text-secondary">
              In English, whatever the conversation was in.
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDraft('');
              }}
              className="rounded-lg px-2.5 py-1.5 text-caption font-medium text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={saving || !draft.trim()}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white transition-opacity',
                (saving || !draft.trim()) && 'opacity-40',
              )}
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-2 text-caption text-text-secondary">Loading…</p>
      ) : count === 0 ? (
        !open && (
          <p className="mt-2 text-caption text-text-secondary">
            Optional. The summary above is written for you.
          </p>
        )
      ) : (
        <ol className="mt-3 space-y-2">
          {added.map((body, i) => (
            <li
              key={`pending-${i}`}
              className="rounded-lg border border-gold-200 bg-gold-100/60 px-3 py-2"
            >
              <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed text-text-primary">
                {body}
              </p>
              <p className="mt-1 text-micro text-text-secondary">Just now · you</p>
            </li>
          ))}
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-border-subtle px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed text-text-primary">
                {n.body}
              </p>
              <p className="mt-1 text-micro text-text-secondary">
                {stampLabel(n.createdAt)}
                {n.authorName ? ` · ${n.authorName}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-caption font-medium transition-colors',
        active
          ? 'border-transparent bg-accent-primary text-white'
          : 'border-border-default text-text-primary hover:bg-bg-subtle',
      )}
    >
      {children}
    </button>
  );
}
