import { APP_NAME } from '@/lib/domain/constants';
import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { requireEnrolledUser, touchSession } from '@/lib/auth/current-user';
import { countUnread, listNotifications } from '@/lib/db/queries/feed';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { runningTimers } from '@/lib/db/queries/tasks';
import { TimerBar } from '@/components/timer/timer-bar';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
};

/* Never statically rendered: every page below this shows one person's data, and
   a cached render would be somebody else's. */
export const dynamic = 'force-dynamic';

/* ============================================================================
 * THE AUTHENTICATED SHELL
 * ----------------------------------------------------------------------------
 * One guard for the whole application. `requireUser()` runs here, so every route
 * under (app) is protected by construction rather than by each page remembering
 * to check — and a new page added next month is protected before anybody thinks
 * about it.
 *
 * ── WHY THE PROJECT AND PEOPLE LISTS ARE FETCHED HERE ────────────────────────
 * The "New task" button lives in the top bar and is reachable from every screen,
 * so the form behind it needs projects and assignees everywhere. Fetching them in
 * the layout means one query per navigation instead of one per page that happens
 * to include a create button — and, more importantly, it means the button is not
 * subtly disabled on the pages that forgot to load them.
 *
 * Both lists are already narrowed by row-level security, so a member's create
 * form offers only the projects they are actually in.
 * ========================================================================= */

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  /* FR-145: a privileged account with no verified second factor is redirected
     to enrolment here, at the boundary — not merely pointed at it by the sign-in. */
  const user = await requireEnrolledUser();

  /* Independent reads, so they go together. Four sequential round trips to
     Supabase on every navigation is roughly 200ms of nothing happening. */
  const [notifications, unread, projects, people, timers] = await Promise.all([
    listNotifications(user.id, 12),
    countUnread(user.id),
    listProjects(user.id),
    listAssignablepeople(user.id),
    /* In the same wave as everything else, so the timer bar costs no extra wait.
       Usually returns nothing, which is why the bar renders nothing. */
    runningTimers(user.id),
  ]);

  /* Slides the session window. Deliberately not awaited into the render path —
     it is bookkeeping, and a page must not fail because a last_seen_at write
     was slow. */
  void touchSession(user);

  return (
    <AppShell
      user={{
        id: user.id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        roleTitle: user.roleTitle,
        theme: user.theme,
        avatarUrl: user.avatarUrl,
      }}
      notifications={notifications}
      unreadCount={unread}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        code: p.code,
      }))}
      people={people.map((p) => ({ id: p.id, name: p.fullName, roleTitle: p.roleTitle }))}
      timerBar={<TimerBar initialTimers={timers} />}
    >
      {children}
    </AppShell>
  );
}
