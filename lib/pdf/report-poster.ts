import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import {
  activityTitle,
  breakdownTitle,
  breakdownTotalLabel,
  glanceTitle,
  isDailyLayout,
  type ReportContent,
} from '@/lib/domain/report-content';
import { PLATFORM_MARKS, LINKEDIN_SHAPES, slugForPlatformName } from '@/lib/brand/platform-marks';

/* ============================================================================
 * THE REPORT PAGE, DRAWN — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"All are the reference images for the yesterday, daily, monthly, or weekly reports
 * so design exactly as it is shown in the images. Plus if you need some images like the
 * ones shown in these images… I will provide them to you."*
 *
 * Then, having supplied six of them: *"Provide all these images related to the reference
 * images… Now design, because the purpose of giving all these things is that I want the
 * same presentation."*
 *
 * ── ⚠️ WHY THIS EXISTS ALONGSIDE THE IMAGE MODEL ──────────────────────────────
 * The first build of this feature sent the reference layout to `gpt-image-1` and put the
 * result in a PDF. It worked, and the FIGURES came back right — 32 / 27 / 5 / 21 / 6 /
 * 84% / 61 all correct. What it garbled was WORDS: the project name came back as
 * "NAYA MARKITING", a heading as "RERIIMED", "3 PROGRAMMES MANAGED" with a stray
 * apostrophe, the date as 2025 when 2026 was sent, and the division's logo redrawn
 * rather than reproduced. Measured, not predicted.
 *
 * A document with the client's own name misspelled on it cannot be sent, so the same
 * layout is drawn here instead — from the owner's own illustration assets, the real logo
 * file, and the same brand marks the application uses on screen. Every glyph is
 * typeset, so nothing can be misspelled. `REPORT_POSTER_MODEL=1` still routes back
 * through the image model for anyone who wants it; see `app/actions/project-report.ts`.
 *
 * ── ⚠️ WHERE THE PIECES COME FROM ─────────────────────────────────────────────
 * `assets/render/` holds trimmed, downscaled copies of the owner's assets — the
 * originals are 1448×1086 with the illustration floating in a transparent field, which
 * cannot be positioned. `tmp-prep-assets.mjs` (not kept) produced them; the originals
 * stay beside them as the source of truth.
 *
 * `activity.png` is the whole activity panel in one piece — monitor, speech bubble,
 * paper plane, megaphone, plant — and it has an EMPTY CIRCLE in it, which is the whole
 * reason it was supplied. `ACTIVITY_CIRCLE` records where that circle is, as fractions
 * of the image, so the total is drawn into it rather than beside it.
 *
 * ── ⚠️ EVERY COORDINATE IS MEASURED FROM THE PAGE TOP ─────────────────────────
 * pdf-lib's origin is the bottom-left, which makes a top-down design read backwards and
 * every later edit shift things the wrong way. `up()` converts once, at the boundary.
 * Nothing below it thinks in pdf-lib coordinates.
 * ========================================================================= */

/* A4 landscape, in points. The reference is 4:3 (1448×1086) and A4 is 1.414:1 — so the
   design is laid out for A4 directly rather than scaled, and the background asset is
   stretched to fill. Stretching a soft gradient is invisible; letterboxing it would not
   be. */
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 20;

/** The left column holds the tables; the right holds the panels. */
const LEFT_X = M;
const LEFT_W = 492;
const RIGHT_X = LEFT_X + LEFT_W + 12;
const RIGHT_W = PAGE_W - M - RIGHT_X;
const CONTENT_BOTTOM = 522;

/* ── ⚠️ THE VERTICAL BUDGET, IN ONE PLACE ─────────────────────────────────────
   Seven days plus a total plus a platform list plus two card headings is genuinely more
   than an A4 landscape column holds at a readable size, so every point here was
   argued for. The rows a week report shows are structural — a DAY BY DAY table missing
   two days is not the document that was asked for — which is why the KPI band and the
   column start were tightened rather than the table.

   ⚠️ `*_CHROME` must equal what the drawing functions actually consume above and below
   their rows. They disagreed once (54 against a real 64) and the allocator sized a card
   for eight rows that could only draw five. */
const KPI_TOP = 182;
const KPI_H = 60;
const COLUMN_TOP = KPI_TOP + KPI_H + 8;
const TABLE_CHROME = 64;
const PLATFORM_CHROME = 57;
/** The smallest row pitch that is still readable at 7.6pt. Below this, rows are dropped. */
const MIN_PITCH = 10.5;
const MAX_PITCH = 17;

/**
 * Where the empty circle sits inside `activity.png`, as fractions of its width/height.
 * ⚠️ Measured off the asset, not guessed — but measured by eye against the rendered
 * page rather than by thresholding, because the monitor screen behind the circle is
 * nearly as light as the circle itself and no threshold separates them.
 */
const ACTIVITY_CIRCLE = { cx: 0.464, cy: 0.487, r: 0.216 } as const;

/* ── The palette, taken from the reference ─────────────────────────────────── */
const NAVY = rgb(0.059, 0.145, 0.251);
const TEAL = rgb(0.055, 0.42, 0.373);
const GREEN = rgb(0.055, 0.478, 0.373);
const BLUE = rgb(0.145, 0.388, 0.851);
const PURPLE = rgb(0.427, 0.247, 0.647);
const INK = rgb(0.12, 0.16, 0.18);
const GREY = rgb(0.42, 0.47, 0.48);
const FAINT = rgb(0.62, 0.66, 0.67);
const LINE = rgb(0.886, 0.918, 0.918);
const SOFT = rgb(0.957, 0.976, 0.976);
const WHITE = rgb(1, 1, 1);

/** The three KPI accents, in the order the owner set them. */
const KPI_ACCENT = [BLUE, GREEN, PURPLE] as const;

export interface ReportPosterMeta {
  readonly generatedOn: string;
  readonly generatedBy: string;
}

/* ============================================================================
 * A SMALL DRAWING KIT
 * ----------------------------------------------------------------------------
 * Enough primitives to lay out a page and no more. Each one takes coordinates
 * measured DOWN from the page top; `up()` is the only place the flip happens.
 * ========================================================================= */

function up(fromTop: number): number {
  return PAGE_H - fromTop;
}

/**
 * 'YYYY-MM-DD' → midday UTC on that day.
 *
 * ⚠️ Midday rather than midnight so that no reader's timezone can shift the stamp onto
 * the previous or next date, and a fixed fallback rather than `new Date()` on a
 * malformed value — a clock here would break the determinism the dates exist to give.
 */
function stampDate(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return new Date(Date.UTC(2000, 0, 1, 12));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/**
 * A rounded rectangle as an SVG path, in a box whose origin is its top-left.
 *
 * ⚠️ Cubic béziers rather than arc commands. pdf-lib converts arcs to curves before it
 * mirrors the y-axis, so arcs would in fact survive — but a bézier corner is the same
 * shape with no dependence on how a sweep flag is interpreted, and this path is drawn
 * dozens of times per page.
 */
function roundedRect(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
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

interface Kit {
  readonly page: PDFPage;
  readonly bold: PDFFont;
  readonly regular: PDFFont;
}

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS on anything outside it — so one
 * curly quote in a project name would fail the whole PDF. Everything is funnelled
 * through here. The dashes, quotes, bullet, middle dot and ellipsis the layout uses are
 * all inside WinAnsi; anything else becomes a hyphen rather than an exception.
 */
function safe(text: string): string {
  return text
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/[^ -ÿ–—•·…]/g, '-');
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(safe(text), size);
}

interface TextOptions {
  readonly x: number;
  /** Distance from the page top to the text BASELINE. */
  readonly baseline: number;
  readonly size: number;
  readonly bold?: boolean;
  readonly color?: ReturnType<typeof rgb>;
  /** Letter-spacing, for the small-caps labels the reference uses throughout. */
  readonly tracking?: number;
  /** Truncate with an ellipsis rather than running off the edge. */
  readonly maxWidth?: number;
}

function draw(kit: Kit, raw: string, options: TextOptions): number {
  const font = options.bold ? kit.bold : kit.regular;
  let text = safe(raw);

  if (options.maxWidth !== undefined) {
    text = clip(font, text, options.size, options.maxWidth, options.tracking ?? 0);
  }

  const color = options.color ?? INK;
  const y = up(options.baseline);

  /* ⚠️ Tracking is applied by drawing glyph by glyph. pdf-lib has no character-spacing
     option, and the reference's small-caps labels are unrecognisable without it. Only
     used on short labels, where the cost of N draw calls does not matter. */
  if (options.tracking && options.tracking > 0) {
    let x = options.x;
    for (const character of text) {
      kit.page.drawText(character, { x, y, size: options.size, font, color });
      x += font.widthOfTextAtSize(character, options.size) + options.tracking;
    }
    return x - options.x - options.tracking;
  }

  kit.page.drawText(text, { x: options.x, y, size: options.size, font, color });
  return font.widthOfTextAtSize(text, options.size);
}

/** Truncate to fit, with a real ellipsis. Returns the text, never the width. */
function clip(font: PDFFont, text: string, size: number, maxWidth: number, tracking: number): string {
  const width = (value: string) =>
    font.widthOfTextAtSize(value, size) + Math.max(0, value.length - 1) * tracking;

  if (width(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && width(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The largest size at or below `preferred` at which the text fits.
 *
 * ⚠️ Used wherever a label is a FACT rather than prose — the period in the badge, the
 * KPI captions, the project's own name. Clipping "17 Aug – 23 Aug 2026" to
 * "17 Aug – 23 Aug…" loses the year on a document that will be read months later, and
 * "TARGET FOR THIS…" leaves the reader guessing which period the number belongs to.
 * Prose gets `maxWidth` and an ellipsis; facts get this.
 */
function fitSize(
  font: PDFFont,
  text: string,
  preferred: number,
  maxWidth: number,
  floor: number,
  tracking = 0,
): number {
  let size = preferred;
  const width = (at: number) =>
    font.widthOfTextAtSize(safe(text), at) + Math.max(0, safe(text).length - 1) * tracking;
  while (size > floor && width(size) > maxWidth) size -= 0.25;
  return size;
}

/** Break text into lines that fit. Word-wrapping only; no hyphenation. */
function wrap(font: PDFFont, raw: string, size: number, maxWidth: number): string[] {
  const words = safe(raw).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface CardOptions {
  readonly x: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
  readonly radius?: number;
  readonly fill?: ReturnType<typeof rgb>;
  readonly border?: ReturnType<typeof rgb> | null;
  readonly borderWidth?: number;
}

function card(kit: Kit, options: CardOptions): void {
  const radius = options.radius ?? 8;
  kit.page.drawSvgPath(roundedRect(options.w, options.h, radius), {
    x: options.x,
    y: up(options.top),
    color: options.fill ?? WHITE,
    borderColor: options.border === null ? undefined : (options.border ?? LINE),
    borderWidth: options.border === null ? 0 : (options.borderWidth ?? 0.8),
  });
}

/** A stroked icon in a 24×24 box, scaled to `size`. */
function strokeIcon(
  kit: Kit,
  svg: string,
  x: number,
  top: number,
  size: number,
  color: ReturnType<typeof rgb>,
  weight = 1.6,
): void {
  kit.page.drawSvgPath(svg, {
    x,
    y: up(top),
    scale: size / 24,
    borderColor: color,
    borderWidth: weight * (size / 24),
  });
}

function hairline(
  kit: Kit,
  x1: number,
  x2: number,
  top: number,
  color = LINE,
  thickness = 0.7,
): void {
  kit.page.drawLine({
    start: { x: x1, y: up(top) },
    end: { x: x2, y: up(top) },
    thickness,
    color,
  });
}

/* ── Icons, as 24×24 paths. Line work only — no arc commands, so each one is the
      same shape whichever way a renderer reads a sweep flag. ─────────────────── */
const ICON = {
  calendar: 'M4 6h16v15H4zM4 11h16M8 3v5M16 3v5',
  target: 'M12 2v3M12 19v3M2 12h3M19 12h3',
  check: 'M5.5 12.5 10 17l8.5-9',
  hourglass: 'M6 3h12M6 21h12M7 3v2l5 7 5-7V3M7 21v-2l5-7 5 7v2',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7',
  trend: 'M3 17l6-6 4 4 7-8M15 7h6v6',
  image: 'M3 5h18v14H3zM3 17l6-6 4 4 4-4 4 4',
  clock: 'M12 7v5l4 2',
  link: 'M10 14 20 4M14 4h6v6',
  play: 'M9 7l9 5-9 5z',
  pie: 'M12 3v9h9M12 3a9 9 0 1 0 9 9',
  info: 'M12 11v6M12 7.5v.5',
} as const;

/* ============================================================================
 * ASSETS
 * ----------------------------------------------------------------------------
 * Read from disk per render. ⚠️ Not cached in a module-level map: a serverless
 * invocation renders one PDF and then dies, so a cache would only ever be cold, and a
 * warm one would pin ~1 MB of image data per instance for no gain.
 * ========================================================================= */

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadImage(pdf: PDFDocument, file: string): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, file)));
  } catch {
    /* ⚠️ A missing decoration must not lose the report. The page is designed to read
       correctly without any of them — they are illustration, and the figures are type. */
    return null;
  }
}

/* ============================================================================
 * THE PAGE
 * ========================================================================= */

export async function composeReportPdf(
  content: ReportContent,
  meta: ReportPosterMeta,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  pdf.setTitle(`${content.projectName} — ${content.periodLabel}`);
  pdf.setAuthor('Crescent Nova International · AI & Digital Division');
  pdf.setSubject(`${content.kindLabel} for ${content.projectName}`);
  pdf.setProducer('CNI CRM');

  /* ⚠️ BOTH dates are set from the report's own generation date, not from the clock.
     `PDFDocument.create()` stamps CreationDate and ModDate with `new Date()`, so two
     builds of the same stored report differed byte for byte — and "is this the file I
     sent the client?" then has no answer. A test asserts the bytes match. */
  const stamped = stampDate(meta.generatedOn);
  pdf.setCreationDate(stamped);
  pdf.setModificationDate(stamped);

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const kit: Kit = {
    page,
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    regular: await pdf.embedFont(StandardFonts.Helvetica),
  };

  /* ⚠️ SEQUENTIAL, not `Promise.all`. Each `embedPng` appends an XObject to the
     document in call order, and with four concurrent `readFile`s that order is whichever
     file the disk returned first — so two builds of the same report produced different
     bytes. Measured: the object at offset 85 was the desk illustration in one and the
     logo in the other. Four small reads cost nothing; determinism is worth more. */
  const background = await loadImage(pdf, 'background.png');
  const logo = await loadImage(pdf, 'logo.png');
  const activity = await loadImage(pdf, 'activity.png');
  const desk = await loadImage(pdf, 'desk.png');

  if (background) {
    page.drawImage(background, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  } else {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE });
  }

  drawHeader(kit, content, logo);
  drawTitleBlock(kit, content);
  drawPlatformCard(kit, content);
  drawKpiRow(kit, content);
  drawActivityPanel(kit, content, activity);
  drawGlancePanel(kit, content);
  drawLeftColumn(kit, content);
  drawFooter(kit, content, meta, desk);

  return pdf.save();
}

/* ── Header: logo, wordmark, and the period badge ──────────────────────────── */
function drawHeader(kit: Kit, content: ReportContent, logo: PDFImage | null): void {
  const logoH = 34;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x: M + 2, y: up(20 + logoH), width: logoW, height: logoH });
  }

  const textX = M + 2 + (logo ? (logo.width / logo.height) * logoH : 0) + 12;
  draw(kit, 'Crescent Nova International', {
    x: textX,
    baseline: 36,
    size: 16.5,
    bold: true,
    color: NAVY,
  });
  draw(kit, 'AI & Digital Division', { x: textX, baseline: 52, size: 11, color: TEAL });

  /* The badge. Right-aligned to the margin so it does not move when the label changes
     length — "ANNUAL REPORT" is four characters wider than "DAILY REPORT". */
  const badgeW = 208;
  const badgeX = PAGE_W - M - badgeW;
  card(kit, { x: badgeX, top: 14, w: badgeW, h: 48, radius: 9, fill: SOFT, border: LINE });

  strokeIcon(kit, ICON.calendar, badgeX + 14, 24, 26, TEAL, 1.5);

  const badgeTextX = badgeX + 50;
  const badgeTextW = badgeW - 62;

  draw(kit, content.kindLabel, {
    x: badgeTextX,
    baseline: 34,
    size: fitSize(kit.bold, content.kindLabel, 8.5, badgeTextW, 6.5, 0.7),
    bold: true,
    color: TEAL,
    tracking: 0.7,
  });
  /* ⚠️ Shrinks rather than clips. "17 Aug – 23 Aug 2026" and "Sep 2025 – Aug 2026" are
     both longer than "August 2026", and losing the year off the end of a report's own
     period makes the document ambiguous the moment it is filed. */
  draw(kit, content.periodLabel, {
    x: badgeTextX,
    baseline: 52,
    size: fitSize(kit.bold, content.periodLabel, 13, badgeTextW, 8.5),
    bold: true,
    color: NAVY,
  });

  hairline(kit, M, badgeX - 16, 70);
}

/* ── Title, code pill, and the introduction ────────────────────────────────── */
function drawTitleBlock(kit: Kit, content: ReportContent): void {
  /* Room for the title plus its code pill, stopping short of the platform card. */
  const maxTitleWidth = LEFT_W - 62;
  const title = content.projectName.toUpperCase();

  /* The title is the loudest thing on the page, so it shrinks to fit rather than being
     truncated: a client's own name must appear in full.

     ⚠️ `maxWidth` as well as the shrink. The shrink stops at a legibility floor, and a
     name long enough to still overflow at that floor used to be drawn anyway — measured:
     "CRESCENT NOVA INTERNATIONAL DIGITAL RETAINER PROGRAMME" ran under the platform
     card and out the side of the page. Below the floor it is cut with an ellipsis, which
     is visible, rather than overlapping, which is not. */
  const size = fitSize(kit.bold, title, 30, maxTitleWidth, 14);
  const titleWidth = draw(kit, title, {
    x: LEFT_X + 2,
    baseline: 110,
    size,
    bold: true,
    color: NAVY,
    maxWidth: maxTitleWidth,
  });

  if (content.projectCode) {
    const label = content.projectCode.toUpperCase();
    const pillW = textWidth(kit.bold, label, 9) + 22;
    const pillX = LEFT_X + 2 + titleWidth + 12;
    card(kit, { x: pillX, top: 92, w: pillW, h: 20, radius: 10, fill: SOFT, border: LINE });
    draw(kit, label, {
      x: pillX + 11,
      baseline: 105.5,
      size: 9,
      bold: true,
      color: TEAL,
      tracking: 0.4,
    });
  }

  /* Three lines at most — the reference has three and a fourth would collide with the
     KPI row. The content builder writes them in priority order. */
  let baseline = 132;
  for (const sentence of content.introduction.slice(0, 3)) {
    draw(kit, sentence, {
      x: LEFT_X + 2,
      baseline,
      size: 9.5,
      color: INK,
      maxWidth: LEFT_W - 8,
    });
    baseline += 16;
  }
}

/* ── The platforms card ────────────────────────────────────────────────────── */
function drawPlatformCard(kit: Kit, content: ReportContent): void {
  const top = 78;
  const h = 98;
  card(kit, { x: RIGHT_X, top, w: RIGHT_W, h, radius: 10 });

  const shown = content.platforms.slice(0, 5);
  const count = Math.max(shown.length, 1);
  const slotW = (RIGHT_W - 24) / count;
  const tile = shown.length > 4 ? 22 : 28;

  shown.forEach((name, index) => {
    const centre = RIGHT_X + 12 + slotW * index + slotW / 2;
    platformTile(kit, name, centre - tile / 2, top + 14, tile);
    draw(kit, name, {
      x: centre - Math.min(textWidth(kit.regular, name, 8), slotW - 6) / 2,
      baseline: top + 14 + tile + 12,
      size: 8,
      color: GREY,
      maxWidth: slotW - 6,
    });

    /* Dividers between, not after — the reference has three icons and two rules. */
    if (index < shown.length - 1) {
      const x = RIGHT_X + 12 + slotW * (index + 1);
      kit.page.drawLine({
        start: { x, y: up(top + 12) },
        end: { x, y: up(top + 14 + tile + 14) },
        thickness: 0.7,
        color: LINE,
      });
    }
  });

  /* The strip along the bottom. */
  const stripTop = top + h - 26;
  card(kit, {
    x: RIGHT_X + 10,
    top: stripTop,
    w: RIGHT_W - 20,
    h: 18,
    radius: 5,
    fill: SOFT,
    border: null,
  });

  const label =
    content.platforms.length === 1 ? '1 PLATFORM MANAGED' : `${content.platforms.length} PLATFORMS MANAGED`;
  const labelWidth = textWidth(kit.bold, label, 8.5) + label.length * 0.7;
  draw(kit, label, {
    x: RIGHT_X + RIGHT_W / 2 - labelWidth / 2,
    baseline: stripTop + 12.5,
    size: 8.5,
    bold: true,
    color: TEAL,
    tracking: 0.7,
  });
}

/**
 * A platform's app-icon tile: the brand colour with the mark knocked out of it — the
 * same construction as `PlatformIcon` on screen, from the same path data.
 *
 * ⚠️ Instagram's real icon is a gradient and pdf-lib has no gradient primitive, so it
 * gets the middle stop (`#DD2A7B`) rather than four bands that would need clipping to
 * the rounded corners. Flat magenta is a known approximation; the alternative was a
 * square of bands overhanging the tile.
 */
function platformTile(kit: Kit, name: string, x: number, top: number, size: number): void {
  const slug = slugForPlatformName(name);
  const mark = slug ? PLATFORM_MARKS[slug] : undefined;

  if (!mark) {
    /* An unrecognised platform gets a neutral tile with its initial, never a hole. */
    card(kit, { x, top, w: size, h: size, radius: size * 0.28, fill: SOFT, border: LINE });
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    draw(kit, initial, {
      x: x + size / 2 - textWidth(kit.bold, initial, size * 0.5) / 2,
      baseline: top + size * 0.68,
      size: size * 0.5,
      bold: true,
      color: GREY,
    });
    return;
  }

  const hex = slug === 'instagram' ? '#DD2A7B' : mark.hex;
  kit.page.drawSvgPath(roundedRect(size, size, size * 0.28), {
    x,
    y: up(top),
    color: hexColor(hex),
  });

  const glyphSize = size * 0.62;
  const inset = (size - glyphSize) / 2;
  const glyph = mark.glyph === 'dark' ? rgb(0.067, 0.067, 0.067) : WHITE;

  if (slug === 'linkedin') {
    /* Geometry, not a path — see `lib/brand/platform-marks.ts` on why. */
    const scale = glyphSize / 24;
    const gx = x + inset;
    const gTop = top + inset;
    kit.page.drawCircle({
      x: gx + LINKEDIN_SHAPES.dot.cx * scale,
      y: up(gTop + LINKEDIN_SHAPES.dot.cy * scale),
      size: LINKEDIN_SHAPES.dot.r * scale,
      color: glyph,
    });
    kit.page.drawRectangle({
      x: gx + LINKEDIN_SHAPES.stem.x * scale,
      y: up(gTop + (LINKEDIN_SHAPES.stem.y + LINKEDIN_SHAPES.stem.height) * scale),
      width: LINKEDIN_SHAPES.stem.width * scale,
      height: LINKEDIN_SHAPES.stem.height * scale,
      color: glyph,
    });
    kit.page.drawSvgPath(LINKEDIN_SHAPES.arch, {
      x: gx,
      y: up(gTop),
      scale,
      color: glyph,
    });
    return;
  }

  if (mark.path) {
    kit.page.drawSvgPath(mark.path, {
      x: x + inset,
      y: up(top + inset),
      scale: glyphSize / 24,
      color: glyph,
    });
  }
}

function hexColor(hex: string): ReturnType<typeof rgb> {
  const value = hex.replace('#', '');
  const int = Number.parseInt(value.length === 3 ? value.replace(/./g, '$&$&') : value, 16);
  if (!Number.isFinite(int)) return GREY;
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

/* ── The three KPI cards ───────────────────────────────────────────────────── */
function drawKpiRow(kit: Kit, content: ReportContent): void {
  const top = KPI_TOP;
  const h = KPI_H;
  const gap = 9;
  const figures = content.headline.slice(0, 3);
  if (figures.length === 0) return;

  const w = (LEFT_W - gap * (figures.length - 1)) / figures.length;

  figures.forEach((figure, index) => {
    const x = LEFT_X + (w + gap) * index;
    const accent = KPI_ACCENT[index] ?? BLUE;
    card(kit, { x, top, w, h, radius: 9 });

    /* The filled disc with its icon, as in the reference. */
    const disc = 34;
    kit.page.drawCircle({
      x: x + 14 + disc / 2,
      y: up(top + h / 2),
      size: disc / 2,
      color: accent,
    });
    const glyph = [ICON.target, ICON.check, ICON.hourglass][index] ?? ICON.target;
    strokeIcon(kit, glyph, x + 14 + disc / 2 - 9, top + h / 2 - 9, 18, WHITE, 2);

    if (index === 0) {
      /* The target's bullseye needs its rings; the path above is only the cross-hairs. */
      const cx = x + 14 + disc / 2;
      const cy = up(top + h / 2);
      for (const r of [7.5, 4]) {
        kit.page.drawCircle({ x: cx, y: cy, size: r, borderColor: WHITE, borderWidth: 1.4 });
      }
    }

    const textX = x + 14 + disc + 12;
    const textW = w - (textX - x) - 10;

    /* ⚠️ Shrinks rather than clips — "TARGET FOR THIS WEEK" clipped to "TARGET FOR
       THIS…" leaves the reader unable to tell which period the figure below it covers.
       Tracking is given up first, then size. */
    const labelTracking = textWidth(kit.bold, figure.label, 7.5) + figure.label.length * 0.55 <= textW ? 0.55 : 0.2;
    draw(kit, figure.label, {
      x: textX,
      baseline: top + 20,
      size: fitSize(kit.bold, figure.label, 7.5, textW, 5.6, labelTracking),
      bold: true,
      color: accent,
      tracking: labelTracking,
    });
    draw(kit, figure.value, {
      x: textX,
      baseline: top + 43,
      size: 20,
      bold: true,
      color: accent,
      maxWidth: textW,
    });
    if (figure.sub) {
      draw(kit, figure.sub, {
        x: textX,
        baseline: top + 54,
        size: 7.6,
        color: GREY,
        maxWidth: textW,
      });
    }
  });
}

/* ── The activity panel, built around the owner's illustration ─────────────── */
function drawActivityPanel(kit: Kit, content: ReportContent, activity: PDFImage | null): void {
  const top = KPI_TOP;
  const h = 200;
  card(kit, { x: RIGHT_X, top, w: RIGHT_W, h, radius: 10 });

  panelHeading(kit, activityTitle(content.kind), top + 18);

  /* The caption is measured first, because the illustration gets whatever is left. */
  const captionLines = wrap(kit.bold, content.activityCaption, 9.5, RIGHT_W - 28).slice(0, 2);
  const captionH = captionLines.length * 13 + 6;

  const artTop = top + 30;
  const artBottom = top + h - captionH - 8;
  const artH = artBottom - artTop;

  if (activity && artH > 40) {
    const maxW = RIGHT_W - 24;
    const drawH = Math.min(artH, (activity.height / activity.width) * maxW);
    const drawW = (activity.width / activity.height) * drawH;
    const artX = RIGHT_X + (RIGHT_W - drawW) / 2;

    kit.page.drawImage(activity, {
      x: artX,
      y: up(artTop + drawH),
      width: drawW,
      height: drawH,
    });

    /* ⚠️ INTO the circle the asset leaves empty, not beside it. This is the whole reason
       the owner supplied the illustration with a hole in it. */
    const cx = artX + drawW * ACTIVITY_CIRCLE.cx;
    const cyTop = artTop + drawH * ACTIVITY_CIRCLE.cy;
    const radius = drawW * ACTIVITY_CIRCLE.r;

    const valueSize = Math.min(42, radius * 0.95);
    const valueWidth = textWidth(kit.bold, content.activityTotal, valueSize);
    draw(kit, content.activityTotal, {
      x: cx - valueWidth / 2,
      baseline: cyTop + valueSize * 0.22,
      size: valueSize,
      bold: true,
      color: GREEN,
    });

    const unit = 'TOTAL POSTS';
    const unitWidth = textWidth(kit.bold, unit, 8) + unit.length * 0.5;
    draw(kit, unit, {
      x: cx - unitWidth / 2,
      baseline: cyTop + valueSize * 0.22 + 14,
      size: 8,
      bold: true,
      color: TEAL,
      tracking: 0.5,
    });
  } else {
    /* No illustration: the number still has to be the biggest thing in the panel. */
    const valueWidth = textWidth(kit.bold, content.activityTotal, 46);
    draw(kit, content.activityTotal, {
      x: RIGHT_X + RIGHT_W / 2 - valueWidth / 2,
      baseline: artTop + artH / 2 + 14,
      size: 46,
      bold: true,
      color: GREEN,
    });
  }

  let baseline = top + h - captionH + 10;
  for (const line of captionLines) {
    const width = textWidth(kit.bold, line, 9.5);
    draw(kit, line, {
      x: RIGHT_X + RIGHT_W / 2 - width / 2,
      baseline,
      size: 9.5,
      bold: true,
      color: NAVY,
    });
    baseline += 13;
  }
}

/** A centred small-caps heading with a rule either side, as the reference has. */
function panelHeading(kit: Kit, label: string, baseline: number): void {
  const size = 9;
  const tracking = 0.7;
  const width = textWidth(kit.bold, label, size) + label.length * tracking;
  const x = RIGHT_X + RIGHT_W / 2 - width / 2;

  draw(kit, label, { x, baseline, size, bold: true, color: TEAL, tracking });

  const ruleY = baseline - size / 2 + 1;
  if (x - RIGHT_X > 22) {
    hairline(kit, RIGHT_X + 14, x - 8, ruleY, TEAL, 1);
    hairline(kit, x + width + 4, RIGHT_X + RIGHT_W - 14, ruleY, TEAL, 1);
  }
}

/* ── The ticks panel ───────────────────────────────────────────────────────── */
function drawGlancePanel(kit: Kit, content: ReportContent): void {
  /* Directly under the activity panel, which starts at KPI_TOP and is 200 tall. */
  const top = KPI_TOP + 200 + 9;
  const h = CONTENT_BOTTOM - top;
  card(kit, { x: RIGHT_X, top, w: RIGHT_W, h, radius: 10 });

  const iconTop = top + 12;
  kit.page.drawCircle({
    x: RIGHT_X + 14 + 9,
    y: up(iconTop + 9),
    size: 9,
    color: TEAL,
  });
  strokeIcon(kit, ICON.trend, RIGHT_X + 14 + 3, iconTop + 3, 12, WHITE, 2.4);

  draw(kit, glanceTitle(content.kind), {
    x: RIGHT_X + 40,
    baseline: top + 24,
    size: 9.5,
    bold: true,
    color: TEAL,
    tracking: 0.5,
    maxWidth: RIGHT_W - 52,
  });

  /* Ticks fill the remaining height. Lines wrap to two at most, and the list is cut to
     what fits rather than overflowing the card. */
  let baseline = top + 46;
  const limit = top + h - 8;

  for (const tick of content.glance) {
    const lines = wrap(kit.regular, tick, 8.5, RIGHT_W - 62).slice(0, 2);
    const needed = lines.length * 11 + 5;
    if (baseline + needed - 11 > limit) break;

    kit.page.drawCircle({ x: RIGHT_X + 20, y: up(baseline - 3), size: 6, color: GREEN });
    strokeIcon(kit, ICON.check, RIGHT_X + 20 - 4.5, baseline - 3 - 4.5, 9, WHITE, 2.6);

    for (const line of lines) {
      draw(kit, line, { x: RIGHT_X + 34, baseline, size: 8.5, color: INK });
      baseline += 11;
    }
    baseline += 5;
  }
}

/* ============================================================================
 * THE LEFT COLUMN
 * ----------------------------------------------------------------------------
 * Two stacked cards: the period's table, then where the content went. Heights are
 * computed rather than fixed, because a year has twelve rows where a week has seven —
 * see the note on `rowHeight`.
 * ========================================================================= */
function drawLeftColumn(kit: Kit, content: ReportContent): void {
  const top = COLUMN_TOP;
  const gap = 9;
  const available = CONTENT_BOTTOM - top - gap;

  /* ── ⚠️ ONE ROW PITCH, SHARED BY BOTH CARDS ────────────────────────────────
     The split used to be fixed at 55/45, and it dropped rows off BOTH cards without
     either knowing: four months missing from a twelve-month year, and — worse — the
     platform rows drawn straight through the bottom of their card and off it.
     Measured on a nine-platform project.

     So both cards are now sized from a single row pitch solved for the space that
     actually exists. Each states how many rows it has; the pitch shrinks until they fit,
     down to a floor at which point rows are dropped from the platform list (with the
     count said out loud) rather than overflowing. */
  const tableRows = isDailyLayout(content.kind)
    ? Math.max(content.published.length, 1)
    : content.rows.length + 1; // the total row is never dropped

  const columns = tableColumnCount(content, tableRows);
  /* Two columns of buckets still cost one extra row for the full-width total band. */
  const tableRowsHigh = Math.ceil(tableRows / columns) + (columns === 2 ? 1 : 0);
  const platformRowsWanted = Math.min(content.platformSummaries.length, 8);

  const pitch = clamp(
    (available - TABLE_CHROME - (platformRowsWanted > 0 ? PLATFORM_CHROME : 0) - gap) /
      (tableRowsHigh + platformRowsWanted),
    MIN_PITCH,
    MAX_PITCH,
  );

  /* A card with a heading and one row still needs this much to look like a card. */
  const tableH = Math.max(88, TABLE_CHROME + tableRowsHigh * pitch);

  /* ⚠️ The TABLE keeps its rows and the PLATFORM LIST gives them up. Deliberate, and
     the asymmetry is the point: a week report whose day-by-day table is missing Saturday
     and Sunday is wrong in a way a reader cannot detect, whereas a platform list that
     says "and 2 more platforms" is complete information in less space. */
  let platformRows = platformRowsWanted;
  let platformH = platformRows > 0 ? PLATFORM_CHROME + platformRows * pitch : 0;
  while (platformRows > 1 && tableH + platformH + gap > available) {
    platformRows -= 1;
    platformH = PLATFORM_CHROME + platformRows * pitch;
  }

  const usedH = isDailyLayout(content.kind)
    ? drawPublishedCard(kit, content, top, tableH, pitch)
    : drawBreakdownCard(kit, content, top, tableH, columns, pitch);

  if (platformRows > 0 && tableH + platformH + gap <= available) {
    drawPlatformSummaryCard(kit, content, top + usedH + gap, platformH, platformRows, pitch);
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * One column of rows, or two side by side.
 *
 * ⚠️ Two only when one genuinely cannot fit. A twelve-month year needs 13 rows and the
 * left column has room for about 12 at a legible size — so a year goes to two columns of
 * six and shows every month, where a single column would have to drop four of them. A
 * week (7) and a month (4–5) always stay in one, which is what the owner's references
 * show.
 */
function tableColumnCount(content: ReportContent, rowsNeeded: number): 1 | 2 {
  if (isDailyLayout(content.kind)) return 1;
  return rowsNeeded > 9 ? 2 : 1;
}

/** Card heading: a teal disc with an icon, then a small-caps title. */
function cardHeading(kit: Kit, x: number, top: number, icon: string, label: string): void {
  kit.page.drawCircle({ x: x + 14 + 9, y: up(top + 12 + 9), size: 9, color: TEAL });
  strokeIcon(kit, icon, x + 14 + 3, top + 12 + 3, 12, WHITE, 2.2);
  draw(kit, label, {
    x: x + 40,
    baseline: top + 25,
    size: 9.5,
    bold: true,
    color: TEAL,
    tracking: 0.5,
    maxWidth: LEFT_W - 52,
  });
}

/* ── The daily layouts: one row per published post ─────────────────────────── */
function drawPublishedCard(
  kit: Kit,
  content: ReportContent,
  top: number,
  h: number,
  pitch: number,
): number {
  card(kit, { x: LEFT_X, top, w: LEFT_W, h, radius: 10 });
  cardHeading(
    kit,
    LEFT_X,
    top,
    ICON.calendar,
    content.kind === 'yesterday' ? 'PUBLISHED YESTERDAY' : 'PUBLISHED TODAY',
  );

  const columns = [
    { label: 'PLATFORM', x: LEFT_X + 16, w: 108 },
    { label: 'CONTENT TYPE', x: LEFT_X + 128, w: 92 },
    { label: 'POSTING TIME', x: LEFT_X + 224, w: 78 },
    { label: 'URL / REFERENCE', x: LEFT_X + 306, w: LEFT_W - 322 },
  ];

  let baseline = top + 48;
  for (const column of columns) {
    draw(kit, column.label, {
      x: column.x,
      baseline,
      size: 6.8,
      bold: true,
      color: FAINT,
      tracking: 0.45,
      maxWidth: column.w,
    });
  }
  hairline(kit, LEFT_X + 16, LEFT_X + LEFT_W - 16, baseline + 6, TEAL, 0.9);

  if (content.published.length === 0) {
    draw(kit, 'Nothing was published in this period.', {
      x: LEFT_X + 16,
      baseline: baseline + 26,
      size: 9,
      color: GREY,
    });
    return h;
  }

  /* ⚠️ The pitch is the SAME number the card was sized with — not recomputed. When the
     two disagreed, the allocator sized a card for eight rows and the drawing fitted
     five, which shortened a week report's table without either of them knowing. */
  const bodyTop = baseline + 6;
  const step = pitch;
  const rows = Math.min(content.published.length, Math.floor((top + h - 10 - bodyTop) / step));

  baseline = bodyTop + step * 0.72;
  for (const row of content.published.slice(0, rows)) {
    platformTile(kit, row.platform, columns[0].x, baseline - 9.5, 12);
    draw(kit, row.platform, {
      x: columns[0].x + 17,
      baseline,
      size: 8.5,
      color: INK,
      maxWidth: columns[0].w - 17,
    });

    const isReel = /reel|video|short/i.test(row.contentType);
    strokeIcon(kit, isReel ? ICON.play : ICON.image, columns[1].x, baseline - 9, 11, GREY, 1.6);
    draw(kit, row.contentType, {
      x: columns[1].x + 15,
      baseline,
      size: 8.5,
      color: INK,
      maxWidth: columns[1].w - 15,
    });

    if (row.time) {
      kit.page.drawCircle({
        x: columns[2].x + 5.5,
        y: up(baseline - 3),
        size: 5.5,
        borderColor: GREY,
        borderWidth: 1,
      });
      strokeIcon(kit, ICON.clock, columns[2].x, baseline - 8.5, 11, GREY, 1.6);
      draw(kit, row.time, {
        x: columns[2].x + 15,
        baseline,
        size: 8.5,
        color: INK,
        maxWidth: columns[2].w - 15,
      });
    } else {
      draw(kit, '—', { x: columns[2].x + 15, baseline, size: 8.5, color: FAINT });
    }

    if (row.url) {
      /* ⚠️ A real link annotation, not blue text. The reference shows a link and an
         open-in-new glyph; making it clickable is the difference between a picture of a
         link and a link. */
      const label = row.url.replace(/^https?:\/\//, '');
      const width = draw(kit, label, {
        x: columns[3].x,
        baseline,
        size: 8,
        color: TEAL,
        maxWidth: columns[3].w - 14,
      });
      hairline(kit, columns[3].x, columns[3].x + width, baseline + 1.6, TEAL, 0.5);
      strokeIcon(kit, ICON.link, LEFT_X + LEFT_W - 30, baseline - 8.5, 10, TEAL, 1.6);
    } else {
      draw(kit, 'no link recorded', {
        x: columns[3].x,
        baseline,
        size: 8,
        color: FAINT,
        maxWidth: columns[3].w,
      });
    }

    hairline(kit, LEFT_X + 16, LEFT_X + LEFT_W - 16, baseline + step - 10.5);
    baseline += step;
  }

  if (rows < content.published.length) {
    draw(kit, `and ${content.published.length - rows} more — see the figures below`, {
      x: LEFT_X + 16,
      baseline: top + h - 8,
      size: 7,
      color: FAINT,
    });
  }

  return h;
}

/* ── Week, month, year: the breakdown table ────────────────────────────────── */

/**
 * Where the four number columns sit inside a table of a given width.
 *
 * ⚠️ Derived from the width rather than hard-coded, because a two-column year table has
 * half the room per side. Fractions of the label gutter, so the numbers stay right of
 * the longest bucket label ("Wednesday 19 Aug") at either width.
 */
function numberColumnsFor(x: number, w: number, kind: ReportContent['kind'], narrow: boolean) {
  /* The label needs the most room on a week ("Wednesday 19 Aug" plus its day chip) and
     the least on a year ("August 2026"). ⚠️ A narrow (two-up) table gives the label less
     again: at 0.4 the four number headers were 29pt apart and "STATIC" needs 26pt plus a
     9pt icon, so they overlapped into "STATICREELSTOTAL". */
  const labelShare = narrow ? 0.36 : kind === 'week' ? 0.46 : 0.4;
  const first = x + 16 + w * labelShare;
  const step = (x + w - 22 - first) / 3.6;
  return [
    { label: 'STATIC', icon: ICON.image, x: first },
    { label: 'REELS', icon: ICON.play, x: first + step },
    { label: 'TOTAL', icon: ICON.pie, x: first + step * 2 },
    { label: 'TARGET', icon: ICON.target, x: first + step * 3 },
  ] as const;
}

function drawBreakdownCard(
  kit: Kit,
  content: ReportContent,
  top: number,
  h: number,
  columnCount: 1 | 2,
  pitch: number,
): number {
  card(kit, { x: LEFT_X, top, w: LEFT_W, h, radius: 10 });
  cardHeading(kit, LEFT_X, top, ICON.calendar, breakdownTitle(content.kind));

  if (content.rows.length === 0) {
    draw(kit, 'No breakdown is available for this period.', {
      x: LEFT_X + 16,
      baseline: top + 62,
      size: 9,
      color: GREY,
    });
    return h;
  }

  /* Two columns share the card with a gutter between them; one takes the lot. */
  const gutter = 14;
  const narrow = columnCount === 2;
  const columnW = narrow ? (LEFT_W - gutter) / 2 : LEFT_W;
  const perColumn = Math.ceil(content.rows.length / columnCount);

  /* ⚠️ The total row is never dropped — a table whose total is missing invites the
     reader to add the column up themselves, and get a different answer. It spans the
     full card width beneath both columns, so it cannot be misread as totalling only the
     column above it. */
  const headerBaseline = top + 48;
  const bodyTop = headerBaseline + 6;
  const bodyH = top + h - 10 - bodyTop;
  /* ⚠️ The pitch the card was SIZED with — see the note in `drawPublishedCard`. */
  const step = pitch;
  const size = step < 13 ? 7.6 : 8.5;
  const shownPerColumn = Math.max(
    1,
    Math.min(perColumn, Math.round(bodyH / step) - 1),
  );

  let shown = 0;
  let totalBaseline = bodyTop + step * 0.72;

  for (let index = 0; index < columnCount; index++) {
    const x = LEFT_X + (columnW + gutter) * index;
    const slice = content.rows.slice(index * perColumn, index * perColumn + shownPerColumn);
    if (slice.length === 0) continue;
    shown += slice.length;

    const numberColumns = numberColumnsFor(x, columnW, content.kind, narrow);

    /* Column headers, once per column. ⚠️ The icons are dropped when the columns are
       too close together to carry them — see `numberColumnsFor`. */
    draw(kit, 'PERIOD', {
      x: x + 16,
      baseline: headerBaseline,
      size: 6.8,
      bold: true,
      color: FAINT,
      tracking: 0.45,
    });
    const columnGap = numberColumns[1].x - numberColumns[0].x;
    for (const column of numberColumns) {
      if (columnGap >= 38) {
        strokeIcon(kit, column.icon, column.x - 11, headerBaseline - 8, 9, FAINT, 1.7);
      }
      draw(kit, column.label, {
        x: column.x,
        baseline: headerBaseline,
        size: 6.8,
        bold: true,
        color: FAINT,
        tracking: columnGap >= 34 ? 0.45 : 0.1,
        maxWidth: columnGap - 3,
      });
    }
    hairline(kit, x + 16, x + columnW - 16, headerBaseline + 6, TEAL, 0.9);

    let baseline = bodyTop + step * 0.72;
    for (const row of slice) {
      drawBreakdownRow(kit, content, row, x, columnW, baseline, step, size, numberColumns);
      hairline(kit, x + 16, x + columnW - 16, baseline + step * 0.28 - 3);
      baseline += step;
    }
    totalBaseline = Math.max(totalBaseline, baseline);
  }

  /* The total band, full width, under whichever column ran longest. */
  drawBreakdownTotal(
    kit,
    content,
    LEFT_X,
    LEFT_W,
    totalBaseline,
    step,
    size,
    numberColumnsFor(LEFT_X, LEFT_W, content.kind, false),
    narrow,
  );

  if (shown < content.rows.length) {
    /* ⚠️ Said out loud. A silently shortened table reads as a complete one, and the
       total row already counts every bucket — so the reader would otherwise see a total
       that does not match the rows they can see. */
    draw(kit, `${content.rows.length - shown} further period(s) are included in the total`, {
      x: LEFT_X + 16,
      baseline: top + h - 5,
      size: 6.8,
      color: FAINT,
    });
  }

  return h;
}

type NumberColumns = ReturnType<typeof numberColumnsFor>;

function drawBreakdownRow(
  kit: Kit,
  content: ReportContent,
  row: ReportContent['rows'][number],
  x: number,
  w: number,
  baseline: number,
  step: number,
  size: number,
  numberColumns: NumberColumns,
): void {
  const rowTop = baseline - step * 0.72;

  /* The day chip the weekly reference has beside each date. A week's bucket labels start
     with the weekday, which is what makes the three-letter slice meaningful; a month's
     ("1 – 7 Aug") would not, so it is week-only. */
  if (content.kind === 'week') {
    const chip = row.label.slice(0, 3).toUpperCase();
    card(kit, {
      x: x + 16,
      top: rowTop + (step - 12) / 2,
      w: 26,
      h: 12,
      radius: 6,
      fill: row.isOff ? SOFT : TEAL,
      border: null,
    });
    draw(kit, chip, {
      x: x + 16 + 13 - textWidth(kit.bold, chip, 6) / 2,
      baseline: rowTop + (step - 12) / 2 + 8.4,
      size: 6,
      bold: true,
      color: row.isOff ? GREY : WHITE,
    });
  }

  const labelX = content.kind === 'week' ? x + 48 : x + 16;
  draw(kit, row.label, {
    x: labelX,
    baseline,
    size,
    color: row.isOff ? GREY : INK,
    maxWidth: numberColumns[0].x - labelX - 14,
  });

  const values = [
    { value: String(row.staticPosts), bold: false, color: row.isOff ? FAINT : INK },
    { value: String(row.reels), bold: false, color: row.isOff ? FAINT : INK },
    { value: String(row.total), bold: true, color: row.isOff ? GREY : NAVY },
    { value: String(row.target), bold: false, color: row.isOff ? FAINT : GREY },
  ];
  values.forEach((entry, index) => {
    draw(kit, entry.value, {
      x: numberColumns[index].x + 10,
      baseline,
      size,
      bold: entry.bold,
      color: entry.color,
    });
  });

  if (row.isOff) {
    /* Right-aligned to the card edge, where there is room whatever the column width. */
    const label = 'off';
    draw(kit, label, {
      x: x + w - 18 - textWidth(kit.regular, label, size - 0.7),
      baseline,
      size: size - 0.7,
      color: FAINT,
    });
  }
}

function drawBreakdownTotal(
  kit: Kit,
  content: ReportContent,
  x: number,
  w: number,
  baseline: number,
  step: number,
  size: number,
  numberColumns: NumberColumns,
  narrow: boolean,
): void {
  const totals = content.rows.reduce(
    (sum, row) => ({
      staticPosts: sum.staticPosts + row.staticPosts,
      reels: sum.reels + row.reels,
      total: sum.total + row.total,
      target: sum.target + row.target,
    }),
    { staticPosts: 0, reels: 0, total: 0, target: 0 },
  );

  card(kit, {
    x: x + 10,
    top: baseline - step * 0.72,
    w: w - 20,
    h: step,
    radius: 4,
    fill: SOFT,
    border: null,
  });
  draw(kit, breakdownTotalLabel(content.kind), {
    x: x + 16,
    baseline,
    size: size - 0.4,
    bold: true,
    color: TEAL,
    tracking: 0.4,
    maxWidth: narrow ? w * 0.3 : numberColumns[0].x - x - 30,
  });

  /* ── ⚠️ A TWO-UP TABLE CANNOT ALIGN ITS TOTALS TO A COLUMN ──────────────────
     The band spans the full width, so figures placed at the full-width column positions
     land between the two stacks of numbers and read as belonging to neither. Labelled
     inline instead: unambiguous at a glance, and it cannot be mistaken for the sum of
     only the column it happens to sit under. */
  if (narrow) {
    const parts = [
      `${totals.staticPosts} static`,
      `${totals.reels} reels`,
      `${totals.total} published`,
      `${totals.target} target`,
    ].join('   ·   ');
    draw(kit, parts, {
      x: x + w - 18 - textWidth(kit.bold, parts, size),
      baseline,
      size,
      bold: true,
      color: TEAL,
    });
    return;
  }

  [totals.staticPosts, totals.reels, totals.total, totals.target].forEach((value, index) => {
    draw(kit, String(value), {
      x: numberColumns[index].x + 10,
      baseline,
      size,
      bold: true,
      color: index === 2 ? NAVY : TEAL,
    });
  });
}

/* ── Where it went ─────────────────────────────────────────────────────────── */
function drawPlatformSummaryCard(
  kit: Kit,
  content: ReportContent,
  top: number,
  h: number,
  rows: number,
  pitch: number,
): void {
  card(kit, { x: LEFT_X, top, w: LEFT_W, h, radius: 10 });
  cardHeading(kit, LEFT_X, top, ICON.file, 'WHERE IT WENT');

  const showShare = content.platformSummaries.some((row) => row.sharePct > 0);

  let baseline = top + 44;
  draw(kit, 'PLATFORM', {
    x: LEFT_X + 16,
    baseline,
    size: 6.5,
    bold: true,
    color: FAINT,
    tracking: 0.45,
  });
  draw(kit, 'PLACEMENT SUMMARY', {
    x: LEFT_X + 124,
    baseline,
    size: 6.5,
    bold: true,
    color: FAINT,
    tracking: 0.45,
  });
  if (showShare) {
    draw(kit, 'SHARE', {
      x: LEFT_X + LEFT_W - 52,
      baseline,
      size: 6.5,
      bold: true,
      color: FAINT,
      tracking: 0.45,
    });
  }
  hairline(kit, LEFT_X + 16, LEFT_X + LEFT_W - 16, baseline + 5, TEAL, 0.9);

  const bodyTop = baseline + 5;
  const bodyH = top + h - 8 - bodyTop;
  const step = pitch;
  /* ⚠️ Checked against the card's OWN height as well as the caller's row count. The rows
     used to be drawn straight through the bottom border and off the card — a
     nine-platform project put half of "X (Twitter)" on the footer band.

     And where rows WILL be dropped, one line is held back for the "and N more" note, so
     that note does not end up printed on the card's bottom border. */
  const capacity = Math.max(1, Math.min(rows, Math.round(bodyH / step)));
  const willDrop = capacity < content.platformSummaries.length;
  const fits = willDrop ? Math.max(1, capacity - 1) : capacity;
  baseline = bodyTop + step * 0.7;

  for (const row of content.platformSummaries.slice(0, fits)) {
    platformTile(kit, row.platform, LEFT_X + 16, baseline - 9, 12);
    draw(kit, row.platform, {
      x: LEFT_X + 33,
      baseline,
      size: 8.2,
      color: INK,
      maxWidth: 86,
    });
    draw(kit, row.summary, {
      x: LEFT_X + 124,
      baseline,
      size: 8.2,
      color: row.posts === 0 ? GREY : INK,
      maxWidth: LEFT_W - 140 - (showShare ? 46 : 0),
    });
    if (showShare) {
      const label = `${row.sharePct}%`;
      draw(kit, label, {
        x: LEFT_X + LEFT_W - 20 - textWidth(kit.bold, label, 8.2),
        baseline,
        size: 8.2,
        bold: true,
        color: row.posts === 0 ? FAINT : TEAL,
      });
    }
    if (baseline + step < top + h - 6) {
      hairline(kit, LEFT_X + 16, LEFT_X + LEFT_W - 16, baseline + step - step * 0.7 - 2.5);
    }
    baseline += step;
  }

  if (fits < content.platformSummaries.length) {
    /* ⚠️ Counted out loud. A platform silently missing from "where it went" reads as a
       platform the division is not managing — which is the opposite of true, and it is
       the reason the reference shows a quiet TikTok row rather than omitting it. */
    const dropped = content.platformSummaries.length - fits;
    draw(kit, `and ${dropped} more platform${dropped === 1 ? '' : 's'} — see the platform card above`, {
      x: LEFT_X + 16,
      baseline: Math.min(baseline, top + h - 4),
      size: 6.8,
      color: FAINT,
      maxWidth: LEFT_W - 32,
    });
  }
}

/* ── The footer band ───────────────────────────────────────────────────────── */
function drawFooter(
  kit: Kit,
  content: ReportContent,
  meta: ReportPosterMeta,
  desk: PDFImage | null,
): void {
  const top = 528;
  const h = 47;
  card(kit, { x: M, top, w: PAGE_W - M * 2, h, radius: 9 });

  kit.page.drawCircle({ x: M + 16 + 9, y: up(top + h / 2), size: 9, borderColor: GREY, borderWidth: 1.1 });
  strokeIcon(kit, ICON.info, M + 16, top + h / 2 - 9, 18, GREY, 1.8);

  const textX = M + 44;
  const deskW = desk ? Math.min(122, (desk.width / desk.height) * (h - 6)) : 0;
  const textW = PAGE_W - M - 16 - deskW - textX - 10;

  const lines = [
    ...wrap(kit.regular, content.footer, 7.8, textW).slice(0, 2),
    'An asset counts in the period it was published; reels are counted inside the asset total. ' +
      'The target excludes agreed rest days. All times are recorded in PKT (Asia/Karachi).',
  ];

  let baseline = top + 17;
  for (const line of lines.slice(0, 3)) {
    draw(kit, line, { x: textX, baseline, size: 7.8, color: GREY, maxWidth: textW });
    baseline += 10.5;
  }

  if (desk) {
    const drawH = h - 4;
    const drawW = (desk.width / desk.height) * drawH;
    kit.page.drawImage(desk, {
      x: PAGE_W - M - 12 - drawW,
      y: up(top + h - 2),
      width: drawW,
      height: drawH,
    });
  }

  /* The provenance line, outside the card. Small, but it is what makes the document
     answerable when somebody asks where a number came from. */
  draw(
    kit,
    `Figures computed from CNI CRM records · generated ${meta.generatedOn} by ${meta.generatedBy}`,
    { x: M + 2, baseline: PAGE_H - 6, size: 6.5, color: FAINT, maxWidth: PAGE_W - M * 2 - 4 },
  );
}
