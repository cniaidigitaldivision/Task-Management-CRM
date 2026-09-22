import { describe, expect, it } from 'vitest';

import { decide } from '@/lib/schedule/repeats';
import type { RepeatingSeries } from '@/lib/db/queries/repeats';

/* ============================================================================
 * WHAT THE NIGHTLY RUNNER DECIDES — the rules the owner asked for
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22, relaying a client: *"he daily creates that task and assigns
 * it to me. In this way they have 128 tasks from the last 20 days … their
 * capacity is getting full."*
 *
 * Measured the same day, before any of this was written: 56 live series making
 * ~55 copies a night, 19–23 of them deleted every day and back by morning, and
 * 13 series still running after somebody had switched them off.
 *
 * Every case below is one of those facts, turned into a question this function
 * has to answer the same way every night.
 * ========================================================================= */

const series = (over: Partial<RepeatingSeries> = {}): RepeatingSeries => ({
  seriesId: 's1',
  recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
  anchorDate: '2026-09-22',
  title: 'Daily report',
  description: null,
  projectId: 'p1',
  otherDescription: null,
  contentKind: null,
  assigneeId: 'abdul',
  createdById: 'kashif',
  priority: 'medium',
  effortSize: 'S',
  effortPoints: 4,
  timeLimitMinutes: null,
  statusOnCreate: 'backlog',
  oneOpenCopy: true,
  outstanding: 0,
  hasInstanceOnDay: false,
  ...over,
});

describe('the nightly repeat decision', () => {
  it('makes tomorrow’s copy of a daily series', () => {
    expect(decide(series(), '2026-09-23')).toEqual({ create: true });
  });

  it('⚠️ makes nothing while yesterday’s copy is still open', () => {
    const verdict = decide(series({ outstanding: 1 }), '2026-09-23');
    expect(verdict.create).toBe(false);
    expect((verdict as { why: string }).why).toContain('one at a time');
  });

  it('a series that says so keeps generating every day regardless', () => {
    /* The owner's 2026-09-03 instruction, kept as a per-series choice: some work
       genuinely is a new job each day. */
    expect(decide(series({ oneOpenCopy: false, outstanding: 3 }), '2026-09-23')).toEqual({ create: true });
  });

  it('⚠️ a day that already has a copy is never made twice — cron is at-least-once', () => {
    const verdict = decide(series({ hasInstanceOnDay: true }), '2026-09-23');
    expect(verdict.create).toBe(false);
    expect((verdict as { why: string }).why).toContain('already generated');
  });

  it('⚠️ and a copy somebody DELETED still counts as that day happening', () => {
    /* `hasInstanceOnDay` is computed without a deleted filter (see
       lib/db/queries/repeats.ts). This test names the intent so nobody
       "fixes" the query by adding `not is_deleted` back and quietly restores
       the complaint: delete it, and it is back in the morning. */
    expect(decide(series({ hasInstanceOnDay: true, outstanding: 0 }), '2026-09-23').create).toBe(false);
  });

  it('holds a runaway series even when it was told to generate every day', () => {
    const verdict = decide(series({ oneOpenCopy: false, outstanding: 14 }), '2026-09-23');
    expect(verdict.create).toBe(false);
    expect((verdict as { why: string }).why).toContain('runaway');
  });

  it('is silent about days the rule does not land on', () => {
    const weekly = series({ recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', anchorDate: '2026-09-21' });
    expect(decide(weekly, '2026-09-23').create).toBe(false);
    expect(decide(weekly, '2026-09-28')).toEqual({ create: true });
  });

  it('refuses a rule it cannot read rather than guessing', () => {
    const verdict = decide(series({ recurrenceRule: 'FREQ=FORTNIGHTLY' }), '2026-09-23');
    expect(verdict.create).toBe(false);
    expect((verdict as { why: string }).why).toContain('unreadable');
  });

  it('says so when a series has no day to count from, instead of skipping in silence', () => {
    const verdict = decide(series({ anchorDate: null }), '2026-09-23');
    expect(verdict.create).toBe(false);
    expect((verdict as { why: string }).why).toContain('no date');
  });

  it('⚠️ counts forward from the LAST COPY MADE, not from the first', () => {
    /* A series nobody has touched for a week owes today, not the day after the
       one it started on. */
    expect(decide(series({ anchorDate: '2026-09-15' }), '2026-09-23')).toEqual({ create: true });
  });
});
