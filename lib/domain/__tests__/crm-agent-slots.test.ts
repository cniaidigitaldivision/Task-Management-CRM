import { describe, expect, it } from 'vitest';

import {
  AGENT_MINUTES,
  availabilityLines,
  freeStarts,
  isFreeStart,
  parseKarachiLocal,
  toKarachiLocal,
} from '@/lib/domain/crm-agent-slots';

/* Monday 21 September 2026, 3:00 PM in Karachi (10:00 UTC). */
const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const at = (local: string) => parseKarachiLocal(local)!;

describe('Karachi wall clock', () => {
  it('reads and writes a local time both ways', () => {
    expect(new Date(at('2026-09-23T15:00')).toISOString()).toBe('2026-09-23T10:00:00.000Z');
    expect(toKarachiLocal(at('2026-09-23T15:00'))).toBe('2026-09-23T15:00');
  });

  it('refuses what is not a time', () => {
    expect(parseKarachiLocal('Tuesday at 3')).toBeNull();
    expect(parseKarachiLocal('2026-09-31T10:00')).toBeNull();
    expect(parseKarachiLocal('2026-09-23T25:00')).toBeNull();
  });
});

describe('the times the agent may offer', () => {
  const meeting = freeStarts(NOW, [], AGENT_MINUTES.meeting).map(toKarachiLocal);

  it('⚠️ never less than two hours from now', () => {
    /* 3 PM now → 5:00 PM is the first; a 45-minute meeting at 5:30 would end
       after closing. */
    expect(meeting[0]).toBe('2026-09-21T17:00');
    expect(meeting).not.toContain('2026-09-21T16:30');
  });

  it('⚠️ ends by closing time — a 90-minute visit never starts after 4:30 PM', () => {
    const visits = freeStarts(NOW, [], AGENT_MINUTES.site_visit).map(toKarachiLocal);
    expect(visits).toContain('2026-09-22T16:30');
    expect(visits).not.toContain('2026-09-22T17:00');
    expect(meeting).toContain('2026-09-22T17:00');
    expect(meeting).not.toContain('2026-09-22T17:30');
  });

  it('never before the office opens, and on the half hour', () => {
    expect(meeting).toContain('2026-09-22T10:00');
    expect(meeting).not.toContain('2026-09-22T09:30');
    expect(meeting.every((t) => t.endsWith(':00') || t.endsWith(':30'))).toBe(true);
  });

  it('⚠️ never on Sunday', () => {
    expect(meeting.some((t) => t.startsWith('2026-09-27'))).toBe(false);
    expect(meeting.some((t) => t.startsWith('2026-09-26'))).toBe(true);
  });

  it('no further than a week ahead', () => {
    expect(meeting.some((t) => t.startsWith('2026-09-28'))).toBe(true);
    expect(meeting.some((t) => t.startsWith('2026-09-29'))).toBe(false);
  });

  it('⚠️ never over something already in the diary', () => {
    const busy = [{ startMs: at('2026-09-22T11:00'), minutes: 90 }];
    const free = freeStarts(NOW, busy, AGENT_MINUTES.meeting).map(toKarachiLocal);
    expect(free).toContain('2026-09-22T10:00'); // 10:00–10:45 ends before 11
    expect(free).not.toContain('2026-09-22T10:30'); // would run into 11:00
    expect(free).not.toContain('2026-09-22T12:00'); // inside 11:00–12:30
    expect(free).toContain('2026-09-22T12:30');
  });
});

describe('checking what the model chose', () => {
  it('accepts a free start and refuses anything else', () => {
    expect(isFreeStart(at('2026-09-23T15:00'), NOW, [], AGENT_MINUTES.meeting)).toBe(true);
    expect(isFreeStart(at('2026-09-23T15:15'), NOW, [], AGENT_MINUTES.meeting)).toBe(false);
    expect(isFreeStart(at('2026-09-27T12:00'), NOW, [], AGENT_MINUTES.meeting)).toBe(false);
    expect(isFreeStart(at('2026-09-21T16:00'), NOW, [], AGENT_MINUTES.meeting)).toBe(false);
  });
});

describe('the lines the model reads', () => {
  it('groups a day into ranges a client would say', () => {
    const busy = [{ startMs: at('2026-09-22T11:00'), minutes: 90 }];
    const lines = availabilityLines(freeStarts(NOW, busy, AGENT_MINUTES.meeting));
    expect(lines[0]).toBe('Monday 21 September (2026-09-21): 5:00 PM only');
    expect(lines[1]).toBe('Tuesday 22 September (2026-09-22): 10:00 AM only; any half hour from 12:30 PM to 5:00 PM');
  });
});
