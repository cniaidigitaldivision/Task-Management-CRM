import { describe, expect, it } from 'vitest';

import {
  DISPATCH_META,
  INVOICE_KINDS,
  INVOICE_KIND_META,
  LETTERHEAD_FALLBACK,
  MAX_INVOICE_LINES,
  checkInvoice,
  checkInvoiceNo,
  daysUntilDue,
  decodeSignature,
  dispatchOf,
  dueDateFor,
  formatInvoiceNo,
  hasBankDetails,
  lineTotal,
  longDate,
  readLetterhead,
  termsLabel,
  toInvoiceKind,
  totalsFor,
} from '../invoice';

/* ============================================================================
 * INVOICES — the arithmetic a client will read
 * ----------------------------------------------------------------------------
 * These figures leave the building. A wrong one is not a rendering bug, it is a
 * document somebody pays against, so the cases below are the ones that actually
 * produce a wrong number rather than a sweep of the happy path:
 *
 *   · the Karachi date trap, which is the reason `dueDateFor` avoids a local
 *     Date at all — see `karachi-not-utc`
 *   · rounding, where the parts must still add up to the whole
 *   · tax off vs tax at zero, which look the same in JavaScript and print
 *     differently on paper
 *   · a paid invoice past its due date, which must not read as overdue
 *   · a signature `data:` URL that claims to be an SVG
 * ========================================================================= */

describe('the kinds mirror the database enum', () => {
  it('offers the four the owner asked for', () => {
    expect([...INVOICE_KINDS]).toEqual(['retainer', 'add_on', 'one_off', 'advance']);
  });

  it('describes every one of them', () => {
    for (const kind of INVOICE_KINDS) {
      expect(INVOICE_KIND_META[kind].label.length).toBeGreaterThan(0);
      /* The description is what stops somebody filing an add-on as a one-off —
         see the note on INVOICE_KIND_META. */
      expect(INVOICE_KIND_META[kind].description.length).toBeGreaterThan(20);
    }
  });

  it('refuses anything that is not one of them', () => {
    expect(toInvoiceKind('retainer')).toBe('retainer');
    expect(toInvoiceKind('advance')).toBe('advance');
    expect(toInvoiceKind('subscription')).toBeNull();
    expect(toInvoiceKind('')).toBeNull();
    /* A posted field is a claim, and Postgres answers an unknown enum value
       with a message about a type nobody typed. */
    expect(toInvoiceKind('RETAINER')).toBeNull();
  });
});

describe('the invoice number', () => {
  it('pads to four digits and carries the year', () => {
    expect(formatInvoiceNo('CNI', 2026, 1)).toBe('CNI-2026-0001');
    expect(formatInvoiceNo('CNI', 2026, 47)).toBe('CNI-2026-0047');
    expect(formatInvoiceNo('CNI', 2027, 1)).toBe('CNI-2027-0001');
  });

  it('does not truncate a series that outgrows four digits', () => {
    /* Padding is a minimum, never a maximum. An agency issuing 10,000 invoices
       in a year must not start reusing 0000. */
    expect(formatInvoiceNo('CNI', 2026, 10_000)).toBe('CNI-2026-10000');
  });

  it('strips anything that would break a filename', () => {
    expect(formatInvoiceNo('cni/x', 2026, 3)).toBe('CNIX-2026-0003');
    expect(formatInvoiceNo('', 2026, 3)).toBe('INV-2026-0003');
  });

  it('refuses a hand-typed number that would break a header', () => {
    expect(checkInvoiceNo('CNI-2026-0001').ok).toBe(true);
    expect(checkInvoiceNo('GCRE/2026/09').ok).toBe(true);

    expect(checkInvoiceNo('').ok).toBe(false);
    /* The number goes into Content-Disposition and an email subject. */
    expect(checkInvoiceNo('CNI "2026"').ok).toBe(false);
    expect(checkInvoiceNo('CNI\n2026').ok).toBe(false);
    expect(checkInvoiceNo('-leading-dash').ok).toBe(false);
    expect(checkInvoiceNo('x'.repeat(41)).ok).toBe(false);
  });
});

describe('due dates', () => {
  it('adds the terms to the issue date', () => {
    expect(dueDateFor('2026-09-01', 10)).toBe('2026-09-11');
    expect(dueDateFor('2026-09-14', 10)).toBe('2026-09-24');
    expect(dueDateFor('2026-09-01', 30)).toBe('2026-10-01');
  });

  it('rolls over a month and a year', () => {
    expect(dueDateFor('2026-09-28', 10)).toBe('2026-10-08');
    expect(dueDateFor('2026-12-28', 10)).toBe('2027-01-07');
  });

  it('handles February in a leap year', () => {
    expect(dueDateFor('2028-02-25', 10)).toBe('2028-03-06');
  });

  /* ⚠️ THE ONE THIS FUNCTION EXISTS FOR. A local `new Date('2026-09-01')` is
     UTC midnight, which in Karachi is the 31st of August at 7pm — so a naive
     implementation returns the 10th for five hours every evening. `Date.UTC`
     has no timezone to be wrong about. See `karachi-not-utc`. */
  it('is not shifted by the machine timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Karachi';
      expect(dueDateFor('2026-09-01', 10)).toBe('2026-09-11');
      process.env.TZ = 'Pacific/Kiritimati'; // +14
      expect(dueDateFor('2026-09-01', 10)).toBe('2026-09-11');
      process.env.TZ = 'Pacific/Midway'; // -11
      expect(dueDateFor('2026-09-01', 10)).toBe('2026-09-11');
    } finally {
      process.env.TZ = original;
    }
  });

  it('clamps nonsense terms rather than producing a nonsense date', () => {
    expect(dueDateFor('2026-09-01', -5)).toBe('2026-09-01');
    expect(dueDateFor('2026-09-01', Number.NaN)).toBe('2026-09-11');
    expect(dueDateFor('2026-09-01', 9999)).toBe(dueDateFor('2026-09-01', 180));
  });

  it('counts days to the due date, and past it', () => {
    expect(daysUntilDue('2026-09-11', '2026-09-01')).toBe(10);
    expect(daysUntilDue('2026-09-11', '2026-09-11')).toBe(0);
    expect(daysUntilDue('2026-09-11', '2026-09-15')).toBe(-4);
  });

  it('names the terms in words', () => {
    expect(termsLabel(10)).toBe('Net 10 days');
    expect(termsLabel(1)).toBe('Net 1 day');
    expect(termsLabel(0)).toBe('Due on receipt');
  });

  it('prints a date the way the PDF does', () => {
    expect(longDate('2026-09-11')).toBe('11 Sep 2026');
    expect(longDate('2026-01-01')).toBe('1 Jan 2026');
  });
});

describe('totals', () => {
  const line = (description: string, quantity: number, unitPricePkr: number) => ({
    description,
    quantity,
    unitPricePkr,
  });

  it('sums the lines with no tax', () => {
    const totals = totalsFor([line('Social media', 1, 120_000)], null);
    expect(totals).toEqual({
      subtotalPkr: 120_000,
      taxRatePct: null,
      taxPkr: null,
      totalPkr: 120_000,
    });
  });

  it('multiplies quantity by rate', () => {
    const totals = totalsFor(
      [line('Social media', 1, 120_000), line('Extra reels', 3, 15_000)],
      null,
    );
    expect(totals.subtotalPkr).toBe(165_000);
    expect(lineTotal(line('Extra reels', 3, 15_000))).toBe(45_000);
  });

  it('adds the tax line when a rate is given', () => {
    const totals = totalsFor([line('Social media', 1, 120_000)], 16);
    expect(totals.subtotalPkr).toBe(120_000);
    expect(totals.taxRatePct).toBe(16);
    expect(totals.taxPkr).toBe(19_200);
    expect(totals.totalPkr).toBe(139_200);
  });

  /* ⚠️ NULL AND ZERO ARE DIFFERENT DOCUMENTS. Null prints only a total; zero
     prints a "GST @ 0%" row, which invites a question. Both are falsy in
     JavaScript, which is exactly why this is asserted. */
  it('tells "no tax line" apart from "tax at zero percent"', () => {
    expect(totalsFor([line('x', 1, 1000)], null).taxPkr).toBeNull();
    expect(totalsFor([line('x', 1, 1000)], 0).taxPkr).toBe(0);
    expect(totalsFor([line('x', 1, 1000)], 0).taxRatePct).toBe(0);
  });

  /* ⚠️ THE ROUNDING RULE. Migration 076 constrains
     `amount_pkr = subtotal + tax` to within a rupee, so the total must be the
     SUM OF THE ROUNDED PARTS. Rounding the exact total independently is how an
     invoice comes to be refused at insert for being a rupee out. */
  it('keeps the parts adding up to the whole on an awkward subtotal', () => {
    for (const amount of [33_333, 1, 7, 99_999, 12_345, 675, 1_000_001]) {
      const totals = totalsFor([{ description: 'x', quantity: 1, unitPricePkr: amount }], 16);
      expect(totals.subtotalPkr + (totals.taxPkr ?? 0)).toBe(totals.totalPkr);
      expect(Number.isInteger(totals.totalPkr)).toBe(true);
      expect(Number.isInteger(totals.taxPkr)).toBe(true);
    }
  });

  it('rounds a fractional quantity to whole rupees', () => {
    const totals = totalsFor([{ description: 'Half a day', quantity: 0.5, unitPricePkr: 12_345 }], null);
    expect(totals.subtotalPkr).toBe(6_173); // 6172.5 rounds up
    expect(Number.isInteger(totals.subtotalPkr)).toBe(true);
  });

  it('an empty invoice comes to nothing rather than NaN', () => {
    expect(totalsFor([], null).totalPkr).toBe(0);
    expect(totalsFor([], 16).taxPkr).toBe(0);
  });

  it('clamps an impossible tax rate', () => {
    expect(totalsFor([{ description: 'x', quantity: 1, unitPricePkr: 100 }], 500).taxRatePct).toBe(100);
    expect(totalsFor([{ description: 'x', quantity: 1, unitPricePkr: 100 }], -5).taxRatePct).toBe(0);
  });
});

describe('what the form must collect', () => {
  const valid = {
    billedToName: 'GC Royal Emporium',
    billedToEmail: 'accounts@gcroyal.com',
    lines: [{ description: 'Social media — Sep 2026', quantity: 1, unitPricePkr: 120_000 }],
    issuedOn: '2026-09-01',
    dueOn: '2026-09-11',
    taxRatePct: null as number | null,
  };

  it('accepts a complete invoice', () => {
    expect(checkInvoice(valid).ok).toBe(true);
  });

  it('needs somebody to bill', () => {
    expect(checkInvoice({ ...valid, billedToName: '   ' }).ok).toBe(false);
  });

  /* ⚠️ The address is required at CREATION, not at sending. Discovering there
     is nobody to send to AFTER the number has been claimed and the PDF drawn is
     the wrong moment to find out. */
  it('needs a deliverable address before the number is claimed', () => {
    expect(checkInvoice({ ...valid, billedToEmail: '' }).ok).toBe(false);
    expect(checkInvoice({ ...valid, billedToEmail: 'not-an-address' }).ok).toBe(false);
    expect(checkInvoice({ ...valid, billedToEmail: 'two@@at.com' }).ok).toBe(false);
  });

  it('needs at least one line that says something', () => {
    expect(checkInvoice({ ...valid, lines: [] }).ok).toBe(false);
    /* Blank descriptions are dropped, so an invoice of only blanks has none. */
    expect(
      checkInvoice({ ...valid, lines: [{ description: '  ', quantity: 1, unitPricePkr: 500 }] }).ok,
    ).toBe(false);
  });

  it('refuses a quantity or rate that cannot be charged', () => {
    expect(checkInvoice({ ...valid, lines: [{ description: 'x', quantity: 0, unitPricePkr: 500 }] }).ok).toBe(false);
    expect(checkInvoice({ ...valid, lines: [{ description: 'x', quantity: -1, unitPricePkr: 500 }] }).ok).toBe(false);
    expect(checkInvoice({ ...valid, lines: [{ description: 'x', quantity: 1, unitPricePkr: -1 }] }).ok).toBe(false);
  });

  /* An extra zero is the mistake that actually happens, and it is far cheaper
     to catch here than in a client's inbox. */
  it('catches an extra zero', () => {
    const result = checkInvoice({
      ...valid,
      lines: [{ description: 'Social media', quantity: 1, unitPricePkr: 120_000_000 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/extra zero/i);
  });

  it('refuses more lines than a page can hold', () => {
    const lines = Array.from({ length: MAX_INVOICE_LINES + 1 }, (_, i) => ({
      description: `Line ${i}`,
      quantity: 1,
      unitPricePkr: 100,
    }));
    expect(checkInvoice({ ...valid, lines }).ok).toBe(false);
  });

  it('refuses an invoice for nothing', () => {
    expect(
      checkInvoice({ ...valid, lines: [{ description: 'Goodwill', quantity: 1, unitPricePkr: 0 }] }).ok,
    ).toBe(false);
  });

  it('refuses a due date before the invoice exists', () => {
    expect(checkInvoice({ ...valid, dueOn: '2026-08-31' }).ok).toBe(false);
    /* Same day is fine — "due on receipt". */
    expect(checkInvoice({ ...valid, dueOn: '2026-09-01' }).ok).toBe(true);
  });
});

describe('where an invoice stands', () => {
  const base = { voidedAt: null, sentAt: null, dueOn: '2026-09-11', paidInFull: false };

  it('is a draft until it is sent', () => {
    expect(dispatchOf(base, '2026-09-01')).toBe('draft');
  });

  it('is sent once it has gone out', () => {
    expect(dispatchOf({ ...base, sentAt: '2026-09-01T10:00:00Z' }, '2026-09-05')).toBe('sent');
  });

  it('is overdue past the due date', () => {
    expect(dispatchOf({ ...base, sentAt: '2026-09-01T10:00:00Z' }, '2026-09-12')).toBe('overdue');
  });

  /* ⚠️ THE BUG THIS CASE EXISTS FOR. Reading only the date turns every settled
     invoice red a week after it was raised, and a screen where everything is
     red is a screen nobody reads. */
  it('is not overdue once it has been paid', () => {
    expect(
      dispatchOf({ ...base, sentAt: '2026-09-01T10:00:00Z', paidInFull: true }, '2026-10-30'),
    ).toBe('sent');
  });

  /* A void outranks everything, including overdue: it is not a debt. */
  it('is void whatever else is true of it', () => {
    expect(
      dispatchOf(
        { voidedAt: '2026-09-02T10:00:00Z', sentAt: '2026-09-01T10:00:00Z', dueOn: '2026-09-11', paidInFull: false },
        '2026-12-01',
      ),
    ).toBe('void');
  });

  it('never leaves a state without a label', () => {
    for (const state of ['draft', 'sent', 'overdue', 'void'] as const) {
      expect(DISPATCH_META[state].label.length).toBeGreaterThan(0);
      expect(DISPATCH_META[state].token.length).toBeGreaterThan(0);
    }
  });

  it('has no due date to miss when there is none', () => {
    expect(dispatchOf({ ...base, sentAt: '2026-09-01T10:00:00Z', dueOn: null }, '2030-01-01')).toBe('sent');
  });
});

describe('the signature', () => {
  /* A 1×1 PNG, repeated so it clears the "this is blank" floor. */
  const png = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'.repeat(3)}`;

  it('accepts a drawn PNG', () => {
    const result = decodeSignature(png);
    expect(result.ok).toBe(true);
  });

  /* ⚠️ THE CASE THIS FUNCTION EXISTS FOR. An SVG is a document that can carry
     script, and this one is written into a bucket and drawn into a PDF. A naive
     split on the comma would accept it. */
  it('refuses an SVG wearing a data URL', () => {
    expect(decodeSignature('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').ok).toBe(false);
    expect(decodeSignature('data:text/html;base64,PHNjcmlwdD4=').ok).toBe(false);
    expect(decodeSignature('data:image/jpeg;base64,/9j/4AAQ').ok).toBe(false);
  });

  it('refuses a blank pad', () => {
    expect(decodeSignature('data:image/png;base64,iVBORw0KGgo=').ok).toBe(false);
    expect(decodeSignature('').ok).toBe(false);
  });

  it('refuses something far too large to be a pen stroke', () => {
    const huge = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    expect(decodeSignature(huge).ok).toBe(false);
  });
});

describe('the letterhead', () => {
  it('fills in what a fresh install has not set', () => {
    const company = readLetterhead({});
    expect(company.legalName).toBe(LETTERHEAD_FALLBACK.legalName);
    expect(company.invoicePrefix).toBe('CNI');
    expect(company.defaultTaxRatePct).toBe(16);
    expect(company.addressLines).toEqual([]);
  });

  it('takes what has been set', () => {
    const company = readLetterhead({
      legalName: 'Crescent Nova International (Pvt) Ltd',
      addressLines: ['12 Main Boulevard', 'Karachi'],
      ntn: '1234567-8',
      defaultTaxRatePct: 15,
    });
    expect(company.legalName).toBe('Crescent Nova International (Pvt) Ltd');
    expect(company.addressLines).toEqual(['12 Main Boulevard', 'Karachi']);
    expect(company.ntn).toBe('1234567-8');
    expect(company.defaultTaxRatePct).toBe(15);
  });

  /* ⚠️ The value is JSONB an Admin edits by hand. A string where the address
     array belongs would throw inside `.map()` in the PDF composer, several
     layers from the setting that caused it. */
  it('survives a setting of the wrong shape', () => {
    const company = readLetterhead({
      legalName: 42,
      addressLines: 'Karachi',
      defaultTaxRatePct: 'sixteen',
      invoicePrefix: '',
    });
    expect(company.legalName).toBe(LETTERHEAD_FALLBACK.legalName);
    expect(company.addressLines).toEqual([]);
    expect(company.defaultTaxRatePct).toBe(16);
    expect(company.invoicePrefix).toBe('CNI');
  });

  it('survives null and undefined outright', () => {
    expect(readLetterhead(null).legalName).toBe(LETTERHEAD_FALLBACK.legalName);
    expect(readLetterhead(undefined).addressLines).toEqual([]);
  });

  it('drops blank address lines rather than printing a gap', () => {
    expect(readLetterhead({ addressLines: ['12 Main', '', '   ', 'Karachi'] }).addressLines).toEqual([
      '12 Main',
      'Karachi',
    ]);
  });

  /* The "how to pay" block is omitted entirely rather than printed with
     placeholders — an invented account number is money sent to nobody. */
  it('knows when there is nothing to say about payment', () => {
    expect(hasBankDetails(readLetterhead({}))).toBe(false);
    expect(hasBankDetails(readLetterhead({ bankName: 'Meezan Bank' }))).toBe(true);
    expect(hasBankDetails(readLetterhead({ bankIban: 'PK00MEZN0000000000000000' }))).toBe(true);
  });
});
