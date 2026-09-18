import { describe, expect, it } from 'vitest';

import { OFFICE, appointmentSummary, outsideOffice, snapToOffice } from '../appointment-scheduler';
import { karachiAt, karachiParts } from '../when';

/* ============================================================================
 * THE OFFICE HOURS GUARD
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY DATE HERE IS A KARACHI WALL-CLOCK MOMENT. September 2026: the 13th is
 * a Sunday, the 15th a Tuesday, the 19th a Saturday. Writing these as UTC
 * instants would put five hours of every evening on the wrong day, which is the
 * `karachi-not-utc` bug this module exists to avoid.
 * ========================================================================= */

const at = (d: number, h: number, mi = 0) => karachiAt(2026, 9, d, h, mi);
const parts = (ms: number) => {
  const p = karachiParts(ms);
  return [p.d, p.h, p.mi] as const;
};

describe('snapToOffice', () => {
  it('leaves a slot inside the working day alone', () => {
    expect(parts(snapToOffice(at(15, 11, 30), OFFICE))).toEqual([15, 11, 30]);
  });

  it('moves an early slot to opening time on the same day', () => {
    expect(parts(snapToOffice(at(15, 8), OFFICE))).toEqual([15, 10, 0]);
  });

  it('moves an evening slot to the next morning', () => {
    expect(parts(snapToOffice(at(15, 21), OFFICE))).toEqual([16, 10, 0]);
  });

  it('treats closing time as closed, not as the last slot', () => {
    /* A 6 PM start runs past the hour the office shuts. */
    expect(parts(snapToOffice(at(15, 18), OFFICE))).toEqual([16, 10, 0]);
  });

  it('jumps a Sunday', () => {
    /* 13 September 2026 is a Sunday; Monday the 14th is the next working day. */
    expect(parts(snapToOffice(at(13, 12), OFFICE))).toEqual([14, 10, 0]);
  });

  it('jumps a Saturday evening to Monday when Saturday is the last open day', () => {
    /* 19 September is a Saturday: after closing, the next open day is Monday 21st. */
    expect(parts(snapToOffice(at(19, 19), OFFICE))).toEqual([21, 10, 0]);
  });

  it('crosses a month end', () => {
    /* 30 September 2026 is a Wednesday; after hours it lands on 1 October. */
    const next = karachiParts(snapToOffice(at(30, 20), OFFICE));
    expect([next.m, next.d, next.h]).toEqual([10, 1, 10]);
  });

  it('returns the same moment when every day is closed rather than looping', () => {
    const shut = { from: 10, to: 18, days: [] as number[] };
    expect(snapToOffice(at(15, 11), shut)).toBe(at(15, 11));
  });
});

describe('outsideOffice', () => {
  it('is silent inside the working day', () => {
    expect(outsideOffice(at(15, 11), OFFICE)).toBeNull();
  });

  it('names the closed day', () => {
    expect(outsideOffice(at(13, 12), OFFICE)).toBe('Sunday is not a working day.');
  });

  it('says when it is too early', () => {
    expect(outsideOffice(at(15, 9), OFFICE)).toMatch(/opens at 10:00 AM/);
  });

  it('says when it is too late, closing time included', () => {
    expect(outsideOffice(at(15, 18), OFFICE)).toMatch(/closes at 6:00 PM/);
    expect(outsideOffice(at(15, 19, 30), OFFICE)).toMatch(/closes at 6:00 PM/);
  });

  /* ⚠️ The pair must agree: whatever the guard would move, the warning names. */
  it('agrees with snapToOffice on every hour of a week', () => {
    for (let d = 13; d <= 19; d++) {
      for (let h = 0; h < 24; h++) {
        const moment = at(d, h);
        const moved = snapToOffice(moment, OFFICE) !== moment;
        const warned = outsideOffice(moment, OFFICE) !== null;
        expect(moved, `day ${d} hour ${h}`).toBe(warned);
      }
    }
  });
});

describe('appointmentSummary', () => {
  it('reads as the reference prints it', () => {
    expect(appointmentSummary(at(15, 10))).toBe('Tuesday, 15 September · 10:00 AM PKT');
  });

  it('shows the Karachi evening, not the UTC one', () => {
    /* 9 PM in Karachi is 4 PM UTC the same day — the hour must survive. */
    expect(appointmentSummary(at(15, 21))).toContain('9:00 PM');
    expect(appointmentSummary(at(15, 21))).toContain('15 September');
  });
});
