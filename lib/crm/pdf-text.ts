import 'server-only';

/* ============================================================================
 * READING THE TEXT OUT OF A PDF
 * ----------------------------------------------------------------------------
 * One place, because two features now need it: a quotation (three facts) and a
 * property sheet (a table of plots).
 *
 * ⚠️ A PDF HAS NO LINES, AND THAT IS THE WHOLE PROBLEM. `getTextContent` returns
 * positioned fragments in draw order, so joining them with spaces turns a price
 * table into one long sentence where "A-101" and the price four columns away are
 * neighbours. Every row of a property sheet would read as a different plot.
 *
 * So the fragments are grouped by where they sit on the page: same baseline (the
 * `y` of the text matrix) means same row, then sorted left to right. That is what
 * makes "A-101 Block A 5 Marla 4,500,000" one line a regex can trust.
 *
 * ⚠️ TEXT ONLY, AND A SCAN IS NOT TEXT. A photographed page carries no text
 * layer; this returns nothing for it, and the caller has to say so plainly rather
 * than blaming the file for something else.
 * ========================================================================= */

/** How far apart two baselines may be and still count as the same row, in points. */
const SAME_ROW = 2.5;

export async function readPdfLines(bytes: Uint8Array, maxPages = 10): Promise<string[]> {
  /* ⚠️ THE LEGACY BUILD, imported here rather than at the top of the module.
     pdfjs pulls in a worker and canvas shims; loading it only when somebody
     uploads a file keeps it out of every other request this server serves. */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  /* ⚠️ `GlobalWorkerOptions` IS LEFT ALONE, AND THAT IS DELIBERATE. In Node the
     legacy build sets up its own in-process fake worker. Setting `workerSrc = ''`
     to "turn the worker off" does the opposite — pdfjs then tries to load a
     worker from an empty URL and throws
     `Setting up fake worker failed: "No "GlobalWorkerOptions.workerSrc"
     specified."`, which a catch around this would have reported as an unreadable
     PDF. Proved against a real file before this shipped. */
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  const lines: string[] = [];
  const pages = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    const rows: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const row = rows.find((r) => Math.abs(r.y - y) <= SAME_ROW);
      if (row) row.items.push({ x, str: item.str });
      else rows.push({ y, items: [{ x, str: item.str }] });
    }

    /* Down the page, then across it — the order somebody reads in. */
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const text = row.items
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) lines.push(text);
    }
    await page.cleanup();
  }
  await doc.destroy();
  return lines;
}

/** The same text as one blob, for the facts that are not tabular. */
export async function readPdfText(bytes: Uint8Array, maxPages = 10): Promise<string> {
  return (await readPdfLines(bytes, maxPages)).join('\n');
}
