import { describe, expect, it } from 'vitest';

import { crmIsOpenTo, type ActingDepartment, type CurrentUser } from '../current-user';

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

const IN = (key: string | null, isManager = false): ActingDepartment => ({
  key,
  name: key,
  isManager,
});

describe('the sales department', () => {
  it('opens for a salesperson, who is only a Member', () => {
    /* ⚠️ THE CASE RANK CANNOT EXPRESS. All three sales testers are `member` —
       the bottom of the ladder — and this is their whole job. */
    expect(crmIsOpenTo(person('member'), IN('sales'))).toBe(true);
  });

  it('opens for the sales manager, who is also only a Member', () => {
    /* ADR-002 fixed the app at four ranks and Step 6 did not add a fifth.
       Seniority inside a department is a different question from app authority. */
    expect(crmIsOpenTo(person('member'), IN('sales', true))).toBe(true);
  });
});

describe('everybody else', () => {
  it('⚠️ refuses the Team Coordinator, reversing the answer of 2026-09-09', () => {
    /* He coordinates the digital team's tasks. Leads were never his work, and
       migration 118 says the same thing in SQL. */
    expect(crmIsOpenTo(person('team_coordinator'), IN('digital'))).toBe(false);
    expect(crmIsOpenTo(person('team_coordinator'), IN(null))).toBe(false);
  });

  it('refuses a Member in any other department', () => {
    for (const dept of ['digital', 'development', 'finance', 'hr', 'operations', 'support']) {
      expect(crmIsOpenTo(person('member'), IN(dept)), dept).toBe(false);
    }
  });

  it('refuses somebody with no department at all', () => {
    /* ⚠️ The default for a new account. Fails closed: a person is admitted by
       being put somewhere, never by not having been filed yet. */
    expect(crmIsOpenTo(person('member'), IN(null))).toBe(false);
  });

  it('is not fooled by a department that merely contains the word', () => {
    /* The key is compared exactly. A department called `sales_support` is a
       different department, and `after_sales` is not sales either. */
    expect(crmIsOpenTo(person('member'), IN('sales_support'))).toBe(false);
    expect(crmIsOpenTo(person('member'), IN('after_sales'))).toBe(false);
    expect(crmIsOpenTo(person('member'), IN('Sales'))).toBe(false);
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
