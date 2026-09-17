'use client';

import * as React from 'react';
import { Check, ChevronDown, FileText, Info, Mail, Paperclip, Send, X } from 'lucide-react';

import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type { CrmMessage, CrmSender } from '@/lib/db/queries/crm-leads';
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

type Filter = 'all' | 'whatsapp' | 'email';

export function LeadConversationTab({
  messages,
  sender,
  sequencePaused,
  leadName,
  onReviewFollowUp,
}: {
  messages: readonly CrmMessage[];
  sender: CrmSender | null;
  /** Why the chase stopped, when it has — migration 170 pauses on a reply. */
  sequencePaused: string | null;
  leadName: string;
  onReviewFollowUp: () => void;
}) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [oldestFirst, setOldestFirst] = React.useState(true);
  const [dismissed, setDismissed] = React.useState(false);
  const [channel, setChannel] = React.useState<'whatsapp' | 'email'>('whatsapp');
  const [draft, setDraft] = React.useState('');

  const counts = {
    whatsapp: messages.filter((m) => m.channel === 'whatsapp').length,
    email: messages.filter((m) => m.channel === 'email').length,
  };

  const shown = React.useMemo(() => {
    const kept = filter === 'all' ? messages : messages.filter((m) => m.channel === filter);
    /* ⚠️ A COPY BEFORE SORTING. `messages` is the server's array and reversing it
       in place would reorder the prop for every other reader of it. */
    return oldestFirst ? [...kept] : [...kept].reverse();
  }, [messages, filter, oldestFirst]);

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

        {/* ⚠️ THE LABEL SAYS WHAT THE ORDER ACTUALLY IS. The reference reads
            "Newest first" above a thread running oldest to newest; a conversation
            is read downwards, so the default is oldest-first and the control is
            honest about it. */}
        {/* ⚠️ IT LOOKS LIKE THE CHOICE IT IS. A bare label reads as a status
            line; the chevron is what says it can be changed. */}
        <button
          type="button"
          onClick={() => setOldestFirst((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          Sort: {oldestFirst ? 'Oldest first' : 'Newest first'}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* ── The chase stopped because they answered ─────────────────── */}
      {sequencePaused && !dismissed && (
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
            <p className="text-body-sm font-semibold text-text-primary">
              New reply received — follow-up paused
            </p>
            <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
              {/* ⚠️ THE REASON THE ENGINE GAVE, not a sentence written here. 170
                  records why it stopped, and repeating a guess beside it is how
                  two explanations start disagreeing. */}
              {sequencePaused === 'the client replied'
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

      {/* ── The thread ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-body-sm text-text-secondary">
            {messages.length === 0
              ? 'Nothing has been sent or received yet.'
              : `No ${filter} messages on this lead.`}
          </p>
        ) : (
          <ol className="space-y-4">
            {shown.map((m) => (
              <Entry key={m.id} message={m} leadName={leadName} />
            ))}
          </ol>
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────────────── */}
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
              {sender?.configured ? (
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
            disabled={!draft.trim() || (channel === 'whatsapp' && !sender?.configured)}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-2 text-caption font-semibold text-white transition-opacity',
              (!draft.trim() || (channel === 'whatsapp' && !sender?.configured)) && 'opacity-40',
            )}
          >
            <Send className="size-4" aria-hidden="true" />
            Send reply
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- One entry ----------------------------------------------------------- */

function Entry({ message, leadName }: { message: CrmMessage; leadName: string }) {
  const mine = message.direction === 'outbound';
  const isEmail = message.channel === 'email';
  const when = new Date(message.occurredAt).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi',
  });

  return (
    <li className="flex gap-3">
      {/* The channel, as a mark rather than a word repeated on every line. */}
      <span
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full"
        style={{
          background: isEmail
            ? 'color-mix(in oklab, #2563EB 12%, transparent)'
            : 'color-mix(in oklab, #25D366 16%, transparent)',
          color: isEmail ? MAIL_BLUE : WA_GREEN,
        }}
      >
        {isEmail ? <Mail className="size-5" aria-hidden="true" /> : <WhatsAppMark className="size-5" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-body-sm font-semibold text-text-primary">
            {mine ? `You · ${message.sentByName ?? 'Sarah'}` : leadName}{' '}
            <span className="font-normal text-text-secondary">
              {isEmail ? (mine ? 'sent an email' : 'replied by email') : '(WhatsApp)'}
            </span>
          </p>
          <span className="flex shrink-0 items-center gap-1 text-caption text-text-secondary">
            {when}
            {/* ⚠️ THE TICKS ARE OURS ONLY. An inbound message has no delivery
                state we own, and drawing one would be inventing a receipt. */}
            {mine && message.status === 'read' && (
              <span className="text-text-brand" title="Read">
                <Check className="-mr-2 inline size-3.5" strokeWidth={3} />
                <Check className="inline size-3.5" strokeWidth={3} />
              </span>
            )}
            {mine && message.status === 'delivered' && (
              <span title="Delivered">
                <Check className="-mr-2 inline size-3.5" strokeWidth={3} />
                <Check className="inline size-3.5" strokeWidth={3} />
              </span>
            )}
            {mine && message.status === 'sent' && <Check className="inline size-3.5" strokeWidth={3} />}
          </span>
        </div>

        {isEmail ? (
          <div className="mt-1.5">
            {message.subject && (
              <p className="text-body-sm font-semibold text-text-primary">{message.subject}</p>
            )}
            {message.body && (
              <p className="mt-0.5 line-clamp-3 text-caption leading-relaxed text-text-secondary">
                {message.body}
              </p>
            )}
            {/* ⚠️ A LINK TO THE RLS-SCOPED ROUTE, not a callback up the tree.
                `/api/whatsapp/media/[id]` answers 404 for a message the caller
                cannot read — the same 404 as one that does not exist — so the URL
                cannot be used to find out which ids are real.
                ⚠️ And the comment sits HERE rather than inside the `&&`: a JSX
                comment is only valid in a children position, and one tucked into
                an expression is a syntax error twenty lines from where tsc points. */}
            {message.mediaFilename && (
              <a
                href={`/api/whatsapp/media/${message.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2.5 text-left transition-colors hover:border-border-default"
              >
                <FileText className="size-5 shrink-0 text-feedback-error" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
                  {message.mediaFilename}
                </span>
              </a>
            )}
          </div>
        ) : (
          /* ⚠️ THE BUBBLE IS TINTED BY WHO SPOKE, not by channel. Green is ours,
             plain is theirs — the convention every client of every messaging app
             already knows, so nobody has to learn this screen. */
          <div
            className="mt-1.5 inline-block max-w-full rounded-xl px-3 py-2"
            style={{
              background: mine
                ? 'color-mix(in oklab, #25D366 12%, transparent)'
                : 'var(--bg-subtle)',
            }}
          >
            <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed text-text-primary">
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
          <p className="mt-1 text-caption text-feedback-error">
            Not delivered{message.errorDetail ? ` — ${message.errorDetail}` : ''}
          </p>
        )}
      </div>
    </li>
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
