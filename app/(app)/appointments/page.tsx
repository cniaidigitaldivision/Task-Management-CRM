import type { Metadata } from 'next';

import { AppointmentsBoard } from '@/components/crm/appointments-board';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { BOARD_BACK_DAYS, crmAppointmentBoard } from '@/lib/db/queries/crm-appointments-board';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Appointments' };

/* ============================================================================
 * APPOINTMENTS — the owner's design, 2026-09-21
 * ----------------------------------------------------------------------------
 * ⚠️ ONE QUERY, AND NO `searchParams`. Cards, filters, saved views, the list,
 * the calendar and the details panel are all client state over these rows
 * (Rule Zero); only a write re-runs this page.
 *
 * ⚠️ RLS is the boundary (152); the query adds owner = me, so a manager sees
 * their own diary here, as /my-leads does.
 * ========================================================================= */

export default async function AppointmentsPage() {
  const { user } = await requireCrmAccess();
  const appointments = await crmAppointmentBoard(user.id);
  /* The server's clock — "past" decides Needs recording, and a laptop an hour
     out would otherwise disagree with the render (a hydration error). */
  const now = nowMs();
  const from = new Date(now + 5 * 3_600_000 - BOARD_BACK_DAYS * 86_400_000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <AppointmentsBoard
      appointments={appointments}
      nowMs={now}
      viewerId={user.id}
      viewerName={user.fullName}
      windowFrom={from}
    />
  );
}
