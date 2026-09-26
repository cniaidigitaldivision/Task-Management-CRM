import { describe, expect, it } from 'vitest';

import { hrefsForRole } from '@/components/layout/nav-config';

/* ============================================================================
 * WHAT AN EXECUTIVE IS OFFERED — owner, 2026-09-25, page by page
 * ----------------------------------------------------------------------------
 * The sidebar is a convenience, never the boundary: migration 256 and the
 * permission matrix are what actually refuse a write. This test exists because
 * the LIST is a decision the owner made item by item, and a decision that lives
 * only in a config file is one a later edit can undo without anybody noticing.
 *
 * ⚠️ HIDDEN IS THE DEFAULT. `ALL` deliberately stayed at four roles, so a page
 * nobody has asked about yet does not appear here. If this test fails because a
 * new page showed up in the Executive's sidebar, the page is the bug.
 * ========================================================================= */

const SHOWN = [
  '/assistant',
  /* ⚠️ Added back 2026-09-26 — see the Executive permission test. */
  '/tasks',
  '/dashboard',
  '/workload',
  '/performance',
  '/projects',
  '/studio',
  '/leads',
  '/conversations',
  '/appointments',
  '/follow-ups',
  '/knowledge',
  '/clients',
  '/lead-overview',
  '/lead-reports',
  '/team',
  '/reports',
  '/attendance',
  '/documents',
  '/workflow',
] as const;

/** Each with the owner's own reason, so the next reader does not have to guess. */
const HIDDEN: ReadonlyArray<readonly [string, string]> = [
  ['/my-work', 'an Executive is never assigned work'],
  ['/repeats', '"definitely it will hide repeating tasks"'],
  ['/calendar', '"the calendar will not show"'],
  ['/my-leads', 'a salesperson\'s own queue, and not in the list the owner named'],
  ['/todos', '"no need for to-dos"'],
  ['/finance', '"right now hide it ... later on when I am sure I will tell you"'],
  ['/vault', '"definitely hide it — we don\'t need to show which credentials we are working on"'],
  ['/composer', '"just hide this composer from him because it didn\'t complete"'],
  ['/settings', 'all settings are Admin and Super Admin only'],
  ['/security', 'all settings are Admin and Super Admin only'],
];

describe("the Executive's sidebar", () => {
  const offered = hrefsForRole('executive');

  it.each(SHOWN)('offers %s', (href) => {
    expect(offered).toContain(href);
  });

  it.each(HIDDEN)('hides %s — %s', (href) => {
    expect(offered).not.toContain(href);
  });

  /* ⚠️ THE COUNT IS ASSERTED TOO. Without it, a new page added to `ALL_EXEC`
     would pass every case above and still reach them unnoticed. */
  it('offers exactly the pages that were agreed, and no others', () => {
    expect([...offered].sort()).toEqual([...SHOWN].sort());
  });

  it('leaves everybody else where they were', () => {
    /* A spot check on each rung: this change was meant to add a role, not to
       move anyone already on the ladder. */
    expect(hrefsForRole('member')).toContain('/my-work');
    expect(hrefsForRole('member')).not.toContain('/settings');
    expect(hrefsForRole('team_coordinator')).toContain('/reports');
    expect(hrefsForRole('team_coordinator')).not.toContain('/settings');
    expect(hrefsForRole('admin')).toContain('/settings');
    expect(hrefsForRole('admin')).toContain('/finance');
    expect(hrefsForRole('super_admin')).toContain('/security');
  });
});

/* ============================================================================
 * ⚠️ THE CAPABILITY PATH, WHICH THE TESTS ABOVE CANNOT SEE
 * ----------------------------------------------------------------------------
 * `hrefsForRole(role)` with no second argument was green while the real sidebar
 * showed My leads and My to-dos to an Executive. The sidebar passes
 * `{ crm, crmReports }`, and `requires` adds items a role's own list leaves out
 * — which is right for a salesperson whose app role is `member`, and wrong for
 * a role whose list was written page by page.
 *
 * Opening the Lead Desk set `crm` true and handed back two pages that had been
 * closed on purpose. Only a walkthrough caught it, so this is the test that
 * would have.
 * ========================================================================= */
describe("the Executive's sidebar with every capability switched on", () => {
  const wideOpen = hrefsForRole('executive', { crm: true, crmReports: true });

  it('is exactly the same list', () => {
    expect([...wideOpen].sort()).toEqual([...hrefsForRole('executive')].sort());
  });

  it.each(['/my-leads', '/todos'])('still hides %s', (href) => {
    expect(wideOpen).not.toContain(href);
  });

  it('still lets a capability add pages for everybody else', () => {
    /* A salesperson is a `member`, and the desk is their whole job. If this
       ever fails, the fix above has been applied too widely. */
    const salesperson = hrefsForRole('member', { crm: true, crmReports: false });
    expect(salesperson).toContain('/leads');
    expect(salesperson).toContain('/my-leads');
    expect(hrefsForRole('member')).not.toContain('/leads');
  });
});
