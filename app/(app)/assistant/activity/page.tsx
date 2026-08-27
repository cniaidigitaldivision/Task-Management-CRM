import type { Metadata } from 'next';

import { assistantUsageAction } from '@/app/actions/assistant';
import { ActivityWorkspace, type Period } from '@/components/assistant/activity-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { assistantAccessFor, listAccessOverrides } from '@/lib/db/queries/assistant';
import { listPeople } from '@/lib/db/queries/people';
import { mayUseAssistant } from '@/lib/domain/assistant-access';
import { can } from '@/lib/domain/permissions';

export const metadata: Metadata = { title: 'Assistant activity' };

/* ============================================================================
 * WHAT THE ASSISTANT IS BEING USED FOR
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"Exclude all the things from this page and make a button
 * on the top right of this page where I can see who is asking, the spend, our
 * views, and all these types of things."*
 *
 * This is what that button opens. Everything on it used to sit below the chat
 * on `/assistant`, where it competed with the box somebody had come to type in.
 *
 * ── ⚠️ WHO MAY BE HERE WAS DECIDED IN `layout.tsx` ─────────────────────────
 * A second, differently-worded check in this file is how the two drift apart
 * and one of them starts admitting somebody. What IS decided here is the
 * narrower question of who may WRITE — `assistant.manage_access` — because that
 * changes which panels are built, and a panel that is not built cannot leak its
 * props into the RSC payload.
 * ========================================================================= */

/** Karachi's today, matching every other date in this product. */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

/**
 * `date` minus `days`, as an ISO date.
 *
 * ⚠️ Built from `Date.UTC` on the parsed parts rather than from a local
 * `new Date(iso)`, which parses a bare date as UTC midnight and then formats it
 * in the server's zone — an hour's difference is enough to shift the boundary
 * by a whole day. `lib/domain/attendance.ts` records the same trap.
 */
function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The periods on offer.
 *
 * ⚠️ Computed on the SERVER and handed to the client as literal dates. The
 * browser must not derive them: its clock is in the reader's zone, not the
 * division's, and "this month" resolved in London at 01:00 is last month in
 * Karachi. Every other date in this product is settled server-side for exactly
 * this reason.
 */
function periodsFrom(now: string): Period[] {
  const monthStart = `${now.slice(0, 7)}-01`;
  const monthLabel = `${MONTH_NAMES[Number(now.slice(5, 7))]} ${now.slice(0, 4)}`;

  return [
    { value: 'month', label: monthLabel, from: monthStart, to: now },
    { value: '7', label: 'Last 7 days', from: daysBefore(now, 6), to: now },
    { value: '30', label: 'Last 30 days', from: daysBefore(now, 29), to: now },
    /* ⚠️ A fixed floor rather than "the first message ever", which would be
       another round trip to answer a question nobody is really asking. The
       product did not exist in 2020, so this is every row there will ever be. */
    { value: 'all', label: 'All time', from: '2020-01-01', to: now },
  ];
}

export default async function AssistantActivityPage() {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const canManageAccess = can(actor, 'assistant.manage_access');

  const periods = periodsFrom(today());
  const opening = periods[0];

  /* ── ⚠️ FETCHED ONLY FOR SOMEBODY WHO MAY SEE THEM ────────────────────────
     Not fetched-then-hidden. The panels below are Client Components, so their
     props are serialised into the RSC payload and readable in view-source —
     `lib/view/project-finance.ts` records the leak that taught this. Somebody
     with usage rights but not access rights gets no roster of people and no
     roster of overrides, because neither query runs.

     ⚠️ Each list is ALSO Admin-only by RLS, so a caller who somehow reached
     these would get empty arrays. The branch is what keeps the payload honest;
     the policy is what makes it true. */
  const [report, people, overrides, ownOverride] = await Promise.all([
    assistantUsageAction(opening.from, opening.to),
    canManageAccess ? listPeople(user.id) : Promise.resolve([]),
    canManageAccess ? listAccessOverrides(user.id) : Promise.resolve([]),
    /* Only to decide what this screen SAYS — whether the reader can also use
       the chat. The gate itself is in the two layouts. */
    assistantAccessFor(user.id),
  ]);

  /* The layout already refused anybody without `view_usage`, so this branch is
     unreachable in practice. Handled rather than asserted: an action that can
     return an error should never be unwrapped on the assumption it will not.

     ⚠️ `'ok' in report` ALONE, with no `=== false` after it. Adding the second
     test stops TypeScript treating the line as a type guard — the failure shape
     is the only member of the union carrying `ok`, so the `in` is what narrows,
     and the extra comparison leaves the else branch holding the whole union
     again. It compiled as a cast and would have crashed on the first error. */
  if ('ok' in report) {
    return (
      <div className="mx-auto max-w-[var(--content-max)]">
        <PageHeader title="Assistant activity" />
        <p className="text-caption" style={{ color: 'var(--feedback-error)' }}>
          {report.error}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <PageHeader
        title="Assistant activity"
        description="Who is asking, what it cost, and who may use it."
      />

      <ActivityWorkspace
        report={report}
        periods={periods}
        initialPeriod={opening.value}
        people={people.map((p) => ({
          id: p.id,
          fullName: p.fullName,
          email: p.email,
          role: p.role,
          roleTitle: p.roleTitle,
          avatarUrl: p.avatarUrl,
        }))}
        overrides={overrides}
        currentUserId={user.id}
        canManageAccess={canManageAccess}
        mayAsk={mayUseAssistant(actor, ownOverride)}
      />
    </div>
  );
}
