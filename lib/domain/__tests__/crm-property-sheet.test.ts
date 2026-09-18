import { describe, expect, it } from 'vitest';

import { MAX_PLOTS, parsePlotLine, parsePropertySheet, sheetProblem } from '../crm-property-sheet';

/* A sheet as one actually reads once the lines have been rebuilt from the PDF's
   positioned fragments — see `lib/crm/pdf-text.ts`. */
const SHEET = [
  'CNI Gardens · Available plots · September 2026',
  'Plot No    Block    Size        Category          Price (PKR)',
  'A-101      Block A  5 Marla     Corner            4,500,000',
  'A-102      Block A  5 Marla                       4,200,000',
  'B-7        Block B  10 Marla    Park facing       8,900,000',
  'C-18       Block C  1 Kanal     Main boulevard    17,500,000',
  'Total                                             35,100,000',
  'Contact: 0300 1234567 · sales@example.com',
];

describe('parsePlotLine', () => {
  it('reads the code, block, size, price and traits from one row', () => {
    expect(parsePlotLine('A-101 Block A 5 Marla Corner 4,500,000')).toEqual({
      code: 'A-101',
      block: 'A',
      sizeMarla: 5,
      basePrice: 4_500_000,
      category: 'Corner',
      source: 'A-101 Block A 5 Marla Corner 4,500,000',
    });
  });

  it('accepts a labelled code anywhere in the row', () => {
    expect(parsePlotLine('Residential · Plot No. 42, Block D, 7 Marla, 6,300,000')?.code).toBe('42');
    expect(parsePlotLine('Residential · Plot No. 42, Block D, 7 Marla, 6,300,000')?.block).toBe('D');
  });

  it('counts a kanal as twenty marla', () => {
    expect(parsePlotLine('C-18 Block C 1 Kanal 17,500,000')?.sizeMarla).toBe(20);
    expect(parsePlotLine('D-2 Block D 2 Kanal 30,000,000')?.sizeMarla).toBe(40);
  });

  it('leaves the price null when the sheet does not price the plot', () => {
    expect(parsePlotLine('A-104 Block A 5 Marla Available')?.basePrice).toBeNull();
  });

  it('does not read a size, a road width or a serial as a price', () => {
    /* 30 ft road, 5 marla, plot 101 — nothing here is money. */
    expect(parsePlotLine('A-101 Block A 5 Marla 30 ft road')?.basePrice).toBeNull();
  });

  it('refuses a row that names no unit', () => {
    expect(parsePlotLine('Total 35,100,000')).toBeNull();
    expect(parsePlotLine('Price (PKR)')).toBeNull();
    expect(parsePlotLine('Contact: 0300 1234567')).toBeNull();
  });

  it('does not take a code out of the middle of a sentence', () => {
    expect(parsePlotLine('Prices above are valid till A-101 is sold, per the terms')).toBeNull();
  });
});

describe('parsePropertySheet', () => {
  it('returns one plot per row and skips the furniture', () => {
    const plots = parsePropertySheet(SHEET);
    expect(plots.map((p) => p.code)).toEqual(['A-101', 'A-102', 'B-7', 'C-18']);
    expect(plots.map((p) => p.basePrice)).toEqual([4_500_000, 4_200_000, 8_900_000, 17_500_000]);
    expect(plots.map((p) => p.sizeMarla)).toEqual([5, 5, 10, 20]);
  });

  it('keeps the same code in two different blocks', () => {
    const plots = parsePropertySheet(['A-1 Block A 5 Marla 4,000,000', 'A-1 Block B 5 Marla 4,100,000']);
    expect(plots).toHaveLength(2);
  });

  it('drops a repeated header row on page two', () => {
    const plots = parsePropertySheet(['A-1 Block A 5 Marla 4,000,000', 'A-1 Block A 5 Marla 4,000,000']);
    expect(plots).toHaveLength(1);
  });

  it('stops at the ceiling rather than reading a misparsed novel', () => {
    const many = Array.from({ length: MAX_PLOTS + 50 }, (_, i) => `A-${i + 1} Block A 5 Marla 4,000,000`);
    expect(parsePropertySheet(many)).toHaveLength(MAX_PLOTS);
  });
});

describe('sheetProblem', () => {
  it('names a scan for what it is', () => {
    expect(sheetProblem([], [])).toMatch(/scan or a photograph/);
  });

  it('says why a readable sheet still yielded nothing', () => {
    expect(sheetProblem(['Price list September 2026', 'All prices are in PKR and subject to change'], []))
      .toMatch(/needs a plot or unit number/);
  });

  it('is silent when there are plots', () => {
    expect(sheetProblem(SHEET, parsePropertySheet(SHEET))).toBeNull();
  });
});
