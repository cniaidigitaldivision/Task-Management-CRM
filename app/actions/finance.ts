'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import * as F from '@/lib/db/queries/finance';
import * as C from '@/lib/db/queries/compensation';
import { listSalaried } from '@/lib/db/queries/compensation';
import { toolBoard } from '@/lib/db/queries/subscriptions';
import { safeFileName, validateUpload } from '@/lib/domain/attachments';
import { describeStorage, removeObject, signedUrl, uploadObject } from '@/lib/storage/bucket';
import { can } from '@/lib/domain/permissions';
import {
  buildExpenseReport,
  buildFinanceReport,
  buildIncomeReport,
  buildPayrollReport,
  buildToolsReport,
  describeFinanceFilters,
  financeCharts,
} from '@/lib/domain/finance-report';
import type { RevenuePayment } from '@/lib/domain/finance';
import {
  REVENUE_STATUS_META,
  byCategory,
  settlementOf,
  monthLabel,
  monthOf,
  monthlySeries,
  outstanding,
  totalsFor,
} from '@/lib/domain/finance';
import { EMPLOYMENT_META } from '@/lib/db/queries/compensation';
import { subtypeLabel } from '@/lib/domain/expense-subtypes';
import { reportFileStem, type Report } from '@/lib/domain/reports';
import { reportFileName, reportToCsv, reportToXlsx } from '@/lib/export/report-writers';
import { composeReportSheet } from '@/lib/pdf/report-sheet';
import { buildFinanceBoard, filterExpenses, priorPeriod } from '@/lib/view/finance-board';

/* ============================================================================
 * FINANCE — FILING, CORRECTING, POSTING, EXPORTING
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE COORDINATOR MAY FILE AND MAY NOT READ ───────────────────────────
 * Owner, 2026-08-26: *"the team coordinator can also add expenses. The list of
 * expenses, their report, or their analysis should only be visible to the admin
 * and the super admin."*
 *
 * `recordExpenseAction` therefore checks `finance.record_expense` (Coordinator
 * and above) while everything else checks `finance.view` or `finance.manage`
 * (Admin and above). These checks are a COURTESY — they produce a sentence
 * instead of a raised exception. The boundary is migration 064's four policies
 * on `public.expenses`, which is why `lib/db/queries/finance.ts` has no `if` in
 * it at all.
 *
 * ⚠️ `recordExpenseAction` returns a message and NEVER the row it wrote. See the
 * long note on `recordExpense` — a Coordinator has no SELECT on that table, so
 * reading anything back would fail for exactly the person the feature is for.
 * ========================================================================= */

export type FinanceResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * The failure half on its own.
 *
 * ⚠️ Named so that actions returning DATA on success can still share one
 * failure shape. Writing `{ ok: false; error: string }` inline in each of them
 * is how one of them ends up spelling it `message` and every caller that reads
 * `.error` silently shows `undefined`.
 */
export type FinanceFailure = Extract<FinanceResult, { ok: false }>;

function refresh(): void {
  revalidatePath('/finance');
  /* The dashboard's finance signal reads the same ledger. */
  revalidatePath('/dashboard');
}

/** `2026-08-26` — no clock in the domain layer, so it is read here. */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

/* ---------------------------------------------------------------------------
 * Reading a form
 * ------------------------------------------------------------------------- */

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function nullable(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

/**
 * A rupee amount from a text field.
 *
 * ⚠️ Commas and spaces are stripped BEFORE parsing. Somebody typing "18,400"
 * into a money field is not making a mistake, and `Number('18,400')` is `NaN` —
 * which without this would be rejected as "not a valid amount" and read as the
 * form being broken.
 *
 * ⚠️ Rejects negatives. The column has a `>= 0` check, so a negative would be
 * refused by Postgres with a constraint error instead of a sentence. Direction
 * is a property of which table a row is in, never of its sign.
 */
function money(form: FormData, key: string): number | null {
  const raw = str(form, key).replace(/[,\s]/g, '');
  if (raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chosen tool, or null when the person picked "Not listed".
 *
 * ⚠️ Checked against the uuid SHAPE rather than trusted. The picker sends the
 * literal `other` for an unlisted tool, and anything that is not an id must
 * become null — a foreign key violation is a 500, not a validation message.
 */
function subscriptionIdOrNull(form: FormData): string | null {
  const value = str(form, 'subscriptionId');
  return UUID.test(value) ? value : null;
}

function isoDate(form: FormData, key: string): string | null {
  const value = str(form, key);
  return ISO_DATE.test(value) ? value : null;
}

/* ---------------------------------------------------------------------------
 * Filing an expense — the Coordinator's one action
 * ------------------------------------------------------------------------- */

export async function recordExpenseAction(form: FormData): Promise<FinanceResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'finance.record_expense')) {
    return { ok: false, error: 'You cannot file an expense.' };
  }

  const storage = describeStorage();
  if (!storage.configured) {
    return { ok: false, error: storage.reason ?? 'File storage is not set up, so a receipt cannot be attached.' };
  }

  const categoryId = str(form, 'categoryId');
  const title = str(form, 'title');
  const amountPkr = money(form, 'amountPkr');
  const incurredOn = isoDate(form, 'incurredOn') ?? today();

  if (categoryId === '') return { ok: false, error: 'Choose a category.' };
  if (title === '') return { ok: false, error: 'Give the expense a short description.' };
  if (amountPkr === null) return { ok: false, error: 'Enter the amount as a number.' };
  if (amountPkr === 0) return { ok: false, error: 'An expense of zero is not worth recording.' };

  const paidOn = isoDate(form, 'paidOn');
  if (paidOn !== null && paidOn < incurredOn) {
    return { ok: false, error: 'It cannot have been paid before it was incurred.' };
  }

  const office = nullable(form, 'officeTeam');
  if (office !== null && office !== 'blue_area' && office !== 'wah') {
    return { ok: false, error: 'That is not one of the offices.' };
  }

  /* ── ⚠️ THE RECEIPT IS NOT OPTIONAL ────────────────────────────────────────
     Owner, 2026-08-26: *"Without a screenshot or things like that, it would not
     be acceptable that it's an expense."* Checked here for a readable sentence;
     the table's `expenses_manual_needs_receipt` is what actually guarantees it,
     so no future caller can skip this path and file a bare claim. */
  const file = form.get('receipt');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Attach the bill, slip or screenshot. An expense without proof is not recorded.' };
  }

  const receiptName = safeFileName(file.name);
  const check = validateUpload({ fileName: receiptName, mimeType: file.type, sizeBytes: file.size });
  if (!check.ok) return { ok: false, error: check.message };

  /* The subtype list is the form's, but "other" must always be explained —
     the table refuses it otherwise, and the sentence here is friendlier. */
  const subtype = nullable(form, 'subtype');
  const subtypeOther = nullable(form, 'subtypeOther');
  if (subtype === 'other' && subtypeOther === null) {
    return { ok: false, error: 'You chose Other — say what it was.' };
  }

  /* ⚠️ The id is generated here, not by the database: the storage path needs
     it, and the object is written before the row exists. Same reasoning as
     `uploadAttachmentAction`. */
  const receiptId = crypto.randomUUID();
  const path = `finance/receipts/${receiptId}/${receiptName}`;

  const stored = await uploadObject({
    path,
    body: await file.arrayBuffer(),
    contentType: file.type,
  });
  if (!stored.ok) return { ok: false, error: stored.message };

  try {
    await F.recordExpense(user.id, {
      categoryId,
      title,
      amountPkr,
      incurredOn,
      paidOn,
      vendor: nullable(form, 'vendor'),
      officeTeam: office,
      projectId: nullable(form, 'projectId'),
      note: nullable(form, 'note'),
      subtype,
      subtypeOther,
      subscriptionUserId: nullable(form, 'subscriptionUserId'),
      /* ⚠️ The tool picker's "Not listed" option sends the literal `other`,
         which is not a uuid — passing it through would fail the foreign key
         with a database error rather than recording the row. The name the
         person typed is already in `subtypeOther`. */
      subscriptionId: subscriptionIdOrNull(form),
      receiptPath: path,
      receiptName,
      receiptMime: file.type,
      receiptSizeBytes: file.size,
    });
  } catch (error) {
    /* ⚠️ The object is written BEFORE the row, so a refused insert leaves a
       file in the bucket nothing points at — invisible, permanent, and still
       reachable by anybody who can sign a link. Clean it up before reporting. */
    await removeObject(path).catch(() => {});
    const message =
      error instanceof Error && /posted automatically/.test(error.message)
        ? 'Salaries are posted from each person’s pay record and cannot be filed here.'
        : 'That expense could not be recorded.';
    return { ok: false, error: message };
  }

  /* ⚠️ Audited even though it is not privileged. A Coordinator files into a
     ledger they cannot read, so if a figure is later disputed the audit log is
     the ONLY record of who put it there — `created_by_id` says who, and this
     says when and from where. */
  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: 'finance.expense_filed',
    after: { title, amountPkr, incurredOn },
  });

  /* ── ⚠️ REVALIDATE ONLY FOR SOMEBODY WHO CAN SEE THE LEDGER ──────────────
     An Admin filing from the dialog wants their table to pick the row up. A
     Coordinator's finance page is a form and nothing else, so there is nothing
     to refresh — and revalidating it anyway REMOUNTS that form, which throws
     away the office and the date they just chose.

     Measured: the office came back blank after every successful file, even
     held in component state, because the state died with the remount. */
  if (can({ role: user.role, id: user.id }, 'finance.view')) refresh();

  /* ⚠️ A message, not the row. See this file's header. */
  return { ok: true, message: 'Recorded. Finance can see it.' };
}

/* ---------------------------------------------------------------------------
 * Correcting the books — Admin and above
 * ------------------------------------------------------------------------- */

/* ── ⚠️ THERE IS NO `updateExpenseAction`, AND THAT IS THE OWNER'S RULE ─────
   Owner, 2026-08-26: *"the whole expense can be deleted but it cannot be
   updated [...] Then I have to add a new record for that expense. I will not
   change that record."*

   A filed expense is a claim backed by a receipt. Editing the amount while the
   receipt stays put breaks the only thing that makes the row trustworthy, and
   does it silently. Deleting and re-filing leaves both acts in the audit log.

   `setExpensePaidAction` below is the single exception, and it amends nothing:
   it records that the same claim has now been settled. */

/**
 * Remove an expense, and the receipt with it.
 *
 * ⚠️ The object goes AFTER the row, not before. If the delete is refused the
 * file must still be there — a row pointing at a receipt that no longer exists
 * is worse than an orphaned file, because the screen would offer a link that
 * always fails.
 */
export async function deleteExpenseAction(id: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can remove a recorded expense.' };
  }

  const { receiptPath } = await F.deleteExpense(user.id, id);

  if (receiptPath) {
    /* A failure here leaves an orphaned object, which is untidy and harmless.
       Reporting it would tell somebody their delete failed when it did not. */
    await removeObject(receiptPath).catch(() => {});
  }

  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: 'finance.expense_deleted',
    after: { receiptRemoved: receiptPath !== null },
  });

  refresh();
  return { ok: true, message: 'Removed, with its receipt.' };
}

/**
 * A one-hour link to a row's receipt.
 *
 * ⚠️ Signed on demand rather than stored. The bucket is private precisely so
 * that a link cannot be forwarded and used forever; `receiptPathFor` returns
 * nothing for a row the reader cannot see, so this is authorised by RLS rather
 * than by a check here.
 */
export async function receiptUrlAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot open that receipt.' };
  }

  const found = await F.receiptPathFor(user.id, id);
  if (!found) return { ok: false, error: 'No receipt is attached to that expense.' };

  const link = await signedUrl(found.path);
  if (!link.ok) return { ok: false, error: link.message };
  return { ok: true, url: link.value };
}

/**
 * The same, for a piece of income's payment proof.
 *
 * ⚠️ HISTORY ONLY. Migration 073 moved evidence onto the individual payments,
 * because one column could not hold three instalments' worth. Rows written
 * before that still carry their own proof, and this is what still opens them.
 */
export async function proofUrlAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot open that proof.' };
  }

  const found = await F.proofPathFor(user.id, id);
  if (!found) return { ok: false, error: 'No proof is attached to that entry.' };

  const link = await signedUrl(found.path);
  if (!link.ok) return { ok: false, error: link.message };
  return { ok: true, url: link.value };
}

export interface ProofLink {
  readonly ok: true;
  readonly url: string;
  readonly name: string | null;
  /** So the viewer knows whether to draw an image or offer a download. */
  readonly mime: string | null;
}

/**
 * A signed link to one receipt's proof, with enough to display it.
 *
 * Owner, 2026-08-27: *"The proof you are seeing should display the image in a
 * pop-up, right? Don't bring me to another page."*
 *
 * ⚠️ Returns the MIME type as well as the URL, because the viewer cannot infer
 * it. A signed Supabase URL ends in a query string, so guessing from the
 * extension fails on exactly the files people upload most — a screenshot
 * pasted as `image/png` with no extension at all. The stored type is the only
 * reliable answer, and it decides between an `<img>` and a download link.
 *
 * ⚠️ Still `finance.view`, not `finance.manage`. Reading evidence is reading.
 */
export async function paymentProofUrlAction(id: string): Promise<ProofLink | FinanceFailure> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot open that proof.' };
  }

  const found = await F.paymentProofPathFor(user.id, id);
  if (!found) return { ok: false, error: 'No proof is attached to that payment.' };

  const link = await signedUrl(found.path);
  if (!link.ok) return { ok: false, error: link.message };
  return { ok: true, url: link.value, name: found.name, mime: found.mime };
}

/* ---------------------------------------------------------------------------
 * Money arriving — one invoice, as many receipts as it takes
 * ------------------------------------------------------------------------- */

const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'online', 'other'] as const;

/**
 * Record an instalment against an invoice.
 *
 * Owner, 2026-08-27: *"It's not possible that in some project they are giving
 * money in one go. Maybe they are giving two monies in pieces, two times or
 * three times, in one month."*
 *
 * ── ⚠️ PROOF IS MANDATORY, AND THE RULE IS UNCHANGED ───────────────────────
 * The owner's standard for expenses — *"It's not about trust, it's about
 * accuracy"* — applies at least as hard to money claimed to have arrived. Every
 * receipt carries its own evidence; migration 073 moved the column here for
 * exactly that reason, so the second instalment cannot ride on the first one's
 * screenshot.
 *
 * ── ⚠️ NOTHING HERE UPDATES THE INVOICE ────────────────────────────────────
 * The collected total, the status and the settlement date are maintained by
 * `sync_revenue_settlement` (migration 074). An action that also wrote them
 * would be a second writer of a derived value, which is how two figures for one
 * invoice appear on one screen.
 */
export async function recordPaymentAction(form: FormData): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can record a payment.' };
  }

  const revenueId = nullable(form, 'revenueId');
  if (revenueId === null) return { ok: false, error: 'That invoice could not be found.' };

  const amountPkr = money(form, 'amountPkr');
  if (amountPkr === null) return { ok: false, error: 'Enter the amount as a number.' };
  if (amountPkr <= 0) return { ok: false, error: 'A payment has to be more than zero.' };

  const receivedOn = isoDate(form, 'receivedOn') ?? today();
  /* ⚠️ A future date is refused. Recording money that has not arrived is the
     one way this ledger can claim a cash position the bank does not have. */
  if (receivedOn > today()) {
    return { ok: false, error: 'That date is in the future. Record it when the money lands.' };
  }

  const method = str(form, 'method');
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: 'Say how the money arrived.' };
  }

  /* ── Proof, uploaded before the row is written ──────────────────────────
     ⚠️ In this order deliberately: an object with no row is an orphan the
     cleanup below removes, while a row with no object is a receipt that claims
     evidence and cannot produce it. The first is tidier to recover from. */
  const file = form.get('proof');
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      error: 'Attach the bank message, screenshot or receipt for this payment.',
    };
  }

  const storage = describeStorage();
  if (!storage.configured) {
    return { ok: false, error: storage.reason ?? 'File storage is not set up.' };
  }

  const name = safeFileName(file.name);
  const check = validateUpload({ fileName: name, mimeType: file.type, sizeBytes: file.size });
  if (!check.ok) return { ok: false, error: check.message };

  const path = `finance/proof/${crypto.randomUUID()}/${name}`;
  const stored = await uploadObject({
    path,
    body: await file.arrayBuffer(),
    contentType: file.type,
  });
  if (!stored.ok) return { ok: false, error: stored.message };

  try {
    await F.recordPayment(user.id, {
      revenueId,
      amountPkr,
      receivedOn,
      method: method as (typeof PAYMENT_METHODS)[number],
      reference: nullable(form, 'reference'),
      note: nullable(form, 'note'),
      proofPath: path,
      proofName: name,
      proofMime: file.type,
      proofSizeBytes: file.size,
    });
  } catch (error) {
    /* The write was refused. A freshly uploaded object must not be left
       behind — nothing points at it and nobody could ever find it. */
    await removeObject(path).catch(() => {});

    const message = error instanceof Error ? error.message : '';

    /* ⚠️ 065's rule: a payment may not predate the month the work was earned
       in. The constraint's name is not a sentence, so it is turned into one —
       otherwise somebody sees `revenue_received_in_month_or_later` and has no
       idea what to change. */
    if (/revenue_received_in_month_or_later/.test(message)) {
      return {
        ok: false,
        error:
          'That date falls before the month this was earned in. Check the date, or correct the invoice’s earned month.',
      };
    }
    return { ok: false, error: 'That payment could not be recorded.' };
  }

  await auditAlone(user, {
    entityType: 'finance',
    entityId: revenueId,
    action: 'finance.payment_recorded',
    after: { amountPkr, receivedOn, method },
  });

  refresh();
  return { ok: true, message: 'Payment recorded.' };
}

/**
 * Remove a receipt entered in error.
 *
 * ⚠️ The invoice repairs itself: the trigger recomputes the collected total and
 * walks the status back to `invoiced` rather than to `pending`, because the
 * bill was certainly issued. Migration 074 records why.
 */
export async function deletePaymentAction(id: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can remove a payment.' };
  }

  const removed = await F.deletePayment(user.id, id);
  if (!removed) return { ok: false, error: 'That payment was already gone.' };

  /* ⚠️ The object goes AFTER the row, and a failure here is swallowed. The
     ledger is the record; an orphaned file in a private bucket is untidy, and
     failing the whole action over it would leave the payment standing. */
  if (removed.proofPath) await removeObject(removed.proofPath).catch(() => {});

  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: 'finance.payment_removed',
  });

  refresh();
  return { ok: true, message: 'Payment removed.' };
}

/** Every receipt against one invoice, for the drill-down. */
export async function listPaymentsAction(
  revenueId: string,
): Promise<{ ok: true; payments: readonly RevenuePayment[] } | FinanceFailure> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot view payments.' };
  }
  return { ok: true, payments: await F.listPayments(user.id, revenueId) };
}

export async function setExpensePaidAction(id: string, paid: boolean): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can settle a bill.' };
  }

  try {
    await F.setExpensePaid(user.id, id, paid ? today() : null);
  } catch (error) {
    return { ok: false, error: settlementMessage(error) };
  }

  refresh();
  return { ok: true, message: paid ? 'Marked as paid.' : 'Marked as unpaid.' };
}

/* ---------------------------------------------------------------------------
 * Income — Admin and above, typed by hand
 * ------------------------------------------------------------------------- */

const REVENUE_KINDS = ['retainer', 'one_off', 'add_on'] as const;

export async function recordRevenueAction(form: FormData): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can record income.' };
  }

  const kind = str(form, 'kind');
  const amountPkr = money(form, 'amountPkr');
  const earnedOn = isoDate(form, 'earnedOn') ?? today();
  const projectId = nullable(form, 'projectId');
  const clientName = nullable(form, 'clientName');

  if (!(REVENUE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'Choose what kind of income this is.' };
  }
  if (amountPkr === null) return { ok: false, error: 'Enter the amount as a number.' };
  if (amountPkr === 0) return { ok: false, error: 'Income of zero is not worth recording.' };

  /* ⚠️ Checked here as well as by the table's own constraint, because the
     constraint's message is `revenue_has_a_source` and this one is a sentence. */
  if (projectId === null && clientName === null) {
    return { ok: false, error: 'Say which project or client this came from.' };
  }

  const receivedOn = isoDate(form, 'receivedOn');
  if (receivedOn !== null && receivedOn < earnedOn) {
    return { ok: false, error: 'It cannot have been received before it was earned.' };
  }

  /* ⚠️ Only `pending` or `invoiced` may be set at creation. `received` demands
     proof, and this form does not collect one — that transition happens from
     the Income tab, where the bank message is attached. The table would refuse
     it anyway; this is the readable half. */
  const openingStatus = str(form, 'status') === 'invoiced' ? 'invoiced' : 'pending';

  await F.recordRevenue(user.id, {
    kind: kind as (typeof REVENUE_KINDS)[number],
    projectId,
    clientName,
    serviceId: nullable(form, 'serviceId'),
    amountPkr,
    earnedOn,
    receivedOn,
    invoiceRef: nullable(form, 'invoiceRef'),
    note: nullable(form, 'note'),
    status: openingStatus,
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: 'finance.revenue_recorded',
    after: { kind, amountPkr, earnedOn },
  });

  refresh();
  return { ok: true, message: 'Income recorded.' };
}

export async function updateRevenueAction(id: string, form: FormData): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can change recorded income.' };
  }

  const kind = str(form, 'kind');
  const amountPkr = money(form, 'amountPkr');
  const earnedOn = isoDate(form, 'earnedOn');
  const projectId = nullable(form, 'projectId');
  const clientName = nullable(form, 'clientName');

  if (!(REVENUE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'Choose what kind of income this is.' };
  }
  if (amountPkr === null) return { ok: false, error: 'Enter the amount as a number.' };
  if (earnedOn === null) return { ok: false, error: 'Enter a valid date.' };
  if (projectId === null && clientName === null) {
    return { ok: false, error: 'Say which project or client this came from.' };
  }

  await F.updateRevenue(user.id, id, {
    kind: kind as (typeof REVENUE_KINDS)[number],
    projectId,
    clientName,
    serviceId: nullable(form, 'serviceId'),
    amountPkr,
    earnedOn,
    receivedOn: isoDate(form, 'receivedOn'),
    invoiceRef: nullable(form, 'invoiceRef'),
    note: nullable(form, 'note'),
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: 'finance.revenue_edited',
    after: { kind, amountPkr, earnedOn },
  });

  refresh();
  return { ok: true, message: 'Updated.' };
}

export async function deleteRevenueAction(id: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can remove recorded income.' };
  }

  await F.deleteRevenue(user.id, id);
  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: 'finance.revenue_deleted',
  });

  refresh();
  return { ok: true, message: 'Removed.' };
}

const REVENUE_STATUSES = ['pending', 'invoiced', 'received', 'returned', 'written_off'] as const;

/**
 * Move a piece of income to a new status.
 *
 * ── ⚠️ `received` DEMANDS PROOF ─────────────────────────────────────────────
 * Owner, 2026-08-26: *"when I say that its status changes to received, then I
 * have to give some check, some screenshot, or a receiving message."*
 *
 * The upload happens here and the table refuses the transition without it, so
 * the two cannot drift. Every other status is a statement about where things
 * stand and needs no document.
 */
export async function setRevenueStatusAction(
  id: string,
  form: FormData,
): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can change how income stands.' };
  }

  const status = str(form, 'status');
  if (!(REVENUE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'That is not a status.' };
  }
  const next = status as (typeof REVENUE_STATUSES)[number];

  const receivedOn = isoDate(form, 'receivedOn') ?? today();
  const note = nullable(form, 'statusNote');

  let proof: { path: string; name: string; mime: string; sizeBytes: number } | null = null;

  const file = form.get('proof');
  if (file instanceof File && file.size > 0) {
    const storage = describeStorage();
    if (!storage.configured) {
      return { ok: false, error: storage.reason ?? 'File storage is not set up.' };
    }

    const name = safeFileName(file.name);
    const check = validateUpload({ fileName: name, mimeType: file.type, sizeBytes: file.size });
    if (!check.ok) return { ok: false, error: check.message };

    const path = `finance/proof/${crypto.randomUUID()}/${name}`;
    const stored = await uploadObject({
      path,
      body: await file.arrayBuffer(),
      contentType: file.type,
    });
    if (!stored.ok) return { ok: false, error: stored.message };
    proof = { path, name, mime: file.type, sizeBytes: file.size };
  }

  try {
    await F.setRevenueStatus(user.id, id, next, { on: receivedOn, note, proof });
  } catch (error) {
    /* The row already had proof on file, or the transition was refused. Either
       way a freshly uploaded object must not be left behind. */
    if (proof) await removeObject(proof.path).catch(() => {});

    const refused =
      error instanceof Error && /revenue_received_needs_proof/.test(error.message);
    return {
      ok: false,
      error: refused
        ? 'Attach the receipt, bank message or screenshot before marking this received.'
        : 'That status could not be set.',
    };
  }

  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: 'finance.revenue_status_set',
    after: { status: next, proofAttached: proof !== null },
  });

  refresh();
  return { ok: true, message: `Marked as ${next.replace('_', ' ')}.` };
}

/* ---------------------------------------------------------------------------
 * Payroll
 * ------------------------------------------------------------------------- */

/**
 * Settle one person's salary for a month, or un-settle it.
 *
 * ⚠️ Takes the LEDGER ROW's id, not the person's. The obligation is the posted
 * expense; a person has no payment state of their own, and inventing one would
 * be a second record of the same fact — see `payrollMonth`.
 */
export async function setSalaryPaidAction(
  expenseId: string,
  paid: boolean,
): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can settle payroll.' };
  }

  try {
    await F.setExpensePaid(user.id, expenseId, paid ? today() : null);
  } catch (error) {
    return { ok: false, error: settlementMessage(error) };
  }

  refresh();
  revalidatePath('/finance');
  return { ok: true, message: paid ? 'Marked as paid.' : 'Marked as unpaid.' };
}

/**
 * A refused settlement, as a sentence.
 *
 * ⚠️ This exists because a raw `PostgresError` crossing a server action does
 * not become a message — it becomes an error overlay on the whole page. Pressing
 * "Pay all" on 26 August did exactly that: the constraint fired, the page broke,
 * and nothing said which date was the problem. Migration 068 fixed the rule; this
 * makes the remaining legitimate refusal readable.
 */
function settlementMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/paid_in_month_or_later|received_in_month_or_later/.test(text)) {
    return 'That payment date is in a month before the cost belongs to. Money cannot leave before the month it pays for.';
  }
  return 'That could not be settled.';
}

/** Settle every unpaid salary for a month. */
export async function payAllSalariesAction(month: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can settle payroll.' };
  }
  if (!MONTH_KEY.test(month)) return { ok: false, error: 'That is not a month.' };

  let settled: number;
  try {
    settled = await F.payAllSalaries(user.id, month, today());
  } catch (error) {
    return { ok: false, error: settlementMessage(error) };
  }

  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: 'finance.payroll_paid_all',
    after: { month, settled },
  });

  refresh();
  return {
    ok: true,
    message:
      settled === 0
        ? 'Everyone was already marked paid for that month.'
        : `Marked ${settled} ${settled === 1 ? 'salary' : 'salaries'} as paid.`,
  };
}

/**
 * Set what somebody is paid, and how they are engaged.
 *
 * ⚠️ Writes a `salary_history` row whenever the figure or the type actually
 * moves — see `setSalary`. Without it, "what was she on before April?" has no
 * answer, because the current-figure table has only one number per person.
 */
export async function setSalaryAction(form: FormData): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can change what somebody is paid.' };
  }

  const userId = str(form, 'userId');
  const monthlySalary = money(form, 'monthlySalary');
  const employmentType = str(form, 'employmentType');

  if (userId === '') return { ok: false, error: 'Choose a person.' };
  if (monthlySalary === null) return { ok: false, error: 'Enter the salary as a number.' };

  const TYPES = ['full_time', 'probation', 'intern', 'contract', 'owner'] as const;
  if (!(TYPES as readonly string[]).includes(employmentType)) {
    return { ok: false, error: 'Choose how this person is engaged.' };
  }

  await C.setSalary(user.id, {
    userId,
    monthlySalary,
    employmentType: employmentType as (typeof TYPES)[number],
    reviewDueOn: isoDate(form, 'reviewDueOn'),
    reason: nullable(form, 'reason'),
    effectiveFrom: isoDate(form, 'effectiveFrom') ?? `${monthOf(today())}-01`,
    note: nullable(form, 'note'),
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: userId,
    action: 'finance.salary_set',
    after: { monthlySalary, employmentType },
  });

  refresh();
  revalidatePath('/team');
  return { ok: true, message: 'Saved.' };
}

/* ---------------------------------------------------------------------------
 * Posting a month
 * ------------------------------------------------------------------------- */

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Post one month's payroll and tool costs.
 *
 * ⚠️ Safe to press twice — the partial unique index `expenses_run_once` makes
 * the second run a no-op. The message says how many rows were actually written,
 * so pressing it again reads as "0 posted" rather than as a silent success that
 * might have doubled the books.
 */
export async function runMonthAction(month: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can post a month.' };
  }
  if (!MONTH_KEY.test(month)) return { ok: false, error: 'That is not a month.' };

  /* ⚠️ A future month cannot be posted. Salaries not yet earned are not costs,
     and posting them would show a loss that has not happened. */
  if (month > monthOf(today())) {
    return { ok: false, error: 'That month has not happened yet.' };
  }

  const result = await F.runMonth(user.id, month);
  const total = result.salariesPosted + result.subscriptionsPosted;

  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: 'finance.month_posted',
    after: { month, ...result },
  });

  refresh();

  if (total === 0) {
    return { ok: true, message: 'Already posted — nothing changed.' };
  }
  return {
    ok: true,
    message: `Posted ${result.salariesPosted} salaries and ${result.subscriptionsPosted} subscription lines.`,
  };
}

/** Undo a posted run. Anything typed by a person is untouched. */
export async function unpostMonthAction(month: string): Promise<FinanceResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.manage')) {
    return { ok: false, error: 'Only an Admin can unpost a month.' };
  }
  if (!MONTH_KEY.test(month)) return { ok: false, error: 'That is not a month.' };

  const removed = await F.unpostMonth(user.id, month);

  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: 'finance.month_unposted',
    after: { month, removed },
  });

  refresh();
  return { ok: true, message: `Removed ${removed} posted rows. Nothing typed by hand was touched.` };
}

/* ---------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

export interface FinanceExport {
  readonly ok: true;
  readonly fileName: string;
  readonly content: string;
  readonly encoding: 'text' | 'base64';
  readonly rowCount: number;
}

export interface FinanceExportRequest {
  readonly from: string;
  readonly to: string;
  readonly rangeLabel: string;
  readonly category: string;
  readonly office: string;
  readonly query: string;
  readonly settled: string;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  /**
   * Which screen was open.
   *
   * ⚠️ Owner, 2026-08-26: *"when I click Export, the tab we have opened, the
   * data I'm watching, and the filter I'm applying, that thing will only be
   * exported."* Exporting the whole ledger from the Payroll tab is the kind of
   * mismatch that makes somebody stop trusting every other export.
   */
  readonly scope: 'overview' | 'expenses' | 'income' | 'payroll' | 'tools';
  /** For the payroll scope, which month is on screen. */
  readonly month?: string;
  /** For the income scope, which status filter is applied. */
  readonly status?: string;
}

/**
 * The ledger as a file, through the Reports page's own print sheet.
 *
 * ── ⚠️ REBUILT SERVER-SIDE, NOT TAKEN FROM THE BROWSER ──────────────────────
 * The client sends what it was LOOKING at — the range and the filters — and this
 * re-reads and re-derives from them through the SAME `filterExpenses` the table
 * uses, so the file holds exactly the rows on screen. It never accepts rows or
 * figures: a report posted back could claim any numbers at all, and this is the
 * artefact that leaves the building with the division's name on it.
 */
export async function exportFinanceAction(
  request: FinanceExportRequest,
): Promise<FinanceExport | { ok: false; error: string }> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot export the ledger.' };
  }
  if (!['csv', 'xlsx', 'pdf'].includes(request.format)) {
    return { ok: false, error: 'Unknown export format.' };
  }
  if (!ISO_DATE.test(request.from) || !ISO_DATE.test(request.to)) {
    return { ok: false, error: 'That is not a date range.' };
  }

  const [expenses, revenue] = await Promise.all([
    F.listExpenses(user.id, request.from, request.to),
    F.listRevenue(user.id, request.from, request.to),
  ]);

  const settled =
    request.settled === 'paid' || request.settled === 'unpaid' ? request.settled : 'all';

  const filtered = filterExpenses(expenses, {
    category: request.category,
    office: request.office,
    query: request.query,
    settled,
  });

  /* ⚠️ Income is filtered by the text box only. Category and office are
     properties an expense has and income does not — silently dropping every
     income row when somebody filters by "Utility bills" would make the export's
     net wrong in a way nobody would notice. */
  const needle = request.query.trim().toLowerCase();
  const revenueRows =
    needle === ''
      ? revenue
      : revenue.filter((r) => r.sourceName.toLowerCase().includes(needle));

  const input = {
    expenses: filtered,
    revenue: revenueRows,
    totals: totalsFor(filtered, revenueRows),
    categories: byCategory(filtered),
    series: monthlySeries(filtered, revenueRows, monthOf(request.from), monthOf(request.to)),
    outstanding: outstanding(filtered, revenueRows),
    from: request.from,
    to: request.to,
    rangeLabel: request.rangeLabel,
    filters: describeFinanceFilters({
      category: request.category,
      office: request.office,
      direction: settled === 'all' ? 'all' : settled === 'paid' ? 'Settled only' : 'Unsettled only',
      query: request.query,
    }),
  };

  /* ── ⚠️ THE REPORT IS THE SCREEN THAT WAS OPEN ─────────────────────────────
     Owner, 2026-08-26: *"the tab we have opened, the data I'm watching, and the
     filter I'm applying, that thing will only be exported."*

     Exporting the combined ledger from the Payroll tab is the kind of mismatch
     that makes somebody stop trusting every other export — so each scope builds
     its own report from the rows that scope shows. Overview is the only one
     that mixes income and spending, because it is the only screen that does. */
  let report: Report;
  let rowCount: number;

  if (request.scope === 'expenses') {
    report = buildExpenseReport({
      expenses: filtered,
      from: request.from,
      to: request.to,
      rangeLabel: request.rangeLabel,
      filters: input.filters,
      subtypeOf: (row) => subtypeLabel(row.categorySlug, row.subtype, row.subtypeOther),
    });
    rowCount = filtered.length;
  } else if (request.scope === 'income') {
    const status = request.status ?? 'all';
    const rows =
      /* ⚠️ Filtered on the DERIVED settlement state, matching the screen. The
         stored `status` column cannot express "part paid", so filtering on it
         would export a different set of rows than the reader was looking at —
         and an export that disagrees with its own page is worse than none. */
      status === 'all'
        ? revenueRows
        : revenueRows.filter((r) => settlementOf(r) === status);

    report = buildIncomeReport({
      revenue: rows,
      from: request.from,
      to: request.to,
      rangeLabel: request.rangeLabel,
      filters:
        status === 'all'
          ? []
          : [
              `Status: ${
                REVENUE_STATUS_META[status as keyof typeof REVENUE_STATUS_META]?.label ?? status
              }`,
            ],
      statusLabel: (row) => REVENUE_STATUS_META[settlementOf(row)].label,
    });
    rowCount = rows.length;
  } else if (request.scope === 'payroll') {
    const month = MONTH_KEY.test(request.month ?? '') ? request.month! : monthOf(today());
    const lines = await F.payrollMonth(user.id, month);

    report = buildPayrollReport({
      lines,
      month,
      monthLabel: monthLabel(month),
      employmentLabel: (type) => EMPLOYMENT_META[type as keyof typeof EMPLOYMENT_META]?.label ?? type,
    });
    rowCount = lines.length;
  } else if (request.scope === 'tools') {
    const tools = await toolBoard(user.id);
    report = buildToolsReport({
      tools,
      rangeLabel: request.rangeLabel,
      from: request.from,
      to: request.to,
    });
    rowCount = tools.length;
  } else {
    report = buildFinanceReport(input);
    rowCount = filtered.length + revenueRows.length;
  }

  const stem = reportFileStem(report);

  if (request.format === 'csv') {
    return {
      ok: true,
      fileName: reportFileName(stem, 'csv'),
      content: reportToCsv(report),
      encoding: 'text',
      rowCount,
    };
  }

  if (request.format === 'xlsx') {
    return {
      ok: true,
      fileName: reportFileName(stem, 'xlsx'),
      content: (await reportToXlsx(report)).toString('base64'),
      encoding: 'base64',
      rowCount,
    };
  }

  const pdf = await composeReportSheet({
    report,
    /* ⚠️ Null: `work` turns on the designed table built for the WORK report,
       whose rows carry avatars and platform marks. A ledger has none of those,
       so it takes the generic table — the same one the analytical reports and
       attendance print. That is what "the same template" means. */
    work: null,
    charts: financeCharts(input),
    filterSummary: input.filters,
    generatedOn: today(),
    generatedBy: user.fullName,
  });

  /* Every export is audited: a copy that leaves the building is no longer
     covered by any access control. */
  await auditAlone(user, {
    entityType: 'finance',
    entityId: null,
    action: `export.finance.${request.format}`,
    after: { from: request.from, to: request.to, rows: rowCount },
  });

  return {
    ok: true,
    fileName: reportFileName(stem, 'pdf'),
    content: Buffer.from(pdf).toString('base64'),
    encoding: 'base64',
    rowCount,
  };
}

/* ---------------------------------------------------------------------------
 * Re-reading the board after a filter change
 * ------------------------------------------------------------------------- */

/**
 * Rebuild the whole board for a new date range.
 *
 * ⚠️ Guarded by `finance.view`, unlike the filing action. Everything this
 * returns is a figure, so a Coordinator calling it directly must get nothing —
 * and does, twice over: this check refuses, and the queries beneath it would
 * return empty arrays anyway.
 */
export async function financeBoardAction(
  from: string,
  to: string,
  rangeLabel: string,
): Promise<{ ok: true; board: ReturnType<typeof buildFinanceBoard> } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    return { ok: false, error: 'You cannot view the ledger.' };
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { ok: false, error: 'That is not a date range.' };
  }

  const prior = priorPeriod(from, to);

  const month = monthOf(today());

  const [
    expenses,
    revenue,
    priorExpenses,
    priorRevenue,
    payroll,
    tools,
    categories,
    posted,
    reviews,
    thisMonthPayroll,
  ] = await Promise.all([
    F.listExpenses(user.id, from, to),
    F.listRevenue(user.id, from, to),
    F.listExpenses(user.id, prior.from, prior.to),
    F.listRevenue(user.id, prior.from, prior.to),
    /* ⚠️ `listSalaried`, not `listPayroll` — owners draw a profit share and
       must never be added into a salary bill. Migration 067. */
    listSalaried(user.id),
    toolBoard(user.id),
    F.listExpenseCategories(user.id),
    F.postedMonths(user.id),
    C.reviewsDue(user.id),
    F.payrollMonth(user.id, month),
  ]);

  return {
    ok: true,
    board: buildFinanceBoard({
      expenses,
      revenue,
      priorExpenses,
      priorRevenue,
      payroll,
      tools,
      categoryOptions: categories,
      postedMonths: posted,
      /* ⚠️ Only the current month here, unlike the page's twelve. This action
         exists to refresh a date range, and the payroll picker does not use it
         — loading twelve months of payroll to satisfy a range change would be
         eleven queries nobody asked for. */
      payrollFor: { [month]: thisMonthPayroll },
      payrollMonths: [month],
      reviewsDue: reviews,
      from,
      to,
      rangeLabel,
    }),
  };
}
