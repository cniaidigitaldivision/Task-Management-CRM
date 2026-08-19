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
  '/my-work',
  '/tasks',
  '/calendar',
  '/projects',
  '/team',
  '/reports',
  '/monthly-report',
  '/workload',
  '/documents',
  '/vault',
  '/settings',
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
       ⚠️ `/vault` was used here first and is wrong: it IS in the rail. The
       agreement check below is what caught that. */
    expect(activeHref(ADMIN_NAV, '/security')).toBeNull();
    expect(activeHref(ADMIN_NAV, '/profile')).toBeNull();
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

  it('offers the monthly report to an Admin and not to a Coordinator', () => {
    /* The nav mirrors the rank floor that `requireRole` enforces in the route's
       layout and page. Offering a link that only redirects would be a dead end;
       the floor itself is not this file's job (NFR-006). */
    expect(hrefsForRole('admin')).toContain('/monthly-report');
    expect(hrefsForRole('team_coordinator')).toContain('/reports');
    expect(hrefsForRole('team_coordinator')).not.toContain('/monthly-report');
    expect(hrefsForRole('member')).not.toContain('/monthly-report');
  });

  it('keeps Reports lit for a Coordinator, who is offered no child item', () => {
    expect(activeHref(hrefsForRole('team_coordinator'), '/reports')).toBe('/reports');
  });
});
