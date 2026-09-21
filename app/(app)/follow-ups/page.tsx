import type { Metadata } from 'next';

import { FollowUpsBoard } from '@/components/crm/followups-board';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { BOARD_BACK_DAYS, crmFollowUpBoard, crmFollowUpSequences } from '@/lib/db/queries/crm-followup-board';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Follow-ups' };

/* ============================================================================
 * FOLLOW-UPS — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * ⚠️ ONE WAVE, AND NO `searchParams`. The cards, the four tabs, the filters,
 * the queue and the details panel are all client state over these rows (Rule
 * Zero); only a write re-runs this page.
 *
 * ⚠️ The two reads have nothing to say to each other, so they leave together
 * (law 4). Each `withUser` is a transaction of its own — in series that is two
 * round trips for data with no dependency between them.
 * ========================================================================= */

export default async function FollowUpsPage() {
  const { user } = await requireCrmAccess();
  const [followUps, sequences] = await Promise.all([
    crmFollowUpBoard(user.id),
    crmFollowUpSequences(user.id),
  ]);
  /* The server's clock — "overdue" is decided here, and a laptop an hour out
     would otherwise disagree with the render (a hydration error). */
  const now = nowMs();
  const from = new Date(now + 5 * 3_600_000 - BOARD_BACK_DAYS * 86_400_000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <FollowUpsBoard
      followUps={followUps}
      sequences={sequences}
      nowMs={now}
      viewerName={user.fullName}
      windowFrom={from}
    />
  );
}
