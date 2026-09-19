'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  User,
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  Check,
  ClipboardList,
  ExternalLink,
  FileText,
  Home,
  Info,
  Eye,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  Plus,
  PlusCircle,
  Receipt,
  Upload,
  X,
} from 'lucide-react';

import { crmDocumentLinkAction, uploadCrmDocumentAction } from '@/app/actions/crm-documents';
import { bookAppointmentAction } from '@/app/actions/crm-leads';
import {
  addPlotsFromSheetAction,
  addQuotationFromPdfAction,
  attachBookingReceiptAction,
  attachInvoicePdfAction,
  attachInvoiceReceiptAction,
  attachQuotationPdfAction,
  confirmBookingAction,
  createBookingAction,
  createInvoiceAction,
  markInvoiceSentAction,
  discardPropertySheetAction,
  discardQuotationPdfAction,
  preparePropertySheetAction,
  prepareQuotationPdfAction,
  prepareReceiptAction,
  readPropertySheetAction,
  readQuotationPdfAction,
  recordInvoicePaymentAction,
  relatedFileLinkAction,
  relatedItemsAction,
  requestBookingVerificationAction,
  requestFromManagerAction,
  rescheduleAppointmentAction,
  type RelatedBundle,
} from '@/app/actions/crm-related';
import { ChannelChoice, type Channel } from '@/components/crm/channel-choice';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import {
  AppointmentScheduler,
  OFFICE,
  snapToOffice,
  type AppointmentDraft,
} from '@/components/crm/appointment-scheduler';
import { formatWhen, fromInputValue, karachiAt, karachiParts, toInputValue } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord, CrmLeadRelated, CrmSender } from '@/lib/db/queries/crm-leads';
import type { ParsedPlot } from '@/lib/domain/crm-property-sheet';
import type {
  RelatedAppointment,
  RelatedBooking,
  RelatedInvoice,
  RelatedProperty,
  RelatedQuotation,
  RelatedFile,
} from '@/lib/db/queries/crm-related';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import { displayPhone } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RELATED ITEMS — built to the owner's five designs of 2026-09-17
 * ----------------------------------------------------------------------------
 * *"the relevant items modal… is not as equal to or the same as what I have
 * shared with you."* So this follows the designs in shape — a header naming the
 * lead, even tabs, a list with column headings on the left, the record on the
 * right, and each tab's own actions along the foot — and every figure, name and
 * file in it is a row.
 *
 * ⚠️ WHERE THE DESIGN SHOWS SOMETHING WE DO NOT HAVE, IT SAYS SO. The mock-ups
 * carry "Demo data" badges, an APPT-201 number and a tagline; none of those
 * exists here, so none is invented. A booking application nobody generates reads
 * "Not generated", and a visit reminder nobody planned reads "Not set".
 *
 * ⚠️ "ATTACH" MEANS THE CONVERSATION. Every primary button hands its file and a
 * one-line summary to the WhatsApp composer (`onAttach`), where a person still
 * reads it and presses send — nothing leaves from this dialog.
 * ========================================================================= */

/* ⚠️ FIVE TABS, as the owner drew them. A sixth "Files" tab was mine and it is
   gone: an uploaded quotation appears in Available quotations, a receipt on the
   booking or the invoice it proves — where somebody looks for it. */
export type TabKey = 'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices' | 'files';

type Tone = 'green' | 'grey' | 'amber' | 'blue' | 'red';

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'quotations', label: 'Quotations', icon: ClipboardList },
  { key: 'properties', label: 'Properties', icon: Home },
  { key: 'appointments', label: 'Appointments', icon: CalendarDays },
  { key: 'bookings', label: 'Bookings', icon: CalendarPlus },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  /* ⚠️ THE FILES WERE ALWAYS LOADED AND NEVER SHOWN. `RelatedItems.files` has
     carried this lead's documents and the project's shared ones since the dialog
     was built, and the counts strip printed how many there were — with no tab to
     open. Owner, 2026-09-19: *"The option is available but the files (PDFs) are
     not."* Exactly that. */
  { key: 'files', label: 'Files', icon: Paperclip },
];

const BLUE = 'var(--channel-email)';
const ROW_ON = 'color-mix(in oklab, var(--channel-email) 7%, var(--bg-surface))';

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `PKR ${Math.round(n).toLocaleString('en-PK')}`;
const shortDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }) : '—';
const longDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' }) : '—';
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const blockOf = (label: string | null) => label?.split(' · ')[1] ?? null;

function statusLook(status: string): { label: string; tone: Tone } {
  const map: Record<string, { label: string; tone: Tone }> = {
    approved: { label: 'Valid', tone: 'green' },
    sent: { label: 'Valid', tone: 'green' },
    pending_approval: { label: 'Awaiting approval', tone: 'amber' },
    draft: { label: 'Draft', tone: 'grey' },
    superseded: { label: 'Superseded', tone: 'grey' },
    rejected: { label: 'Rejected', tone: 'red' },
    expired: { label: 'Expired', tone: 'red' },
    available: { label: 'Available', tone: 'green' },
    reserved: { label: 'Reserved', tone: 'amber' },
    booked: { label: 'Booked', tone: 'amber' },
    sold: { label: 'Sold', tone: 'grey' },
    scheduled: { label: 'Scheduled', tone: 'blue' },
    rescheduled: { label: 'Rescheduled', tone: 'grey' },
    completed: { label: 'Completed', tone: 'grey' },
    no_show: { label: 'No show', tone: 'red' },
    requested: { label: 'Requested', tone: 'blue' },
    pending_verification: { label: 'Pending verification', tone: 'amber' },
    confirmed: { label: 'Confirmed', tone: 'green' },
    cancelled: { label: 'Cancelled', tone: 'grey' },
    unpaid: { label: 'Unpaid', tone: 'amber' },
    part_paid: { label: 'Part paid', tone: 'blue' },
    paid: { label: 'Paid', tone: 'green' },
    void: { label: 'Void', tone: 'grey' },
  };
  return map[status] ?? { label: status.replace(/_/g, ' '), tone: 'grey' };
}

const TONE: Record<Tone, string> = {
  green: 'var(--feedback-success)',
  grey: 'var(--text-secondary)',
  amber: 'var(--feedback-warning)',
  blue: 'var(--channel-email)',
  red: 'var(--feedback-error)',
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = TONE[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-caption font-medium"
      style={{
        color: c,
        borderColor: `color-mix(in oklab, ${c} 22%, transparent)`,
        background: `color-mix(in oklab, ${c} 10%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const look = statusLook(status);
  return <Pill tone={look.tone}>{look.label}</Pill>;
}

/** Everything a button hands to the conversation. */
export interface AttachPayload {
  readonly files: readonly File[];
  readonly text: string;
  /**
   * Which composer it lands in.
   *
   * ⚠️ THE PERSON CHOOSES, THE DIALOG DOES NOT ASSUME. Owner, 2026-09-18: *"it
   * shows me a channel to which I want to send it, whether from WhatsApp or
   * email."* Before this every attach went to WhatsApp, which for the leads with
   * an address and no reply on WhatsApp was the wrong channel every time.
   */
  readonly channel: Channel;
  /** Email only: the subject the letter starts with. */
  readonly subject?: string;
}

async function fileFromLink(link: { url?: string; error?: string }, name: string): Promise<File> {
  if (!link.url) throw new Error(link.error ?? 'That file could not be read.');
  const response = await fetch(link.url);
  if (!response.ok) throw new Error(`The file could not be downloaded (${response.status}).`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'application/pdf' });
}

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function RelatedItemsDialog({
  lead,
  sender,
  seed,
  initialTab = 'quotations',
  onClose,
  onChooseUnit,
  onRecordOutcome,
  onAttach,
}: {
  lead: CrmLeadRecord;
  /** The WhatsApp business name and number the client sees (179). */
  sender: CrmSender | null;
  /**
   * What the drawer already holds — quotations, the linked unit, appointments.
   *
   * ⚠️ SO THE DIALOG IS DRAWN IN THE FRAME IT OPENS. Owner, 2026-09-17: *"the
   * related item modal, when opened, is taking a lot of time to load."* It was
   * waiting on its own round trip for rows the drawer had already read. Now that
   * read only fills in what the drawer could not know — bookings, invoices, the
   * payment plan — underneath a screen that is already up (Rule Zero, law 3).
   */
  seed?: RelatedBundle;
  initialTab?: TabKey;
  onClose: () => void;
  onChooseUnit: () => void;
  onRecordOutcome: () => void;
  /** Hand files and a line of text to the WhatsApp composer. */
  onAttach: (payload: AttachPayload) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const [items, setItems] = React.useState<RelatedBundle | null>(seed ?? null);
  const [loading, setLoading] = React.useState(true);
  const [picked, setPicked] = React.useState<Partial<Record<TabKey, string>>>({});
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const next = await relatedItemsAction(lead.id);
    if (next) setItems(next);
  }, [lead.id]);

  React.useEffect(() => {
    let alive = true;
    void relatedItemsAction(lead.id).then((next) => {
      if (!alive) return;
      if (next) setItems(next);
      setLoading(false);
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

  /** Every write: act, re-read, and report in the server's own words. */
  const act = React.useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
      if (busy) return false;
      setBusy(true);
      try {
        const result = await fn();
        if (!result.ok) {
          toast({ tone: 'error', text: result.error ?? 'That did not save.' });
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
    },
    [busy, load, toast],
  );

  /** Upload one file straight to storage, then record where it went. */
  const upload = React.useCallback(
    async (
      file: File,
      prepare: (leadId: string, name: string, size: number) => Promise<{ ok: boolean; path?: string; url?: string; error?: string }>,
      save: (path: string) => Promise<{ ok: boolean; error?: string }>,
      done: string,
    ) => {
      if (busy) return;
      setBusy(true);
      try {
        const slot = await prepare(lead.id, file.name, file.size);
        if (!slot.ok || !slot.url || !slot.path) {
          toast({ tone: 'error', text: slot.error ?? 'That file could not be prepared.' });
          return;
        }
        /* ⚠️ STRAIGHT TO STORAGE. A server action refuses a body over 4.5 MB. */
        const put = await fetch(slot.url, {
          method: 'PUT',
          headers: { 'content-type': file.type || 'application/pdf' },
          body: file,
        });
        if (!put.ok) {
          toast({ tone: 'error', text: `The upload was refused (${put.status}).` });
          return;
        }
        const saved = await save(slot.path);
        if (!saved.ok) {
          toast({ tone: 'error', text: saved.error ?? 'That file could not be attached.' });
          return;
        }
        await load();
        toast({ tone: 'ok', text: done });
      } catch {
        toast({ tone: 'error', text: 'The upload did not finish — the connection dropped.' });
      } finally {
        setBusy(false);
      }
    },
    [busy, lead.id, load, toast],
  );

  /**
   * What is waiting on a channel, if anything.
   *
   * ⚠️ INSIDE THE DIALOG, NOT OVER IT. The chooser is `absolute inset-0` within
   * this panel, so the Related items header and tabs stay put and the dialog's
   * fixed height does not move — the owner's first rule about this modal.
   */
  const [choosing, setChoosing] = React.useState<null | {
    title: string;
    summary: string;
    files: number;
    build: (channel: Channel) => Promise<AttachPayload | null>;
  }>(null);

  const attachVia = React.useCallback(
    (
      what: { title: string; summary: string; files: number },
      build: (channel: Channel) => Promise<AttachPayload | null>,
    ) => setChoosing({ ...what, build }),
    [],
  );

  const go = (next: TabKey, id?: string | null) => {
    setTab(next);
    if (id) setPicked((p) => ({ ...p, [next]: id }));
  };
  const pick = (key: TabKey) => (id: string) => setPicked((p) => ({ ...p, [key]: id }));

  const where = [lead.projectName, lead.city].filter(Boolean).join(' · ');
  const ctx: Ctx | null = items
    ? { lead, items, sender, where, busy, loading, act, upload, go, onClose, onAttach, attachVia, toast }
    : null;

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
        className="relative flex h-[min(48rem,94vh)] w-full max-w-[70rem] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        {/* ⚠️ THE LEAD'S HEADER, NOT THE BUSINESS'S. The owner's reference puts a
            plain avatar here with the client's own line under the title — the
            business mark and name belong in the QUOTATION PREVIEW, where the
            client sees them, and that is where *"the header logo and the name
            should display right"* was about. Putting them up here as well made
            this dialog look like it was addressed to us. */}
        <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-secondary">
            <User className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h3 font-semibold text-text-primary">Related items</h2>
            <p className="truncate text-body-sm text-text-secondary">
              {[lead.fullName ?? 'This lead', lead.projectName, lead.city].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {/* ⚠️ THE OPEN TAB HAS TO BE OBVIOUS. Owner, 2026-09-17: *"the open tab is
            not visible… there is a gap between the Quotation, Properties and
            Appointment tabs."* So: gaps between the tabs, the brand teal on the
            live one, and a 3px bar under it. */}
        <div role="tablist" aria-label="Related items" className="flex shrink-0 gap-2 border-b border-border-subtle px-4 sm:gap-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-3.5 text-body transition-colors',
                tab === t.key
                  ? 'font-semibold text-accent-primary'
                  : 'font-medium text-text-secondary hover:text-text-primary',
              )}
            >
              <t.icon className="size-5 shrink-0" />
              <span className="truncate">{t.label}</span>
              {tab === t.key && (
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent-primary" />
              )}
            </button>
          ))}
        </div>

        {choosing && (
          <ChannelChoice
            title={choosing.title}
            summary={choosing.summary}
            fileCount={choosing.files}
            phone={lead.phone}
            email={lead.email}
            senderName={sender?.displayName ?? lead.projectName}
            busy={busy}
            onCancel={() => setChoosing(null)}
            onPick={async (channel) => {
              setBusy(true);
              try {
                const payload = await choosing.build(channel);
                if (payload) {
                  setChoosing(null);
                  onAttach(payload);
                }
              } catch (e) {
                toast({ tone: 'error', text: e instanceof Error ? e.message : 'That could not be attached.' });
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {loading && (
          <p className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-subtle/40 px-6 py-1.5 text-caption text-text-secondary">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Reading the rest of this lead&rsquo;s records…
          </p>
        )}

        {!ctx ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-text-secondary">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Reading this lead&rsquo;s records…
          </div>
        ) : tab === 'quotations' ? (
          <QuotationsTab ctx={ctx} pickedId={picked.quotations} onPick={pick('quotations')} />
        ) : tab === 'properties' ? (
          <PropertiesTab ctx={ctx} pickedId={picked.properties} onPick={pick('properties')} onChooseUnit={onChooseUnit} />
        ) : tab === 'appointments' ? (
          <AppointmentsTab ctx={ctx} pickedId={picked.appointments} onPick={pick('appointments')} onRecordOutcome={onRecordOutcome} />
        ) : tab === 'bookings' ? (
          <BookingsTab ctx={ctx} pickedId={picked.bookings} onPick={pick('bookings')} />
        ) : tab === 'invoices' ? (
          <InvoicesTab ctx={ctx} pickedId={picked.invoices} onPick={pick('invoices')} />
        ) : (
          <FilesTab ctx={ctx} pickedId={picked.files} onPick={pick('files')} />
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

interface Ctx {
  lead: CrmLeadRecord;
  items: RelatedBundle;
  sender: CrmSender | null;
  where: string;
  busy: boolean;
  act: (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => Promise<boolean>;
  upload: (
    file: File,
    prepare: (leadId: string, name: string, size: number) => Promise<{ ok: boolean; path?: string; url?: string; error?: string }>,
    save: (path: string) => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) => Promise<void>;
  /**
   * True while the full read is still in flight behind a seeded screen.
   *
   * ⚠️ AN EMPTY LIST IS NOT THE SAME AS "NOTHING HERE". Rule Zero, law 3: *"No
   * notes yet while notes are in flight is a lie somebody will act on."* The
   * dialog opens on what the drawer already had, so bookings and invoices are
   * genuinely unknown for a moment — and they say so rather than showing none.
   */
  loading: boolean;
  go: (tab: TabKey, id?: string | null) => void;
  onClose: () => void;
  onAttach: (payload: AttachPayload) => void;
  /**
   * Ask which channel, then build the payload for the one chosen.
   *
   * ⚠️ THE FILES ARE FETCHED AFTER THE CHOICE, not before. A PDF downloaded for a
   * channel nobody picked is a signed-URL round trip spent on nothing — and on
   * Email the attachment is uploaded again by the composer, so doing it eagerly
   * would cost two.
   */
  attachVia: (
    what: { title: string; summary: string; files: number },
    build: (channel: Channel) => Promise<AttachPayload | null>,
  ) => void;
  toast: ReturnType<typeof useToast>;
}

/* ── The frame every tab shares ──────────────────────────────────────────── */

function Body({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pt-4 lg:grid-cols-[1.12fr_1fr] lg:overflow-hidden">
      <section className="flex min-h-[16rem] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
        {list}
      </section>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
        {detail}
      </section>
    </div>
  );
}

function Foot({ left, note, right }: { left?: React.ReactNode; note?: React.ReactNode; right: React.ReactNode }) {
  return (
    <footer className="flex shrink-0 flex-wrap items-end justify-between gap-3 px-6 py-4">
      <div className="min-w-0">{left}</div>
      {note && <p className="hidden min-w-0 flex-1 text-center text-caption text-text-secondary xl:block">{note}</p>}
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </footer>
  );
}

function ListHead({ title, count, action }: { title: string; count: number; action?: React.ReactNode }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
      <h3 className="text-body font-semibold text-text-primary">
        {title} ({count})
      </h3>
      {action}
    </header>
  );
}

function Columns({ template, labels }: { template: string; labels: readonly string[] }) {
  return (
    <div
      className="grid shrink-0 items-center gap-4 border-b border-border-subtle bg-bg-subtle/50 px-5 py-2.5 text-caption text-text-secondary"
      style={{ gridTemplateColumns: template }}
    >
      <span />
      {labels.map((l) => (
        <span key={l} className="truncate">
          {l}
        </span>
      ))}
    </div>
  );
}

function ListRow({
  template,
  chosen,
  onClick,
  children,
}: {
  template: string;
  chosen: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className="grid w-full items-center gap-4 border-b border-border-subtle px-5 py-3.5 text-left transition-colors hover:bg-bg-subtle/60"
      style={{ gridTemplateColumns: template, background: chosen ? ROW_ON : undefined }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-[18px] place-items-center rounded-full border-2',
          chosen ? 'border-accent-primary' : 'border-border-default',
        )}
      >
        {chosen && <span className="size-2 rounded-full bg-accent-primary" />}
      </span>
      {children}
    </button>
  );
}

function Two({ top, bottom, blue = false }: { top: React.ReactNode; bottom?: React.ReactNode; blue?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-body-sm font-semibold" style={{ color: blue ? BLUE : 'var(--text-primary)' }}>
        {top}
      </span>
      {bottom && <span className="block truncate text-caption text-text-secondary">{bottom}</span>}
    </span>
  );
}

function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="max-w-sm text-caption leading-relaxed text-text-secondary">{children}</p>
      {action}
    </div>
  );
}

/** `Empty`, except that it does not claim emptiness while the read is running. */
function EmptyList({ loading, children, action }: { loading: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 px-6 py-10 text-caption text-text-secondary">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Reading this lead&rsquo;s records…
      </div>
    );
  }
  return <Empty action={action}>{children}</Empty>;
}

function DetailHead({ title, onOpen }: { title: string; onOpen?: () => void }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
      <h3 className="text-body font-semibold text-text-primary">{title}</h3>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 text-body-sm font-medium hover:underline"
          style={{ color: BLUE }}
        >
          Open
          <ExternalLink className="size-4" aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">{children}</div>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-border-subtle bg-bg-surface', className)}>{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-caption text-text-secondary">{children}</p>;
}

function LinkText({ onClick, children, icon = 'up' }: { onClick: () => void; children: React.ReactNode; icon?: 'up' | 'right' | 'ext' | 'upload' }) {
  const Icon = icon === 'right' ? ArrowRight : icon === 'ext' ? ExternalLink : icon === 'upload' ? Upload : ArrowUpRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1 truncate text-body-sm font-medium hover:underline"
      style={{ color: BLUE }}
    >
      <span className="truncate">{children}</span>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

function IconTile({ children, tint = 'var(--accent-primary)' }: { children: React.ReactNode; tint?: string }) {
  return (
    <span
      className="grid size-11 shrink-0 place-items-center rounded-xl"
      style={{ background: `color-mix(in oklab, ${tint} 12%, transparent)`, color: tint }}
    >
      {children}
    </span>
  );
}

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-accent-primary' : 'bg-border-default',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function OutlineBlue({ icon: Icon, onClick, disabled, children }: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-body-sm font-medium transition-colors hover:bg-bg-subtle disabled:opacity-50"
      style={{ color: BLUE, borderColor: `color-mix(in oklab, ${BLUE} 45%, transparent)` }}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function Btn({ primary = false, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-lg px-5 text-body-sm font-semibold transition-colors disabled:opacity-50',
        primary
          ? 'bg-accent-primary text-white hover:opacity-90'
          : 'border border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle',
      )}
    >
      {children}
    </button>
  );
}

function HiddenFile({ inputRef, onFile, accept = 'application/pdf,image/*' }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
  accept?: string;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
}

/** A small sheet over the foot of the dialog, for the few things that need typing. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-6 bottom-20 z-10 rounded-xl border border-border-default bg-bg-surface p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-body-sm font-semibold text-text-primary">{title}</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}

const field =
  'w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none';

/* --- What the drawer already knows ------------------------------------------
 * Owner, 2026-09-17: *"the related item modal, when opened, is taking a lot of
 * time to load and show anything… these things should be instantly opening."*
 *
 * The drawer has already read this lead's quotations and appointments — Rule Zero
 * law 3 says do not fetch them again to draw the same rows. This turns what it
 * holds into the bundle the dialog draws in the frame it opens, and the full read
 * lands underneath with the bookings, invoices and payment plans the drawer
 * deliberately does not carry.
 *
 * ⚠️ WHAT IS NOT HERE IS MARKED UNKNOWN, NOT EMPTY. `ctx.loading` is what keeps
 * an un-read tab saying "reading" instead of "none" — see `EmptyList`.
 * ========================================================================= */

export function seedRelated(lead: CrmLeadRecord, related: CrmLeadRelated): RelatedBundle {
  return {
    quotations: related.quotations.map((q) => ({
      id: q.id,
      number: q.number,
      version: q.version,
      status: q.status,
      netAmount: q.netAmount,
      /* The drawer's row does not carry the breakdown, and nothing on the screen
         shows it before the full read arrives. */
      basePrice: q.netAmount,
      requestedDiscount: q.requestedDiscount,
      approvedDiscount: q.approvedDiscount,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
      sentAt: null,
      pdfPath: q.pdfPath ?? null,
      propertyId: null,
      propertyLabel: q.propertyLabel,
      propertyTitle: null,
      preparedByName: q.preparedByName,
      terms: null,
    })),
    properties: [],
    appointments: related.appointments.map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      scheduledAt: a.scheduledAt,
      durationMinutes: a.durationMinutes,
      location: a.location,
      notes: null,
      outcome: a.outcome,
      ownerName: a.ownerName,
      propertyId: lead.propertyId ?? null,
      propertyLabel: null,
    })),
    bookings: [],
    invoices: [],
    files: [],
    visitReminderAt: null,
    canVerifyPayments: false,
    senderEmail: null,
  };
}

/* --- The quotation PDF picker -----------------------------------------------
 * Owner, 2026-09-17: *"it will pop up a modal where we can select any PDF. That
 * PDF will be automatically selected and we just put the name of that PDF. It
 * will be displayed here in the available quotation files… read that PDF and get
 * the quotation name… the property, Marla, block… plus its amount. If you don't
 * get these things from the quotation, you will show a message that the PDF is
 * not showing this information."*
 *
 * ⚠️ THE FILE IS READ BEFORE ANYTHING IS ADDED. What the reading found is on the
 * screen, next to the name, before the button that writes the row is live. A
 * quotation added first and checked later is a price on a client's record that
 * nobody agreed to.
 * ========================================================================= */

type PickPhase = 'pick' | 'working' | 'read' | 'refused';

function QuotationPdfPicker({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { lead } = ctx;
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [phase, setPhase] = React.useState<PickPhase>('pick');
  const [step, setStep] = React.useState('');
  const [error, setError] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [path, setPath] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [found, setFound] = React.useState<{
    number?: string;
    amount?: number;
    unitHint?: string;
    validUntil?: string | null;
  }>({});

  const take = async (picked: File) => {
    setFile(picked);
    setTitle(picked.name.replace(/\.pdf$/i, ''));
    setPhase('working');
    setError('');
    try {
      setStep('Uploading the file…');
      const slot = await prepareQuotationPdfAction(lead.id, picked.name, picked.size);
      if (!slot.ok || !slot.url || !slot.path) {
        setPhase('refused');
        setError(slot.error ?? 'That file could not be prepared.');
        return;
      }
      /* ⚠️ STRAIGHT TO STORAGE — a server action refuses a body over 4.5 MB. */
      const put = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'content-type': picked.type || 'application/pdf' },
        body: picked,
      });
      if (!put.ok) {
        setPhase('refused');
        setError(`The upload was refused (${put.status}).`);
        return;
      }
      setPath(slot.path);
      setStep('Reading the quotation…');
      const reading = await readQuotationPdfAction(lead.id, slot.path);
      if (!reading.ok) {
        setPhase('refused');
        setError(reading.error ?? 'That PDF could not be read.');
        /* Nothing points at it, so it does not stay in the bucket. */
        /* Nothing is waiting on this, and a failed tidy-up must not become an
           unhandled rejection in the middle of a refusal message. */
        void discardQuotationPdfAction(lead.id, slot.path).catch(() => {});
        setPath('');
        return;
      }
      setFound({
        number: reading.number,
        amount: reading.amount,
        unitHint: reading.unitHint,
        validUntil: reading.validUntil,
      });
      setPhase('read');
    } catch {
      setPhase('refused');
      setError('The upload did not finish — the connection dropped.');
    } finally {
      setStep('');
    }
  };

  const reset = () => {
    if (path) void discardQuotationPdfAction(lead.id, path).catch(() => {});
    setPhase('pick');
    setError('');
    setFile(null);
    setPath('');
    setFound({});
  };

  const add = async () => {
    if (!file || !path) return;
    const ok = await ctx.act(
      () =>
        addQuotationFromPdfAction({
          leadId: lead.id,
          path,
          title: title.trim() || file.name,
          mime: file.type || 'application/pdf',
          sizeBytes: file.size,
        }),
      `${found.number ?? 'The quotation'} added to available quotations.`,
    );
    if (ok) onClose();
  };

  return (
    <Sheet title="Add a quotation PDF" onClose={onClose}>
      {phase === 'pick' && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-default px-4 py-6 text-center transition-colors hover:bg-bg-subtle"
          >
            <span
              className="grid size-10 place-items-center rounded-full"
              style={{ background: `color-mix(in oklab, ${BLUE} 12%, transparent)`, color: BLUE }}
            >
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <span className="text-body-sm font-semibold text-text-primary">Choose a quotation PDF</span>
            <span className="text-caption text-text-secondary">
              Its quotation number, property and amount are read from the file — nothing is typed in by hand.
            </span>
          </button>
          <HiddenFile inputRef={fileRef} accept="application/pdf" onFile={(f) => void take(f)} />
        </>
      )}

      {phase === 'working' && (
        <p className="flex items-center gap-2 px-1 py-6 text-body-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {step || 'Working…'}
          <span className="truncate text-caption text-text-tertiary">{file?.name}</span>
        </p>
      )}

      {phase === 'refused' && (
        <>
          <div
            className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
            style={{
              borderColor: 'color-mix(in oklab, #d92d20 35%, transparent)',
              background: 'color-mix(in oklab, #d92d20 7%, transparent)',
            }}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: '#d92d20' }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-text-primary">This PDF cannot be added</p>
              <p className="mt-0.5 text-caption text-text-secondary">{error}</p>
              {file && <p className="mt-1 truncate text-caption text-text-tertiary">{file.name}</p>}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={onClose}>Close</Btn>
            <Btn primary onClick={reset}>
              Choose another PDF
            </Btn>
          </div>
        </>
      )}

      {phase === 'read' && (
        <>
          <label className="block">
            <span className="text-caption text-text-secondary">Name it</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              className={cn(field, 'mt-1')}
            />
          </label>
          {/* ⚠️ WHAT THE FILE SAID, not what anybody would like it to say. */}
          <div className="mt-3 rounded-xl border border-border-subtle bg-bg-subtle/40 p-3">
            <p className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
              <Check className="size-3.5" style={{ color: WA_GREEN }} aria-hidden="true" />
              Read from this PDF
            </p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              {[
                { k: 'Quotation', v: found.number ?? '—' },
                { k: 'Property', v: found.unitHint || '—' },
                { k: 'Amount', v: found.amount !== undefined ? money(found.amount) : '—' },
              ].map((r) => (
                <div key={r.k} className="min-w-0">
                  <dt className="text-caption text-text-secondary">{r.k}</dt>
                  <dd className="truncate text-body-sm font-semibold text-text-primary">{r.v}</dd>
                </div>
              ))}
            </dl>
            {found.validUntil && (
              <p className="mt-2 text-caption text-text-secondary">Valid until {shortDay(found.validUntil)}</p>
            )}
          </div>
          <p className="mt-2 text-caption text-text-secondary">
            It is added as a draft against this lead, and the plot is matched inside {lead.projectName} where the
            catalogue has it.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={reset}>Choose another</Btn>
            <Btn primary disabled={ctx.busy} onClick={() => void add()}>
              Add to available quotations
            </Btn>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ── 1 · Quotations ──────────────────────────────────────────────────────── */

/* ⚠️ A PRICE AND A PILL ARE SIZED BY THEIR CONTENT, never by a fraction of the
   pane. Owner, 2026-09-18: *"the properties in the appointment booking table are
   very congested with one another."* Given `1fr`, "PKR 4,500,000" lost its last
   digits to an ellipsis while the name column next to it had room to spare.
   `minmax(0,max-content)` gives the number exactly what it needs and hands the
   rest to the text columns — and it still cannot hold the table open, which is
   what `auto` does (`truncate-in-auto-tables` in the notes). */
const MONEY_COL = 'minmax(0,max-content)';
const Q_COLS = `18px minmax(0,0.95fr) minmax(0,1.5fr) ${MONEY_COL} ${MONEY_COL}`;

function QuotationsTab({ ctx, pickedId, onPick }: { ctx: Ctx; pickedId?: string; onPick: (id: string) => void }) {
  const { lead, items, sender, busy } = ctx;
  const list = items.quotations;
  const chosen: RelatedQuotation | undefined =
    list.find((q) => q.id === pickedId) ??
    list.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ??
    list[0];
  const [attachPdf, setAttachPdf] = React.useState(true);
  const [asking, setAsking] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [note, setNote] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const unit = items.properties.find((p) => p.id === chosen?.propertyId) ?? null;
  /* ⚠️ A QUOTATION READ OUT OF A PDF MAY NAME A PLOT THIS PROJECT HAS NOT GOT.
     The catalogue is not extended to match a document (see `createQuotationFromPdf`),
     so what the file said is kept in the terms and shown here — "—" against a
     quotation whose own PDF names a unit would look like missing data. */
  const quotedUnit = (q: RelatedQuotation) => /Property as quoted: ([^\n.]+)/.exec(q.terms ?? '')?.[1]?.trim() ?? null;
  const unitName = (q: RelatedQuotation) =>
    [q.propertyTitle, blockOf(q.propertyLabel)].filter(Boolean).join(' · ') || q.propertyLabel || quotedUnit(q) || '—';

  /**
   * Ask which channel, then build the message for it.
   *
   * ⚠️ THE WORDING IS NOT THE SAME ON BOTH. A WhatsApp message is one line a
   * salesperson would type; an email is a letter with a subject and a greeting.
   * Sending the chat line as an email body, which is what one shared string would
   * do, is how an email ends up looking like a text message.
   */
  const attach = () => {
    if (!chosen) return;
    const unit = unitName(chosen);
    const amount = money(chosen.netAmount);
    const valid = chosen.validUntil ? longDay(chosen.validUntil) : null;
    const withPdf = attachPdf && !!chosen.pdfPath;

    ctx.attachVia(
      {
        title: 'Send this quotation',
        summary: `${chosen.number} · ${unit} · ${amount}`,
        files: withPdf ? 1 : 0,
      },
      async (channel) => {
        const files = withPdf
          ? [await fileFromLink(await relatedFileLinkAction('quotation_pdf', chosen.id), `${chosen.number}.pdf`)]
          : [];

        if (channel === 'whatsapp') {
          return {
            channel,
            files,
            text: `Quotation ${chosen.number} for ${unit}: ${amount}${valid ? `, valid until ${valid}` : ''}.`,
          };
        }
        return {
          channel,
          files,
          subject: `Quotation ${chosen.number} — ${unit}`,
          text: [
            `Assalam-o-Alaikum ${(lead.fullName ?? '').split(' ')[0] || 'Sir/Madam'}.`,
            '',
            `Please find our quotation ${chosen.number} for ${unit}.`,
            '',
            `Quotation amount: ${amount}${valid ? `\nValid until: ${valid}` : ''}`,
            '',
            withPdf
              ? 'The full quotation is attached. Please let me know if you would like to discuss anything on it.'
              : 'Please let me know if you would like to discuss anything on it.',
          ].join('\n'),
        };
      },
    );
  };

  const openPdf = async () => {
    if (!chosen) return;
    const link = await relatedFileLinkAction('quotation_pdf', chosen.id);
    if (link.url) window.open(link.url, '_blank', 'noopener');
    else ctx.toast({ tone: 'error', text: link.error ?? 'That could not be opened.' });
  };

  return (
    <>
      <Body
        list={
          <>
            <ListHead
              title="Available quotations"
              count={list.length}
              action={
                <LinkText icon="upload" onClick={() => setAdding(true)}>
                  Add PDF
                </LinkText>
              }
            />
            {list.length === 0 ? (
              <EmptyList loading={ctx.loading}>
                No quotation has been raised for this lead yet. Raise one from the drawer, or add the quotation PDF you
                already sent — its number, property and amount are read out of the file.
              </EmptyList>
            ) : (
              <>
                <Columns template={Q_COLS} labels={['Quotation', 'Property', 'Amount', 'Status']} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {list.map((q) => (
                    <ListRow key={q.id} template={Q_COLS} chosen={q.id === chosen?.id} onClick={() => onPick(q.id)}>
                      <Two top={`${q.number}${q.version > 1 ? ` v${q.version}` : ''}`} bottom={shortDay(q.createdAt)} />
                      <Two top={unitName(q)} bottom={lead.projectName} />
                      <span className="truncate text-body-sm tabular-nums text-text-primary">{money(q.netAmount)}</span>
                      <StatusPill status={q.status} />
                    </ListRow>
                  ))}
                </div>
              </>
            )}
          </>
        }
        detail={
          !chosen ? (
            <EmptyList loading={ctx.loading}>Nothing to preview yet.</EmptyList>
          ) : (
            <>
              <DetailHead title="Quotation preview" onOpen={chosen.pdfPath ? () => void openPdf() : undefined} />
              <Scroll>
                {/* ⚠️ THE LETTER, AS THE CLIENT RECEIVES IT — the business's own
                    mark and name, the real sending address and WhatsApp number. */}
                <Card className="p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/cni-ai-digital-division.png" alt="" className="size-11 shrink-0 object-contain" />
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-text-primary">
                          {sender?.displayName ?? lead.projectName}
                        </p>
                        {/* The line under the mark in the owner's reference. */}
                        <p className="truncate text-caption text-text-secondary">
                          Smarter conversations. Stronger business.
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-caption text-text-secondary">Quotation</p>
                      <p className="text-h3 font-semibold text-text-primary">{chosen.number}</p>
                      <p className="text-caption text-text-secondary">{shortDay(chosen.createdAt)}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 border-t border-border-subtle pt-3">
                    <div className="min-w-0 pr-3">
                      <Label>Client</Label>
                      <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? '—'}</p>
                      <p className="truncate text-caption text-text-secondary">{lead.projectName}</p>
                      {lead.city && <p className="truncate text-caption text-text-secondary">{lead.city}</p>}
                    </div>
                    <div className="min-w-0 border-l border-border-subtle pl-3">
                      <Label>Property</Label>
                      <p className="truncate text-body-sm font-semibold text-text-primary">{unitName(chosen)}</p>
                      <p className="truncate text-caption text-text-secondary">{lead.projectName}</p>
                      {lead.city && <p className="truncate text-caption text-text-secondary">{lead.city}</p>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <Label>Quotation amount</Label>
                    <p className="text-[1.6rem] font-bold leading-tight tabular-nums text-text-primary">
                      {money(chosen.netAmount)}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {chosen.validUntil ? `Valid until ${shortDay(chosen.validUntil)}` : 'Open-ended'}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-t border-border-subtle pt-3">
                    <div className="min-w-0">
                      <p className="truncate text-caption font-semibold text-text-primary">
                        {sender?.displayName ?? lead.projectName}
                      </p>
                      {items.senderEmail && <p className="truncate text-caption text-text-secondary">{items.senderEmail}</p>}
                    </div>
                    {sender?.displayNumber && (
                      <p className="flex items-center gap-2 text-caption text-text-primary">
                        <span style={{ color: WA_GREEN }}>
                          <WhatsAppMark className="size-5" />
                        </span>
                        {displayPhone(sender.displayNumber)}
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="flex items-center gap-3 px-4 py-3">
                  <IconTile tint="var(--text-secondary)">
                    <FileText className="size-5" aria-hidden="true" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-text-primary">Attach quotation PDF</p>
                    <p className="text-caption text-text-secondary">
                      {chosen.pdfPath
                        ? attachPdf
                          ? `${chosen.number} will be attached to your message.`
                          : 'Only the summary line will be sent.'
                        : 'No PDF on this quotation yet — upload it to attach it.'}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                      className="mt-0.5 inline-flex items-center gap-1 text-caption font-medium hover:underline disabled:opacity-50"
                      style={{ color: BLUE }}
                    >
                      <Upload className="size-3.5" aria-hidden="true" />
                      {busy ? 'Uploading…' : chosen.pdfPath ? 'Replace PDF' : 'Upload PDF'}
                    </button>
                    <HiddenFile
                      inputRef={fileRef}
                      onFile={(f) =>
                        void ctx.upload(
                          f,
                          prepareQuotationPdfAction,
                          (path) =>
                            attachQuotationPdfAction({
                              leadId: lead.id,
                              quotationId: chosen.id,
                              path,
                              title: f.name,
                              mime: f.type || 'application/pdf',
                              sizeBytes: f.size,
                            }),
                          'Quotation PDF attached.',
                        )
                      }
                    />
                  </div>
                  <Toggle on={attachPdf && !!chosen.pdfPath} disabled={!chosen.pdfPath} onChange={setAttachPdf} label="Attach quotation PDF" />
                </Card>

                <Card className="flex items-center gap-3 px-4 py-3">
                  <IconTile tint={BLUE}>
                    <Home className="size-5" aria-hidden="true" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-caption text-text-secondary">Linked property</p>
                    <p className="truncate text-body-sm font-semibold text-text-primary">{unitName(chosen)}</p>
                    <p className="truncate text-caption text-text-secondary">{ctx.where}</p>
                  </div>
                  {unit && (
                    <LinkText icon="right" onClick={() => ctx.go('properties', unit.id)}>
                      View property
                    </LinkText>
                  )}
                </Card>
              </Scroll>
            </>
          )
        }
      />
      <Foot
        left={
          <div>
            <OutlineBlue icon={MessageSquareText} onClick={() => setAsking(true)} disabled={!chosen}>
              Request updated quote
            </OutlineBlue>
            <p className="mt-1 pl-1 text-caption text-text-secondary">Ask for a revised quotation from the team.</p>
          </div>
        }
        right={
          <>
            {/* ⚠️ CANCEL AND ATTACH, EXACTLY AS THE REFERENCE DRAWS THEM. Uploading
                a PDF is not a footer action — it lives on the list itself, next to
                the quotations it adds to. */}
            <Btn onClick={ctx.onClose}>Cancel</Btn>
            <Btn primary disabled={!chosen || busy} onClick={() => void attach()}>
              Attach selected quote
            </Btn>
          </>
        }
      />
      {adding && <QuotationPdfPicker ctx={ctx} onClose={() => setAdding(false)} />}
      {asking && chosen && (
        <Sheet title={`Request an updated quotation · ${chosen.number}`} onClose={() => setAsking(false)}>
          <textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="What should change? e.g. the client asked for a longer payment plan."
            className={field}
          />
          <p className="mt-1.5 text-caption text-text-secondary">
            Goes to your sales manager, and is kept as a note on this lead.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setAsking(false)}>Cancel</Btn>
            <Btn
              primary
              disabled={busy || !note.trim()}
              onClick={async () => {
                /* ⚠️ IT SAYS WHAT ACTUALLY HAPPENED. Owner, 2026-09-18: *"I
                   receive a notification that the quotation is sent, while I see
                   in the sales manager dashboard that no quotation is received."*
                   The old message claimed delivery flatly — so it read the same
                   whether one manager was told, three were, or nobody was. */
                const result = await requestFromManagerAction({
                  leadId: lead.id,
                  kind: 'quote',
                  subject: chosen.number,
                  note,
                });
                if (!result.ok) {
                  ctx.toast({ tone: 'error', text: result.error ?? 'That request did not send.' });
                  return;
                }
                const n = result.recipients ?? 0;
                ctx.toast({
                  tone: 'ok',
                  text:
                    result.queued === 0
                      ? 'Already on their list — they have this request.'
                      : `On the list of ${n} ${n === 1 ? 'manager' : 'managers'}, and they have been notified.`,
                });
                setAsking(false);
                setNote('');
              }}
            >
              Send request
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}

/* --- The property sheet picker ----------------------------------------------
 * Owner, 2026-09-17: *"when the property sheet is uploaded and it has multiple
 * plots and multiple data on it, then you will add each plot with you in this
 * way."*
 *
 * So one upload lists every plot it found, and each one is a row somebody can
 * tick. The parsing is in `lib/domain/crm-property-sheet.ts` and tested there.
 *
 * ⚠️ THE CATALOGUE IS THE PROJECT MANAGER'S (150). A salesperson sees what the
 * sheet says and is told who can add it, rather than being handed a button that
 * fails on submit.
 * ========================================================================= */

function PropertySheetPicker({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { lead } = ctx;
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [phase, setPhase] = React.useState<PickPhase>('pick');
  const [step, setStep] = React.useState('');
  const [error, setError] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [path, setPath] = React.useState('');
  const [plots, setPlots] = React.useState<readonly ParsedPlot[]>([]);
  const [existing, setExisting] = React.useState<readonly string[]>([]);
  const [canAdd, setCanAdd] = React.useState(false);
  const [chosen, setChosen] = React.useState<readonly string[]>([]);

  const isNew = (code: string) => !existing.includes(code.trim().toLowerCase());

  const take = async (picked: File) => {
    setFile(picked);
    setPhase('working');
    setError('');
    try {
      setStep('Uploading the sheet…');
      const slot = await preparePropertySheetAction(lead.id, picked.name, picked.size);
      if (!slot.ok || !slot.url || !slot.path) {
        setPhase('refused');
        setError(slot.error ?? 'That file could not be prepared.');
        return;
      }
      const put = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'content-type': picked.type || 'application/pdf' },
        body: picked,
      });
      if (!put.ok) {
        setPhase('refused');
        setError(`The upload was refused (${put.status}).`);
        return;
      }
      setPath(slot.path);
      setStep('Reading the plots…');
      const reading = await readPropertySheetAction(lead.id, slot.path);
      if (!reading.ok) {
        setPhase('refused');
        setError(reading.error ?? 'That sheet could not be read.');
        void discardPropertySheetAction(lead.id, slot.path).catch(() => {});
        setPath('');
        return;
      }
      const found = reading.plots ?? [];
      setPlots(found);
      setExisting(reading.existing ?? []);
      setCanAdd(reading.canAdd === true);
      /* Everything the project has not got is ticked; what it already has is not. */
      const already = new Set((reading.existing ?? []).map((c) => c.toLowerCase()));
      setChosen(found.filter((pl) => !already.has(pl.code.toLowerCase())).map((pl) => pl.code));
      setPhase('read');
    } catch {
      setPhase('refused');
      setError('The upload did not finish — the connection dropped.');
    } finally {
      setStep('');
    }
  };

  const reset = () => {
    if (path) void discardPropertySheetAction(lead.id, path).catch(() => {});
    setPhase('pick');
    setError('');
    setFile(null);
    setPath('');
    setPlots([]);
    setChosen([]);
  };

  const add = async () => {
    if (!file || !path || chosen.length === 0) return;
    const ok = await ctx.act(
      () =>
        addPlotsFromSheetAction({
          leadId: lead.id,
          path,
          title: file.name,
          mime: file.type || 'application/pdf',
          sizeBytes: file.size,
          codes: chosen,
        }),
      `${chosen.length} plot${chosen.length > 1 ? 's' : ''} added to the catalogue.`,
    );
    if (ok) onClose();
  };

  return (
    <Sheet title="Add plots from a property sheet" onClose={onClose}>
      {phase === 'pick' && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-default px-4 py-6 text-center transition-colors hover:bg-bg-subtle"
          >
            <span
              className="grid size-10 place-items-center rounded-full"
              style={{ background: `color-mix(in oklab, ${BLUE} 12%, transparent)`, color: BLUE }}
            >
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <span className="text-body-sm font-semibold text-text-primary">Choose a property sheet PDF</span>
            <span className="text-caption text-text-secondary">
              Every plot on it — code, block, size and price — is read off the sheet and listed for you to confirm.
            </span>
          </button>
          <HiddenFile inputRef={fileRef} accept="application/pdf" onFile={(f) => void take(f)} />
        </>
      )}

      {phase === 'working' && (
        <p className="flex items-center gap-2 px-1 py-6 text-body-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {step || 'Working…'}
          <span className="truncate text-caption text-text-tertiary">{file?.name}</span>
        </p>
      )}

      {phase === 'refused' && (
        <>
          <div
            className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
            style={{
              borderColor: 'color-mix(in oklab, #d92d20 35%, transparent)',
              background: 'color-mix(in oklab, #d92d20 7%, transparent)',
            }}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: '#d92d20' }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-text-primary">This sheet cannot be added</p>
              <p className="mt-0.5 text-caption text-text-secondary">{error}</p>
              {file && <p className="mt-1 truncate text-caption text-text-tertiary">{file.name}</p>}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={onClose}>Close</Btn>
            <Btn primary onClick={reset}>
              Choose another sheet
            </Btn>
          </div>
        </>
      )}

      {phase === 'read' && (
        <>
          <p className="flex items-center justify-between gap-2 text-caption text-text-secondary">
            <span>
              {plots.length} plot{plots.length === 1 ? '' : 's'} read from{' '}
              <span className="font-medium text-text-primary">{file?.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setChosen(chosen.length === plots.length ? [] : plots.map((pl) => pl.code))}
              className="font-medium hover:underline"
              style={{ color: BLUE }}
            >
              {chosen.length === plots.length ? 'Clear all' : 'Select all'}
            </button>
          </p>

          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border-subtle">
            {plots.map((pl) => (
              <label
                key={`${pl.code}-${pl.block ?? ''}`}
                className="flex cursor-pointer items-center gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0 hover:bg-bg-subtle/60"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(pl.code)}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, pl.code] : chosen.filter((c) => c !== pl.code))
                  }
                  className="size-4 shrink-0 accent-[var(--accent-primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">
                    {pl.code}
                    {pl.block ? ` · Block ${pl.block}` : ''}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {[pl.sizeMarla !== null ? `${pl.sizeMarla} Marla` : null, pl.category].filter(Boolean).join(' · ') ||
                      'No size on the sheet'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-body-sm font-semibold tabular-nums text-text-primary">
                    {pl.basePrice === null ? 'No price' : money(pl.basePrice)}
                  </span>
                  {!isNew(pl.code) && <span className="block text-caption text-text-tertiary">Already listed</span>}
                </span>
              </label>
            ))}
          </div>

          {canAdd ? (
            <p className="mt-2 text-caption text-text-secondary">
              They join {ctx.where} as available plots. Ones already in the catalogue are left exactly as they are.
            </p>
          ) : (
            <p
              className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-caption leading-relaxed"
              style={{ background: `color-mix(in oklab, ${BLUE} 8%, transparent)`, color: BLUE }}
            >
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Only the project manager can add plots to the catalogue — a price is the company&rsquo;s, not the
              seller&rsquo;s. Ask your manager to add these and the sheet stays on this lead either way.
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={reset}>Choose another</Btn>
            <Btn primary disabled={!canAdd || ctx.busy || chosen.length === 0} onClick={() => void add()}>
              {canAdd ? `Add ${chosen.length} plot${chosen.length === 1 ? '' : 's'}` : 'Manager only'}
            </Btn>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ── 2 · Properties ──────────────────────────────────────────────────────── */

const P_COLS = `18px minmax(0,1.5fr) minmax(0,0.6fr) ${MONEY_COL} ${MONEY_COL}`;

function PropertiesTab({ ctx, pickedId, onPick, onChooseUnit }: {
  ctx: Ctx;
  pickedId?: string;
  onPick: (id: string) => void;
  onChooseUnit: () => void;
}) {
  const { lead, items } = ctx;
  const list = items.properties;
  const chosen: RelatedProperty | undefined = list.find((p) => p.id === pickedId) ?? list[0];
  const quote =
    items.quotations.find((q) => q.propertyId === chosen?.id && !['superseded', 'rejected', 'expired'].includes(q.status)) ??
    items.quotations.find((q) => q.propertyId === chosen?.id) ??
    null;
  /* ⚠️ A PROPERTY SHEET IS A FILE SOMEBODY UPLOADED — a brochure, site plan or
     price list on the project. None generated, none invented. */
  const sheet = items.files.find((f) => ['brochure', 'site_plan', 'price_list'].includes(f.kind)) ?? null;
  const [attachSheet, setAttachSheet] = React.useState(true);
  const [addingPlots, setAddingPlots] = React.useState(false);

  const attach = async () => {
    if (!chosen) return;
    const plan = chosen.stages
      .filter((s) => s.amount !== null)
      .map((s) =>
        s.instalments && s.instalments > 1
          ? `• ${s.label}: ${money((s.amount as number) / s.instalments)} each`
          : `• ${s.label}: ${money(s.amount)}`,
      );
    const text = [
      `${chosen.label} — ${chosen.title}, ${chosen.projectName ?? lead.projectName}`,
      [
        chosen.areaSqft ? `${chosen.areaSqft.toLocaleString('en-PK')} sq ft` : null,
        chosen.dimensions,
        chosen.facing ? `${chosen.facing} facing` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      `Price: ${money(chosen.basePrice)}`,
      ...(plan.length ? ['Payment plan:', ...plan] : []),
    ]
      .filter(Boolean)
      .join('\n');
    ctx.attachVia(
      {
        title: 'Send these property details',
        summary: `${chosen.label} · ${chosen.title}`,
        files: attachSheet && sheet ? 1 : 0,
      },
      async (channel) => {
        const files = attachSheet && sheet ? [await fileFromLink(await crmDocumentLinkAction(sheet.id), sheet.title)] : [];
        if (channel === 'whatsapp') return { channel, files, text };
        return {
          channel,
          files,
          subject: `${chosen.label} — ${chosen.title}`,
          text: [
            `Assalam-o-Alaikum ${(lead.fullName ?? '').split(' ')[0] || 'Sir/Madam'}.`,
            '',
            'Here are the details of the unit we discussed.',
            '',
            text,
          ].join('\n'),
        };
      },
    );
  };

  return (
    <>
      <Body
        list={
          <>
            <ListHead
              title="Linked properties"
              count={list.length}
              action={
                <LinkText icon="upload" onClick={() => setAddingPlots(true)}>
                  Add from sheet
                </LinkText>
              }
            />
            {list.length === 0 ? (
              <EmptyList loading={ctx.loading} action={<OutlineBlue icon={PlusCircle} onClick={onChooseUnit}>Link property</OutlineBlue>}>
                No unit is linked to this lead yet.
              </EmptyList>
            ) : (
              <>
                <Columns template={P_COLS} labels={['Property', 'Size', 'Price', 'Status']} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {list.map((p) => (
                    <ListRow key={p.id} template={P_COLS} chosen={p.id === chosen?.id} onClick={() => onPick(p.id)}>
                      <Two top={p.label} bottom={p.projectName} blue />
                      <span className="truncate text-body-sm text-text-primary">
                        {p.sizeMarla ? `${p.sizeMarla} Marla` : '—'}
                      </span>
                      <span className="truncate text-body-sm tabular-nums text-text-primary">{money(p.basePrice)}</span>
                      <StatusPill status={p.status} />
                    </ListRow>
                  ))}
                </div>
              </>
            )}
          </>
        }
        detail={
          !chosen ? (
            <EmptyList loading={ctx.loading}>Link a property to see its details and payment plan.</EmptyList>
          ) : (
            <>
              <DetailHead title="Property details" />
              <Scroll>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-h3 font-semibold" style={{ color: BLUE }}>
                      {chosen.label}
                    </p>
                    <p className="truncate text-body-sm text-text-primary">{chosen.projectName}</p>
                    <p className="truncate text-body-sm text-text-secondary">
                      {[chosen.sizeMarla ? `${chosen.sizeMarla} Marla` : null, chosen.kind].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusPill status={chosen.status} />
                </div>

                <div className="grid grid-cols-2 border-y border-border-subtle py-3">
                  <dl className="space-y-1.5 pr-3 text-body-sm">
                    <Row2 k="Area" v={chosen.areaSqft ? `${chosen.areaSqft.toLocaleString('en-PK')} sq ft` : '—'} />
                    <Row2 k="Dimensions" v={chosen.dimensions ?? '—'} />
                  </dl>
                  <dl className="space-y-1.5 border-l border-border-subtle pl-3 text-body-sm">
                    <Row2 k="Road" v={chosen.roadWidthFt ? `${chosen.roadWidthFt} ft` : '—'} />
                    <Row2 k="Facing" v={chosen.facing ?? '—'} />
                  </dl>
                </div>

                <div>
                  <Label>Price</Label>
                  <p className="text-[1.6rem] font-bold leading-tight tabular-nums text-text-primary">{money(chosen.basePrice)}</p>
                  {chosen.areaSqft && chosen.sizeMarla ? (
                    <p className="text-caption text-text-secondary">
                      {Math.round(chosen.areaSqft / chosen.sizeMarla)} sq ft per Marla.
                    </p>
                  ) : null}
                </div>

                {chosen.stages.length > 0 && (
                  <Card className="overflow-hidden">
                    <table className="w-full text-body-sm">
                      <thead className="bg-bg-subtle/60">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-left font-semibold text-text-primary">Payment plan</th>
                          <th scope="col" className="px-4 py-2 text-right font-semibold text-text-primary">Amount (PKR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chosen.stages.map((s, i) => (
                          <tr key={`${s.label}-${i}`} className="border-t border-border-subtle">
                            <td className="px-4 py-2 text-text-primary">{s.label}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-text-primary">
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
                  </Card>
                )}

                {quote && (
                  <Card className="flex items-center gap-3 px-4 py-3">
                    <IconTile tint="var(--text-secondary)">
                      <FileText className="size-5" aria-hidden="true" />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-semibold text-text-primary">Linked quotation</p>
                      <p className="truncate text-body-sm" style={{ color: BLUE }}>
                        {quote.number} · {statusLook(quote.status).label}
                      </p>
                    </div>
                    <LinkText icon="right" onClick={() => ctx.go('quotations', quote.id)}>
                      View quotation
                    </LinkText>
                  </Card>
                )}

                <Card className="flex items-center gap-3 px-4 py-3">
                  <IconTile tint="var(--text-secondary)">
                    <FileText className="size-5" aria-hidden="true" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-text-primary">Attach property sheet PDF</p>
                    <p className="text-caption text-text-secondary">
                      {sheet
                        ? attachSheet
                          ? `${sheet.title} will be attached to your message.`
                          : 'Only the details and payment plan will be sent.'
                        : 'No brochure or site plan on this project yet — the details go as text.'}
                    </p>
                  </div>
                  <Toggle on={attachSheet && !!sheet} disabled={!sheet} onChange={setAttachSheet} label="Attach property sheet PDF" />
                </Card>
              </Scroll>
            </>
          )
        }
      />
      <Foot
        left={
          <div>
            <OutlineBlue icon={PlusCircle} onClick={onChooseUnit}>
              Link property
            </OutlineBlue>
            <p className="mt-1 pl-1 text-caption text-text-secondary">Link another property to this lead.</p>
          </div>
        }
        note={`All records are linked to ${lead.fullName ?? 'this lead'} · Salesperson: ${lead.ownerName ?? 'Unassigned'}`}
        right={
          <>
            <Btn onClick={ctx.onClose}>Cancel</Btn>
            <Btn primary disabled={!chosen} onClick={() => void attach()}>
              Attach property sheet
            </Btn>
          </>
        }
      />
      {addingPlots && <PropertySheetPicker ctx={ctx} onClose={() => setAddingPlots(false)} />}
    </>
  );
}

function Row2({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt className="text-text-secondary">{k}</dt>
      <dd className="truncate font-medium text-text-primary">{v}</dd>
    </div>
  );
}

/* ── 3 · Appointments ────────────────────────────────────────────────────── */

const A_COLS = `18px minmax(0,1.4fr) minmax(0,1.1fr) ${MONEY_COL}`;

function AppointmentsTab({ ctx, pickedId, onPick, onRecordOutcome }: {
  ctx: Ctx;
  pickedId?: string;
  onPick: (id: string) => void;
  onRecordOutcome: () => void;
}) {
  const { lead, items, busy } = ctx;
  const list = items.appointments;
  const chosen: RelatedAppointment | undefined =
    list.find((a) => a.id === pickedId) ?? list.find((a) => ['scheduled', 'confirmed'].includes(a.status)) ?? list[0];
  const upcoming = chosen ? ['scheduled', 'confirmed'].includes(chosen.status) : false;
  const quote = items.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
  const unit = items.properties.find((p) => p.id === chosen?.propertyId) ?? items.properties.find((p) => p.linked) ?? null;

  const [sheet, setSheet] = React.useState<null | 'new' | 'move'>(null);
  const [when, setWhen] = React.useState(() => {
    const p = karachiParts(Date.now());
    return toInputValue(karachiAt(p.y, p.m, p.d + 1, 11));
  });
  /* ⚠️ ONE CLOCK READ, HELD. `Date.now()` during a render is impure (the
     react-hooks purity rule caught this in the follow-up wizard), and a scheduler
     whose "today" moved mid-interaction would renumber the calendar under the
     cursor. */
  const [nowMs] = React.useState(() => Date.now());
  const [draft, setDraft] = React.useState<AppointmentDraft>(() => {
    const t = karachiParts(nowMs);
    return {
      kind: 'site_visit',
      at: snapToOffice(karachiAt(t.y, t.m, t.d + 1, 11), OFFICE),
      minutes: 90,
      location: '',
      note: '',
      remindHoursBefore: 24,
    };
  });

  const title = (a: RelatedAppointment) =>
    `${appointmentKindLabel(a.kind)}${a.propertyLabel ? ` · ${a.propertyLabel.split(' · ')[0]}` : ''}`;

  /* ⚠️ IN PLACE OF THE TAB, NOT ON TOP OF IT. Returning the scheduler here keeps
     the dialog's header, its five tabs and its fixed height exactly as they are,
     and gives the calendar the whole area below them. */
  if (sheet === 'new') {
    return (
      <AppointmentScheduler
        draft={draft}
        onChange={setDraft}
        nowMs={nowMs}
        clientPhone={lead.phone}
        clientName={lead.fullName ?? 'The client'}
        unitLabel={unit ? [unit.title, unit.label].filter(Boolean).join(' · ') : null}
        busy={busy}
        existing={items.appointments.map((a) => ({
          at: a.scheduledAt,
          minutes: a.durationMinutes,
          status: a.status,
        }))}
        onCancel={() => setSheet(null)}
        onSubmit={async () => {
          const ok = await ctx.act(
            () =>
              bookAppointmentAction({
                leadId: lead.id,
                kind: draft.kind,
                scheduledAt: new Date(draft.at).toISOString(),
                durationMinutes: draft.minutes,
                location: draft.location,
                note: draft.note,
                remindHoursBefore: draft.remindHoursBefore,
              }),
            draft.remindHoursBefore === null
              ? 'Appointment booked.'
              : 'Appointment booked, and the reminder is in your list.',
          );
          if (ok) {
            setSheet(null);
            setDraft((d) => ({ ...d, note: '' }));
          }
        }}
      />
    );
  }

  return (
    <>
      <Body
        list={
          <>
            <ListHead title="Appointments" count={list.length} />
            {list.length === 0 ? (
              <EmptyList loading={ctx.loading} action={<OutlineBlue icon={CalendarPlus} onClick={() => setSheet('new')}>Schedule appointment</OutlineBlue>}>
                Nothing booked yet.
              </EmptyList>
            ) : (
              <>
                <Columns template={A_COLS} labels={['Appointment', 'Date / time', 'Status']} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {list.map((a) => (
                    <ListRow key={a.id} template={A_COLS} chosen={a.id === chosen?.id} onClick={() => onPick(a.id)}>
                      <Two top={title(a)} />
                      <span className="truncate text-body-sm text-text-primary">
                        {shortDay(a.scheduledAt)} · {clock(Date.parse(a.scheduledAt))}
                      </span>
                      <StatusPill status={a.status} />
                    </ListRow>
                  ))}
                </div>
              </>
            )}
          </>
        }
        detail={
          !chosen ? (
            <EmptyList loading={ctx.loading}>Schedule a visit or a call and its details appear here.</EmptyList>
          ) : (
            <>
              <DetailHead title="Appointment details" onOpen={() => window.open('/appointments', '_blank', 'noopener')} />
              <Scroll>
                <Card className="p-4">
                  <div className="flex items-center gap-3 border-b border-border-subtle pb-3">
                    <IconTile>
                      <CalendarDays className="size-5" aria-hidden="true" />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-h3 font-semibold text-text-primary">{appointmentKindLabel(chosen.kind)}</p>
                      <p className="truncate text-body-sm text-text-secondary">{title(chosen)}</p>
                    </div>
                    <StatusPill status={chosen.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2">
                    <div className="min-w-0 space-y-3 pr-3">
                      <div>
                        <Label>Client</Label>
                        <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? '—'}</p>
                        <p className="truncate text-caption text-text-secondary">{lead.projectName}</p>
                        {lead.city && <p className="truncate text-caption text-text-secondary">{lead.city}</p>}
                      </div>
                      <div>
                        <Label>Location</Label>
                        <p className="text-body-sm text-text-primary">{chosen.location ?? '—'}</p>
                      </div>
                      {chosen.propertyLabel && unit && (
                        <div>
                          <Label>Property</Label>
                          <LinkText onClick={() => ctx.go('properties', unit.id)}>{chosen.propertyLabel}</LinkText>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 space-y-3 border-l border-border-subtle pl-3">
                      <div>
                        <Label>Consultant</Label>
                        <p className="truncate text-body-sm font-semibold text-text-primary">
                          {chosen.ownerName ?? lead.ownerName ?? '—'}
                        </p>
                      </div>
                      <div>
                        <Label>Date</Label>
                        <p className="text-body-sm text-text-primary">{longDay(chosen.scheduledAt)}</p>
                      </div>
                      <div>
                        <Label>Time</Label>
                        <p className="text-body-sm text-text-primary">
                          {clock(Date.parse(chosen.scheduledAt))} –{' '}
                          {clock(Date.parse(chosen.scheduledAt) + chosen.durationMinutes * 60_000)} PKT
                        </p>
                      </div>
                      {quote && (
                        <div>
                          <Label>Related quotation</Label>
                          <LinkText icon="ext" onClick={() => ctx.go('quotations', quote.id)}>
                            {quote.number}
                          </LinkText>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="flex items-center gap-3 px-4 py-3">
                  <IconTile tint={WA_GREEN}>
                    <WhatsAppMark className="size-5" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-text-primary">WhatsApp reminder</p>
                    <p className="text-caption text-text-secondary">
                      {items.visitReminderAt
                        ? `A reminder is planned for ${formatWhen(items.visitReminderAt)}.`
                        : 'None planned — add one from Follow-ups → Appointment reminder.'}
                    </p>
                  </div>
                  <Pill tone={items.visitReminderAt ? 'green' : 'grey'}>
                    {items.visitReminderAt ? 'Scheduled' : 'Not set'}
                  </Pill>
                </Card>

                <Card className="flex items-start gap-3 px-4 py-3">
                  <IconTile tint="var(--text-secondary)">
                    <FileText className="size-5" aria-hidden="true" />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-text-primary">Notes</p>
                    <p className="whitespace-pre-wrap text-body-sm text-text-secondary">
                      {chosen.outcome ?? chosen.notes ?? 'No notes on this appointment.'}
                    </p>
                  </div>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  {unit ? (
                    <span className="inline-flex items-center gap-2">
                      <Home className="size-4" style={{ color: BLUE }} aria-hidden="true" />
                      <LinkText icon="ext" onClick={() => ctx.go('properties', unit.id)}>
                        View property
                      </LinkText>
                    </span>
                  ) : (
                    <span />
                  )}
                  {quote && (
                    <span className="inline-flex items-center gap-2">
                      <FileText className="size-4" style={{ color: BLUE }} aria-hidden="true" />
                      <LinkText icon="ext" onClick={() => ctx.go('quotations', quote.id)}>
                        View quotation
                      </LinkText>
                    </span>
                  )}
                </div>
              </Scroll>
            </>
          )
        }
      />
      <Foot
        left={
          <OutlineBlue icon={CalendarPlus} onClick={() => setSheet('new')}>
            Schedule appointment
          </OutlineBlue>
        }
        right={
          <>
            <Btn disabled={!upcoming} onClick={() => setSheet('move')}>
              Reschedule
            </Btn>
            <Btn primary onClick={onRecordOutcome}>
              Record outcome
            </Btn>
          </>
        }
      />
      {sheet === 'move' && chosen && (
        <Sheet title={`Reschedule · ${title(chosen)}`} onClose={() => setSheet(null)}>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={field} aria-label="New time" />
          <p className="mt-1.5 text-caption text-text-secondary">
            The old time is kept as &ldquo;Rescheduled&rdquo;, so the history shows it moved.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setSheet(null)}>Cancel</Btn>
            <Btn
              primary
              disabled={busy}
              onClick={async () => {
                const ms = fromInputValue(when);
                if (ms === null) return;
                const ok = await ctx.act(
                  () => rescheduleAppointmentAction(lead.id, chosen.id, new Date(ms).toISOString()),
                  'Appointment moved.',
                );
                if (ok) setSheet(null);
              }}
            >
              Move it
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ── 4 · Bookings ────────────────────────────────────────────────────────── */

const B_COLS = `18px minmax(0,0.95fr) minmax(0,1.3fr) ${MONEY_COL} ${MONEY_COL}`;

function BookingsTab({ ctx, pickedId, onPick }: { ctx: Ctx; pickedId?: string; onPick: (id: string) => void }) {
  const { lead, items, busy } = ctx;
  const list = items.bookings;
  const chosen: RelatedBooking | undefined = list.find((b) => b.id === pickedId) ?? list[0];
  const live = items.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
  const [adding, setAdding] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [received, setReceived] = React.useState('');
  const proofRef = React.useRef<HTMLInputElement>(null);

  const bookingStage = React.useMemo(() => {
    const unit = items.properties.find((p) => p.id === live?.propertyId) ?? items.properties.find((p) => p.linked);
    return unit?.stages.find((s) => /booking/i.test(s.label)) ?? null;
  }, [items.properties, live]);

  /* ⚠️ READ FROM THE CATALOGUE, not inferred from the booking's own status. The
     hold is a row in `crm_properties`; printing "reserved" because a booking
     exists would keep saying it after somebody withdrew the plot. */
  const held = chosen?.propertyStatus === 'reserved' || chosen?.propertyStatus === 'sold';

  const openProof = async (id: string) => {
    const link = await relatedFileLinkAction('booking_receipt', id);
    if (link.url) window.open(link.url, '_blank', 'noopener');
    else ctx.toast({ tone: 'error', text: link.error ?? 'That could not be opened.' });
  };

  return (
    <>
      <Body
        list={
          <>
            <ListHead
              title="Bookings"
              count={list.length}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true);
                    if (!amount && bookingStage?.amount) setAmount(String(Math.round(bookingStage.amount)));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary hover:bg-bg-subtle"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Book property
                </button>
              }
            />
            {list.length === 0 ? (
              <EmptyList loading={ctx.loading}>
                No booking yet. A quotation does not reserve the plot — a booking does, once Finance has verified the
                payment.
              </EmptyList>
            ) : (
              <>
                <Columns template={B_COLS} labels={['Booking', 'Property', 'Booking amount', 'Status']} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {list.map((b) => (
                    <ListRow key={b.id} template={B_COLS} chosen={b.id === chosen?.id} onClick={() => onPick(b.id)}>
                      <Two top={b.number} bottom={shortDay(b.requestedAt)} />
                      <Two top={b.propertyLabel ?? '—'} bottom={lead.projectName} blue />
                      <span className="truncate text-body-sm font-semibold tabular-nums text-text-primary">{money(b.amount)}</span>
                      <StatusPill status={b.status} />
                    </ListRow>
                  ))}
                </div>
              </>
            )}
          </>
        }
        detail={
          !chosen ? (
            <EmptyList loading={ctx.loading}>Record a booking and its progress appears here.</EmptyList>
          ) : (
            <>
              <DetailHead
                title="Booking details"
                onOpen={chosen.receiptPath ? () => void openProof(chosen.id) : undefined}
              />
              <Scroll>
                <div className="flex items-start justify-between gap-3 border-b border-border-subtle pb-3">
                  <div className="min-w-0">
                    <p className="text-h3 font-semibold text-text-primary">{chosen.number}</p>
                    <p className="truncate text-body font-semibold text-text-primary">{chosen.propertyLabel ?? '—'}</p>
                    <p className="truncate text-body-sm text-text-secondary">{ctx.where}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Label>Status</Label>
                    <Pill tone={statusLook(chosen.status).tone}>
                      {chosen.status === 'pending_verification'
                        ? 'Pending payment verification'
                        : statusLook(chosen.status).label}
                    </Pill>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-y-3 border-b border-border-subtle pb-3">
                  <Cell3 label="Client" first>
                    <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? '—'}</p>
                    <p className="truncate text-caption text-text-secondary">{lead.city ?? lead.projectName}</p>
                  </Cell3>
                  <Cell3 label="Quotation">
                    {chosen.quotationNumber && chosen.quotationId ? (
                      <LinkText onClick={() => ctx.go('quotations', chosen.quotationId)}>{chosen.quotationNumber}</LinkText>
                    ) : (
                      <p className="text-body-sm text-text-primary">—</p>
                    )}
                    {chosen.quotationStatus && (
                      <div className="mt-1">
                        <StatusPill status={chosen.quotationStatus} />
                      </div>
                    )}
                  </Cell3>
                  <Cell3 label="Property total">
                    <p className="text-body font-semibold tabular-nums text-text-primary">{money(chosen.propertyTotal)}</p>
                  </Cell3>
                  <Cell3 label="Booking due" first>
                    <p className="text-body font-semibold tabular-nums text-text-primary">{money(chosen.amount)}</p>
                  </Cell3>
                  <Cell3 label="Verified received">
                    <p className="text-body font-semibold tabular-nums text-text-primary">{money(chosen.verifiedAmount)}</p>
                  </Cell3>
                  <Cell3 label="Outstanding booking">
                    <p className="text-body font-semibold tabular-nums text-text-primary">
                      {money(Math.max(0, chosen.amount - chosen.verifiedAmount))}
                    </p>
                  </Cell3>
                </div>

                <div>
                  <p className="mb-2 text-body-sm font-semibold text-text-primary">Booking progress</p>
                  <ol className="space-y-2.5">
                    <Progress state="done" label="Booking requested" detail={shortDay(chosen.requestedAt)} pill="Completed" />
                    <Progress
                      state={chosen.status === 'confirmed' ? 'done' : chosen.status === 'pending_verification' ? 'active' : 'todo'}
                      label="Payment verification"
                      detail={
                        chosen.verifiedAt
                          ? `Verified ${shortDay(chosen.verifiedAt)}`
                          : chosen.verificationRequestedAt
                            ? 'Under review by Finance'
                            : 'Not requested yet'
                      }
                      pill={
                        chosen.status === 'confirmed' ? 'Completed' : chosen.status === 'pending_verification' ? 'Pending' : 'Awaiting'
                      }
                    />
                    <Progress
                      state={chosen.status === 'confirmed' ? 'done' : 'todo'}
                      label="Booking confirmation"
                      detail={chosen.confirmedAt ? shortDay(chosen.confirmedAt) : 'Awaiting verification'}
                      pill={chosen.status === 'confirmed' ? 'Completed' : 'Awaiting'}
                    />
                    {/* ⚠️ THE SECOND HALF OF "BOOKED". Owner, 2026-09-17: *"Book
                        Property is when he sends payment and the property is
                        reserved. When these two things are done, the property
                        booking is done."* The plot is held by the booking itself
                        (199), and this is where somebody can see that it is. */}
                    <Progress
                      state={held ? 'done' : chosen.propertyId ? 'active' : 'todo'}
                      label="Property reserved"
                      detail={
                        !chosen.propertyId
                          ? 'No plot on this booking yet'
                          : held
                            ? `${chosen.propertyLabel ?? 'The plot'} is held for this client`
                            : 'The plot is not held — link it to this booking'
                      }
                      pill={held ? 'Reserved' : 'Awaiting'}
                      last
                    />
                  </ol>
                </div>

                <div className="border-t border-border-subtle pt-3">
                  <p className="mb-2 text-body-sm font-semibold text-text-primary">Linked documents</p>
                  <ul className="space-y-2">
                    <DocRow label="Booking application" pill="Not generated" action={<span className="text-text-tertiary">—</span>} />
                    <DocRow
                      label="Payment evidence"
                      pill={chosen.receiptPath ? `Uploaded ${shortDay(chosen.receiptUploadedAt)}` : 'Not uploaded'}
                      tone={chosen.receiptPath ? 'green' : 'grey'}
                      action={
                        <>
                          {chosen.receiptPath && (
                            <button
                              type="button"
                              onClick={() => void openProof(chosen.id)}
                              className="mr-3 font-medium hover:underline"
                              style={{ color: BLUE }}
                            >
                              View
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => proofRef.current?.click()}
                            className="font-medium hover:underline disabled:opacity-50"
                            style={{ color: BLUE }}
                          >
                            {chosen.receiptPath ? 'Replace' : 'Upload'}
                          </button>
                          <HiddenFile
                            inputRef={proofRef}
                            onFile={(f) =>
                              void ctx.upload(
                                f,
                                prepareReceiptAction,
                                (path) =>
                                  attachBookingReceiptAction({
                                    leadId: lead.id,
                                    bookingId: chosen.id,
                                    path,
                                    title: f.name,
                                    mime: f.type || 'application/pdf',
                                    sizeBytes: f.size,
                                  }),
                                'Payment evidence uploaded.',
                              )
                            }
                          />
                        </>
                      }
                    />
                    <DocRow
                      label="Confirmation"
                      pill={chosen.status === 'confirmed' ? 'Issued' : 'Not issued'}
                      tone={chosen.status === 'confirmed' ? 'green' : 'grey'}
                      action={<span className="text-text-tertiary">—</span>}
                    />
                  </ul>
                </div>

                <p
                  className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-caption leading-relaxed"
                  style={{ background: `color-mix(in oklab, ${BLUE} 8%, transparent)`, color: BLUE }}
                >
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Quotation does not reserve the plot. Pending booking cannot mark the lead Won. Sales consultant cannot
                  verify payments.
                </p>

                {items.canVerifyPayments && chosen.status !== 'confirmed' && chosen.status !== 'cancelled' && (
                  <Card className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <p className="min-w-0 flex-1 text-caption text-text-secondary">Finance · confirm what was received</p>
                    <input
                      type="number"
                      min={0}
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      placeholder={String(chosen.amount)}
                      aria-label="Amount received"
                      className="w-36 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-body-sm tabular-nums focus:border-accent-primary focus:outline-none"
                    />
                    <Btn
                      primary
                      disabled={busy}
                      onClick={() =>
                        void ctx.act(
                          () => confirmBookingAction(lead.id, chosen.id, Number(received || chosen.amount)),
                          'Booking confirmed.',
                        )
                      }
                    >
                      Confirm booking
                    </Btn>
                  </Card>
                )}
              </Scroll>
            </>
          )
        }
      />
      <Foot
        left={
          live ? (
            <OutlineBlue icon={ExternalLink} onClick={() => ctx.go('quotations', chosen?.quotationId ?? live.id)}>
              View quotation
            </OutlineBlue>
          ) : null
        }
        right={
          <>
            <Btn onClick={ctx.onClose}>Cancel</Btn>
            <Btn
              primary
              disabled={!chosen || busy || chosen.status !== 'requested'}
              onClick={() =>
                chosen &&
                void ctx.act(
                  () => requestBookingVerificationAction(lead.id, chosen.id),
                  'Sent to Finance for verification.',
                )
              }
            >
              {chosen?.status === 'pending_verification'
                ? 'Verification requested'
                : chosen?.status === 'confirmed'
                  ? 'Verified'
                  : 'Request verification'}
            </Btn>
          </>
        }
      />
      {adding && (
        <Sheet title={`Book property${live ? ` against ${live.number}` : ''}`} onClose={() => setAdding(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Booking amount (PKR)"
              className={field}
              aria-label="Booking amount"
            />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was agreed (optional)" className={field} />
          </div>
          {bookingStage?.amount ? (
            <p className="mt-1.5 text-caption text-text-secondary">
              The payment plan&rsquo;s booking stage is {money(bookingStage.amount)}.
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn
              primary
              disabled={busy || !Number(amount)}
              onClick={async () => {
                const ok = await ctx.act(
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
                  setNotes('');
                }
              }}
            >
              Book property
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}

function Cell3({ label, first = false, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0 px-3', first ? 'pl-0' : 'border-l border-border-subtle')}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Progress({ state, label, detail, pill, last = false }: {
  state: 'done' | 'active' | 'todo';
  label: string;
  detail: string;
  pill: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex items-start gap-3">
      {!last && <span aria-hidden="true" className="absolute left-[11px] top-7 h-[calc(100%-0.75rem)] w-px bg-border-subtle" />}
      <span
        aria-hidden="true"
        className={cn(
          'relative grid size-6 shrink-0 place-items-center rounded-full border-2',
          state === 'done'
            ? 'border-accent-primary bg-accent-primary text-white'
            : state === 'active'
              ? 'border-feedback-warning bg-bg-surface'
              : 'border-border-default bg-bg-surface',
        )}
      >
        {state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{detail}</span>
      </span>
      <Pill tone={state === 'done' ? 'green' : state === 'active' ? 'amber' : 'grey'}>{pill}</Pill>
    </li>
  );
}

function DocRow({ label, pill, tone = 'grey', action }: { label: string; pill: string; tone?: Tone; action: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-center gap-3 text-body-sm">
      <FileText className="size-4 text-text-secondary" aria-hidden="true" />
      <span className="truncate text-text-primary">{label}</span>
      <Pill tone={tone}>{pill}</Pill>
      <span className="min-w-[4rem] text-right">{action}</span>
    </li>
  );
}

/* ── 5 · Invoices ────────────────────────────────────────────────────────── */

const I_COLS = `18px minmax(0,1.7fr) minmax(0,0.8fr) ${MONEY_COL} ${MONEY_COL}`;

/* ── Files ─────────────────────────────────────────────────────────── */

/**
 * The project's shared documents and this lead's own, ready to send.
 *
 * Owner, 2026-09-19: *"all the quotations which I have shared or uploaded in the
 * documentation, or the shared files of a project, should be displayed here —
 * CRM proposal, anything. I can attach it and that will directly send it."*
 *
 *  + W +  THE PROJECT'S FILES COME FIRST. A brochure or a proposal belongs to the
 * whole project and is the thing a salesperson reaches for most; a file uploaded
 * against one lead is the exception. The query already orders them that way.
 */
/** "209 KB" — the size WhatsApp shows beside a document. */
function bytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function FilesTab({ ctx, pickedId, onPick }: { ctx: Ctx; pickedId?: string; onPick: (id: string) => void }) {
  const { lead, items, busy, toast } = ctx;
  const list = items.files;
  const chosen: RelatedFile | undefined = list.find((f) => f.id === pickedId) ?? list[0];
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const attach = () => {
    if (!chosen) return;
    const name = chosen.title.toLowerCase().endsWith('.pdf') ? chosen.title : `${chosen.title}.pdf`;

    ctx.attachVia(
      { title: 'Send this file', summary: `${chosen.title} · ${bytes(chosen.sizeBytes)}`, files: 1 },
      async (channel) => {
        const files = [await fileFromLink(await crmDocumentLinkAction(chosen.id), name)];
        if (channel === 'whatsapp') return { channel, files, text: chosen.title };
        return {
          channel,
          files,
          subject: chosen.title,
          text: [
            `Assalam-o-Alaikum ${(lead.fullName ?? '').split(' ')[0] || 'Sir/Madam'}.`,
            '',
            `Please find ${chosen.title} attached.`,
          ].join(String.fromCharCode(10)),
        };
      },
    );
  };

  const upload = async (picked: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', picked);
      form.set('projectId', lead.projectId);
      form.set('leadId', lead.id);
      form.set('title', picked.name.replace(/\.[a-z0-9]+$/i, ''));
      form.set('kind', 'other');
      /* ⚠️ IT IS A `useActionState` ACTION, so the first argument is the
         previous state. Called directly here because this is one upload with a
         toast, not a form React is driving. */
      const done = await uploadCrmDocumentAction({ ok: false }, form);
      if (done.error) {
        toast({ tone: 'error', text: done.error });
        return;
      }
      /* Re-reads the shelf so the new file is in the list, without a page reload. */
      await ctx.act(async () => ({ ok: true }), `${picked.name} is on the shelf.`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Body
        list={
          list.length === 0 ? (
            <EmptyList loading={ctx.loading}>
              Nothing has been uploaded for {lead.projectName} or for this lead. Add a proposal, a
              brochure or a price list and it can be sent from here.
            </EmptyList>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onPick(f.id)}
                    className="flex w-full items-center gap-3 border-b border-border-subtle px-4 py-3 text-left transition-colors"
                    style={f.id === chosen?.id ? { background: ROW_ON } : undefined}
                  >
                    <FileText className="size-5 shrink-0" style={{ color: BLUE }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-text-primary">{f.title}</span>
                      <span className="block truncate text-caption text-text-secondary">
                        {bytes(f.sizeBytes)} · {shortDay(f.createdAt)}
                      </span>
                    </span>
                    {/*  + W +  WHOSE FILE IT IS, SAID PLAINLY. A project brochure and a
                        document uploaded for this one client are not the same
                        thing, and sending the wrong one is the mistake. */}
                    <span className="shrink-0 rounded-md bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary">
                      {f.leadId ? 'This lead' : 'Project'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        }
        detail={
          chosen ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="text-body font-semibold text-text-primary">{chosen.title}</p>
              <p className="mt-0.5 text-caption text-text-secondary">
                {bytes(chosen.sizeBytes)} · {chosen.mime} · added {longDay(chosen.createdAt)}
              </p>
              <dl className="mt-4 space-y-2 text-caption">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-text-secondary">Belongs to</dt>
                  <dd className="min-w-0 text-text-primary">
                    {chosen.leadId ? (lead.fullName ?? 'This lead') : lead.projectName}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-text-secondary">Kind</dt>
                  <dd className="min-w-0 text-text-primary">{chosen.kind.replace(/_/g, ' ')}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={async () => {
                  const link = await crmDocumentLinkAction(chosen.id);
                  if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer');
                  else toast({ tone: 'error', text: link.error ?? 'That file could not be opened.' });
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand underline-offset-2 hover:underline"
              >
                <Eye className="size-4" aria-hidden="true" /> Open it
              </button>
            </div>
          ) : (
            <Empty>Pick a file to see what it is.</Empty>
          )
        }
      />
      <Foot
        left={
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
            <button
              type="button"
              disabled={uploading || busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-border-default px-3.5 py-2.5 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
            >
              {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
              {uploading ? 'Uploading…' : 'Upload a PDF'}
            </button>
          </>
        }
        note={
          /*  + W +  SAID HERE, BECAUSE IT IS THE ONE THING A SALESPERSON WOULD ASSUME.
             A file on the shelf is not read by anything yet — the quotation
             reader runs on the Quotations tab's own upload, not on this one. */
          'Uploaded files can be sent from here. Reading what is inside them is the Quotations tab, for now.'
        }
        right={
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={attach}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="size-4" aria-hidden="true" /> Attach and send
          </button>
        }
      />
    </>
  );
}

function InvoicesTab({ ctx, pickedId, onPick }: { ctx: Ctx; pickedId?: string; onPick: (id: string) => void }) {
  const { lead, items, busy } = ctx;
  const list = items.invoices;
  const chosen: RelatedInvoice | undefined = list.find((i) => i.id === pickedId) ?? list[0];
  const [attachPdf, setAttachPdf] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [description, setDescription] = React.useState('Booking deposit');
  const [amount, setAmount] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const [paid, setPaid] = React.useState('');
  const [note, setNote] = React.useState('');
  const pdfRef = React.useRef<HTMLInputElement>(null);
  const receiptRef = React.useRef<HTMLInputElement>(null);

  const booking = items.bookings.find((b) => b.status !== 'cancelled') ?? null;
  const live = items.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
  const unit = items.properties.find((p) => p.id === live?.propertyId) ?? items.properties.find((p) => p.linked) ?? null;
  /* ⚠️ THE INVOICE COMES FROM THE TERMS — the payment plan's own stages, one tap each. */
  const terms = (unit?.stages ?? [])
    .filter((s) => s.amount !== null && s.amount > 0)
    .map((s) => ({
      label: s.instalments && s.instalments > 1 ? `${s.label} (1 of ${s.instalments})` : s.label,
      amount: Math.round(s.instalments && s.instalments > 1 ? (s.amount as number) / s.instalments : (s.amount as number)),
      percentage: s.percentage,
    }));

  const attach = () => {
    if (!chosen) return;
    const outstanding = money(Math.max(0, chosen.amount - chosen.paidAmount));
    const due = chosen.dueAt ? longDay(chosen.dueAt) : null;
    const withPdf = attachPdf && !!chosen.pdfPath;
    const text = `Invoice ${chosen.number} · ${chosen.description}: ${outstanding} due${due ? ` by ${due}` : ''}.`;

    ctx.attachVia(
      {
        title: 'Send this invoice',
        summary: `${chosen.number} · ${outstanding} outstanding`,
        files: withPdf ? 1 : 0,
      },
      async (channel) => {
        const files = withPdf
          ? [await fileFromLink(await relatedFileLinkAction('invoice_pdf', chosen.id), `${chosen.number}.pdf`)]
          : [];
        if (channel === 'whatsapp') return { channel, files, text };
        return {
          channel,
          files,
          subject: `Invoice ${chosen.number}`,
          text: [
            `Assalam-o-Alaikum ${(lead.fullName ?? '').split(' ')[0] || 'Sir/Madam'}.`,
            '',
            `Please find invoice ${chosen.number} for ${chosen.description}.`,
            '',
            `Amount outstanding: ${outstanding}${due ? `\nDue by: ${due}` : ''}`,
            '',
            'Once the payment is made, please share the receipt so we can record it.',
          ].join('\n'),
        };
      },
    );
  };

  const open = async (what: 'invoice_pdf' | 'invoice_receipt') => {
    if (!chosen) return;
    const link = await relatedFileLinkAction(what, chosen.id);
    if (link.url) window.open(link.url, '_blank', 'noopener');
    else ctx.toast({ tone: 'error', text: link.error ?? 'That could not be opened.' });
  };

  return (
    <>
      <Body
        list={
          <>
            <ListHead
              title="Invoices"
              count={list.length}
              action={
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary hover:bg-bg-subtle"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  New invoice
                </button>
              }
            />
            {list.length === 0 ? (
              <EmptyList loading={ctx.loading}>
                Nothing invoiced yet. Raise one from the quotation&rsquo;s terms, send it, and upload the receipt the
                client sends back — Finance approves the payment from that proof.
              </EmptyList>
            ) : (
              <>
                <Columns template={I_COLS} labels={['Invoice', 'Due date', 'Amount', 'Status']} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {list.map((i) => (
                    <ListRow key={i.id} template={I_COLS} chosen={i.id === chosen?.id} onClick={() => onPick(i.id)}>
                      <Two top={`${i.number} · ${i.description}`} />
                      <span className="truncate text-body-sm text-text-primary">{shortDay(i.dueAt)}</span>
                      <span className="truncate text-body-sm tabular-nums text-text-primary">{money(i.amount)}</span>
                      <StatusPill status={i.status} />
                    </ListRow>
                  ))}
                </div>
              </>
            )}
          </>
        }
        detail={
          !chosen ? (
            <EmptyList loading={ctx.loading}>Raise an invoice and its preview appears here.</EmptyList>
          ) : (
            <>
              <DetailHead title="Invoice preview" onOpen={chosen.pdfPath ? () => void open('invoice_pdf') : undefined} />
              <Scroll>
                <Card className="p-4">
                  <div className="flex items-center gap-3 border-b border-border-subtle pb-3">
                    <IconTile>
                      <Receipt className="size-5" aria-hidden="true" />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-h3 font-semibold text-text-primary">INVOICE · {chosen.number}</p>
                      <p className="truncate text-body-sm text-text-secondary">{chosen.description}</p>
                    </div>
                    <StatusPill status={chosen.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2">
                    <div className="min-w-0 space-y-2.5 pr-3">
                      <div>
                        <Label>Client</Label>
                        <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? '—'}</p>
                        <p className="truncate text-caption text-text-secondary">{lead.city ?? lead.projectName}</p>
                      </div>
                      <div>
                        <Label>Property</Label>
                        {chosen.propertyLabel && unit ? (
                          <LinkText onClick={() => ctx.go('properties', unit.id)}>{chosen.propertyLabel}</LinkText>
                        ) : (
                          <p className="text-body-sm text-text-primary">{chosen.propertyLabel ?? '—'}</p>
                        )}
                      </div>
                      <div>
                        <Label>Booking</Label>
                        {chosen.bookingNumber && chosen.bookingId ? (
                          <LinkText onClick={() => ctx.go('bookings', chosen.bookingId)}>{chosen.bookingNumber}</LinkText>
                        ) : (
                          <p className="text-body-sm text-text-primary">—</p>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2.5 border-l border-border-subtle pl-3">
                      <div>
                        <Label>Issued</Label>
                        <p className="text-body-sm text-text-primary">{longDay(chosen.issuedAt)}</p>
                      </div>
                      <div>
                        <Label>Due</Label>
                        <p className="text-body-sm text-text-primary">{longDay(chosen.dueAt)}</p>
                      </div>
                      <div>
                        <Label>Quotation</Label>
                        {chosen.quotationNumber && chosen.quotationId ? (
                          <LinkText icon="ext" onClick={() => ctx.go('quotations', chosen.quotationId)}>
                            {chosen.quotationNumber}
                          </LinkText>
                        ) : (
                          <p className="text-body-sm text-text-primary">—</p>
                        )}
                      </div>
                      <div>
                        <Label>Salesperson</Label>
                        <p className="text-body-sm text-text-primary">{lead.ownerName ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <p className="border-b border-border-subtle bg-bg-subtle/60 px-4 py-2 text-body-sm font-semibold text-text-primary">
                    Invoice items
                  </p>
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="text-text-secondary">
                        <th scope="col" className="px-4 py-1.5 text-left font-normal">Description</th>
                        <th scope="col" className="px-4 py-1.5 text-right font-normal">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border-subtle">
                        <td className="px-4 py-2 text-text-primary">{chosen.description}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-text-primary">{money(chosen.amount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </Card>

                <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
                  <div className="rounded-xl px-4 py-3" style={{ background: `color-mix(in oklab, ${BLUE} 8%, transparent)` }}>
                    <p className="text-body-sm font-semibold text-text-primary">Amount due</p>
                    <p className="text-[1.6rem] font-bold leading-tight tabular-nums text-text-primary">
                      {money(Math.max(0, chosen.amount - chosen.paidAmount))}
                    </p>
                  </div>
                  <Card className="px-4 py-2.5 text-body-sm">
                    <p className="font-semibold text-text-primary">Payment summary</p>
                    <p className="mt-1 flex justify-between text-text-secondary">
                      Verified received <span className="tabular-nums text-text-primary">{money(chosen.paidAmount)}</span>
                    </p>
                    <p className="flex justify-between text-text-secondary">
                      Outstanding{' '}
                      <span className="tabular-nums text-text-primary">{money(Math.max(0, chosen.amount - chosen.paidAmount))}</span>
                    </p>
                    <p className="flex items-center justify-between text-text-secondary">
                      Status <StatusPill status={chosen.status} />
                    </p>
                  </Card>
                </div>

                {/* ── The salesperson's half: sent, and the proof that came back ── */}
                <Card className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-body-sm text-text-primary">
                      {chosen.sentAt ? `Sent to the client on ${shortDay(chosen.sentAt)}` : 'Not sent to the client yet'}
                    </p>
                    {!chosen.sentAt && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void ctx.act(() => markInvoiceSentAction(lead.id, chosen.id), 'Marked as sent.')}
                        className="rounded-lg border border-border-default px-2.5 py-1 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                      >
                        Mark as sent
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
                    <p className="min-w-0 flex-1 text-caption text-text-secondary">
                      {chosen.receiptPath
                        ? `Payment receipt uploaded ${shortDay(chosen.receiptUploadedAt)} — proof for Finance, not a payment.`
                        : 'Upload the receipt the client sends back. Finance approves the payment from it.'}
                    </p>
                    {chosen.receiptPath && (
                      <button
                        type="button"
                        onClick={() => void open('invoice_receipt')}
                        className="text-caption font-semibold hover:underline"
                        style={{ color: BLUE }}
                      >
                        View
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => receiptRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                    >
                      <Upload className="size-3.5" aria-hidden="true" />
                      {chosen.receiptPath ? 'Replace receipt' : 'Upload receipt'}
                    </button>
                    <HiddenFile
                      inputRef={receiptRef}
                      onFile={(f) =>
                        void ctx.upload(
                          f,
                          prepareReceiptAction,
                          (path) =>
                            attachInvoiceReceiptAction({
                              leadId: lead.id,
                              invoiceId: chosen.id,
                              path,
                              title: f.name,
                              mime: f.type || 'application/pdf',
                              sizeBytes: f.size,
                            }),
                          'Receipt uploaded — Finance can approve it now.',
                        )
                      }
                    />
                  </div>
                  {items.canVerifyPayments && chosen.status !== 'paid' && chosen.status !== 'void' && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
                      <p className="min-w-0 flex-1 text-caption text-text-secondary">Finance · approve the payment</p>
                      <input
                        type="number"
                        min={0}
                        value={paid}
                        onChange={(e) => setPaid(e.target.value)}
                        placeholder={String(chosen.amount)}
                        aria-label="Amount received"
                        className="w-32 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1 text-caption tabular-nums focus:border-accent-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void ctx.act(
                            () => recordInvoicePaymentAction(lead.id, chosen.id, Number(paid || chosen.amount)),
                            'Payment approved.',
                          )
                        }
                        className="rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50"
                      >
                        Approve payment
                      </button>
                    </div>
                  )}
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Paperclip className="size-4 text-text-secondary" aria-hidden="true" />
                      <span className="text-body-sm text-text-primary">Attach invoice PDF</span>
                      <Toggle
                        on={attachPdf && !!chosen.pdfPath}
                        disabled={!chosen.pdfPath}
                        onChange={setAttachPdf}
                        label="Attach invoice PDF"
                      />
                    </div>
                    <p className="mt-0.5 pl-6 text-caption text-text-secondary">
                      {chosen.pdfPath ? (
                        'Payment verification is handled by Finance.'
                      ) : (
                        <>
                          No PDF yet.{' '}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => pdfRef.current?.click()}
                            className="font-medium hover:underline"
                            style={{ color: BLUE }}
                          >
                            Upload invoice PDF
                          </button>
                        </>
                      )}
                    </p>
                    <HiddenFile
                      inputRef={pdfRef}
                      onFile={(f) =>
                        void ctx.upload(
                          f,
                          prepareQuotationPdfAction,
                          (path) =>
                            attachInvoicePdfAction({
                              leadId: lead.id,
                              invoiceId: chosen.id,
                              path,
                              title: f.name,
                              mime: f.type || 'application/pdf',
                              sizeBytes: f.size,
                            }),
                          'Invoice PDF attached.',
                        )
                      }
                    />
                  </div>
                  {chosen.bookingId && <LinkText onClick={() => ctx.go('bookings', chosen.bookingId)}>View booking</LinkText>}
                </div>
              </Scroll>
            </>
          )
        }
      />
      <Foot
        left={
          <OutlineBlue icon={MessageSquareText} onClick={() => setAsking(true)} disabled={!chosen}>
            Request correction
          </OutlineBlue>
        }
        right={
          <>
            <Btn onClick={ctx.onClose}>Cancel</Btn>
            <Btn primary disabled={!chosen || busy} onClick={() => void attach()}>
              Attach invoice PDF
            </Btn>
          </>
        }
      />
      {adding && (
        <Sheet
          title={`New invoice${booking ? ` against ${booking.number}` : ''}${live ? ` · from ${live.number}` : ''}`}
          onClose={() => setAdding(false)}
        >
          {terms.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {terms.map((t) => {
                const on = description === t.label && Number(amount) === t.amount;
                return (
                  <button
                    key={t.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setDescription(t.label);
                      setAmount(String(t.amount));
                    }}
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
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is for" className={field} />
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (PKR)"
              className={field}
            />
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="Due date" className={field} />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn
              primary
              disabled={busy || !Number(amount) || !description.trim()}
              onClick={async () => {
                const ok = await ctx.act(
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
            >
              Raise invoice
            </Btn>
          </div>
        </Sheet>
      )}
      {asking && chosen && (
        <Sheet title={`Request a correction · ${chosen.number}`} onClose={() => setAsking(false)}>
          <textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="What is wrong? e.g. the due date should be 30 September."
            className={field}
          />
          <p className="mt-1.5 text-caption text-text-secondary">Goes to your sales manager, and is kept as a note on this lead.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setAsking(false)}>Cancel</Btn>
            <Btn
              primary
              disabled={busy || !note.trim()}
              onClick={async () => {
                const ok = await ctx.act(
                  () => requestFromManagerAction({ leadId: lead.id, kind: 'invoice', subject: chosen.number, note }),
                  'Correction requested.',
                );
                if (ok) {
                  setAsking(false);
                  setNote('');
                }
              }}
            >
              Send request
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}
