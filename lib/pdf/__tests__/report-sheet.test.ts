import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { TOKEN_INK, composeReportSheet } from '../report-sheet';
import type { ChartSpec } from '@/lib/domain/report-charts';
import type { Report } from '@/lib/domain/reports';
import type { WorkRow } from '@/lib/domain/work-report';

/* ============================================================================
 * THE REPORT SHEET PDF
 * ----------------------------------------------------------------------------
 * ⚠️ What can and cannot be asserted, plainly: this lays out a document, and a
 * test cannot see whether a column is in the right place. What it CAN prove is
 * that every shape renders at all on the inputs that would otherwise throw — and
 * in pdf-lib those failures are not subtle, they are a 500 where a download
 * should have been.
 *
 * The cases below are the ones that genuinely break a pdf-lib composer:
 *
 *   · a curly quote or em dash anywhere — Helvetica is WinAnsi and `drawText`
 *     THROWS outside it. This division's own document titles are full of em
 *     dashes; one of them already crashed a route once
 *     (lib/domain/content-disposition.ts).
 *   · an empty report — no rows, no charts, no figures
 *   · a report long enough to paginate, where the header has to be redrawn
 *   · a chart whose values are all zero — a `0/0` width is NaN, and pdf-lib
 *     rejects a NaN coordinate
 * ========================================================================= */

const PERIOD = { start: '2026-08-01', end: '2026-08-31' };

function report(over: Partial<Report> = {}): Report {
  return {
    type: 'completion',
    title: 'Completion',
    subtitle: 'Everybody · 2026-08-01 to 2026-08-31',
    period: PERIOD,
    columns: [
      { key: 'person', label: 'Person', kind: 'text', width: 24 },
      { key: 'done', label: 'Completed', kind: 'number' },
      { key: 'onTimePct', label: 'On-time %', kind: 'percent' },
    ],
    rows: [
      [
        { kind: 'text', value: 'Kashif Ahmed' },
        { kind: 'number', value: 57 },
        { kind: 'percent', value: 73 },
      ],
      [
        { kind: 'text', value: 'Najmulla' },
        { kind: 'number', value: 30 },
        { kind: 'percent', value: 79 },
      ],
    ],
    figures: [
      { label: 'Completed', value: { kind: 'number', value: 87 }, hint: 'across 4 projects' },
      { label: 'On-time rate', value: { kind: 'percent', value: 74 } },
    ],
    notes: ['A task counts toward this period if it was completed inside it.'],
    ...over,
  };
}

const CHARTS: ChartSpec[] = [
  {
    kind: 'trend',
    title: 'Delivery over time',
    question: 'Are we finishing more, and finishing it on time?',
    labels: ['1 Aug', '8 Aug', '15 Aug', '22 Aug', '29 Aug'],
    series: [
      { label: 'Completed', token: 'accent-primary', points: [12, 18, 9, 24, 21] },
      { label: 'On time', token: 'status-done', points: [10, 15, 6, 20, 19] },
    ],
    format: 'integer',
  },
  {
    kind: 'bars',
    title: 'Published per project',
    question: 'Which project is posting how much?',
    bars: [
      { label: 'GC Royal Emporium', value: 45, token: 'accent-primary', note: 'of 61 planned' },
      { label: 'Daniyal Marketing', value: 38, token: 'accent-gold', note: 'of 49 planned' },
    ],
    format: 'integer',
  },
  {
    kind: 'donut',
    title: 'Platform mix',
    question: 'Where is the work actually going out?',
    slices: [
      { label: 'Facebook', value: 65, token: 'status-todo' },
      { label: 'Instagram', value: 51, token: 'status-review' },
      { label: 'LinkedIn', value: 46, token: 'accent-primary' },
    ],
    centreLabel: 'Placements',
    centreValue: '162',
  },
];

const base = {
  /* The generic table. The work table has its own cases below. */
  work: null,
  charts: CHARTS,
  filterSummary: ['Projects: GC Royal Emporium'],
  generatedOn: '2026-08-25',
  generatedBy: 'Umm-e-Habiba',
};

const workRow = (over: Partial<WorkRow>): WorkRow => ({
  key: 'a',
  projectId: 'p1',
  projectName: 'GC Royal Emporium',
  userId: 'u1',
  personName: 'Kashif Ahmed',
  avatarUrl: null,
  /* `role` became `tasks` on 2026-09-03 — see WorkRow. */
  tasks: [],
  platforms: ['facebook', 'instagram'],
  tasksAssigned: 20,
  tasksDone: 18,
  tasksPending: 2,
  postsPublished: 16,
  contentTypes: ['Static post', 'Long video', 'Story'],
  activitySummary: '10 posts, 3 reels, 2 stories',
  status: 'overdue',
  lastActive: '2026-08-24T10:00:00Z',
  ...over,
});

/** A PDF always starts `%PDF-`. Anything else is not a document. */
const isPdf = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';

describe('composeReportSheet', () => {
  it('renders a complete report', async () => {
    const bytes = await composeReportSheet({ ...base, report: report() });
    expect(isPdf(bytes)).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('survives curly quotes, em dashes and non-Latin text anywhere', async () => {
    /* ⚠️ THE test in this file. Helvetica is WinAnsi-encoded and `drawText`
       THROWS on anything outside it, so a single character from a real project
       name would turn the export into a 500. Every string that reaches the page
       — titles, rows, figures, notes, filters, the author's name — has to be
       funnelled through `safe()`, and this is what proves none was missed. */
    const nasty = 'Package Details — “part 1” of 2 · Ammar’s review — اردو';
    const bytes = await composeReportSheet({
      ...base,
      filterSummary: [nasty],
      generatedBy: nasty,
      report: report({
        title: nasty,
        subtitle: nasty,
        columns: [
          { key: 'person', label: nasty, kind: 'text' },
          { key: 'done', label: nasty, kind: 'number' },
        ],
        rows: [
          [
            { kind: 'text', value: nasty },
            { kind: 'number', value: 3 },
          ],
        ],
        figures: [{ label: nasty, value: { kind: 'text', value: nasty }, hint: nasty }],
        notes: [nasty],
      }),
      charts: [
        {
          kind: 'bars',
          title: nasty,
          question: nasty,
          bars: [{ label: nasty, value: 4, token: 'accent-primary', note: nasty }],
          format: 'integer',
        },
      ],
    });

    expect(isPdf(bytes)).toBe(true);
  });

  it('renders an empty report without throwing', async () => {
    /* A quiet month must produce a document that says so, not an error. */
    const bytes = await composeReportSheet({
      ...base,
      charts: [],
      filterSummary: [],
      report: report({ rows: [], figures: [], notes: [] }),
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it('paginates a long report', async () => {
    const rows = Array.from({ length: 220 }, (_, i) => [
      { kind: 'text' as const, value: `Person number ${i}` },
      { kind: 'number' as const, value: i },
      { kind: 'percent' as const, value: i % 100 },
    ]);
    const bytes = await composeReportSheet({ ...base, report: report({ rows }) });

    expect(isPdf(bytes)).toBe(true);

    /* ⚠️ Counted through pdf-lib, NOT by searching the bytes for '/Type /Page'.
       `save()` writes object streams by default, so the page dictionaries are
       compressed and a string search finds exactly one match however many pages
       there are — an assertion that would have passed for a broken composer and
       failed for a working one. Loading the document asks the real question. */
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(2);
  });

  it('never runs the notes into the table, at any row count', async () => {
    /* ⚠️ REGRESSION. The notes were originally pinned near the bottom of the page
       — `PAGE_H - 56 - needed` — regardless of where the table ended. On a short
       report that lands below the table by luck; on a report whose table fills the
       page it drew two blocks of 7pt type straight through each other. It only
       appeared at particular row counts, which is why this sweeps across the page
       boundary rather than testing one.

       Positions cannot be read back out of a PDF here, so what is asserted is the
       consequence: the block is placed as a whole, so a report whose table reaches
       the bottom must push the notes onto a further page rather than overlapping,
       and every row count in the sweep must compose at all. */
    let previousPages = 0;

    for (const count of [1, 25, 30, 33, 34, 35, 36, 40, 70, 71, 72]) {
      const rows = Array.from({ length: count }, (_, i) => [
        { kind: 'text' as const, value: `Person number ${i}` },
        { kind: 'number' as const, value: i },
        { kind: 'percent' as const, value: i % 100 },
      ]);

      const bytes = await composeReportSheet({
        ...base,
        charts: [],
        report: report({ rows }),
      });
      expect(isPdf(bytes), `${count} rows did not compose`).toBe(true);

      /* Page count only ever grows with row count — a drop would mean content
         was being written over something instead of onto a new sheet. */
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      expect(pages, `${count} rows`).toBeGreaterThanOrEqual(previousPages);
      previousPages = pages;
    }
  });

  it('handles charts whose values are all zero', async () => {
    /* ⚠️ A `value / ceiling` of `0 / 0` is NaN, and pdf-lib rejects a NaN
       coordinate with an exception rather than drawing nothing. A month where
       nothing was published is a real month. */
    const bytes = await composeReportSheet({
      ...base,
      report: report(),
      charts: [
        {
          kind: 'bars',
          title: 'Published per project',
          question: 'Which project is posting how much?',
          bars: [
            { label: 'GC Royal', value: 0, token: 'accent-primary' },
            { label: 'Daniyal', value: 0, token: 'accent-gold' },
          ],
          format: 'integer',
        },
        {
          kind: 'donut',
          title: 'Platform mix',
          question: 'Where is the work going out?',
          slices: [{ label: 'Facebook', value: 0, token: 'status-todo' }],
          centreLabel: 'Placements',
          centreValue: '0',
        },
        {
          kind: 'trend',
          title: 'Delivery',
          question: 'Improving?',
          labels: ['1 Aug', '8 Aug'],
          series: [{ label: 'Completed', token: 'accent-primary', points: [0, 0] }],
          format: 'integer',
        },
      ],
    });

    expect(isPdf(bytes)).toBe(true);
  });

  it('draws an unknown colour token rather than failing', async () => {
    /* A token added to the palette but not to TOKEN_INK must print as a
       deliberate colour, never as an exception or as black. */
    const bytes = await composeReportSheet({
      ...base,
      report: report(),
      charts: [
        {
          kind: 'bars',
          title: 'Something',
          question: 'What?',
          bars: [{ label: 'A', value: 3, token: 'a-token-that-does-not-exist' }],
          format: 'integer',
        },
      ],
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it('is byte-for-byte identical across builds of the same report', async () => {
    /* ⚠️ `PDFDocument.create()` stamps CreationDate and ModDate from the clock,
       so without the explicit stamping two exports of one report differ and "is
       this the file I circulated?" has no answer. report-poster.ts learned this
       first; this proves the lesson was carried over. */
    const a = await composeReportSheet({ ...base, report: report() });
    const b = await composeReportSheet({ ...base, report: report() });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('renders the work table with avatars, brand marks and status pills', async () => {
    const bytes = await composeReportSheet({
      ...base,
      report: report({ columns: [], rows: [] }),
      work: {
        posters: [],
        rows: [
          workRow({}),
          workRow({ key: 'b', status: 'completed', platforms: ['linkedin', 'tiktok', 'x'] }),
          workRow({ key: 'c', status: 'pending', platforms: [], tasks: [], contentTypes: [], activitySummary: '' }),
          workRow({ key: 'd', status: 'active', personName: 'Unassigned', userId: null, lastActive: null }),
        ],
      },
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it('draws a platform the mark table has never heard of', async () => {
    /* A platform row added to the database tomorrow must print a lettered tile,
       not throw and not leave a hole. */
    const bytes = await composeReportSheet({
      ...base,
      report: report({ columns: [], rows: [] }),
      work: {
        posters: [],
        rows: [workRow({ platforms: ['some-new-network', 'facebook'] })],
      },
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it('paginates the work table without splitting a row', async () => {
    /* Rows are tall and variable here, so the break has to be decided per row
       from its measured height rather than from a fixed row count. */
    const rows = Array.from({ length: 60 }, (_, i) =>
      workRow({
        key: String(i),
        projectName: `Project number ${i} with a fairly long name`,
        activitySummary: '10 posts, 3 reels, 2 stories, 4 carousels, 2 website updates',
        contentTypes: ['Static post', 'Long video', 'Story', 'Reel / short video'],
      }),
    );
    const bytes = await composeReportSheet({
      ...base,
      report: report({ columns: [], rows: [] }),
      work: { posters: [], rows },
    });

    expect(isPdf(bytes)).toBe(true);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });

  it('renders an empty work table', async () => {
    const bytes = await composeReportSheet({
      ...base,
      report: report({ columns: [], rows: [], figures: [], notes: [] }),
      work: { posters: [], rows: [] },
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it('covers every token the chart module can emit', () => {
    /* The categorical palette and the status tokens both feed `token` fields.
       A token with no ink here silently prints as the brand teal, which on a
       multi-slice chart means two slices the same colour. */
    for (const token of [
      'accent-primary',
      'accent-gold',
      'status-progress',
      'status-review',
      'feedback-info',
      'status-revisions',
      'status-done',
      'status-blocked',
      'status-backlog',
      'status-todo',
      'status-cancelled',
      'feedback-error',
      'feedback-warning',
      'feedback-success',
    ]) {
      expect(TOKEN_INK[token], `no print ink for ${token}`).toBeDefined();
    }
  });
});
