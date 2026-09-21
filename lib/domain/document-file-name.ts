/* ============================================================================
 * THE NAME A CLIENT SEES ON A FILE WE SEND
 * ----------------------------------------------------------------------------
 * A document is stored with a title ("CRM Proposal"), not a file name. Sent as
 * it is, it arrives on a phone as a file nothing will open. Given ".pdf" blindly,
 * a Word file arrives as a PDF that will not open either.
 *
 * Used by the drawer's Attach and send and by the AI agent, so the same file
 * has the same name whoever sends it.
 * ========================================================================= */

const EXTENSION: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export function sendableFileName(title: string, mime: string): string {
  const name = title.trim() || 'Document';
  const ext = EXTENSION[mime.split(';')[0].trim().toLowerCase()] ?? '';
  if (!ext) return name;
  /* ".jpeg" is a JPEG already — do not make it "photo.jpeg.jpg". */
  const has = name.toLowerCase().endsWith(ext) || (ext === '.jpg' && name.toLowerCase().endsWith('.jpeg'));
  return has ? name : `${name}${ext}`;
}
