import { describe, expect, it } from 'vitest';

import { readXlsx } from '@/lib/view/xlsx-read';
import { writeXlsx } from '@/lib/view/xlsx-write';

/* ============================================================================
 * THE EXCEL EXPORT, READ BACK
 * ----------------------------------------------------------------------------
 * ⚠️ WRITTEN, THEN READ WITH THE IMPORTER. The reader was tested against a file
 * built byte by byte the way Excel builds one; the writer is tested by what the
 * reader gets back — so an export can always be imported again.
 * ========================================================================= */

describe('writing an .xlsx', () => {
  const bytes = writeXlsx({
    name: 'Clients',
    header: ['Client number', 'Name', 'Booked value (PKR)', 'Notes'],
    rows: [
      ['CLI-01042', 'Faisal Rehman', 4_500_000, 'Wants a corner plot'],
      ['CLI-01043', 'Ayesha Noor', 0, null],
      ['CLI-01044', '=HYPERLINK("x")', 850_000, 'AGC & Sons <quoted>'],
    ],
    widths: [13, 24, 17, 30],
  });

  it('is a zip Excel will open, starting with a local file header', () => {
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('reads back exactly what went in', async () => {
    const rows = await readXlsx(bytes);
    expect(rows[0]).toEqual(['Client number', 'Name', 'Booked value (PKR)', 'Notes']);
    expect(rows[1]).toEqual(['CLI-01042', 'Faisal Rehman', '4500000', 'Wants a corner plot']);
    /* An empty cell stays empty, and does not shift the ones after it. */
    expect(rows[2]).toEqual(['CLI-01043', 'Ayesha Noor', '0']);
  });

  it('⚠️ writes a leading "=" as the words, never as a formula', async () => {
    const rows = await readXlsx(bytes);
    expect(rows[3][1]).toBe('=HYPERLINK("x")');
    const xml = new TextDecoder().decode(bytes);
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('t="inlineStr"');
  });

  it('escapes what XML would otherwise read as markup', async () => {
    const rows = await readXlsx(bytes);
    expect(rows[3][3]).toBe('AGC & Sons <quoted>');
  });

  it('keeps money as numbers, so the sheet can be added up', () => {
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain('<v>4500000</v>');
  });

  it('freezes and filters the header row', () => {
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('<autoFilter ref="A1:D4"/>');
  });
});
