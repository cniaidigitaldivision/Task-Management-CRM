import 'server-only';

import { type Fragment, linesFromFragments } from './pdf-columns';

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

export async function readPdfLines(bytes: Uint8Array, maxPages = 10): Promise<string[]> {
  /* THE LEGACY BUILD, imported here rather than at the top of the module.
     pdfjs pulls in a worker and canvas shims; loading it only when somebody
     uploads a file keeps it out of every other request this server serves.

     `pdfjs-dist` is in `serverExternalPackages` (next.config.ts) because
     Turbopack otherwise bundles it away from its own worker file. */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  /* `GlobalWorkerOptions` IS LEFT ALONE, AND THAT IS DELIBERATE. In Node the
     legacy build sets up its own in-process fake worker. Setting `workerSrc = ''`
     to "turn the worker off" does the opposite. */
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
    const pageWidth = page.getViewport({ scale: 1 }).width;

    const fragments: Fragment[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      fragments.push({
        x: item.transform[4] as number,
        y: item.transform[5] as number,
        /* pdfjs gives a run's width directly; without it a gutter cannot be
           found, because a fragment's right edge is unknown. */
        w: typeof item.width === 'number' ? item.width : 0,
        str: item.str,
      });
    }

    lines.push(...linesFromFragments(fragments, pageWidth));
    await page.cleanup();
  }
  await doc.destroy();
  return lines;
}

/** The same text as one blob, for the facts that are not tabular. */
export async function readPdfText(bytes: Uint8Array, maxPages = 10): Promise<string> {
  return (await readPdfLines(bytes, maxPages)).join('\n');
}
