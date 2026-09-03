import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { __layout } from '../report-sheet';
import type { WorkRow } from '@/lib/domain/work-report';

/* ============================================================================
 * THE PDF'S GEOMETRY
 * ----------------------------------------------------------------------------
 * ⚠️ WHY THIS IS ARITHMETIC AND NOT A PICTURE. There is no PDF rasteriser on this
 * machine, so "is the text cut off" cannot be answered by looking. It does not
 * have to be: a cell fits if every wrapped line measures narrower than its column,
 * and a row is tall enough if its height covers its tallest cell. Both are
 * decidable from the same functions the composer draws with.
 *
 * These are exactly the two things the owner reported:
 *
 *   *"the data in the last column is not readable… The text is cutting so instead
 *    of cutting move it to the next line. Increase the height of the row so each
 *    data item should be easily readable."*
 *
 * So they get pinned here rather than re-checked by eye after every change.
 * ========================================================================= */

const { WORK_COLUMNS, CONTENT_W, CELL_PAD, LINE_H, BODY_SIZE, columnBoxes, wrap, widthOf, measureWorkRow } =
  __layout;

async function fonts() {
  const pdf = await PDFDocument.create();
  return {
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    regular: await pdf.embedFont(StandardFonts.Helvetica),
  };
}

const row = (over: Partial<WorkRow> = {}): WorkRow => ({
  key: 'k',
  projectId: 'p',
  projectName: 'GC Royal Emporium',
  userId: 'u1',
  personName: 'Kashif Ahmed',
  avatarUrl: null,
  /* `role` became `tasks` on 2026-09-03 — see WorkRow. */
  tasks: [],
  platforms: ['facebook', 'instagram'],
  tasksAssigned: 20,
  tasksDone: 18,
  tasksPending: 2,
  postsPublished: 16,
  contentTypes: ['Static post', 'Long video', 'Story'],
  activitySummary: '10 posts, 3 reels, 2 stories',
  status: 'overdue',
  lastActive: '2026-08-29T10:00:00Z',
  ...over,
});

describe('column geometry', () => {
  it('has shares summing to exactly 100', () => {
    /* The boxes are laid end to end from the left margin, so a sum below 100
       leaves a gap at the right and a sum above it runs off the page. */
    const total = WORK_COLUMNS.reduce((sum, c) => sum + c.share, 0);
    expect(total).toBe(100);
  });

  it('lays the columns end to end across exactly the content width', () => {
    const boxes = columnBoxes(WORK_COLUMNS);
    expect(boxes).toHaveLength(WORK_COLUMNS.length);

    for (let i = 1; i < boxes.length; i += 1) {
      /* No gaps, no overlaps: each box starts where the last one ended. */
      expect(boxes[i].x).toBeCloseTo(boxes[i - 1].x + boxes[i - 1].w, 6);
    }
    const last = boxes[boxes.length - 1];
    expect(last.x + last.w - boxes[0].x).toBeCloseTo(CONTENT_W, 6);
  });

  it('gives every column room for at least a few characters', () => {
    /* A column narrower than its padding plus a couple of glyphs cannot show
       anything at all, and the wrap would hard-break every single character. */
    for (const box of columnBoxes(WORK_COLUMNS)) {
      expect(box.w - CELL_PAD * 2).toBeGreaterThan(24);
    }
  });
});

describe('wrapping', () => {
  it('never returns a line wider than the space it was given', async () => {
    /* ⚠️ THE test. This is the property that means no cell is ever cut off — if it
       holds for every string, the composer cannot draw text past its column. */
    const { regular } = await fonts();
    const boxes = columnBoxes(WORK_COLUMNS);

    const samples = [
      'GC Royal Emporium',
      'Static post, Long video, Story, Reel / short video, Carousel',
      '10 posts, 3 reels, 2 stories, 4 carousels, 1 website update',
      'Ammar Afzal Khan',
      'Reel / short video',
      'a-single-extremely-long-unbroken-token-that-cannot-be-split-on-spaces-at-all',
      '',
      '   ',
    ];

    for (const box of boxes) {
      const max = box.w - CELL_PAD * 2;
      for (const sample of samples) {
        for (const line of wrap(regular, sample, BODY_SIZE, max)) {
          expect(
            widthOf(regular, line, BODY_SIZE),
            `"${line}" overflows a ${max.toFixed(1)}pt column`,
          ).toBeLessThanOrEqual(max + 0.01);
        }
      }
    }
  });

  it('breaks a word that cannot fit rather than letting it overflow', async () => {
    const { regular } = await fonts();
    const lines = wrap(regular, 'supercalifragilisticexpialidocious', BODY_SIZE, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(widthOf(regular, line, BODY_SIZE)).toBeLessThanOrEqual(30.01);
    }
  });

  it('keeps whole words together when they do fit', async () => {
    const { regular } = await fonts();
    expect(wrap(regular, 'Static post', BODY_SIZE, 200)).toEqual(['Static post']);
  });

  it('returns one empty line for empty input rather than nothing', async () => {
    /* A cell with no lines would make `Math.max(...[])` return -Infinity and the
       row height NaN, which pdf-lib rejects outright. */
    const { regular } = await fonts();
    expect(wrap(regular, '', BODY_SIZE, 100)).toEqual(['']);
    expect(wrap(regular, '   ', BODY_SIZE, 100)).toEqual(['']);
  });
});

describe('row height', () => {
  it('is tall enough for the tallest cell in the row', async () => {
    /* ⚠️ The owner's other complaint — *"increase the height of the row so each
       data item should be easily readable"*. A row shorter than its content is how
       text ends up printed over the row beneath. */
    const kit = await fonts();
    const boxes = columnBoxes(WORK_COLUMNS);

    for (const sample of [
      row(),
      row({ contentTypes: ['Static post', 'Long video', 'Story', 'Reel / short video', 'Carousel'] }),
      row({ activitySummary: '10 posts, 3 reels, 2 stories, 4 carousels, 2 website updates, 1 ad' }),
      row({ projectName: 'A Project With A Very Long Name Indeed For Testing' }),
      row({ platforms: ['facebook', 'instagram', 'linkedin', 'tiktok', 'x'] }),
      row({ platforms: [], contentTypes: [], activitySummary: '', tasks: [] }),
    ]) {
      const measured = measureWorkRow(kit as never, sample, boxes);
      const tallest = Math.max(...measured.lines.map((l) => l.length));
      expect(
        measured.height,
        'row is shorter than the text it has to hold',
      ).toBeGreaterThanOrEqual(tallest * LINE_H);
      /* And never so short that a single-line row looks cramped. */
      expect(measured.height).toBeGreaterThanOrEqual(24);
    }
  });

  it('grows when a cell needs more lines', async () => {
    const kit = await fonts();
    const boxes = columnBoxes(WORK_COLUMNS);

    const short = measureWorkRow(kit as never, row({ activitySummary: '1 post' }), boxes);
    const long = measureWorkRow(
      kit as never,
      row({ activitySummary: '10 posts, 3 reels, 2 stories, 4 carousels, 2 website updates, 1 ad' }),
      boxes,
    );
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('leaves room for the platform marks when a person posts everywhere', async () => {
    /* The marks are drawn as tiles, not text, so their line count is computed
       separately — and a row that ignored them would clip the second tile row. */
    const kit = await fonts();
    const boxes = columnBoxes(WORK_COLUMNS);

    const one = measureWorkRow(kit as never, row({ platforms: ['facebook'] }), boxes);
    const many = measureWorkRow(
      kit as never,
      row({ platforms: ['facebook', 'instagram', 'linkedin', 'tiktok', 'x', 'youtube'] }),
      boxes,
    );
    expect(many.height).toBeGreaterThanOrEqual(one.height);
  });
});
