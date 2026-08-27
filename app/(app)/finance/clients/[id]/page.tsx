import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientStatement } from '@/components/finance/client-statement';
import { requireUser } from '@/lib/auth/current-user';
import { clientInvoices, clientPayments, projectHeader } from '@/lib/db/queries/finance';

export const metadata: Metadata = { title: 'Client statement' };

/* ============================================================================
 * ONE CLIENT'S STATEMENT OF ACCOUNT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"When I click on some project, all of that project's
 * details will also be opened on a separate page [...] all the incomes of
 * Daniyal Marketing, for example, should be displayed: this payment was
 * received on this date and in this month [...] You can say it properly, like a
 * professional financier."*
 *
 * ── ⚠️ THREE READS IN ONE WAVE, NOT ONE PER INVOICE ────────────────────────
 * The header, every invoice, and every receipt across all of them. Fetching a
 * statement the obvious way — invoices, then a payments query per invoice — is
 * one round trip plus N, which on a client with two years of history is two
 * dozen sequential queries to draw one page. `clientPayments` returns them all
 * and the component groups them in memory.
 *
 * ── ⚠️ ACCESS WAS DECIDED IN `../layout.tsx` ───────────────────────────────
 * `finance.view`, which is Admin and above. A Coordinator legitimately reaches
 * `/finance` to file an expense and is refused here; this page does not re-ask,
 * because a second differently-worded check is how the two drift apart. The
 * database agrees independently — `revenue_entries` and `revenue_payments` are
 * both Admin-only by policy, so these queries would return empty arrays anyway.
 *
 * ── ⚠️ `notFound()` FOR A MISSING PROJECT, NOT AN EMPTY STATEMENT ──────────
 * A project id that does not resolve is a bad URL, and rendering a statement
 * headed "undefined" with no rows would look like a client who owes nothing —
 * the one wrong impression this screen must never give.
 * ========================================================================= */

export default async function ClientStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const project = await projectHeader(user.id, id);
  if (!project) notFound();

  const key = { projectId: id, clientName: null };
  const [invoices, payments] = await Promise.all([
    clientInvoices(user.id, key),
    clientPayments(user.id, key),
  ]);

  return (
    <div className="mx-auto max-w-[var(--content-max)]">
      <ClientStatement
        client={{
          projectId: project.id,
          name: project.name,
          code: project.code,
          type: project.type,
          monthlyFeePkr: project.monthlyFeePkr,
        }}
        invoices={invoices}
        payments={payments}
        /* ⚠️ Karachi's today, resolved on the SERVER. The payment dialog caps
           its date field with it, and a browser clock in another zone would
           make "today" a day out — which is how a payment gets filed against
           the wrong month. Every date in this product is settled server-side
           for this reason. */
        today={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })}
      />
    </div>
  );
}
