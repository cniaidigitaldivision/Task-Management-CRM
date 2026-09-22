import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeXml, readXlsx } from '@/lib/view/xlsx-read';

/* ============================================================================
 * A REAL .XLSX, BUILT HERE BYTE BY BYTE
 * ----------------------------------------------------------------------------
 * ⚠️ NOT A FIXTURE FILE AND NOT A MOCK. The zip is assembled the way Excel
 * writes one — local headers, a central directory, deflated entries — so the
 * reader is tested against the format itself rather than against itself.
 * ========================================================================= */

const enc = new TextEncoder();

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nameBytes = enc.encode(name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const SHARED = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Name</t></si>
  <si><t>Phone</t></si>
  <si><t>Company</t></si>
  <si><r><t>Faisal </t></r><r><rPr><b/></rPr><t>Rehman</t></r></si>
  <si><t>AGC &amp; Sons</t></si>
</sst>`;

const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>923001238726</v></c><c r="C2" t="s"><v>4</v></c></row>
  <row r="3"><c r="A3" t="inlineStr"><is><t>Ayesha Noor</t></is></c><c r="C3" t="str"><v>Demo</v></c></row>
  <row r="4"></row>
</sheetData></worksheet>`;

describe('reading an .xlsx', () => {
  it('reads shared strings, rich text, numbers and inline strings, in their columns', async () => {
    const rows = await readXlsx(zip({ 'xl/sharedStrings.xml': SHARED, 'xl/worksheets/sheet1.xml': SHEET }));
    expect(rows).toEqual([
      ['Name', 'Phone', 'Company'],
      ['Faisal Rehman', '923001238726', 'AGC & Sons'],
      /* ⚠️ B3 is missing in the sheet — the column must stay empty, not shift. */
      ['Ayesha Noor', '', 'Demo'],
    ]);
  });

  it('reads a file stored without compression too', async () => {
    const rows = await readXlsx(zip({ 'xl/sharedStrings.xml': SHARED, 'xl/worksheets/sheet1.xml': SHEET }, 0));
    expect(rows[1][0]).toBe('Faisal Rehman');
  });

  it('takes the FIRST sheet, not whichever the zip lists first', async () => {
    const other = SHEET.replace('Ayesha Noor', 'Second sheet');
    const rows = await readXlsx(
      zip({ 'xl/worksheets/sheet2.xml': other, 'xl/sharedStrings.xml': SHARED, 'xl/worksheets/sheet1.xml': SHEET }),
    );
    expect(rows[2][0]).toBe('Ayesha Noor');
  });

  it('⚠️ refuses what is not a spreadsheet, in words', async () => {
    await expect(readXlsx(enc.encode('Name,Phone\nA,1'))).rejects.toThrow(/not a spreadsheet/);
  });

  it('decodes entities, including numeric ones', () => {
    expect(decodeXml('A &amp; B &lt;x&gt; &#8211; &#x2019;')).toBe('A & B <x> – ’');
  });
});
