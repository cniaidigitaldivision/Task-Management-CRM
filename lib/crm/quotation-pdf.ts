import 'server-only';

import { readPdfText } from './pdf-text';

export { readPdfText };

/* ============================================================================
 * READING AN UPLOADED QUOTATION PDF
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"after uploading that quotation… read that PDF and get the
 * quotation name… read the property, Marla, block, or any property of the
 * quotation which is mentioned in that file. Read that plus its amount. If you
 * don't get these things from the quotation, you will show a message that the PDF
 * is not showing this information. You can't add them to an available quotation."*
 *
 * So this reads the text a PDF carries and pulls out three things: the quotation
 * number, the unit, and the amount. What it cannot find, it reports missing —
 * ⚠️ AND NOTHING IS GUESSED. A quotation row invented from a PDF nobody could
 * read would put a price on a client's record that no document supports.
 *
 * ⚠️ TEXT ONLY, AND A SCAN IS NOT TEXT. A photographed or scanned quotation
 * carries no text layer; `readPdfText` returns nothing for it and the caller says
 * so rather than pretending the file was unreadable for some other reason.
 * ========================================================================= */

export interface QuotationFacts {
  readonly number: string | null;
  readonly amount: number | null;
  /** "5" from "5 Marla". */
  readonly marla: number | null;
  /** "A" from "Block A". */
  readonly block: string | null;
  /** "A-101" — a plot or unit code. */
  readonly plot: string | null;
  readonly validUntil: string | null;
  /** How much text the file carried, so "no text at all" can be said plainly. */
  readonly textLength: number;
}

/** Everything the three rules need. Empty when the PDF has it all. */
export function missingFrom(facts: QuotationFacts): string[] {
  const missing: string[] = [];
  if (!facts.number) missing.push('a quotation number');
  if (facts.amount === null) missing.push('an amount');
  if (facts.marla === null && !facts.block && !facts.plot) missing.push('the property (Marla, block or plot)');
  return missing;
}

/** Digits with commas or spaces in them, as money is written. */
function toAmount(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractQuotationFacts(text: string): QuotationFacts {
  const flat = text.replace(/\s+/g, ' ').trim();

  /* ── The number ────────────────────────────────────────────────────────────
     Our own quotations are QT-1042. A quotation from elsewhere may say
     "Quotation No: 2026/114", so that shape is read too. */
  const number =
    /\b(QT[-\s]?\d{3,6})\b/i.exec(flat)?.[1]?.replace(/\s/g, '-').toUpperCase() ??
    /quotation\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9/\-]{3,20})/i.exec(flat)?.[1]?.toUpperCase() ??
    null;

  /* ── The amount ────────────────────────────────────────────────────────────
     ⚠️ A LABELLED TOTAL BEATS THE BIGGEST NUMBER ON THE PAGE. A payment plan is
     full of figures, and the largest of them is not always the price — but
     "Total", "Net" or "Quotation amount" is. Only when no label is found does
     this fall back to the largest money-shaped number. */
  const labelled =
    /(?:quotation\s*amount|net\s*(?:amount|payable)|grand\s*total|total\s*(?:amount|price)?)\s*[:\-]?\s*(?:PKR|Rs\.?)?\s*([\d][\d,\s]{3,})/i.exec(flat)?.[1];
  let amount = labelled ? toAmount(labelled) : null;
  if (amount === null) {
    const all = [...flat.matchAll(/(?:PKR|Rs\.?)\s*([\d][\d,\s]{3,})/gi)]
      .map((m) => toAmount(m[1]))
      .filter((n): n is number => n !== null);
    amount = all.length > 0 ? Math.max(...all) : null;
  }

  const marlaRaw = /(\d+(?:\.\d+)?)\s*marla/i.exec(flat)?.[1];
  const marla = marlaRaw ? Number(marlaRaw) : null;
  const block = /block\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i.exec(flat)?.[1]?.toUpperCase() ?? null;
  /* ⚠️ THE QUOTATION'S OWN NUMBER IS NOT A PLOT, and "QT-2051" has exactly the
     shape of one. Unlabelled, the number was being read as the unit — so a
     quotation that names no property passed the three-facts check on the strength
     of its own reference. A labelled "Plot A-101" is trusted; a bare code is not
     when it is the number, or carries a document prefix. */
  const DOC_PREFIX = /^(?:QT|INV|BK|REF|DOC)$/;
  const labelledPlot = /\b(?:plot|unit)\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Z]{0,2}-?\d{1,4}[A-Z]?)\b/i
    .exec(flat)?.[1]
    ?.toUpperCase();
  const barePlot = [...flat.matchAll(/\b([A-Z]{1,2})-(\d{2,4})\b/g)]
    .map((m) => ({ prefix: m[1].toUpperCase(), code: `${m[1]}-${m[2]}`.toUpperCase() }))
    .find((c) => !DOC_PREFIX.test(c.prefix) && c.code !== number)?.code;
  const plot = labelledPlot ?? barePlot ?? null;

  /* "Valid until 30 Sep 2026" / "valid till 30-09-2026" */
  const validRaw = /valid\s*(?:until|till|upto|up to)\s*[:\-]?\s*([0-9]{1,2}[\s\-/][A-Za-z0-9]{3,9}[\s\-/][0-9]{2,4})/i.exec(flat)?.[1];
  let validUntil: string | null = null;
  if (validRaw) {
    const parsed = Date.parse(validRaw.replace(/[-/]/g, ' '));
    if (!Number.isNaN(parsed)) {
      /* ⚠️ THE DAY THE DOCUMENT SAYS, NOT THE UTC DAY. `Date.parse('30 Oct 2026')`
         is local midnight, and `toISOString()` in Karachi (+05:00) then hands back
         the 29th — a quotation expiring a day earlier than it says on the paper.
         The parts are read back in the same zone they were parsed in. */
      const d = new Date(parsed);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      validUntil = `${d.getFullYear()}-${mm}-${dd}`;
    }
  }

  return { number, amount, marla, block, plot, validUntil, textLength: flat.length };
}
