import type { Metadata } from 'next';

import { AppointmentsDesk } from '@/components/crm/appointments-desk';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  APPOINTMENTS_BACK_DAYS,
  APPOINTMENTS_LIMIT,
  crmMyAppointments,
} from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Appointments' };

/* ============================================================================
 * APPOINTMENTS — the rail screen for Phase E
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-16: *"It is done but I want to implement and also build its
 * screen today so I can run it at least. Definitely I will improve its UI or
 * screen later."*
 *
 * ── ⚠️ ITS OWN TOP-LEVEL ROUTE, NOT `/my-leads/appointments` ───────────────
 * A nested route would inherit `/my-leads`'s page and its nine queries to render
 * a list of appointments, and the diary is not a view of the lead list. Same
 * reasoning that put `/clients` beside `/leads` rather than under it.
 *
 * ── ⚠️ ONE QUERY, AND NO `searchParams` ────────────────────────────────────
 * The tabs are client state, so this route is static in the sense that matters:
 * nothing anybody clicks on the screen re-runs it. That is deliberate — a
 * `searchParams` read here would make every tab press a full server render of
 * the page, which is the exact bug Rule Zero was written after.
 *
 * ── ⚠️ AND THERE IS NO SEPARATE ACCESS RULE HERE ───────────────────────────
 * `requireCrmAccess()` gates the door and `crm_appointments`'s own policies (152)
 * narrow the rows to the caller's own diary. The query adds `owner_id =
 * app.current_user_id()` on top, the same belt-and-braces `/my-leads` uses: RLS
 * is the boundary, the clause is the page's meaning, and a manager who can read
 * the department still sees only their own day here.
 * ========================================================================= */

export default async function AppointmentsPage() {
  const { user } = await requireCrmAccess();

  const appointments = await crmMyAppointments(user.id);

  return (
    <AppointmentsDesk
      appointments={appointments}
      backDays={APPOINTMENTS_BACK_DAYS}
      limit={APPOINTMENTS_LIMIT}
      /* ⚠️ THE SERVER'S CLOCK. "Past" decides which tab a row lands in, so a
         reader whose laptop is an hour out would otherwise be shown a visit as
         needing a write-up before it had happened — and React would report the
         disagreement as a hydration error rather than as the clock problem it
         is. Same rule as the desk and the client list. */
      nowMs={nowMs()}
    />
  );
}
