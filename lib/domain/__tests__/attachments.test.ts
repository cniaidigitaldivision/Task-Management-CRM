import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  extensionOf,
  formatBytes,
  kindOf,
  safeFileName,
  storagePath,
  validateUpload,
} from '../attachments';

/* ============================================================================
 * ATTACHMENTS — FR-029
 * ----------------------------------------------------------------------------
 * The filename cases are the security ones. That string is used in a download
 * header and shown next to a colleague's name, and both of those are places
 * where an unexpected character does more than look wrong.
 * ========================================================================= */

const ok = {
  fileName: 'brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
};

describe('validateUpload — size', () => {
  it('accepts an ordinary file', () => {
    expect(validateUpload(ok).ok).toBe(true);
  });

  it('accepts exactly the limit', () => {
    expect(validateUpload({ ...ok, sizeBytes: MAX_ATTACHMENT_BYTES }).ok).toBe(true);
  });

  it('refuses one byte over, and says what to do instead', () => {
    const result = validateUpload({ ...ok, sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('paste the link');
  });

  it('refuses an empty file', () => {
    /* Almost always a failed export or a drag that landed wrong. Storing it
       means somebody downloads nothing later and blames the system. */
    const result = validateUpload({ ...ok, sizeBytes: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('empty');
  });

  it('refuses a negative size', () => {
    expect(validateUpload({ ...ok, sizeBytes: -1 }).ok).toBe(false);
  });
});

describe('validateUpload — type', () => {
  it('accepts every type on the allow-list', () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(validateUpload({ ...ok, fileName: 'thing.bin', mimeType }).ok, mimeType).toBe(true);
    }
  });

  it('refuses a type that is not on it', () => {
    /* ⚠️ `''` WAS IN THIS LIST AND WAS DELIBERATELY REMOVED, 2026-08-24. An empty
       type used to be a refusal on its own; it is now a refusal only when the
       extension is also unrecognised. The reason is the PowerPoint report at the
       foot of this file — an absent `file.type` is the browser saying "I don't
       know", not the file saying "I am not allowed", and treating the two the
       same was refusing ordinary Office documents.

       The informative types below are unchanged: a type that says something and
       is not on the list is still refused, whatever the extension claims. */
    for (const mimeType of ['video/mp4', 'application/x-msdownload', 'audio/mpeg']) {
      expect(validateUpload({ ...ok, mimeType }).ok, mimeType).toBe(false);
    }
  });

  it('an empty type on an UNRECOGNISED extension is still refused', () => {
    /* The other half of that change, so the pair reads as one rule rather than
       as a hole. */
    expect(validateUpload({ ...ok, fileName: 'thing.iso', mimeType: '' }).ok).toBe(false);
    expect(validateUpload({ ...ok, fileName: 'noextension', mimeType: '' }).ok).toBe(false);
  });

  it('refuses an executable extension even when the type looks respectable', () => {
    /* THE CASE THIS EXISTS FOR. `file.type` is what the browser reads from the
       operating system's extension registry — it is a claim, not an
       inspection. Rename payload.exe to payload.pdf and Chrome reports
       application/pdf perfectly sincerely. */
    const result = validateUpload({
      fileName: 'invoice.pdf.exe',
      mimeType: 'application/pdf',
      sizeBytes: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('.exe');
  });

  it('refuses the whole family of executables and scripts', () => {
    for (const extension of ['exe', 'msi', 'bat', 'cmd', 'sh', 'ps1', 'js', 'vbs', 'jar', 'apk']) {
      const result = validateUpload({
        fileName: `thing.${extension}`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      expect(result.ok, extension).toBe(false);
    }
  });

  it('is not fooled by an upper-case extension', () => {
    expect(
      validateUpload({ fileName: 'thing.EXE', mimeType: 'application/pdf', sizeBytes: 100 }).ok,
    ).toBe(false);
  });
});

describe('validateUpload — name', () => {
  it('refuses a blank name', () => {
    expect(validateUpload({ ...ok, fileName: '   ' }).ok).toBe(false);
  });

  it('refuses an absurdly long one', () => {
    expect(validateUpload({ ...ok, fileName: `${'a'.repeat(300)}.pdf` }).ok).toBe(false);
  });
});

describe('safeFileName', () => {
  it('leaves an ordinary name alone', () => {
    expect(safeFileName('Q3 report (final).pdf')).toBe('Q3 report (final).pdf');
  });

  it('strips path separators rather than the segments around them', () => {
    /* `a-b.pdf`, not `ab.pdf`. Silently joining the two halves produces a name
       that looks deliberate and is not what anybody typed. */
    expect(safeFileName('folder/brief.pdf')).toBe('folder-brief.pdf');
    expect(safeFileName('folder\\brief.pdf')).toBe('folder-brief.pdf');
  });

  it('defuses traversal', () => {
    expect(safeFileName('../../etc/passwd')).not.toContain('..');
    expect(safeFileName('../../etc/passwd')).not.toContain('/');
  });

  it('collapses a run of dots, which also unmasks a hidden extension', () => {
    expect(safeFileName('report..exe')).toBe('report.exe');
  });

  it('removes quotes and backticks', () => {
    /* The name is echoed in a Content-Disposition header. A quote in the middle
       of one ends the filename token early and everything after it is read as
       header syntax. */
    expect(safeFileName('say "hello".pdf')).toBe('say hello.pdf');
    expect(safeFileName("it's here.pdf")).toBe('its here.pdf');
  });

  it('removes control characters, including a newline', () => {
    const injected = safeFileName('brief.pdf\r\nX-Injected: yes');
    expect(injected).not.toContain('\n');
    expect(injected).not.toContain('\r');
    expect(injected).toContain('brief.pdf');
  });

  it('does not start with a dot or a dash', () => {
    /* A leading dot hides the file on Unix; a leading dash is read as a flag by
       any command-line tool the file is later handed to. */
    expect(safeFileName('.hidden')).toBe('hidden');
    expect(safeFileName('--rf.pdf')).toBe('rf.pdf');
  });

  it('collapses runs of whitespace', () => {
    expect(safeFileName('a    b.pdf')).toBe('a b.pdf');
  });

  it('never returns an empty string', () => {
    /* An empty name would produce a storage path ending in a slash, and a
       download with no filename at all. */
    for (const raw of ['', '   ', '...', '///', '"""']) {
      expect(safeFileName(raw), JSON.stringify(raw)).toBeTruthy();
    }
  });

  it('truncates without losing the whole name', () => {
    const long = safeFileName(`${'x'.repeat(400)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.startsWith('x')).toBe(true);
  });
});

describe('storagePath', () => {
  const taskId = '11111111-1111-1111-1111-111111111111';
  const attachmentId = '22222222-2222-2222-2222-222222222222';

  it('is built from ids, never from the name somebody typed', () => {
    /* Two people attaching brief.pdf to the same task must not overwrite each
       other, and no name-derived path can be traversable if there is no name
       in it. */
    const path = storagePath(taskId, attachmentId, 'brief.pdf');
    expect(path).toBe(`tasks/${taskId}/${attachmentId}.pdf`);
    expect(path).not.toContain('brief');
  });

  it('gives two files with the same name different paths', () => {
    const a = storagePath(taskId, '33333333-3333-3333-3333-333333333333', 'brief.pdf');
    const b = storagePath(taskId, '44444444-4444-4444-4444-444444444444', 'brief.pdf');
    expect(a).not.toBe(b);
  });

  it('copes with no extension', () => {
    expect(storagePath(taskId, attachmentId, 'README')).toBe(`tasks/${taskId}/${attachmentId}`);
  });

  it('cannot escape its task folder even from a hostile name', () => {
    const path = storagePath(taskId, attachmentId, '../../../etc/passwd');
    expect(path.startsWith(`tasks/${taskId}/`)).toBe(true);
    expect(path).not.toContain('..');
  });
});

describe('extensionOf', () => {
  it('reads the last one', () => {
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('lower-cases it', () => {
    expect(extensionOf('IMAGE.PNG')).toBe('png');
  });

  it('is empty when there is none', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });
});

describe('formatBytes', () => {
  it('reads the way somebody says it', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
    expect(formatBytes(26_214_400)).toBe('25 MB');
  });

  it('gives a dash rather than NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('kindOf', () => {
  it('reads the mime type when there is one', () => {
    expect(kindOf('image/png', 'x')).toBe('image');
    expect(kindOf('application/pdf', 'x')).toBe('pdf');
    expect(kindOf('text/csv', 'x')).toBe('spreadsheet');
    expect(kindOf('application/zip', 'x')).toBe('archive');
    expect(kindOf('text/plain', 'x')).toBe('text');
  });

  it('falls back to the extension rather than calling everything a document', () => {
    /* An attachment list where every icon is identical is a list of file names
       with decoration on it. */
    expect(kindOf(null, 'photo.jpg')).toBe('image');
    expect(kindOf(null, 'sheet.xlsx')).toBe('spreadsheet');
    expect(kindOf('', 'notes.md')).toBe('text');
    expect(kindOf(null, 'bundle.zip')).toBe('archive');
  });

  it('has a sensible last resort', () => {
    expect(kindOf(null, 'mystery')).toBe('document');
  });
});

/* ============================================================================
 * A POWERPOINT WITH NO MIME TYPE — owner report, 2026-08-24
 * ----------------------------------------------------------------------------
 * *"When I try to upload a PowerPoint file, it is not accepting it."*
 *
 * `file.type` is the operating system's guess from the extension, not a reading
 * of the file, and for Office formats it is routinely absent — no Office install,
 * a file out of a zip, a network share, a phone download. The allow-list had both
 * PowerPoint types in it and never got to compare them, because the browser had
 * supplied nothing to compare.
 * ========================================================================= */

describe('a file whose type the browser could not determine', () => {
  const nameOnly = (fileName: string, mimeType = '') =>
    validateUpload({ fileName, mimeType, sizeBytes: 4096 });

  it('accepts a .pptx reported with no type at all', () => {
    expect(nameOnly('Q3 pitch.pptx').ok).toBe(true);
  });

  it('accepts a .pptx reported as application/octet-stream', () => {
    /* What Windows reports with no Office association — the exact case. */
    expect(nameOnly('Q3 pitch.pptx', 'application/octet-stream').ok).toBe(true);
  });

  it('accepts the older .ppt the same way', () => {
    expect(nameOnly('deck.ppt').ok).toBe(true);
  });

  it('accepts .docx and .xlsx too, for the same reason', () => {
    expect(nameOnly('brief.docx').ok).toBe(true);
    expect(nameOnly('budget.xlsx', 'application/octet-stream').ok).toBe(true);
  });

  it('still refuses an unlisted extension with no type', () => {
    /* The fallback is an allow-list, not a bypass. */
    const result = nameOnly('archive.iso');
    expect(result.ok).toBe(false);
  });

  it('⚠️ still refuses an executable, whatever it claims to be', () => {
    /* The security property this must not cost. `FORBIDDEN_EXTENSIONS` runs
       first and on the extension, so a respectable-looking type cannot buy an
       .exe past it — and neither can an absent one. */
    expect(validateUpload({ fileName: 'setup.exe', mimeType: '', sizeBytes: 4096 }).ok).toBe(false);
    expect(
      validateUpload({ fileName: 'setup.exe', mimeType: 'application/pdf', sizeBytes: 4096 }).ok,
    ).toBe(false);
    expect(
      validateUpload({ fileName: 'run.bat', mimeType: 'application/octet-stream', sizeBytes: 4096 })
        .ok,
    ).toBe(false);
  });

  it('names the extension in the refusal when there is no type to name', () => {
    /* "That kind of file is not something this system stores" told somebody
       holding a rejected file nothing about what was wrong with it. */
    const result = nameOnly('disk.iso');
    expect(result.ok === false && result.message).toContain('.iso');
  });

  it('a real MIME type is still honoured over the extension', () => {
    /* The extension is a fallback, never an override: an informative type that
       is not on the list is still a refusal. */
    const result = validateUpload({
      fileName: 'thing.pdf',
      mimeType: 'application/x-msdownload',
      sizeBytes: 4096,
    });
    expect(result.ok).toBe(false);
  });
});
