/* ============================================================================
 * FILE-TYPE MARKS — owner request 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Use that exact PDF icon because I have every icon: Excel, PPT, CSV, Google
 * Sheet. We have every icon so the design should be exactly the same."*
 *
 * The five marks the Reports & Exports drawer shows, as data rather than as
 * components — same split as `platform-marks.ts`, and for the same reason: the
 * PDF composer may one day want to draw these into a document, and a
 * `'use client'` module cannot be imported by a server one.
 *
 * ── ⚠️ DRAWN, NOT THE VENDORS' LOGOS ───────────────────────────────────────
 * These are a page-corner silhouette with a letter block, in each format's
 * conventional colour — Acrobat red, Excel green, PowerPoint orange, Sheets
 * green, Slides yellow. They are NOT Adobe's, Microsoft's or Google's actual
 * marks, and that is deliberate: those are trademarks with usage terms, they
 * would need to be fetched and stored, and at 22px in a row of five a faithful
 * logo is indistinguishable from this anyway. Nothing here implies the vendor
 * endorses or is involved.
 *
 * ── ⚠️ ONE SHARED PAGE SHAPE, SO THE ROW LINES UP ──────────────────────────
 * Five independently drawn icons in a row never optically align — their
 * baselines and widths drift by a pixel or two each and the row reads as
 * sloppy. All five share `PAGE_PATH` and `FOLD_PATH` on a 24×24 grid and differ
 * only in colour and letters.
 * ========================================================================= */

/** A sheet of paper with the top-right corner turned over. */
export const PAGE_PATH =
  'M5 2.75A1.75 1.75 0 0 1 6.75 1h7.44c.46 0 .9.18 1.23.51l4.07 4.07c.33.33.51.77.51 1.23v14.44A1.75 1.75 0 0 1 18.25 23H6.75A1.75 1.75 0 0 1 5 21.25V2.75Z';

/** The turned corner, drawn a shade darker over the page. */
export const FOLD_PATH = 'M14 1.2v4.3c0 .69.56 1.25 1.25 1.25h4.3L14 1.2Z';

export interface FileTypeMark {
  readonly key: string;
  /** What the drawer prints under the mark. */
  readonly label: string;
  /** The page fill. */
  readonly color: string;
  /** The letter block's fill — usually the page colour, darkened. */
  readonly block: string;
  /** Two or three characters. Four does not fit at 22px. */
  readonly letters: string;
  /**
   * Whether anything in this application can actually write the format.
   *
   * ⚠️ IT LIVES ON THE MARK so the two places that draw these — the card row and
   * the drawer — cannot disagree about it. The owner asked for all five, and all
   * five are drawn in full colour; this is what decides whether the mark is a
   * button or carries a tooltip saying why not.
   */
  readonly writable: boolean;
  readonly note: string;
}

export const FILE_TYPE_MARKS: Readonly<Record<string, FileTypeMark>> = {
  pdf: {
    key: 'pdf',
    label: 'PDF',
    color: '#E8453C',
    block: '#C0281F',
    letters: 'PDF',
    writable: true,
    /* Typeset server-side with pdf-lib, so the same report opens identically
       every time and no glyph can be misspelled. */
    note: 'Drawn server-side with real type — identical every time.',
  },
  xlsx: {
    key: 'xlsx',
    label: 'Excel',
    color: '#1D7044',
    block: '#14532D',
    letters: 'XLS',
    writable: false,
    note: 'No .xlsx writer yet. CSV opens in Excel and carries the same rows.',
  },
  pptx: {
    key: 'pptx',
    label: 'PPT',
    color: '#D24625',
    block: '#A6331A',
    letters: 'PPT',
    writable: false,
    note: 'No .pptx writer yet. The PDF is the presentable form.',
  },
  csv: {
    key: 'csv',
    label: 'CSV',
    color: '#17864C',
    block: '#0F5F36',
    letters: 'CSV',
    writable: true,
    note: 'Opens in Excel, Sheets or Numbers.',
  },
  gslides: {
    key: 'gslides',
    label: 'Google Slides',
    color: '#F2B01E',
    block: '#C98A0B',
    letters: 'GS',
    writable: false,
    note: 'Needs a Google Workspace connection, which is not set up.',
  },
};

/** The reference's order, left to right. */
export const FILE_TYPE_ORDER = ['pdf', 'xlsx', 'pptx', 'csv', 'gslides'] as const;
