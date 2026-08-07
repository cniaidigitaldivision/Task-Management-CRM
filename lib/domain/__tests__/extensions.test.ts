import { describe, expect, it } from 'vitest';

import { ROLES, type Role } from '../constants';
import {
  MAX_EXTENSION_MINUTES,
  MIN_EXTENSION_MINUTES,
  buildDecisionContext,
  canDecideExtensions,
  formatMinutes,
  outcomeStatus,
  validateDecision,
  validateRequest,
} from '../extensions';

/* ============================================================================
 * TIME EXTENSIONS — BR-018, FR-183 to FR-186
 * ----------------------------------------------------------------------------
 * The Coordinator case is the one to get right. They can set a time limit and
 * cannot extend one, which is the opposite of how almost every other permission
 * in this system works — everywhere else "senior enough to plan" means "senior
 * enough to change". The owner was explicit, and doc 17 §6 locks it.
 * ========================================================================= */

describe('who may decide (BR-018 / FR-184)', () => {
  it('allows Admin and Super Admin', () => {
    expect(canDecideExtensions('admin')).toBe(true);
    expect(canDecideExtensions('super_admin')).toBe(true);
  });

  it('refuses a Coordinator, who sets limits but never extends them', () => {
    expect(canDecideExtensions('team_coordinator')).toBe(false);
  });

  it('refuses a Member', () => {
    expect(canDecideExtensions('member')).toBe(false);
  });

  it('covers every role in the system, so a new one cannot default to allowed', () => {
    const allowed = ROLES.filter((role) => canDecideExtensions(role));
    expect(allowed.sort()).toEqual(['admin', 'super_admin']);
  });
});

describe('validateRequest (FR-183)', () => {
  const base = {
    requestedMinutes: 120,
    reason: 'Client sent replacement footage at 3pm and the grade had to be redone.',
    hasTimeLimit: true,
    pendingAlready: false,
  };

  it('accepts a well-formed request', () => {
    expect(validateRequest(base).ok).toBe(true);
  });

  it('refuses when the task has no limit to extend', () => {
    /* Granting minutes onto a null limit produces a limit nobody set, arrived
       at by accident. */
    const result = validateRequest({ ...base, hasTimeLimit: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('no time limit');
  });

  it('refuses a second request while one is pending', () => {
    const result = validateRequest({ ...base, pendingAlready: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('already');
  });

  it('refuses an empty or one-word reason', () => {
    for (const reason of ['', '   ', 'slow', 'busy', 'need 2h']) {
      expect(validateRequest({ ...base, reason }).ok, reason).toBe(false);
    }
  });

  it('accepts a short but real sentence', () => {
    /* The floor is length, and length cannot judge quality — "took longer"
       clears it and says nothing. That is accepted deliberately: the check
       exists to stop an empty box being submitted, not to grade prose, and a
       higher bar would only teach people to pad. The Admin reading it is the
       real filter. */
    expect(validateRequest({ ...base, reason: 'Footage arrived late.' }).ok).toBe(true);
  });

  it('refuses less than the floor', () => {
    expect(validateRequest({ ...base, requestedMinutes: MIN_EXTENSION_MINUTES - 1 }).ok).toBe(false);
    expect(validateRequest({ ...base, requestedMinutes: 0 }).ok).toBe(false);
    expect(validateRequest({ ...base, requestedMinutes: -60 }).ok).toBe(false);
  });

  it('accepts exactly the floor and exactly the ceiling', () => {
    expect(validateRequest({ ...base, requestedMinutes: MIN_EXTENSION_MINUTES }).ok).toBe(true);
    expect(validateRequest({ ...base, requestedMinutes: MAX_EXTENSION_MINUTES }).ok).toBe(true);
  });

  it('refuses more than the ceiling, and says what to do instead', () => {
    const result = validateRequest({ ...base, requestedMinutes: MAX_EXTENSION_MINUTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('re-planned');
  });

  it('parses the string a form submits', () => {
    expect(validateRequest({ ...base, requestedMinutes: ' 90 ' }).ok).toBe(true);
  });

  it('refuses a fraction and refuses text', () => {
    expect(validateRequest({ ...base, requestedMinutes: 90.5 }).ok).toBe(false);
    expect(validateRequest({ ...base, requestedMinutes: 'a while' }).ok).toBe(false);
    expect(validateRequest({ ...base, requestedMinutes: null }).ok).toBe(false);
  });
});

describe('validateDecision (FR-184, FR-186)', () => {
  const base = {
    role: 'admin' as Role,
    decision: 'approve' as const,
    requestedMinutes: 120,
    grantedMinutes: 120,
    note: '',
    currentStatus: 'pending' as const,
  };

  it('accepts a full approval with no note', () => {
    /* Approving agrees with the reason already written. There is nothing to
       add, so demanding a note would just train people to type "ok". */
    expect(validateDecision(base).ok).toBe(true);
  });

  it('accepts a partial approval', () => {
    expect(validateDecision({ ...base, grantedMinutes: 60 }).ok).toBe(true);
  });

  it('refuses a Coordinator, naming the rule', () => {
    const result = validateDecision({ ...base, role: 'team_coordinator' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('BR-018');
  });

  it('refuses a Member', () => {
    expect(validateDecision({ ...base, role: 'member' }).ok).toBe(false);
  });

  it('refuses a decision on a request already decided', () => {
    /* Two Admins open the same request. Without this the second silently
       overwrites the first and the requester gets two contradictory answers. */
    for (const status of ['approved', 'partially_approved', 'declined', 'cancelled'] as const) {
      const result = validateDecision({ ...base, currentStatus: status });
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.message).toContain('already been decided');
    }
  });

  it('refuses granting more than was asked for', () => {
    const result = validateDecision({ ...base, grantedMinutes: 121 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('time limit directly');
  });

  it('refuses granting nothing — that is a decline', () => {
    expect(validateDecision({ ...base, grantedMinutes: 0 }).ok).toBe(false);
    expect(validateDecision({ ...base, grantedMinutes: MIN_EXTENSION_MINUTES - 1 }).ok).toBe(false);
  });

  it('requires a written reason to decline (FR-186)', () => {
    const bare = validateDecision({ ...base, decision: 'decline', note: '' });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.message).toContain('reason');

    expect(validateDecision({ ...base, decision: 'decline', note: 'no' }).ok).toBe(false);
    expect(
      validateDecision({
        ...base,
        decision: 'decline',
        note: 'The deadline is fixed by the client — hand the remaining grade to Ayesha.',
      }).ok,
    ).toBe(true);
  });

  it('checks the role before anything else, so the message is the real reason', () => {
    /* A Coordinator submitting a malformed decision should be told they cannot
       decide, not that their number is wrong. */
    const result = validateDecision({
      ...base,
      role: 'team_coordinator',
      grantedMinutes: 99_999,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Admin');
  });
});

describe('outcomeStatus', () => {
  it('is approved when the full amount is granted', () => {
    expect(outcomeStatus('approve', 120, 120)).toBe('approved');
  });

  it('is partial when less is granted', () => {
    /* Its own status, not a lesser approval — "they asked for 2h and got 1h" is
       a different fact from "they got what they asked for", and the reports
       need to tell them apart. */
    expect(outcomeStatus('approve', 120, 60)).toBe('partially_approved');
  });

  it('is declined regardless of any number attached', () => {
    expect(outcomeStatus('decline', 120, 0)).toBe('declined');
    expect(outcomeStatus('decline', 120, 120)).toBe('declined');
  });
});

describe('formatMinutes', () => {
  it('reads the way somebody says it out loud', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(135)).toBe('2h 15m');
    expect(formatMinutes(1440)).toBe('24h');
  });

  it('never shows a negative', () => {
    expect(formatMinutes(-30)).toBe('0m');
  });

  it('rounds a fractional minute', () => {
    expect(formatMinutes(59.6)).toBe('1h');
  });
});

describe('buildDecisionContext (doc 17 §5)', () => {
  it('reports how far over the limit the task is', () => {
    const context = buildDecisionContext({
      consumedMinutes: 252,
      limitMinutes: 240,
      priorExtensionsOnTask: 0,
      requesterUtilisationPct: 94,
      daysToDue: 2,
    });
    expect(context.overByMinutes).toBe(12);
    expect(context.estimateLooksLow).toBe(false);
  });

  it('never reports a negative overrun', () => {
    const context = buildDecisionContext({
      consumedMinutes: 100,
      limitMinutes: 240,
      priorExtensionsOnTask: 0,
      requesterUtilisationPct: null,
      daysToDue: null,
    });
    expect(context.overByMinutes).toBe(0);
  });

  it('flags a low estimate once the task has been extended before', () => {
    /* The point of doc 17 §5: a second extension says the budget was wrong, not
       that the person is slow. That reframing is what makes each approval a
       correction to estimating rather than a judgement. */
    const context = buildDecisionContext({
      consumedMinutes: 400,
      limitMinutes: 240,
      priorExtensionsOnTask: 1,
      requesterUtilisationPct: 88,
      daysToDue: 1,
    });
    expect(context.estimateLooksLow).toBe(true);
  });
});
