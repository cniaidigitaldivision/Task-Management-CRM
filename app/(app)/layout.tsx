import { APP_NAME } from '@/lib/domain/constants';
import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { AssistantLauncher } from '@/components/assistant/assistant-launcher';
import { requireEnrolledUser, touchSession } from '@/lib/auth/current-user';
import { assistantAccessFor } from '@/lib/db/queries/assistant';
import { mayUseAssistant } from '@/lib/domain/assistant-access';
import { countUnread, listNotifications } from '@/lib/db/queries/feed';
import { listAssignablepeople } from '@/lib/db/queries/people';
import { listProjects } from '@/lib/db/queries/projects';
import { runningTimers } from '@/lib/db/queries/tasks';
import { TimerBar } from '@/components/timer/timer-bar';
import { CheckInButton } from '@/components/attendance/check-in-button';
import { todayFor } from '@/lib/db/queries/attendance';

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
  const [notifications, unread, projects, people, timers, today, assistantOverride] =
    await Promise.all([
    listNotifications(user.id, 12),
    countUnread(user.id),
    listProjects(user.id),
    listAssignablepeople(user.id),
    /* In the same wave as everything else, so the timer bar costs no extra wait.
       Usually returns nothing, which is why the bar renders nothing. */
    runningTimers(user.id),
    /* ⚠️ In the same wave for the same reason, and it is one indexed row by
       (user_id, on_date). The alternative — the button fetching its own state on
       mount — would make it flicker through "Check in" on every navigation for
       somebody who checked in hours ago, which is the one thing a status pill
       must never do. */
    todayFor(user.id),
    /* ⚠️ In the same wave, and it is one row by primary key. It decides whether
       the floating launcher is MOUNTED AT ALL — see below. */
    assistantAccessFor(user.id),
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
      /* ── ⚠️ THE `key` ON EACH OF THESE THREE IS LOAD-BEARING. DO NOT REMOVE ─
          A key on an element that is not obviously in a list looks like a
          mistake, so here is the reason, measured rather than guessed.

          This file is a SERVER component and `AppShell` is a CLIENT one. These
          elements are therefore built here, serialised through the Flight
          protocol, and rebuilt in the browser — and an element rebuilt that way
          does not carry the "already checked for a key" mark that JSX puts on a
          statically-written child. `AppShell` then renders each of them among
          its other children, React reconciles that as an ARRAY, finds an
          unmarked element with no key, and warns:

            Each child in a list should have a unique "key" prop.
            Check the render method of `AppShell`. It was passed a child from
            AppGroupLayout.

          ── ⚠️ WHY THIS TOOK SO LONG TO FIND ────────────────────────────────
          React warns ONCE per parent component, not once per offending child.
          So removing any single one of these three left the warning firing from
          the other two, and each looked innocent in turn. Only nulling all
          three at once made it stop — which is what identified the pattern
          rather than the culprit. Bisecting one prop at a time cannot find this
          class of bug, and that is worth remembering.

          A key is the honest fix rather than a suppression: these ARE list
          items from React's point of view. Anything else passed from here as an
          element needs one too. */
      timerBar={<TimerBar key="timer-bar" initialTimers={timers} />}
      checkInButton={<CheckInButton key="check-in" today={today} />}
      /* ── ⚠️ A PROP, NOT A SECOND CHILD ────────────────────────────────────
          Passing this alongside `{children}` made `children` a two-element
          array — which React warns about — and, less visibly, put a
          viewport-fixed button inside `<main class="reveal-children">`, whose
          transform on each child becomes the containing block for anything
          `fixed`. The shell renders it outside that column instead.

          ⚠️ NOT RENDERED AT ALL for somebody who may not use it — absent, not
          hidden. `AssistantLauncher` is a Client Component, so mounting it
          would serialise its props into the RSC payload and advertise the
          feature in view-source. `lib/view/project-finance.ts` records the leak
          that taught this.

          The rule is the composed one — rank, overridden by a per-person row —
          so a switched-on Member gets the launcher even though the sidebar link
          is Coordinator-and-above. That is the owner's switch working. */
      launcher={
        mayUseAssistant({ id: user.id, role: user.role }, assistantOverride) ? (
          <AssistantLauncher key="assistant-launcher" who={user.fullName} avatarUrl={user.avatarUrl ?? null} />
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
