import { describe, expect, it } from 'vitest';

import {
  FILE_KINDS,
  FILE_KIND_LABEL,
  extensionOf,
  fileKind,
  type FileKind,
} from '../file-kind';

/* ============================================================================
 * WHAT KIND OF FILE IS THIS
 * ----------------------------------------------------------------------------
 * The filter on the new Project files tab depends on this, and so does which icon
 * a row gets. The interesting cases are all the same case: `documents.mime_type`
 * is whatever the BROWSER claimed at upload, and the browser guesses from the OS
 * file association. On a machine with no association for .pptx it sends
 * `application/octet-stream` — which is the real incident that produced "Files of
 * this type () are not accepted".
 * ========================================================================= */

describe('the unreliable-mime cases, which are the reason this exists', () => {
  it('classifies a PowerPoint the browser called octet-stream', () => {
    /* ⚠️ THE REAL INCIDENT. A deck would otherwise land under "Other", where
       nobody filtering for decks would find it. */
    expect(fileKind('application/octet-stream', 'Q3 pitch.pptx')).toBe('presentation');
  });

  it('classifies a spreadsheet with no mime type at all', () => {
    expect(fileKind(null, 'budget.xlsx')).toBe('spreadsheet');
    expect(fileKind('', 'budget.xlsx')).toBe('spreadsheet');
  });

  it('trusts the extension over a mime type that disagrees', () => {
    /* The extension is the half a person can see, and the half the OS acts on. */
    expect(fileKind('application/octet-stream', 'contract.pdf')).toBe('document');
    expect(fileKind('text/plain', 'footage.mp4')).toBe('video');
  });

  it('still uses the mime type when the name has no extension', () => {
    /* Reliable for these three: the browser reads them from the bytes. */
    expect(fileKind('image/png', 'pasted-screenshot')).toBe('image');
    expect(fileKind('video/mp4', 'export')).toBe('video');
    expect(fileKind('application/pdf', 'scan')).toBe('document');
  });

  it('falls back to other rather than guessing', () => {
    expect(fileKind(null, 'mystery')).toBe('other');
    expect(fileKind('application/x-fictional', 'thing.qqq')).toBe('other');
  });
});

describe('the groups an agency folder actually holds', () => {
  const cases: ReadonlyArray<[string, FileKind]> = [
    ['signed-contract.pdf', 'document'],
    ['brief.docx', 'document'],
    ['notes.txt', 'document'],
    ['budget.csv', 'spreadsheet'],
    ['plan.xlsx', 'spreadsheet'],
    ['deck.pptx', 'presentation'],
    ['deck.key', 'presentation'],
    ['logo.png', 'image'],
    ['shot.JPEG', 'image'],
    ['artwork.ai', 'image'],
    ['reel.mov', 'video'],
    ['cut.webm', 'video'],
    ['voiceover.mp3', 'audio'],
    ['delivery.zip', 'archive'],
    ['delivery.7z', 'archive'],
  ];

  for (const [name, expected] of cases) {
    it(`${name} is a ${expected}`, () => {
      expect(fileKind(null, name)).toBe(expected);
    });
  }

  it('is case-insensitive about the extension', () => {
    /* Windows and macOS both hand back mixed case, and a client's file is as
       likely to be `.PDF` as `.pdf`. */
    expect(fileKind(null, 'CONTRACT.PDF')).toBe('document');
    expect(fileKind(null, 'Reel.MOV')).toBe('video');
  });

  it('reads a design source as an image, which is where a designer looks', () => {
    /* ⚠️ Debatable and deliberate: .ai and .psd are not viewable in a browser, but
       somebody filtering for the artwork on a project is filtering for pictures,
       not for "Other". `is_viewable` on the library table is what decides whether a
       preview is offered; this only decides which group it files under. */
    expect(fileKind(null, 'brand.psd')).toBe('image');
    expect(fileKind('application/postscript', 'logo.eps')).toBe('image');
  });
});

describe('reading the extension', () => {
  it('returns null for a name with no dot, rather than the whole name', () => {
    /* ⚠️ A `split('.').pop()` returns "mystery" here, which would then be looked
       up in the extension table as if it were an extension. */
    expect(extensionOf('mystery')).toBeNull();
  });

  it('takes only the last segment, and lowercases it', () => {
    expect(extensionOf('archive.tar.GZ')).toBe('gz');
    expect(extensionOf('My Report.Final.pdf')).toBe('pdf');
  });

  it('ignores a trailing dot and surrounding space', () => {
    expect(extensionOf('name.')).toBeNull();
    expect(extensionOf('  report.pdf  ')).toBe('pdf');
  });

  it('refuses an implausibly long suffix', () => {
    /* Guards against reading the tail of a name that merely contains dots —
       "v1.2.something-very-long" is not an extension. */
    expect(extensionOf('file.superlongextension')).toBeNull();
  });
});

describe('the vocabulary', () => {
  it('labels every kind, so a filter option is never blank', () => {
    for (const kind of FILE_KINDS) {
      expect(FILE_KIND_LABEL[kind]).toBeTruthy();
    }
  });

  it('ends on "other", so it is the last filter option offered', () => {
    /* The panel builds its dropdown by filtering FILE_KINDS in order. A catch-all
       in the middle of the list reads as a category. */
    expect(FILE_KINDS[FILE_KINDS.length - 1]).toBe('other');
  });
});
