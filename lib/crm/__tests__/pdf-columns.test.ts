import { describe, expect, it } from 'vitest';

import { type Fragment, findGutter, linesFromFragments } from '../pdf-columns';

/* ============================================================================
 * READING A TWO-COLUMN PAGE IN THE ORDER A PERSON READS IT
 * ----------------------------------------------------------------------------
 * The owner's `CRM Purposal.pdf` is two columns. Grouping by baseline spliced
 * each left line to the right line beside it, and the knowledge extractor then
 * lost nine of ten answers because their quotes did not exist in the scrambled
 * text.
 *
 * ⚠️ THE POINT OF THESE TESTS IS THE ORDER, NOT THE PRESENCE. Every word
 * survives the old code too — in an order that means something else.
 * ========================================================================= */

const A4 = 595;

/** One run of text at a position. Widths are generous, as real glyph runs are. */
const at = (x: number, y: number, w: number, str: string): Fragment => ({ x, y, w, str });

/**
 * One line, as pdfjs really hands it over: several runs, not one string.
 *
 * ⚠️ THE FIXTURE HAS TO BE SHAPED LIKE THE INPUT. A first version of this test
 * gave each line as a single fragment, which no PDF does — and `findGutter`
 * correctly refused to judge a page of twelve runs as being in columns. The test
 * was wrong, not the rule.
 */
function runs(x: number, y: number, width: number, text: string): Fragment[] {
  const words = text.split(' ');
  const half = Math.ceil(words.length / 2);
  const first = words.slice(0, half).join(' ');
  const second = words.slice(half).join(' ');
  const firstW = width * (first.length / text.length);
  return second
    ? [
        { x, y, w: firstW, str: first },
        { x: x + firstW, y, w: width - firstW, str: second },
      ]
    : [{ x, y, w: width, str: first }];
}

/** A two-column page: left column at x=50, right at x=320. */
function twoColumnPage(): Fragment[] {
  const rows: Fragment[] = [];
  const left = [
    'Capture leads from website forms, landing pages,',
    'Meta lead ads, TikTok campaigns, Google campaigns,',
    'WhatsApp, imports, manual entry and APIs.',
    'Maintain leads, contacts, companies, properties',
    'or products in configurable records.',
    'Use custom fields, tags, source, campaign, branch.',
  ];
  const right = [
    'Apply configurable qualification questions and lead',
    'stages.',
    'Score leads using source, engagement, budget,',
    'intent, fit and response history.',
    'Assign leads by round robin, availability, workload,',
    'branch, territory, expertise or performance.',
  ];
  left.forEach((s, i) => rows.push(...runs(50, 700 - i * 14, 220, s)));
  right.forEach((s, i) => rows.push(...runs(320, 700 - i * 14, 225, s)));
  return rows;
}

describe('findGutter', () => {
  it('finds the gutter down the middle of a two-column page', () => {
    const gutter = findGutter(twoColumnPage(), A4);
    expect(gutter).not.toBeNull();
    expect(gutter!).toBeGreaterThan(270);
    expect(gutter!).toBeLessThan(320);
  });

  it('⚠️ finds none on an ordinary single-column page', () => {
    /* Splitting a normal page would be the worse bug of the two: it would put
       the bottom half of every page before the top half. */
    const page: Fragment[] = [];
    for (let i = 0; i < 30; i++) {
      page.push(at(50, 700 - i * 14, 480, `A full width line of ordinary body text, number ${i}.`));
    }
    expect(findGutter(page, A4)).toBeNull();
  });

  it('⚠️ finds none in a two-column TABLE whose rows are one thought', () => {
    /* A quotation's table has a gap between its columns, and its rows read
       across, not down. Splitting it would separate every price from its item.
       This is why a gutter needs text on both sides at many shared heights AND
       nothing spanning it — a table has a header row that spans. */
    const table: Fragment[] = [at(50, 720, 480, 'MODULE KEY SCOPE PRICE')];
    for (let i = 0; i < 6; i++) {
      table.push(at(50, 700 - i * 20, 180, `Module ${i}`));
      table.push(at(420, 700 - i * 20, 90, `PKR ${i}5,000`));
    }
    expect(findGutter(table, A4)).toBeNull();
  });

  it('ignores a page with too little text to judge', () => {
    expect(findGutter([at(50, 700, 100, 'Title')], A4)).toBeNull();
  });
});

describe('linesFromFragments', () => {
  it('⚠️ never splices a left line to the right line beside it', () => {
    const lines = linesFromFragments(twoColumnPage(), A4);
    const spliced = lines.find((l) => l.includes('landing pages,') && l.includes('Apply configurable'));
    expect(spliced, 'the left and right columns were joined into one line').toBeUndefined();
  });

  it('reads the whole left column before the right one', () => {
    const lines = linesFromFragments(twoColumnPage(), A4);
    const lastLeft = lines.findIndex((l) => l.includes('Use custom fields'));
    const firstRight = lines.findIndex((l) => l.includes('Apply configurable'));
    expect(lastLeft).toBeGreaterThanOrEqual(0);
    expect(firstRight).toBeGreaterThan(lastLeft);
  });

  it('keeps each column’s sentences contiguous, so a quote can be found', () => {
    const text = linesFromFragments(twoColumnPage(), A4).join(' ');
    expect(text).toContain('Capture leads from website forms, landing pages, Meta lead ads');
    expect(text).toContain('Apply configurable qualification questions and lead stages.');
  });

  it('⚠️ reads a full-width heading in place AND still splits the columns', () => {
    /* ⚠️ THIS TEST USED TO PASS FOR THE WRONG REASON. With a heading spanning
       the page, the old rule found no gutter at all, fell back to single-column
       reading, and the heading came out first anyway — so the assertion held
       while the columns were being spliced underneath it. That is exactly the
       shape of the owner's real proposal: 27 fragments left, 29 right, one
       heading across. Both things are asserted now. */
    const page = twoColumnPage();
    page.push(at(50, 740, 495, 'Customer and Lead Management'));

    expect(findGutter(page, A4)).not.toBeNull();

    const lines = linesFromFragments(page, A4);
    expect(lines[0]).toBe('Customer and Lead Management');
    expect(lines.find((l) => l.includes('landing pages,') && l.includes('Apply configurable'))).toBeUndefined();
  });

  it('still reads a single-column page top to bottom', () => {
    const page: Fragment[] = [];
    for (let i = 0; i < 30; i++) {
      page.push(at(50, 700 - i * 14, 480, `line ${i}`));
    }
    const lines = linesFromFragments(page, A4);
    expect(lines[0]).toBe('line 0');
    expect(lines[29]).toBe('line 29');
  });

  it('joins runs on one baseline left to right', () => {
    const page: Fragment[] = [];
    for (let i = 0; i < 25; i++) page.push(at(50, 600 - i * 14, 400, `filler ${i}`));
    page.push(at(50, 700, 60, 'Total'), at(120, 700, 80, 'PKR 178,500'));
    expect(linesFromFragments(page, A4)[0]).toBe('Total PKR 178,500');
  });
});
