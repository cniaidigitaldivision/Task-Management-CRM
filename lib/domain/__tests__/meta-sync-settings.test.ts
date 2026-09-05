import { describe, expect, it } from 'vitest';

import {
  CRON_INTERVAL_HOURS,
  effectiveFrequency,
  nextRunAfter,
  ruleState,
  schedulerKpis,
  successRate,
  systemHealth,
  weekEntries,
  type SyncRule,
  type SyncRun,
} from '../meta-sync-settings';

const NOW = Date.parse('2026-09-04T12:00:00Z');
const HOUR = 3_600_000;

function rule(over: Partial<SyncRule> = {}): SyncRule {
  return {
    id: 'r1',
    name: 'Hourly Content Sync',
    description: '',
    platforms: ['facebook', 'instagram'],
    categories: ['metrics', 'posts', 'profile'],
    frequency: 'daily',
    runAt: '02:00',
    timezone: 'Asia/Karachi',
    runOnWeekday: null,
    retryMinutes: 15,
    maxRetries: 3,
    isActive: true,
    nextRunAt: new Date(NOW + HOUR).toISOString(),
    lastRunAt: new Date(NOW - HOUR).toISOString(),
    lastOutcome: 'ok',
    lastError: null,
    runCount: 10,
    failureCount: 0,
    createdByName: 'Umm-e-Habiba',
    ...over,
  };
}

function run(over: Partial<SyncRun> = {}): SyncRun {
  return {
    id: 'x',
    accountName: 'CNI Ai & Digital Division',
    platform: 'facebook',
    startedAt: new Date(NOW - HOUR).toISOString(),
    finishedAt: new Date(NOW - HOUR + 4000).toISOString(),
    outcome: 'ok',
    daysWritten: 7,
    postsWritten: 25,
    error: null,
    ...over,
  };
}

describe('what a frequency actually delivers', () => {
  /* ⚠️ THE CRON IS THE FLOOR. `vercel.json` wakes the runner every two hours, so
     an "hourly" rule runs two-hourly however it is labelled. Saying otherwise
     would be the page making a promise on the platform's behalf. */
  it('admits that hourly cannot beat the two-hourly scheduler', () => {
    const e = effectiveFrequency('hourly');
    expect(e.hours).toBe(CRON_INTERVAL_HOURS);
    expect(e.honoured).toBe(false);
    expect(e.note).toMatch(/two-hourly/);
  });

  it('honours anything at or above the cron interval', () => {
    expect(effectiveFrequency('every_6h')).toMatchObject({ hours: 6, honoured: true });
    expect(effectiveFrequency('daily')).toMatchObject({ hours: 24, honoured: true });
    expect(effectiveFrequency('weekly')).toMatchObject({ hours: 168, honoured: true });
  });

  /* Otherwise an hourly rule is perpetually one hour overdue and its status
     reads "Overdue" forever while it works as well as it possibly can. */
  it('never schedules a rule sooner than the job that runs it', () => {
    /* NOW is 12:00 UTC = 17:00 Karachi. An hourly rule anchored at 21:55 sits on
       a two-hour grid — …17:55, 19:55… — so the next slot is 17:55 Karachi,
       which is 45 minutes away and never less than nothing. */
    const next = nextRunAfter(rule({ frequency: 'hourly' }), NOW);
    expect(next).toBeGreaterThan(NOW);
    /* And never further out than one whole interval. */
    expect(next - NOW).toBeLessThanOrEqual(2 * HOUR);
  });
});

describe('when a rule actually runs', () => {
  /* Karachi is UTC+5 with no daylight saving, so a wall-clock time maps to a
     fixed instant and these can be asserted exactly. */
  const karachi = (iso: string) => Date.parse(`${iso}+05:00`);

  /* ⚠️ THE BUG THESE EXIST FOR. `nextRunAfter` took only a frequency and
     returned `now + interval`, so a rule saved as "daily at 02:00" ran at
     whatever o'clock it was created and every 24 hours from there — while the
     table and the calendar both printed 02:00. Found on a live rule: saved with
     `run_at 21:55`, its next run had been computed for 23:55 Karachi. */
  it('runs a daily rule at the time it was given, not the time it was made', () => {
    const madeAt = karachi('2026-09-05T14:30:00');
    const next = nextRunAfter(rule({ frequency: 'daily', runAt: '02:00' }), madeAt);
    expect(next).toBe(karachi('2026-09-06T02:00:00'));
  });

  it('takes today’s slot when the time has not yet passed', () => {
    const madeAt = karachi('2026-09-05T01:00:00');
    const next = nextRunAfter(rule({ frequency: 'daily', runAt: '02:00' }), madeAt);
    expect(next).toBe(karachi('2026-09-05T02:00:00'));
  });

  /* A sub-daily rule's time sets the PHASE of the grid, not a single moment. */
  it('puts a sub-daily rule on a grid anchored to its time', () => {
    const at = karachi('2026-09-05T22:30:00');
    /* 21:55 with a two-hour step: …21:55, 23:55… */
    const next = nextRunAfter(rule({ frequency: 'hourly', runAt: '21:55' }), at);
    expect(next).toBe(karachi('2026-09-05T23:55:00'));
  });

  it('keeps a six-hourly rule on its own phase', () => {
    const at = karachi('2026-09-05T09:00:00');
    /* 02:00 every six hours: 02:00, 08:00, 14:00, 20:00. */
    const next = nextRunAfter(rule({ frequency: 'every_6h', runAt: '02:00' }), at);
    expect(next).toBe(karachi('2026-09-05T14:00:00'));
  });

  /* ⚠️ 2, 6 and 12 all divide 24 exactly, so the grid closes on itself every day
     and the anchor cannot drift. That is why they are the only steps offered. */
  it('returns to its anchor after a whole day', () => {
    const at = karachi('2026-09-05T02:00:00');
    let t = at;
    for (let i = 0; i < 12; i += 1) {
      t = nextRunAfter(rule({ frequency: 'hourly', runAt: '02:00' }), t);
    }
    expect(t).toBe(karachi('2026-09-06T02:00:00'));
  });

  it('runs a weekly rule on its own weekday', () => {
    /* 2026-09-05 is a Saturday; weekday 3 is Wednesday. */
    const at = karachi('2026-09-05T10:00:00');
    const next = nextRunAfter(
      rule({ frequency: 'weekly', runAt: '11:00', runOnWeekday: 3 }),
      at,
    );
    expect(next).toBe(karachi('2026-09-09T11:00:00'));
  });

  it('skips to next week when the weekday’s time has just passed', () => {
    /* Wednesday 2026-09-09, an hour after the slot. */
    const at = karachi('2026-09-09T12:00:00');
    const next = nextRunAfter(
      rule({ frequency: 'weekly', runAt: '11:00', runOnWeekday: 3 }),
      at,
    );
    expect(next).toBe(karachi('2026-09-16T11:00:00'));
  });

  /* ⚠️ ALWAYS STRICTLY FORWARD. A next-run equal to now would be due the instant
     it was written, and the runner would execute the same rule twice in one
     cycle. */
  it('never returns a time that has already arrived', () => {
    for (const f of ['hourly', 'every_6h', 'every_12h', 'daily', 'weekly'] as const) {
      const at = karachi('2026-09-05T02:00:00');
      const next = nextRunAfter(
        rule({ frequency: f, runAt: '02:00', runOnWeekday: f === 'weekly' ? 6 : null }),
        at,
      );
      expect(next).toBeGreaterThan(at);
    }
  });
});

describe('a rule’s success rate', () => {
  /* ⚠️ A RULE CREATED A MINUTE AGO HAS NOT SUCCEEDED AT ANYTHING. "100%" against
     it is indistinguishable from a rule that has run four hundred times without
     a failure, which is the most misleading number this page could carry. */
  it('is null before the rule has ever run, not 100%', () => {
    expect(successRate({ runCount: 0, failureCount: 0 })).toBeNull();
  });

  it('is the real ratio once it has', () => {
    expect(successRate({ runCount: 10, failureCount: 1 })).toBeCloseTo(90, 5);
    expect(successRate({ runCount: 4, failureCount: 4 })).toBe(0);
  });
});

describe('a rule’s state', () => {
  it('leads with paused, then failure, then overdue', () => {
    expect(ruleState(rule({ isActive: false, lastOutcome: 'failed' }), NOW).label).toBe('Paused');
    expect(
      ruleState(rule({ lastOutcome: 'failed', lastError: 'revoked' }), NOW).label,
    ).toBe('Failed');
  });

  it('reports Meta’s own message rather than a guessed cause', () => {
    const s = ruleState(rule({ lastOutcome: 'failed', lastError: '(#190) bad token' }), NOW);
    expect(s.detail).toBe('(#190) bad token');
  });

  /* ⚠️ A rule due at 02:00 that the 02:00 tick has not reached yet is not
     overdue — it is about to run. Only a whole cycle late counts. */
  it('allows one scheduler cycle of slack before calling a rule overdue', () => {
    const nearlyDue = rule({ nextRunAt: new Date(NOW - HOUR).toISOString() });
    expect(ruleState(nearlyDue, NOW).label).toBe('Active');

    const reallyLate = rule({ nextRunAt: new Date(NOW - 5 * HOUR).toISOString() });
    expect(ruleState(reallyLate, NOW).label).toBe('Overdue');
  });
});

describe('the scheduler’s four figures', () => {
  it('counts active rules and the platforms they cover', () => {
    const k = schedulerKpis({
      rules: [
        rule({ id: 'a', platforms: ['facebook'] }),
        rule({ id: 'b', platforms: ['instagram'] }),
        rule({ id: 'c', isActive: false, platforms: ['facebook', 'instagram'] }),
      ],
      runs: [],
      nowMs: NOW,
    });
    expect(k.activeRules).toBe(2);
    expect(k.platformsCovered).toBe(2);
  });

  /* ⚠️ OVER RUNS, NOT OVER RULES. The card says "Last 30 days", and a rule
     carries a LIFETIME counter — averaging rules would mix one created today
     with one running since August. */
  it('computes the success rate from the runs in the window', () => {
    const k = schedulerKpis({
      rules: [rule()],
      runs: [
        run(),
        run({ id: 'b' }),
        run({ id: 'c', outcome: 'failed', error: 'boom' }),
        /* Forty days old — outside the window, so it must not count. */
        run({ id: 'old', startedAt: new Date(NOW - 40 * 24 * HOUR).toISOString() }),
      ],
      nowMs: NOW,
    });
    expect(k.runsCounted).toBe(3);
    expect(k.failedRuns).toBe(1);
    expect(k.successRatePercent).toBeCloseTo(66.67, 1);
  });

  it('says nothing rather than 100% when nothing has run', () => {
    const k = schedulerKpis({ rules: [rule()], runs: [], nowMs: NOW });
    expect(k.successRatePercent).toBeNull();
    expect(k.runsCounted).toBe(0);
  });

  it('names the soonest active rule as the next run', () => {
    const k = schedulerKpis({
      rules: [
        rule({ id: 'late', name: 'Late', nextRunAt: new Date(NOW + 8 * HOUR).toISOString() }),
        rule({ id: 'soon', name: 'Soon', nextRunAt: new Date(NOW + 2 * HOUR).toISOString() }),
        /* Paused, so it cannot be "next" however soon its stale date says. */
        rule({
          id: 'paused',
          name: 'Paused',
          isActive: false,
          nextRunAt: new Date(NOW).toISOString(),
        }),
      ],
      runs: [],
      nowMs: NOW,
    });
    expect(k.nextRun?.name).toBe('Soon');
  });
});

describe('system health', () => {
  const healthy = {
    tokenConfigured: true,
    accountCount: 2,
    failingAccounts: 0,
    lastSyncedAt: new Date(NOW - HOUR).toISOString(),
    autoSyncEnabled: true,
    nowMs: NOW,
  };

  it('reports Healthy only when every line really is', () => {
    const h = systemHealth(healthy);
    expect(h.verdict).toBe('Healthy');
    expect(h.lines.every((l) => l.ok)).toBe(true);
  });

  /* ⚠️ The reference draws five fixed green ticks. Each one here can come back
     bad, which is the entire value of a health panel. */
  it('goes amber when collection falls behind', () => {
    const h = systemHealth({ ...healthy, lastSyncedAt: new Date(NOW - 9 * HOUR).toISOString() });
    expect(h.verdict).toBe('Needs attention');
    expect(h.lines.find((l) => l.key === 'last-sync')?.ok).toBe(false);
  });

  it('degrades when more than one thing is wrong', () => {
    const h = systemHealth({
      ...healthy,
      tokenConfigured: false,
      failingAccounts: 1,
      autoSyncEnabled: false,
    });
    expect(h.verdict).toBe('Degraded');
  });

  it('says a paused engine is paused rather than operational', () => {
    const h = systemHealth({ ...healthy, autoSyncEnabled: false });
    const engine = h.lines.find((l) => l.key === 'engine');
    expect(engine?.value).toBe('Paused');
    expect(engine?.ok).toBe(false);
  });

  it('never claims a token is active when none is configured', () => {
    const h = systemHealth({ ...healthy, tokenConfigured: false });
    expect(h.lines.find((l) => l.key === 'token')?.value).toBe('Missing');
  });
});

describe('the week calendar', () => {
  /* ⚠️ An hourly rule is ONE band per day, not 24 blocks — drawing every
     occurrence would fill the grid and hide every other rule behind it. */
  it('places a daily rule on all seven columns, once each', () => {
    const e = weekEntries([rule({ frequency: 'daily', runAt: '02:00' })]);
    expect(e).toHaveLength(7);
    expect(new Set(e.map((x) => x.weekday)).size).toBe(7);
    expect(e[0].minutes).toBe(120);
  });

  it('places a weekly rule on its own weekday only', () => {
    const e = weekEntries([rule({ frequency: 'weekly', runOnWeekday: 3, runAt: '11:00' })]);
    expect(e).toHaveLength(1);
    /* Stored 1–7 with Monday as 1; the grid is 0-based Monday-first. */
    expect(e[0].weekday).toBe(2);
    expect(e[0].minutes).toBe(660);
  });

  it('leaves a paused rule off the calendar entirely', () => {
    expect(weekEntries([rule({ isActive: false })])).toHaveLength(0);
  });
});
