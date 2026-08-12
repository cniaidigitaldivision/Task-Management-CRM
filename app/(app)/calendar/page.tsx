import type { Metadata } from 'next';

import { CalendarView } from '@/components/calendar/calendar-view';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { tasksInRange } from '@/lib/db/queries/search';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Calendar' };

/* ============================================================================
 * CALENDAR — FR-088
 * ----------------------------------------------------------------------------
 * Open to everybody. RLS decides what is in it: a Member sees their own due
 * dates and a Coordinator sees the division's, from the same query with no
 * role test in this file. The month grid is a client component because it
 * pages back and forth; the first month is rendered on the server so the page
 * is not a spinner on arrival.
 *
 * `nowMs()` is read HERE and passed down. Reading the clock inside the client
 * component would make its render impure — and would also disagree with the
 * server's idea of "today" for anybody in a different timezone.
 * ========================================================================= */

export default async function CalendarPage() {
  const user = await requireUser();
  const now = new Date(nowMs());

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  const [tasks, people] = await Promise.all([
    tasksInRange(user.id, {
      from: `${year}-${pad(month)}-01`,
      to: `${year}-${pad(month)}-${pad(lastDay)}`,
    }),
    listAssignablepeople(user.id),
  ]);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="Planning"
        title="Calendar"
        description="Your work by the day it is due, with the time, the project and how it is going. Click one to open it."
      />
      <CalendarView
        initialTasks={tasks}
        initialYear={year}
        initialMonth={month}
        todayIso={`${year}-${pad(month)}-${pad(now.getUTCDate())}`}
        people={people.map((p) => ({ id: p.id, name: p.fullName }))}
        currentUserId={user.id}
        /* Owner instruction: only a Super Admin and an Admin may look at somebody
           else's calendar. Everybody else sees their own, which is what the view
           defaults to for all four roles.
           A narrowing of the interface, not of the query — RLS still decides what
           `tasksInRange` returns, and a Coordinator still sees the division on the
           Tasks screen. Offering less than is permitted is always safe. */
        canSeeOthers={user.role === 'super_admin' || user.role === 'admin'}
      />
    </div>
  );
}
