'use client';

import * as React from 'react';
import {
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileText,
  Mail,
  MessageSquareQuote,
  NotebookPen,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

import {
  deleteMessageForMeAction,
  pinMessageAction,
  prepareWhatsAppUploadsAction,
  reactToMessageAction,
  readWhatsAppThreadAction,
  sendWhatsAppMediaAction,
  sendWhatsAppTextAction,
  starMessageAction,
} from '@/app/actions/crm-whatsapp';
import { summariseConversationAction } from '@/app/actions/crm-conversation-summary';
import { addNoteAction } from '@/app/actions/crm-leads';
import { EmailComposer } from '@/components/crm/email-composer';
import { TemplatePicker } from '@/components/crm/template-picker';
import { AttachmentPreview, prepareFile, type PreparedFile } from '@/components/crm/whatsapp/attachments';
import { WhatsAppComposer } from '@/components/crm/whatsapp/composer';
import { EMOJI_FONT, preloadEmoji } from '@/components/crm/whatsapp/emoji-picker';
import { Lightbox, type LocalMedia } from '@/components/crm/whatsapp/media';
import { AskAIPanel, DeleteConfirm, ForwardPanel, MessageInfo, ReactionSheet } from '@/components/crm/whatsapp/overlays';
import { useSavedReplies } from '@/components/crm/whatsapp/saved-replies';
import { mediaShape, mediaUrl, snippet, whatsAppWindow, type ReplyVariables } from '@/components/crm/whatsapp/shared';
import { PinnedBar, WhatsAppThread, type ThreadHandlers } from '@/components/crm/whatsapp/thread';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type {
  CrmConversationSummary,
  CrmLeadNote,
  CrmMessage,
  CrmSender,
  CrmSummaryPointKind,
} from '@/lib/db/queries/crm-leads';
import type { AgentMode } from '@/lib/db/queries/crm-leads';
import { AgentModeControl, SuggestedReply, modeMeta } from '@/components/crm/agent-mode';
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
  leadEmail,
  viewerName,
  projectName,
  handoff,
  onHandoffUsed,
  onReviewFollowUp,
  agentMode,
  onAgentMode,
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
   * sent", "no WhatsApp number" — says it is loading instead.
   */
  loading?: boolean;
  sender: CrmSender | null;
  /** Why the chase stopped, when it has — migration 170 pauses on a reply. */
  sequencePaused: string | null;
  leadName: string;
  /**
   * The client's email address, or null when the lead has none.
   *
   * ⚠️ A PROP, NOT A FETCH. The drawer already read it; the email composer used
   * to ask the server for it and would not draw until the answer came back (Rule
   * Zero, law 3 — and the owner noticed).
   */
  leadEmail: string | null;
  /** Who is reading — for "You deleted this message" and saved replies. */
  viewerName: string;
  projectName: string;
  /**
   * Something the Related items dialog handed over — a quotation PDF, an invoice,
   * a property sheet — with the line of text that goes with it.
   *
   * ⚠️ IT ARRIVES IN THE COMPOSER, IT DOES NOT SEND. The person reads it, changes
   * it if they want, and presses send. Nothing in that dialog talks to a client.
   */
  handoff?: {
    readonly id: number;
    readonly files: readonly File[];
    readonly text: string;
    /** Which composer it is for — chosen in the Related items dialog. */
    readonly channel: 'whatsapp' | 'email';
    /** Email only: the subject the letter starts with. */
    readonly subject?: string;
  } | null;
  onHandoffUsed?: () => void;
  onReviewFollowUp: () => void;
  /**
   * Who writes the reply on this lead — 212. ⚠️ OPTIONAL, and the control only
   * appears when it is given: the Conversations page carries the mode on its
   * rows; the drawer does not yet, and a control showing a guessed mode would be
   * worse than none.
   */
  agentMode?: AgentMode;
  onAgentMode?: (next: AgentMode) => void;
}) {
  const toast = useToast();

  /* ⚠️ THE THREAD IS LOCAL STATE SEEDED FROM THE SERVER, and it reseeds whenever
     the server's array changes — the drawer opens on the row and the messages
     arrive into a tab already mounted for the same lead. */
  const [thread, setThread] = React.useState<readonly CrmMessage[]>(messages);
  const [seen, setSeen] = React.useState(messages);
  if (seen !== messages) {
    setSeen(messages);
    setThread(messages);
  }
  const threadRef = React.useRef(thread);
  React.useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const [filter, setFilter] = React.useState<Filter>('all');
  const [oldestFirst, setOldestFirst] = React.useState(true);
  const [dismissed, setDismissed] = React.useState(false);
  const [channel, setChannel] = React.useState<'whatsapp' | 'email'>('whatsapp');
  /**
   * Which composer is below the thread.
   *
   * ⚠️ THE FILTER DECIDES WHEN IT IS A CHANNEL. Owner, 2026-09-18: *"when I click
   * on the WhatsApp tab… it should show only WhatsApp below, not the email
   * option. When I click on email, it only shows email."* Reading a WhatsApp
   * conversation and typing into an email box is how a message goes out on the
   * wrong channel — so on **All** the switch is offered, and on a channel chip
   * there is nothing to switch.
   */
  const composerChannel: 'whatsapp' | 'email' =
    filter === 'whatsapp' ? 'whatsapp' : filter === 'email' ? 'email' : channel;
  const [draft, setDraft] = React.useState('');

  /* ── ⚠️ WHAT THE SCREEN SHOWS BEFORE THE SERVER HAS ANSWERED ───────────────
     `pending` — messages being uploaded or sent, drawn at once with a clock.
     `locals`  — the browser's own copy of a file, so a photo appears the instant
                 it is chosen and does not reload when the real row arrives.
     `overrides` — a reaction, pin, star or delete, drawn in the frame it was
                 pressed; undone if the server refuses, and dropped only once a
                 re-read that started AFTER the server agreed has arrived. */
  const [pending, setPending] = React.useState<CrmMessage[]>([]);
  const [locals, setLocals] = React.useState<Record<string, LocalMedia>>({});
  const [overrides, setOverrides] = React.useState<
    Record<string, { patch: Partial<CrmMessage>; settledAt: number | null }>
  >({});
  const busy = React.useRef(0);

  const [replyTo, setReplyTo] = React.useState<CrmMessage | null>(null);
  const [overlay, setOverlay] = React.useState<
    null | { kind: 'info' | 'forward' | 'delete' | 'react' | 'ai'; message: CrmMessage }
  >(null);
  const [deleting, setDeleting] = React.useState(false);
  const [lightbox, setLightbox] = React.useState<null | { kind: 'image' | 'video'; src: string; message: CrmMessage }>(null);
  const [files, setFiles] = React.useState<PreparedFile[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [flashId, setFlashId] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [saved, setSaved] = useSavedReplies();
  const composerInput = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    const idle = window.setTimeout(() => void preloadEmoji(), 1_500);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(idle);
    };
  }, []);

  /* Object URLs belong to this tab; released when it closes. */
  const localsRef = React.useRef(locals);
  React.useEffect(() => {
    localsRef.current = locals;
  }, [locals]);
  React.useEffect(() => () => Object.values(localsRef.current).forEach((l) => URL.revokeObjectURL(l.url)), []);

  /* ── ⚠️ A LIVE CHAT: re-read every 5 s while this is on screen ─────────────
     A client's reply, a delivered tick turning blue, a reaction on their phone —
     none of them reach an open drawer otherwise. Paused while the tab is hidden,
     and while a send is in flight (the pending bubble and its real row must never
     both be drawn). One small RLS-scoped read; never a page refresh. */
  React.useEffect(() => {
    if (loading) return;
    let live = true;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || busy.current > 0) return;
      const startedAt = Date.now();
      try {
        const fresh = await readWhatsAppThreadAction(leadId);
        if (!live || busy.current > 0) return;
        setThread(fresh);
        setOverrides((o) => {
          const keep = Object.entries(o).filter(([, v]) => v.settledAt === null || v.settledAt >= startedAt);
          return keep.length === Object.keys(o).length ? o : Object.fromEntries(keep);
        });
      } catch {
        /* a missed poll is retried in five seconds */
      }
    }, 5_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [leadId, loading]);

  /** Re-read the thread now, rather than waiting for the five-second poll. */
  const refreshThread = React.useCallback(async () => {
    try {
      setThread(await readWhatsAppThreadAction(leadId));
    } catch {
      /* The poll will pick it up. */
    }
  }, [leadId]);

  const liveThread = React.useMemo(
    () => thread.map((m) => (overrides[m.id] ? { ...m, ...overrides[m.id].patch } : m)),
    [thread, overrides],
  );
  const everything = React.useMemo(() => [...liveThread, ...pending], [liveThread, pending]);

  /* ── Suggestions (212) — the client's message the reply would answer ──────
     ⚠️ ONLY WHEN THEY SPOKE LAST, AND ONLY ON WHATSAPP. A suggestion for a thread
     where we spoke last would be a reply to ourselves; and pending sends have no
     server id to ask about. */
  const suggestFor = React.useMemo(() => {
    if (agentMode !== 'suggest') return null;
    const shown = liveThread.filter((m) => !m.hiddenAt);
    const last = shown[shown.length - 1];
    return last && last.direction === 'inbound' && last.channel === 'whatsapp' ? last : null;
  }, [agentMode, liveThread]);
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null);

  /**
   * What to put in the subject line to start with.
   *
   * ⚠️ READ OFF THE THREAD THAT IS ALREADY HERE. This was a scalar subquery in a
   * server action the composer blocked on; the messages it reads are the ones
   * drawn above it.
   *
   * ⚠️ AND NEVER "Re: Re: …". A client whose subject grows a prefix every time is
   * reading a machine, not a salesperson.
   */
  const suggestedSubject = React.useMemo(() => {
    const last = [...liveThread]
      .reverse()
      .find((m) => m.channel === 'email' && (m.subject ?? '').trim() !== '');
    const subject = (last?.subject ?? '').trim();
    if (subject) return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
    /* ⚠️ A SUBJECT IS FOR THE READER, NOT FOR US. This put the project's own
       name in front of every subject - "Demo — Product Enquiries [demo] —
       following up" reached a real person's inbox on 18 Sep. The From line
       already carries who it is from; the subject should say what it is
       about. */
    return 'Following up on your enquiry';
  }, [liveThread]);

  const counts = {
    whatsapp: everything.filter((m) => m.channel === 'whatsapp').length,
    email: everything.filter((m) => m.channel === 'email').length,
  };

  /* ⚠️ THE CHAT LAYOUT BELONGS TO THE WHATSAPP VIEW ALONE. **All** is a timeline
     across channels, read like a history; **WhatsApp** is a conversation. */
  const chat = filter === 'whatsapp';

  /* ⚠️ "THEY SPOKE LAST" is what "new reply received" claims — read off the
     thread on the page, whether or not a sequence exists. */
  const newest = liveThread.length > 0 ? liveThread[liveThread.length - 1] : null;
  const theySpokeLast = newest?.direction === 'inbound';
  const showBanner = !loading && (theySpokeLast || sequencePaused !== null) && !dismissed && !chat;

  const shown = React.useMemo(() => {
    const kept = filter === 'all' ? everything : everything.filter((m) => m.channel === filter);
    return oldestFirst || filter === 'whatsapp' ? [...kept] : [...kept].reverse();
  }, [everything, filter, oldestFirst]);

  const pinned = React.useMemo(
    () =>
      liveThread
        .filter((m) => m.pinnedAt && !m.hiddenAt && m.channel === 'whatsapp')
        .sort((a, b) => Date.parse(b.pinnedAt!) - Date.parse(a.pinnedAt!))
        .slice(0, 3),
    [liveThread],
  );

  const windowInfo = whatsAppWindow(liveThread, now);

  /**
   * Have we already reached out and had no reply yet?
   *
   * ⚠️ SENDING A TEMPLATE DOES NOT OPEN THE WINDOW — only THEIR reply does, and
   * the screen has to stop saying "never messaged you" the moment we have written
   * to them, or it reads as though the template never went. Owner, 2026-09-18:
   * *"it's still showing me never messaged you… and does not let me add any
   * message."* It was right about the window and wrong about the reason, which is
   * the product's fault for using the same sentence for both.
   */
  const awaitingFirstReply = React.useMemo(
    () =>
      windowInfo.closesAt === null &&
      liveThread.some((m) => m.channel === 'whatsapp' && m.direction === 'outbound' && m.status !== 'failed'),
    [liveThread, windowInfo.closesAt],
  );
  const vars: ReplyVariables = {
    myName: viewerName,
    leadName: leadName === 'This lead' ? null : leadName,
    company: sender?.displayName || projectName,
    project: projectName,
  };
  /**
   * Why nothing can be typed and sent right now.
   *
   * ⚠️ THE CLOSED WINDOW BELONGS HERE, AND DID NOT. Owner, 2026-09-18, holding a
   * screenshot of two messages marked *"Not delivered — Re-engagement message"*:
   * the strip above the composer said "24-hour window closed" at the moment they
   * pressed send, and the composer sent anyway. WhatsApp refuses free text outside
   * the window (error 131047) — so the send was never going to arrive, and the
   * only thing the product did was turn a rule it knew about into a failure the
   * salesperson had to decode.
   *
   * ⚠️ AND IT SAYS WHAT WILL WORK. "Closed" is a fact; "send an approved template"
   * is the way out of it, and the button beside this opens the place that does it.
   */
  const disabledReason = loading
    ? 'Loading…'
    : !sender?.configured
      ? 'This project has no WhatsApp number'
      : !windowInfo.open
        ? windowInfo.closesAt === null
          ? awaitingFirstReply
            ? 'Sent — you can write freely once they reply'
            : 'They have never messaged you — send an approved template to start'
          : 'The 24-hour window closed — send an approved template'
        : null;

  /* ── Scrolling: opens at the newest, stays there while you are there ────── */
  const scroller = React.useRef<HTMLDivElement>(null);
  const atFoot = React.useRef(true);
  const [awayFromFoot, setAwayFromFoot] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!chat) return;
    const el = scroller.current;
    if (el && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [chat, everything.length]);
  const onThreadScroll = () => {
    const el = scroller.current;
    if (!el || !chat) return;
    atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAwayFromFoot(!atFoot.current);
  };
  const toFoot = () => {
    const el = scroller.current;
    atFoot.current = true;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  const jumpTo = (m: CrmMessage) => {
    const el = scroller.current?.querySelector(`[data-message-id="${m.id}"]`);
    if (!el) {
      toast({ tone: 'warn', text: 'That message is older than the conversation loaded here.' });
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(m.id);
    window.setTimeout(() => setFlashId((f) => (f === m.id ? null : f)), 1_600);
  };

  /* ── Menu actions: drawn now, confirmed after ───────────────────────────── */
  const act = async (
    m: CrmMessage,
    patch: Partial<CrmMessage>,
    call: () => Promise<{ ok: boolean; error?: string }>,
    done?: string,
  ) => {
    setOverrides((o) => ({ ...o, [m.id]: { patch: { ...o[m.id]?.patch, ...patch }, settledAt: null } }));
    const undo = () =>
      setOverrides((o) => {
        const next = { ...o };
        delete next[m.id];
        return next;
      });
    try {
      const r = await call();
      if (r.ok) {
        setOverrides((o) => (o[m.id] ? { ...o, [m.id]: { ...o[m.id], settledAt: Date.now() } } : o));
        if (done) toast({ tone: 'ok', text: done });
      } else {
        undo();
        toast({ tone: 'error', text: r.error ?? 'That did not work.' });
      }
    } catch {
      undo();
      toast({ tone: 'error', text: 'That did not work — the connection dropped.' });
    }
  };

  const outgoing = (over: Partial<CrmMessage>): CrmMessage => ({
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    direction: 'outbound', kind: 'text', body: null, mediaId: null, mediaMime: null, mediaFilename: null,
    status: null, errorDetail: null, sentByName: viewerName, occurredAt: new Date().toISOString(),
    channel: 'whatsapp', subject: null, waMessageId: null, replyToWamid: null, ourReaction: null,
    theirReaction: null, pinnedAt: null, pinnedByName: null, hiddenAt: null, hiddenByName: null,
    deliveredAt: null, readAt: null, playedAt: null, mediaSize: null, mediaVoice: false,
    forwarded: false, starred: false,
    ...over,
  });

  async function sendText(text: string) {
    const reply = replyTo;
    const bubble = outgoing({ body: text, replyToWamid: reply?.waMessageId ?? null });
    setPending((p) => [...p, bubble]);
    setDraft('');
    setReplyTo(null);
    atFoot.current = true;
    busy.current += 1;
    try {
      const r = await sendWhatsAppTextAction(leadId, text, reply?.id ?? null);
      if (r.thread) setThread(r.thread);
      if (!r.ok) toast({ tone: 'error', text: r.error ?? 'That did not send.' });
    } catch {
      setDraft(text);
      toast({ tone: 'error', text: 'That did not send — the connection dropped.' });
    } finally {
      setPending((p) => p.filter((x) => x.id !== bubble.id));
      busy.current -= 1;
    }
  }

  async function sendFiles(items: readonly PreparedFile[], voice?: { seconds: number; isVoice: boolean }) {
    if (items.length === 0) return;
    const reply = replyTo;
    setReplyTo(null);
    setFiles([]);
    const entries = items.map((it, n) => ({
      it,
      bubble: outgoing({
        kind: voice ? 'audio' : it.kind,
        body: it.caption.trim() || null,
        mediaMime: it.mime,
        mediaFilename: it.file.name,
        mediaSize: it.file.size,
        mediaVoice: Boolean(voice?.isVoice),
        replyToWamid: n === 0 ? (reply?.waMessageId ?? null) : null,
      }),
    }));
    setPending((p) => [...p, ...entries.map((e) => e.bubble)]);
    setLocals((l) => ({
      ...l,
      ...Object.fromEntries(entries.map((e) => [e.bubble.id, { url: e.it.previewUrl, progress: 0, seconds: voice?.seconds }])),
    }));
    atFoot.current = true;
    busy.current += 1;
    try {
      const prep = await prepareWhatsAppUploadsAction(
        leadId,
        items.map((i) => ({ name: i.file.name, size: i.file.size, mime: i.mime })),
      );
      if (!prep.ok || !prep.slots) {
        toast({ tone: 'error', text: prep.error ?? 'The files could not be prepared.' });
        return;
      }
      for (let n = 0; n < entries.length; n++) {
        const { it, bubble } = entries[n];
        const slot = prep.slots[n];
        try {
          await putFile(slot.url, it.file, it.mime, (progress) =>
            setLocals((l) => (l[bubble.id] ? { ...l, [bubble.id]: { ...l[bubble.id], progress } } : l)),
          );
        } catch (error) {
          toast({ tone: 'error', text: `${it.file.name}: ${error instanceof Error ? error.message : 'the upload failed'}` });
          setPending((p) => p.filter((x) => x.id !== bubble.id));
          continue;
        }
        setLocals((l) => ({ ...l, [bubble.id]: { ...l[bubble.id], progress: null } }));
        const before = new Set(threadRef.current.map((m) => m.id));
        const r = await sendWhatsAppMediaAction({
          leadId, path: slot.path, filename: it.file.name, mime: it.mime, size: it.file.size,
          caption: it.caption.trim() || null,
          replyToMessageId: n === 0 ? (reply?.id ?? null) : null,
          voice: Boolean(voice?.isVoice),
        });
        if (r.thread) {
          /* ⚠️ THE LOCAL COPY FOLLOWS THE MESSAGE onto its real row, so the photo
             does not blink and download again the moment it is confirmed. */
          const real = r.thread.find((m) => !before.has(m.id) && m.direction === 'outbound' && m.mediaFilename === it.file.name);
          if (real) setLocals((l) => ({ ...l, [real.id]: { url: it.previewUrl, progress: null, seconds: voice?.seconds } }));
          threadRef.current = r.thread;
          setThread(r.thread);
        }
        setPending((p) => p.filter((x) => x.id !== bubble.id));
        if (!r.ok) toast({ tone: 'error', text: r.error ?? `${it.file.name} did not send.` });
      }
    } catch {
      toast({ tone: 'error', text: 'That did not send — the connection dropped.' });
    } finally {
      const ids = new Set(entries.map((e) => e.bubble.id));
      setPending((p) => p.filter((x) => !ids.has(x.id)));
      busy.current -= 1;
    }
  }

  async function pickFiles(list: readonly File[]) {
    if (!list.length) return;
    if (disabledReason) {
      toast({ tone: 'error', text: disabledReason });
      return;
    }
    const prepared = await Promise.all(list.slice(0, 10).map(prepareFile));
    const ok = prepared.filter((x): x is PreparedFile => !('error' in x));
    const refused = prepared.filter((x): x is { error: string } => 'error' in x);
    if (refused.length) toast({ tone: 'error', text: refused[0].error });
    if (ok.length) {
      setChannel('whatsapp');
      setFiles((f) => [...f, ...ok].slice(0, 10));
    }
  }

  /* ⚠️ THE DRAFT IS SET DURING RENDER, ONCE PER HAND-OFF, so the text is on
     screen in the same frame the dialog closes. The files need an await, so they
     go through the same `pickFiles` a drag-and-drop uses. */
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [handoffSeen, setHandoffSeen] = React.useState<number | null>(null);
  if (handoff && handoff.id !== handoffSeen) {
    setHandoffSeen(handoff.id);
    /* ⚠️ THE FILTER FOLLOWS THE CHOICE. The composer follows the chip, so the
       chip is what has to move: leaving it on WhatsApp after somebody picked
       Email would put the letter in a chat box and lose its attachment. */
    setChannel(handoff.channel);
    setFilter(handoff.channel);
    /* ⚠️ ONLY THE WHATSAPP DRAFT IS SET HERE. An email hand-off carries a subject
       too, and both belong to the email composer's own state — so it takes the
       whole hand-off as a prop rather than having its fields pushed into a draft
       it does not read. */
    if (handoff.channel === 'whatsapp' && handoff.text) {
      setDraft((d) => (d.trim() ? `${d}

${handoff.text}` : handoff.text));
    }
  }

  const pickFilesRef = React.useRef(pickFiles);
  React.useEffect(() => {
    pickFilesRef.current = pickFiles;
  });
  React.useEffect(() => {
    if (!handoff) return;
    /* ⚠️ THE EMAIL COMPOSER UPLOADS ITS OWN FILES, so this must not also push them
       into the WhatsApp attachment tray — they would sit ready to send on a
       channel nobody chose. */
    if (handoff.channel !== 'whatsapp') return;
    if (handoff.files.length > 0) void pickFilesRef.current(handoff.files);
    /* ⚠️ CLEARED AFTER IT IS USED. This tab unmounts when somebody switches tab;
       a hand-off left standing would be applied again on the way back. */
    onHandoffUsed?.();
  }, [handoff, onHandoffUsed]);

  const handlers: ThreadHandlers = {
    onReply: (m) => {
      setReplyTo(m);
      requestAnimationFrame(() => composerInput.current?.focus());
    },
    onReact: (m, emoji) => void act(m, { ourReaction: emoji }, () => reactToMessageAction(m.id, emoji)),
    onMoreReactions: (m) => setOverlay({ kind: 'react', message: m }),
    onForward: (m) => setOverlay({ kind: 'forward', message: m }),
    onPin: (m, on) =>
      void act(m, { pinnedAt: on ? new Date().toISOString() : null }, () => pinMessageAction(m.id, on), on ? 'Message pinned.' : 'Message unpinned.'),
    onStar: (m, on) => void act(m, { starred: on }, () => starMessageAction(m.id, on), on ? 'Message starred.' : undefined),
    onDelete: (m) => setOverlay({ kind: 'delete', message: m }),
    onInfo: (m) => setOverlay({ kind: 'info', message: m }),
    onAskAI: (m) => setOverlay({ kind: 'ai', message: m }),
    onCopy: (m) => {
      if (!m.body) return;
      void navigator.clipboard?.writeText(m.body).then(
        () => toast({ tone: 'ok', text: 'Copied.' }),
        () => toast({ tone: 'error', text: 'Could not copy — select the text instead.' }),
      );
    },
    onOpenMedia: (kind, src, m) => setLightbox({ kind, src, message: m }),
    onJumpTo: jumpTo,
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ── Channel filter ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        <Chip active={filter === 'whatsapp'} onClick={() => setFilter('whatsapp')}>
          <span style={{ color: filter === 'whatsapp' ? '#ffffff' : WA_GREEN }}>
            <WhatsAppMark className="size-5" />
          </span>
          WhatsApp
          {counts.whatsapp > 0 && <span className="tabular-nums opacity-70">{counts.whatsapp}</span>}
        </Chip>
        <Chip active={filter === 'email'} onClick={() => setFilter('email')}>
          <Mail className="size-5" style={{ color: filter === 'email' ? '#ffffff' : MAIL_BLUE }} aria-hidden="true" />
          Email
          {counts.email > 0 && <span className="tabular-nums opacity-70">{counts.email}</span>}
        </Chip>
        {/* ⚠️ WRITTEN BY AI, KEPT, AND LABELLED AS SUCH — see `SummaryView`. */}
        <Chip active={filter === 'summary'} onClick={() => setFilter('summary')}>
          <Sparkles className="size-5" aria-hidden="true" />
          Summary
        </Chip>
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
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-white" style={{ background: WA_GREEN }}>
            <WhatsAppMark className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-text-primary">
              New reply received{sequencePaused ? ' — follow-up paused' : ''}
            </p>
            <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
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
      <div
        className={cn('relative flex min-h-0 flex-1 flex-col', chat && 'overflow-hidden rounded-xl border border-border-subtle')}
        onDragOver={(e) => {
          if (filter === 'summary' || !Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!dragging) return;
          e.preventDefault();
          setDragging(false);
          void pickFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {chat && (
          <PinnedBar
            pinned={pinned}
            onJump={jumpTo}
            onUnpin={(m) => void act(m, { pinnedAt: null }, () => pinMessageAction(m.id, false), 'Message unpinned.')}
          />
        )}
        <div
          ref={scroller}
          data-chat-scroller
          onScroll={onThreadScroll}
          className={cn('min-h-0 flex-1 overflow-y-auto', chat && 'flex flex-col')}
          /* ⚠️ WHATSAPP'S WALLPAPER, from `--wa-wallpaper-image` — a file, so the
             owner's own pattern replaces it without a code change. */
          style={chat ? { backgroundColor: 'var(--wa-wallpaper)', backgroundImage: 'var(--wa-wallpaper-image)', backgroundSize: '320px 320px' } : undefined}
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
              {loading ? 'Loading the conversation…' : thread.length === 0 ? 'Nothing has been sent or received yet.' : `No ${filter} messages on this lead.`}
            </p>
          ) : chat ? (
            <WhatsAppThread
              messages={shown}
              leadName={leadName}
              viewerName={viewerName}
              locals={locals}
              flashId={flashId}
              nowMs={now}
              handlers={handlers}
            />
          ) : (
            <ol className="space-y-4 pb-1">
              {shown.map((m, i) => (
                <Entry key={m.id} message={m} leadName={leadName} spine={i < shown.length - 1} />
              ))}
            </ol>
          )}
        </div>

        {chat && awayFromFoot && (
          <button
            type="button"
            onClick={toFoot}
            aria-label="Jump to the newest message"
            className="absolute bottom-3 right-3 z-20 grid size-9 place-items-center rounded-full"
            style={{ background: 'var(--wa-date-pill)', color: 'var(--wa-date-ink)', boxShadow: '0 1px 3px var(--wa-shadow)' }}
          >
            <ChevronDown className="size-5" aria-hidden="true" />
          </button>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center border-2 border-dashed border-[#00a884] bg-bg-surface/85">
            <p className="text-body-sm font-semibold text-text-primary">Drop to send on WhatsApp</p>
          </div>
        )}

        {files.length > 0 && (
          <AttachmentPreview
            items={files}
            onChange={setFiles}
            onAdd={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.onchange = () => void pickFiles(Array.from(input.files ?? []));
              input.click();
            }}
            onSend={() => void sendFiles(files)}
            onClose={() => {
              files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
              setFiles([]);
            }}
          />
        )}

      </div>

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}

      {/* ⚠️ THE PANELS COVER THE WHOLE TAB, not just the chat box. On a laptop the
          chat box can be under 300px tall once the filters and the composer
          have their share — the Forward list was squeezed to 7px there. */}
      {overlay?.kind === 'info' && <MessageInfo message={overlay.message} leadName={leadName} nowMs={now} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'forward' && <ForwardPanel message={overlay.message} leadId={leadId} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'react' && (
        <ReactionSheet
          onClose={() => setOverlay(null)}
          onPick={(emoji) => {
            const m = overlay.message;
            setOverlay(null);
            void act(m, { ourReaction: emoji }, () => reactToMessageAction(m.id, emoji));
          }}
        />
      )}
      {overlay?.kind === 'ai' && (
        <AskAIPanel
          message={overlay.message}
          onClose={() => setOverlay(null)}
          onUse={(reply) => {
            setReplyTo(overlay.message);
            setDraft(reply);
            setChannel('whatsapp');
            setOverlay(null);
            requestAnimationFrame(() => composerInput.current?.focus());
          }}
        />
      )}
      {overlay?.kind === 'delete' && (
        <DeleteConfirm
          leadName={leadName}
          busy={deleting}
          onClose={() => setOverlay(null)}
          onConfirm={async () => {
            const m = overlay.message;
            setDeleting(true);
            setOverlay(null);
            if (replyTo?.id === m.id) setReplyTo(null);
            await act(
              m,
              {
                hiddenAt: new Date().toISOString(), hiddenByName: viewerName, body: null, mediaId: null,
                mediaMime: null, mediaFilename: null, ourReaction: null, theirReaction: null, pinnedAt: null, starred: false,
              },
              () => deleteMessageForMeAction(m.id),
              'Message deleted.',
            );
            setDeleting(false);
          }}
        />
      )}

      {/* ── Composer ────────────────────────────────────────────────── */}
      {/* ⚠️ THE ONLY WAY TO START A CONVERSATION, and it lives where somebody
          discovers they cannot. Owner: *"how can I initiate a chat with it?"* */}
      {templatesOpen && (
        <TemplatePicker
          leadId={leadId}
          leadName={leadName}
          senderName={sender?.displayName ?? projectName}
          onClose={() => setTemplatesOpen(false)}
          onSent={(next) => setThread(next)}
        />
      )}

      {filter !== 'summary' && (
        <div className="mt-3 shrink-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {filter === 'all' && (
              <div className="inline-flex rounded-lg border border-border-default">
                <button
                  type="button"
                  onClick={() => setChannel('whatsapp')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-l-lg px-2.5 py-1 text-caption font-medium',
                    composerChannel === 'whatsapp' ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary',
                  )}
                >
                  <span style={{ color: WA_GREEN }}><WhatsAppMark className="size-4" /></span>
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setChannel('email')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-r-lg border-l border-border-default px-2.5 py-1 text-caption font-medium',
                    composerChannel === 'email' ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary',
                  )}
                >
                  <Mail className="size-4" style={{ color: MAIL_BLUE }} aria-hidden="true" />
                  Email
                </button>
              </div>
            )}

            {/* ⚠️ WHO IT COMES FROM, and whether WhatsApp will deliver it at all. */}
            {composerChannel === 'whatsapp' && (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
                {loading ? (
                  <span>Checking which number this sends from…</span>
                ) : sender?.configured ? (
                  <>
                    <span className="truncate font-medium text-text-primary">{sender.displayName}</span>
                    {sender.displayNumber ? <span className="shrink-0 whitespace-nowrap tabular-nums">{displayPhone(sender.displayNumber)}</span> : <span className="italic">number not set</span>}
                    <span className="ml-auto shrink-0 whitespace-nowrap">
                      {windowInfo.open ? (
                        <span className="text-feedback-success" title="The client wrote within 24 hours, so WhatsApp will deliver normal messages.">
                          ● Chat open{windowInfo.closesAt ? ` · ${hoursLeft(windowInfo.closesAt, now)}` : ''}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTemplatesOpen(true)}
                          title="WhatsApp only delivers approved templates until the client writes again."
                          className="font-medium underline-offset-2 hover:underline"
                          style={{ color: 'var(--feedback-warning)' }}
                        >
                          ●{' '}
                          {windowInfo.closesAt === null
                            ? awaitingFirstReply
                              ? 'Waiting for their first reply'
                              : 'Never messaged you'
                            : '24-hour window closed'}{' '}
                          · Send a template
                        </button>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-feedback-error">No WhatsApp number on this project — nothing can be sent from here.</span>
                )}
              </p>
            )}
          </div>

          {composerChannel === 'whatsapp' &&
            suggestFor &&
            dismissedFor !== suggestFor.id &&
            /* ⚠️ NOT WHILE THEY ARE WRITING. A draft already in the box is
               the salesperson's own answer; offering to replace it is noise. */
            draft.trim() === '' && (
              <SuggestedReply
                key={suggestFor.id}
                message={suggestFor}
                onDismiss={() => setDismissedFor(suggestFor.id)}
                onUse={(reply) => {
                  setReplyTo(suggestFor);
                  setDraft(reply);
                  setDismissedFor(suggestFor.id);
                  requestAnimationFrame(() => composerInput.current?.focus());
                }}
              />
            )}

          {composerChannel === 'whatsapp' ? (
            <>
            <WhatsAppComposer
              disabledReason={disabledReason}
              replyTo={replyTo}
              replyName={leadName}
              onCancelReply={() => setReplyTo(null)}
              draft={draft}
              onDraft={setDraft}
              saved={saved}
              onSaved={setSaved}
              vars={vars}
              onSendText={(t) => void sendText(t)}
              onPickFiles={(f) => void pickFiles(f)}
              onSendVoice={(v) =>
                void sendFiles(
                  [{
                    id: 'voice', file: new File([v.blob], v.filename, { type: v.mime }), mime: v.mime,
                    kind: 'audio', previewUrl: URL.createObjectURL(v.blob), note: null, caption: '',
                  }],
                  { seconds: v.seconds, isVoice: v.voice },
                )
              }
              inputRef={composerInput}
            />
            {agentMode && onAgentMode && (
              <div className="mt-2 flex items-center gap-2">
                <AgentModeControl mode={agentMode} onChange={onAgentMode} />
                <span className="text-caption text-text-secondary">{modeMeta(agentMode).hint}</span>
              </div>
            )}
            </>
          ) : (
            /* ⚠️ THE REAL THING NOW. What stood here was a textarea whose Send
               called a function whose whole body was a toast saying "email
               replies are not wired yet" — which is what the owner meant by
               *"right now email is not working."* */
            <EmailComposer
              leadId={leadId}
              to={leadEmail}
              toName={leadName}
              businessName={sender?.displayName ?? projectName}
              fromName={viewerName}
              suggestedSubject={suggestedSubject}
              handoff={handoff?.channel === 'email' ? handoff : null}
              onHandoffUsed={onHandoffUsed}
              onSent={() => void refreshThread()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function hoursLeft(closesAt: number, now: number): string {
  const mins = Math.max(0, Math.round((closesAt - now) / 60_000));
  return mins >= 60 ? `closes in ${Math.floor(mins / 60)} h` : `closes in ${mins} min`;
}

/** Straight into the private bucket, with progress — see `prepareWhatsAppUploadsAction`. */
function putFile(url: string, file: File, mime: string, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', mime);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`storage refused the upload (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('the upload failed — check the connection'));
    xhr.send(file);
  });
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
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-body-sm leading-5',
                message.hiddenAt ? 'italic text-text-secondary' : 'text-text-primary',
              )}
            >
              {message.hiddenAt
                ? `${message.hiddenByName ?? 'Someone'} deleted this message`
                : mediaShape(message) !== 'none'
                  ? snippet(message)
                  : (message.body ?? snippet(message))}
            </p>
            {!message.hiddenAt && mediaShape(message) !== 'none' && !message.id.startsWith('pending-') && (
              <a
                href={mediaUrl(message.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-caption font-medium text-text-brand underline underline-offset-2"
              >
                Open {message.mediaFilename ?? 'attachment'}
              </a>
            )}
            {(message.ourReaction || message.theirReaction) && (
              <p className="mt-1 text-caption" style={{ fontFamily: EMOJI_FONT }}>
                {[message.theirReaction, message.ourReaction].filter(Boolean).join(' ')}
              </p>
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
