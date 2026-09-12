import { describe, expect, it } from 'vitest';

import {
  crmIsOpenTo,
  crmReportsOpenTo,
  type ActingDepartment,
  type CurrentUser,
} from '../current-user';

/* ============================================================================
 * WHO THE CAMPAIGN & LEAD DESK IS OPEN TO
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-10: *"This whole CRM will be hidden by the other team members,
 * except admin, super admin, and these tester IDs that I have added, because
 * these are in the sales department so they can see. Other than that nobody can
 * see."*
 *
 * And, asked directly because it reversed a recorded answer: *"That was the team
 * coordinator, not the sales manager. The team coordinator will be part of a
 * digital creator team… But for the salespersons or for the management of the
 * lead, all this CRM belongs to the sales manager and the salespersons. Plus
 * admin and super admin are by default added."*
 *
 * ── ⚠️ THIS FUNCTION IS NOT THE FLOOR, AND THESE TESTS DO NOT PROVE ACCESS ──
 * Migration 118's policies are the floor. This decides whether a PAGE IS DRAWN;
 * the database decides whether a row comes back. The worst case if the two ever
 * disagree is a screen that opens and shows nothing — never a leak. What these
 * cases pin is that the two say the same thing today, because the pair is kept
 * in step by hand and nothing else would notice if it drifted.
 * ========================================================================= */

function person(role: CurrentUser['role']): CurrentUser {
  /* Only `role` is read. The rest is filled so the fixture is a real
     CurrentUser rather than a cast that would survive the shape changing. */
  return {
    id: '00000000-0000-0000-0000-000000000001',
    sessionId: '00000000-0000-0000-0000-000000000002',
    fullName: 'A Person',
    email: 'a@example.com',
    role,
    roleTitle: null,
    avatarUrl: null,
    theme: 'light',
    timezone: 'Asia/Karachi',
    weeklyCapacityPoints: 36,
    maxConcurrentTasks: 5,
    stepUpVerifiedAt: null,
  };
}

/**
 * A department, and whether any project's leads route to it.
 *
 * ⚠️ `ownsLeads` IS THE RULE NOW, NOT THE KEY. Until migration 124 this was
 * `key === 'sales'`; the owner then routed the division's own product leads to
 * AI & Digital, and access follows the routing rather than one department's
 * name. These fixtures therefore set the two independently — including the
 * combination that used to be impossible: a department called `sales` that owns
 * nothing.
 */
const IN = (
  key: string | null,
  { manager = false, ownsLeads = false }: { manager?: boolean; ownsLeads?: boolean } = {},
): ActingDepartment => ({
  key,
  name: key,
  isManager: manager,
  ownsLeadProjects: ownsLeads,
});

describe('a department that owns leads', () => {
  it('opens for a salesperson, who is only a Member', () => {
    /* ⚠️ THE CASE RANK CANNOT EXPRESS. All three sales testers are `member` —
       the bottom of the ladder — and this is their whole job. */
    expect(crmIsOpenTo(person('member'), IN('sales', { ownsLeads: true }))).toBe(true);
  });

  it('opens for the sales manager, who is also only a Member', () => {
    /* ADR-002 fixed the app at four ranks and Step 6 did not add a fifth.
       Seniority inside a department is a different question from app authority. */
    expect(
      crmIsOpenTo(person('member'), IN('sales', { manager: true, ownsLeads: true })),
    ).toBe(true);
  });

  it('⚠️ opens for AI & Digital too, since the ERP leads route there', () => {
    /* The case migration 124 exists for. Owner: *"AI & Digital owns them, under
       Kashif."* Before 124 this returned false, because the rule was the word
       "sales" rather than the routing. */
    expect(crmIsOpenTo(person('member'), IN('digital', { ownsLeads: true }))).toBe(true);
    expect(
      crmIsOpenTo(person('team_coordinator'), IN('digital', { manager: true, ownsLeads: true })),
    ).toBe(true);
  });

  it('⚠️ refuses a department that owns no project, whatever it is called', () => {
    /* Including one called `sales`. The name is not the rule — a Sales
       department with every project routed elsewhere works no leads. */
    expect(crmIsOpenTo(person('member'), IN('sales', { ownsLeads: false }))).toBe(false);
    expect(crmIsOpenTo(person('member'), IN('digital', { ownsLeads: false }))).toBe(false);
  });
});

describe('everybody else', () => {
  it('⚠️ refuses a Coordinator whose department owns nothing', () => {
    /* This began as "refuses the Team Coordinator", reversing the answer of
       2026-09-09 — he coordinates tasks, and leads were never his work. It has
       since become subtler: Kashif Ayaz IS the Coordinator and now manages
       AI & Digital, whose product leads route to him. So the rank still decides
       nothing either way; the routing does. */
    expect(crmIsOpenTo(person('team_coordinator'), IN('digital'))).toBe(false);
    expect(crmIsOpenTo(person('team_coordinator'), IN(null))).toBe(false);
  });

  it('refuses a Member in a department nothing routes to', () => {
    for (const dept of ['development', 'finance', 'hr', 'operations', 'support']) {
      expect(crmIsOpenTo(person('member'), IN(dept)), dept).toBe(false);
    }
  });

  it('refuses somebody with no department at all', () => {
    /* ⚠️ The default for a new account. Fails closed: a person is admitted by
       being put somewhere, never by not having been filed yet. */
    expect(crmIsOpenTo(person('member'), IN(null))).toBe(false);
  });

  it('does not read the department NAME at all any more', () => {
    /* ⚠️ These used to be the interesting cases — `sales_support` and
       `after_sales` had to be told apart from `sales` by an exact comparison.
       Migration 124 removed the comparison entirely, so what decides is the
       routing and a name can no longer be near-missed. */
    expect(crmIsOpenTo(person('member'), IN('sales_support'))).toBe(false);
    expect(crmIsOpenTo(person('member'), IN('after_sales', { ownsLeads: true }))).toBe(true);
  });
});

describe('admin and super admin, by default', () => {
  it('opens whatever department they are in, or none', () => {
    /* *"Plus admin and super admin are by default added."* Both are in
       Management, and neither should depend on that staying true. */
    for (const dept of ['management', 'sales', 'digital', null]) {
      expect(crmIsOpenTo(person('admin'), IN(dept)), `admin/${dept}`).toBe(true);
      expect(crmIsOpenTo(person('super_admin'), IN(dept)), `super/${dept}`).toBe(true);
    }
  });
});

/* ============================================================================
 * AND WHO THE LEAD REPORTS ARE OPEN TO — NARROWER THAN THE DESK
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-12: *"lead reports will not be seen by the salesperson. In the
 * sales tester it shouldn't be shown in their dashboard but the sales manager
 * should see it… Also admin/super admin by default will see everything."*
 *
 * ⚠️ THE DISTINCTION IS `department_role`, NOT `users.role`, AND THAT IS THE
 * WHOLE POINT OF THESE CASES. The sales manager and the salespeople are all
 * `member` in the application's four ranks — ADR-002 fixed that and ADR-012
 * kept it, because seniority inside a department is a different question from
 * authority over the application. Every case below therefore passes the SAME
 * rank and varies only the department, which is the one thing rank cannot
 * express.
 * ========================================================================= */
describe('the lead reports', () => {
  it('⚠️ are hidden from a salesperson, who can still work the desk', () => {
    const salesperson = IN('sales', { ownsLeads: true });
    /* The pair that matters: the desk opens, the reports do not. */
    expect(crmIsOpenTo(person('member'), salesperson)).toBe(true);
    expect(crmReportsOpenTo(person('member'), salesperson)).toBe(false);
  });

  it('open for the sales manager, who is also only a Member', () => {
    expect(
      crmReportsOpenTo(person('member'), IN('sales', { manager: true, ownsLeads: true })),
    ).toBe(true);
  });

  it('open for an Admin and a Super Admin regardless of department', () => {
    /* "Admin/super admin by default will see everything" — including from
       Management, which owns no lead-routed project at all. */
    expect(crmReportsOpenTo(person('admin'), IN('management'))).toBe(true);
    expect(crmReportsOpenTo(person('super_admin'), IN(null))).toBe(true);
  });

  it('⚠️ stay shut for a manager whose department owns no leads', () => {
    /* Managing a department is not the qualification; managing a department the
       leads route to is. Otherwise every department head in the company reads
       the sales team's response times. */
    expect(
      crmReportsOpenTo(person('member'), IN('development', { manager: true })),
    ).toBe(false);
  });

  it('⚠️ stay shut for a Team Coordinator who manages no lead department', () => {
    /* The rank is above `member` and buys nothing here. Promoting somebody to
       team_coordinator to unlock this page would hand them Finance and the
       company's Reports instead — see `crmReportsOpenTo`. */
    expect(crmReportsOpenTo(person('team_coordinator'), IN('development'))).toBe(false);
  });

  it('open for Kashif — AI & Digital manages its own product leads', () => {
    expect(
      crmReportsOpenTo(person('team_coordinator'), IN('digital', { manager: true, ownsLeads: true })),
    ).toBe(true);
  });
});
