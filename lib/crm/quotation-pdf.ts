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
  /**
   * Whether the document is quoting a PROPERTY at all.
   *
   * ⚠️ THE BUSINESS SELLS TWO DIFFERENT THINGS. This rule was written when
   * every quotation was a plot in Chitral, and it demanded a Marla, block or
   * plot from every PDF. Then the owner tried to file their own
   * `CNI_AJ_Trading_Quotation.pdf` — a CRM package for a towel manufacturer —
   * and was told the document was "not showing the property", which it never
   * could. `crm_quotations.property_id` has always been nullable; only this
   * check insisted.
   *
   * So a document that talks about Marla, Kanal, plots or blocks must still
   * produce one. A document that plainly is not selling land is not asked to.
   */
  readonly quotesProperty: boolean;
  /** True when the page shows a discount or a subtotal — see `extractQuotationFacts`. */
  readonly discounted: boolean;
  /** How much text the file carried, so "no text at all" can be said plainly. */
  readonly textLength: number;
}

/** Everything the three rules need. Empty when the PDF has it all. */
export function missingFrom(facts: QuotationFacts): string[] {
  const missing: string[] = [];
  if (facts.amount === null) missing.push('a price');
  /* ⚠️ ONLY OF A DOCUMENT THAT IS SELLING LAND — see `quotesProperty`. */
  if (facts.quotesProperty && facts.marla === null && !facts.block && !facts.plot) {
    missing.push('the property (Marla, block or plot)');
  }
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
     "Total", "Net" or "Quotation amount" is.

     ⚠️ AND THE *LAST* LABEL WINS, BECAUSE A PRICE IS NEGOTIATED DOWN THE PAGE.
     Measured on the owner's own `CNI_AJ_Trading_Quotation.pdf`, which reads:

         SPECIAL PACKAGE PRICE   Total solution value   PKR 255,000
         Special discount (30%)                       - PKR  76,500
         FINAL QUOTED PRICE                             PKR 178,500

     The old rule found no label it knew and fell back to the largest figure:
     **255,000, a price 43% higher than the document quotes**, written onto a
     client's record as fact. "Final quoted price" and "payable" are now labels,
     and the one nearest the bottom is the one that counts. */
  const LABEL =
    /(?:final\s*(?:quoted\s*)?(?:price|amount)|quotation\s*amount|net\s*(?:amount|payable|price)|amount\s*payable|total\s*payable|grand\s*total|total\s*(?:amount|price)?)\s*[:\-]?\s*(?:PKR|Rs\.?)?\s*([\d][\d,\s]{3,})/gi;
  const labelled = [...flat.matchAll(LABEL)]
    .map((m) => toAmount(m[1]))
    .filter((n): n is number => n !== null);

  /* A page that subtracts something has a figure on it that is NOT the price. */
  const discounted = /\b(?:discount|less|subtotal|sub-total|before\s*discount|solution\s*value)\b/i.test(flat);

  let amount = labelled.length > 0 ? labelled[labelled.length - 1] : null;
  if (amount === null && !discounted) {
    const all = [...flat.matchAll(/(?:PKR|Rs\.?)\s*([\d][\d,\s]{3,})/gi)]
      .map((m) => toAmount(m[1]))
      .filter((n): n is number => n !== null);
    amount = all.length > 0 ? Math.max(...all) : null;
  }
  /* ⚠️ AND WHEN A DISCOUNTED PAGE NAMES NO TOTAL, THIS REFUSES RATHER THAN
     GUESSES. The largest figure there is the pre-discount one by construction,
     so the fallback is not merely unreliable — it is reliably wrong. Better to
     tell somebody the document does not state its price. */

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

  /* Does this document sell land at all? The words a property quotation cannot
     avoid using, so a CRM package is not asked for a plot number. */
  const quotesProperty = /\b(?:marla|kanal|plot|block|sq\.?\s*(?:ft|yd)|square\s*(?:feet|yards))\b/i.test(flat);

  return { number, amount, marla, block, plot, validUntil, quotesProperty, discounted, textLength: flat.length };
}
