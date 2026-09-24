/**
 * Handing a file to the browser.
 *
 * ⚠️ ONE IMPLEMENTATION, because the object URL has to be revoked. An anchor
 * built inline and forgotten holds its blob in memory for the life of the tab;
 * that is fine once and a leak on a page somebody exports from repeatedly.
 *
 * ⚠️ NOTHING HERE WRITES A FILE FORMAT. CSV in particular is built server-side
 * by `lib/domain/csv.ts`, which neutralises the leading `=`, `+`, `-` and `@`
 * that a spreadsheet executes as a formula. A second CSV writer living in the
 * browser is a second one to forget that guard in.
 */
export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file a server action built, arriving as base64. */
export function downloadBase64(name: string, base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  downloadBlob(name, bytes, type);
}
