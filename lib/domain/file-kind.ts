/* ============================================================================
 * WHAT KIND OF FILE IS THIS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24, of the new project-files tab: *"They can also apply filters
 * on the basis of their file types."*
 *
 * ── ⚠️ WHY THE MIME TYPE ALONE CANNOT ANSWER THIS ────────────────────────────
 * `documents.mime_type` is whatever the BROWSER claimed at upload time, and the
 * browser guesses from the OS file association. On a machine with no association
 * for .pptx it sends `application/octet-stream` — which is how a PowerPoint came
 * to be refused with "Files of this type () are not accepted" (see the note in
 * `requestDocumentAction`). The same unreliability would put half a project's
 * decks under "Other" in a filter.
 *
 * So both are consulted, mime first and the extension second. Neither is
 * authoritative on its own and the extension is the one a person can see.
 *
 * ── WHY THESE SEVEN AND NOT THE FULL MIME TAXONOMY ───────────────────────────
 * A filter is only useful if every option has something behind it. These are the
 * groups an agency's project folder actually contains — a contract, a sheet, a
 * deck, a picture, a cut, a delivery zip — and "Other" is honest about the rest
 * rather than inventing categories nobody filters by.
 * ========================================================================= */

export const FILE_KINDS = [
  'document',
  'spreadsheet',
  'presentation',
  'image',
  'video',
  'audio',
  'archive',
  'other',
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

/** Plural, because every use is a filter chip or a group heading. */
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  document: 'Documents',
  spreadsheet: 'Sheets',
  presentation: 'Decks',
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archives',
  other: 'Other',
};

const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
  odt: 'document',
  pages: 'document',

  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  ods: 'spreadsheet',
  numbers: 'spreadsheet',

  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  key: 'presentation',

  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
  heic: 'image',
  tif: 'image',
  tiff: 'image',
  psd: 'image',
  ai: 'image',
  eps: 'image',

  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  m4v: 'video',

  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',

  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

/** The extension, lowercased, or null. Not a `split('.').pop()`: that returns the
 *  whole name for a file with no dot, which would then be looked up as if it were
 *  an extension. */
export function extensionOf(name: string): string | null {
  return /\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? null;
}

/**
 * The group this file belongs in.
 *
 * ⚠️ THE EXTENSION IS CHECKED FIRST for the Office formats and last for
 * everything else, and that ordering is deliberate rather than arbitrary: the
 * `application/*` mime types are exactly where the browser's guess is worst
 * (`octet-stream` for anything it does not recognise), while `image/*`, `video/*`
 * and `audio/*` are reliable because the browser can tell from the bytes.
 */
export function fileKind(mimeType: string | null, name: string): FileKind {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  const extension = extensionOf(name);

  /* The extension wins wherever we recognise it — see the note above. */
  if (extension && BY_EXTENSION[extension]) return BY_EXTENSION[extension];

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation';
  if (mime.includes('word') || mime.includes('opendocument.text')) return 'document';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
    return 'archive';
  }

  return 'other';
}
