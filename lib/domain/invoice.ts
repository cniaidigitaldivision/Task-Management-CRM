/* ============================================================================
 * INVOICES — THE RULES, AND NOTHING ELSE
 * ----------------------------------------------------------------------------
 * Owner request 2026-08-29. Pure: no database, no React, no clock, no
 * randomness (doc 20 §1). Every figure that reaches a client is computed here,
 * which means the number in the PDF, the number in the form's live preview and
 * the number the server stores are the same number BY CONSTRUCTION rather than
 * because three places were written carefully.
 *
 * That is not a stylistic preference. This is the first thing in the product
 * whose output leaves the building — a client reads it, pays against it, and
 * files it. A rounding difference between the screen and the PDF is a
 * conversation about money.
 *
 * ⚠️ THIS FILE IS IMPORTED BY CLIENT COMPONENTS, so it must never import
 * anything `server-only`. Same rule as `lib/domain/library.ts`, and the same
 * trap: a `import type` is erased and would be fine, a VALUE is not.
 * ========================================================================= */

/* ==========================================================================
 * WHAT KIND OF INVOICE
 * ========================================================================== */

/**
 * ⚠️ MIRRORS `public.revenue_kind` EXACTLY. `advance` was added by migration
 * 075 — in its own migration, because Postgres refuses to use a new enum value
 * in the transaction that adds it. Adding a value here without adding it there
 * gives the form an option the database refuses.
 */
export const INVOICE_KINDS = ['retainer', 'add_on', 'one_off', 'advance'] as const;

export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/**
 * The owner's own words for each, and what each one actually means.
 *
 * ⚠️ THE DESCRIPTION IS NOT DECORATION. These four are easy to confuse — the
 * difference between an add-on and a one-off is whether the client already pays
 * a retainer, which is not deducible from the label. Getting it wrong misfiles
 * the income, and the revenue split by kind is what the monthly report reads.
 */
export const INVOICE_KIND_META: Readonly<
  Record<InvoiceKind, { label: string; description: string; token: string }>
> = {
  retainer: {
    label: 'Monthly invoice',
    description: 'The agreed package fee for one month. Amount and period fill in from the project.',
    token: 'status-done',
  },
  add_on: {
    label: 'Project add-on invoice',
    description: 'Extra work beyond the package, on a project that already pays a monthly fee.',
    token: 'status-progress',
  },
  one_off: {
    label: 'One-off project invoice',
    description: 'A standalone job for a client who pays no monthly retainer.',
    token: 'status-todo',
  },
  advance: {
    label: 'Advance / deposit invoice',
    description: 'Taken before work begins. The balance is invoiced separately on completion.',
    token: 'accent-gold',
  },
};

/** A kind if the string is one, null otherwise. A posted field is a claim. */
export function toInvoiceKind(value: string): InvoiceKind | null {
  return (INVOICE_KINDS as readonly string[]).includes(value) ? (value as InvoiceKind) : null;
}

/* ==========================================================================
 * THE NUMBER
 * ========================================================================== */

/** `CNI` + year + a four-digit counter. The counter comes from the database —
 *  see `app.claim_invoice_number`, which locks so two admins cannot collide. */
export function formatInvoiceNo(prefix: string, year: number, counter: number): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'INV';
  return `${safePrefix}-${year}-${String(counter).padStart(4, '0')}`;
}

/**
 * Whether a hand-typed override is usable as an invoice number.
 *
 * Deliberately permissive about SHAPE and strict about the things that break
 * something downstream: it goes in a filename, in an email subject and in a
 * `Content-Disposition` header, so a slash or a quote is not a style question.
 */
export function checkInvoiceNo(value: string): { ok: true } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: 'An invoice needs a number.' };
  if (trimmed.length > 40) {
    return { ok: false, message: 'That invoice number is too long — keep it under 40 characters.' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(trimmed)) {
    return {
      ok: false,
      message:
        'An invoice number can hold letters, digits, dashes, underscores and slashes only — it is used as a filename and in the email subject.',
    };
  }
  return { ok: true };
}

/* ==========================================================================
 * DATES
 * ========================================================================== */

/**
 * The day an invoice issued on `issuedOn` falls due.
 *
 * ⚠️ STRING ARITHMETIC VIA UTC, NEVER A LOCAL `Date`. `new Date('2026-09-01')`
 * is parsed as UTC midnight, and in Karachi (+05:00) that is still the 31st of
 * August at 7pm — so adding days through a local Date lands a day early for
 * five hours every evening. `Date.UTC` has no timezone to be wrong about, and
 * the result is formatted back as a plain `yyyy-mm-dd` that never becomes a
 * moment in time again. The same trap `lib/domain/finance.ts` avoids by not
 * constructing a Date at all, and the reason `karachi-not-utc` is written down.
 */
export function dueDateFor(issuedOn: string, termsDays: number): string {
  const year = Number(issuedOn.slice(0, 4));
  const month = Number(issuedOn.slice(5, 7));
  const day = Number(issuedOn.slice(8, 10));
  if (!year || !month || !day) return issuedOn;

  const days = Number.isFinite(termsDays) ? Math.max(0, Math.min(180, Math.trunc(termsDays))) : 10;
  const at = new Date(Date.UTC(year, month - 1, day + days));

  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(
    at.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Whole days from `today` until `dueOn`. Negative once it is overdue. */
export function daysUntilDue(dueOn: string, today: string): number {
  const ms = Date.UTC(
    Number(dueOn.slice(0, 4)),
    Number(dueOn.slice(5, 7)) - 1,
    Number(dueOn.slice(8, 10)),
  ) -
    Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10)),
    );
  return Math.round(ms / 86_400_000);
}

/** `2026-09-11` → `11 Sep 2026`. What the PDF and the row both print. */
export function longDate(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = Number(iso.slice(5, 7));
  return `${Number(iso.slice(8, 10))} ${MONTHS[month - 1] ?? '???'} ${iso.slice(0, 4)}`;
}

/** "Net 10 days", or "Due on receipt" when the terms are zero. */
export function termsLabel(days: number): string {
  return days <= 0 ? 'Due on receipt' : `Net ${days} day${days === 1 ? '' : 's'}`;
}

/* ==========================================================================
 * THE MONEY
 * ========================================================================== */

export interface InvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPricePkr: number;
}

export interface InvoiceTotals {
  readonly subtotalPkr: number;
  /** Null when no tax line is on the invoice — not zero. See below. */
  readonly taxRatePct: number | null;
  readonly taxPkr: number | null;
  readonly totalPkr: number;
}

/**
 * Round to whole rupees.
 *
 * ⚠️ The invoice is stored, printed and paid in whole rupees, so the rounding
 * happens ONCE, here, and every consumer takes the rounded figure. Rounding at
 * each display site instead is how a PDF comes to show a subtotal and a tax
 * that do not add up to its own total — each is individually correct and the
 * column does not sum.
 */
function rupees(value: number): number {
  return Math.round(value);
}

/**
 * What the invoice comes to.
 *
 * ⚠️ TAX IS NULL WHEN IT IS OFF, NOT ZERO, and the difference is visible to a
 * client. `null` means the invoice has no tax line at all and the PDF prints
 * only a total. `0` would mean "tax was applied, at nothing" and would print a
 * "GST @ 0%" row, which invites the question of why. The owner chose 16%
 * switched OFF by default, so `null` is the ordinary case.
 */
export function totalsFor(
  lines: readonly InvoiceLineInput[],
  taxRatePct: number | null,
): InvoiceTotals {
  const subtotal = rupees(
    lines.reduce((sum, line) => sum + line.quantity * line.unitPricePkr, 0),
  );

  if (taxRatePct === null || !Number.isFinite(taxRatePct)) {
    return { subtotalPkr: subtotal, taxRatePct: null, taxPkr: null, totalPkr: subtotal };
  }

  const rate = Math.max(0, Math.min(100, taxRatePct));
  const tax = rupees((subtotal * rate) / 100);

  return {
    subtotalPkr: subtotal,
    taxRatePct: rate,
    taxPkr: tax,
    /* ⚠️ SUM OF THE ROUNDED PARTS, not a rounding of the exact sum. The stored
       row carries all three and migration 076 constrains them to agree; taking
       the total independently is how they come to differ by a rupee and trip
       that constraint on an invoice somebody is trying to send. */
    totalPkr: subtotal + tax,
  };
}

/** One line's own total, for the row in the form and in the PDF. */
export function lineTotal(line: InvoiceLineInput): number {
  return rupees(line.quantity * line.unitPricePkr);
}

/* ==========================================================================
 * WHERE AN INVOICE STANDS
 * ========================================================================== */

/**
 * The document's own state — has it gone out — as opposed to the SETTLEMENT
 * state in `lib/domain/finance.ts`, which is about money arriving.
 *
 * ⚠️ TWO SEPARATE QUESTIONS, AND THE FINANCE MODULE ALREADY LEARNED THIS ONCE.
 * Its header records why billing state and settlement state cannot be one enum.
 * This is the same lesson one level up: "sent to the client" and "paid" are
 * independent, and an invoice can be any combination of the two. So this does
 * not extend `SettlementState`; the row shows both.
 */
export type InvoiceDispatch = 'draft' | 'sent' | 'overdue' | 'void';

export const DISPATCH_META: Readonly<
  Record<InvoiceDispatch, { label: string; token: string }>
> = {
  draft: { label: 'Not sent', token: 'status-backlog' },
  sent: { label: 'Sent', token: 'status-todo' },
  overdue: { label: 'Overdue', token: 'feedback-error' },
  void: { label: 'Void', token: 'status-cancelled' },
};

/**
 * ⚠️ `paidInFull` IS AN INPUT, and leaving it out was the first bug in this
 * function. An invoice past its due date that has already been paid is not
 * overdue — it is finished. Reading only the date turns every settled invoice
 * red a week after it was raised, and a screen where everything is red is a
 * screen nobody reads.
 */
export function dispatchOf(invoice: {
  voidedAt: string | null;
  sentAt: string | null;
  dueOn: string | null;
  paidInFull: boolean;
}, today: string): InvoiceDispatch {
  if (invoice.voidedAt) return 'void';
  if (!invoice.sentAt) return 'draft';
  if (!invoice.paidInFull && invoice.dueOn && daysUntilDue(invoice.dueOn, today) < 0) {
    return 'overdue';
  }
  return 'sent';
}

/* ==========================================================================
 * WHAT THE FORM MUST COLLECT
 * ========================================================================== */

export type Check = { readonly ok: true } | { readonly ok: false; readonly message: string };

const ok: Check = { ok: true };
const no = (message: string): Check => ({ ok: false, message });

/** How many lines one invoice may carry. Past this the PDF is unreadable and
 *  the request is almost certainly a mistake or an abuse. */
export const MAX_INVOICE_LINES = 40;

/** A rupee ceiling per line, so a typo of an extra zero is caught before it is
 *  emailed to a client rather than after. */
export const MAX_LINE_AMOUNT_PKR = 100_000_000;

/**
 * Everything that must be true before an invoice may be created.
 *
 * Run in the dialogue as you type and again in the server action. The client
 * copy is a courtesy; the server's is the decision.
 */
export function checkInvoice(input: {
  billedToName: string;
  billedToEmail: string;
  lines: readonly InvoiceLineInput[];
  issuedOn: string;
  dueOn: string;
  taxRatePct: number | null;
}): Check {
  if (!input.billedToName.trim()) {
    return no('Say who is being billed. It is the name printed at the top of the invoice.');
  }

  /* ⚠️ The address is required at CREATION, not at sending, deliberately. An
     invoice with no recipient is a document that can never be delivered, and
     discovering that at the moment you press Send — after the number has been
     claimed and the PDF drawn — is the wrong time to find out. */
  if (!input.billedToEmail.trim()) {
    return no('An email address is needed to send this invoice. Add one on the project, or type it here.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.billedToEmail.trim())) {
    return no(`“${input.billedToEmail.trim()}” is not an email address.`);
  }

  const lines = input.lines.filter((l) => l.description.trim() !== '');
  if (lines.length === 0) {
    return no('An invoice needs at least one line saying what is being charged for.');
  }
  if (lines.length > MAX_INVOICE_LINES) {
    return no(`An invoice can hold ${MAX_INVOICE_LINES} lines. Split it into two.`);
  }

  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return no(`“${line.description.trim()}” needs a quantity above zero.`);
    }
    if (!Number.isFinite(line.unitPricePkr) || line.unitPricePkr < 0) {
      return no(`“${line.description.trim()}” needs a rate of zero or more.`);
    }
    if (line.quantity * line.unitPricePkr > MAX_LINE_AMOUNT_PKR) {
      return no(
        `“${line.description.trim()}” comes to more than ${MAX_LINE_AMOUNT_PKR.toLocaleString('en-PK')} rupees. Check for an extra zero.`,
      );
    }
  }

  const totals = totalsFor(lines, input.taxRatePct);
  if (totals.totalPkr <= 0) {
    return no('This invoice comes to nothing. An invoice for zero is not something to send.');
  }

  if (!input.issuedOn || !input.dueOn) return no('An invoice needs an issue date and a due date.');
  if (input.dueOn < input.issuedOn) {
    return no('The due date is before the issue date. A client cannot pay an invoice before it exists.');
  }

  return ok;
}

/* ==========================================================================
 * THE SIGNATURE
 * ========================================================================== */

/**
 * The size ceiling for a drawn signature, in bytes.
 *
 * A signature pad at the size this application uses produces a PNG of a few
 * kilobytes. 512 KB is far above anything a pen stroke can generate and far
 * below anything worth worrying about — it exists to refuse a data URL that is
 * a photograph, not to be a tight fit.
 */
export const SIGNATURE_MAX_BYTES = 512 * 1024;

/** The `data:` prefix a canvas produces, and the only one accepted. */
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

/**
 * Turn what a signature pad produced into bytes, or refuse it.
 *
 * ⚠️ THE PREFIX IS CHECKED, NOT TRIMMED OFF AND TRUSTED. A `data:` URL carries
 * its own claimed type, and this one is written straight into a bucket and then
 * drawn into a PDF. `data:image/svg+xml` would be accepted by a naive split on
 * the comma — and an SVG is a document that can carry script. Only PNG, only
 * base64, and the bytes are checked for a PNG magic number afterwards by the
 * caller. The same reasoning that keeps SVG out of the avatar bucket.
 */
export function decodeSignature(dataUrl: string):
  | { ok: true; base64: string }
  | { ok: false; message: string } {
  const match = PNG_DATA_URL.exec(dataUrl.trim());
  if (!match) {
    return {
      ok: false,
      message: 'That signature could not be read. Draw it again — only a drawn PNG is accepted.',
    };
  }

  /* base64 is 4 characters per 3 bytes; close enough to check a ceiling
     without allocating the buffer first. */
  const approximateBytes = Math.floor((match[1].length * 3) / 4);
  if (approximateBytes > SIGNATURE_MAX_BYTES) {
    return { ok: false, message: 'That signature image is too large. Draw it again.' };
  }
  if (approximateBytes < 64) {
    return { ok: false, message: 'That signature is blank. Draw it before saving.' };
  }

  return { ok: true, base64: match[1] };
}

/* ==========================================================================
 * THE LETTERHEAD
 * ========================================================================== */

/**
 * What sits at the top of the PDF and in the "how to pay" block.
 *
 * ⚠️ EVERY FIELD IS OPTIONAL AND THE PDF OMITS WHAT IS BLANK. The alternative —
 * placeholder text — puts "Bank: [your bank]" on a document a client pays
 * against, or worse, an invented account number. A missing block is a gap
 * somebody notices and fills in; a wrong one is money sent to nobody.
 */
export interface CompanyLetterhead {
  readonly legalName: string;
  readonly division: string;
  readonly addressLines: readonly string[];
  readonly phone: string;
  readonly email: string;
  readonly website: string;
  readonly ntn: string;
  readonly strn: string;
  readonly bankName: string;
  readonly bankTitle: string;
  readonly bankAccount: string;
  readonly bankIban: string;
  readonly invoicePrefix: string;
  readonly defaultTaxRatePct: number;
  readonly taxLabel: string;
  readonly footerNote: string;
}

export const LETTERHEAD_FALLBACK: CompanyLetterhead = {
  legalName: 'Crescent Nova International',
  division: 'AI & Digital Division',
  addressLines: [],
  phone: '',
  email: '',
  website: '',
  ntn: '',
  strn: '',
  bankName: '',
  bankTitle: '',
  bankAccount: '',
  bankIban: '',
  invoicePrefix: 'CNI',
  defaultTaxRatePct: 16,
  taxLabel: 'GST',
  footerNote: 'Thank you for your business.',
};

/**
 * Read the stored setting into a letterhead, filling anything missing.
 *
 * ⚠️ Field by field rather than a spread over the fallback. The value is JSONB
 * that an Admin edits — a number where a string belongs, or a string where the
 * address array belongs, is not hypothetical — and `{...fallback, ...stored}`
 * would carry that straight through into a `.map()` on the address and throw
 * inside the PDF composer, several layers from the setting that caused it.
 */
export function readLetterhead(value: unknown): CompanyLetterhead {
  const raw = (value ?? {}) as Record<string, unknown>;
  const text = (key: keyof CompanyLetterhead, fallback: string): string =>
    typeof raw[key] === 'string' ? (raw[key] as string).trim() : fallback;

  const rate = Number(raw.defaultTaxRatePct);

  return {
    legalName: text('legalName', LETTERHEAD_FALLBACK.legalName) || LETTERHEAD_FALLBACK.legalName,
    division: text('division', LETTERHEAD_FALLBACK.division),
    addressLines: Array.isArray(raw.addressLines)
      ? raw.addressLines.filter((l): l is string => typeof l === 'string' && l.trim() !== '')
      : [],
    phone: text('phone', ''),
    email: text('email', ''),
    website: text('website', ''),
    ntn: text('ntn', ''),
    strn: text('strn', ''),
    bankName: text('bankName', ''),
    bankTitle: text('bankTitle', ''),
    bankAccount: text('bankAccount', ''),
    bankIban: text('bankIban', ''),
    invoicePrefix: text('invoicePrefix', 'CNI') || 'CNI',
    defaultTaxRatePct: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 16,
    taxLabel: text('taxLabel', 'GST') || 'GST',
    footerNote: text('footerNote', ''),
  };
}

/** Whether there is enough here to print a "how to pay" block at all. */
export function hasBankDetails(company: CompanyLetterhead): boolean {
  return Boolean(company.bankName || company.bankAccount || company.bankIban);
}
