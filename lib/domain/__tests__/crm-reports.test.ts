import { describe, expect, it } from 'vitest';

import {
  buildAgeingReport,
  buildFunnelReport,
  buildPeopleReport,
  buildChannelsReport,
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
  /* ⚠️ NO COUNT. This asserted `toHaveLength(4)` and failed the moment a fifth
     report was added — a test that has to be edited to add a kind teaches
     nothing and delays the edit that matters. What is worth holding is that
     EVERY kind has a label and that no label is the raw enum value. */
  it('gives every report a name of its own', () => {
    expect(REPORT_KINDS.length).toBeGreaterThan(0);
    for (const kind of REPORT_KINDS) {
      expect(REPORT_LABEL[kind]).toBeTruthy();
      expect(REPORT_LABEL[kind]).not.toBe(kind);
    }
  });

  it('⚠️ never gives two reports the same name', () => {
    /* `sources` and `channels` are one population grouped two ways, and their
       first drafts both began "Where the leads came from" — two entries in a
       dropdown that read identically is how somebody generates the wrong one
       and then quotes it. */
    const names = REPORT_KINDS.map((k) => REPORT_LABEL[k]);
    expect(new Set(names).size).toBe(names.length);
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
  it('⚠️ draws every stage, including the ten that are empty', () => {
    /* The database returns only `new`. A funnel whose middle is missing looks
       like a complete funnel with a narrow waist — the shape is carried by the
       gaps as much as by the numbers. */
    const report = buildFunnelReport(FUNNEL, CTX);

    /* Ten since 148/149 — three stages added, two retired. */
    expect(report.rows).toHaveLength(11);
    expect(cellText(report.rows[0][0])).toBe('New');
    /* Nurture sits before the two exits (205), so Lost is last of eleven. */
    expect(cellText(report.rows[10][0])).toBe('Lost');
    expect(cellText(report.rows[9][1])).toBe('0');
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

/* ============================================================================
 * CHANNELS — migration 273
 * ----------------------------------------------------------------------------
 * The real numbers, read off the live table on 2026-09-30: on Chitral Royal
 * Homes, 15 Instagram and 7 Facebook leads arrived 18–20 September through the
 * SAME forms, and 660 older ones are filed as plain Meta because the importer
 * did not ask Graph for `platform` until 15 September.
 *
 * That third bucket is the whole reason this report needs care. 15 against 7
 * looks like a clean comparison until you notice 660 leads sitting outside it.
 * ========================================================================= */
const CHANNELS: SourceRow[] = [
  { source: 'meta_lead_ad', leads: 660, contacted: 40, won: 0, lost: 1, winRate: 0 },
  { source: 'instagram', leads: 15, contacted: 6, won: 1, lost: 1, winRate: 50 },
  { source: 'facebook', leads: 7, contacted: 3, won: 0, lost: 0, winRate: null },
];

describe('channels', () => {
  const report = buildChannelsReport(CHANNELS, CTX);

  it('names the apps rather than printing the enum', () => {
    /* `meta_lead_ad` is not a word anybody says out loud, and this text reaches
       a printed PDF. */
    const names = report.rows.map((r) => cellText(r[0]));
    expect(names).toContain('Instagram');
    expect(names).toContain('Facebook');
    expect(names).toContain('Meta');
    expect(names).not.toContain('meta_lead_ad');
  });

  it('⚠️ says how many could not be split, and why', () => {
    /* WITHOUT THIS THE REPORT IS MISLEADING RATHER THAN INCOMPLETE. A reader
       comparing 15 to 7 has to know that 660 leads are in neither column. */
    const notes = report.notes.join(' ');
    expect(notes).toContain('660 of these are filed as Meta');
    expect(notes).toContain('15 September 2026');
    expect(notes).toContain('cannot be recovered');
  });

  it('⚠️ says nothing about splitting when there is nothing unsplit', () => {
    /* Once every lead carries an app, that paragraph is just noise. */
    const clean = buildChannelsReport(CHANNELS.filter((r) => r.source !== 'meta_lead_ad'), CTX);
    expect(clean.notes.join(' ')).not.toContain('filed as Meta');
  });

  it('⚠️ shows a dash for a channel that has closed nothing, never 0%', () => {
    const fb = report.rows.find((r) => cellText(r[0]) === 'Facebook');
    expect(cellText(fb![5])).toBe('—');
    /* And a real zero is still a zero — Meta has one lost and nothing won. */
    const meta = report.rows.find((r) => cellText(r[0]) === 'Meta');
    expect(cellText(meta![5])).not.toBe('—');
  });

  it('⚠️ does not call itself "Where the leads came from"', () => {
    /* That is the FORM report. Two reports with one title is how the wrong one
       gets generated, and then quoted. */
    expect(report.title).not.toBe(buildSourcesReport(SOURCES, CTX).title);
    expect(report.notes.join(' ')).toContain('one form runs on both Facebook and Instagram');
  });

  it('orders by volume, biggest first', () => {
    const leads = report.rows.map((r) => Number(cellText(r[1]).replace(/[^0-9]/g, '')));
    expect(leads).toEqual([...leads].sort((a, b) => b - a));
  });
});
