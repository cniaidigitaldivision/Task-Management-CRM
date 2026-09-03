import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFArray,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import { PLATFORM_MARKS } from '@/lib/brand/platform-marks';
import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';
import type { ChartSpec } from '@/lib/domain/report-charts';
import { cellText, type Report, type ReportColumn } from '@/lib/domain/reports';
import { WORK_STATUS_META, type WorkReport, type WorkRow } from '@/lib/domain/work-report';

/* ============================================================================
 * THE REPORT SHEET — the work report, laid out for paper
 * ----------------------------------------------------------------------------
 * Owner: *"the export option has the three export options but the template is not
 * good. Properly use my whole tool template. Properly use the logo."* Then, on the
 * first version: *"the data in the last column is not readable… The text is
 * cutting so instead of cutting move it to the next line. Increase the height of
 * the row… for the platforms, instead of using names, use their icons."*
 *
 * ── ⚠️ EVERY CELL WRAPS; NOTHING IS EVER TRUNCATED ──────────────────────────
 * The single biggest change from the first attempt, and the rule the whole layout
 * is built around. `clip()` still exists but is used ONLY where a value cannot
 * meaningfully wrap (a masthead title). Every table cell measures its wrapped
 * lines first, the row takes the height of its tallest cell, and the page breaks
 * when the next row will not fit whole.
 *
 * That ordering matters: a row's height cannot be known until every cell in it has
 * been wrapped, so the pass measures the entire row before drawing any of it.
 * Drawing cell by cell and growing the row as you go is how you get a row whose
 * background stops halfway down its own text.
 *
 * ── ⚠️ THE RICH TABLE NEEDS `WorkReport`, NOT `Report` ──────────────────────
 * `Report` is typed CELLS — text, numbers, dates. It cannot express "this person's
 * avatar", "these four brand marks" or "this status, in its own colour", and the
 * owner asked for all three: *"instead of using names, use their icons… every
 * person's image, like that type of icon, should be displayed with their status
 * and colour."*
 *
 * So the composer takes both. `work` present → the designed table with avatars,
 * brand tiles and status pills. Absent (the four analytical report types) → the
 * generic typed-cell table, which is still wrapped and paginated. One composer,
 * two table renderers, and the summary cards, masthead and footer are shared.
 *
 * ── WHY NOT THE PRINT DIALOGUE ──────────────────────────────────────────────
 * Print stays in the menu and still puts the screen onto paper. But the browser
 * decides margins, adds its own header and a URL in the footer, and drops
 * background colours by default — so the teal header band and every status pill
 * would come out white. None of that goes in front of a CEO.
 *
 * ── LANDSCAPE ──────────────────────────────────────────────────────────────
 * Twelve columns. On portrait A4 the usable width is ~523pt, i.e. 43pt a column
 * once the wide ones have taken their share, and "Tasks Assigned" cannot set in
 * 43pt at a readable size. Landscape gives 778pt.
 * ========================================================================= */

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 32;
const CONTENT_W = PAGE_W - M * 2;
/** Where the footer starts. Nothing may be drawn below this. */
const FLOOR = PAGE_H - 46;

const INK = {
  text: rgb(0.09, 0.13, 0.15),
  soft: rgb(0.42, 0.46, 0.5),
  faint: rgb(0.58, 0.62, 0.66),
  rule: rgb(0.86, 0.9, 0.91),
  wash: rgb(0.965, 0.975, 0.977),
  stripe: rgb(0.976, 0.984, 0.985),
  brand: rgb(0.055, 0.361, 0.388),
  white: rgb(1, 1, 1),
} as const;

const hex = (value: string) => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * Theme token name → print ink.
 *
 * ⚠️ AN EXPLICIT MAP, because CSS custom properties do not exist on the server:
 * `var(--status-done)` is a string with no value here. These are the LIGHT-theme
 * values from styles/tokens.css — paper has no dark mode, and the dark palette on
 * white is unreadable. Anything unknown falls back to the brand teal rather than
 * to black, so a token added to the palette prints as a deliberate colour.
 */
export const TOKEN_INK: Readonly<Record<string, ReturnType<typeof rgb>>> = {
  'accent-primary': hex('#0e5c63'),
  'accent-gold': hex('#d4a63c'),
  'status-backlog': hex('#64748b'),
  'status-todo': hex('#3b82f6'),
  'status-progress': hex('#8b5cf6'),
  'status-blocked': hex('#ef4444'),
  'status-review': hex('#ec4899'),
  'status-revisions': hex('#f97316'),
  'status-done': hex('#10b981'),
  'status-cancelled': hex('#a1a1aa'),
  'feedback-success': hex('#059669'),
  'feedback-warning': hex('#f97316'),
  'feedback-error': hex('#dc2626'),
  'feedback-info': hex('#0e5c63'),
};

const inkFor = (token: string) => TOKEN_INK[token] ?? INK.brand;

/** The avatar tints, in `components/ui/avatar.tsx` order so a person's disc is the
 *  same colour on paper as on screen. Same hash, same index, same colour. */
const AVATAR_TINTS = [
  hex('#12707a'), // teal-600
  hex('#3b82f6'), // status-todo
  hex('#8b5cf6'), // status-progress
  hex('#ec4899'), // status-review
  hex('#7c3aed'), // project-event
  hex('#10b981'), // status-done
  hex('#475569'), // project-business
  hex('#17878f'), // teal-500
];

export interface ReportSheetInput {
  readonly report: Report;
  /** Present for the work report — turns on the designed table. See the header. */
  readonly work: WorkReport | null;
  readonly charts: readonly ChartSpec[];
  /** What the reader narrowed to, as prose. Empty when nothing. */
  readonly filterSummary: readonly string[];
  /** `yyyy-mm-dd`. Also stamps the document dates. */
  readonly generatedOn: string;
  readonly generatedBy: string;
  /* ── ⚠️ ONE COLUMN OF REAL, CLICKABLE LINKS — ADDED 2026-09-03 ────────────
     Owner asked for two things that pulled against each other: this sheet's
     template for the project report, AND *"the post URL… could be a clickable
     right in the PDF."* The generic table draws text, so moving the project
     report onto this renderer would have quietly undone the links.

     The addresses ride ALONGSIDE the rows rather than inside a Cell: `Cell` is
     also what the .xlsx writer reads, and giving it an href would put a PDF
     concern into the spreadsheet's shape. `index` is the column; `hrefs` is one
     entry per row, null where that row has no link.

     The cell TEXT stays whatever the row says — usually the address without its
     scheme, because a column of "https://" tells a reader nothing. The
     annotation always carries the full href, which is what has to be complete
     for the link to resolve. */
  readonly linkColumn?: {
    readonly index: number;
    readonly hrefs: readonly (string | null)[];
  } | null;

  /* ── ⚠️ ONE COLUMN DRAWN AS BRAND MARKS — ADDED 2026-09-03 ────────────────
     Owner: *"in a platform you write the name Facebook, TikTok, Instagram.
     Instead… they should display Facebook icon, Instagram icon and TikTok
     icon."* The work report's own table has done this from the start; the
     generic table drew whatever text the row carried, so a project report listed
     "Facebook, Instagram" as words.

     SLUGS, not display names: `PLATFORM_MARKS` is keyed on the slug, and "X
     (Twitter)" has already been reworded once — a lookup on a label silently
     falls back to a grey initial the day somebody edits it. */
  readonly markColumn?: {
    readonly index: number;
    /** One list of slugs per row, in the order they should be drawn. */
    readonly slugs: readonly (readonly string[])[];
  } | null;

  /* ── ⚠️ THE SUBJECT, STATED IN THE BODY — ADDED 2026-09-03 ────────────────
     Owner: *"make the project name more prominent… it should be in the center
     but in bold"*, and *"show what the promise or target is, that is, 1 post
     daily or 2 posts a week. That should be displayed."*

     The masthead carries the report's TYPE ("Project report") and a small
     subtitle. For a document that will be read next to three others about three
     other clients, which client it is about should not be the smallest line on
     the page — and the target figures below mean nothing without the promise
     they are measured against. */
  readonly banner?: {
    readonly title: string;
    /** The rhythm, and anything else that frames the figures. */
    readonly lines: readonly string[];
  } | null;
}

/**
 * Make a rectangle of the page an actual clickable link.
 *
 * ⚠️ `/Rect` is PDF user space — origin BOTTOM-left, y upwards — which is what
 * `up()` converts into. Getting it upside down puts the clickable box at the top
 * of the page and nothing about the rendered file looks wrong.
 *
 * ⚠️ `PDFString.of`, not a bare string: a raw JS string is written as a NAME and
 * the reader silently ignores the action, so the link renders, does nothing, and
 * looks exactly like the bug this exists to prevent. The same helper and the
 * same warning as lib/pdf/report-poster.ts.
 *
 * ⚠️ `/Border [0 0 0]` because the styling is already drawn; without it most
 * readers add a black rectangle of their own around every link.
 */
function linkTo(
  kit: Kit,
  url: string,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const doc = kit.page.doc;

  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: doc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) }),
  });

  const existing = kit.page.node.get(PDFName.of('Annots')) as unknown;
  if (existing && typeof (existing as PDFArray).push === 'function') {
    (existing as PDFArray).push(annotation);
  } else {
    kit.page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  }
}

interface Kit {
  page: PDFPage;
  readonly bold: PDFFont;
  readonly regular: PDFFont;
}

/* ============================================================================
 * PRIMITIVES — coordinates measured DOWN from the page top
 * ========================================================================= */

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS on anything outside it, so
 * one curly apostrophe in a project name would fail the whole export. Every string
 * goes through here.
 *
 * This division's own data is why it is not paranoia: four of five library
 * documents are titled with em dashes, and `lib/domain/content-disposition.ts`
 * exists because one of them crashed a route.
 */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^ -ÿ]/g, '-');
}

const widthOf = (font: PDFFont, text: string, size: number) =>
  font.widthOfTextAtSize(safe(text), size);

/** Greedy wrap. A single word longer than the line is broken rather than left to
 *  overflow — a 40-character URL in a 60pt column has to go somewhere. */
function wrap(font: PDFFont, raw: string, size: number, max: number): string[] {
  const text = safe(raw).trim();
  if (text === '') return [''];

  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(font, candidate, size) <= max) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (widthOf(font, word, size) <= max) {
      line = word;
      continue;
    }
    /* Hard-break the over-long word. */
    let chunk = '';
    for (const char of word) {
      if (widthOf(font, chunk + char, size) > max) {
        lines.push(chunk);
        chunk = char;
      } else chunk += char;
    }
    line = chunk;
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function text(
  kit: Kit,
  raw: string,
  o: {
    x: number;
    baseline: number;
    size: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    align?: 'left' | 'right' | 'centre';
  },
): void {
  const font = o.bold ? kit.bold : kit.regular;
  const body = safe(raw);
  const w = widthOf(font, body, o.size);
  const x = o.align === 'right' ? o.x - w : o.align === 'centre' ? o.x - w / 2 : o.x;
  kit.page.drawText(body, { x, y: up(o.baseline), size: o.size, font, color: o.color ?? INK.text });
}

/** A rounded rectangle as an SVG path, origin at its top-left. Cubic béziers
 *  rather than arcs — the same shape with no dependence on sweep-flag handling. */
function roundedPath(w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = radius * 0.5523;
  return [
    `M ${radius} 0`,
    `L ${w - radius} 0`,
    `C ${w - radius + k} 0 ${w} ${radius - k} ${w} ${radius}`,
    `L ${w} ${h - radius}`,
    `C ${w} ${h - radius + k} ${w - radius + k} ${h} ${w - radius} ${h}`,
    `L ${radius} ${h}`,
    `C ${radius - k} ${h} 0 ${h - radius + k} 0 ${h - radius}`,
    `L 0 ${radius}`,
    `C 0 ${radius - k} ${radius - k} 0 ${radius} 0`,
    'Z',
  ].join(' ');
}

function roundedBox(
  kit: Kit,
  o: {
    x: number;
    top: number;
    w: number;
    h: number;
    r?: number;
    fill?: ReturnType<typeof rgb>;
    border?: ReturnType<typeof rgb>;
  },
): void {
  kit.page.drawSvgPath(roundedPath(o.w, o.h, o.r ?? 4), {
    x: o.x,
    y: up(o.top),
    color: o.fill,
    borderColor: o.border,
    borderWidth: o.border ? 0.7 : 0,
  });
}

function bar(kit: Kit, top: number, h: number, color: ReturnType<typeof rgb>, x = M, w = CONTENT_W) {
  kit.page.drawRectangle({ x, y: up(top + h), width: w, height: h, color });
}

/* ---- Brand marks --------------------------------------------------------- */

/**
 * A platform's real logo, drawn rather than named.
 *
 * Owner: *"for the platforms, instead of using names, use their icons."*
 *
 * ⚠️ THE MARK DATA ALREADY ANTICIPATED THIS. `lib/brand/platform-marks.ts` says of
 * its `hex` and `glyph` fields: *"stay populated so anything that cannot draw
 * layers still has a working tile — the PDF composer, for one."* So this uses the
 * single-path silhouette on a brand-coloured tile and deliberately ignores
 * `layers` (the multicolour variants), which need clip paths this cannot express.
 *
 * An unknown slug gets a neutral tile with its first letter — a platform added to
 * the database tomorrow must not leave a hole in the report.
 */
function drawMark(kit: Kit, slug: string, x: number, top: number, size: number): void {
  const mark = PLATFORM_MARKS[slug as keyof typeof PLATFORM_MARKS];

  if (!mark) {
    roundedBox(kit, { x, top, w: size, h: size, r: size * 0.28, fill: INK.faint });
    text(kit, slug.charAt(0).toUpperCase(), {
      x: x + size / 2,
      baseline: top + size * 0.72,
      size: size * 0.6,
      bold: true,
      color: INK.white,
      align: 'centre',
    });
    return;
  }

  roundedBox(kit, { x, top, w: size, h: size, r: size * 0.28, fill: hex(mark.hex) });

  if (!mark.path) return;

  /* The glyph is a 24×24 path. Inset to 62% and centred, matching the on-screen
     tile's proportions so paper and screen read as the same icon. */
  const glyph = size * 0.62;
  const scale = glyph / 24;
  const inset = (size - glyph) / 2;
  kit.page.drawSvgPath(mark.path, {
    x: x + inset,
    y: up(top + inset),
    scale,
    color: mark.glyph === 'light' ? INK.white : rgb(0, 0, 0),
  });
}

/* ---- Avatars ------------------------------------------------------------- */

function avatarTint(name: string): ReturnType<typeof rgb> {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A person's disc.
 *
 * ⚠️ INITIALS, NOT THE UPLOADED PHOTO. Embedding avatars would mean fetching a
 * remote image per row at export time — a report of 200 rows becomes 200 HTTP
 * requests inside a server action, any one of which can hang, and the whole export
 * fails because somebody's profile picture is on a slow host. The disc uses the
 * same hash and the same eight tints as the on-screen component, so a person is
 * the same colour in both places, which is what makes them scannable down a page.
 */
function drawAvatar(kit: Kit, name: string, x: number, top: number, size: number): void {
  const r = size / 2;
  kit.page.drawCircle({ x: x + r, y: up(top + r), size: r, color: avatarTint(name) });
  text(kit, initialsOf(name), {
    x: x + r,
    baseline: top + r + size * 0.19,
    size: size * 0.44,
    bold: true,
    color: INK.white,
    align: 'centre',
  });
}

/* ---- Status pill --------------------------------------------------------- */

function drawPill(kit: Kit, label: string, token: string, x: number, top: number): number {
  const size = 7.5;
  const ink = inkFor(token);
  const w = widthOf(kit.bold, label, size) + 12;
  const h = 14;

  /* The ground is the status colour at low strength. Mixed by hand rather than
     with an alpha, because a transparent fill over a striped row would take the
     stripe's tint and the same status would print two shades down one column. */
  const wash = rgb(
    ink.red * 0.16 + 0.84,
    ink.green * 0.16 + 0.84,
    ink.blue * 0.16 + 0.84,
  );

  roundedBox(kit, { x, top, w, h, r: h / 2, fill: wash });
  text(kit, label, { x: x + 6, baseline: top + 9.8, size, bold: true, color: ink });
  return w;
}

/* ============================================================================
 * THE DOCUMENT
 * ========================================================================= */

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    /* A missing asset must not fail the export; the wordmark still identifies it. */
    return null;
  }
}

export async function composeReportSheet(input: ReportSheetInput): Promise<Uint8Array> {
  const { report } = input;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${APP_NAME} - ${report.title} - ${report.subtitle}`);
  /* The ORGANISATION authors the file even though the masthead says Taskly. Owner,
     on the visible header: *"instead of writing this: my tool name, Taskly, over
     there."* That was about what a reader sees, not about who owns the document. */
  pdf.setAuthor(`${ORGANISATION_NAME} - ${DIVISION_NAME}`);
  pdf.setSubject(`${report.title} - ${report.period.start} to ${report.period.end}`);
  pdf.setProducer(APP_NAME);

  /* ⚠️ BOTH dates from the report's own generation date, never `new Date()`.
     `PDFDocument.create()` stamps CreationDate and ModDate from the clock, so two
     exports of one report differed byte for byte and "is this the file I
     circulated?" had no answer. A test asserts the bytes match. */
  const stamped = stampDate(input.generatedOn);
  pdf.setCreationDate(stamped);
  pdf.setModificationDate(stamped);

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await loadLogo(pdf);

  const kit: Kit = { page: pdf.addPage([PAGE_W, PAGE_H]), bold, regular };
  const newPage = (): number => {
    kit.page = pdf.addPage([PAGE_W, PAGE_H]);
    return drawMasthead(kit, input, logo, true);
  };

  let cursor = drawMasthead(kit, input, logo);
  /* Before the filter bar: the reader should know WHICH project and WHAT was
     promised before being told what was filtered out of it. */
  cursor = drawBanner(kit, input, cursor);
  cursor = drawFilterBar(kit, input, cursor);
  cursor = drawCards(kit, report, cursor);

  cursor = input.work
    ? drawWorkTable(kit, input.work, cursor, newPage)
    : drawGenericTable(
        kit,
        report,
        cursor,
        newPage,
        input.linkColumn ?? null,
        input.markColumn ?? null,
      );

  drawNotes(kit, report, cursor, newPage);

  /* Footers last, once the page count is known. "Page 1 of 4" written while page 1
     was being drawn would have to guess. */
  const pages = pdf.getPages();
  pages.forEach((page, index) =>
    drawFooter({ page, bold, regular }, input, index + 1, pages.length),
  );

  return pdf.save();
}

/** 'YYYY-MM-DD' → midday UTC, so no reader's timezone shifts the stamp a day. */
function stampDate(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return new Date(Date.UTC(2000, 0, 1, 12));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/* ---- Masthead ------------------------------------------------------------ */

/**
 * ⚠️ The visible name is `APP_NAME` — Taskly. Owner: *"the Kris and Nova
 * International is written at the top of the report… instead of writing this: my
 * tool name, Taskly, over there. AI Digital Dividend is fine."* That reversed an
 * earlier decision in this codebase that reports carry the company name, so it is
 * written down here rather than left to be re-litigated.
 */
function drawMasthead(
  kit: Kit,
  input: ReportSheetInput,
  logo: PDFImage | null,
  continuation = false,
): number {
  const logoH = 34;
  let x = M;

  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x, y: up(20 + logoH), width: logoW, height: logoH });
    x += logoW + 12;
  }

  text(kit, APP_NAME, { x, baseline: 36, size: 20, bold: true, color: INK.brand });
  text(kit, DIVISION_NAME, { x, baseline: 50, size: 10, color: INK.soft });

  text(kit, continuation ? `${safeTitle(input)} (cont.)` : safeTitle(input), {
    x: PAGE_W - M,
    baseline: 36,
    size: 19,
    bold: true,
    align: 'right',
  });
  text(kit, input.report.subtitle.replace(' · ', '  •  '), {
    x: PAGE_W - M,
    baseline: 50,
    size: 9,
    color: INK.soft,
    align: 'right',
  });

  bar(kit, 58, 1.8, INK.brand);
  return 72;
}

const safeTitle = (input: ReportSheetInput) => (input.work ? 'Work report' : input.report.title);

/* ---- Filter bar ---------------------------------------------------------- */

/**
 * ⚠️ NOT DECORATION. A report of one project and a report of thirteen look
 * identical once printed, and the person holding the sheet has no control panel to
 * check. This line is what stops a filtered figure being quoted in a meeting as
 * the division's total.
 */
/**
 * The subject of the report, centred, and the promise it is measured against.
 *
 * ⚠️ Returns `top` untouched when there is no banner, so every caller that does
 * not pass one is unaffected — attendance and finance both print through here.
 */
function drawBanner(kit: Kit, input: ReportSheetInput, top: number): number {
  const banner = input.banner;
  if (!banner) return top;

  const centre = M + CONTENT_W / 2;
  let cursor = top + 6;

  text(kit, banner.title, {
    x: centre,
    baseline: cursor + 17,
    size: 19,
    bold: true,
    color: INK.text,
    align: 'centre',
  });
  cursor += 26;

  /* A hairline the width of the title, centred under it — enough to read as a
     masthead for this section without becoming a second full-width rule beside
     the one the filter bar already draws. */
  const titleW = widthOf(kit.bold, banner.title, 19);
  kit.page.drawRectangle({
    x: centre - titleW / 2,
    y: up(cursor),
    width: titleW,
    height: 1,
    color: INK.brand,
  });
  cursor += 10;

  for (const line of banner.lines) {
    text(kit, line, {
      x: centre,
      baseline: cursor + 8,
      size: 8.4,
      color: INK.soft,
      align: 'centre',
    });
    cursor += 12;
  }

  return cursor + 6;
}

function drawFilterBar(kit: Kit, input: ReportSheetInput, top: number): number {
  const h = 26;
  const line =
    input.filterSummary.length > 0
      ? input.filterSummary.join('   •   ')
      : 'No filters applied - this covers everything in the period.';

  roundedBox(kit, { x: M, top, w: CONTENT_W, h, r: 6, fill: INK.wash });

  const r = 7;
  kit.page.drawCircle({ x: M + 12 + r, y: up(top + h / 2), size: r, color: INK.brand });
  text(kit, 'i', {
    x: M + 12 + r,
    baseline: top + h / 2 + 3,
    size: 9,
    bold: true,
    color: INK.white,
    align: 'centre',
  });

  /* One line only — the bar is a label, not a paragraph. If somebody selects nine
     projects the list is elided rather than pushing the table down the page. */
  const maxW = CONTENT_W - 44;
  let body = safe(line);
  if (widthOf(kit.regular, body, 8.5) > maxW) {
    while (body.length > 1 && widthOf(kit.regular, `${body}...`, 8.5) > maxW) {
      body = body.slice(0, -1);
    }
    body = `${body}...`;
  }
  text(kit, body, { x: M + 32, baseline: top + h / 2 + 3, size: 8.5, color: INK.soft });

  return top + h + 14;
}

/* ---- Summary cards ------------------------------------------------------- */

/** A small glyph per card, drawn from primitives rather than a path — four simple
 *  shapes are more reliable than four hand-copied path strings. */
function drawCardGlyph(kit: Kit, index: number, cx: number, cy: number): void {
  const w = INK.white;
  switch (index % 4) {
    case 0: // rows — a list
      for (let i = 0; i < 3; i += 1) {
        kit.page.drawRectangle({ x: cx - 7, y: up(cy - 4 + i * 4.5), width: 3, height: 2.4, color: w });
        kit.page.drawRectangle({ x: cx - 2, y: up(cy - 4 + i * 4.5), width: 9, height: 2.4, color: w });
      }
      return;
    case 1: // posts — a page
      kit.page.drawRectangle({ x: cx - 6, y: up(cy + 7), width: 12, height: 14, color: w });
      for (let i = 0; i < 3; i += 1) {
        kit.page.drawRectangle({
          x: cx - 4,
          y: up(cy - 2 + i * 3.4),
          width: i === 2 ? 4 : 8,
          height: 1.4,
          color: INK.brand,
        });
      }
      return;
    case 2: // done — a tick in a ring
      kit.page.drawCircle({ x: cx, y: up(cy), size: 7.5, borderColor: w, borderWidth: 1.6 });
      kit.page.drawLine({
        start: { x: cx - 3.4, y: up(cy) },
        end: { x: cx - 1, y: up(cy + 2.6) },
        thickness: 1.6,
        color: w,
      });
      kit.page.drawLine({
        start: { x: cx - 1, y: up(cy + 2.6) },
        end: { x: cx + 3.6, y: up(cy - 3) },
        thickness: 1.6,
        color: w,
      });
      return;
    default: // open — a clock
      kit.page.drawCircle({ x: cx, y: up(cy), size: 7.5, borderColor: w, borderWidth: 1.6 });
      kit.page.drawLine({
        start: { x: cx, y: up(cy) },
        end: { x: cx, y: up(cy - 4.4) },
        thickness: 1.4,
        color: w,
      });
      kit.page.drawLine({
        start: { x: cx, y: up(cy) },
        end: { x: cx + 3.4, y: up(cy) },
        thickness: 1.4,
        color: w,
      });
  }
}

function drawCards(kit: Kit, report: Report, top: number): number {
  const figures = report.figures.slice(0, 4);
  if (figures.length === 0) return top;

  const gap = 12;
  const w = (CONTENT_W - gap * (figures.length - 1)) / figures.length;
  const h = 62;

  figures.forEach((figure, index) => {
    const x = M + index * (w + gap);
    roundedBox(kit, { x, top, w, h, r: 8, fill: INK.white, border: INK.rule });

    /* The teal tile. Owner: *"the coloured cards that are showing the summary
       should be proper in colour."* A filled brand square per card, which is what
       carries the colour — the card itself stays white so the numbers keep their
       contrast. */
    const tile = 34;
    const tileX = x + 14;
    const tileTop = top + (h - tile) / 2;
    roundedBox(kit, { x: tileX, top: tileTop, w: tile, h: tile, r: 8, fill: INK.brand });
    drawCardGlyph(kit, index, tileX + tile / 2, tileTop + tile / 2);

    const textX = tileX + tile + 12;
    const room = w - (textX - x) - 14;

    text(kit, figure.label.toUpperCase(), {
      x: textX,
      baseline: top + 24,
      size: 7,
      bold: true,
      color: INK.soft,
    });
    text(kit, cellText(figure.value), {
      x: textX,
      baseline: top + 45,
      size: 21,
      bold: true,
      color: INK.text,
    });
    if (figure.hint) {
      /* One line, and only if it fits — the card has a fixed height and a hint
         that wrapped would run out of the bottom of it. */
      const hint = safe(figure.hint);
      if (widthOf(kit.regular, hint, 6.8) <= room) {
        text(kit, hint, { x: textX, baseline: top + 55, size: 6.8, color: INK.faint });
      }
    }
  });

  return top + h + 16;
}

/* ============================================================================
 * THE WORK TABLE
 * ========================================================================= */

interface Column {
  readonly label: string;
  readonly share: number;
  readonly align?: 'left' | 'right' | 'centre';
}

/**
 * ⚠️ Shares sum to 100 and are checked by a test.
 *
 * The four count columns are narrow because they hold one or two digits — it is
 * their HEADINGS that are two words, and headings wrap. Giving each the width its
 * label wanted is what pushed Last Activity off the first version's page.
 */
/* ── ⚠️ SHARES SUM TO 100, AND TASKS TOOK THE ROOM IT NEEDED ────────────────
   The Role column was 7 because one word fitted in it. Task TITLES do not: at 7
   every line wrapped to two or three and the rows grew tall enough to push a
   twelve-row report onto three pages.

   The 9 points came off Content Type and Activity Summary, which are the two
   columns that summarise what the Tasks column now states outright — "3 posts,
   2 reels" beside the three post titles is the same fact twice, so the summary
   is the one that can afford to be tighter. */
const WORK_COLUMNS: readonly Column[] = [
  { label: 'Project', share: 10 },
  { label: 'Person', share: 12 },
  { label: 'Tasks', share: 15 },
  { label: 'Platform', share: 8 },
  { label: 'Tasks Assigned', share: 6, align: 'centre' },
  { label: 'Tasks Done', share: 6, align: 'centre' },
  { label: 'Tasks Pending', share: 6, align: 'centre' },
  /* ⚠️ 7, NOT 6. At 6% the inner width is 34.7pt and "Published" measures 35.3pt
     in the header face — six tenths of a point short, so the wrapper did what it
     is built to do with a word that cannot fit and broke it: the sheet printed
     "Posts Publishe" over "d". Visible in the rendered PDF and in nothing else.
     The point came off Tasks, which has the most to spare. */
  { label: 'Posts Published', share: 7, align: 'centre' },
  { label: 'Content Type', share: 8 },
  { label: 'Activity Summary', share: 7 },
  { label: 'Status', share: 8 },
  { label: 'Last Activity', share: 7, align: 'centre' },
];

const CELL_PAD = 6;
const LINE_H = 9.5;
const BODY_SIZE = 7.6;
/* The header face's size. Named rather than repeated as a literal in `drawHead`,
   because a test has to measure headings against it — a column narrower than one
   of its own heading words breaks that word in half, and only the drawn PDF shows
   it. See the "gives every heading word room to be whole" test. */
const HEAD_SIZE = 7.4;

function columnBoxes(columns: readonly Column[]): { x: number; w: number }[] {
  const boxes: { x: number; w: number }[] = [];
  let x = M;
  for (const column of columns) {
    const w = (CONTENT_W * column.share) / 100;
    boxes.push({ x, w });
    x += w;
  }
  return boxes;
}

/**
 * The header band. Returns the y beneath it.
 *
 * ⚠️ Labels WRAP to two lines. Owner: *"the table header should be in two rows."*
 * It is also what makes the count columns narrow enough for everything to fit.
 */
function drawHead(kit: Kit, columns: readonly Column[], top: number): number {
  const boxes = columnBoxes(columns);
  const wrapped = columns.map((column, i) =>
    wrap(kit.bold, column.label, HEAD_SIZE, boxes[i].w - CELL_PAD * 2),
  );
  const lines = Math.max(...wrapped.map((w) => w.length));
  const h = lines * LINE_H + 10;

  bar(kit, top, h, INK.brand);

  columns.forEach((column, i) => {
    const { x, w } = boxes[i];
    const block = wrapped[i];
    /* Bottom-aligned, so a one-line heading sits on the same baseline as the last
       line of a two-line one. A top-aligned mix reads as a broken grid. */
    const firstBaseline = top + h - 7 - (block.length - 1) * LINE_H;
    block.forEach((line, index) => {
      const anchor =
        column.align === 'centre' ? x + w / 2 : column.align === 'right' ? x + w - CELL_PAD : x + CELL_PAD;
      text(kit, line, {
        x: anchor,
        baseline: firstBaseline + index * LINE_H,
        size: HEAD_SIZE,
        bold: true,
        color: INK.white,
        align: column.align ?? 'left',
      });
    });
  });

  return top + h;
}

/** Everything one work row needs to know before any of it is drawn. */
interface Measured {
  readonly lines: string[][];
  readonly height: number;
}

function measureWorkRow(kit: Kit, row: WorkRow, boxes: { x: number; w: number }[]): Measured {
  const inner = (i: number) => boxes[i].w - CELL_PAD * 2;
  const w = (i: number, value: string) => wrap(kit.regular, value, BODY_SIZE, inner(i));

  const lines: string[][] = [
    wrap(kit.bold, row.projectName, BODY_SIZE, inner(0)),
    /* The name shares its cell with a 15pt disc. */
    wrap(kit.regular, row.personName, BODY_SIZE, inner(1) - 19),
    /* ── ⚠️ THE TASKS, WHERE THE ROLE WAS — 2026-09-03 ─────────────────────
       Owner asked for the report to name the work rather than repeat a role
       word, and asked for the PDF to carry the same: *"these all things should
       also be exported, like the tasks, whoever done which task should also be
       exported in the PDF."*

       Every task, one per line, wrapped — NOT capped at three the way the screen
       caps it. The screen has a detail panel one click behind it; a printed
       sheet has nothing behind it, so an export that said "and 4 more" would be
       a document with information deliberately withheld. The row grows and the
       page break moves with it, which `measureWorkRow` already handles. */
    row.tasks.length > 0
      ? row.tasks.flatMap((task) => wrap(kit.regular, task.title, BODY_SIZE, inner(2)))
      : ['-'],
    [''], // platform marks, measured separately below
    [String(row.tasksAssigned)],
    [String(row.tasksDone)],
    [String(row.tasksPending)],
    [String(row.postsPublished)],
    w(8, row.contentTypes.length > 0 ? row.contentTypes.join(', ') : '-'),
    w(9, row.activitySummary || '-'),
    [''], // pill
    [row.lastActive ? row.lastActive.slice(0, 10) : '-'],
  ];

  /* Marks wrap onto further lines when a person posts to more platforms than fit. */
  const perRow = Math.max(1, Math.floor(inner(3) / 16));
  const markLines = Math.max(1, Math.ceil(row.platforms.length / perRow));

  const tallest = Math.max(...lines.map((l) => l.length), markLines);
  return { lines, height: Math.max(24, tallest * LINE_H + 11) };
}

function drawWorkTable(
  kit: Kit,
  work: WorkReport,
  startTop: number,
  newPage: () => number,
): number {
  const boxes = columnBoxes(WORK_COLUMNS);
  let top = drawHead(kit, WORK_COLUMNS, startTop);

  if (work.rows.length === 0) {
    text(kit, 'No work matched this period and filter.', {
      x: M + CELL_PAD,
      baseline: top + 16,
      size: 8,
      color: INK.faint,
    });
    return top + 26;
  }

  work.rows.forEach((row, index) => {
    const measured = measureWorkRow(kit, row, boxes);

    /* ⚠️ THE WHOLE ROW MOVES, OR NONE OF IT DOES. Owner: *"not fitting all the
       text on a single page. If it is extended to the next page, then move them to
       the next page."* Splitting a row across a page break is what produces a
       three-line cell with one line stranded at the top of the next sheet. */
    if (top + measured.height > FLOOR) {
      top = newPage();
      top = drawHead(kit, WORK_COLUMNS, top);
    }

    if (index % 2 === 1) bar(kit, top, measured.height, INK.stripe);

    drawWorkRow(kit, row, boxes, top, measured);
    kit.page.drawRectangle({
      x: M,
      y: up(top + measured.height),
      width: CONTENT_W,
      height: 0.5,
      color: INK.rule,
    });

    top += measured.height;
  });

  return top;
}

function drawWorkRow(
  kit: Kit,
  row: WorkRow,
  boxes: { x: number; w: number }[],
  top: number,
  measured: Measured,
): void {
  const first = top + 15;

  const block = (i: number, bold = false, color = INK.soft, offset = 0) => {
    const column = WORK_COLUMNS[i];
    const { x, w } = boxes[i];
    measured.lines[i].forEach((line, index) => {
      const anchor =
        column.align === 'centre'
          ? x + w / 2
          : column.align === 'right'
            ? x + w - CELL_PAD
            : x + CELL_PAD + offset;
      text(kit, line, {
        x: anchor,
        baseline: first + index * LINE_H,
        size: BODY_SIZE,
        bold,
        color,
        align: column.align ?? 'left',
      });
    });
  };

  block(0, true, INK.text);

  /* Person: the disc, then the name beside it. */
  drawAvatar(kit, row.personName, boxes[1].x + CELL_PAD, top + 6, 15);
  block(1, false, INK.text, 19);

  block(2);

  /* Platform marks, wrapping onto further lines. */
  const inner3 = boxes[3].w - CELL_PAD * 2;
  const perRow = Math.max(1, Math.floor(inner3 / 16));
  if (row.platforms.length === 0) {
    text(kit, '-', { x: boxes[3].x + CELL_PAD, baseline: first, size: BODY_SIZE, color: INK.faint });
  } else {
    row.platforms.forEach((slug, i) => {
      drawMark(
        kit,
        slug,
        boxes[3].x + CELL_PAD + (i % perRow) * 16,
        top + 7 + Math.floor(i / perRow) * 16,
        13,
      );
    });
  }

  block(4, false, INK.text);
  block(5, false, INK.text);
  block(6, false, INK.text);
  block(7, true, INK.text);
  block(8);
  block(9);

  const status = WORK_STATUS_META[row.status];
  drawPill(kit, status.label, status.token, boxes[10].x + CELL_PAD, top + 6);

  block(11, false, INK.soft);
}

/* ============================================================================
 * THE GENERIC TABLE — the four analytical report types
 * ========================================================================= */

const isNumeric = (column: ReportColumn) =>
  column.kind === 'number' || column.kind === 'percent' || column.kind === 'duration';

/**
 * Widths measured from content, since these reports have arbitrary columns.
 *
 * ⚠️ `column.width` is a SPREADSHEET hint — character counts, for .xlsx — not
 * points. Using it directly would produce a 24pt-wide "Person" column. It is read
 * only as a signal that a column is wide.
 */
function genericColumns(kit: Kit, report: Report): Column[] {
  const wants = report.columns.map((column, index) => {
    let widest = widthOf(kit.bold, column.label, HEAD_SIZE) * 0.6;
    /* Sampled: 200 rows finds the widest name without measuring 45,000 strings. */
    for (const row of report.rows.slice(0, 200)) {
      const cell = row[index];
      if (cell) widest = Math.max(widest, widthOf(kit.regular, cellText(cell), BODY_SIZE));
    }
    return Math.min(widest + CELL_PAD * 2, CONTENT_W * 0.22);
  });

  const total = wants.reduce((a, b) => a + b, 0) || 1;
  return report.columns.map((column, index) => ({
    label: column.label,
    share: (wants[index] / total) * 100,
    align: isNumeric(column) ? ('right' as const) : ('left' as const),
  }));
}

function drawGenericTable(
  kit: Kit,
  report: Report,
  startTop: number,
  newPage: () => number,
  /* One column of real links, or nothing — see `ReportSheetInput.linkColumn`. */
  linkColumn: ReportSheetInput['linkColumn'] = null,
  markColumn: ReportSheetInput['markColumn'] = null,
): number {
  const columns = genericColumns(kit, report);
  const boxes = columnBoxes(columns);
  let top = drawHead(kit, columns, startTop);

  if (report.rows.length === 0) {
    text(kit, 'No rows matched this period and filter.', {
      x: M + CELL_PAD,
      baseline: top + 16,
      size: 8,
      color: INK.faint,
    });
    return top + 26;
  }

  report.rows.forEach((row, rowIndex) => {
    const lines = row.map((cell, i) =>
      wrap(kit.regular, cellText(cell), BODY_SIZE, boxes[i].w - CELL_PAD * 2),
    );
    const height = Math.max(20, Math.max(...lines.map((l) => l.length)) * LINE_H + 10);

    if (top + height > FLOOR) {
      top = newPage();
      top = drawHead(kit, columns, top);
    }

    if (rowIndex % 2 === 1) bar(kit, top, height, INK.stripe);

    lines.forEach((block, i) => {
      const column = columns[i];
      const { x, w } = boxes[i];
      /* The link column, if this report has one — see `linkColumn`. */
      const href = linkColumn?.index === i ? (linkColumn.hrefs[rowIndex] ?? null) : null;

      /* ── ⚠️ MARKS INSTEAD OF WORDS ───────────────────────────────────────
         Drawn here and the text SKIPPED — not drawn on top of it. The row still
         carries the platform names so the .xlsx export and the on-screen table
         stay readable; only this renderer swaps them for the brand marks the
         owner asked for. Wraps onto further lines when a post reached more
         platforms than fit, exactly as the work table does. */
      const marks = markColumn?.index === i ? (markColumn.slugs[rowIndex] ?? []) : null;
      if (marks) {
        if (marks.length === 0) {
          text(kit, '-', {
            x: x + CELL_PAD,
            baseline: top + 13,
            size: BODY_SIZE,
            color: INK.faint,
          });
        } else {
          const perRow = Math.max(1, Math.floor((w - CELL_PAD * 2) / 15));
          marks.forEach((slug, at) => {
            drawMark(
              kit,
              slug,
              x + CELL_PAD + (at % perRow) * 15,
              top + 6 + Math.floor(at / perRow) * 15,
              12,
            );
          });
        }
        return;
      }

      block.forEach((line, index) => {
        const anchor = column.align === 'right' ? x + w - CELL_PAD : x + CELL_PAD;
        const baseline = top + 13 + index * LINE_H;

        text(kit, line, {
          x: anchor,
          baseline,
          size: BODY_SIZE,
          bold: i === 0,
          /* A link is drawn in the accent so it reads as one before anybody
             hovers it. Everything else keeps the table's own two inks. */
          color: href ? INK.brand : i === 0 ? INK.text : INK.soft,
          align: column.align,
        });

        /* ⚠️ Only the FIRST line of a wrapped address gets the annotation. A
           long URL that wraps would otherwise get one box per line, and the
           second would sit under text that is the middle of the address — a
           click target on half a link. The first line is where the eye goes. */
        if (href && index === 0) {
          /* ⚠️ MEASURED, not returned: `text()` draws and returns void, so the
             box is sized with the same measurer the column widths use. Falling
             back to the cell width would make the whole cell clickable, which is
             a larger target than the thing it points at. */
          const drawn = widthOf(kit.regular, line, BODY_SIZE);
          linkTo(kit, href, {
            x: anchor,
            y: baseline - 2,
            width: drawn > 0 ? drawn : w - CELL_PAD * 2,
            height: LINE_H,
          });
        }
      });
    });

    kit.page.drawRectangle({
      x: M,
      y: up(top + height),
      width: CONTENT_W,
      height: 0.5,
      color: INK.rule,
    });
    top += height;
  });

  return top;
}

/* ---- Notes --------------------------------------------------------------- */

/**
 * What the report counts, verbatim from the engine.
 *
 * ⚠️ On the PDF for the same reason it is on the screen: a number without its
 * definition is how two people read one report and disagree. A printed sheet is
 * MORE exposed to that, because the reader cannot hover anything to find out what
 * "on time" means.
 */
function drawNotes(kit: Kit, report: Report, after: number, newPage: () => number): void {
  if (report.notes.length === 0) return;

  const blocks = report.notes.map((note) => wrap(kit.regular, note, 7.2, CONTENT_W - 22));
  const needed = 18 + blocks.reduce((sum, b) => sum + b.length * 9 + 3, 0);

  /* ⚠️ Measured as a whole and placed BELOW the table. An earlier version pinned
     this near the page bottom regardless of where the table ended, which was fine
     on a short report and drew straight through the last rows on a full one. */
  let top = after + 16;
  if (top + needed > FLOOR) top = newPage();

  text(kit, 'WHAT THIS REPORT COUNTS', {
    x: M,
    baseline: top + 8,
    size: 7,
    bold: true,
    color: INK.soft,
  });
  top += 16;

  for (const block of blocks) {
    kit.page.drawCircle({ x: M + 3, y: up(top + 4), size: 1.6, color: INK.brand });
    for (const line of block) {
      text(kit, line, { x: M + 12, baseline: top + 7, size: 7.2, color: INK.soft });
      top += 9;
    }
    top += 3;
  }
}

/* ---- Footer -------------------------------------------------------------- */

function drawFooter(kit: Kit, input: ReportSheetInput, page: number, of: number): void {
  const baseline = PAGE_H - 22;
  bar(kit, PAGE_H - 36, 1.2, INK.brand);

  text(kit, `${APP_NAME}  •  ${DIVISION_NAME}`, {
    x: M,
    baseline,
    size: 7.5,
    bold: true,
    color: INK.brand,
  });
  text(kit, `Generated ${input.generatedOn} by ${input.generatedBy}`, {
    x: PAGE_W / 2,
    baseline,
    size: 7.5,
    color: INK.faint,
    align: 'centre',
  });
  text(kit, `Page ${page} of ${of}`, {
    x: PAGE_W - M,
    baseline,
    size: 7.5,
    color: INK.faint,
    align: 'right',
  });
}

/* ============================================================================
 * EXPORTED FOR THE LAYOUT TESTS
 * ----------------------------------------------------------------------------
 * ⚠️ The geometry, not the drawing. There is no PDF rasteriser on this machine, so
 * "does the text fit" cannot be checked by looking at a picture — but it does not
 * need to be, because it is arithmetic: a cell fits if every wrapped line measures
 * narrower than its column, and a row is tall enough if its height covers its
 * tallest cell. Both are decidable from the same functions the composer uses,
 * which is what these expose.
 *
 * The owner's complaints were exactly these two properties — *"the text is cutting
 * so instead of cutting move it to the next line"* and *"increase the height of the
 * row"* — so they are the two things worth pinning.
 * ========================================================================= */
export const __layout = {
  WORK_COLUMNS,
  CONTENT_W,
  CELL_PAD,
  LINE_H,
  BODY_SIZE,
  HEAD_SIZE,
  FLOOR,
  M,
  columnBoxes,
  wrap,
  widthOf,
  measureWorkRow,
  safe,
};
