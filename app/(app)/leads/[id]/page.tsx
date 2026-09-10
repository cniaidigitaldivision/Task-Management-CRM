import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';

import { LeadRecord } from '@/components/crm/lead-record';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { getCrmLead } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Lead' };

/* ============================================================================
 * ONE LEAD — Step 5 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * ── ⚠️ `notFound()` FOR A LEAD THE CALLER MAY NOT READ, NOT A REFUSAL ──────
 * `getCrmLead` returns null for both "no such lead" and "not yours", and this
 * page renders the same 404 for both. A distinct "you are not allowed to see
 * this" page would confirm that a particular lead EXISTS to somebody with no
 * right to know it — and with a uuid in the URL, confirming existence is the
 * whole of what an attacker wants. The two cases are indistinguishable on
 * purpose, all the way from the policy to the screen.
 *
 * ── ⚠️ THE FLOOR IS `../layout.tsx`, AND THIS REPEATS IT ───────────────────
 * The same pattern as the desk: a page is reachable without its layout in some
 * render paths, and a floor that exists in only one of the two is not a floor.
 * Admin, Super Admin, or the Sales department — see migration 118.
 * ========================================================================= */

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmAccess();
  const { id } = await params;
  const query = await searchParams;

  const record = await getCrmLead(user.id, id);
  if (!record) notFound();

  return (
    <LeadRecord
      lead={record.lead}
      notes={record.notes}
      activity={record.activity}
      alsoEnquired={record.alsoEnquired}
      backHref={backToDesk(query.from, record.lead.projectId)}
      /* ⚠️ Who is looking, for one decision only: whether a note carries a
         withdraw button. The DELETE itself is decided by 111's policy — author
         or Admin — so a viewer who got this wrong would be refused by the
         database rather than allowed by the screen. */
      viewerId={user.id}
      viewerIsAdmin={user.role === 'admin' || user.role === 'super_admin'}
      /* ⚠️ The SERVER's clock, so "3d ago" is the same for everyone — and so
         React cannot report a reader's wrong system time as a hydration error
         instead of the clock problem it is. Same as the desk. */
      nowMs={nowMs()}
    />
  );
}

/**
 * Where "Back to the lead desk" goes.
 *
 * ⚠️ THE FILTERS COME BACK WITH IT. The desk keeps stage, owner, search, dates
 * and page in the query string, and a row opened from page 9 of a filtered list
 * has to return there — dropping somebody at an unfiltered page 1 is how a
 * person loses the set they had built and gives up on the filters.
 *
 * ⚠️ AND `from` IS AN ATTACKER-CONTROLLED STRING. It is never used as a URL:
 * it is appended after a literal `/leads?`, so the destination is always this
 * application's own desk however it is stuffed. Anything carrying a scheme, a
 * host or a path separator is dropped outright rather than sanitised, because
 * the useful values are only ever `key=value` pairs.
 */
function backToDesk(from: string | undefined, projectId: string): Route {
  const raw = (from ?? '').replace(/^\?/, '');

  if (raw !== '' && /^[A-Za-z0-9_%=&.+-]+$/.test(raw)) return `/leads?${raw}`;

  /* No usable filters — at least land on the project this lead belongs to,
     rather than on whichever one the desk would have defaulted to. */
  return `/leads?project=${encodeURIComponent(projectId)}`;
}
