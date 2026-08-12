import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadCsv, downloadXlsxFromBase64 } from '../download';

/* ============================================================================
 * SAVING A FILE — the UTF-8 BOM
 * ----------------------------------------------------------------------------
 * A regression test for a bug that got all the way to a downloaded file.
 *
 * `lib/domain/csv.ts` prepends U+FEFF and has a unit test proving it. That test
 * passed the whole time the shipped files had no BOM, because the character is
 * **stripped when a server action serialises its result** — so the string
 * reaching the browser began at the first column heading, and Excel on Windows
 * read every accented name as the system codepage.
 *
 * The lesson is in what the old test could not see: it checked the function, not
 * the file. These tests assert on the bytes of the blob that actually gets saved.
 * ========================================================================= */

const created: Blob[] = [];
let lastDownloadName: string | null = null;

beforeEach(() => {
  created.length = 0;
  lastDownloadName = null;

  /* jsdom is not configured for this project, so the two DOM APIs used are stood
     up directly. That keeps the test about the bytes rather than about a DOM. */
  const anchor = {
    href: '',
    set download(value: string) {
      lastDownloadName = value;
    },
    click: () => undefined,
    remove: () => undefined,
  };

  vi.stubGlobal('document', {
    createElement: () => anchor,
    body: { append: () => undefined },
  });

  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return 'blob:test';
    },
    revokeObjectURL: () => undefined,
  });

  vi.stubGlobal('atob', (base64: string) => Buffer.from(base64, 'base64').toString('binary'));
});

async function bytesOfSavedFile(): Promise<Uint8Array> {
  expect(created, 'nothing was saved').toHaveLength(1);
  return new Uint8Array(await created[0].arrayBuffer());
}

describe('downloadCsv', () => {
  it('writes the UTF-8 BOM as bytes, even when the string has none', () => {
    /* The real case: the server sent a BOM, the transport removed it, and the
       browser must put it back. EF BB BF, then the content. */
    downloadCsv('report.csv', 'Reference,Task\r\nCNI-001,A task\r\n');

    return bytesOfSavedFile().then((bytes) => {
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      expect(String.fromCharCode(bytes[3], bytes[4], bytes[5])).toBe('Ref');
    });
  });

  it('does not double the BOM when the string still carries one', async () => {
    /* Two byte-order marks show as a stray "ï»¿" in the first cell — exactly the
       mangling this exists to prevent, arrived at from the other direction. */
    downloadCsv('report.csv', '﻿Reference,Task\r\n');
    const bytes = await bytesOfSavedFile();

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    /* Byte 3 must be 'R', not another EF. */
    expect(bytes[3]).toBe('R'.charCodeAt(0));
  });

  it('keeps non-ASCII characters intact, which is the whole point', async () => {
    /* An en dash and an accented name: the two things that arrive broken without
       a BOM, and the reason the comment in csv.ts calls it "not superstition". */
    downloadCsv('report.csv', 'Task\r\nABC Traders — Ayesha Siddiqüi\r\n');
    const bytes = await bytesOfSavedFile();
    const text = Buffer.from(bytes.slice(3)).toString('utf8');

    expect(text).toContain('—');
    expect(text).toContain('Siddiqüi');
  });

  it('passes the file name through to the download attribute', () => {
    downloadCsv('cni-completion-2026-08-01-to-2026-08-31.csv', 'a\r\n');
    expect(lastDownloadName).toBe('cni-completion-2026-08-01-to-2026-08-31.csv');
  });

  it('names the type so the browser and the operating system agree', async () => {
    downloadCsv('report.csv', 'a\r\n');
    expect(created[0].type).toBe('text/csv;charset=utf-8');
  });
});

describe('downloadXlsxFromBase64', () => {
  it('turns base64 back into the exact bytes, BOM-free', async () => {
    /* A .xlsx is a zip. It must NOT gain a BOM — three stray bytes in front of
       "PK" and no spreadsheet application will open it. */
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    downloadXlsxFromBase64('report.xlsx', zip.toString('base64'));

    const bytes = await bytesOfSavedFile();
    expect(Buffer.from(bytes).equals(zip)).toBe(true);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
  });

  it('declares the spreadsheet MIME type', () => {
    downloadXlsxFromBase64('report.xlsx', Buffer.from('PK').toString('base64'));
    expect(created[0].type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('survives bytes above 0x7f without corrupting them', async () => {
    /* `charCodeAt` on a binary string is the step where a naive implementation
       mangles high bytes into replacement characters. */
    const raw = Buffer.from([0x50, 0x4b, 0xff, 0xfe, 0x80, 0x00, 0x7f]);
    downloadXlsxFromBase64('report.xlsx', raw.toString('base64'));

    const bytes = await bytesOfSavedFile();
    expect([...bytes]).toEqual([...raw]);
  });
});
