import { describe, expect, it } from 'vitest';

import {
  buildAgeingReport,
  buildFunnelReport,
  buildPeopleReport,
  buildSourcesReport,
  isReportKind,
  REPORT_KINDS,
  REPORT_LABEL,
  reportNeedsPeriod,
  type AgeingRow,
  type FunnelRow,
  type PersonRow,
  type SourceRow,
} from '../crm-reports';
import { cellText } from '../reports';

/* ============================================================================
 * WHAT A CRM REPORT SAYS — Step 10
 * ----------------------------------------------------------------------------
 * ⚠️ THE FIXTURES ARE THE LIVE NUMBERS, read off the database on 2026-09-10:
 * 615 leads, all at `new`, 553 of them over a month old, the oldest 90 days, and
 * NOT ONE ever contacted. A tidy fixture would exercise a shape this data does
 * not have — and the interesting cases are all about what the report refuses to
 * claim while the pipeline is three weeks old.
 * ========================================================================= */

const CTX = { projectName: 'Chitral Royal Homes', from: '2026-06-12', to: '2026-09-10' };

/** The funnel as it actually is: everything at `new`. */
const FUNNEL: FunnelRow[] = [{ stage: 'new', leads: 615, share: 100 }];

/** The real ageing buckets. */
const AGEING: AgeingRow[] = [
  { bucket: 'Today or yesterday', sortOrder: 1, leads: 14, oldestDays: 1 },
  { bucket: 'This week', sortOrder: 2, leads: 7, oldestDays: 2 },
  { bucket: 'Up to a month', sortOrder: 3, leads: 41, oldestDays: 24 },
  { bucket: 'One to two months', sortOrder: 4, leads: 391, oldestDays: 60 },
  { bucket: 'Two to three months', sortOrder: 5, leads: 162, oldestDays: 90 },
];

/** The three forms that have leads, none contacted. */
const SOURCES: SourceRow[] = [
  { source: 'Chitral Royal Homes-copy', leads: 553, contacted: 0, won: 0, lost: 0, winRate: null },
  { source: 'CRH ( 17/08/26 )', leads: 41, contacted: 0, won: 0, lost: 0, winRate: null },
  {
    source: 'Chitral Royal Homes-copy-copy-copy',
    leads: 21,
    contacted: 0,
    won: 0,
    lost: 0,
    winRate: null,
  },
];

describe('the vocabulary', () => {
  it('names all four reports', () => {
    expect(REPORT_KINDS).toHaveLength(4);
    for (const kind of REPORT_KINDS) {
      expect(REPORT_LABEL[kind]).toBeTruthy();
      expect(REPORT_LABEL[kind]).not.toBe(kind);
    }
  });

  it('rejects anything else, which is what keeps it out of an enum cast', () => {
    expect(isReportKind('funnel')).toBe(true);
    expect(isReportKind('revenue')).toBe(false);
    expect(isReportKind('')).toBe(false);
  });

  it('⚠️ asks for no period on ageing, because it is a snapshot of now', () => {
    expect(reportNeedsPeriod('ageing')).toBe(false);
    expect(reportNeedsPeriod('funnel')).toBe(true);
    expect(reportNeedsPeriod('sources')).toBe(true);
    expect(reportNeedsPeriod('people')).toBe(true);
  });
});

describe('the funnel', () => {
  it('⚠️ draws every stage, including the eight that are empty', () => {
    /* The database returns only `new`. A funnel whose middle is missing looks
       like a complete funnel with a narrow waist — the shape is carried by the
       gaps as much as by the numbers. */
    const report = buildFunnelReport(FUNNEL, CTX);

    expect(report.rows).toHaveLength(9);
    expect(cellText(report.rows[0][0])).toBe('New');
    expect(cellText(report.rows[8][0])).toBe('Lost');
    expect(cellText(report.rows[8][1])).toBe('0');
  });

  it('⚠️ says this is a pipeline snapshot, not a conversion measure', () => {
    /* 615 leads all at New shows "100%", and a reader who is not told will take
       that as a result. */
    const notes = buildFunnelReport(FUNNEL, CTX).notes.join(' ');

    expect(notes).toContain('snapshot of a pipeline rather than a measure');
  });

  it('does not say that once something has closed', () => {
    const withWin = buildFunnelReport(
      [...FUNNEL, { stage: 'won', leads: 3, share: 0.5 }],
      CTX,
    );
    expect(withWin.notes.join(' ')).not.toContain('snapshot of a pipeline');
  });

  it('⚠️ shows a dash rather than 0% on an empty period', () => {
    /* Dividing by zero would fail the whole report; printing 0% would claim a
       measurement nobody made. */
    const empty = buildFunnelReport([], CTX);

    expect(cellText(empty.rows[0][2])).toBe('—');
    expect(empty.notes.length).toBeGreaterThan(0);
  });
});

describe('ageing', () => {
  it('reports the real position, in order', () => {
    const report = buildAgeingReport(AGEING, CTX);

    expect(report.rows).toHaveLength(5);
    expect(cellText(report.rows[0][0])).toBe('Today or yesterday');
    expect(cellText(report.rows[4][0])).toBe('Two to three months');
  });

  it('⚠️ leads with how many are over a month old, because that is the finding', () => {
    /* 553 of 615. "615 open leads" is a number; "553 of them are over a month
       old" is the thing somebody acts on. */
    const figures = buildAgeingReport(AGEING, CTX).figures;
    const overAMonth = figures.find((f) => f.label === 'Over a month old');

    expect(cellText(overAMonth!.value)).toBe('553');
    expect(overAMonth!.hint).toBe('90% of them');
  });

  it('⚠️ warns that Meta has already deleted the oldest', () => {
    /* 90 days is Meta's retention. Past it, our copy is the only one that
       exists, and that changes what somebody does this afternoon. */
    expect(buildAgeingReport(AGEING, CTX).notes.join(' ')).toContain(
      'Meta deletes lead data 90 days after submission',
    );
  });

  it('does not warn when nothing is near the window', () => {
    const young: AgeingRow[] = [
      { bucket: 'This week', sortOrder: 2, leads: 4, oldestDays: 3 },
    ];
    expect(buildAgeingReport(young, CTX).notes.join(' ')).not.toContain('Meta deletes');
  });

  it('⚠️ is dated today at both ends, not the requested period', () => {
    /* Ageing filtered by arrival date answers a different question. */
    const report = buildAgeingReport(AGEING, CTX);
    expect(report.period.start).toBe(CTX.to);
    expect(report.period.end).toBe(CTX.to);
  });
});

describe('sources', () => {
  it('⚠️ shows a dash for the win rate, never 0%', () => {
    /* A rate of 0% reads as a fact about the campaign. Null says we cannot tell
       yet, which is the truth. And a text dash is excluded from a spreadsheet
       average where a 0 would drag it down. */
    const report = buildSourcesReport(SOURCES, CTX);

    for (const row of report.rows) {
      expect(cellText(row[5])).toBe('—');
    }
  });

  it('⚠️ says nobody has been contacted, so nothing here judges a campaign', () => {
    /* THE HONEST HEADLINE. Leads arriving and nobody ringing them is a different
       problem from leads arriving and not converting, and only one of those is
       the campaign's fault. */
    const notes = buildSourcesReport(SOURCES, CTX).notes.join(' ');

    expect(notes).toContain('Nobody has been contacted at all');
    expect(notes).toContain('says the leads have not been worked yet');
  });

  it('always explains why the campaign is missing', () => {
    /* `campaign_name` comes back empty because the page and the ad account are
       in different portfolios. A reader comparing spend has to know. */
    const notes = buildSourcesReport(SOURCES, CTX).notes.join(' ');

    expect(notes).toContain('different portfolios');
    expect(notes).toContain('One permission change in Meta');
  });

  it('shows a real rate once something has closed', () => {
    const closed: SourceRow[] = [
      { source: 'A form', leads: 10, contacted: 8, won: 3, lost: 1, winRate: 75 },
    ];
    const report = buildSourcesReport(closed, CTX);

    expect(cellText(report.rows[0][5])).toContain('75');
    expect(report.notes.join(' ')).not.toContain('Nobody has been contacted');
  });

  it('orders by volume, so the biggest source is first', () => {
    const rows = buildSourcesReport(SOURCES, CTX).rows;
    expect(cellText(rows[0][0])).toBe('Chitral Royal Homes-copy');
    expect(cellText(rows[0][1])).toBe('553');
  });
});

describe('the team', () => {
  it('⚠️ says there is nothing to compare when nobody holds a lead', () => {
    /* Today's real state: Step 7 shares them out and this fills in. An empty
       table with no sentence reads as broken. */
    const report = buildPeopleReport([], CTX);

    expect(report.rows).toHaveLength(0);
    expect(report.notes.join(' ')).toContain('Nobody holds a lead yet');
  });

  it('⚠️ explains how to read it beside the sources report', () => {
    /* The owner's headline question — "is it the staff or the campaign?" — is
       answered by the two together, and a conclusion nobody can reconstruct gets
       ignored the first time it disagrees with somebody's gut. */
    const people: PersonRow[] = [
      {
        person: 'Sale Tester',
        leads: 40,
        contacted: 31,
        won: 2,
        lost: 5,
        stillOpen: 33,
        medianMinutes: 35,
      },
    ];
    const notes = buildPeopleReport(people, CTX).notes.join(' ');

    expect(notes).toContain('same source with different people');
    expect(notes).toContain('same person across different sources');
  });

  it('⚠️ shows a dash for response time, never 0m', () => {
    /* Null means nobody has logged a call. Rendering it as zero would say they
       answer instantly, which is the most flattering reading of no data. */
    const untouched: PersonRow[] = [
      {
        person: 'Sale 2 tester',
        leads: 12,
        contacted: 0,
        won: 0,
        lost: 0,
        stillOpen: 12,
        medianMinutes: null,
      },
    ];
    const report = buildPeopleReport(untouched, CTX);

    expect(cellText(report.rows[0][6])).toBe('—');
    expect(report.notes.join(' ')).toContain('it is not a zero');
  });

  it('carries the response time as minutes, so a spreadsheet can format it', () => {
    const people: PersonRow[] = [
      {
        person: 'Sale Tester',
        leads: 40,
        contacted: 31,
        won: 2,
        lost: 5,
        stillOpen: 33,
        medianMinutes: 35.4,
      },
    ];
    const cell = buildPeopleReport(people, CTX).rows[0][6];

    expect(cell.kind).toBe('duration');
    expect(cell).toMatchObject({ value: 35 });
  });
});

describe('every report', () => {
  const built = [
    buildFunnelReport(FUNNEL, CTX),
    buildAgeingReport(AGEING, CTX),
    buildSourcesReport(SOURCES, CTX),
    buildPeopleReport([], CTX),
  ];

  it('⚠️ states what it counted, always', () => {
    /* `lib/domain/reports.ts`: "a number without its definition is how two
       people read the same report and disagree." */
    for (const report of built) {
      expect(report.notes.length, report.title).toBeGreaterThan(0);
    }
  });

  it('names the project it is about', () => {
    for (const report of built) {
      expect(report.subtitle, report.title).toBe('Chitral Royal Homes');
    }
  });

  it('gives every row exactly as many cells as there are columns', () => {
    /* The CSV and XLSX writers zip rows against columns; a short row silently
       shifts every value after it into the wrong column. */
    for (const report of built) {
      for (const row of report.rows) {
        expect(row.length, report.title).toBe(report.columns.length);
      }
    }
  });
});
