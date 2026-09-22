import { describe, expect, it } from 'vitest';

import { matchesRaisedBy, RAISED_BY_OPTIONS } from '../raised-by';

/* ============================================================================
 * "WHAT DID I HAND OUT?" — the question the task toolbar never answered
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"there is no option for me to see all the assigned tasks
 * … If I say Assigned Tasks, show a further category: All Assigned Tasks or
 * Some Specific Person's Assigned Tasks."*
 *
 * The three cases are each other's near-misses, which is the whole reason these
 * exist: a `by_me` that quietly includes my own to-do list still LOOKS right.
 * ========================================================================= */

const ME = 'kashif';
const THEM = 'najam';

const task = (createdById: string, assigneeId: string | null) => ({ createdById, assigneeId });

describe('who raised it', () => {
  it('“Anyone” keeps everything', () => {
    for (const t of [task(ME, ME), task(ME, THEM), task(THEM, ME), task(THEM, THEM)]) {
      expect(matchesRaisedBy(t, 'all', ME)).toBe(true);
    }
  });

  it('⚠️ “Assigned by me” is work I handed to somebody ELSE', () => {
    expect(matchesRaisedBy(task(ME, THEM), 'by_me', ME)).toBe(true);
    /* The near-miss: my own to-do item. Including it would turn a manager's
       "what did I give the team" into a reading of their own list. */
    expect(matchesRaisedBy(task(ME, ME), 'by_me', ME)).toBe(false);
    expect(matchesRaisedBy(task(THEM, THEM), 'by_me', ME)).toBe(false);
    expect(matchesRaisedBy(task(THEM, ME), 'by_me', ME)).toBe(false);
  });

  it('⚠️ and unassigned work counts as handed out — it just has not been caught yet', () => {
    expect(matchesRaisedBy(task(ME, null), 'by_me', ME)).toBe(true);
    expect(matchesRaisedBy(task(ME, null), 'mine', ME)).toBe(false);
  });

  it('“Created by me” is the work I raised for myself', () => {
    expect(matchesRaisedBy(task(ME, ME), 'mine', ME)).toBe(true);
    expect(matchesRaisedBy(task(ME, THEM), 'mine', ME)).toBe(false);
    expect(matchesRaisedBy(task(THEM, ME), 'mine', ME)).toBe(false);
  });

  it('“Assigned to me” is what somebody else put on my plate', () => {
    expect(matchesRaisedBy(task(THEM, ME), 'to_me', ME)).toBe(true);
    /* Not my own — I did not have it handed to me. */
    expect(matchesRaisedBy(task(ME, ME), 'to_me', ME)).toBe(false);
    expect(matchesRaisedBy(task(THEM, THEM), 'to_me', ME)).toBe(false);
  });

  it('⚠️ the three narrowing options partition my work with no overlap and no gap', () => {
    /* Every task involving me falls in exactly one of them — which is what makes
       the control trustworthy: nothing is counted twice and nothing is lost. */
    for (const t of [task(ME, ME), task(ME, THEM), task(THEM, ME), task(ME, null)]) {
      const hits = (['by_me', 'mine', 'to_me'] as const).filter((r) => matchesRaisedBy(t, r, ME));
      expect(hits).toHaveLength(1);
    }
    /* And somebody else's work entirely is in none of them. */
    const none = (['by_me', 'mine', 'to_me'] as const).filter((r) =>
      matchesRaisedBy(task(THEM, THEM), r, ME),
    );
    expect(none).toHaveLength(0);
  });

  it('offers the four options the owner named, in that order', () => {
    expect(RAISED_BY_OPTIONS.map((o) => o.value)).toEqual(['all', 'by_me', 'mine', 'to_me']);
  });
});
