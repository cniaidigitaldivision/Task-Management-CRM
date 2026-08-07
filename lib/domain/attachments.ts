/* ============================================================================
 * ATTACHMENTS — FR-029, doc 04 §6
 * ----------------------------------------------------------------------------
 * The rules about a file, with no filesystem, no network and no Supabase in
 * sight. What may be uploaded, what it will be called, and where it will live.
 *
 * ── THE LIMITS ARE STATED IN THREE PLACES, ON PURPOSE ────────────────────────
 * Here, on the bucket, and in the upload form's `accept` attribute. That is not
 * duplication for its own sake — each one fails differently and only the middle
 * one is a guarantee:
 *
 *   the form   is a convenience; it stops the file picker offering a .exe and
 *              is trivially bypassed by anybody who wants to
 *   this file  produces a sentence somebody can act on, before a byte moves
 *   the bucket is the actual enforcement, and it answers a bare HTTP 413 that
 *              nobody can interpret
 *
 * Deleting the first two would leave the third, which works and is horrible.
 * ========================================================================= */

/** 25 MB. Matches `file_size_limit` on the bucket exactly — see the header. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * What may be attached, by MIME type.
 *
 * ── WHY THERE IS A LIST AT ALL ───────────────────────────────────────────────
 * An attachment carries an implicit endorsement: it arrived through the company
 * system, attached to a real task, from a colleague's account. People open
 * those. A CRM that will happily store and hand back a .exe is a convenient
 * delivery mechanism for one, and the person downloading it has every reason to
 * trust it.
 *
 * Executables, scripts and installers are absent deliberately. So is anything
 * not named — the list is an allow-list, not a block-list, because a block-list
 * is a promise to have thought of every extension that will ever exist.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
  'application/x-zip-compressed',
]);

/** For the file picker's `accept`. Extensions, because that is what it wants. */
export const ACCEPT_ATTRIBUTE =
  '.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.zip';

/** Extensions that must never be stored, whatever the browser claims the type is. */
const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'jar',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'cjs',
  'jse', 'wsf', 'wsh', 'hta', 'reg', 'dll', 'so', 'dylib', 'app', 'deb',
  'rpm', 'apk', 'dmg', 'pkg',
]);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 1 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export type Check = { readonly ok: true } | { readonly ok: false; readonly message: string };

const ok: Check = { ok: true };
const no = (message: string): Check => ({ ok: false, message });

export function validateUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Check {
  const name = input.fileName.trim();
  if (!name) return no('That file has no name.');
  if (name.length > 255) return no('That file name is too long — rename it and try again.');

  if (input.sizeBytes <= 0) {
    /* A zero-byte file is almost always a failed export or a drag that landed
       wrong. Storing it means somebody downloads nothing later and wonders
       whether the system lost it. */
    return no('That file is empty. Check it exported properly.');
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return no(
      `${formatBytes(input.sizeBytes)} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit. Put large files in shared storage and paste the link in a comment.`,
    );
  }

  /* ── THE EXTENSION IS CHECKED SEPARATELY FROM THE TYPE ─────────────────────
     `file.type` comes from the browser, which reads it from the operating
     system's registry of extensions. It is a claim, not an inspection —
     renaming `payload.exe` to `payload.pdf` makes the browser report
     application/pdf quite sincerely. So the extension is checked too, and a
     forbidden one is refused no matter how respectable the type looks. */
  const extension = extensionOf(name);
  if (FORBIDDEN_EXTENSIONS.has(extension)) {
    return no(
      `.${extension} files cannot be attached. A file arriving through this system looks trustworthy to whoever downloads it, which is exactly why executables are not allowed.`,
    );
  }

  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    return no(
      `${input.mimeType || 'That kind of file'} is not something this system stores. Images, PDFs, Office documents, text and zip archives are.`,
    );
  }

  return ok;
}

/* ==========================================================================
 * NAMING AND PATHS
 * ========================================================================== */

/**
 * A file name safe to store and safe to send back in a download header.
 *
 * Path separators, `..`, control characters and quotes all go. The last two
 * matter more than they look: the name is echoed in a `Content-Disposition`
 * header, and a quote or a newline in the middle of one is header injection.
 */
export function safeFileName(raw: string): string {
  /* Control characters are filtered by code point rather than matched by a
     regex class. A class containing literal control bytes does not survive a
     copy-paste, a diff viewer, or an editor that trims whitespace — the
     characters are invisible, so nothing shows when one goes missing. */
  const printable = [...raw.normalize('NFKC')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const cleaned = printable
    /* Path separators become a dash rather than being dropped, so `a/b.pdf`
       reads as `a-b.pdf` and not the misleading `ab.pdf`. */
    .replace(/[\\/]/g, '-')
    /* Any run of dots collapses to one. `..` is the traversal token, and it is
       also how somebody hides `report..exe` from a careless eye. */
    .replace(/\.{2,}/g, '.')
    /* Quotes and backticks: the name is echoed in a Content-Disposition header
       on download, and a quote in the middle of one ends the filename token
       early — everything after it is read as header syntax. */
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.-]+/, '');

  return cleaned.slice(0, 200) || 'file';
}

/**
 * Where the object lives in the bucket.
 *
 * ── THE PATH IS NOT THE FILE NAME, AND THAT IS DELIBERATE ────────────────────
 * `tasks/<taskId>/<attachmentId>.<ext>`. The name somebody typed is stored in
 * the database and restored on download, and never used as a path segment.
 *
 * Three reasons. Two people attaching `brief.pdf` to the same task must not
 * overwrite each other. A name that survives sanitisation can still collide
 * with another after sanitisation. And any name-derived path is one bug away
 * from being traversable, whereas a uuid cannot be anything but a uuid.
 */
export function storagePath(taskId: string, attachmentId: string, fileName: string): string {
  const extension = extensionOf(fileName);
  return extension
    ? `tasks/${taskId}/${attachmentId}.${extension}`
    : `tasks/${taskId}/${attachmentId}`;
}

/* ==========================================================================
 * PRESENTATION
 * ========================================================================== */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'archive' | 'text';

/** Which icon to draw. Grouped by what somebody expects to happen on a click. */
export function kindOf(mimeType: string | null, fileName: string): AttachmentKind {
  const type = mimeType ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.includes('spreadsheet') || type === 'text/csv' || type.includes('ms-excel')) {
    return 'spreadsheet';
  }
  if (type.includes('zip')) return 'archive';
  if (type.startsWith('text/')) return 'text';
  if (type.includes('word') || type.includes('presentation')) return 'document';

  /* No usable type — fall back to the extension rather than calling everything
     a document. An attachment list where every icon is identical is a list of
     file names with decoration. */
  const extension = extensionOf(fileName);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'spreadsheet';
  if (extension === 'zip') return 'archive';
  if (['txt', 'md'].includes(extension)) return 'text';
  return 'document';
}

/**
 * How long a download link lasts.
 *
 * Long enough to click it, open the file, and come back to it after a meeting.
 * Short enough that a link pasted into a group chat is useless by the time
 * anybody outside the team reads it — which is the entire point of the bucket
 * being private rather than public.
 */
export const SIGNED_URL_SECONDS = 60 * 60;
