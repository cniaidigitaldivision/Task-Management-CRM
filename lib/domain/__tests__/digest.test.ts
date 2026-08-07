import { describe, expect, it } from 'vitest';

import { buildDigest, digestText, type DigestInput, type DigestTask } from '../digest';

/* ============================================================================
 * THE DAILY DIGEST — FR-081
 * ----------------------------------------------------------------------------
 * `isWorthSending` is the assertion that matters. A digest that arrives every
 * morning saying "nothing needs you" trains people to delete it unread within a
 * fortnight, and then the one that matters is deleted too.
 * ========================================================================= */

const task = (over: Partial<DigestTask> = {}): DigestTask => ({
  reference: 'EVT-1',
  title: 'Edit the showreel',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  projectName: 'Expo',
  ...over,
});

const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  fullName: 'Kashif Ahmed',
  today: '2026-08-07',
  assigned: [],
  awaitingYourReview: [],
  pendingExtensions: 0,
  utilisationPct: null,
  ...over,
});

describe('isWorthSending', () => {
  it('is false when there is genuinely nothing', () => {
    expect(buildDigest(input()).isWorthSending).toBe(false);
  });

  it('is false when the only work is due later this week', () => {
    /* Something due Friday is not news on Monday, and it will be news on
       Thursday. Sending it now spends attention early, on the same email that
       has to carry the overdue notice next week. */
    const digest = buildDigest(
      input({ assigned: [task({ reference: 'EVT-2', dueDate: '2026-08-11' })] }),
    );
    expect(digest.dueThisWeek).toHaveLength(1);
    expect(digest.isWorthSending).toBe(false);
  });

  it('is true for one overdue task', () => {
    expect(
      buildDigest(input({ assigned: [task({ dueDate: '2026-08-01' })] })).isWorthSending,
    ).toBe(true);
  });

  it('is true for an extension waiting on you, with no tasks at all', () => {
    expect(buildDigest(input({ pendingExtensions: 1 })).isWorthSending).toBe(true);
  });

  it('is true for a review waiting on you', () => {
    expect(
      buildDigest(input({ awaitingYourReview: [task({ status: 'in_review' })] })).isWorthSending,
    ).toBe(true);
  });
});

describe('bucketing', () => {
  it('separates overdue from due today', () => {
    const digest = buildDigest(
      input({
        assigned: [
          task({ reference: 'A', dueDate: '2026-08-05' }),
          task({ reference: 'B', dueDate: '2026-08-07' }),
        ],
      }),
    );
    expect(digest.overdue.map((t) => t.reference)).toEqual(['A']);
    expect(digest.dueToday.map((t) => t.reference)).toEqual(['B']);
  });

  it('lists a task once, even when it is both overdue and blocked', () => {
    /* The same task in three sections makes a short digest look long and a long
       one unreadable. */
    const digest = buildDigest(
      input({ assigned: [task({ reference: 'A', dueDate: '2026-08-01', status: 'blocked' })] }),
    );
    expect(digest.overdue).toHaveLength(1);
    expect(digest.blocked).toHaveLength(0);
  });

  it('ignores done and cancelled work', () => {
    const digest = buildDigest(
      input({
        assigned: [
          task({ reference: 'A', dueDate: '2026-08-01', status: 'done' }),
          task({ reference: 'B', dueDate: '2026-08-01', status: 'cancelled' }),
        ],
      }),
    );
    expect(digest.overdue).toHaveLength(0);
    expect(digest.isWorthSending).toBe(false);
  });

  it('excludes something due in a fortnight from this week', () => {
    const digest = buildDigest(input({ assigned: [task({ dueDate: '2026-08-25' })] }));
    expect(digest.dueThisWeek).toHaveLength(0);
  });

  it('puts undated work in no bucket at all', () => {
    const digest = buildDigest(input({ assigned: [task({ dueDate: null })] }));
    expect(digest.overdue).toHaveLength(0);
    expect(digest.dueToday).toHaveLength(0);
    expect(digest.dueThisWeek).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('puts urgent first, then the earliest due date', () => {
    const digest = buildDigest(
      input({
        assigned: [
          task({ reference: 'LOW', priority: 'low', dueDate: '2026-08-01' }),
          task({ reference: 'URGENT', priority: 'urgent', dueDate: '2026-08-03' }),
          task({ reference: 'HIGH', priority: 'high', dueDate: '2026-08-02' }),
        ],
      }),
    );
    expect(digest.overdue.map((t) => t.reference)).toEqual(['URGENT', 'HIGH', 'LOW']);
  });

  it('is stable for two otherwise identical tasks', () => {
    const digest = buildDigest(
      input({
        assigned: [
          task({ reference: 'B', dueDate: '2026-08-01' }),
          task({ reference: 'A', dueDate: '2026-08-01' }),
        ],
      }),
    );
    expect(digest.overdue.map((t) => t.reference)).toEqual(['A', 'B']);
  });
});

describe('headline', () => {
  it('names the worst thing first', () => {
    const digest = buildDigest(
      input({
        assigned: [
          task({ reference: 'A', dueDate: '2026-08-01' }),
          task({ reference: 'B', dueDate: '2026-08-07' }),
        ],
        pendingExtensions: 2,
      }),
    );
    expect(digest.headline).toBe('1 overdue · 1 due today · 2 extension requests');
  });

  it('uses the singular for one request', () => {
    expect(buildDigest(input({ pendingExtensions: 1 })).headline).toContain('1 extension request');
  });

  it('falls back to this week, then to nothing', () => {
    expect(buildDigest(input({ assigned: [task({ dueDate: '2026-08-10' })] })).headline).toBe(
      '1 due this week',
    );
    expect(buildDigest(input()).headline).toBe('Nothing needs you');
  });
});

describe('digestText', () => {
  it('opens with the first name and closes with the way out', () => {
    const digest = buildDigest(input({ assigned: [task({ dueDate: '2026-08-01' })] }));
    const text = digestText(digest, 'Kashif Ahmed', 'https://cni-crm.vercel.app');
    expect(text.startsWith('Morning Kashif,')).toBe(true);
    expect(text).toContain('Turn this off under Profile');
    expect(text).toContain('https://cni-crm.vercel.app');
  });

  it('omits a section that is empty rather than printing a zero', () => {
    const digest = buildDigest(input({ assigned: [task({ dueDate: '2026-08-01' })] }));
    const text = digestText(digest, 'Kashif Ahmed', '');
    expect(text).toContain('OVERDUE (1)');
    expect(text).not.toContain('DUE TODAY');
  });

  it('mentions capacity only when it is known', () => {
    const withPct = digestText(
      buildDigest(input({ assigned: [task({ dueDate: '2026-08-01' })], utilisationPct: 94 })),
      'Kashif Ahmed',
      '',
    );
    expect(withPct).toContain('94%');

    const without = digestText(
      buildDigest(input({ assigned: [task({ dueDate: '2026-08-01' })] })),
      'Kashif Ahmed',
      '',
    );
    expect(without).not.toContain('% of your capacity');
  });
});
