import { describe, expect, it } from 'vitest';

import { bucketAppointments, openingTab } from '@/lib/domain/crm-appointments';

/* ============================================================================
 * WHICH OF THE THREE QUESTIONS DOES THIS APPOINTMENT ANSWER?
 * ----------------------------------------------------------------------------
 * The whole meaning of `/appointments` is which bucket a row lands in, so it is
 * tested here rather than through the component — a static render only ever
 * shows the OPENING tab, and two of the three answers sit behind a click it
 * cannot make. That is the reason this function was moved out of the screen.
 * ========================================================================= */

const NOW = Date.parse('2026-09-16T09:00:00.000Z');
const DAY = 864e5;
const at = (offsetDays: number, status = 'scheduled') => ({
  status,
  scheduledAt: new Date(NOW + DAY * offsetDays).toISOString(),
});

describe('where an appointment goes', () => {
  it('past and still open is a write-up somebody owes', () => {
    const { owed, upcoming, done } = bucketAppointments([at(-2)], NOW);

    expect(owed).toHaveLength(1);
    expect(upcoming).toHaveLength(0);
    expect(done).toHaveLength(0);
  });

  it('ahead and still open is upcoming', () => {
    expect(bucketAppointments([at(2)], NOW).upcoming).toHaveLength(1);
  });

  it.each(['completed', 'no_show', 'cancelled'])(
    '%s is done wherever it sits in time',
    (status) => {
      /* ⚠️ A PAST one AND a FUTURE one, because "done" is about the status and
         not the clock. A cancelled visit next Tuesday is not upcoming — nobody
         is going — and showing it as such would put a phantom in the diary. */
      expect(bucketAppointments([at(-5, status), at(5, status)], NOW).done).toHaveLength(2);
      expect(bucketAppointments([at(-5, status), at(5, status)], NOW).owed).toHaveLength(0);
      expect(bucketAppointments([at(-5, status), at(5, status)], NOW).upcoming).toHaveLength(0);
    },
  );

  it('⚠️ rescheduled counts as done even though it reached no outcome', () => {
    /* `isClosedAppointment` says no — it answers "did this finish". This screen
       asks "is there anything left to do here", and a row that was replaced has
       nothing. Asking somebody to write up a visit that was moved is the bug
       that would follow from sharing one function between the two questions. */
    const { done, owed } = bucketAppointments([at(-3, 'rescheduled')], NOW);

    expect(done).toHaveLength(1);
    expect(owed).toHaveLength(0);
  });

  it('treats confirmed exactly like scheduled', () => {
    /* A client saying "yes I will be there" changes nothing about whether the
       visit still has to happen, or be written up afterwards. */
    expect(bucketAppointments([at(1, 'confirmed')], NOW).upcoming).toHaveLength(1);
    expect(bucketAppointments([at(-1, 'confirmed')], NOW).owed).toHaveLength(1);
  });
});

describe('the order inside each bucket', () => {
  it('⚠️ owed runs OLDEST first', () => {
    /* Last Tuesday's unwritten visit is more urgent than yesterday's — it has
       been forgotten for longer and the client has been waiting for longer. */
    const { owed } = bucketAppointments([at(-1), at(-9), at(-4)], NOW);

    expect(owed.map((a) => a.scheduledAt)).toEqual([
      at(-9).scheduledAt,
      at(-4).scheduledAt,
      at(-1).scheduledAt,
    ]);
  });

  it('upcoming runs soonest first, which is the opposite end of the same list', () => {
    const { upcoming } = bucketAppointments([at(9), at(1), at(4)], NOW);

    expect(upcoming[0].scheduledAt).toBe(at(1).scheduledAt);
  });

  it('done runs most recent first', () => {
    const { done } = bucketAppointments([at(-9, 'completed'), at(-1, 'completed')], NOW);

    expect(done[0].scheduledAt).toBe(at(-1).scheduledAt);
  });
});

describe('which tab the screen opens on', () => {
  it('whatever is actionable — owed wins when it has anything', () => {
    expect(openingTab(bucketAppointments([at(-1), at(3)], NOW))).toBe('owed');
  });

  it('⚠️ an empty Upcoming beats an empty Needs recording', () => {
    /* Both are empty. Only one of them has something useful to say to the
       person looking at it. */
    expect(openingTab(bucketAppointments([], NOW))).toBe('upcoming');
    expect(openingTab(bucketAppointments([at(-2, 'completed')], NOW))).toBe('upcoming');
  });
});

describe('a moment exactly now', () => {
  it('counts as having started, so it is owed rather than upcoming', () => {
    /* ⚠️ The boundary is `< nowMs`, so a visit starting this instant is still
       upcoming for one tick. Asserted so a later change to `<=` is a decision
       rather than a slip: an appointment is owed once it has BEGUN, and the rail
       that feeds this screen reads from the start of the day for the same
       reason — a 9am visit is still today's business at 10am. */
    expect(bucketAppointments([{ status: 'scheduled', scheduledAt: new Date(NOW - 1).toISOString() }], NOW).owed).toHaveLength(1);
    expect(bucketAppointments([{ status: 'scheduled', scheduledAt: new Date(NOW).toISOString() }], NOW).upcoming).toHaveLength(1);
  });
});
