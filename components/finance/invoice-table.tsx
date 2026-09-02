'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  Search,
  Send,
} from 'lucide-react';

import {
  sendInvoiceAction,
  voidInvoiceAction,
  type InvoiceResult,
} from '@/app/actions/invoices';
import type { BillingProfile, InvoiceRow } from '@/lib/db/queries/invoices';
import {
  DISPATCH_META,
  INVOICE_KIND_META,
  dispatchOf,
  longDate,
  type InvoiceDispatch,
} from '@/lib/domain/invoice';
import { REVENUE_STATUS_META, settlementOf } from '@/lib/domain/finance';
import { pkr } from '@/lib/domain/money';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { InvoiceDialog } from './invoice-dialog';

/* ============================================================================
 * THE INVOICES — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"Properly maintain data: whether the invoices are sent or not sent, pending,
 * or whatever the things are."*
 *
 * ── ⚠️ EVERY ROW CARRIES TWO BADGES, AND THAT IS THE POINT ─────────────────
 * "Sent" and "Paid" are independent facts and an invoice is any combination of
 * the two. `lib/domain/finance.ts` already learned this once — its header
 * records why billing state and settlement state cannot be one enum — and this
 * is the same lesson one level up:
 *
 *   DISPATCH     not sent / sent / overdue / void   — where the document is
 *   SETTLEMENT   not billed / awaiting / part paid / paid — where the money is
 *
 * One merged badge would have to choose which fact to hide, and whichever it
 * chose would be the one somebody needed.
 *
 * ── ⚠️ VOIDED ROWS ARE HERE AND NOWHERE ELSE ───────────────────────────────
 * The ledger, the client accounts and the statement all exclude them (migration
 * 076). This is the one screen where somebody asks "what happened to
 * CNI-2026-0004", so the row stays, struck through, with its reason.
 * ========================================================================= */

const EMPTY: InvoiceResult = { ok: false };

type Filter = 'all' | 'draft' | 'sent' | 'overdue' | 'paid' | 'void';

const FILTER_LABEL: Readonly<Record<Filter, string>> = {
  all: 'Everything',
  draft: 'Not sent',
  sent: 'Sent',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
};

export function InvoiceTable({
  invoices,
  projects,
  today,
  canIssue,
  signerName,
  signerTitle,
  hasSavedSignature,
  defaultTaxRatePct,
  taxLabel,
  thisMonth,
  onDone,
}: {
  invoices: readonly InvoiceRow[];
  projects: readonly BillingProfile[];
  today: string;
  canIssue: boolean;
  signerName: string;
  signerTitle: string | null;
  hasSavedSignature: boolean;
  defaultTaxRatePct: number;
  taxLabel: string;
  /** The division's current month, `YYYY-MM`, resolved on the server in Karachi. */
  thisMonth: string;
  onDone: (result: InvoiceResult) => void;
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [sending, setSending] = React.useState<InvoiceRow | null>(null);
  const [voiding, setVoiding] = React.useState<InvoiceRow | null>(null);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  /* ── ⚠️ OPENS ON THIS MONTH ────────────────────────────────────────────────
     Owner, 2026-09-02: *"for invoices or subscription, by default it should show
     this month's... There should be a dropdown or a filter over there so I can
     see previous month or a range of months."*

     Client-side, unlike the task board's window, and deliberately: there are
     single figures here, not hundreds of rows, so nothing is gained by making
     the server re-read and everything is gained by the period switching
     instantly. `'all'` is the escape hatch. */
  const [period, setPeriod] = React.useState<string>(thisMonth);

  const decorated = React.useMemo(
    () =>
      invoices.map((invoice) => ({
        invoice,
        dispatch: dispatchOf(
          {
            voidedAt: invoice.voidedAt,
            sentAt: invoice.sentAt,
            dueOn: invoice.dueOn,
            paidInFull: invoice.amountPkr > 0 && invoice.paidPkr >= invoice.amountPkr,
          },
          today,
        ),
        settlement: settlementOf({
          status: invoice.status as never,
          amountPkr: invoice.amountPkr,
          paidPkr: invoice.paidPkr,
        }),
      })),
    [invoices, today],
  );

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return decorated.filter(({ invoice, dispatch, settlement }) => {
      /* Billed by the month it was ISSUED, which is the month it appears in a
         client's own records — not `earnedOn`, which the ledger uses and which
         can sit in a different month from the paperwork. */
      if (period !== 'all' && invoice.issuedOn.slice(0, 7) !== period) return false;
      if (filter === 'paid' ? settlement !== 'received' : filter !== 'all' && dispatch !== filter) {
        return false;
      }
      if (!needle) return true;
      return `${invoice.invoiceNo} ${invoice.sourceName} ${invoice.billedToName ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [decorated, filter, query, period]);

  /* ── ⚠️ MONEY OWED FROM AN EARLIER MONTH IS NAMED, NEVER JUST HIDDEN ───────
     This tab exists to chase payment, and the code that loaded every invoice
     regardless of the range said so explicitly: an invoice raised in June and
     still unpaid has to be visible in September, or the filter hides exactly
     the debts worth chasing.

     A month default and that requirement are only in conflict if the hiding is
     silent. So the rows stay scoped to the month the owner asked for, and
     anything still outstanding beyond it gets counted and offered in one line.
     Nothing disappears; it just stops being in the way. */
  const owedOutside = React.useMemo(() => {
    if (period === 'all') return 0;
    return decorated.filter(
      ({ invoice, dispatch, settlement }) =>
        invoice.issuedOn.slice(0, 7) !== period &&
        dispatch !== 'void' &&
        dispatch !== 'draft' &&
        settlement !== 'received',
    ).length;
  }, [decorated, period]);

  /* Every month that actually carries an invoice, newest first, plus the current
     one so the default is always a real option even before anything is raised. */
  const months = React.useMemo(() => {
    const seen = new Set<string>([thisMonth]);
    for (const { invoice } of decorated) seen.add(invoice.issuedOn.slice(0, 7));
    return [...seen].sort().reverse();
  }, [decorated, thisMonth]);

  /* Only the states actually present, so no chip ever returns nothing — the same
     rule the library panel and the register follow. `all` is always offered. */
  const present = React.useMemo(() => {
    const seen = new Set<Filter>();
    for (const { dispatch, settlement } of decorated) {
      seen.add(dispatch as Filter);
      if (settlement === 'received') seen.add('paid');
    }
    return (['draft', 'sent', 'overdue', 'paid', 'void'] as const).filter((f) => seen.has(f));
  }, [decorated]);

  return (
    <div className="space-y-3">
      {/* ---- Controls ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 basis-[20rem] sm:max-w-[24rem]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by number or client…"
            aria-label="Search invoices"
            className={cn(
              'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        {/* The period. A plain select rather than a rail of chips: the list grows
            by one every month and a rail would eventually wrap past the search
            box, while a select stays one control however long the history. */}
        <select
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          aria-label="Invoice month"
          className={cn(
            'h-10 rounded-xl border border-border-default bg-bg-surface px-3',
            'text-body-sm text-text-primary',
            'focus-visible:border-border-brand focus-visible:outline-none',
          )}
        >
          {months.map((month) => (
            <option key={month} value={month}>
              {month === thisMonth ? 'This month' : monthLabel(month)}
            </option>
          ))}
          <option value="all">All time</option>
        </select>

        {canIssue && (
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
            Create invoice
          </Button>
        )}
      </div>

      {/* See `owedOutside`. One line, and it is a button, so the money is one
          press away rather than a thing somebody has to remember to look for. */}
      {owedOutside > 0 && (
        <button
          type="button"
          onClick={() => setPeriod('all')}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-caption',
            'border-border-default hover:bg-bg-hover',
          )}
          style={{ color: 'var(--feedback-warning)' }}
        >
          <AlertTriangle className="size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            {owedOutside === 1
              ? '1 invoice from another month is still unpaid.'
              : `${owedOutside} invoices from other months are still unpaid.`}{' '}
            <span className="underline">Show all time</span>
          </span>
        </button>
      )}

      <div role="radiogroup" aria-label="Invoice state" className="flex flex-wrap items-center gap-1.5">
        <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
          {FILTER_LABEL.all}
        </Chip>
        {present.map((key) => (
          <Chip key={key} on={filter === key} onClick={() => setFilter(key)}>
            {FILTER_LABEL[key]}
          </Chip>
        ))}
      </div>

      {/* ---- Rows ----------------------------------------------------------- */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        {shown.map(({ invoice, dispatch, settlement }, index) => (
          <Row
            key={invoice.id}
            invoice={invoice}
            dispatch={dispatch}
            settlement={settlement}
            first={index === 0}
            canIssue={canIssue}
            onSend={() => setSending(invoice)}
            onVoid={() => setVoiding(invoice)}
          />
        ))}

        {shown.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-body-sm text-text-secondary">
              {invoices.length === 0
                ? 'No invoices have been raised yet.'
                : `Nothing matches ${query ? `“${query}”` : 'that filter'}.`}
            </p>
            {invoices.length === 0 && canIssue && (
              <Button variant="secondary" size="md" className="mt-3" onClick={() => setCreating(true)}>
                <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
                Create the first invoice
              </Button>
            )}
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <p className="text-caption text-text-secondary">
          {shown.length === invoices.length
            ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`
            : `${shown.length} of ${invoices.length} invoices`}
        </p>
      )}

      {creating && (
        <InvoiceDialog
          projects={projects}
          today={today}
          signerName={signerName}
          signerTitle={signerTitle}
          hasSavedSignature={hasSavedSignature}
          defaultTaxRatePct={defaultTaxRatePct}
          taxLabel={taxLabel}
          onClose={() => setCreating(false)}
          onDone={(result) => {
            setCreating(false);
            onDone(result);
            router.refresh();
          }}
        />
      )}

      {sending && (
        <SendDialog
          invoice={sending}
          onClose={() => setSending(null)}
          onDone={(result) => {
            setSending(null);
            onDone(result);
            router.refresh();
          }}
        />
      )}

      {voiding && (
        <VoidDialog
          invoice={voiding}
          onClose={() => setVoiding(null)}
          onDone={(result) => {
            setVoiding(null);
            onDone(result);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full px-3.5 text-caption font-semibold',
        'transition-[background-color,color,border-color] duration-[120ms]',
        on
          ? 'bg-accent-primary text-text-on-brand'
          : 'border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function Badge({ label, token, muted }: { label: string; token: string; muted?: boolean }) {
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) ${muted ? 8 : 14}%, transparent)`,
        color: `var(--${token})`,
      }}
    >
      {label}
    </span>
  );
}

function Row({
  invoice,
  dispatch,
  settlement,
  first,
  canIssue,
  onSend,
  onVoid,
}: {
  invoice: InvoiceRow;
  dispatch: InvoiceDispatch;
  settlement: keyof typeof REVENUE_STATUS_META;
  first: boolean;
  canIssue: boolean;
  onSend: () => void;
  onVoid: () => void;
}) {
  const isVoid = dispatch === 'void';
  const href = `/api/invoice/${invoice.id}`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-bg-hover',
        !first && 'border-t border-border-subtle',
        isVoid && 'opacity-70',
      )}
    >
      {/* Number and client */}
      <div className="min-w-0 flex-1 basis-[15rem]">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'block truncate text-body-sm font-bold text-text-primary hover:underline',
            isVoid && 'line-through',
          )}
          title={`Open ${invoice.invoiceNo}`}
        >
          {invoice.invoiceNo}
        </a>
        <p className="truncate text-caption text-text-secondary">
          {invoice.billedToName ?? invoice.sourceName}
        </p>
        {/* ⚠️ The reason is on the row, not behind a tooltip. It is the only
            explanation there will be, and a voided invoice is exactly what
            somebody is looking at when they need it. */}
        {isVoid && invoice.voidReason && (
          <p className="truncate text-micro" style={{ color: 'var(--feedback-error)' }}>
            Void — {invoice.voidReason}
          </p>
        )}
      </div>

      <span className="hidden w-[9rem] shrink-0 text-caption text-text-secondary lg:block">
        {INVOICE_KIND_META[invoice.kind].label}
      </span>

      <span className="w-[7rem] shrink-0 text-caption text-text-secondary">
        <span className="block">{longDate(invoice.issuedOn)}</span>
        <span
          className="block text-micro"
          style={{ color: dispatch === 'overdue' ? 'var(--feedback-error)' : undefined }}
        >
          due {longDate(invoice.dueOn)}
        </span>
      </span>

      <span className="w-[8rem] shrink-0 text-right">
        <span className="block text-body-sm font-bold tabular-nums text-text-primary">
          {pkr(invoice.amountPkr)}
        </span>
        {/* Only when it differs from the total — repeating the same figure twice
            teaches people to stop reading the second one. */}
        {invoice.paidPkr > 0 && invoice.paidPkr < invoice.amountPkr && (
          <span className="block text-micro text-text-tertiary tabular-nums">
            {pkr(invoice.paidPkr)} in
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        <Badge label={DISPATCH_META[dispatch].label} token={DISPATCH_META[dispatch].token} />
        {!isVoid && (
          <Badge
            label={REVENUE_STATUS_META[settlement].label}
            token={REVENUE_STATUS_META[settlement].token}
            muted
          />
        )}
      </span>

      {/* Actions */}
      <span className="flex shrink-0 items-center gap-1.5">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${invoice.invoiceNo}`}
          title="Open the PDF in a new tab"
          className="grid size-9 place-items-center rounded-lg border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
        >
          <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </a>

        {canIssue && !isVoid && (
          <button
            type="button"
            onClick={onSend}
            aria-label={invoice.sentAt ? `Send ${invoice.invoiceNo} again` : `Send ${invoice.invoiceNo}`}
            title={
              invoice.sentAt
                ? `Sent ${invoice.sendCount} time${invoice.sendCount === 1 ? '' : 's'}, last to ${invoice.sentTo}`
                : 'Email it to the client'
            }
            className="grid size-9 place-items-center rounded-lg border border-border-default text-text-secondary hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
          >
            {invoice.sentAt ? (
              <Mail className="size-4" strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Send className="size-4" strokeWidth={2.25} aria-hidden="true" />
            )}
          </button>
        )}

        {canIssue && !isVoid && (
          <button
            type="button"
            onClick={onVoid}
            aria-label={`Void ${invoice.invoiceNo}`}
            title="Void this invoice"
            className="grid size-9 place-items-center rounded-lg border border-border-default text-text-secondary hover:border-[var(--feedback-error)] hover:bg-bg-hover hover:text-[var(--feedback-error)]"
          >
            <Ban className="size-4" strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  );
}

/* ==========================================================================
 * SENDING
 * ========================================================================== */

function SendDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onDone: (result: InvoiceResult) => void;
}) {
  const [state, formAction, pending] = React.useActionState(sendInvoiceAction, EMPTY);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={invoice.sentAt ? `Send ${invoice.invoiceNo} again` : `Send ${invoice.invoiceNo}`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" form="send-invoice-form" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {invoice.sentAt ? 'Send again' : 'Send to the client'}
          </Button>
        </>
      }
    >
      <form id="send-invoice-form" action={formAction} className="space-y-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        <div className="rounded-xl border border-border-subtle bg-bg-subtle p-3">
          <p className="flex justify-between text-body-sm">
            <span className="text-text-secondary">Billed to</span>
            <span className="font-semibold text-text-primary">{invoice.billedToName}</span>
          </p>
          <p className="flex justify-between text-body-sm">
            <span className="text-text-secondary">Amount</span>
            <span className="font-bold tabular-nums text-text-primary">{pkr(invoice.amountPkr)}</span>
          </p>
          <p className="flex justify-between text-body-sm">
            <span className="text-text-secondary">Due</span>
            <span className="text-text-primary">{longDate(invoice.dueOn)}</span>
          </p>
        </div>

        <Field
          label="Send to"
          htmlFor="to"
          hint="The PDF is attached. Change this only if their accounts address has moved."
        >
          <Input id="to" name="to" type="email" defaultValue={invoice.billedToEmail ?? ''} required />
        </Field>

        {/* ⚠️ Says what pressing the button cannot be undone. Every other
            confirmation in this product is about our own data; this one puts a
            document in somebody else's inbox. */}
        <p className="flex items-start gap-2 border-t border-border-subtle pt-3 text-micro leading-relaxed text-text-tertiary">
          <Send className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            {invoice.sentAt
              ? `This was already sent ${invoice.sendCount} time${invoice.sendCount === 1 ? '' : 's'}, last to ${invoice.sentTo}. The client will receive it as a reminder, with the same PDF.`
              : 'An email cannot be recalled. Open the PDF and read it before sending — after this the figures are frozen, and a mistake means voiding it and issuing a new one.'}
          </span>
        </p>
      </form>
    </Dialog>
  );
}

/* ==========================================================================
 * VOIDING
 * ========================================================================== */

function VoidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onDone: (result: InvoiceResult) => void;
}) {
  const [state, formAction, pending] = React.useActionState(voidInvoiceAction, EMPTY);
  const seen = React.useRef(false);
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  const hasPayments = invoice.paidPkr > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Void ${invoice.invoiceNo}`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant="danger"
            size="md"
            type="submit"
            form="void-invoice-form"
            disabled={pending || reason.trim() === '' || hasPayments}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Void this invoice
          </Button>
        </>
      }
    >
      <form id="void-invoice-form" action={formAction} className="space-y-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        {/* ⚠️ Said BEFORE they type a reason, not after they press the button.
            Money that arrived is refunded, not un-billed. */}
        {hasPayments && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-warning)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {pkr(invoice.paidPkr)} has been received against this invoice, so it cannot be voided.
            Money that arrived is refunded, not un-billed.
          </p>
        )}

        <p className="text-body-sm text-text-secondary">
          {invoice.sentAt
            ? `${invoice.billedToName} already has this invoice. Voiding it does not reach their copy — it records here that it should not be paid, and keeps the number so the series has no gap.`
            : 'This invoice has not been sent. Voiding it keeps the number so the series has no gap.'}
        </p>

        <Field
          label="Why"
          htmlFor="reason"
          hint="Required. Six months from now this is the only explanation there will be."
        >
          <Textarea
            id="reason"
            name="reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Wrong amount — reissued as the next invoice."
            maxLength={500}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** `2026-08` → `Aug 2026`. Written out so the select never shows a bare number
 *  somebody has to decode. */
function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}
