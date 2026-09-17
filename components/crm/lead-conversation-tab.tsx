'use client';

import * as React from 'react';
import {
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
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
    if (!chat) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, thread.length]);

  /* ⚠️ THE ROUND ARROW WHATSAPP SHOWS WHEN YOU HAVE SCROLLED UP. It appears only
     away from the foot, and takes you back to the newest message. */
  const [awayFromFoot, setAwayFromFoot] = React.useState(false);
  const onThreadScroll = () => {
    const el = scroller.current;
    if (!el || !chat) return;
    setAwayFromFoot(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  };
  const toFoot = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const shown = React.useMemo(() => {
    const kept = filter === 'all' ? thread : thread.filter((m) => m.channel === filter);
    /* ⚠️ A COPY BEFORE SORTING. `messages` is the server's array and reversing it
       in place would reorder the prop for every other reader of it. */
    /* ⚠️ A CHAT IS ALWAYS OLDEST AT THE TOP, NEWEST AT THE FOOT — WhatsApp has no
       sort, and a reversed chat reads as nonsense. The sort is the timeline's. */
    return oldestFirst || filter === 'whatsapp' ? [...kept] : [...kept].reverse();
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
        {filter !== 'summary' && !chat && (
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
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onThreadScroll}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          chat && 'flex flex-col rounded-xl border border-border-subtle',
        )}
        /* ⚠️ WHATSAPP'S WALLPAPER, from `--wa-wallpaper-image`. A file, so the
           owner's own pattern replaces it without a code change. It stays put
           while the messages scroll over it, as it does in the app. */
        style={
          chat
            ? {
                backgroundColor: 'var(--wa-wallpaper)',
                backgroundImage: 'var(--wa-wallpaper-image)',
                backgroundSize: '320px 320px',
              }
            : undefined
        }
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
          <p
            className={cn(
              'rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-body-sm text-text-secondary',
              chat && 'm-auto border-none bg-[var(--wa-date-pill)] py-2 text-[var(--wa-date-ink)]',
            )}
          >
            {loading
              ? 'Loading the conversation…'
              : thread.length === 0
              ? 'Nothing has been sent or received yet.'
              : `No ${filter} messages on this lead.`}
          </p>
        ) : (
          chat ? (
            <WhatsAppThread messages={shown} />
          ) : (
            <ol className="space-y-4 pb-1">
              {shown.map((m, i) => (
                <Entry
                  key={m.id}
                  message={m}
                  leadName={leadName}
                  /* The spine joins one icon to the next, so the last row has
                     nothing to join to. */
                  spine={i < shown.length - 1}
                />
              ))}
            </ol>
          )
        )}
      </div>
      {chat && awayFromFoot && (
        <button
          type="button"
          onClick={toFoot}
          aria-label="Jump to the newest message"
          className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full"
          style={{
            background: 'var(--wa-date-pill)',
            color: 'var(--wa-date-ink)',
            boxShadow: '0 1px 3px var(--wa-shadow)',
          }}
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
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

/**
 * One message in the TIMELINE — the All and Email views.
 *
 * ⚠️ TIGHTENED TO THE REFERENCE. Owner, 2026-09-17: *"you can see how sleek they
 * are… our drawer is getting out of rhythm."* Measured side by side: the
 * reference bubble is ~34px tall against our 46, its rows ~76px apart against
 * our 88, its stamp a light grey against our heavier one, its icon 36px against
 * our 32. The difference was padding and line height, not layout — so the
 * bubble is `py-2` on a 20px line, the rows are 1rem apart, and the stamp is a
 * normal-weight caption.
 *
 * ⚠️ ALWAYS LEFT-ALIGNED. The chat layout — sides, tails, wallpaper — is the
 * WhatsApp view's alone (`WhatsAppThread`), because All is a history read
 * downwards across two channels, not a conversation on one.
 */
function Entry({
  message,
  leadName,
  spine,
}: {
  message: CrmMessage;
  leadName: string;
  /** Draw the connector down to the next row. */
  spine: boolean;
}) {
  const mine = message.direction === 'outbound';
  const isEmail = message.channel === 'email';

  return (
    <li className="relative flex gap-3.5">
      {/* ⚠️ THE SPINE, joining this icon to the next. The icon is 36px from the
          row's top; the line starts 4px below it and stops 4px above the next
          one, across the list's 1rem gap: 100% − 40px + 16px − 4px. */}
      {spine && (
        <span
          aria-hidden="true"
          className="absolute left-[1.125rem] top-10 h-[calc(100%_-_1.75rem)] w-px -translate-x-1/2 bg-border-subtle"
        />
      )}

      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{
          background: isEmail
            ? 'color-mix(in oklab, var(--channel-email) 12%, transparent)'
            : `color-mix(in oklab, ${WA_GREEN} 15%, transparent)`,
          color: isEmail ? MAIL_BLUE : WA_GREEN,
        }}
      >
        {isEmail ? <Mail className="size-5" aria-hidden="true" /> : <WhatsAppMark className="size-5" />}
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-body-sm font-semibold text-text-primary">
            {mine ? `You · ${message.sentByName ?? 'you'}` : leadName}{' '}
            <span className="font-normal text-text-secondary">
              {isEmail ? (mine ? 'sent an email' : 'replied by email') : '(WhatsApp)'}
            </span>
          </p>
          <Stamp label={stampLabel(message.occurredAt)} message={message} mine={mine} />
        </div>

        {isEmail ? (
          <div className="mt-1 flex w-full flex-col">
            {message.subject && (
              <p className="text-body-sm font-semibold leading-5 text-text-primary">{message.subject}</p>
            )}
            {message.body && (
              <p className="truncate text-caption leading-5 text-text-secondary">{message.body}</p>
            )}
            {/* ⚠️ A LINK TO THE RLS-SCOPED ROUTE, which answers 404 for a message
                the caller cannot read — the same as one that does not exist. */}
            {message.mediaFilename && (
              <a
                href={`/api/whatsapp/media/${message.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex max-w-[70%] items-center gap-2.5 self-start rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-left transition-colors hover:border-border-default"
              >
                <FileText className="size-6 shrink-0 text-feedback-error" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
                  {message.mediaFilename}
                </span>
              </a>
            )}
          </div>
        ) : (
          <div
            className="mt-1.5 w-fit min-w-[62%] max-w-[88%] rounded-lg px-3.5 py-2"
            style={{ background: mine ? 'var(--thread-out)' : 'var(--thread-in)' }}
          >
            <p className="whitespace-pre-wrap break-words text-body-sm leading-5 text-text-primary">
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

        {/* A failure is shown on the message — "did it send?" is asked days later. */}
        {message.status === 'failed' && (
          <p className="mt-1 text-caption text-feedback-error">
            Not delivered{message.errorDetail ? ` — ${message.errorDetail}` : ''}
          </p>
        )}
      </div>
    </li>
  );
}

/** Date and time, and our ticks — the timeline's stamp, as the reference prints it. */
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
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-caption text-text-secondary">
      {label}
      {mine && message.status === 'read' && (
        <CheckCheck className="size-4" style={{ color: 'var(--wa-tick-read)' }} aria-label="Read" />
      )}
      {mine && message.status === 'delivered' && <CheckCheck className="size-4" aria-label="Delivered" />}
      {mine && message.status === 'sent' && <Check className="size-4" aria-label="Sent" />}
    </span>
  );
}

/* ---- WhatsApp ----------------------------------------------------------------
   Owner, 2026-09-17: *"for WhatsApp I want the exact same layout… so it looks
   exactly like WhatsApp… just the time is displayed with the relevant chat. The
   date will be displayed above, separately."*

   So this view is WhatsApp's own grammar, not the timeline's with sides swapped:
   · no avatar and no name on each message — it is a one-to-one chat
   · theirs white on the left, ours green on the right, a tail on the first of a run
   · the TIME ALONE, inside the bubble at the bottom right, with our ticks
   · the DATE as a pill above each day, which stays at the top while that day
     scrolls under it
   · the wallpaper behind, and the round arrow back to the newest message
   Colours are WhatsApp's, from `--wa-*` in tokens.css, in both themes. */

/** "Today", "Yesterday", a weekday within the week, then the full date — as WhatsApp does. */
function waDayLabel(iso: string): string {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const at = new Date(iso);
  const now = new Date();
  const days = Math.round((Date.parse(key(now)) - Date.parse(key(at))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Karachi' });
  const part = (o: Intl.DateTimeFormatOptions, locale = 'en-GB') =>
    at.toLocaleDateString(locale, { ...o, timeZone: 'Asia/Karachi' });
  return `${part({ day: 'numeric' })} ${part({ month: 'long' }, 'en-US')} ${part({ year: 'numeric' })}`;
}

function WhatsAppThread({ messages }: { messages: readonly CrmMessage[] }) {
  const days = React.useMemo(() => {
    const out: Array<{ key: string; label: string; items: CrmMessage[] }> = [];
    for (const m of messages) {
      const key = new Date(m.occurredAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(m);
      else out.push({ key, label: waDayLabel(m.occurredAt), items: [m] });
    }
    return out;
  }, [messages]);

  return (
    /* `mt-auto`: a short chat sits at the foot, above the reply box, as in the app. */
    <div className="mt-auto flex flex-col px-[6%] pb-3 pt-1">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          {/* ⚠️ STICKY WITHIN ITS OWN DAY, so the next day's pill pushes it away. */}
          <div className="sticky top-2 z-10 flex justify-center py-2">
            <span
              className="rounded-lg px-3 py-1 text-[12.5px] leading-4"
              style={{
                background: 'var(--wa-date-pill)',
                color: 'var(--wa-date-ink)',
                boxShadow: '0 1px 0.5px var(--wa-shadow)',
              }}
            >
              {day.label}
            </span>
          </div>
          <ol className="flex flex-col">
            {day.items.map((m, i) => (
              <WhatsAppBubble
                key={m.id}
                message={m}
                first={i === 0 || day.items[i - 1].direction !== m.direction}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function WhatsAppBubble({ message, first }: { message: CrmMessage; first: boolean }) {
  const mine = message.direction === 'outbound';
  const time = new Date(message.occurredAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  });
  const fill = mine ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)';

  return (
    <li className={cn('flex flex-col', mine ? 'items-end' : 'items-start', first ? 'mt-2.5' : 'mt-0.5')}>
      <div
        className={cn(
          'relative max-w-[80%] rounded-lg pb-2 pl-2.5 pr-2 pt-1.5',
          first && (mine ? 'rounded-tr-none' : 'rounded-tl-none'),
        )}
        style={{ background: fill, color: 'var(--wa-ink)', boxShadow: '0 1px 0.5px var(--wa-shadow)' }}
        /* Several salespeople can answer from one business number; the chat does
           not print who, but it is there on hover. */
        title={mine && message.sentByName ? `Sent by ${message.sentByName}` : undefined}
      >
        {first && (
          <svg
            aria-hidden="true"
            viewBox="0 1 8 12"
            width="8"
            height="12"
            className={cn('absolute top-0', mine ? '-right-2' : '-left-2')}
          >
            <path
              fill={fill}
              d={
                mine
                  ? 'M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z'
                  : 'M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z'
              }
            />
          </svg>
        )}

        {message.mediaId && (
          <a
            href={`/api/whatsapp/media/${message.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium underline-offset-2 hover:underline"
            style={{ background: 'color-mix(in oklab, var(--wa-ink) 6%, transparent)' }}
          >
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{message.mediaFilename ?? 'Attachment'}</span>
          </a>
        )}

        <span className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
          {message.body ?? (message.mediaId ? '' : 'Attachment')}
        </span>
        {/* ⚠️ THE SPACER. It reserves the stamp's width at the end of the last
            line, so short messages keep the time on the same line and long ones
            push it underneath — never over the words. */}
        <span aria-hidden="true" className={cn('inline-block h-px', mine ? 'w-[4.6rem]' : 'w-[3.4rem]')} />
        <span
          className="absolute bottom-1 right-2 flex items-center gap-[3px] text-[11px] leading-[15px]"
          style={{ color: 'var(--wa-meta)' }}
        >
          <span className="tabular-nums">{time}</span>
          {mine && message.status === 'read' && (
            <CheckCheck className="size-4" style={{ color: 'var(--wa-tick-read)' }} aria-label="Read" />
          )}
          {mine && message.status === 'delivered' && <CheckCheck className="size-4" aria-label="Delivered" />}
          {mine && message.status === 'sent' && <Check className="size-4" aria-label="Sent" />}
          {mine && message.status === null && <Clock3 className="size-3.5" aria-label="Sending" />}
          {mine && message.status === 'failed' && (
            <CircleAlert className="size-4 text-feedback-error" aria-label="Not delivered" />
          )}
        </span>
      </div>
      {message.status === 'failed' && (
        <p className="mt-0.5 max-w-[80%] text-[11.5px] text-feedback-error">
          Not delivered{message.errorDetail ? ` — ${message.errorDetail}` : ''}
        </p>
      )}
    </li>
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
