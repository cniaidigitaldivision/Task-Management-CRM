'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CircleCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Home,
  Info,
  Loader2,
  MessageSquareText,
  Paperclip,
  Plus,
  Upload,
  User,
  X,
} from 'lucide-react';

import {
  attachInvoiceReceiptAction,
  attachQuotationPdfAction,
  confirmBookingAction,
  createBookingAction,
  createInvoiceAction,
  invoiceReceiptLinkAction,
  markInvoiceSentAction,
  prepareQuotationPdfAction,
  prepareReceiptAction,
  quotationPdfLinkAction,
  recordInvoicePaymentAction,
  relatedItemsAction,
  requestBookingVerificationAction,
} from '@/app/actions/crm-related';
import { crmDocumentLinkAction } from '@/app/actions/crm-documents';
import { formatWhen } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord } from '@/lib/db/queries/crm-leads';
import type {
  RelatedBooking,
  RelatedInvoice,
  RelatedItems,
  RelatedProperty,
  RelatedQuotation,
} from '@/lib/db/queries/crm-related';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RELATED ITEMS — quotations, properties, appointments, bookings, invoices
 * ----------------------------------------------------------------------------
 * Built to the owner's five designs of 2026-09-17. One dialog, five tabs, and
 * the same shape on every one: the list on the left, the record itself on the
 * right, the actions along the foot.
 *
 * ⚠️ NOTHING HERE IS DEMO DATA. The owner's mock-ups carry a "Demo data" badge
 * on Bookings and Invoices because no such table existed; 194 and 195 built them,
 * with the three rules their own design states — a quotation reserves nothing, a
 * pending booking is not a sale, and a salesperson does not verify money.
 *
 * ⚠️ AND IT READS ON OPEN, NOT WITH THE DRAWER. One statement, once, when
 * somebody asks to see it (`readLeadRelatedItems`). A payment plan nobody has
 * opened has no business in the drawer's first paint — Rule Zero.
 * ========================================================================= */

export type TabKey = 'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices' | 'files';

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'quotations', label: 'Quotations', icon: ClipboardList },
  { key: 'properties', label: 'Properties', icon: Home },
  { key: 'appointments', label: 'Appointments', icon: CalendarDays },
  { key: 'bookings', label: 'Bookings', icon: CircleCheck },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'files', label: 'Files', icon: Paperclip },
];

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `PKR ${Math.round(n).toLocaleString('en-PK')}`;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }) : '—';

/* Meta's own words for a status, in ours, with a colour. */
function tone(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    approved: { label: 'Approved', color: 'var(--feedback-success)' },
    sent: { label: 'Valid', color: 'var(--feedback-success)' },
    pending_approval: { label: 'Awaiting approval', color: 'var(--feedback-warning)' },
    draft: { label: 'Draft', color: 'var(--text-secondary)' },
    superseded: { label: 'Superseded', color: 'var(--text-secondary)' },
    rejected: { label: 'Rejected', color: 'var(--feedback-error)' },
    expired: { label: 'Expired', color: 'var(--feedback-error)' },
    available: { label: 'Available', color: 'var(--feedback-success)' },
    reserved: { label: 'Reserved', color: 'var(--feedback-warning)' },
    sold: { label: 'Sold', color: 'var(--text-secondary)' },
    requested: { label: 'Requested', color: 'var(--channel-email)' },
    pending_verification: { label: 'Pending verification', color: 'var(--feedback-warning)' },
    confirmed: { label: 'Confirmed', color: 'var(--feedback-success)' },
    cancelled: { label: 'Cancelled', color: 'var(--text-secondary)' },
    unpaid: { label: 'Unpaid', color: 'var(--feedback-warning)' },
    part_paid: { label: 'Part paid', color: 'var(--channel-email)' },
    paid: { label: 'Paid', color: 'var(--feedback-success)' },
    void: { label: 'Void', color: 'var(--text-secondary)' },
  };
  return map[status] ?? { label: status.replace(/_/g, ' '), color: 'var(--text-secondary)' };
}

export function RelatedItemsDialog({
  lead,
  initialTab = 'quotations',
  onClose,
  onChooseUnit,
  onRecordOutcome,
}: {
  lead: CrmLeadRecord;
  /** Which tab the drawer's summary asked for. */
  initialTab?: TabKey;
  onClose: () => void;
  /** The drawer already owns the unit picker; this dialog borrows it. */
  onChooseUnit: () => void;
  /** Appointments are booked by recording an outcome, which the drawer owns too. */
  onRecordOutcome: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const [items, setItems] = React.useState<RelatedItems | null>(null);
  const [chosen, setChosen] = React.useState<Record<TabKey, string | null>>({
    quotations: null, properties: null, appointments: null, bookings: null, invoices: null, files: null,
  });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const next = await relatedItemsAction(lead.id);
    if (next) setItems(next);
  }, [lead.id]);

  React.useEffect(() => {
    let alive = true;
    void relatedItemsAction(lead.id).then((next) => {
      if (alive && next) setItems(next);
    });
    return () => {
      alive = false;
    };
  }, [lead.id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /** Every write goes through here: act, re-read, report in the server's words. */
  const act = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast({ tone: 'error', text: result.error });
        return false;
      }
      await load();
      toast({ tone: 'ok', text: done });
      return true;
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pick = (key: TabKey, id: string) => setChosen((c) => ({ ...c, [key]: id }));
  const count = (key: TabKey) => (items ? items[key].length : null);

  const body = (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Related items"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[64rem] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        {/* ── Who this is about ───────────────────────────────────────── */}
        <header className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-subtle text-text-secondary">
            <User className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h3 font-semibold text-text-primary">Related items</h2>
            <p className="truncate text-caption text-text-secondary">
              {lead.fullName ?? 'This lead'} · {lead.projectName}
              {lead.city ? ` · ${lead.city}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {/* ── The five ────────────────────────────────────────────────── */}
        <div role="tablist" aria-label="Related items" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3">
          {TABS.map((t) => {
            const n = count(t.key);
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-body-sm font-medium transition-colors',
                  tab === t.key
                    ? 'border-accent-primary text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                <t.icon className="size-4" />
                {t.label}
                {n !== null && n > 0 && (
                  <span className="rounded-full bg-bg-subtle px-1.5 text-caption tabular-nums text-text-secondary">{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── The records ─────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items === null ? (
            <p className="flex items-center justify-center gap-2 py-16 text-caption text-text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading this lead&rsquo;s records…
            </p>
          ) : tab === 'quotations' ? (
            <Quotations
              lead={lead}
              items={items}
              chosenId={chosen.quotations}
              onPick={(id) => pick('quotations', id)}
              onReload={load}
              busy={busy}
              setBusy={setBusy}
            />
          ) : tab === 'properties' ? (
            <Properties
              items={items}
              chosenId={chosen.properties}
              onPick={(id) => pick('properties', id)}
              onChooseUnit={onChooseUnit}
            />
          ) : tab === 'appointments' ? (
            <Appointments
              items={items}
              chosenId={chosen.appointments}
              onPick={(id) => pick('appointments', id)}
              onRecordOutcome={onRecordOutcome}
            />
          ) : tab === 'bookings' ? (
            <Bookings
              lead={lead}
              items={items}
              chosenId={chosen.bookings}
              onPick={(id) => pick('bookings', id)}
              act={act}
              busy={busy}
            />
          ) : tab === 'invoices' ? (
            <Invoices
              lead={lead}
              items={items}
              chosenId={chosen.invoices}
              onPick={(id) => pick('invoices', id)}
              act={act}
              busy={busy}
              onReload={load}
            />
          ) : (
            <Files items={items} />
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <p className="min-w-0 truncate text-caption text-text-secondary">
            Every record here belongs to {lead.fullName ?? 'this lead'}
            {lead.ownerName ? ` · ${lead.ownerName}` : ''}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-border-default px-3.5 py-2 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

/* ── The shared two-column frame ─────────────────────────────────────────── */

function Split({
  title,
  count,
  action,
  list,
  detail,
}: {
  title: string;
  count: number;
  action?: React.ReactNode;
  list: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
      <section className="flex min-h-[18rem] flex-col rounded-xl border border-border-subtle bg-bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
          <h3 className="text-body-sm font-semibold text-text-primary">
            {title} <span className="font-normal text-text-secondary">({count})</span>
          </h3>
          {action}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
      </section>
      <section className="min-w-0">{detail}</section>
    </div>
  );
}

function Row({
  chosen,
  onClick,
  children,
}: {
  chosen: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border-subtle px-3.5 py-3 text-left transition-colors last:border-b-0',
        chosen ? 'bg-[var(--pick-bg)]' : 'hover:bg-bg-subtle',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          chosen ? 'border-[var(--pick-mark)]' : 'border-border-default',
        )}
      >
        {chosen && <span className="size-2 rounded-full bg-[var(--pick-mark)]" />}
      </span>
      {children}
    </button>
  );
}

function Pill({ status }: { status: string }) {
  const t = tone(status);
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-caption font-medium"
      style={{ color: t.color, background: `color-mix(in oklab, ${t.color} 12%, transparent)` }}
    >
      {t.label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-caption leading-relaxed text-text-secondary">{children}</p>;
}

function Detail({
  title,
  subtitle,
  status,
  onOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  status?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-surface">
      <header className="flex items-start gap-3 border-b border-border-subtle px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="truncate text-caption text-text-secondary">{subtitle}</p>}
        </div>
        {status && <Pill status={status} />}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            Open
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="space-y-3 px-3.5 py-3">{children}</div>
    </div>
  );
}

function Facts({ rows }: { rows: ReadonlyArray<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="truncate text-caption text-text-secondary">{label}</dt>
          <dd className="truncate text-body-sm font-medium text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── 1 · Quotations ──────────────────────────────────────────────────────── */

function Quotations({
  lead,
  items,
  chosenId,
  onPick,
  onReload,
  busy,
  setBusy,
}: {
  lead: CrmLeadRecord;
  items: RelatedItems;
  chosenId: string | null;
  onPick: (id: string) => void;
  onReload: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const toast = useToast();
  const list = items.quotations;
  const chosen: RelatedQuotation | undefined = list.find((q) => q.id === chosenId) ?? list[0];
  const input = React.useRef<HTMLInputElement>(null);

  const open = async (quotationId: string) => {
    const result = await quotationPdfLinkAction(quotationId);
    if (result.url) window.open(result.url, '_blank', 'noopener');
    else toast({ tone: 'error', text: result.error ?? 'That could not be opened.' });
  };

  /* ⚠️ THE FILE GOES STRAIGHT TO STORAGE. A server action would refuse a body
     over 4.5 MB, and a quotation with a site plan in it passes that easily. */
  const upload = async (file: File, quotationId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const slot = await prepareQuotationPdfAction(lead.id, file.name, file.size);
      if (!slot.ok || !slot.url || !slot.path) {
        toast({ tone: 'error', text: slot.error ?? 'That file could not be prepared.' });
        return;
      }
      const put = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/pdf' },
        body: file,
      });
      if (!put.ok) {
        toast({ tone: 'error', text: `The upload was refused (${put.status}).` });
        return;
      }
      const saved = await attachQuotationPdfAction({
        leadId: lead.id,
        quotationId,
        path: slot.path,
        title: file.name,
        mime: file.type || 'application/pdf',
        sizeBytes: file.size,
      });
      if (!saved.ok) {
        toast({ tone: 'error', text: saved.error });
        return;
      }
      await onReload();
      toast({ tone: 'ok', text: 'Quotation PDF attached.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Split
      title="Available quotations"
      count={list.length}
      list={
        list.length === 0 ? (
          <Empty>
            No quotation has been raised for this lead yet. Raise one from the drawer&rsquo;s Related items tab, and it
            will appear here with its PDF.
          </Empty>
        ) : (
          list.map((q) => (
            <Row key={q.id} chosen={q.id === chosen?.id} onClick={() => onPick(q.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {q.number}
                  {q.version > 1 ? ` v${q.version}` : ''}
                </span>
                <span className="block truncate text-caption text-text-secondary">
                  {day(q.createdAt)}
                  {q.propertyLabel ? ` · ${q.propertyLabel}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-body-sm font-semibold tabular-nums text-text-primary">{money(q.netAmount)}</span>
                {q.pdfPath && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-caption text-text-secondary">
                    <Paperclip className="size-3" aria-hidden="true" />
                    PDF
                  </span>
                )}
              </span>
              <Pill status={q.status} />
            </Row>
          ))
        )
      }
      detail={
        !chosen ? null : (
          <div className="space-y-3">
            <Detail
              title="Quotation preview"
              subtitle="What the client was quoted — the full terms are in the PDF."
              onOpen={chosen.pdfPath ? () => void open(chosen.id) : undefined}
            >
              {/* ⚠️ THE LETTER, NOT A FORM. The owner's design draws the quotation
                  as the client sees it, which is what somebody checks before
                  repeating a figure on the phone. */}
              <div className="rounded-xl border border-border-subtle p-3.5">
                <div className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-text-primary">{lead.projectName}</p>
                    <p className="truncate text-caption text-text-secondary">Quotation for {lead.fullName ?? 'this client'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-caption text-text-secondary">Quotation</p>
                    <p className="text-body-sm font-semibold text-text-primary">{chosen.number}</p>
                    <p className="text-caption text-text-secondary">{day(chosen.createdAt)}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Facts
                    rows={[
                      ['Client', lead.fullName ?? '—'],
                      ['Property', chosen.propertyLabel ?? lead.propertyLabel ?? '—'],
                      ['Prepared by', chosen.preparedByName ?? '—'],
                      ['Valid until', day(chosen.validUntil)],
                    ]}
                  />
                </div>
                <div className="mt-3 border-t border-border-subtle pt-2.5">
                  <p className="text-caption text-text-secondary">Quotation amount</p>
                  <p className="text-h3 font-semibold tabular-nums text-text-primary">{money(chosen.netAmount)}</p>
                  {chosen.approvedDiscount > 0 && (
                    <p className="text-caption text-text-secondary">
                      after {money(chosen.approvedDiscount)} approved off {money(chosen.basePrice)}
                    </p>
                  )}
                </div>
                {chosen.terms && (
                  <p className="mt-3 whitespace-pre-wrap border-t border-border-subtle pt-2.5 text-caption leading-relaxed text-text-secondary">
                    {chosen.terms}
                  </p>
                )}
              </div>

              {/* ── The PDF ────────────────────────────────────────────── */}
              <div className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
                  <FileText className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-text-primary">
                    {chosen.pdfPath ? 'Quotation PDF attached' : 'No PDF attached yet'}
                  </span>
                  <span className="block text-caption text-text-secondary">
                    {chosen.pdfPath
                      ? `${chosen.number} can be sent to the client and opened by your team.`
                      : 'Upload the signed or designed quotation so it travels with this record.'}
                  </span>
                </span>
                <input
                  ref={input}
                  type="file"
                  accept="application/pdf,image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void upload(file, chosen.id);
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  {busy ? 'Uploading…' : chosen.pdfPath ? 'Replace' : 'Upload PDF'}
                </button>
              </div>
            </Detail>

            {chosen.propertyLabel && (
              <p className="flex items-center gap-2 rounded-xl border border-border-subtle bg-bg-subtle/40 px-3 py-2.5 text-caption text-text-secondary">
                <Home className="size-4 shrink-0" aria-hidden="true" />
                Linked property: <span className="font-medium text-text-primary">{chosen.propertyLabel}</span>
              </p>
            )}
          </div>
        )
      }
    />
  );
}

/* ── 2 · Properties ──────────────────────────────────────────────────────── */

function Properties({
  items,
  chosenId,
  onPick,
  onChooseUnit,
}: {
  items: RelatedItems;
  chosenId: string | null;
  onPick: (id: string) => void;
  onChooseUnit: () => void;
}) {
  const list = items.properties;
  const chosen: RelatedProperty | undefined = list.find((p) => p.id === chosenId) ?? list[0];

  return (
    <Split
      title="Linked properties"
      count={list.length}
      action={
        <button
          type="button"
          onClick={onChooseUnit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Link property
        </button>
      }
      list={
        list.length === 0 ? (
          <Empty>
            No unit is attached to this lead. Linking one is what lets a quotation name a plot and a price rather than
            a figure typed from memory.
          </Empty>
        ) : (
          list.map((p) => (
            <Row key={p.id} chosen={p.id === chosen?.id} onClick={() => onPick(p.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">{p.label}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {p.projectName}
                  {p.linked ? ' · attached to this lead' : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-body-sm font-semibold tabular-nums text-text-primary">{money(p.basePrice)}</span>
                <span className="block text-caption text-text-secondary">
                  {p.sizeMarla ? `${p.sizeMarla} Marla` : p.kind}
                </span>
              </span>
              <Pill status={p.status} />
            </Row>
          ))
        )
      }
      detail={
        !chosen ? null : (
          <Detail title={chosen.label} subtitle={chosen.projectName ?? undefined} status={chosen.status}>
            <Facts
              rows={[
                ['Area', chosen.areaSqft ? `${chosen.areaSqft.toLocaleString('en-PK')} sq ft` : '—'],
                ['Dimensions', chosen.dimensions ?? '—'],
                ['Facing', chosen.facing ?? '—'],
                ['Road', chosen.roadWidthFt ? `${chosen.roadWidthFt} ft` : '—'],
              ]}
            />
            <div className="border-t border-border-subtle pt-2.5">
              <p className="text-caption text-text-secondary">Price</p>
              <p className="text-h3 font-semibold tabular-nums text-text-primary">{money(chosen.basePrice)}</p>
            </div>

            {/* ⚠️ THE PAYMENT PLAN IS ROWS, NOT A PICTURE. `crm_payment_stages`
                is what a quotation is built from, so what is shown here is what
                the client would be quoted. */}
            {chosen.stages.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border-subtle">
                <table className="w-full text-body-sm">
                  <thead className="bg-bg-subtle text-caption text-text-secondary">
                    <tr>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Payment plan</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Amount (PKR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.stages.map((s, i) => (
                      <tr key={`${s.label}-${i}`} className="border-t border-border-subtle">
                        <td className="px-3 py-1.5 text-text-primary">
                          {s.label}
                          {s.percentage ? <span className="text-text-secondary"> · {s.percentage}%</span> : null}
                        </td>
                        {/* ⚠️ THE STAGE'S AMOUNT IS THE WHOLE STAGE, and the plan
                            says "18 instalments". Printing the total against that
                            line reads as 2,250,000 a month — the figure somebody
                            would then repeat to a client. Divided, and labelled. */}
                        <td className="px-3 py-1.5 text-right tabular-nums text-text-primary">
                          {s.amount === null
                            ? '—'
                            : s.instalments && s.instalments > 1
                              ? `${Math.round(s.amount / s.instalments).toLocaleString('en-PK')} each`
                              : Math.round(s.amount).toLocaleString('en-PK')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Detail>
        )
      }
    />
  );
}

/* ── 3 · Appointments ────────────────────────────────────────────────────── */

function Appointments({
  items,
  chosenId,
  onPick,
  onRecordOutcome,
}: {
  items: RelatedItems;
  chosenId: string | null;
  onPick: (id: string) => void;
  onRecordOutcome: () => void;
}) {
  const list = items.appointments;
  const chosen = list.find((a) => a.id === chosenId) ?? list[0];

  return (
    <Split
      title="Appointments"
      count={list.length}
      action={
        <button
          type="button"
          onClick={onRecordOutcome}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <CalendarPlus className="size-3.5" aria-hidden="true" />
          Schedule
        </button>
      }
      list={
        list.length === 0 ? (
          <Empty>
            Nothing booked yet. Recording the outcome &ldquo;Site visit requested&rdquo; puts a visit in the diary and it
            appears here.
          </Empty>
        ) : (
          list.map((a) => (
            <Row key={a.id} chosen={a.id === chosen?.id} onClick={() => onPick(a.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {appointmentKindLabel(a.kind)}
                  {a.propertyLabel ? ` · ${a.propertyLabel}` : ''}
                </span>
                <span className="block truncate text-caption text-text-secondary">{formatWhen(a.scheduledAt)}</span>
              </span>
              <Pill status={a.status} />
            </Row>
          ))
        )
      }
      detail={
        !chosen ? null : (
          <Detail
            title={appointmentKindLabel(chosen.kind)}
            subtitle={chosen.propertyLabel ?? undefined}
            status={chosen.status}
          >
            <Facts
              rows={[
                ['When', formatWhen(chosen.scheduledAt)],
                ['Length', `${chosen.durationMinutes} minutes`],
                ['Where', chosen.location ?? '—'],
                ['With', chosen.ownerName ?? '—'],
              ]}
            />
            {chosen.notes && (
              <p className="whitespace-pre-wrap rounded-xl bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                {chosen.notes}
              </p>
            )}
            {chosen.outcome ? (
              <p className="flex items-start gap-2 rounded-xl border border-border-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                <Check className="mt-0.5 size-4 shrink-0 text-feedback-success" aria-hidden="true" />
                <span>
                  <span className="block font-medium text-text-primary">What happened</span>
                  {chosen.outcome}
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-xl border border-border-subtle bg-bg-subtle/40 px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Not written up yet. Record the outcome after the visit — a visit nobody wrote up is the commonest way a
                lead goes quiet.
              </p>
            )}
          </Detail>
        )
      }
    />
  );
}

/* ── 4 · Bookings ────────────────────────────────────────────────────────── */

function Bookings({
  lead,
  items,
  chosenId,
  onPick,
  act,
  busy,
}: {
  lead: CrmLeadRecord;
  items: RelatedItems;
  chosenId: string | null;
  onPick: (id: string) => void;
  act: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => Promise<boolean>;
  busy: boolean;
}) {
  const list = items.bookings;
  const chosen: RelatedBooking | undefined = list.find((b) => b.id === chosenId) ?? list[0];
  const [adding, setAdding] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [verified, setVerified] = React.useState('');

  const live = items.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;

  return (
    <Split
      title="Bookings"
      count={list.length}
      action={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-pressed={adding}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New booking
        </button>
      }
      list={
        <>
          {adding && (
            <div className="space-y-2 border-b border-border-subtle bg-bg-subtle/40 px-3.5 py-3">
              <p className="text-caption font-semibold text-text-primary">
                Book {live ? `against ${live.number}` : 'this lead'}
              </p>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Booking amount in PKR"
                className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What was agreed (optional)"
                className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-lg px-2.5 py-1 text-caption text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !Number(amount)}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        createBookingAction({
                          leadId: lead.id,
                          quotationId: live?.id ?? null,
                          propertyId: live?.propertyId ?? null,
                          amount: Number(amount),
                          notes,
                        }),
                      'Booking recorded.',
                    );
                    if (ok) {
                      setAdding(false);
                      setAmount('');
                      setNotes('');
                    }
                  }}
                  className="rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50"
                >
                  Record booking
                </button>
              </div>
            </div>
          )}
          {list.length === 0 && !adding ? (
            <Empty>
              No booking yet. ⚠️ A quotation does not reserve anything — a booking is what holds the unit, and it only
              counts once Finance has seen the money.
            </Empty>
          ) : (
            list.map((b) => (
              <Row key={b.id} chosen={b.id === chosen?.id} onClick={() => onPick(b.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">{b.number}</span>
                  <span className="block truncate text-caption text-text-secondary">
                    {day(b.requestedAt)}
                    {b.propertyLabel ? ` · ${b.propertyLabel}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-body-sm font-semibold tabular-nums text-text-primary">{money(b.amount)}</span>
                </span>
                <Pill status={b.status} />
              </Row>
            ))
          )}
        </>
      }
      detail={
        !chosen ? null : (
          <Detail title={chosen.number} subtitle={chosen.propertyLabel ?? undefined} status={chosen.status}>
            <Facts
              rows={[
                ['Client', lead.fullName ?? '—'],
                ['Quotation', chosen.quotationNumber ?? '—'],
                ['Booking due', money(chosen.amount)],
                ['Verified received', money(chosen.verifiedAmount)],
                ['Outstanding', money(Math.max(0, chosen.amount - chosen.verifiedAmount))],
                ['Taken by', chosen.createdByName ?? '—'],
              ]}
            />

            {/* ── Where it has got to ─────────────────────────────────── */}
            <ol className="space-y-2 border-t border-border-subtle pt-3">
              <Step done label="Booking requested" detail={day(chosen.requestedAt)} />
              <Step
                done={chosen.status === 'confirmed'}
                active={chosen.status === 'pending_verification'}
                label="Payment verification"
                detail={
                  chosen.verifiedAt
                    ? `Verified ${day(chosen.verifiedAt)}`
                    : chosen.verificationRequestedAt
                      ? 'Under review by Finance'
                      : 'Not requested yet'
                }
              />
              <Step
                done={chosen.status === 'confirmed'}
                label="Booking confirmed"
                detail={chosen.confirmedAt ? day(chosen.confirmedAt) : 'Awaiting verification'}
              />
            </ol>

            {chosen.notes && (
              <p className="whitespace-pre-wrap rounded-xl bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                {chosen.notes}
              </p>
            )}

            <p className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-caption leading-relaxed text-text-secondary"
               style={{ background: 'color-mix(in oklab, var(--channel-email) 8%, transparent)' }}>
              <Info className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--channel-email)' }} aria-hidden="true" />
              A quotation does not reserve the plot, and a pending booking cannot mark the lead Won. Only Finance can
              verify a payment.
            </p>

            {/* ── What each side may do ───────────────────────────────── */}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-3">
              {chosen.status === 'requested' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => requestBookingVerificationAction(lead.id, chosen.id), 'Sent to Finance.')}
                  className="rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                >
                  Request verification
                </button>
              )}
              {items.canVerifyPayments && chosen.status !== 'confirmed' && chosen.status !== 'cancelled' && (
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={verified}
                    onChange={(e) => setVerified(e.target.value)}
                    placeholder={String(chosen.amount)}
                    aria-label="Amount received"
                    className="w-32 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-caption tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => confirmBookingAction(lead.id, chosen.id, Number(verified || chosen.amount)),
                        'Booking confirmed.',
                      )
                    }
                    className="rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
                  >
                    Confirm booking
                  </button>
                </span>
              )}
            </div>
          </Detail>
        )
      }
    />
  );
}

function Step({ done = false, active = false, label, detail }: { done?: boolean; active?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
          done ? 'border-feedback-success bg-feedback-success text-white' : active ? 'border-feedback-warning' : 'border-border-default',
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{detail}</span>
      </span>
    </li>
  );
}

/* ── 5 · Invoices ────────────────────────────────────────────────────────── */

function Invoices({
  lead,
  items,
  chosenId,
  onPick,
  act,
  busy,
  onReload,
}: {
  lead: CrmLeadRecord;
  items: RelatedItems;
  chosenId: string | null;
  onPick: (id: string) => void;
  act: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => Promise<boolean>;
  busy: boolean;
  onReload: () => Promise<void>;
}) {
  const list = items.invoices;
  const chosen: RelatedInvoice | undefined = list.find((i) => i.id === chosenId) ?? list[0];
  const [adding, setAdding] = React.useState(false);
  const [description, setDescription] = React.useState('Booking deposit');
  const [amount, setAmount] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const [paid, setPaid] = React.useState('');

  const booking = items.bookings.find((b) => b.status !== 'cancelled') ?? null;

  /* ⚠️ THE INVOICE COMES FROM THE TERMS, NOT FROM MEMORY. Owner, 2026-09-17:
     *"he is dealing with the quotation in which the prices are mentioned, like
     50% advance or whatever the terms are, he will make sure that the invoice is
     sent."* So the plan's own stages are offered as one tap each — the figure on
     the invoice is the figure the client was quoted, not one retyped. */
  const live = items.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
  const unit =
    items.properties.find((p) => p.id === live?.propertyId) ??
    items.properties.find((p) => p.linked) ??
    items.properties[0] ??
    null;
  const terms = (unit?.stages ?? [])
    .filter((st) => st.amount !== null && st.amount > 0)
    .map((st) => {
      const each = st.instalments && st.instalments > 1 ? (st.amount as number) / st.instalments : (st.amount as number);
      return {
        label: st.instalments && st.instalments > 1 ? `${st.label} (1 of ${st.instalments})` : st.label,
        amount: Math.round(each),
        percentage: st.percentage,
      };
    });

  return (
    <Split
      title="Invoices"
      count={list.length}
      action={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-pressed={adding}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New invoice
        </button>
      }
      list={
        <>
          {adding && (
            <div className="space-y-2 border-b border-border-subtle bg-bg-subtle/40 px-3.5 py-3">
              <p className="text-caption font-semibold text-text-primary">
                {booking ? `Against ${booking.number}` : 'For this lead'}
                {live ? ` · from ${live.number}` : ''}
              </p>
              {terms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {terms.map((t) => {
                    const on = description === t.label && Number(amount) === t.amount;
                    return (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => {
                          setDescription(t.label);
                          setAmount(String(t.amount));
                        }}
                        aria-pressed={on}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-caption transition-colors',
                          on
                            ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                            : 'border-border-default text-text-secondary hover:text-text-primary',
                        )}
                      >
                        {t.label}
                        {t.percentage ? ` · ${t.percentage}%` : ''} · {money(t.amount)}
                      </button>
                    );
                  })}
                </div>
              )}
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What it is for"
                className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount in PKR"
                  className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
                />
                <input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  aria-label="Due date"
                  className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-lg px-2.5 py-1 text-caption text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !Number(amount) || !description.trim()}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        createInvoiceAction({
                          leadId: lead.id,
                          bookingId: booking?.id ?? null,
                          description,
                          amount: Number(amount),
                          dueAt: dueAt || null,
                        }),
                      'Invoice raised.',
                    );
                    if (ok) {
                      setAdding(false);
                      setAmount('');
                    }
                  }}
                  className="rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50"
                >
                  Raise invoice
                </button>
              </div>
            </div>
          )}
          {list.length === 0 && !adding ? (
            <Empty>
              Nothing invoiced yet. Raise one from the quotation&rsquo;s own terms, send it, and upload the receipt the
              client sends back — Finance approves the payment from that proof.
            </Empty>
          ) : (
            list.map((i) => (
              <Row key={i.id} chosen={i.id === chosen?.id} onClick={() => onPick(i.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">
                    {i.number} · {i.description}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {i.dueAt ? `Due ${day(i.dueAt)}` : `Issued ${day(i.issuedAt)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-body-sm font-semibold tabular-nums text-text-primary">
                  {money(i.amount)}
                </span>
                <Pill status={i.status} />
              </Row>
            ))
          )}
        </>
      }
      detail={
        !chosen ? null : (
          <Detail title={`Invoice · ${chosen.number}`} subtitle={chosen.description} status={chosen.status}>
            <Facts
              rows={[
                ['Client', lead.fullName ?? '—'],
                ['Issued', day(chosen.issuedAt)],
                ['Property', chosen.propertyLabel ?? lead.propertyLabel ?? '—'],
                ['Due', day(chosen.dueAt)],
                ['Booking', chosen.bookingNumber ?? '—'],
                ['Quotation', chosen.quotationNumber ?? '—'],
              ]}
            />

            <div className="overflow-hidden rounded-xl border border-border-subtle">
              <table className="w-full text-body-sm">
                <thead className="bg-bg-subtle text-caption text-text-secondary">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Description</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border-subtle">
                    <td className="px-3 py-1.5 text-text-primary">{chosen.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-text-primary">{money(chosen.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border-subtle px-3 py-2.5">
                <p className="text-caption text-text-secondary">Amount due</p>
                <p className="text-h3 font-semibold tabular-nums text-text-primary">
                  {money(Math.max(0, chosen.amount - chosen.paidAmount))}
                </p>
              </div>
              <div className="rounded-xl border border-border-subtle px-3 py-2.5 text-caption">
                <p className="font-semibold text-text-primary">Payment summary</p>
                <p className="mt-1 flex justify-between text-text-secondary">
                  <span>Verified received</span>
                  <span className="tabular-nums text-text-primary">{money(chosen.paidAmount)}</span>
                </p>
                <p className="flex justify-between text-text-secondary">
                  <span>Outstanding</span>
                  <span className="tabular-nums text-text-primary">{money(Math.max(0, chosen.amount - chosen.paidAmount))}</span>
                </p>
              </div>
            </div>

            {/* ── The salesperson's half ─────────────────────────────── */}
            <div className="space-y-2 border-t border-border-subtle pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-caption text-text-secondary">
                  {chosen.sentAt ? `Sent to the client on ${day(chosen.sentAt)}.` : 'Not sent to the client yet.'}
                </span>
                {!chosen.sentAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => markInvoiceSentAction(lead.id, chosen.id), 'Marked as sent.')}
                    className="rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    Mark as sent
                  </button>
                )}
              </div>

              {/* ⚠️ THE PROOF, NOT THE PAYMENT. Owner's own words: the
                  salesperson sends the invoice and uploads what the client sends
                  back; Finance then approves it. Uploading this marks nothing
                  paid — 195's trigger still owns that column. */}
              <Receipt leadId={lead.id} invoice={chosen} busy={busy} onDone={onReload} />
            </div>

            {items.canVerifyPayments ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-3">
                <input
                  type="number"
                  min={0}
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder={String(chosen.amount)}
                  aria-label="Amount received"
                  className="w-32 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-caption tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => recordInvoicePaymentAction(lead.id, chosen.id, Number(paid || chosen.amount)),
                      'Payment recorded.',
                    )
                  }
                  className="rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
                >
                  Record payment
                </button>
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                <ArrowUpRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                You raise it, send it and upload the receipt. Finance looks at the proof and approves the payment.
              </p>
            )}
          </Detail>
        )
      }
    />
  );
}

/* ── 6 · Files ───────────────────────────────────────────────────────────── */

/**
 * Everything on this lead and the shared files of its project.
 *
 * ⚠️ ONE SHELF, NOT TWO. A quotation PDF uploaded on the Quotations tab lands
 * here as well, because `crm_documents` is where the shelf, the email
 * attachments and the sequence steps all look.
 */
function Files({ items }: { items: RelatedItems }) {
  const toast = useToast();
  const list = items.files;

  const open = async (id: string) => {
    const link = await crmDocumentLinkAction(id);
    if (link.url) window.open(link.url, '_blank', 'noopener');
    else toast({ tone: 'error', text: link.error ?? 'That could not be opened.' });
  };

  if (list.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-caption leading-relaxed text-text-secondary">
        No files yet. A quotation PDF uploaded on the Quotations tab appears here, as do the project&rsquo;s shared
        brochures and price lists.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onClick={() => void open(f.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2.5 text-left transition-colors hover:bg-bg-subtle"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg text-caption font-bold text-white"
              style={{ background: f.mime.includes('pdf') ? 'var(--feedback-error)' : 'var(--accent-primary)' }}
              aria-hidden="true"
            >
              {f.mime.includes('pdf') ? 'PDF' : f.mime.split('/')[1]?.slice(0, 3).toUpperCase() || 'DOC'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-text-primary">{f.title}</span>
              <span className="block truncate text-caption text-text-secondary">
                {(f.sizeBytes / 1_048_576).toFixed(1)} MB · {day(f.createdAt)}
                {f.leadId === null ? ' · shared with the project' : ''}
              </span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The receipt on an invoice.
 *
 * ⚠️ EVIDENCE, NOT A PAYMENT — the label says so, because the two are one click
 * apart and only one of them is the salesperson's to make.
 */
function Receipt({
  leadId,
  invoice,
  busy,
  onDone,
}: {
  leadId: string;
  invoice: RelatedInvoice;
  busy: boolean;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [working, setWorking] = React.useState(false);

  const upload = async (file: File) => {
    if (working || busy) return;
    setWorking(true);
    try {
      const slot = await prepareReceiptAction(leadId, file.name, file.size);
      if (!slot.ok || !slot.url || !slot.path) {
        toast({ tone: 'error', text: slot.error ?? 'That file could not be prepared.' });
        return;
      }
      const put = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/pdf' },
        body: file,
      });
      if (!put.ok) {
        toast({ tone: 'error', text: `The upload was refused (${put.status}).` });
        return;
      }
      const saved = await attachInvoiceReceiptAction({
        leadId,
        invoiceId: invoice.id,
        path: slot.path,
        title: file.name,
        mime: file.type || 'application/pdf',
        sizeBytes: file.size,
      });
      if (!saved.ok) {
        toast({ tone: 'error', text: saved.error });
        return;
      }
      await onDone();
      toast({ tone: 'ok', text: 'Receipt uploaded — Finance can approve it now.' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
        <Paperclip className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-text-primary">
          {invoice.receiptPath ? 'Payment receipt uploaded' : 'No payment receipt yet'}
        </span>
        <span className="block text-caption text-text-secondary">
          {invoice.receiptPath
            ? `${invoice.receiptByName ? `${invoice.receiptByName} · ` : ''}${day(invoice.receiptUploadedAt)} — proof for Finance, not a payment`
            : 'Upload what the client sent back. Finance approves the payment from it.'}
        </span>
      </span>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {invoice.receiptPath && (
        <button
          type="button"
          onClick={async () => {
            const link = await invoiceReceiptLinkAction(invoice.id);
            if (link.url) window.open(link.url, '_blank', 'noopener');
            else toast({ tone: 'error', text: link.error ?? 'That could not be opened.' });
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-caption font-semibold text-text-brand transition-colors hover:bg-bg-subtle"
        >
          View
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        disabled={busy || working}
        onClick={() => input.current?.click()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
      >
        <Upload className="size-3.5" aria-hidden="true" />
        {working ? 'Uploading…' : invoice.receiptPath ? 'Replace' : 'Upload receipt'}
      </button>
    </div>
  );
}
