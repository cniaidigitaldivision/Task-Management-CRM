'use client';

import * as React from 'react';
import { Check, Paperclip } from 'lucide-react';

import { WA_GREEN } from '@/components/crm/whatsapp-mark';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT THE CLIENT WILL SEE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"When I click on email, the email preview will be visible.
 * When I click on WhatsApp, the WhatsApp preview will be visible."*
 *
 * ⚠️ IT IS A PREVIEW, NOT A MOCK-UP. Everything drawn here is the message that
 * will actually go: the same filled text, the same subject, the same sending
 * name, the same attachments. Nothing is invented for the picture — a preview
 * that flatters the message is worse than none, because somebody approves it.
 * ========================================================================= */

/** WhatsApp's own outgoing-bubble green, and the wallpaper behind it. */
const BUBBLE = '#d9fdd3';
const WALLPAPER = '#efe7de';

export function WhatsAppPreview({
  businessName,
  body,
  timeLabel,
  note,
}: {
  businessName: string;
  body: string;
  timeLabel: string;
  note?: string;
}) {
  const initials = businessName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle">
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-bg-surface px-3 py-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full text-caption font-semibold text-white"
          style={{ background: WA_GREEN }}
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-body-sm font-semibold text-text-primary">
            {businessName}
            <span
              className="grid size-3.5 shrink-0 place-items-center rounded-full text-white"
              style={{ background: '#25d366' }}
              aria-label="Verified business"
            >
              <Check className="size-2.5" strokeWidth={4} aria-hidden="true" />
            </span>
          </p>
          <p className="truncate text-caption text-text-secondary">Business account</p>
        </div>
      </div>

      <div className="px-3 py-4" style={{ background: WALLPAPER }}>
        <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none px-2.5 py-1.5 shadow-sm" style={{ background: BUBBLE }}>
          <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed" style={{ color: '#111b21' }}>
            {body || 'Nothing written yet.'}
          </p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.65rem]" style={{ color: '#667781' }}>
            {timeLabel}
            {/* The two ticks a client's phone shows once it arrives. */}
            <span style={{ color: '#53bdeb' }} aria-label="Delivered">
              <svg viewBox="0 0 16 11" className="h-3 w-4 fill-none" aria-hidden="true">
                <path d="M1 5.5 4 8.5 9.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 5.5 9 8.5 14.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </p>
        </div>
      </div>

      {note && (
        <p className="flex items-start gap-2 border-t border-border-subtle bg-bg-surface px-3 py-2 text-caption leading-relaxed text-text-secondary">
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-feedback-success text-white">
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
          </span>
          {note}
        </p>
      )}
    </div>
  );
}

export function EmailPreview({
  fromName,
  fromAddress,
  toName,
  toAddress,
  subject,
  body,
  signOff,
  attachments = [],
}: {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
  signOff: string;
  attachments?: ReadonlyArray<{ name: string; size: string }>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      <div className="space-y-1 border-b border-border-subtle px-3.5 py-3">
        <Line label="From" value={`${fromName} <${fromAddress}>`} />
        <Line label="To" value={toAddress ? `${toName} <${toAddress}>` : `${toName} — no email address`} muted={!toAddress} />
        <Line label="Subject" value={subject || '(no subject)'} strong />
      </div>
      <div className="px-3.5 py-3">
        <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed text-text-primary">
          {body || 'Nothing written yet.'}
        </p>
        <p className="mt-3 text-body-sm leading-relaxed text-text-secondary">{signOff}</p>
      </div>
      {attachments.length > 0 && (
        <div className="border-t border-border-subtle px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-caption text-text-secondary">
            <Paperclip className="size-3.5" aria-hidden="true" />
            {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {attachments.map((a) => (
              <li key={a.name} className="flex items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5">
                <span className="grid size-7 shrink-0 place-items-center rounded bg-feedback-error/10 text-[0.6rem] font-bold text-feedback-error">
                  PDF
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-caption font-medium text-text-primary">{a.name}</span>
                  <span className="block text-caption text-text-secondary">{a.size}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <p className="flex gap-2 text-caption">
      <span className="w-14 shrink-0 text-text-secondary">{label}:</span>
      <span className={cn('min-w-0 flex-1 break-words', strong ? 'font-semibold text-text-primary' : 'text-text-primary', muted && 'italic text-text-secondary')}>
        {value}
      </span>
    </p>
  );
}
