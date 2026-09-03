import { describe, expect, it } from 'vitest';

import {
  LIBRARY_ACCEPT,
  LIBRARY_MAX_BYTES,
  isLibraryViewable,
  validateLibraryUpload,
} from '../library';

/* ============================================================================
 * WHAT THE COMPANY LIBRARY ACCEPTS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03, with a .pptx in hand: *"I want to add PowerPoint files and
 * it is not letting me upload… all text, PowerPoint, PDF, Word, Excel, any file
 * that I want to keep it in a safer place."*
 *
 * ── ⚠️ THE DRIFT THIS FILE EXISTS TO CATCH ──────────────────────────────────
 * Three things have to agree or an upload fails in a way nobody can act on:
 *
 *   the `cni-library` bucket   the real enforcement; disagreeing gives a 415
 *                              AFTER the person has chosen their file
 *   LIBRARY_MIME / _EXTENSIONS the sentence-shaped refusal
 *   LIBRARY_ACCEPT             what the file picker even offers
 *
 * The bucket cannot be reached from a unit test, so its allow-list is pinned
 * below as a literal. That is not a duplicate for its own sake: it turns "these
 * two lists silently drifted" into a failing assertion naming the type.
 * ========================================================================= */

/** The `cni-library` bucket's `allowed_mime_types`, as at 2026-09-03. */
const BUCKET_ALLOW_LIST = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'application/postscript',
  'application/illustrator',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/rtf',
] as const;

const ok = (over: Partial<Parameters<typeof validateLibraryUpload>[0]> = {}) =>
  validateLibraryUpload({
    fileName: 'deck.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sizeBytes: 2_400_000,
    ...over,
  });

describe('the file the owner could not upload', () => {
  it('accepts a PowerPoint the browser identified', () => {
    expect(ok()).toEqual({ ok: true });
  });

  /* ⚠️ THE ACTUAL FAILURE MODE, and the reason the extension list is not merely
     belt and braces. A browser reads `File.type` from the OPERATING SYSTEM's
     registry, so a .pptx off a machine with no Office install — or out of a zip,
     or from a phone — arrives with no type at all. */
  it('accepts a PowerPoint whose type the machine could not name', () => {
    expect(ok({ mimeType: '' })).toEqual({ ok: true });
    expect(ok({ mimeType: 'application/octet-stream' })).toEqual({ ok: true });
  });

  it('accepts the owner’s actual file name, spaces and brackets included', () => {
    expect(ok({ fileName: 'Taskly_Final_AutoPlay_Working (2).pptx', mimeType: '' })).toEqual({
      ok: true,
    });
  });

  it('accepts Word, Excel, text and the rest the owner named', () => {
    for (const name of ['brief.docx', 'costs.xlsx', 'notes.txt', 'rates.csv', 'readme.md']) {
      expect(validateLibraryUpload({ fileName: name, mimeType: '', sizeBytes: 1000 }), name).toEqual(
        { ok: true },
      );
    }
  });
});

describe('the three lists agree', () => {
  it('accepts every type the storage bucket accepts', () => {
    for (const mimeType of BUCKET_ALLOW_LIST) {
      expect(
        validateLibraryUpload({ fileName: 'file.bin', mimeType, sizeBytes: 1000 }),
        `the bucket accepts ${mimeType} and the validator does not — a file the form refuses that storage would have taken`,
      ).toEqual({ ok: true });
    }
  });

  /* The other direction: the picker must not offer an extension the validator
     then refuses, which is a file chooser that leads somebody into a dead end. */
  it('accepts every extension the file picker offers', () => {
    for (const entry of LIBRARY_ACCEPT.split(',')) {
      const extension = entry.trim().replace(/^\./, '');
      expect(
        validateLibraryUpload({
          fileName: `file.${extension}`,
          /* Empty on purpose: `accept` filters by extension, so this is exactly
             what the picker hands back for a type the OS cannot name. */
          mimeType: '',
          sizeBytes: 1000,
        }),
        `the picker offers .${extension} and the validator refuses it`,
      ).toEqual({ ok: true });
    }
  });
});

describe('what is still refused', () => {
  it('refuses an executable however it is labelled', () => {
    expect(validateLibraryUpload({ fileName: 'setup.exe', mimeType: '', sizeBytes: 1000 }).ok).toBe(
      false,
    );
  });

  it('refuses an empty file, which is a failed export', () => {
    expect(ok({ sizeBytes: 0 }).ok).toBe(false);
  });

  it('refuses one over the bucket’s own size limit', () => {
    expect(ok({ sizeBytes: LIBRARY_MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('names the type in the refusal rather than saying no', () => {
    const refusal = validateLibraryUpload({
      fileName: 'setup.exe',
      mimeType: '',
      sizeBytes: 1000,
    });
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.message).toContain('.exe');
      /* The message must list what CAN go in, or it tells somebody they are
         wrong without telling them what would be right. */
      expect(refusal.message).toContain('PowerPoint');
    }
  });
});

describe('what a browser is allowed to render inline', () => {
  /* ⚠️ Office files are downloads, not views. No browser renders a .pptx, and
     claiming otherwise would offer an "open in a tab" that opens nothing. */
  it('does not offer to display Office documents', () => {
    for (const name of ['deck.pptx', 'brief.docx', 'costs.xlsx']) {
      expect(isLibraryViewable('', name), name).toBe(false);
    }
  });

  it('still refuses to display SVG inline', () => {
    /* Unchanged and load-bearing: an SVG can carry script, and this route serves
       from the application's own origin with the reader's cookie attached.
       Inline, an uploaded SVG is stored XSS with same-origin reach. */
    expect(isLibraryViewable('image/svg+xml', 'logo.svg')).toBe(false);
  });

  it('still displays PDFs and photographs', () => {
    expect(isLibraryViewable('application/pdf', 'rate-card.pdf')).toBe(true);
    expect(isLibraryViewable('', 'shot.jpg')).toBe(true);
  });
});
