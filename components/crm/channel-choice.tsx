'use client';

import * as React from 'react';
import { ArrowRight, Loader2, Mail, Paperclip } from 'lucide-react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { displayPhone } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHICH CHANNEL SHOULD THIS GO ON?
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"when I click on the attach selected quote, it shows me a
 * channel to which I want to send it, whether from WhatsApp or email… the modal
 * that will pop up to ask WhatsApp or email should be proper according to the
 * theme and rhythm, with a proper WhatsApp green icon."*
 *
 * Two cards, each carrying the one fact that decides the answer: the number the
 * client is messaged on, and the address they are written to.
 *
 * ⚠️ A CHANNEL WITH NOWHERE TO SEND IS SHOWN AS UNAVAILABLE, NOT HIDDEN. 640 of
 * 641 leads arrived from a Meta form that never asked for an email address, so
 * "Email" is missing far more often than it is present — a card that vanished
 * would read as a feature that comes and goes. It stays, greyed, with the reason
 * and the fix on it.
 *
 * ⚠️ AND THE 24-HOUR WINDOW IS NOT A REASON TO REFUSE WHATSAPP HERE. Outside it
 * WhatsApp takes an approved template rather than free text, which the composer
 * already knows and says; deciding that in this dialog would refuse a send the
 * next screen would have allowed.
 * ========================================================================= */

export type Channel = 'whatsapp' | 'email';

export function ChannelChoice({
  title,
  /** What is being sent, in one line — "QT-1042 · PKR 4,500,000". */
  summary,
  /** How many files ride along, so the cards can say so. */
  fileCount,
  phone,
  email,
  /** The business name the client sees on WhatsApp. */
  senderName,
  busy,
  onPick,
  onCancel,
}: {
  title: string;
  summary: string;
  fileCount: number;
  phone: string | null;
  email: string | null;
  senderName: string | null;
  busy: boolean;
  onPick: (channel: Channel) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = React.useState<Channel | null>(null);

  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onCancel}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <header className="border-b border-border-subtle px-5 py-4">
          <h3 className="text-body font-semibold text-text-primary">{title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-caption text-text-secondary">
            {summary}
            {fileCount > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1">
                <Paperclip className="size-3" aria-hidden="true" />
                {fileCount} file{fileCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </header>

        <div className="space-y-2 px-5 py-4">
          <Card
            channel="whatsapp"
            label="WhatsApp"
            tint={WA_GREEN}
            icon={<WhatsAppMark className="size-5" />}
            detail={phone ? displayPhone(phone) : 'No WhatsApp number on this lead'}
            footnote={phone ? `Sent as ${senderName ?? 'your business'}` : 'Add one with Edit details'}
            available={!!phone}
            chosen={chosen === 'whatsapp'}
            busy={busy}
            onChoose={() => {
              setChosen('whatsapp');
              onPick('whatsapp');
            }}
          />
          <Card
            channel="email"
            label="Email"
            tint="var(--channel-email)"
            icon={<Mail className="size-5" aria-hidden="true" />}
            detail={email ?? 'No email address on this lead'}
            footnote={email ? 'Attached to the letter, on your own letterhead' : 'Add one with Edit details'}
            available={!!email}
            chosen={chosen === 'email'}
            busy={busy}
            onChoose={() => {
              setChosen('email');
              onPick('email');
            }}
          />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3.5">
          {/* ⚠️ IT SAYS WHAT HAPPENS NEXT, because nothing is sent from here. */}
          <p className="min-w-0 flex-1 text-caption text-text-secondary">
            It opens in the composer for you to read before sending.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

function Card({
  channel,
  label,
  tint,
  icon,
  detail,
  footnote,
  available,
  chosen,
  busy,
  onChoose,
}: {
  channel: Channel;
  label: string;
  tint: string;
  icon: React.ReactNode;
  detail: string;
  footnote: string;
  available: boolean;
  chosen: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!available || busy}
      onClick={onChoose}
      aria-label={`Send on ${label}`}
      data-channel={channel}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
        available
          ? 'border-border-default hover:bg-bg-subtle'
          : 'cursor-not-allowed border-dashed border-border-subtle opacity-60',
      )}
      style={chosen ? { borderColor: tint, background: `color-mix(in oklab, ${tint} 8%, transparent)` } : undefined}
    >
      <span
        className="grid size-11 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${tint} 12%, transparent)`, color: tint }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-semibold text-text-primary">{label}</span>
        <span className="block truncate text-caption text-text-primary">{detail}</span>
        <span className="block truncate text-caption text-text-secondary">{footnote}</span>
      </span>
      {chosen && busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin" style={{ color: tint }} aria-hidden="true" />
      ) : available ? (
        <ArrowRight className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      ) : null}
    </button>
  );
}
