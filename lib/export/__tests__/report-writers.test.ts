import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

import { reportToCsv, reportToXlsx } from '../report-writers';
import {
  EMPTY_FILTERS,
  NATURAL_SORT, buildReport, type ReportInput, type ReportTask } from '@/lib/domain/reports';

/* ============================================================================
 * REPORT WRITERS
 * ----------------------------------------------------------------------------
 * The claim being tested is the one that justifies a 3.6 MB dependency: **the
 * spreadsheet contains real numbers, dates and booleans, not text.** So these
 * tests unzip the generated .xlsx and read its XML rather than checking that a
 * buffer came back non-empty.
 *
 * A .xlsx is a zip of XML parts. Numbers appear as bare `<v>` values; strings are
 * indices into `sharedStrings.xml` and carry `t="s"`. That difference is exactly
 * what decides whether a column can be summed, so it is what is asserted.
 * ========================================================================= */

const AUG = { start: '2026-08-01', end: '2026-08-31' };

function task(over: Partial<ReportTask> = {}): ReportTask {
  return {
    reference: 'CNI-001',
    title: 'Design the launch deck',
    /* Added 2026-09-03 with the report's row detail — see `ReportTask`. */
    description: null,
    links: [],
    projectId: 'p1',
    projectName: 'Project One',
    projectType: 'client',
    projectCode: 'P1',
    assigneeId: 'u1',
    assigneeName: 'Ayesha Siddiqui',
    status: 'done',
    effortPoints: 3,
    dueDate: '2026-08-10',
    completedAt: '2026-08-09T12:00:00Z',
    timeLimitMinutes: 120,
    timeSpentMinutes: 90,
    extensionMinutesGranted: 0,
    contentKind: null,
    platforms: [],
    publishedOn: null,
    assigneeAvatarUrl: null,
    updatedAt: '2026-08-09T12:00:00Z',
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    type: 'completion',
    period: AUG,
    subjectId: null,
    subjectName: null,
    today: '2026-08-12',
    filters: EMPTY_FILTERS,
    sort: NATURAL_SORT,
    tasks: [task()],
    people: [
      {
        userId: 'u1',
        name: 'Ayesha Siddiqui',
        roleTitle: 'Designer',
        role: 'member',
        loadPoints: 18,
        capacityPoints: 36,
        utilisationPct: 50,
        bandLabel: 'Healthy',
        activeTaskCount: 2,
        maxConcurrentTasks: 5,
        otherWorkPct: 10,
      },
    ],
    projects: [{ id: 'p1', name: 'Project One', code: 'P1', type: 'client', status: 'active' }],
    ...over,
  };
}

/** The sheet XML and shared strings of a generated workbook. */
async function readXlsx(report: Parameters<typeof reportToXlsx>[0]) {
  const buffer = await reportToXlsx(report);
  const files = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(files);
  return {
    buffer,
    names,
    sheet1: strFromU8(files['xl/worksheets/sheet1.xml']),
    sheet2: files['xl/worksheets/sheet2.xml']
      ? strFromU8(files['xl/worksheets/sheet2.xml'])
      : '',
    shared: files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '',
    workbook: strFromU8(files['xl/workbook.xml']),
  };
}

describe('reportToXlsx', () => {
  it('produces a valid zip with the expected parts and two named sheets', async () => {
    const { buffer, names, workbook } = await readXlsx(buildReport(input()));

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/worksheets/sheet2.xml');
    /* The table and its definitions are separate sheets on purpose: a header
       block above the data breaks sorting, filtering and every formula that
       assumes row 1 is the header. */
    expect(workbook).toContain('Report');
    expect(workbook).toContain('About');
  });

  it('writes counts as NUMBERS, not as text', async () => {
    /* The whole justification for the dependency. A numeric cell has a bare
       `<v>`; a string cell carries t="s" and points into sharedStrings. */
    const { sheet1 } = await readXlsx(buildReport(input()));

    /* Column B of row 2 is "Completed" = 1 for the single done task. */
    expect(sheet1).toMatch(/<c r="B2"[^>]*><v>1<\/v><\/c>/);
    expect(sheet1).not.toMatch(/<c r="B2"[^>]*t="s"/);
  });

  it('stores a percentage as a FRACTION, because Excel percent formats multiply by 100', async () => {
    /* 100% on-time must be stored as 1, not as 100 — which would display 10000%.
       This is the kind of thing that looks right in code and is wrong on screen. */
    const { sheet1 } = await readXlsx(buildReport(input()));
    const onTimeCol = 'G'; // 7th column of the completion report
    expect(sheet1).toMatch(new RegExp(`<c r="${onTimeCol}2"[^>]*><v>1<\\/v><\\/c>`));
  });

  it('stores a duration as minutes, so a column of them can be summed', async () => {
    /* Not Excel's time format: that wraps at 24 hours, so 30 hours logged would
       display as 6. A plain number with the unit in the header is honest. */
    const { sheet1 } = await readXlsx(
      buildReport(input({ type: 'project_status', tasks: [task({ timeSpentMinutes: 1830 })] })),
    );
    expect(sheet1).toContain('<v>1830</v>');
  });

  it('writes a task title beginning with "=" as text, NOT as a formula', async () => {
    /* The CSV export guards against this because a spreadsheet executes it.
       Verified here rather than assumed: no <f> element, and the text is present
       in the shared-string table. */
    const evil = '=HYPERLINK("https://evil.example","Click for the brief")';
    const { sheet1, shared } = await readXlsx(
      buildReport(input({ type: 'time', tasks: [task({ title: evil })] })),
    );

    expect(sheet1).not.toContain('<f>');
    expect(shared).toContain('HYPERLINK');
  });

  it('carries the notes and the point scale on the About sheet', async () => {
    const { sheet2, shared } = await readXlsx(buildReport(input()));
    expect(sheet2.length).toBeGreaterThan(0);
    expect(shared).toContain('How to read this');
    expect(shared).toContain('Effort point scale');
  });

  it('builds every report type without throwing', async () => {
    for (const type of ['completion', 'workload', 'project_status', 'time'] as const) {
      const buffer = await reportToXlsx(buildReport(input({ type })));
      expect(buffer.length, type).toBeGreaterThan(0);
    }
  });

  it('handles a report with no rows at all', async () => {
    const { sheet1 } = await readXlsx(buildReport(input({ tasks: [] })));
    /* The header still has to be there — an empty file would look like a failure
       rather than an empty period. */
    expect(sheet1).toContain('<row');
  });
});

describe('reportToCsv', () => {
  it('opens with a UTF-8 BOM so Excel does not mangle accented names', () => {
    const csv = reportToCsv(buildReport(input()));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('neutralises a leading "=" with the shared guard', () => {
    const evil = '=cmd|\'/c calc\'!A1';
    const csv = reportToCsv(buildReport(input({ type: 'time', tasks: [task({ title: evil })] })));
    /* lib/domain/csv.ts prefixes an apostrophe, which every spreadsheet reads as
       "this is text". Imported, not reimplemented — two copies of a security
       control is one copy that gets forgotten. */
    expect(csv).toContain("'=cmd");
  });

  it('keeps numbers unquoted and unformatted, but spells durations out', () => {
    const csv = reportToCsv(buildReport(input({ type: 'project_status' })));
    /* A spreadsheet reading a CSV wants a bare 3, not "3". But 90 under a column
       headed "Time spent" reads as minutes to nobody. */
    expect(csv).toContain('1h 30m');
  });

  it('appends the period, the figures and the definitions', () => {
    const csv = reportToCsv(buildReport(input()));
    expect(csv).toContain('2026-08-01');
    expect(csv).toContain('On-time rate');
    expect(csv).toContain('How to read this');
    expect(csv).toContain('Effort point scale');
  });

  it('strips markdown emphasis, which belongs on a screen and not in a text file', () => {
    const csv = reportToCsv(buildReport(input({ type: 'project_status' })));
    expect(csv).not.toContain('**');
  });

  it('has one column per report column in its header row', () => {
    const report = buildReport(input());
    const csv = reportToCsv(report);
    const header = csv.replace(/^﻿/, '').split('\r\n')[0];
    /* Counting fields rather than commas: a quoted label may contain one. */
    const fields = header.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.length ?? 0;
    expect(fields - 1).toBe(report.columns.length);
  });
});
