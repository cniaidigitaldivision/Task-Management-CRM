/* ============================================================================
 * SAVING A FILE FROM THE BROWSER
 * ----------------------------------------------------------------------------
 * Shared by every export. Files are built on the server and saved from a blob
 * rather than fetched from a download route: a route would need its own
 * authorisation check, and a second place deciding who may read what is a second
 * place to get it wrong. The action already runs as the caller with RLS live.
 *
 * ── ⚠️ THE UTF-8 BOM CANNOT SURVIVE A SERVER ACTION ──────────────────────────
 * Found 2026-08-12 by reading the bytes of a downloaded file rather than trusting
 * the code. `lib/domain/csv.ts` prepends U+FEFF, and carries a careful comment
 * explaining why: without it, Excel on Windows reads a CSV as the system codepage
 * and every accented name and en dash arrives mangled.
 *
 * That BOM was **being stripped in transit**. A server action serialises its
 * result, and a leading U+FEFF does not come back — the string reaching the
 * browser began at "Reference". Measured three ways: `Blob` preserves the
 * character when it is present, the unit test on `toCsv` passes, and the string
 * arriving in the browser had `charCodeAt(0) === 82`.
 *
 * So the BOM is written **here, as bytes**, where nothing can strip it. Which
 * also means the protection applies to the CSV export that already existed and
 * had silently never had it.
 * ========================================================================= */

/** `EF BB BF` — the UTF-8 byte-order mark, as bytes rather than a character. */
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Hand a blob to the browser as a download.
 *
 * `revokeObjectURL` matters more than it looks: without it every export holds its
 * blob for the life of the tab, and somebody exporting repeatedly through an
 * afternoon leaks all of them.
 */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Save CSV text, with the byte-order mark applied here.
 *
 * A BOM already in the string is not doubled — two would show as a stray `ï»¿`
 * in the first cell, which is precisely the mangling this exists to prevent.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const body = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  save(new Blob([UTF8_BOM, body], { type: 'text/csv;charset=utf-8' }), fileName);
}

/** Save a spreadsheet, which arrives base64 because a server action returns JSON. */
export function downloadXlsxFromBase64(fileName: string, base64: string): void {
  save(
    new Blob([base64ToBytes(base64)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
}

/**
 * base64 → bytes.
 *
 * Typed `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`: a
 * `Uint8Array` may in principle be backed by a `SharedArrayBuffer`, which `Blob`
 * will not accept, and TypeScript is right to insist on the distinction.
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
