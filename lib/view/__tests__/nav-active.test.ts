import { describe, expect, it } from 'vitest';

import { hrefsForRole } from '@/components/layout/nav-config';

import { activeHref } from '../nav-active';

/* ============================================================================
 * WHICH NAV ITEM IS THE CURRENT ONE
 * ----------------------------------------------------------------------------
 * A prefix match keeps "Projects" lit on `/projects/[id]`. That was the whole rule
 * until a nav item was briefly added at `/reports/ceo`, at which point two items
 * matched the same path and both claimed `aria-current="page"` — telling a screen
 * reader the reader is in two places at once.
 *
 * That route has since moved to `/monthly-report` for a different reason, so the
 * real tree has no nested pair right now. The rule and these tests stay: the next
 * nested nav item would reintroduce the bug, and nothing else would catch it.
 *
 * Both halves are pinned here: the specificity rule, and the detail-route behaviour
 * it must not break.
 * ========================================================================= */

/* The real tree, written out so these cases are concrete. Listed as literals rather
   than derived from nav-config so that a change to the nav shows up as a failing
   assertion instead of silently rewriting what the tests check. The agreement
   between this list and the real one is asserted at the bottom — which is how a
   wrong entry here (`/vault`, `/profile`) was caught the first time. */
const ADMIN_NAV = [
  '/dashboard',
  /* Added 2026-08-26 with the assistant. ⚠️ Offered to LEAD_UP, but that is the
     DEFAULT and not the rule: a row in `public.assistant_access` switches one
     person on or off, and a switched-on Member reaches it from the floating
     launcher rather than from this list. The real gate is `mayUseAssistant` in
     the route's own layout; this fixture only describes the offered links. */
  '/assistant',
  /* ⚠️ `/my-work` is NOT here and `/today` never should have been.
     My Work became Member-only on 2026-08-22 — a Coordinator and above have
     Tasks, which is the same rows plus everyone else's. `/today` was a page for
     one day; it is now a tab inside a project's Tasks. Both on owner
     instruction, and this fixture is what proved the tree actually changed. */
  '/tasks',
  '/calendar',
  '/projects',
  /* ⚠️ Added 2026-09-04 with the Trend & Engagement Studio. It sits UNDER
     Projects in the rail on the owner's instruction — *"in a left sidebar below
     the project"* — but it is a top-level route, NOT `/projects/studio`, because
     it is a separate page rather than a project tab. So it creates no nested
     pair and the prefix rule stays unambiguous. */
  '/studio',
  '/team',
  '/reports',
  /* ⚠️ `/monthly-report` IS DELIBERATELY ABSENT since 2026-08-29 — owner
     instruction, of the item in the left sidebar. The ROUTE still exists and
     still works; only the link was withdrawn. This fixture describes the offered
     links, so it is the right place for that to show. */
  /* Added 2026-08-26 with the finance feature, and moved to the System section
     the same day on owner instruction — Attendance went the other way, into
     Team. This fixture is a SET, not an order, so the move does not show here;
     it is recorded because the reasoning below refers to a section.

     Offered to a Coordinator as well as an Admin: the owner gave the
     Coordinator the expense FORM while keeping the ledger, its reports and its
     analysis for Admins. Hiding the link would take away the one thing they
     were given; what differs by rank is what the page builds, on the server. */
  '/finance',
  '/workload',
  '/documents',
  /* Added 2026-08-25 with the attendance feature. Open to every role: what
     differs by rank is the CONTENTS of the page, not whether it is offered. */
  '/attendance',
  '/vault',
  '/settings',
  /* Reached the Admin's rail on 2026-08-22 — owner decision, see migration 040. */
  '/security',
  '/workflow',
] as const;

describe('activeHref', () => {
  it('matches an exact path', () => {
    expect(activeHref(ADMIN_NAV, '/tasks')).toBe('/tasks');
    expect(activeHref(ADMIN_NAV, '/dashboard')).toBe('/dashboard');
  });

  it('keeps the parent lit on a detail route that is not itself in the nav', () => {
    /* The behaviour that must survive the change: `/projects/[id]` has no nav item
       of its own, so "Projects" stays current while the reader is inside one. */
    expect(activeHref(ADMIN_NAV, '/projects/abc-123')).toBe('/projects');
    expect(activeHref(ADMIN_NAV, '/projects/abc-123/anything')).toBe('/projects');
  });

  it('keeps AI Assistant lit on its activity sub-route', () => {
    /* ⚠️ Added 2026-08-27 with the activity screen, which is a real page at
        with NO nav item of its own — reached from a button
       in the corner of the assistant page. The rail must therefore keep AI
       Assistant lit while somebody is on it, or the reader is told they are
       nowhere.

       This is the first genuinely nested route under an existing nav item since
       the rule was written, which is exactly the case the fixture above was kept
       alive for. */
    expect(activeHref(ADMIN_NAV, '/assistant/activity')).toBe('/assistant');
  });

  it('prefers the child when the child is itself a nav item', () => {
    /* ⚠️ The case that prompted the rule. Both entries match `/reports/ceo`; only
       the more specific one may win. Kept as a fixture rather than dropped when the
       real route moved — this is the shape a future nested nav item will have, and
       the assertion is worthless once no case exercises it. */
    expect(activeHref(['/reports', '/reports/ceo'], '/reports/ceo')).toBe('/reports/ceo');
  });

  it('does not depend on declaration order', () => {
    expect(activeHref(['/reports/ceo', '/reports'], '/reports/ceo')).toBe('/reports/ceo');
    expect(activeHref(['/reports', '/reports/ceo'], '/reports/ceo')).toBe('/reports/ceo');
  });

  it("still lights the parent on the parent's own path", () => {
    expect(activeHref(ADMIN_NAV, '/reports')).toBe('/reports');
  });

  it('lights the parent for a child route that has no nav item of its own', () => {
    expect(activeHref(ADMIN_NAV, '/reports/something-else')).toBe('/reports');
  });

  it('never matches a partial segment', () => {
    /* ⚠️ `/reports-archive` begins with the characters of `/reports` but is a
       different route and must not light it. This is why the prefix test appends a
       slash, and why depth is counted in segments rather than characters. */
    expect(activeHref(['/reports'], '/reports-archive')).toBeNull();
    expect(activeHref(['/reports'], '/reportsx')).toBeNull();
  });

  it('ranks by segment depth, not by string length', () => {
    /* `/a/b` is deeper than `/aaaaaaaaaaaa` despite being shorter. Character
       length would pick the wrong one the first time a short nested route meets a
       long flat one. */
    expect(activeHref(['/aaaaaaaaaaaa', '/a', '/a/b'], '/a/b')).toBe('/a/b');
  });

  it('returns null for a path in no section', () => {
    /* Routes reached from the avatar menu rather than the rail — they have no nav
       item, and must leave every item unlit rather than lighting an arbitrary one.

       ⚠️ TWO ROUTES HAVE BEEN WRONG HERE, FOR THE SAME REASON. `/vault` was used
       first and is in the rail. `/security` replaced it and was correct until
       2026-08-22, when the Admin gained that screen and it became a rail item
       too. Both times the agreement check below is what caught it — which is the
       argument for keeping that check rather than trusting this list. */
    expect(activeHref(ADMIN_NAV, '/profile')).toBeNull();
    expect(activeHref(ADMIN_NAV, '/mfa-setup')).toBeNull();
  });

  it('handles an empty nav and the root path', () => {
    expect(activeHref([], '/tasks')).toBeNull();
    expect(activeHref(ADMIN_NAV, '/')).toBeNull();
  });

  it('lights exactly one item for every route in the tree', () => {
    /* ⚠️ The guard that makes a future nested route safe. Adding a child nav item
       without the specificity rule lights two, and this fails. */
    for (const href of ADMIN_NAV) {
      const active = activeHref(ADMIN_NAV, href);
      expect(active, `on ${href}`).toBe(href);
      expect(ADMIN_NAV.filter((h) => h === active), `on ${href}`).toHaveLength(1);
    }
  });
});

describe('the real navigation tree', () => {
  const ROLES = ['super_admin', 'admin', 'team_coordinator', 'member'] as const;

  it('agrees with the fixture above', () => {
    /* Otherwise the cases in this file drift into describing a tree that no longer
       exists, and keep passing while doing it. */
    expect([...hrefsForRole('admin')].sort()).toEqual([...ADMIN_NAV].sort());
  });

  it('lights exactly one item for every route it offers, for every role', () => {
    /* ⚠️ This is the check a future nested nav item will trip. It runs against the
       real config, so the bug cannot come back by adding a route and forgetting
       this rule exists. */
    for (const role of ROLES) {
      const hrefs = hrefsForRole(role);
      for (const href of hrefs) {
        const active = activeHref(hrefs, href);
        expect(active, `${role} on ${href}`).toBe(href);
        expect(hrefs.filter((h) => h === active), `${role} on ${href}`).toHaveLength(1);
      }
    }
  });

  it('offers the monthly report to nobody, and Reports to a Coordinator', () => {
    /* ── ⚠️ THIS ASSERTION WAS INVERTED ON 2026-08-29 ───────────────────────
       It used to require `/monthly-report` in an Admin's sidebar. Owner: *"only
       the report page is all working… so this monthly report page, remove it"* —
       of the sidebar item. So the link is offered to no rank now.

       ⚠️ AND IT IS NOT A PERMISSION CHANGE. The route still exists, still works,
       and still refuses anybody below Admin — `requireRole('admin')` in its own
       layout AND page is the floor, and this file has never been one (NFR-006).
       An unlinked page is a page you have to know the URL of, not a private one.
       If the item ever comes back, this test goes back with it. */
    expect(hrefsForRole('admin')).not.toContain('/monthly-report');
    expect(hrefsForRole('super_admin')).not.toContain('/monthly-report');
    expect(hrefsForRole('team_coordinator')).not.toContain('/monthly-report');
    expect(hrefsForRole('member')).not.toContain('/monthly-report');

    /* Reports is the one that stays, and for the Coordinator too — the owner's
       reason for withdrawing the other was that this one already works. */
    expect(hrefsForRole('team_coordinator')).toContain('/reports');
    expect(hrefsForRole('admin')).toContain('/reports');
  });

  it('keeps Reports lit for a Coordinator, who is offered no child item', () => {
    expect(activeHref(hrefsForRole('team_coordinator'), '/reports')).toBe('/reports');
  });
});
