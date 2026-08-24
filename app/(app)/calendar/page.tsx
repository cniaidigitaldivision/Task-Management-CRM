import type { Metadata } from 'next';

import { CalendarView } from '@/components/calendar/calendar-view';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { listPeople } from '@/lib/db/queries/people';
import { tasksInRange } from '@/lib/db/queries/search';
import { can } from '@/lib/domain/permissions';
import { isoDateIn } from '@/lib/now';

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
  /* ⚠️ The division's own day, not UTC — Pakistan is UTC+5, so between midnight
     and 5am a UTC date opens the calendar on yesterday. See `isoDateIn`. */
  const today = isoDateIn();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  const [tasks, people] = await Promise.all([
    tasksInRange(user.id, {
      from: `${year}-${pad(month)}-01`,
      to: `${year}-${pad(month)}-${pad(lastDay)}`,
    }),
    /* ── ⚠️ THE DIRECTORY, NOT THE ASSIGNABLE LIST ──────────────────────────
       This used `listAssignablepeople`, which is rank-filtered: it answers "who
       may I hand work to". The calendar asks a different question — "whose work
       may I look at" — and for a Coordinator those differ, so filtering to the
       assignment list would have shown an Admin's tasks under "Everyone" while
       offering no way to filter to that person.

       `listPeople` is the directory, and RLS already scopes it: a Member sees
       only themselves, Coordinator and above see the division. */
    listPeople(user.id, {}),
  ]);

  /* Owner, 2026-08-23: *"you are not handling the team coordinator properly, or
     even the admin and the super admin… these things should properly be working
     in every role."*

     This was hard-coded to `super_admin || admin`, which left the Coordinator —
     the person who plans the week — looking at their own empty calendar while
     the whole team's deadlines sat behind a control they were never offered.

     Asked as a permission rather than a role list: `task.view_all` is already
     the answer to "may this person see the team's work", and it is allowed to
     Coordinator and above and denied to a Member. */
  const canSeeOthers = can({ id: user.id, role: user.role }, 'task.view_all');

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
        todayIso={today}
        people={people
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl }))}
        currentUserId={user.id}
canSeeOthers={canSeeOthers}
      />
    </div>
  );
}
