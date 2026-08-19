import { describe, expect, it } from 'vitest';

import { verifyFigures } from '../narrative';

/* ============================================================================
 * The guard that makes the report trustworthy
 * ----------------------------------------------------------------------------
 * The prompt tells the model not to compute. This is the part that checks. If it
 * ever stops working, invented figures reach the CEO's page silently — so its
 * behaviour is pinned down here rather than trusted.
 * ========================================================================= */

const SHEET = `REPORTING PERIOD: August 2026

DIVISION TOTALS
- Active projects: 9 (2 internal, 7 external client work)
- Content assets published: 148, of which 31 were reels
- Contracted minimum across the 7 project(s) that have one: 136 assets
- Recurring monthly fees: PKR 1,250,000
- Team members who published something: 6

PER PROJECT
- Crescent Nova (CNI) | internal | published 22 assets (4 reels) | status: met`;

function narrative(over: Partial<Parameters<typeof verifyFigures>[0]> = {}) {
  return {
    headline: '',
    summary: [],
    strengths: [],
    risks: [],
    recommendations: [],
    ...over,
  };
}

describe('verifyFigures', () => {
  it('passes prose that only repeats figures from the fact sheet', () => {
    expect(
      verifyFigures(
        narrative({
          headline: 'The division published 148 assets across 9 projects.',
          summary: ['31 of those were reels, against a contracted minimum of 136 assets.'],
        }),
        SHEET,
      ),
    ).toEqual([]);
  });

  it('catches a figure the model made up', () => {
    /* The failure this whole module exists for: a fluent, plausible, wrong number.
       94% appears nowhere in the sheet — the model computed 148/136 itself. */
    expect(
      verifyFigures(
        narrative({ summary: ['Delivery reached 109% of the contracted minimum.'] }),
        SHEET,
      ),
    ).toEqual(['109']);
  });

  it('accepts a grouped figure written without its separators', () => {
    /* PKR 1250000 and PKR 1,250,000 are the same claim. Warning about it would
       teach the reader to ignore the warnings. */
    expect(
      verifyFigures(narrative({ summary: ['Recurring fees stand at PKR 1250000.'] }), SHEET),
    ).toEqual([]);
  });

  it('accepts a grouped figure written with its separators', () => {
    expect(
      verifyFigures(narrative({ summary: ['Recurring fees stand at PKR 1,250,000.'] }), SHEET),
    ).toEqual([]);
  });

  it('ignores single digits, which are ordinary sentence counting', () => {
    expect(
      verifyFigures(
        narrative({ summary: ['There are 2 internal and 7 external projects, and 3 risks below.'] }),
        SHEET,
      ),
    ).toEqual([]);
  });

  it('ignores a year', () => {
    expect(
      verifyFigures(narrative({ headline: 'Performance for August 2026, and a note on 2025.' }), SHEET),
    ).toEqual([]);
  });

  it('strips trailing punctuation before looking a figure up', () => {
    /* Without the strip, "148." is not found in the sheet and every
       sentence-final figure is reported as invented. */
    expect(
      verifyFigures(narrative({ summary: ['The team published 148.'] }), SHEET),
    ).toEqual([]);
  });

  it('reports each invented figure once, however often it is repeated', () => {
    expect(
      verifyFigures(
        narrative({
          headline: 'Output rose 42%.',
          summary: ['A 42% rise.', 'Again, 42%.'],
          risks: ['Margins fell 17%.'],
        }),
        SHEET,
      ),
    ).toEqual(['42', '17']);
  });

  it('reads every section, not only the summary', () => {
    /* A figure invented in a recommendation is exactly as wrong as one invented
       in the summary, and recommendations are what get acted on. */
    expect(
      verifyFigures(narrative({ recommendations: ['Add 25 more assets next month.'] }), SHEET),
    ).toEqual(['25']);
  });

  it('does not let an invented figure hide inside a larger one', () => {
    /* ⚠️ REGRESSION GUARD. The first implementation asked whether the fact sheet
       CONTAINED the string "25". It does — inside "PKR 1,250,000" — so an invented
       25 was approved by an unrelated fee total. Any figure is a substring of some
       bigger figure, so this made the whole check unreliable in a way that only
       showed up on real reports. Whole-token comparison is what fixes it. */
    expect(
      verifyFigures(narrative({ summary: ['A further 25 assets are planned.'] }), SHEET),
    ).toEqual(['25']);
    /* Same shape: 48 sits inside 148, and 13 inside 136. */
    expect(
      verifyFigures(narrative({ summary: ['48 posts went out, against 13 promised.'] }), SHEET),
    ).toEqual(['48', '13']);
  });

  it('still accepts a figure that genuinely is in the sheet', () => {
    /* The other half of the guard above: tightening the match must not start
       reporting real figures as invented. */
    expect(
      verifyFigures(narrative({ summary: ['148 assets, 31 reels, 136 committed.'] }), SHEET),
    ).toEqual([]);
  });

  it('finds nothing to report in prose with no figures at all', () => {
    expect(
      verifyFigures(
        narrative({ summary: ['Every project met its commitment this period.'] }),
        SHEET,
      ),
    ).toEqual([]);
  });
});
