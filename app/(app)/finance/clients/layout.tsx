import { redirect } from 'next/navigation';

import { requireEnrolledUser } from '@/lib/auth/current-user';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * WHO MAY SEE A CLIENT'S ACCOUNT
 * ----------------------------------------------------------------------------
 * ── ⚠️ A SECOND GATE UNDER `/finance`, AND IT IS NOT REDUNDANT ─────────────
 * `app/(app)/finance/layout.tsx` admits a COORDINATOR, deliberately: the owner
 * gave them the expense FORM, so they have to reach the route. What they were
 * explicitly not given is the ledger — *"the list of expenses, their report, or
 * their analysis should only be visible to the admin and the super admin."*
 *
 * `/finance` itself honours that by branching on the server and building a
 * form-only payload. These pages have no such half: a client statement IS the
 * analysis. So they need their own floor, and without this file a Coordinator
 * would reach every client's balance simply by typing the URL — the parent
 * having already said yes.
 *
 * ── ⚠️ THE DATABASE AGREES, INDEPENDENTLY ──────────────────────────────────
 * `revenue_entries` and `revenue_payments` are both Admin-and-above by policy
 * (migrations 064 and 073), so a Coordinator who somehow reached the queries
 * would get empty arrays rather than figures. This layout stops the wrong
 * SCREEN being built; the policies stop the wrong DATA being returned. Neither
 * is sufficient alone, which is why both exist.
 *
 * ⚠️ Do NOT add a `loading.tsx` to this segment. `monthly-report/layout.tsx`
 * records the measured regression: a `redirect()` from inside a Suspense
 * boundary is delivered in the stream as an HTTP 200 rather than a 307.
 * ========================================================================= */
export default async function FinanceClientsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireEnrolledUser();

  if (!can({ role: user.role, id: user.id }, 'finance.view')) {
    redirect('/finance');
  }

  return children;
}
