import { describe, expect, it } from 'vitest';

import {
  type AssistantAccessRow,
  describeAccess,
  mayUseAssistant,
  nextAccessEffect,
  resolveAssistantAccess,
} from '@/lib/domain/assistant-access';
import type { Role } from '@/lib/domain/constants';
import type { Actor } from '@/lib/domain/permissions';

/* ============================================================================
 * WHO MAY ASK
 * ----------------------------------------------------------------------------
 * The permission matrix test asserts the role FLOOR. This asserts the composed
 * rule, which is the one the product actually applies — and the one the owner
 * described: *"a radio button for each member [...] that I can switch on and
 * off at my choice."*
 * ========================================================================= */

const actor = (role: Role): Actor => ({ id: `u-${role}`, role });

function row(effect: 'allow' | 'deny'): AssistantAccessRow {
  return {
    userId: 'u-x',
    effect,
    grantedByName: 'Umm-e-Habiba',
    grantedAt: '2026-08-26T10:00:00.000Z',
    note: null,
  };
}

describe('the role floor, with no override', () => {
  it.each([
    ['super_admin', true],
    ['admin', true],
    ['team_coordinator', true],
    ['member', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(mayUseAssistant(actor(role), null)).toBe(expected);
  });

  it('names the reason, so the screen can explain rather than just show', () => {
    expect(resolveAssistantAccess(actor('admin'), null).reason).toBe('by_role');
    expect(resolveAssistantAccess(actor('member'), null).reason).toBe('role_denied');
  });
});

describe('an override wins, in both directions', () => {
  /* The owner's radio button, switching somebody ON. */
  it('turns a Member on', () => {
    const access = resolveAssistantAccess(actor('member'), row('allow'));
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe('granted');
  });

  /* ⚠️ The half that "grants may only ADD" would have lost. Without it the
     owner could switch a Member on and could NOT switch a Coordinator off, so
     the control would be dead on three of five rows with no explanation. */
  it('turns a Coordinator off', () => {
    const access = resolveAssistantAccess(actor('team_coordinator'), row('deny'));
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('excluded');
  });

  it('turns an Admin off', () => {
    expect(mayUseAssistant(actor('admin'), row('deny'))).toBe(false);
  });

  /* ⚠️ Even the Super Admin. Not a philosophical point — if the row did not
     apply here, the screen would show a switch on their line that silently did
     nothing, and the first person to try it would report a bug. */
  it('turns the Super Admin off', () => {
    expect(mayUseAssistant(actor('super_admin'), row('deny'))).toBe(false);
  });

  it('is redundant but harmless where it agrees with the role', () => {
    expect(mayUseAssistant(actor('admin'), row('allow'))).toBe(true);
  });
});

describe('describeAccess', () => {
  /* ⚠️ "by rank" and "by name" must read differently, because they are revoked
     differently: the first by excluding the person, the second by removing
     their row. One shared tick would offer a control that does nothing. */
  it('separates rank from a named decision', () => {
    expect(describeAccess(resolveAssistantAccess(actor('admin'), null))).toBe('Included by rank');
    expect(describeAccess(resolveAssistantAccess(actor('member'), row('allow')))).toBe(
      'Switched on by name',
    );
    expect(describeAccess(resolveAssistantAccess(actor('admin'), row('deny')))).toBe(
      'Switched off by name',
    );
    expect(describeAccess(resolveAssistantAccess(actor('member'), null))).toBe('Not included');
  });
});

/* ============================================================================
 * THE SWITCH
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27, supplying a reference design with an on/off switch per
 * person. There are three states and the control has two positions, so the
 * third has to be maintained rather than set — see `nextAccessEffect`.
 *
 * ── ⚠️ WHY THIS IS TESTED AND NOT JUST REASONED ABOUT ──────────────────────
 * Both the correct rule and the naive one ("on writes allow, off writes deny")
 * produce a switch that looks right on screen. They differ only in whether a
 * redundant row is left behind, which is invisible until somebody reads the
 * table — or until the person is promoted and a stale `allow` starts shadowing
 * a rank that would have said yes anyway.
 * ========================================================================= */

describe('flipping the switch', () => {
  it('turns a Member ON by writing a grant', () => {
    // Off, and their rank keeps them off — so the row is what carries it.
    expect(nextAccessEffect(false, false)).toBe('allow');
  });

  it('turns a granted Member back OFF by REMOVING the grant, not by denying', () => {
    // ⚠️ The interesting case. `deny` would also make them unable to ask, and
    // would leave a row saying an Admin excluded somebody their rank already
    // excludes — a decision on the record that nobody took.
    expect(nextAccessEffect(true, false)).toBe('reset');
  });

  it('turns a Coordinator OFF by writing an exclusion', () => {
    // On by rank, so switching off needs a row to override the rank.
    expect(nextAccessEffect(true, true)).toBe('deny');
  });

  it('turns an excluded Coordinator back ON by REMOVING the exclusion', () => {
    // ⚠️ Not by writing `allow`. Rank already says yes; a grant on top of it is
    // a row with nothing to say, and it survives a later demotion as a
    // permission nobody remembers granting.
    expect(nextAccessEffect(false, true)).toBe('reset');
  });

  it('round-trips to no row at all', () => {
    // Off and on again leaves the person exactly as they started, whatever
    // their rank — which is the whole property the naive version loses.
    for (const roleAllows of [true, false]) {
      const away = nextAccessEffect(roleAllows, roleAllows);
      expect(away).not.toBe('reset');

      // Now they are in the opposite state; flip back.
      expect(nextAccessEffect(!roleAllows, roleAllows)).toBe('reset');
    }
  });

  it('never writes a row that agrees with the rank underneath it', () => {
    for (const currentlyAllowed of [true, false]) {
      for (const roleAllows of [true, false]) {
        const effect = nextAccessEffect(currentlyAllowed, roleAllows);
        if (effect === 'reset') continue;
        expect(effect === 'allow').not.toBe(roleAllows);
      }
    }
  });

  it('agrees with the resolver it feeds', () => {
    // The switch and the rule that reads the result must not drift: applying
    // what this returns has to produce the state the flip was asking for.
    const cases = [
      { role: 'member' as const, from: null },
      { role: 'member' as const, from: row('allow') },
      { role: 'team_coordinator' as const, from: null },
      { role: 'team_coordinator' as const, from: row('deny') },
    ];

    for (const { role, from } of cases) {
      const who = actor(role);
      const now = resolveAssistantAccess(who, from);
      const roleAllows = resolveAssistantAccess(who, null).allowed;

      const effect = nextAccessEffect(now.allowed, roleAllows);
      const written = effect === 'reset' ? null : row(effect);

      expect(resolveAssistantAccess(who, written).allowed).toBe(!now.allowed);
    }
  });
});
