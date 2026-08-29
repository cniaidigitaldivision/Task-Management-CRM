import 'server-only';

import { withUser } from '@/lib/db/client';
import {
  LETTERHEAD_FALLBACK,
  formatInvoiceNo,
  readLetterhead,
  type CompanyLetterhead,
  type InvoiceKind,
} from '@/lib/domain/invoice';

/* ============================================================================
 * INVOICES — THE READS AND WRITES
 * ----------------------------------------------------------------------------
 * Owner request 2026-08-29. Migrations 075–077.
 *
 * ── ⚠️ NO ROLE CHECK LIVES IN THIS FILE, AND THAT IS CORRECT ───────────────
 * The same rule `lib/db/queries/finance.ts` states at length: every function
 * goes through `withUser`, `revenue_entries` and `invoice_lines` are both
 * Admin+ by policy, so a Coordinator calling any of these gets an empty array
 * or a refusal from Postgres without a single `if` here. The server actions
 * check `invoice.issue` as well — two layers, doc 16 §7 — and the database is
 * the one that cannot be forgotten.
 *
 * ── ⚠️ EVERY `numeric` ARRIVES AS A STRING ─────────────────────────────────
 * `pg` will not silently narrow a numeric to a float, so `amount_pkr` comes
 * back as `'139200.00'`. Without an explicit `Number()` every total downstream
 * CONCATENATES instead of adding, with no error at all. Same trap as the
 * ledger's, and it matters more here — this figure is printed on a document a
 * client pays against.
 *
 * ── ⚠️ `withUser` IS ALREADY ONE TRANSACTION ───────────────────────────────
 * See lib/db/client.ts. So `createInvoice` claiming a number, inserting the row
 * and inserting its lines is atomic without any ceremony: if a line is refused,
 * the number is not consumed and no half-invoice exists. That is why all three
 * statements are inside a single callback rather than three calls.
 * ========================================================================= */

/* ==========================================================================
 * WHAT AN INVOICE LOOKS LIKE COMING BACK
 * ========================================================================== */

export interface InvoiceLineRow {
  readonly id: string;
  readonly position: number;
  readonly description: string;
  readonly quantity: number;
  readonly unitPricePkr: number;
  readonly amountPkr: number;
}

export interface InvoiceRow {
  readonly id: string;
  readonly invoiceNo: string;
  readonly kind: InvoiceKind;
  readonly projectId: string | null;
  /** The project or client this was billed against, for the list. */
  readonly sourceName: string;

  readonly amountPkr: number;
  readonly subtotalPkr: number | null;
  readonly taxRatePct: number | null;
  readonly taxPkr: number | null;
  /** Maintained by migration 074's trigger. Never written from here. */
  readonly paidPkr: number;

  readonly earnedOn: string;
  readonly issuedOn: string;
  readonly dueOn: string;

  readonly billedToName: string | null;
  readonly billedToPerson: string | null;
  readonly billedToEmail: string | null;
  readonly billedToAddress: string | null;
  readonly clientNote: string | null;

  readonly sentAt: string | null;
  readonly sentTo: string | null;
  readonly sendCount: number;

  readonly voidedAt: string | null;
  readonly voidReason: string | null;

  readonly signedByName: string | null;
  readonly signedByTitle: string | null;
  /** ⚠️ A BOOLEAN, NOT THE PATH — the same rule receipts and library documents
   *  follow. A storage key is useless to a browser and handing one out invites
   *  somebody to build a URL from it. */
  readonly hasPdf: boolean;
  readonly hasSignature: boolean;

  readonly status: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

/** An invoice with everything needed to draw it. */
export interface InvoiceDetail extends InvoiceRow {
  readonly lines: readonly InvoiceLineRow[];
}

const num = (value: unknown): number => Number(value ?? 0);
const maybeNum = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

/** `yyyy-mm-dd` from whatever the driver returned for a `date`. */
const isoDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);

function toInvoice(row: Record<string, unknown>): InvoiceRow {
  return {
    id: row.id as string,
    invoiceNo: row.invoice_no as string,
    kind: row.kind as InvoiceKind,
    projectId: (row.project_id as string | null) ?? null,
    sourceName: (row.source_name as string | null) ?? 'Unattributed',

    amountPkr: num(row.amount_pkr),
    subtotalPkr: maybeNum(row.subtotal_pkr),
    taxRatePct: maybeNum(row.tax_rate_pct),
    taxPkr: maybeNum(row.tax_pkr),
    paidPkr: num(row.amount_paid_pkr),

    earnedOn: isoDate(row.earned_on),
    issuedOn: isoDate(row.issued_on),
    dueOn: isoDate(row.due_on),

    billedToName: (row.billed_to_name as string | null) ?? null,
    billedToPerson: (row.billed_to_person as string | null) ?? null,
    billedToEmail: (row.billed_to_email as string | null) ?? null,
    billedToAddress: (row.billed_to_address as string | null) ?? null,
    clientNote: (row.client_note as string | null) ?? null,

    sentAt: row.sent_at ? iso(row.sent_at) : null,
    sentTo: (row.sent_to as string | null) ?? null,
    sendCount: num(row.send_count),

    voidedAt: row.voided_at ? iso(row.voided_at) : null,
    voidReason: (row.void_reason as string | null) ?? null,

    signedByName: (row.signed_by_name as string | null) ?? null,
    signedByTitle: (row.signed_by_title as string | null) ?? null,
    hasPdf: Boolean(row.has_pdf),
    hasSignature: Boolean(row.has_signature),

    status: (row.status as string) ?? 'pending',
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: iso(row.created_at),
  };
}

/* The column list is written once. Two copies of it is how the list and the
   detail come to disagree about what an invoice has on it. */
const INVOICE_COLUMNS = `
  r.id, r.invoice_no, r.kind, r.project_id, r.amount_pkr, r.amount_paid_pkr,
  r.subtotal_pkr, r.tax_rate_pct, r.tax_pkr,
  r.earned_on, r.issued_on, r.due_on,
  r.billed_to_name, r.billed_to_person, r.billed_to_email, r.billed_to_address,
  r.client_note, r.sent_at, r.sent_to, r.send_count,
  r.voided_at, r.void_reason, r.signed_by_name, r.signed_by_title,
  r.status, r.created_at,
  (r.pdf_path is not null)       as has_pdf,
  (r.signature_path is not null) as has_signature,
  coalesce(p.name, r.client_name) as source_name,
  u.full_name as created_by_name
`;

/* ==========================================================================
 * READING
 * ========================================================================== */

/**
 * Every invoice, newest first.
 *
 * ⚠️ VOIDED ONES ARE INCLUDED HERE AND NOWHERE ELSE. The ledger, the client
 * accounts and the statement all exclude them (migration 076's reasoning). This
 * is the one screen where somebody asks "what happened to CNI-2026-0004", and
 * the answer has to be findable. The row renders struck through with its reason.
 */
export async function listInvoices(actorId: string): Promise<InvoiceRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select ${tx.unsafe(INVOICE_COLUMNS)}
      from public.revenue_entries r
      left join public.projects p on p.id = r.project_id
      left join public.users u on u.id = r.created_by_id
     where r.invoice_no is not null
     order by r.issued_on desc, r.created_at desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toInvoice);
}

/** One invoice and its lines — what the PDF composer and the detail panel read. */
export async function getInvoice(actorId: string, id: string): Promise<InvoiceDetail | null> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select ${tx.unsafe(INVOICE_COLUMNS)}
        from public.revenue_entries r
        left join public.projects p on p.id = r.project_id
        left join public.users u on u.id = r.created_by_id
       where r.id = ${id} and r.invoice_no is not null
    `;
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return null;

    const lines = await tx`
      select id, position, description, quantity, unit_price_pkr, amount_pkr
        from public.invoice_lines
       where revenue_id = ${id}
       order by position
    `;

    return {
      ...toInvoice(row),
      lines: (lines as Array<Record<string, unknown>>).map((l) => ({
        id: l.id as string,
        position: num(l.position),
        description: l.description as string,
        quantity: num(l.quantity),
        unitPricePkr: num(l.unit_price_pkr),
        amountPkr: num(l.amount_pkr),
      })),
    };
  });
}

/**
 * The storage keys for one invoice's document and signature.
 *
 * ⚠️ SEPARATE FROM `getInvoice`, deliberately, and the reason is the same one
 * `libraryDocumentPath` gives: a screen never receives storage paths it has no
 * use for. Only the two server paths that stream or draw the file call this.
 */
export async function invoiceFiles(
  actorId: string,
  id: string,
): Promise<{ pdfPath: string | null; signaturePath: string | null; invoiceNo: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select pdf_path, signature_path, invoice_no
      from public.revenue_entries where id = ${id} and invoice_no is not null
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row
    ? {
        pdfPath: (row.pdf_path as string | null) ?? null,
        signaturePath: (row.signature_path as string | null) ?? null,
        invoiceNo: row.invoice_no as string,
      }
    : null;
}

/* ==========================================================================
 * WHO IS BILLED — the auto-fill
 * ========================================================================== */

export interface BillingProfile {
  readonly projectId: string;
  readonly projectName: string;
  readonly billingName: string | null;
  readonly billingContact: string | null;
  readonly billingEmail: string | null;
  readonly billingPhone: string | null;
  readonly billingAddress: string | null;
  readonly paymentTermsDays: number;
  readonly monthlyFeePkr: number | null;
}

/**
 * Every project's billing details, for the form's auto-fill.
 *
 * ⚠️ ALL OF THEM IN ONE QUERY, not one per selection. The form fills in the
 * instant a project is chosen; a round trip on every change of a dropdown is a
 * form that stutters, and there are five projects.
 *
 * ⚠️ Drafts are excluded. An invoice against a project that does not exist yet
 * is not something anybody meant to do.
 */
export async function listBillingProfiles(actorId: string): Promise<BillingProfile[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, billing_name, billing_contact, billing_email, billing_phone,
           billing_address, payment_terms_days, monthly_fee_pkr
      from public.projects
     /* NO deleted_at FILTER. Migration 053 is titled "projects soft delete"
        and the column IS NOT IN THE DATABASE -- checked in information_schema,
        not assumed from the file on disk. Writing the filter anyway throws
        'column deleted_at does not exist' at the first person who opens the
        form. If 053 is ever really applied, add it here.
        (No backticks in here: this is inside a JS template literal, and one
         backtick ends the string.) */
     where is_draft = false
     order by name
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    projectId: row.id as string,
    projectName: row.name as string,
    billingName: (row.billing_name as string | null) ?? null,
    billingContact: (row.billing_contact as string | null) ?? null,
    billingEmail: (row.billing_email as string | null) ?? null,
    billingPhone: (row.billing_phone as string | null) ?? null,
    billingAddress: (row.billing_address as string | null) ?? null,
    paymentTermsDays: num(row.payment_terms_days),
    monthlyFeePkr: maybeNum(row.monthly_fee_pkr),
  }));
}

/** Save a project's billing details. Admin+ by the projects policy. */
export async function saveBillingProfile(
  actorId: string,
  projectId: string,
  input: {
    billingName: string | null;
    billingContact: string | null;
    billingEmail: string | null;
    billingPhone: string | null;
    billingAddress: string | null;
    paymentTermsDays: number;
  },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.projects
       set billing_name       = ${input.billingName},
           billing_contact    = ${input.billingContact},
           billing_email      = ${input.billingEmail},
           billing_phone      = ${input.billingPhone},
           billing_address    = ${input.billingAddress},
           payment_terms_days = ${input.paymentTermsDays}
     where id = ${projectId}
  `);
}

/* ==========================================================================
 * WRITING
 * ========================================================================== */

export interface NewInvoice {
  readonly kind: InvoiceKind;
  readonly projectId: string | null;
  readonly clientName: string | null;
  readonly amountPkr: number;
  readonly subtotalPkr: number;
  readonly taxRatePct: number | null;
  readonly taxPkr: number | null;
  readonly earnedOn: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly billedToName: string;
  readonly billedToPerson: string | null;
  readonly billedToEmail: string;
  readonly billedToAddress: string | null;
  readonly clientNote: string | null;
  readonly note: string | null;
  readonly signaturePath: string | null;
  readonly signedByName: string;
  readonly signedByTitle: string | null;
  readonly lines: ReadonlyArray<{
    description: string;
    quantity: number;
    unitPricePkr: number;
  }>;
  /** Typed by hand, or null to take the next one from the series. */
  readonly invoiceNoOverride: string | null;
}

/**
 * Create an invoice and its lines, and claim its number.
 *
 * ⚠️ THE NUMBER IS CLAIMED INSIDE THE SAME TRANSACTION AS THE INSERT, and that
 * ordering is the whole point. `app.claim_invoice_number` takes a row lock, so
 * two admins pressing Create in the same second serialise rather than both
 * being handed 0004 and one of them meeting a unique-index error. And because
 * `withUser` is one transaction, a line that is refused rolls the number back
 * with it — the series does not develop a hole because somebody typed a
 * negative quantity.
 *
 * ⚠️ AN OVERRIDE DOES NOT CONSUME A NUMBER. Somebody typing `GCRE/2026/09` is
 * numbering outside the series on purpose; advancing the counter anyway would
 * leave a gap that looks like a deleted invoice to whoever audits it later.
 */
export async function createInvoice(
  actorId: string,
  input: NewInvoice,
  prefix: string,
): Promise<{ id: string; invoiceNo: string }> {
  return withUser(actorId, async (tx) => {
    let invoiceNo = input.invoiceNoOverride?.trim() || '';

    if (!invoiceNo) {
      const year = Number(input.issuedOn.slice(0, 4));
      const claimed = await tx`select app.claim_invoice_number(${year}) as n`;
      const counter = Number((claimed as Array<Record<string, unknown>>)[0]?.n ?? 0);
      invoiceNo = formatInvoiceNo(prefix, year, counter);
    }

    const inserted = await tx`
      insert into public.revenue_entries (
        kind, project_id, client_name,
        amount_pkr, subtotal_pkr, tax_rate_pct, tax_pkr,
        earned_on, issued_on, due_on, invoice_no,
        billed_to_name, billed_to_person, billed_to_email, billed_to_address,
        client_note, note,
        signature_path, signed_by_id, signed_by_name, signed_by_title,
        /* 'invoiced', never 'pending'. A row with a number and a PDF has
           been billed by definition; 'pending' means "not billed yet", which is
           what the plain income form produces. Getting this wrong would put
           every invoice in the "not billed" bucket on the finance board. */
        status, created_by_id
      ) values (
        ${input.kind}, ${input.projectId}, ${input.clientName},
        ${input.amountPkr}, ${input.subtotalPkr}, ${input.taxRatePct}, ${input.taxPkr},
        ${input.earnedOn}, ${input.issuedOn}, ${input.dueOn}, ${invoiceNo},
        ${input.billedToName}, ${input.billedToPerson}, ${input.billedToEmail},
        ${input.billedToAddress},
        ${input.clientNote}, ${input.note},
        ${input.signaturePath}, ${actorId}, ${input.signedByName}, ${input.signedByTitle},
        'invoiced', ${actorId}
      )
      returning id
    `;

    const id = (inserted as Array<Record<string, unknown>>)[0]?.id as string | undefined;
    /* RLS refuses by returning no rows rather than raising, so a silent
       zero-row insert is what a Coordinator's attempt looks like. */
    if (!id) throw new Error('The invoice was not written.');

    /* `position` is 1-based and explicit, never the array index. The PDF and
       the screen both order by it, and an invoice whose lines reshuffle between
       the two is an invoice nobody trusts. */
    for (const [index, line] of input.lines.entries()) {
      await tx`
        insert into public.invoice_lines
          (revenue_id, position, description, quantity, unit_price_pkr)
        values
          (${id}, ${index + 1}, ${line.description}, ${line.quantity}, ${line.unitPricePkr})
      `;
    }

    return { id, invoiceNo };
  });
}

/**
 * Record where the generated PDF was stored, or clear it with null.
 *
 * Null rather than an empty string on a clear: `pdf_path is not null` is what
 * `has_pdf` reads, and '' is not null — the row would claim to have a document
 * that is not there.
 */
export async function setInvoicePdf(
  actorId: string,
  id: string,
  path: string | null,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.revenue_entries set pdf_path = ${path} where id = ${id}
  `);
}

/**
 * Record that the invoice went out.
 *
 * ⚠️ `send_count` INCREMENTS RATHER THAN BEING SET, and `sent_at` is the LATEST
 * send. A client who says "I never received it" is answered by these two
 * together — "sent three times, most recently on the 14th" — and a re-send that
 * overwrote the count would lose exactly that.
 */
export async function markInvoiceSent(actorId: string, id: string, to: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.revenue_entries
       set sent_at    = now(),
           sent_to    = ${to},
           send_count = send_count + 1
     where id = ${id}
  `);
}

/**
 * Void an invoice, with a reason.
 *
 * ⚠️ REFUSES ONCE MONEY HAS ARRIVED, in the WHERE clause rather than in a check
 * beforehand. A payment landing between the check and the update is a race that
 * would void an invoice somebody has paid — and an invoice with money against it
 * is not void, it is refunded, which is a different act with a different record.
 * Returning false rather than throwing lets the caller say so in words.
 */
export async function voidInvoice(
  actorId: string,
  id: string,
  reason: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.revenue_entries
       set voided_at    = now(),
           void_reason  = ${reason},
           voided_by_id = ${actorId}
     where id = ${id}
       and invoice_no is not null
       and voided_at is null
       and amount_paid_pkr = 0
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

/* ==========================================================================
 * THE SIGNATURE
 * ========================================================================== */

/** Where this person's saved signature lives, and their title for the PDF. */
export async function signerProfile(
  actorId: string,
): Promise<{ fullName: string; roleTitle: string | null; signaturePath: string | null }> {
  const rows = await withUser(actorId, (tx) => tx`
    select full_name, role_title, signature_path
      from public.users where id = ${actorId}
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return {
    fullName: (row?.full_name as string) ?? '',
    roleTitle: (row?.role_title as string | null) ?? null,
    signaturePath: (row?.signature_path as string | null) ?? null,
  };
}

/**
 * Save the signature this person will sign invoices with.
 *
 * ⚠️ ONLY EVER THEIR OWN ROW — `where id = ${actorId}`, not an id passed in.
 * A signature is the one piece of data in this product that stands for a
 * person, and a function that could write somebody else's is a function that
 * can forge one. There is deliberately no way to set another user's.
 */
export async function saveSignature(actorId: string, path: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users
       set signature_path = ${path}, signature_updated_at = now()
     where id = ${actorId}
  `);
}

/**
 * Forget it. Returns the old path so the caller can remove the stored object.
 *
 * ⚠️ THE SUBQUERY VERSION OF THIS WAS WRONG AND SILENTLY SO. Written as
 * `returning (select signature_path from users where id = ...)`, the subquery
 * reads the row the same statement has just updated and therefore returns the
 * NEW value — null, every time. The old object was then never removed and the
 * bucket quietly accumulated every signature anybody had ever replaced.
 *
 * `returning` on the updated row's OLD value is not available in Postgres, so
 * the read is a separate statement. `withUser` is one transaction, so the two
 * cannot interleave with anything else.
 */
export async function clearSignature(actorId: string): Promise<string | null> {
  return withUser(actorId, async (tx) => {
    const before = await tx`
      select signature_path from public.users where id = ${actorId}
    `;
    const path = ((before as Array<Record<string, unknown>>)[0]?.signature_path as string | null) ?? null;

    await tx`
      update public.users
         set signature_path = null, signature_updated_at = now()
       where id = ${actorId}
    `;
    return path;
  });
}

/* ==========================================================================
 * THE LETTERHEAD
 * ========================================================================== */

/** What goes at the top of the PDF. Falls back field by field — see
 *  `readLetterhead` for why not a spread. */
export async function companyLetterhead(actorId: string): Promise<CompanyLetterhead> {
  const rows = await withUser(actorId, (tx) => tx`
    select value from public.system_settings where key = 'invoice_company'
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? readLetterhead(row.value) : LETTERHEAD_FALLBACK;
}

/** Admin+ by the `system_settings_update` policy. */
export async function saveCompanyLetterhead(
  actorId: string,
  value: CompanyLetterhead,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.system_settings (key, value, updated_by_id)
    values ('invoice_company', ${tx.json(value as never)}, ${actorId})
    on conflict (key) do update
      set value = excluded.value,
          updated_by_id = excluded.updated_by_id,
          updated_at = now()
  `);
}
