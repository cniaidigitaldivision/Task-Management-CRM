import { describe, expect, it } from 'vitest';

import { plannedSummary } from '@/lib/domain/crm-planned';

const NOW = Date.parse('2026-09-19T09:00:00.000Z'); // Sat 19 Sep, 2 PM Karachi
const later = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const earlier = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('nothing planned', () => {
  it('is null on a lead with nothing at all', () => {
    expect(plannedSummary({ nowMs: NOW })).toBeNull();
  });

  it('does not count a finished follow-up', () => {
    expect(
      plannedSummary({
        followUps: [{ title: 'First nudge', status: 'done', dueAt: earlier(3), doneAt: earlier(2) }],
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it('does not count a cancelled or skipped follow-up', () => {
    expect(
      plannedSummary({
        followUps: [
          { title: 'Cancelled', status: 'cancelled', dueAt: later(3) },
          { title: 'Skipped', status: 'skipped', dueAt: later(4) },
        ],
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it('does not count a sequence that has stopped or is paused', () => {
    expect(plannedSummary({ sequence: { state: 'stopped', step: 1, total: 3 }, nowMs: NOW })).toBeNull();
    /* ⚠️ A PAUSED PLAN IS NOT A PLAN. 208 pauses on a reply — and a client who
       just replied is exactly when somebody must say what happens next. */
    expect(plannedSummary({ sequence: { state: 'paused', step: 1, total: 3 }, nowMs: NOW })).toBeNull();
  });

  it('does not count a visit that has already happened', () => {
    expect(
      plannedSummary({
        appointments: [{ kind: 'site_visit', status: 'scheduled', scheduledAt: earlier(2) }],
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it('does not count a next action whose moment has passed', () => {
    expect(plannedSummary({ nextAction: 'Call back', nextActionAt: earlier(1), nowMs: NOW })).toBeNull();
  });
});

describe('something planned', () => {
  it('finds an open follow-up', () => {
    const p = plannedSummary({
      followUps: [{ title: 'Second nudge', status: 'planned', dueAt: later(20) }],
      nowMs: NOW,
    });
    expect(p).toEqual({ what: 'Second nudge', at: later(20), source: 'follow_up' });
  });

  it('finds a running sequence and says how far through it is', () => {
    const p = plannedSummary({ sequence: { state: 'active', step: 1, total: 3 }, nowMs: NOW });
    expect(p?.source).toBe('sequence');
    expect(p?.what).toBe('Sequence, step 2 of 3');
    expect(p?.at).toBeNull();
  });

  it('never promises a step beyond the last one', () => {
    const p = plannedSummary({ sequence: { state: 'active', step: 3, total: 3 }, nowMs: NOW });
    expect(p?.what).toBe('Sequence, step 3 of 3');
  });

  it('finds a booked visit still to come', () => {
    const p = plannedSummary({
      appointments: [{ kind: 'site_visit', status: 'confirmed', scheduledAt: later(48) }],
      nowMs: NOW,
    });
    expect(p).toEqual({ what: 'Site visit', at: later(48), source: 'appointment' });
  });

  it('finds the lead’s own next action', () => {
    const p = plannedSummary({ nextAction: 'Call about the corner plot', nextActionAt: later(4), nowMs: NOW });
    expect(p?.source).toBe('next_action');
  });
});

describe('which one it names', () => {
  it('names the soonest, not the first found', () => {
    const p = plannedSummary({
      nextAction: 'Friday call',
      nextActionAt: later(100),
      followUps: [{ title: 'Tomorrow nudge', status: 'due', dueAt: later(20) }],
      appointments: [{ kind: 'site_visit', status: 'scheduled', scheduledAt: later(60) }],
      nowMs: NOW,
    });
    expect(p?.what).toBe('Tomorrow nudge');
  });

  it('falls back to the undated plan only when nothing dated is coming', () => {
    const p = plannedSummary({
      sequence: { state: 'scheduled', step: 0, total: 3 },
      followUps: [{ title: 'Done already', status: 'done', dueAt: earlier(5), doneAt: earlier(5) }],
      nowMs: NOW,
    });
    expect(p?.source).toBe('sequence');
  });

  it('prefers a dated thing over the sequence, because the form can show a time', () => {
    const p = plannedSummary({
      sequence: { state: 'active', step: 1, total: 3 },
      followUps: [{ title: 'Second nudge', status: 'due', dueAt: later(20) }],
      nowMs: NOW,
    });
    expect(p?.source).toBe('follow_up');
  });
});
