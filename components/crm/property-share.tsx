'use client';

import * as React from 'react';
import {
  AlertTriangle, Check, Copy, Eye, FileDown, Link2, Lock, Mail, MapPin, MessageCircle,
  Calendar, CreditCard, Ruler, Tag, User, FileText, Info,
} from 'lucide-react';

import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select } from '@/components/crm/clients-ui';
import { Dialog } from '@/components/ui/dialog';
import type { PropertyRow } from '@/lib/db/queries/crm-properties';
import {
  areaLabel, displayArea, money, shareLines, sizeLabel, statusLook,
  type ShareFields,
} from '@/lib/domain/crm-property';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SHARE A PROPERTY — the owner's reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * Seven numbered sections, exactly as she drew them: method, recipient, the
 * message as the customer will read it, attachments, which fields go, link
 * settings, and a preview of the card.
 *
 * ── ⚠️ THREE FIELDS ARE LOCKED OFF AND CANNOT BE UNLOCKED ─────────────────
 * Internal notes, linked leads and booking information carry a padlock in the
 * reference, and here they are not merely a switch in the off position: the
 * text is built by `shareLines()`, which has no branch that can emit them. A
 * disabled toggle is a UI state; an allow-list is a guarantee.
 *
 * Owner: *"Sharing should provide customer-safe property information only. It
 * must not expose internal notes, lead details, booking payments or
 * administrative history."*
 *
 * ── ⚠️ NOTHING HERE SENDS A MESSAGE BY ITSELF ─────────────────────────────
 * The repository's standing rule is that no message reaches a real person by
 * accident. WhatsApp opens `wa.me` with the text prepared and the salesperson
 * presses send in their own client; Email opens `mailto:`. There is no server
 * call that puts a message on the wire, so there is no path from this dialog to
 * a customer's phone that a person did not personally take.
 *
 * ── ⚠️ AND SHARING DOES NOT RESERVE ───────────────────────────────────────
 * Said on screen because the owner asked for it to be true, and true because
 * nothing in this component writes at all.
 * ========================================================================= */

type Method = 'whatsapp' | 'email' | 'link' | 'pdf';

const FIELD =
  'h-[2.5rem] w-full rounded-[0.45rem] border bg-[var(--cl-surface)] px-[0.7rem] text-[0.9rem] focus:outline-none';

export function SharePropertyDialog({
  open, onClose, row, viewerName, onToast,
}: {
  open: boolean;
  onClose: () => void;
  row: PropertyRow | null;
  viewerName: string;
  onToast: (tone: 'ok' | 'error', text: string) => void;
}) {
  const [method, setMethod] = React.useState<Method>('whatsapp');
  const [name, setName] = React.useState('');
  const [dial, setDial] = React.useState('+92');
  const [phone, setPhone] = React.useState('');
  const [fields, setFields] = React.useState<ShareFields>({
    projectAndLocation: true,
    plotDetails: true,
    price: true,
    paymentPlan: true,
    availability: true,
  });
  const [attach, setAttach] = React.useState({ sheet: true, plan: true, site: false });
  const [expiry, setExpiry] = React.useState('7');
  const [allowDownload, setAllowDownload] = React.useState(true);
  const [trackOpens, setTrackOpens] = React.useState(true);
  const [copied, setCopied] = React.useState<string | null>(null);

  /* A fresh dialog each time it opens — a previous customer's name left in the
     box is how the wrong person gets addressed. */
  const was = React.useRef(open);
  if (was.current !== open) {
    was.current = open;
    if (open) { setName(''); setPhone(''); setCopied(null); }
  }

  if (!row) return null;

  const message = shareLines(row, fields, { to: name.trim() || null, from: viewerName });
  const subject = `${row.plotNumber ?? row.code} · ${row.projectName}`;
  const e164 = `${dial}${phone.replace(/[^0-9]/g, '')}`;

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
      onToast('ok', `${what} copied.`);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share property"
      size="lg"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv('tile') }}>
            <MessageCircle className="size-[1.25rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[1.25rem] font-bold leading-tight" style={{ color: cv('ink') }}>Share property</span>
            <span className="block text-[0.86rem]" style={{ color: cv('soft') }}>
              Create a customer-safe share for {row.plotNumber ?? row.code}
            </span>
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
            Cancel
          </button>
          <button type="button" onClick={() => copy('Message', message)}
                  className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
            {copied === 'Message' ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            Copy message
          </button>
          {method === 'email' ? (
            <a
              href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
              className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`}
              style={solidStyle}
            >
              <Mail className="size-4" aria-hidden="true" /> Open email
            </a>
          ) : (
            /* ⚠️ `wa.me` OPENS THEIR OWN WHATSAPP with the text prepared. It does
               not send. Nothing in this product may put a message on the wire
               without the consent and 24-hour-window machinery, and a Share
               dialog is not the place to reimplement it. */
            <a
              href={`https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              aria-disabled={phone.trim().length < 7}
              onClick={(e) => { if (phone.trim().length < 7) { e.preventDefault(); onToast('error', 'Type the customer’s number first.'); } }}
              className={cn(`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`, phone.trim().length < 7 && 'opacity-50')}
              style={solidStyle}
            >
              <MessageCircle className="size-4" aria-hidden="true" /> Open in WhatsApp
            </a>
          )}
        </div>
      }
    >
      <div className="grid gap-[1rem] lg:grid-cols-2">
        {/* ── left column ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-[0.9rem]">
          <Section n={1} title="Choose sharing method">
            <div className="flex flex-wrap gap-2">
              {([
                ['whatsapp', 'WhatsApp', MessageCircle],
                ['email', 'Email', Mail],
                ['link', 'Copy link', Link2],
                ['pdf', 'Download PDF', FileDown],
              ] as const).map(([k, label, Icon]) => {
                const on = method === k;
                const notBuilt = k === 'link' || k === 'pdf';
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => (notBuilt
                      ? onToast('error', k === 'link'
                          ? 'A public customer link needs a share-link service, which is not built yet.'
                          : 'The property-sheet PDF is not built yet. Copy the message meanwhile.')
                      : setMethod(k))}
                    title={notBuilt ? 'Not built yet' : undefined}
                    className={cn('inline-flex h-[2.5rem] items-center gap-[0.45rem] rounded-[0.45rem] border px-[0.8rem] text-[0.88rem] font-medium transition-colors',
                      notBuilt && 'opacity-55')}
                    style={on
                      ? { background: cv('brand'), color: cv('on-brand'), borderColor: 'transparent' }
                      : { borderColor: cv('line'), color: cv('ink'), background: cv('surface') }}
                  >
                    <Icon className="size-[1rem]" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section n={2} title="Recipient details">
            <div className="grid gap-[0.7rem] sm:grid-cols-[1fr_1fr]">
              <label className="flex flex-col gap-[0.3rem]">
                <span className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>Customer name</span>
                <input className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                       value={name} onChange={(e) => setName(e.target.value)} placeholder="Faisal Rehman" />
              </label>
              <div className="flex flex-col gap-[0.3rem]">
                <span className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>Phone number</span>
                <span className="flex gap-[0.35rem]">
                  <Select label="Country code" value={dial} onChange={setDial} className="h-[2.5rem] w-[5.4rem]">
                    <option value="+92">+92</option>
                    <option value="+971">+971</option>
                    <option value="+44">+44</option>
                    <option value="+1">+1</option>
                  </Select>
                  <input className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                         value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 8726" inputMode="tel" />
                </span>
              </div>
            </div>
          </Section>

          <Section n={3} title="Message preview">
            {/* ⚠️ The real string, not a mock-up of one. What is drawn here is
                exactly what `Copy message` puts on the clipboard. */}
            <pre className="max-h-[15rem] overflow-auto whitespace-pre-wrap rounded-[0.5rem] border p-3 text-[0.84rem] leading-[1.55]"
                 style={{ borderColor: cv('line'), background: cv('head'), color: cv('ink'), fontFamily: 'inherit' }}>
              {message}
            </pre>
          </Section>

          <Section n={4} title="Attachments">
            <ul className="space-y-[0.4rem]">
              {([['sheet', 'Property sheet (PDF)'], ['plan', 'Payment plan (PDF)'], ['site', 'Site plan (PDF)']] as const).map(([k, label]) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-[0.45rem] text-[0.86rem]" style={{ color: cv('ink') }}>
                    <FileText className="size-[0.95rem]" style={{ color: cv('red-strong') }} aria-hidden="true" />
                    {label}
                  </span>
                  <Switch on={attach[k]} onFlip={() => setAttach((c) => ({ ...c, [k]: !c[k] }))} label={label} />
                </li>
              ))}
            </ul>
            {/* Honest about what an attachment currently is. */}
            <p className="mt-[0.45rem] flex items-start gap-[0.4rem] text-[0.76rem]" style={{ color: cv('mute') }}>
              <Info className="mt-[0.1rem] size-[0.85rem] shrink-0" aria-hidden="true" />
              These attach once the documents are uploaded against this plot. None is uploaded yet.
            </p>
          </Section>
        </div>

        {/* ── right column ────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-[0.9rem]">
          <Section n={5} title="Shared information" hint="Choose what the customer sees.">
            <ul className="space-y-[0.35rem]">
              <Toggle icon={MapPin} label="Project and location" on={fields.projectAndLocation}
                      onFlip={() => setFields((c) => ({ ...c, projectAndLocation: !c.projectAndLocation }))} />
              <Toggle icon={Ruler} label="Plot details (size, block, dimensions)" on={fields.plotDetails}
                      onFlip={() => setFields((c) => ({ ...c, plotDetails: !c.plotDetails }))} />
              <Toggle icon={Tag} label="Price" on={fields.price}
                      onFlip={() => setFields((c) => ({ ...c, price: !c.price }))} />
              <Toggle icon={CreditCard} label="Payment plan" on={fields.paymentPlan}
                      onFlip={() => setFields((c) => ({ ...c, paymentPlan: !c.paymentPlan }))} />
              <Toggle icon={Calendar} label="Availability status" on={fields.availability}
                      onFlip={() => setFields((c) => ({ ...c, availability: !c.availability }))} />

              {/* ⚠️ LOCKED, AND NOT MERELY OFF. `shareLines()` has no branch that
                  can emit any of these, so the padlock is describing the code
                  rather than decorating a disabled switch. */}
              <Toggle icon={FileText} label="Internal notes" locked />
              <Toggle icon={User} label="Linked leads" locked />
              <Toggle icon={Calendar} label="Booking information" locked />
            </ul>
          </Section>

          <Section n={6} title="Link settings">
            <div className="grid gap-[0.7rem] sm:grid-cols-2">
              <label className="flex flex-col gap-[0.3rem]">
                <span className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>Link expiry</span>
                <Select label="Link expiry" value={expiry} onChange={setExpiry} className="h-[2.5rem] w-full">
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="0">No expiry</option>
                </Select>
              </label>
              <div className="space-y-[0.4rem] pt-[1.3rem]">
                <span className="flex items-center justify-between gap-2 text-[0.86rem]" style={{ color: cv('ink') }}>
                  Allow download
                  <Switch on={allowDownload} onFlip={() => setAllowDownload(!allowDownload)} label="Allow download" />
                </span>
                <span className="flex items-center justify-between gap-2 text-[0.86rem]" style={{ color: cv('ink') }}>
                  Track opens
                  <Switch on={trackOpens} onFlip={() => setTrackOpens(!trackOpens)} label="Track opens" />
                </span>
              </div>
            </div>
            <p className="mt-[0.45rem] flex items-start gap-[0.4rem] text-[0.76rem]" style={{ color: cv('mute') }}>
              <Info className="mt-[0.1rem] size-[0.85rem] shrink-0" aria-hidden="true" />
              These apply to a public customer link, which is not built yet — the message above works today.
            </p>
          </Section>

          <Section n={7} title="Customer preview" icon={Eye}>
            <div className="rounded-[0.55rem] border p-[0.7rem]" style={{ borderColor: cv('line') }}>
              <p className="flex items-start justify-between gap-2">
                <span>
                  <span className="block text-[0.78rem]" style={{ color: cv('soft') }}>{row.projectName}</span>
                  <span className="block text-[1rem] font-bold" style={{ color: cv('ink') }}>
                    {row.plotNumber ?? row.code}{row.block ? ` · Block ${row.block}` : ''}
                  </span>
                  <span className="block text-[0.82rem]" style={{ color: cv('soft') }}>
                    {sizeLabel(row.sizeMarla)} ({areaLabel(displayArea(row.areaSqft, row.sizeMarla, row.marlaStandard))})
                  </span>
                  <span className="mt-[0.2rem] block text-[1rem] font-bold" style={{ color: cv('ink') }}>
                    {fields.price ? money(row.basePrice) : 'Price on request'}
                  </span>
                </span>
                {fields.availability && (
                  <span className="inline-flex shrink-0 items-center gap-[0.35rem] rounded-full px-[0.6rem] py-[0.2rem] text-[0.74rem] font-medium"
                        style={{ background: cv(`${statusLook(row.status).tone}-bg`), color: cv(statusLook(row.status).tone) }}>
                    <span className="size-[0.4rem] rounded-full" style={{ background: cv(`${statusLook(row.status).tone}-dot`) }} aria-hidden="true" />
                    {statusLook(row.status).label}
                  </span>
                )}
              </p>
            </div>
            <p className="mt-[0.5rem] flex items-start gap-[0.45rem] rounded-[0.45rem] px-[0.6rem] py-[0.45rem] text-[0.8rem]"
               style={{ background: cv('amber-soft'), color: cv('amber') }}>
              <AlertTriangle className="mt-[0.1rem] size-[0.9rem] shrink-0" aria-hidden="true" />
              Sharing does not reserve the property. Availability is checked again when the customer replies.
            </p>
          </Section>
        </div>
      </div>
    </Dialog>
  );
}

function Section({
  n, title, hint, icon: Icon, children,
}: {
  n: number;
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-[0.45rem] inline-flex items-center gap-[0.4rem] text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>
        {Icon ? <Icon className="size-[1rem]" style={{ color: cv('brand-ink') }} aria-hidden /> : null}
        {n}. {title}
      </h4>
      {hint ? <p className="mb-[0.4rem] text-[0.78rem]" style={{ color: cv('soft') }}>{hint}</p> : null}
      {children}
    </section>
  );
}

function Toggle({
  icon: Icon, label, on, onFlip, locked,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>;
  label: string;
  on?: boolean;
  onFlip?: () => void;
  locked?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="inline-flex min-w-0 items-center gap-[0.45rem] text-[0.86rem]"
            style={{ color: locked ? cv('mute') : cv('ink') }}>
        <Icon className="size-[0.95rem] shrink-0" style={{ color: cv('mute') }} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-[0.4rem]">
        <Switch on={Boolean(on)} onFlip={onFlip} label={label} disabled={locked} />
        {locked ? <Lock className="size-[0.85rem]" style={{ color: cv('mute') }} aria-label="Never shared" /> : null}
      </span>
    </li>
  );
}

function Switch({
  on, onFlip, label, disabled,
}: { on: boolean; onFlip?: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={disabled ? `${label} — never shared` : label}
      disabled={disabled}
      onClick={onFlip}
      className={cn(
        'relative inline-flex h-[1.35rem] w-[2.4rem] shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      style={on
        ? { background: cv('brand'), borderColor: 'transparent' }
        : { background: cv('pill'), borderColor: cv('line') }}
    >
      <span aria-hidden="true"
            className={cn('block size-[1rem] rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform',
              on ? 'translate-x-[1.22rem]' : 'translate-x-[0.14rem]')} />
    </button>
  );
}
