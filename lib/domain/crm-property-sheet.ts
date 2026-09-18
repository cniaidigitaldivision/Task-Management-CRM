/* ============================================================================
 * A PROPERTY SHEET IS A TABLE OF PLOTS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"when the property sheet is uploaded and it has multiple
 * plots and multiple data on it, then you will add each plot with you in this
 * way."*
 *
 * So one upload becomes many plots. This is the pure half — lines of text in,
 * candidate plots out — because it is the part that has to be right and the part
 * a test can hold. Nothing here reads a file, a database or a clock.
 *
 * ⚠️ A ROW WITHOUT A PLOT CODE IS NOT A PLOT. Sheets carry titles, column
 * headings, totals, footers and phone numbers, and every one of them has digits
 * in it. A row joins the catalogue only when it names a unit; the rest are
 * dropped rather than guessed at, because a made-up plot is a plot somebody will
 * quote.
 *
 * ⚠️ AND A PRICE IS NOT REQUIRED. Plenty of sheets list availability without
 * prices, and refusing those would be refusing the owner's own inventory. A plot
 * with no price is added with none — a price nobody wrote down is not invented.
 * ========================================================================= */

export interface ParsedPlot {
  /** "A-101" — the unit's code, normalised to upper case. */
  readonly code: string;
  readonly block: string | null;
  readonly sizeMarla: number | null;
  /** Rupees. Null when the sheet does not price it. */
  readonly basePrice: number | null;
  /** Corner · Park facing · Main boulevard — whatever the row says. */
  readonly category: string | null;
  /** The line it came from, so somebody can see what was read. */
  readonly source: string;
}

/** More than this in one sheet and something has been misread, not uploaded. */
export const MAX_PLOTS = 300;

/** ⚠️ Anything below this is a size, a road width or a serial number, not a price. */
const MIN_PRICE = 50_000;

const NOISE = /(total|sub\s*total|grand|page \d|contact|phone|cell|whatsapp|email|www\.|@|terms|conditions|signature)/i;

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The plot code.
 *
 * ⚠️ NOT EVERY "A-1" IS A PLOT, AND NOT EVERY PLOT SAYS "PLOT". A labelled code
 * wins; a bare code is accepted only at the start of a row, which is where a
 * table puts it. A code found in the middle of a sentence is prose.
 */
function codeOf(line: string): string | null {
  const labelled = /\b(?:plot|unit|file)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z]{0,2}-?\d{1,4}[A-Z]?)\b/i.exec(line);
  if (labelled) return labelled[1].toUpperCase();
  const leading = /^([A-Z]{1,2}-\d{1,4}[A-Z]?)\b/i.exec(line.trim());
  if (leading) return leading[1].toUpperCase();
  /* A row that starts with a plain number and then names a size — "12 5 Marla
     Block A 4,500,000" — is a table row whose first column is the plot. */
  const numbered = /^(\d{1,4})\s+(?=.*\bmarla\b)/i.exec(line.trim());
  return numbered ? numbered[1] : null;
}

export function parsePlotLine(line: string): ParsedPlot | null {
  const flat = line.replace(/\s+/g, ' ').trim();
  if (flat.length < 4 || NOISE.test(flat)) return null;

  const code = codeOf(flat);
  if (!code) return null;

  const marlaRaw = /(\d+(?:\.\d+)?)\s*marla/i.exec(flat)?.[1];
  const kanalRaw = /(\d+(?:\.\d+)?)\s*kanal/i.exec(flat)?.[1];
  const sizeMarla = marlaRaw
    ? Number(marlaRaw)
    : /* One kanal is twenty marla, and sheets in Chitral use both. */
      kanalRaw
      ? Number(kanalRaw) * 20
      : null;

  const block = /block\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i.exec(flat)?.[1]?.toUpperCase() ?? null;

  /* The price is the largest money-shaped number left once the size and the
     code have been accounted for. A sheet's own "per marla" column is smaller
     than the total, so the largest is the plot's price. */
  const prices = [...flat.matchAll(/(?<![\d.,])((?:\d{1,3}(?:,\d{2,3})+)|\d{5,12})(?![\d.,])/g)]
    .map((m) => toNumber(m[1]))
    .filter((n): n is number => n !== null && n >= MIN_PRICE);
  const basePrice = prices.length > 0 ? Math.max(...prices) : null;

  const traits = [
    /\bcorner\b/i.test(flat) ? 'Corner' : null,
    /\bpark\s*facing\b/i.test(flat) ? 'Park facing' : null,
    /\b(?:main\s*)?boulevard\b/i.test(flat) ? 'Main boulevard' : null,
  ].filter(Boolean) as string[];

  return {
    code,
    block,
    sizeMarla,
    basePrice,
    category: traits.length > 0 ? traits.join(' · ') : null,
    source: flat.slice(0, 200),
  };
}

/**
 * Every plot a sheet names, in the order it names them.
 *
 * ⚠️ DEDUPED ON THE CODE PLUS THE BLOCK. "A-101" in Block A and "A-101" in
 * Block B are two plots in schemes that number per block; the same code twice in
 * the same block is the sheet repeating a header row on page two.
 */
export function parsePropertySheet(lines: readonly string[]): ParsedPlot[] {
  const out: ParsedPlot[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const plot = parsePlotLine(line);
    if (!plot) continue;
    const key = `${plot.code}|${plot.block ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(plot);
    if (out.length >= MAX_PLOTS) break;
  }
  return out;
}

/** What to tell somebody when a sheet yields nothing. */
export function sheetProblem(lines: readonly string[], plots: readonly ParsedPlot[]): string | null {
  if (lines.join('').trim().length < 20) {
    return 'This PDF has no readable text — it looks like a scan or a photograph. Upload the original sheet so the plots can be read from it.';
  }
  if (plots.length === 0) {
    return 'No plots could be read from this sheet. Each row needs a plot or unit number; a sheet of prices alone cannot be added to the catalogue.';
  }
  return null;
}
