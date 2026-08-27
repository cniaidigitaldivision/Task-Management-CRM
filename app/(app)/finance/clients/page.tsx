import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/current-user';
import { listClientAccounts } from '@/lib/db/queries/finance';
import { pkr } from '@/lib/domain/money';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Client accounts' };

/* ============================================================================
 * WHO OWES WHAT — THE RECEIVABLES LEDGER
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"When I click on some project, all of that project's
 * details will also be opened on a separate page or in a separate tab."* This
 * is the list that page is reached from.
 *
 * ── ⚠️ ONE ROW PER CLIENT, AND NOT LIMITED TO A PERIOD ─────────────────────
 * The Finance page's revenue tab is a LEDGER: one row per invoice, filtered to
 * the month being looked at. That is the right shape for "what happened in
 * August" and the wrong one for "who owes us money", because a balance is
 * cumulative — a client who still owes 300,000 from June would show as owing
 * nothing under an August filter, which is precisely the figure somebody
 * chasing payment must not be shown.
 *
 * ── ⚠️ ORDERED BY WHAT IS OUTSTANDING, LARGEST FIRST ───────────────────────
 * Not alphabetically and not by billing. This screen exists to be acted on, and
 * the action is chasing money; the order is the order somebody works down.
 *
 * ── ⚠️ ACCESS WAS DECIDED IN `layout.tsx` ──────────────────────────────────
 * A Coordinator reaching `/finance` is deliberate — they file expenses there —
 * and reaching THIS is not. The layout refuses them; this page does not re-ask,
 * because a second differently-worded check is how the two drift apart.
 * ========================================================================= */

export default async function ClientAccountsPage() {
  const user = await requireUser();
  const accounts = await listClientAccounts(user.id);

  const billed = accounts.reduce((sum, a) => sum + a.billedPkr, 0);
  const collected = accounts.reduce((sum, a) => sum + a.collectedPkr, 0);
  const owed = accounts.reduce((sum, a) => sum + Math.max(0, a.billedPkr - a.collectedPkr), 0);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5 pb-16">
      <Link
        href="/finance"
        className="inline-flex items-center gap-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Finance
      </Link>

      <PageHeader
        title="Client accounts"
        description="What each client has been billed, what they have paid, and what is still owed. All time, not this month."
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Receivables</CardTitle>
            <CardDescription>
              {accounts.length} {accounts.length === 1 ? 'client' : 'clients'} · {pkr(billed)}{' '}
              billed ·{' '}
              <span style={{ color: 'var(--money-in)' }}>{pkr(collected)} received</span>
              {owed > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--money-due)' }}>{pkr(owed)} outstanding</span>
                </>
              )}
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody className="px-0 py-0">
          {accounts.length === 0 ? (
            <p className="px-5 py-12 text-center text-caption text-text-tertiary">
              Nothing has been billed to anybody yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-caption">
                <thead>
                  <tr className="border-b border-border-default text-left">
                    <th scope="col" className="px-4 py-2.5 text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                      Client
                    </th>
                    <th scope="col" className="w-24 px-4 py-2.5 text-right text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                      Invoices
                    </th>
                    <th scope="col" className="w-32 px-4 py-2.5 text-right text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                      Billed
                    </th>
                    <th scope="col" className="w-32 px-4 py-2.5 text-right text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                      Received
                    </th>
                    <th scope="col" className="w-32 px-4 py-2.5 text-right text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                      Outstanding
                    </th>
                    <th scope="col" className="w-10 px-4 py-2.5" />
                  </tr>
                </thead>

                <tbody>
                  {accounts.map((account) => {
                    const balance = Math.max(0, account.billedPkr - account.collectedPkr);

                    /* ⚠️ Only a PROJECT can be addressed by id. 064 permits
                       income filed against a bare client name, and those have
                       no statement page — so the row is still shown and simply
                       is not a link. An href that 404s would be worse than
                       none. */
                    const href = account.projectId;

                    return (
                      <tr
                        key={account.projectId ?? `name:${account.name}`}
                        className={cn(
                          'border-b border-border-subtle last:border-0',
                          href && 'transition-colors hover:bg-bg-surface-raised',
                        )}
                      >
                        <td className="px-4 py-3">
                          {/* ⚠️ ONE link, on the name — not a link per cell.
                              Wrapping every cell would announce six links per
                              row to a screen reader for one destination. The
                              row highlight is what makes the whole thing feel
                              clickable, which is the pattern the rest of this
                              product uses. */}
                          {href ? (
                            <Link
                              href={`/finance/clients/${href}`}
                              className="block font-medium text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
                            >
                              {account.name}
                            </Link>
                          ) : (
                            <span className="block font-medium text-text-primary">
                              {account.name}
                            </span>
                          )}
                          <span className="mt-0.5 block text-micro text-text-tertiary">
                            {[
                              account.code,
                              account.lastPaymentOn
                                ? `last paid ${account.lastPaymentOn}`
                                : 'never paid',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </td>

                        <td className="tabular px-4 py-3 text-right text-text-secondary">
                          {account.invoiceCount}
                        </td>

                        <td className="tabular px-4 py-3 text-right font-semibold text-text-primary">
                          {pkr(account.billedPkr).replace('PKR ', '')}
                        </td>

                        <td
                          className="tabular px-4 py-3 text-right font-semibold"
                          style={{
                            color:
                              account.collectedPkr > 0
                                ? 'var(--money-in)'
                                : 'var(--text-tertiary)',
                          }}
                        >
                          {account.collectedPkr > 0
                            ? pkr(account.collectedPkr).replace('PKR ', '')
                            : '—'}
                        </td>

                        <td
                          className="tabular px-4 py-3 text-right font-semibold"
                          style={{
                            color: balance > 0 ? 'var(--money-due)' : 'var(--text-tertiary)',
                          }}
                        >
                          {balance > 0 ? pkr(balance).replace('PKR ', '') : '—'}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {href && (
                            <ChevronRight
                              className="ml-auto h-4 w-4 text-text-tertiary"
                              aria-hidden="true"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="border-t border-border-subtle px-5 py-3 text-micro text-text-tertiary">
            Balances are cumulative — every invoice ever raised, not just this month. A client
            without a project record has no statement page, so their row is not a link.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
