import { describe, expect, it } from 'vitest';

import {
  MONTH_START_PATTERN,
  buildReport,
  currentMonthStart,
  monthLabel,
  pkr,
  recentMonths,
  type ReportProject,
} from '../ceo-report';

/* ============================================================================
 * What these tests are actually protecting
 * ----------------------------------------------------------------------------
 * The report's whole claim to trustworthiness is that its figures are computed
 * here and merely narrated by the model. So the arithmetic is tested directly, and
 * so is the FACT SHEET — because a figure that is right in the model but wrong in
 * the sentence handed to the LLM is still a wrong figure on the CEO's page.
 * ========================================================================= */

function project(over: Partial<ReportProject> = {}): ReportProject {
  return {
    id: 'p1',
    name: 'Test Project',
    code: 'TST',
    clientKind: 'external',
    clientName: 'A Client',
    packageName: 'SPARK',
    ownerName: 'An Owner',
    monthlyFeePkr: 50_000,
    assetsTargetMin: 14,
    assetsTargetMax: 16,
    reelsTargetMin: 2,
    assetsPublished: 14,
    reelsPublished: 2,
    team: ['Someone'],
    platforms: ['Facebook'],
    liveLinks: 10,
    ...over,
  };
}

const EMPTY = { monthStart: '2026-08-01', projects: [], people: [], platforms: [] };

describe('monthLabel', () => {
  it('names the month in the string, not the month the runtime thinks it is', () => {
    /* ⚠️ The regression guard. `new Date('2026-08-01').getMonth()` is July in any
       timezone behind UTC, which would title an August report "July 2026". */
    expect(monthLabel('2026-08-01')).toBe('August 2026');
    expect(monthLabel('2026-01-01')).toBe('January 2026');
    expect(monthLabel('2026-12-01')).toBe('December 2026');
  });

  it('falls back to the raw string rather than inventing a month', () => {
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(monthLabel('2026-13-01')).toBe('2026-13-01');
  });
});

describe('currentMonthStart', () => {
  const AT = (iso: string) => Date.parse(iso);

  it('returns the first of the month the instant falls in', () => {
    expect(currentMonthStart(AT('2026-08-19T12:00:00Z'))).toBe('2026-08-01');
    expect(currentMonthStart(AT('2026-01-31T23:59:59Z'))).toBe('2026-01-01');
  });

  it('uses UTC, so the answer does not depend on where the server runs', () => {
    /* ⚠️ 2026-09-01T00:30Z is still 31 August in any timezone behind UTC. Reading
       local parts would make the default month depend on the host, and a report
       run just after midnight would silently cover the wrong period. */
    expect(currentMonthStart(AT('2026-09-01T00:30:00Z'))).toBe('2026-09-01');
    expect(currentMonthStart(AT('2026-08-31T23:30:00Z'))).toBe('2026-08-01');
  });

  it('produces a value the action will accept', () => {
    expect(MONTH_START_PATTERN.test(currentMonthStart(AT('2026-08-19T12:00:00Z')))).toBe(true);
  });
});

describe('recentMonths', () => {
  const NOW = Date.parse('2026-08-19T12:00:00Z');

  it('lists the current month first and walks backwards', () => {
    expect(recentMonths(NOW, 4)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01', '2026-05-01']);
  });

  it('crosses the year boundary correctly', () => {
    expect(recentMonths(Date.parse('2026-02-10T00:00:00Z'), 4)).toEqual([
      '2026-02-01', '2026-01-01', '2025-12-01', '2025-11-01',
    ]);
  });

  it('is not thrown off by a day that does not exist in the previous month', () => {
    /* ⚠️ The bug this avoids: setMonth(-1) on 31 March gives 3 March, because
       February has no 31st. Walking the month integer cannot do that. */
    expect(recentMonths(Date.parse('2026-03-31T12:00:00Z'), 3)).toEqual([
      '2026-03-01', '2026-02-01', '2026-01-01',
    ]);
    expect(recentMonths(Date.parse('2026-05-31T12:00:00Z'), 2)).toEqual([
      '2026-05-01', '2026-04-01',
    ]);
  });

  it('produces twelve valid months by default, all acceptable to the action', () => {
    const months = recentMonths(NOW);
    expect(months).toHaveLength(12);
    expect(months.every((m) => MONTH_START_PATTERN.test(m))).toBe(true);
    /* Twelve distinct months, not the same one twelve times. */
    expect(new Set(months).size).toBe(12);
  });
});

describe('MONTH_START_PATTERN', () => {
  it('accepts a first-of-month and refuses anything else', () => {
    expect(MONTH_START_PATTERN.test('2026-08-01')).toBe(true);
    expect(MONTH_START_PATTERN.test('2026-08-19')).toBe(false);
    expect(MONTH_START_PATTERN.test('2026-13-01')).toBe(false);
    expect(MONTH_START_PATTERN.test('2026-00-01')).toBe(false);
    expect(MONTH_START_PATTERN.test("2026-08-01'; drop table users; --")).toBe(false);
    expect(MONTH_START_PATTERN.test('')).toBe(false);
  });
});

describe('pkr', () => {
  it('passes a locale explicitly, so server and client agree', () => {
    /* An argless toLocaleString() differs between Node and the browser and
       triggers a hydration mismatch — already hit once in this project. */
    expect(pkr(1_250_000)).toBe(pkr(1_250_000));
    expect(pkr(0)).toContain('PKR');
    expect(pkr(50_000)).toMatch(/^PKR /);
  });
});

describe('buildReport — totals', () => {
  it('reports an empty period as empty rather than as a wall of zeroes', () => {
    const report = buildReport(EMPTY);
    expect(report.isEmpty).toBe(true);
    expect(report.totals.projectCount).toBe(0);
    expect(report.factSheet).toContain('No active projects.');
  });

  it('adds up assets, reels, fees and links across projects', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', assetsPublished: 14, reelsPublished: 2, monthlyFeePkr: 50_000, liveLinks: 10 }),
        project({ id: 'b', assetsPublished: 30, reelsPublished: 5, monthlyFeePkr: 125_000, liveLinks: 25 }),
      ],
    });
    expect(report.totals.assetsPublished).toBe(44);
    expect(report.totals.reelsPublished).toBe(7);
    expect(report.totals.monthlyRevenuePkr).toBe(175_000);
    expect(report.totals.liveLinks).toBe(35);
  });

  it('separates internal from external client work', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', clientKind: 'internal' }),
        project({ id: 'b', clientKind: 'external' }),
        project({ id: 'c', clientKind: 'external' }),
        project({ id: 'd', clientKind: null }),
      ],
    });
    expect(report.totals.internalCount).toBe(1);
    expect(report.totals.externalCount).toBe(2);
    /* The unclassified one is still an active project. */
    expect(report.totals.projectCount).toBe(4);
    expect(report.totals.unclassifiedCount).toBe(1);
  });

  it('accounts for every project across the three client kinds', () => {
    /* ⚠️ Found on real data: 7 active projects displayed "0 internal · 1 external",
       because six had no client_kind. Each figure was right and together they said
       less than the total, which reads as a broken report. The three must always
       sum to the project count. */
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', clientKind: 'internal' }),
        project({ id: 'b', clientKind: 'external' }),
        ...Array.from({ length: 5 }, (_, i) => project({ id: `n${i}`, clientKind: null })),
      ],
    });
    const { internalCount, externalCount, unclassifiedCount, projectCount } = report.totals;
    expect(internalCount + externalCount + unclassifiedCount).toBe(projectCount);
    expect(unclassifiedCount).toBe(5);
    expect(report.factSheet).toContain('5 not yet classified as either');
  });

  it('says nothing about classification when every project is classified', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [project({ id: 'a', clientKind: 'internal' }), project({ id: 'b', clientKind: 'external' })],
    });
    expect(report.totals.unclassifiedCount).toBe(0);
    expect(report.factSheet).not.toContain('not yet classified');
    expect(report.factSheet).toContain('Active projects: 2 (1 internal, 1 external client work)');
  });

  it('excludes untargeted projects from the committed total, and says how many counted', () => {
    /* ⚠️ The load-bearing case. A project on "up to 75, no floor" has a null
       minimum. Counting it as 0 would make the division look like it committed to
       less and therefore delivered more. */
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', assetsTargetMin: 14 }),
        project({ id: 'b', assetsTargetMin: 30 }),
        project({ id: 'c', assetsTargetMin: null, assetsTargetMax: 75, reelsTargetMin: null }),
      ],
    });
    expect(report.totals.assetsCommitted).toBe(44);
    expect(report.totals.projectsWithTargets).toBe(2);
    expect(report.factSheet).toContain('the 2 project(s) that have one: 44 assets');
  });

  it('counts a zero minimum as a real commitment, distinct from no minimum', () => {
    /* null and 0 are different answers: "nothing was agreed" vs "we agreed to
       publish nothing". Only the second is a target that was met. */
    const report = buildReport({
      ...EMPTY,
      projects: [project({ assetsTargetMin: 0, assetsTargetMax: null, reelsTargetMin: null })],
    });
    expect(report.totals.projectsWithTargets).toBe(1);
    expect(report.totals.assetsCommitted).toBe(0);
  });

  it('flags projects with no fee so a revenue total is not read as complete', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', monthlyFeePkr: 50_000 }),
        project({ id: 'b', monthlyFeePkr: null }),
      ],
    });
    expect(report.totals.monthlyRevenuePkr).toBe(50_000);
    expect(report.totals.projectsWithoutFee).toBe(1);
    expect(report.factSheet).toContain('1 project(s) have no fee recorded and are excluded');
  });

  it('takes the placement total from platforms, not from projects', () => {
    /* An asset cross-posted to four platforms is one asset and four placements.
       Summing per-project asset counts would undercount reach. */
    const report = buildReport({
      ...EMPTY,
      projects: [project({ assetsPublished: 10 })],
      platforms: [
        { name: 'Facebook', placements: 10, withLinks: 9 },
        { name: 'Instagram', placements: 10, withLinks: 8 },
      ],
    });
    expect(report.totals.placements).toBe(20);
    expect(report.totals.assetsPublished).toBe(10);
  });
});

describe('buildReport — verdicts and the attention list', () => {
  it('tallies each verdict', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'a', assetsPublished: 14, reelsPublished: 2 }),               // met
        project({ id: 'b', assetsPublished: 5, reelsPublished: 0 }),                // behind
        project({ id: 'c', assetsPublished: 20, reelsPublished: 2 }),               // exceeded
        project({ id: 'd', assetsPublished: 16, reelsPublished: 0 }),               // short on reels
        project({ id: 'e', assetsTargetMin: null, assetsTargetMax: 75, reelsTargetMin: null }), // untargeted
      ],
    });
    expect(report.byVerdict).toEqual({
      met: 1, behind: 1, exceeded: 1, short_on_reels: 1, untargeted: 1,
    });
  });

  it('lists only the projects that need attention', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'ok', name: 'Fine', assetsPublished: 14, reelsPublished: 2 }),
        project({ id: 'bad', name: 'Behind', assetsPublished: 3, reelsPublished: 0 }),
        project({ id: 'over', name: 'Over', assetsPublished: 40, reelsPublished: 3 }),
      ],
    });
    /* Exceeding is worth noticing but it is not a problem, so it stays out of the
       reading list. */
    expect(report.attention.map((l) => l.project.name)).toEqual(['Behind']);
  });

  it('puts "behind" ahead of "short on reels", and the biggest gap first', () => {
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ id: '1', name: 'Reels only', assetsPublished: 16, reelsPublished: 0 }),
        project({ id: '2', name: 'Slightly behind', assetsPublished: 12, reelsPublished: 2 }),
        project({ id: '3', name: 'Badly behind', assetsPublished: 1, reelsPublished: 0 }),
      ],
    });
    expect(report.attention.map((l) => l.project.name)).toEqual([
      'Badly behind',      // 13 assets + 2 reels short
      'Slightly behind',   // 2 assets short
      'Reels only',        // assets met
    ]);
  });

  it('never puts an untargeted project on the attention list', () => {
    /* Rule 2: a project promised no minimum cannot be behind, and must not be
       coloured red or land in front of the CEO as a failure. */
    const report = buildReport({
      ...EMPTY,
      projects: [
        project({ assetsTargetMin: null, assetsTargetMax: null, reelsTargetMin: null, assetsPublished: 0 }),
      ],
    });
    expect(report.attention).toEqual([]);
    expect(report.byVerdict.untargeted).toBe(1);
    expect(report.factSheet).toContain('Nothing is behind this period.');
  });
});

describe('the fact sheet handed to the language model', () => {
  const report = buildReport({
    monthStart: '2026-08-01',
    projects: [
      project({
        /* A distinctive id, so the leak test below can actually fail. Asserting
           against an id this fixture never sets would pass for free. */
        id: 'uuid-2f9c-must-not-appear',
        name: 'Crescent Nova', code: 'CNI', clientKind: 'internal',
        assetsPublished: 8, reelsPublished: 1,
        team: ['Habiba Minhas', 'A Designer'], platforms: ['Facebook', 'Instagram'],
      }),
    ],
    people: [{ name: 'Habiba Minhas', assetsPublished: 8, reelsPublished: 1, projectCount: 1 }],
    platforms: [{ name: 'Facebook', placements: 8, withLinks: 7 }],
  });

  it('states the period, so the model cannot guess it', () => {
    expect(report.factSheet).toContain('REPORTING PERIOD: August 2026');
  });

  it('carries the computed verdict, not just the raw counts', () => {
    /* If only counts were sent, the model would have to judge 8-against-14
       itself — which is the arithmetic we are refusing to delegate. */
    expect(report.factSheet).toContain('status: behind');
    expect(report.factSheet).toContain('6 to go');
  });

  it('names the people and platforms as given', () => {
    expect(report.factSheet).toContain('Habiba Minhas: 8 assets (1 reels) across 1 project(s)');
    expect(report.factSheet).toContain('Facebook: 8 placements, 7 with live links');
  });

  it('tells the model the rankings are already done', () => {
    /* Otherwise it reorders them, and the prose stops matching the tables next
       to it on the page. */
    expect(report.factSheet).toContain('already ranked worst first — keep this order');
    expect(report.factSheet).toContain('PER PERSON (already ranked by volume — keep this order)');
  });

  it('never describes an unclassified project as an external client', () => {
    /* ⚠️ REGRESSION GUARD, found on real data. The first version wrote
       `clientKind === 'internal' ? 'internal' : 'external'`, so six projects with no
       client kind recorded were each presented to the model as external CLIENT
       work — while the totals line in the same sheet correctly said they were
       unclassified. The model is entitled to trust this sheet, and a default that
       invents a commercial relationship is the worst thing to put in it. */
    const sheet = buildReport({
      ...EMPTY,
      projects: [
        project({ id: 'i', name: 'Internal One', clientKind: 'internal', clientName: null }),
        project({ id: 'e', name: 'External One', clientKind: 'external' }),
        project({ id: 'n', name: 'Unknown One', clientKind: null, clientName: null }),
      ],
    }).factSheet;

    const line = (name: string) =>
      sheet.split('\n').find((l) => l.includes(name)) ?? '';

    expect(line('Internal One')).toContain('internal');
    expect(line('External One')).toContain('external');
    expect(line('Unknown One')).toContain('not recorded');
    /* And specifically NOT claimed as either. */
    expect(line('Unknown One')).not.toMatch(/\| (internal|external) \|/);
  });

  it('leaks no database ids into the prompt', () => {
    /* Ids are noise the model may echo into prose, and they are the kind of
       internal handle that should not travel to a third party at all. */
    expect(report.factSheet).not.toContain('uuid-2f9c-must-not-appear');
    /* Proof the assertion above is capable of failing: the id IS on the model, so
       it was available to leak and simply was not included. */
    expect(report.lines[0]!.project.id).toBe('uuid-2f9c-must-not-appear');
  });

  it('says plainly when a section has nothing in it', () => {
    const bare = buildReport(EMPTY);
    expect(bare.factSheet).toContain('Nobody published anything in this period.');
    expect(bare.factSheet).toContain('No placements recorded in this period.');
    expect(bare.factSheet).toContain('No project has a contracted monthly minimum recorded');
  });
});
