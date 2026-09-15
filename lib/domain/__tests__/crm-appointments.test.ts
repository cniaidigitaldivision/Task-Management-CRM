/* ============================================================================
 * THE APPOINTMENT RULES
 * ----------------------------------------------------------------------------
 * The ones worth a test are the ones that only break on a Tuesday afternoon:
 * a visit with nowhere to go, a booking in the past, and two clients promised
 * the same hour.
 * ========================================================================= */
import { describe, expect, it } from 'vitest';

import {
  appointmentProblems,
  appointmentStatusLabel,
  clashesWith,
  isAppointmentKind,
  isClosedAppointment,
} from '@/lib/domain/crm-appointments';

const NOW = Date.parse('2026-09-15T10:00:00.000Z');
const LATER = '2026-09-16T11:00:00.000Z';

const base = {
  kind: 'site_visit',
  scheduledAt: LATER,
  durationMinutes: 60,
  location: 'Plot A-101, Block A',
  note: '',
};

describe('what a booking must have', () => {
  it('accepts a complete site visit', () => {
    expect(appointmentProblems(base, NOW)).toHaveLength(0);
  });

  it('⚠️ refuses a site visit with nowhere to go', () => {
    /* Somebody is driving somewhere. "Site visit, Tuesday 4pm" with no place is
       a booking the salesperson cannot act on and the client cannot be told
       about. */
    const problems = appointmentProblems({ ...base, location: '   ' }, NOW);
    expect(problems.some((p) => p.includes('where'))).toBe(true);
  });

  it('but a call needs no place to be', () => {
    expect(appointmentProblems({ ...base, kind: 'call', location: '' }, NOW)).toHaveLength(0);
  });

  it('⚠️ refuses a time that has already gone, and says what to do instead', () => {
    const problems = appointmentProblems(
      { ...base, scheduledAt: '2026-09-14T10:00:00.000Z' },
      NOW,
    );
    expect(problems.some((p) => p.includes('already passed'))).toBe(true);
    expect(problems.some((p) => p.includes('complete'))).toBe(true);
  });

  it('⚠️ allows "now", because filling the form takes a few seconds', () => {
    /* Refusing somebody for being four seconds in the past is a rule that is
       technically right and useless. */
    const problems = appointmentProblems(
      { ...base, scheduledAt: new Date(NOW - 20_000).toISOString() },
      NOW,
    );
    expect(problems).toHaveLength(0);
  });

  it('refuses a length outside what the database will take', () => {
    expect(appointmentProblems({ ...base, durationMinutes: 2 }, NOW)).not.toHaveLength(0);
    expect(appointmentProblems({ ...base, durationMinutes: 900 }, NOW)).not.toHaveLength(0);
  });

  it('names the field rather than saying "invalid"', () => {
    for (const p of appointmentProblems({ ...base, scheduledAt: null, location: '' }, NOW)) {
      expect(p.length).toBeGreaterThan(20);
      expect(p).not.toMatch(/invalid|error/i);
    }
  });
});

describe('two clients, one hour', () => {
  const at = (iso: string, minutes: number, status = 'scheduled') => ({
    startMs: Date.parse(iso),
    minutes,
    status,
  });

  it('⚠️ compares spans, not start times', () => {
    /* Two visits starting an hour apart do not clash. A two-hour visit starting
       an hour before one does — and a check on start times alone would miss it,
       which is how somebody gets stood up. */
    const candidate = { startMs: Date.parse('2026-09-16T11:00:00.000Z'), minutes: 60 };
    expect(clashesWith(candidate, [at('2026-09-16T12:00:00.000Z', 60)])).toBe(false);
    expect(clashesWith(candidate, [at('2026-09-16T10:00:00.000Z', 120)])).toBe(true);
  });

  it('touching at the edges is not a clash', () => {
    const candidate = { startMs: Date.parse('2026-09-16T11:00:00.000Z'), minutes: 60 };
    expect(clashesWith(candidate, [at('2026-09-16T10:00:00.000Z', 60)])).toBe(false);
  });

  it('⚠️ something cancelled is not in the way', () => {
    const candidate = { startMs: Date.parse('2026-09-16T11:00:00.000Z'), minutes: 60 };
    expect(clashesWith(candidate, [at('2026-09-16T11:00:00.000Z', 60, 'cancelled')])).toBe(false);
    expect(clashesWith(candidate, [at('2026-09-16T11:00:00.000Z', 60, 'no_show')])).toBe(false);
    expect(clashesWith(candidate, [at('2026-09-16T11:00:00.000Z', 60, 'confirmed')])).toBe(true);
  });
});

describe('vocabulary', () => {
  it('knows its three kinds and refuses anything else', () => {
    expect(isAppointmentKind('site_visit')).toBe(true);
    expect(isAppointmentKind('viewing')).toBe(false);
  });

  it('⚠️ shows an unknown status rather than hiding it behind "Unknown"', () => {
    /* A value added to the enum and forgotten here should look odd on screen,
       not vanish into a word that conceals which one it was. */
    expect(appointmentStatusLabel('teleported')).toBe('teleported');
    expect(appointmentStatusLabel('no_show')).toBe('Did not turn up');
  });

  it('knows which statuses mean it is over', () => {
    expect(isClosedAppointment('completed')).toBe(true);
    expect(isClosedAppointment('cancelled')).toBe(true);
    expect(isClosedAppointment('scheduled')).toBe(false);
  });
});
