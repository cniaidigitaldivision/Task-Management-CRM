import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER,
  EXPORT_FORMATS,
  availableFormats,
  fileSize,
  filterActive,
  filterTemplates,
  nextRunOn,
  scheduleState,
  sortTemplates,
  templateKpis,
  templateSections,
  templateTags,
  type ReportTemplate,
} from '../report-templates';

/* ============================================================================
 * The tests that hold the honest bits honest. Several of these exist because
 * the reference design asserts something this system cannot do, and the
 * temptation was to draw it anyway.
 * ========================================================================= */

const NOW = Date.parse('2026-09-04T12:00:00Z');

function template(over: Partial<ReportTemplate> = {}): ReportTemplate {
  return {
    id: 'a',
    slug: 'monthly-client-report',
    name: 'Monthly Client Report',
    description: 'Week by week against the month’s agreed assets and reels.',
    category: 'executive',
    engine: 'project_report',
    kind: 'month',
    format: 'pdf',
    isBuiltin: true,
    createdById: null,
    createdByName: null,
    usageCount: 0,
    lastUsedAt: null,
    updatedAt: new Date(NOW).toISOString(),
    isFavourite: false,
    ...over,
  };
}

describe('sections', () => {
  it('describes the composer that actually renders, not the poster variant', () => {
    /* The default at /api/project-report/[id] is composeReportSheet; the drawn
       poster is the ?layout=poster branch. Naming the wrong one would send
       somebody to the wrong file when a panel needs changing. */
    expect(templateSections(template()).describes).toBe('lib/pdf/report-sheet.ts');
  });

  /* ⚠️ ONLY THE DAILY LAYOUTS LIST INDIVIDUAL POSTS, so only they have a link
     column. Promising clickable links on a monthly sheet would describe a column
     that is not on the page. */
  it('claims clickable links only where the layout has them', () => {
    const keys = (kind: ReportTemplate['kind']) =>
      templateSections(template({ kind })).sections.map((s) => s.key);

    expect(keys('today')).toContain('links');
    expect(keys('yesterday')).toContain('links');
    expect(keys('week')).not.toContain('links');
    expect(keys('month')).not.toContain('links');
    expect(keys('year')).not.toContain('links');
  });

  it('names the breakdown by the period, as the sheet heads it', () => {
    const label = (kind: ReportTemplate['kind']) =>
      templateSections(template({ kind })).sections.find((s) => s.key === 'table')?.label;

    expect(label('week')).toBe('Day by day');
    expect(label('month')).toBe('Week by week');
    expect(label('year')).toBe('Month by month');
    expect(label('today')).toBe('Published posts');
  });

  it('calls a CSV’s parts columns rather than sections', () => {
    const s = templateSections(template({ engine: 'tasks_csv', kind: null, format: 'csv' }));
    expect(s.heading).toBe('Columns included');
    expect(s.sections.some((c) => c.label.includes('Reference'))).toBe(true);
  });

  /* Every section carries an icon KEY. A component here would work in a client
     component and throw the moment a server page called the same function. */
  it('returns icon keys, never components', () => {
    for (const section of templateSections(template()).sections) {
      expect(typeof section.icon).toBe('string');
    }
  });
});

describe('formats', () => {
  /* ⚠️ THE REFERENCE'S CARD READS "Supported Formats 5". Two writers exist. */
  it('reports only the formats something can actually write', () => {
    expect(availableFormats().map((f) => f.key)).toEqual(['pdf', 'csv']);
  });

  it('keeps the other three visible with a reason rather than hiding them', () => {
    const unavailable = EXPORT_FORMATS.filter((f) => !f.available);
    expect(unavailable).toHaveLength(3);
    for (const f of unavailable) {
      expect(f.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('filtering', () => {
  const templates = [
    template({ id: '1', name: 'Monthly Client Report', category: 'executive', format: 'pdf' }),
    template({
      id: '2',
      name: 'Task Export',
      description: 'Every task you can see as a spreadsheet.',
      category: 'delivery',
      engine: 'tasks_csv',
      kind: null,
      format: 'csv',
    }),
    template({
      id: '3',
      name: 'My Recap',
      description: 'A custom one.',
      category: 'content',
      engine: 'meta_posts_csv',
      kind: null,
      format: 'csv',
      isBuiltin: false,
      slug: null,
      createdById: 'u1',
      isFavourite: true,
    }),
  ];

  /* ⚠️ THE SEARCH READS THE DESCRIPTION. "spreadsheet" is in no template's NAME
     but is exactly what somebody types looking for the CSV. */
  it('finds a template by a word that is only in its description', () => {
    const found = filterTemplates(templates, { ...EMPTY_FILTER, query: 'spreadsheet' });
    expect(found.map((t) => t.id)).toEqual(['2']);
  });

  it('filters by format, category, origin and favourites', () => {
    expect(filterTemplates(templates, { ...EMPTY_FILTER, format: 'csv' })).toHaveLength(2);
    expect(filterTemplates(templates, { ...EMPTY_FILTER, category: 'executive' })).toHaveLength(1);
    expect(filterTemplates(templates, { ...EMPTY_FILTER, origin: 'custom' })).toHaveLength(1);
    expect(filterTemplates(templates, { ...EMPTY_FILTER, favouritesOnly: true })).toHaveLength(1);
  });

  it('knows when Clear Filters has anything to clear', () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false);
    expect(filterActive({ ...EMPTY_FILTER, query: '  ' })).toBe(false);
    expect(filterActive({ ...EMPTY_FILTER, favouritesOnly: true })).toBe(true);
  });

  it('puts favourites first, then the most used', () => {
    const sorted = sortTemplates([
      template({ id: 'a', name: 'A', usageCount: 9 }),
      template({ id: 'b', name: 'B', usageCount: 1, isFavourite: true }),
      template({ id: 'c', name: 'C', usageCount: 4 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('the figures', () => {
  const templates = [
    template({ id: '1', usageCount: 12, name: 'Monthly Client Report' }),
    template({ id: '2', usageCount: 3, name: 'Task Export' }),
    template({
      id: '3',
      name: 'My Recap',
      isBuiltin: false,
      slug: null,
      createdById: 'u1',
      /* Three weeks old, so it must not count as updated this week. */
      updatedAt: new Date(NOW - 21 * 24 * 3_600_000).toISOString(),
    }),
  ];

  it('names the most-used template rather than counting one', () => {
    const kpis = templateKpis({ templates, reportsGenerated: 7, exportsTaken: 2, nowMs: NOW });
    const most = kpis.find((k) => k.key === 'most-used');
    expect(most?.value).toBe('Monthly Client Report');
    expect(most?.footnote).toBe('used 12 times');
  });

  it('says None yet rather than picking an unused template arbitrarily', () => {
    const kpis = templateKpis({
      templates: [template({ usageCount: 0 })],
      reportsGenerated: 0,
      exportsTaken: 0,
      nowMs: NOW,
    });
    expect(kpis.find((k) => k.key === 'most-used')?.value).toBe('None yet');
  });

  /* ⚠️ THE REFERENCE'S FIFTH CARD IS "AI Summary Blocks 42" AND NOTHING IN THIS
     SYSTEM WRITES ONE. A card counting them would be counting nothing. */
  it('has no card claiming AI-written content', () => {
    const kpis = templateKpis({ templates, reportsGenerated: 7, exportsTaken: 2, nowMs: NOW });
    for (const k of kpis) {
      expect(k.label.toLowerCase()).not.toContain('ai');
    }
    expect(kpis.find((k) => k.key === 'generated')?.value).toBe('7');
  });

  it('counts only templates actually touched this week', () => {
    const kpis = templateKpis({ templates, reportsGenerated: 0, exportsTaken: 0, nowMs: NOW });
    expect(kpis.find((k) => k.key === 'recent')?.value).toBe('2');
  });

  it('reports two export formats, matching what can be written', () => {
    const kpis = templateKpis({ templates, reportsGenerated: 0, exportsTaken: 0, nowMs: NOW });
    expect(kpis.find((k) => k.key === 'formats')?.value).toBe('2');
  });
});

describe('tags', () => {
  it('are facts about the row, so they cannot go stale', () => {
    expect(templateTags(template())).toEqual(['Executive', 'Monthly', 'PDF', 'Built-in']);
    expect(templateTags(template({ engine: 'tasks_csv', kind: null, format: 'csv', isBuiltin: false, createdById: 'u', slug: null })))
      .toEqual(['Executive', 'Any range', 'CSV', 'Custom']);
  });
});

describe('schedules', () => {
  /* ⚠️ STRING ARITHMETIC ON KARACHI DATES. A `Date` built here would sit in the
     server's zone, five hours behind, and for five hours each evening would name
     yesterday — a confusion that has already made a correct answer look wrong. */
  it('advances daily, weekly to a Monday, monthly to the 1st', () => {
    expect(nextRunOn('daily', '2026-09-04')).toBe('2026-09-05');
    expect(nextRunOn('daily', '2026-09-30')).toBe('2026-10-01');
    /* 2026-09-04 is a Friday. */
    expect(nextRunOn('weekly', '2026-09-04')).toBe('2026-09-07');
    /* From a Monday, the next one is a week later, never the same day. */
    expect(nextRunOn('weekly', '2026-09-07')).toBe('2026-09-14');
    expect(nextRunOn('monthly', '2026-09-04')).toBe('2026-10-01');
    expect(nextRunOn('monthly', '2026-12-20')).toBe('2027-01-01');
  });

  it('crosses a leap-year February without losing a day', () => {
    expect(nextRunOn('daily', '2028-02-28')).toBe('2028-02-29');
  });

  /* ⚠️ "OVERDUE" IS A REAL STATE. A schedule past its date that has not run
     means the cron is not reaching the project — which is true on this branch
     today, because it is not deployed. */
  it('reports an overdue schedule rather than calling it Active', () => {
    const s = { isActive: true, nextRunOn: '2026-09-01', lastError: null };
    expect(scheduleState(s, '2026-09-04').label).toBe('Overdue');
    expect(scheduleState({ ...s, nextRunOn: '2026-09-04' }, '2026-09-04').label).toBe('Active');
    expect(scheduleState({ ...s, nextRunOn: '2026-09-05' }, '2026-09-04').label).toBe('Active');
  });

  it('leads with a failure over a due date, and with paused over both', () => {
    expect(scheduleState({ isActive: true, nextRunOn: '2026-09-01', lastError: 'boom' }, '2026-09-04').label)
      .toBe('Failed');
    expect(scheduleState({ isActive: false, nextRunOn: '2026-09-01', lastError: 'boom' }, '2026-09-04').label)
      .toBe('Paused');
  });
});

describe('file size', () => {
  /* An unknown size is a dash. "0 B" is a different claim — a file that is empty. */
  it('distinguishes unknown from empty', () => {
    expect(fileSize(null)).toBe('—');
    expect(fileSize(0)).toBe('0 B');
    expect(fileSize(12_698)).toBe('12.4 KB');
    expect(fileSize(2_500_000)).toBe('2.4 MB');
  });
});
