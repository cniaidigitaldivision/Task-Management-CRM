/* ============================================================================
 * A PAGE IN TWO COLUMNS IS NOT A PAGE IN ONE
 * ----------------------------------------------------------------------------
 * `readPdfLines` groups text fragments by baseline — same `y`, same row — then
 * sorts them left to right. That is right for a table and catastrophic for a
 * two-column document, because the left column's line and the right column's
 * line sit on the SAME baseline. They come out spliced:
 *
 *     "Capture leads from website forms, landing pages, Apply configurable
 *      qualification questions and lead"
 *
 * Two half-sentences from two different thoughts, joined into one that reads
 * almost plausibly. Measured on the owner's own `CRM Purposal.pdf`, 2026-09-20:
 * the knowledge extractor drew ten answers from it and **nine were rejected**
 * because their quotes could not be found in the source — the quotes were real
 * sentences and the SOURCE was the scrambled text.
 *
 * ⚠️ THIS IS THE FAILURE MODE THAT DOES NOT ANNOUNCE ITSELF. A PDF that cannot
 * be opened raises. A PDF read in the wrong order returns confident nonsense,
 * and every layer downstream — the quotation reader, the knowledge base, the
 * agent quoting a document to a client — treats it as fact.
 *
 * So: find the gutter, read one column at a time.
 * ========================================================================= */

/** One positioned run of text, as pdfjs hands it over. */
export interface Fragment {
  /** Left edge, in PDF points from the left of the page. */
  readonly x: number;
  /** Baseline, in points from the BOTTOM of the page — so larger is higher. */
  readonly y: number;
  /** Width of this run. */
  readonly w: number;
  readonly str: string;
}

/** How far apart two baselines may be and still count as one row, in points. */
const SAME_ROW = 2.5;

/**
 * The x of a vertical gutter running down the page, or null for one column.
 *
 * ⚠️ A GUTTER IS A STRIP NO TEXT CROSSES, not merely a wide space in some rows.
 * A centred heading, a full-width footer or a table's own column gaps would all
 * look like a gutter in a single row — so a candidate only counts if text sits
 * on BOTH sides of it across many rows, and nothing spans it at all.
 */
export function findGutter(fragments: readonly Fragment[], pageWidth: number): number | null {
  if (fragments.length < 20 || pageWidth <= 0) return null;

  /* Only the middle of the page can be a gutter. A "gutter" at 8% is a margin. */
  const from = pageWidth * 0.3;
  const to = pageWidth * 0.7;
  const step = Math.max(2, pageWidth / 200);

  let best: { x: number; width: number; rows: number } | null = null;

  /* ⚠️ A FEW THINGS MAY CROSS, AND ON A REAL PAGE SOMETHING ALWAYS DOES. The
     first version of this demanded that NOTHING span the gutter, and it found
     none on the owner's proposal: measured at x=283 there were 27 fragments
     left, 29 right, and exactly ONE crossing — the section heading. One heading
     is not evidence against two columns; it is what two columns look like.
     `linesFromFragments` then reads the spanning ones in place. */
  const mayCross = Math.max(2, Math.round(fragments.length * 0.05));

  for (let x = from; x <= to; x += step) {
    const crossing = fragments.filter((f) => f.x < x && f.x + f.w > x).length;
    if (crossing > mayCross) continue;

    const left = fragments.filter((f) => f.x + f.w <= x);
    const right = fragments.filter((f) => f.x >= x);
    if (left.length < fragments.length * 0.2 || right.length < fragments.length * 0.2) continue;

    /* ⚠️ AND BOTH SIDES MUST BE OCCUPIED AT THE SAME HEIGHTS. Two stacked blocks
       — a full-width heading above a full-width paragraph — would otherwise
       split at any x that happens to fall between two words. */
    const rowsBoth = new Set(
      left.map((f) => Math.round(f.y / 5)).filter((band) =>
        right.some((r) => Math.round(r.y / 5) === band)),
    ).size;
    if (rowsBoth < 5) continue;

    /* How wide is the empty strip around this x? */
    const gapLeft = Math.max(...left.map((f) => f.x + f.w));
    const gapRight = Math.min(...right.map((f) => f.x));
    const width = gapRight - gapLeft;
    if (width < pageWidth * 0.02) continue;

    if (!best || rowsBoth > best.rows || (rowsBoth === best.rows && width > best.width)) {
      best = { x, width, rows: rowsBoth };
    }
  }

  return best ? best.x : null;
}

/** Fragments in one column, top to bottom, joined into lines. */
function linesOf(fragments: readonly Fragment[]): string[] {
  const rows: Array<{ y: number; items: Fragment[] }> = [];
  for (const f of fragments) {
    if (f.str.trim() === '') continue;
    const row = rows.find((r) => Math.abs(r.y - f.y) <= SAME_ROW);
    if (row) row.items.push(f);
    else rows.push({ y: f.y, items: [f] });
  }

  /* Down the page, then across it — the order somebody reads in. */
  rows.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const text = row.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * One page's fragments as readable lines, in columns if the page has them.
 *
 * ⚠️ THE WHOLE LEFT COLUMN, THEN THE WHOLE RIGHT ONE — never interleaved. A
 * sentence that runs down one column must stay contiguous, because everything
 * downstream quotes sentences.
 */
export function linesFromFragments(fragments: readonly Fragment[], pageWidth: number): string[] {
  const gutter = findGutter(fragments, pageWidth);
  if (gutter === null) return linesOf(fragments);

  /* ⚠️ A FULL-WIDTH BAND BELONGS TO NEITHER COLUMN. A heading or a footer that
     spans the page would be torn in half by a column split, so anything
     crossing the gutter is read on its own, in place. */
  const spanning = fragments.filter((f) => f.x < gutter && f.x + f.w > gutter);
  const left = fragments.filter((f) => f.x + f.w <= gutter);
  const right = fragments.filter((f) => f.x >= gutter);

  return [...linesOf(spanning), ...linesOf(left), ...linesOf(right)];
}
