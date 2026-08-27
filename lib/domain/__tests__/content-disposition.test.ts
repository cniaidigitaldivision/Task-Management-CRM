import { describe, expect, it } from 'vitest';

import {
  asciiFallback,
  contentDisposition,
  nameWithExtension,
} from '../content-disposition';

/* ============================================================================
 * THE HEADER THAT WAS THROWING
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: the Company Library files "open in a new tab but that's not
 * opening actually". The cause was `Headers.set` refusing a header value with a
 * character above U+00FF, and the em dash in four of the five library titles.
 *
 * ⚠️ THE MOST IMPORTANT TEST IN HERE IS `does not throw`, and it asserts against a
 * REAL `Headers` object rather than against a regex. A unit test that only checked
 * the string's shape would have passed on the broken code too — the old code
 * produced a perfectly well-formed string and died on the way into the header.
 * ========================================================================= */

/** The five real titles, from `public.library_documents` on 2026-08-24. */
const REAL_TITLES = [
  'Package Card — front & back',
  'Package Details — part 1 of 2 (pages 1–16)',
  'Package Details — part 2 of 2 (pages 17–31)',
  'Corporate Profile & Service Booklet',
  'Full Package Deck',
] as const;

describe('the bug: a header value must be a ByteString', () => {
  it.each(REAL_TITLES)('sets cleanly on a real Headers object: %s', (title) => {
    /* ⚠️ THIS IS THE REGRESSION. `new Headers().set` is what threw in production —
       so the test does the same thing rather than inspecting a string. */
    const headers = new Headers();
    expect(() =>
      headers.set('Content-Disposition', contentDisposition(title, true)),
    ).not.toThrow();
  });

  it('reproduces the original failure, so the cause stays documented', () => {
    /* The exact line that shipped. Kept as a test because "an em dash cannot go in
       a header" is the kind of fact that gets re-learned expensively. */
    const naive = `inline; filename="${'Package Details — part 1'}"`;
    expect(() => new Headers().set('Content-Disposition', naive)).toThrow(TypeError);
  });

  it('holds for scripts with no Latin characters at all', () => {
    for (const name of ['محاسبات.pdf', '報告書.pdf', 'Отчёт.pdf', '📊 deck.pdf']) {
      const headers = new Headers();
      expect(() =>
        headers.set('Content-Disposition', contentDisposition(name, false)),
      ).not.toThrow();
    }
  });
});

describe('the ASCII fallback', () => {
  it('turns an em dash into a hyphen rather than a placeholder', () => {
    expect(asciiFallback('Package Details — part 1')).toBe('Package Details - part 1');
  });

  it('keeps a curly apostrophe readable', () => {
    /* Without the transliteration table this would be `Client-s brief`, which
       reads as corruption rather than as a converted character. */
    expect(asciiFallback('Client’s brief')).toBe("Client's brief");
  });

  it('drops curly double quotes instead of converting them', () => {
    /* ⚠️ A straight `"` is what closes the quoted-string this value sits inside,
       so converting to one would break the header it is meant to make safe. */
    const out = asciiFallback('The “final” deck');
    expect(out).not.toContain('"');
    expect(out).toBe('The final deck');
  });

  it('removes the characters that would be header injection', () => {
    const out = asciiFallback('evil"\r\nX-Injected: yes');
    expect(out).not.toMatch(/[\r\n"]/);
  });

  it('collapses a run of unrepresentable characters to one dash', () => {
    /* A row of dashes as long as the original filename is noise, not a name. */
    expect(asciiFallback('報告書 2026')).toBe('- 2026');
  });

  it('falls back to "download" when nothing legible survives', () => {
    /* ⚠️ NOT an empty filename="": some browsers then save the file as the URL's
       last path segment, which on these routes is a UUID. */
    expect(asciiFallback('報告書')).toBe('download');
    expect(asciiFallback('   ')).toBe('download');
    expect(asciiFallback('')).toBe('download');
  });

  it('strips zero-width characters, which survive a naive trim', () => {
    expect(asciiFallback('deck​‍.pdf')).toBe('deck.pdf');
  });
});

describe('the header value', () => {
  it('carries both an ASCII filename and the exact UTF-8 one', () => {
    const value = contentDisposition('Package Details — part 1.pdf', true);
    expect(value).toContain('inline;');
    expect(value).toContain('filename="Package Details - part 1.pdf"');
    /* %E2%80%94 is the em dash. A browser that understands filename* shows the
       real character; one that does not gets the hyphen above. */
    expect(value).toContain("filename*=UTF-8''Package%20Details%20%E2%80%94%20part%201.pdf");
  });

  it('says attachment when asked to download', () => {
    expect(contentDisposition('x.pdf', false).startsWith('attachment;')).toBe(true);
    expect(contentDisposition('x.pdf', true).startsWith('inline;')).toBe(true);
  });

  it('percent-encodes the quote that would end the ext-value early', () => {
    /* `encodeURIComponent` leaves ' ( ) ! * alone and RFC 5987 does not permit
       them raw. The apostrophe is the dangerous one — it is the delimiter. */
    const value = contentDisposition("Client's brief.pdf", true);
    const star = value.slice(value.indexOf("filename*=UTF-8''") + "filename*=UTF-8''".length);
    expect(star).not.toContain("'");
    expect(star).toContain('%27');
  });

  it('round-trips through decodeURIComponent to the original name', () => {
    for (const name of [...REAL_TITLES, 'محاسبات.pdf', "Client's — brief (v2).pdf"]) {
      const value = contentDisposition(name, true);
      const star = value.slice(value.indexOf("filename*=UTF-8''") + "filename*=UTF-8''".length);
      expect(decodeURIComponent(star)).toBe(name);
    }
  });
});

describe('the extension, which was the second bug in that line', () => {
  it('takes the suffix from the stored path, not from an assumption', () => {
    /* The route appended `.pdf` unconditionally. A design source is download-only
       BECAUSE no browser renders it, and it arrived named `.pdf`. */
    expect(
      nameWithExtension('Logo Suite', 'brand/2026/logo-suite.ai', 'application/postscript'),
    ).toBe('Logo Suite.ai');
  });

  it('gets the real library rows right', () => {
    expect(
      nameWithExtension(
        'Package Card — front & back',
        'packages/2026/package-card-front-back.pdf',
        'application/pdf',
      ),
    ).toBe('Package Card — front & back.pdf');
  });

  it('does not double an extension the title already carries', () => {
    /* "Rate Card.pdf.pdf" is the kind of detail that makes software look
       careless, and titles typed with an extension are common. */
    expect(nameWithExtension('Rate Card.pdf', 'library/rate-card.pdf', 'application/pdf')).toBe(
      'Rate Card.pdf',
    );
    expect(nameWithExtension('Rate Card.PDF', 'library/rate-card.pdf', null)).toBe('Rate Card.PDF');
  });

  it('falls back to a KNOWN mime type when the path has no suffix', () => {
    expect(nameWithExtension('Deck', 'library/deck-no-extension', 'application/pdf')).toBe(
      'Deck.pdf',
    );
  });

  it('adds nothing rather than guessing when neither says', () => {
    /* ⚠️ Better a name with no extension than one that is wrong — a wrong
       extension makes the file fail to open, which is the bug being fixed. */
    expect(nameWithExtension('Mystery', 'library/mystery', null)).toBe('Mystery');
    expect(nameWithExtension('Mystery', 'library/mystery', 'image/x-fictional')).toBe('Mystery');
  });

  it('never invents an extension out of a mime subtype', () => {
    /* ⚠️ THE REASON `MIME_EXTENSION` IS A LIST AND NOT A REGEX. Reading the part
       after the slash gives `.octet-stream`, `.plain`, and forty characters of
       `vnd.openxmlformats-…` for an Office file. All three are filenames that
       fail to open. */
    expect(nameWithExtension('Mystery', 'library/mystery', 'application/octet-stream')).toBe(
      'Mystery',
    );
    expect(nameWithExtension('Notes', 'library/notes', 'text/plain; charset=utf-8')).toBe(
      'Notes.txt',
    );
    expect(
      nameWithExtension(
        'Pitch',
        'library/pitch',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('Pitch.pptx');
  });
});
