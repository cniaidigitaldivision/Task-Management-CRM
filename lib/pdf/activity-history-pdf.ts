import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import type { CompanyLetterhead } from '@/lib/domain/invoice';

/* ============================================================================
 * ACTIVITY HISTORY — the printable record
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-24: *"export also show a drop-up option of export in CSV and
 * Excel and PDF ... PDF in a proper template."*
 *
 * ── ⚠️ LANDSCAPE, WHERE THE TASK ASSIGNMENT FORM IS PORTRAIT ──────────────
 * That form gets signed and has to look like the office's paper sheet. This is
 * a record that gets read across: seven columns, one of which holds a task
 * title and another a before → after pair. Portrait would truncate both.
 *
 * ── ⚠️ IT PRINTS WHAT THE SCREEN WAS SHOWING, FILTERS INCLUDED ────────────
 * The header block states the filters that were applied. A colleague handed a
 * sheet of 40 events out of 109 with nothing saying so would read it as the
 * whole record — and this record is about a named person.
 *
 * ── ⚠️ NOTHING IS COMPUTED HERE ───────────────────────────────────────────
 * Every string arrives worded by `lib/view/activity.ts`, the same module the
 * screen uses, so the sheet cannot say a different thing from the page it came
 * from. The only judgement this file makes is where the page breaks.
 *
 * ── ⚠️ `safe()` IS THE SIXTH COPY IN THIS FOLDER ──────────────────────────
 * invoice-pdf, client-list-pdf, report-poster, report-sheet and
 * task-assignment-form each carry their own. That is the house pattern here and
 * this file follows it rather than refactoring five working exports mid-change;
 * consolidating them into one `lib/pdf/kit.ts` is worth doing on its own.
 * ========================================================================= */

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const M = 32;
const CONTENT_W = PAGE_W - M * 2;
const FLOOR = PAGE_H - 34;

const hex = (value: string) => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const INK = {
  text: hex('#12222a'),
  soft: hex('#5b6f77'),
  rule: hex('#c9d6d8'),
  hair: hex('#dde7e8'),
  wash: hex('#f4f8f8'),
  band: hex('#0e2a2c'),
  gold: hex('#d4a63c'),
  white: rgb(1, 1, 1),
  green: hex('#15803d'),
  mint: hex('#eaf7f2'),
} as const;

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS outside it — one em
 * dash in a task title would fail the whole export.
 */
function safe(raw: string): string {
  let out = '';
  for (const ch of raw ?? '') {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x2019 || c === 0x2018) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c === 0x2013 || c === 0x2014) out += '-';
    else if (c === 0x2192) out += '->';
    else if (c === 0x00a0) out += ' ';
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 160 && c <= 255) out += ch;
    else out += '-';
  }
  return out;
}

function fit(font: PDFFont, raw: string, size: number, max: number): string {
  const s = safe(raw);
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${s.slice(0, mid)}...`, size) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}...`;
}

/** Wrap into at most `maxLines`, so a long title keeps its words. */
function wrap(font: PDFFont, raw: string, size: number, max: number, maxLines: number): string[] {
  const words = safe(raw).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) return [''];
  if (words.join(' ') !== lines.join(' ')) {
    lines[lines.length - 1] = fit(font, `${lines[lines.length - 1]} ...`, size, max);
  }
  return lines;
}

interface Kit {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function text(
  kit: Kit,
  raw: string,
  o: {
    x: number;
    top: number;
    size: number;
    bold?: boolean;
    italic?: boolean;
    color?: ReturnType<typeof rgb>;
    width?: number;
    align?: 'left' | 'right' | 'center';
  },
) {
  const font = o.bold ? kit.bold : o.italic ? kit.italic : kit.font;
  const s = o.width ? fit(font, raw, o.size, o.width) : safe(raw);
  const w = font.widthOfTextAtSize(s, o.size);
  let x = o.x;
  if (o.width && o.align === 'right') x = o.x + o.width - w;
  if (o.width && o.align === 'center') x = o.x + (o.width - w) / 2;
  kit.page.drawText(s, { x, y: up(o.top + o.size), size: o.size, font, color: o.color ?? INK.text });
}

function line(kit: Kit, x: number, top: number, w: number, color = INK.rule, thickness = 0.7) {
  kit.page.drawRectangle({ x, y: up(top), width: w, height: thickness, color });
}

/* ── What one sheet holds ────────────────────────────────────────────────── */

export interface ActivityPdfRow {
  readonly time: string;
  readonly actor: string;
  readonly event: string;
  readonly task: string;
  readonly project: string;
  /** "To do -> Done", "Due date: 9 Sep 2026 -> 5 Sep 2026", or the note. */
  readonly change: string;
  readonly reason: string;
}

export interface ActivityPdfDay {
  readonly label: string;
  readonly rows: readonly ActivityPdfRow[];
}

export interface ActivityPdfInput {
  readonly company: CompanyLetterhead;
  readonly personName: string;
  readonly personRole: string;
  readonly periodLabel: string;
  /** What the screen was filtered to, already worded. Empty when it was not. */
  readonly filters: readonly string[];
  readonly totalInPeriod: number;
  readonly days: readonly ActivityPdfDay[];
  readonly generatedAt: string;
  readonly generatedFor: string;
}

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    return null;
  }
}

const COLS = [
  { key: 'time', label: 'Time', w: 0.06, align: 'left' as const },
  { key: 'actor', label: 'Who', w: 0.125 },
  { key: 'event', label: 'Event', w: 0.115 },
  { key: 'task', label: 'Task', w: 0.235 },
  { key: 'project', label: 'Project', w: 0.13 },
  { key: 'change', label: 'What changed', w: 0.2 },
  { key: 'reason', label: 'Reason given', w: 0.135 },
];

function colX(): number[] {
  const xs: number[] = [];
  let x = M;
  for (const c of COLS) {
    xs.push(x);
    x += c.w * CONTENT_W;
  }
  return xs;
}

function drawMasthead(kit: Kit, input: ActivityPdfInput, logo: PDFImage | null): number {
  kit.page.drawRectangle({ x: 0, y: up(58), width: PAGE_W, height: 58, color: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(61), width: PAGE_W, height: 3, color: INK.gold });

  let x = M;
  const logoH = 24;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x, y: up(17 + logoH), width: logoW, height: logoH });
    x += logoW + 10;
  }
  text(kit, input.company.legalName, { x, top: 17, size: 11, bold: true, color: INK.white });
  if (input.company.division) {
    text(kit, input.company.division, { x, top: 31, size: 7.5, color: hex('#9fb6b8') });
  }
  text(kit, 'ACTIVITY HISTORY', {
    x: M, top: 15, size: 12.5, bold: true, color: INK.white, align: 'right', width: CONTENT_W,
  });
  text(kit, 'CNI OFFICE, ISLAMABAD', {
    x: M, top: 32, size: 8, color: INK.gold, align: 'right', width: CONTENT_W,
  });
  return 70;
}

/**
 * Who this is about, over what period, and what was left out.
 *
 * ⚠️ THE FILTER LINE IS NOT DECORATION. A sheet showing 40 of 109 events with
 * nothing saying so is read as the whole record.
 */
function drawHeaderBlock(kit: Kit, input: ActivityPdfInput, top: number): number {
  const shown = input.days.reduce((n, d) => n + d.rows.length, 0);
  const h = 44;

  kit.page.drawRectangle({ x: M, y: up(top + h), width: CONTENT_W, height: h, color: INK.wash });
  kit.page.drawRectangle({ x: M, y: up(top + h), width: 3, height: h, color: INK.band });

  text(kit, input.personName, { x: M + 12, top: top + 8, size: 12, bold: true });
  text(kit, [input.personRole, input.periodLabel].filter(Boolean).join('  ·  '), {
    x: M + 12, top: top + 24, size: 8, color: INK.soft, width: CONTENT_W * 0.5,
  });

  const right = CONTENT_W * 0.42;
  text(
    kit,
    shown === input.totalInPeriod
      ? `${shown} events`
      : `${shown} of ${input.totalInPeriod} events in the period`,
    { x: M + CONTENT_W - right - 12, top: top + 8, size: 9.5, bold: true, width: right, align: 'right' },
  );
  text(
    kit,
    input.filters.length > 0 ? `Filtered by ${input.filters.join(' · ')}` : 'No filter applied',
    { x: M + CONTENT_W - right - 12, top: top + 24, size: 7.5, color: INK.soft, width: right, align: 'right' },
  );

  return top + h + 12;
}

function drawTableHead(kit: Kit, top: number): number {
  const h = 18;
  kit.page.drawRectangle({ x: M, y: up(top + h), width: CONTENT_W, height: h, color: INK.band });
  const xs = colX();
  COLS.forEach((c, i) => {
    text(kit, c.label, {
      x: xs[i] + 5,
      top: top + 5.5,
      size: 7.5,
      bold: true,
      color: INK.white,
      width: c.w * CONTENT_W - 10,
      align: c.align,
    });
  });
  return top + h;
}

function drawDayBand(kit: Kit, day: ActivityPdfDay, top: number): number {
  const h = 16;
  kit.page.drawRectangle({ x: M, y: up(top + h), width: CONTENT_W, height: h, color: INK.mint });
  text(kit, day.label, { x: M + 6, top: top + 4.5, size: 8, bold: true });
  text(kit, `${day.rows.length} event${day.rows.length === 1 ? '' : 's'}`, {
    x: M, top: top + 4.5, size: 7.5, color: INK.soft, align: 'right', width: CONTENT_W - 6,
  });
  return top + h;
}

/** The height a row will take, so a page break can be decided before drawing. */
function rowHeight(kit: Kit, r: ActivityPdfRow): number {
  const size = 7.5;
  const lines = Math.max(
    wrap(kit.font, r.task, size, COLS[3].w * CONTENT_W - 10, 2).length,
    wrap(kit.font, r.change, size, COLS[5].w * CONTENT_W - 10, 2).length,
    wrap(kit.font, r.reason, size, COLS[6].w * CONTENT_W - 10, 2).length,
  );
  return 7 + lines * 9.5;
}

function drawRow(kit: Kit, r: ActivityPdfRow, top: number, stripe: boolean): number {
  const size = 7.5;
  const h = rowHeight(kit, r);
  if (stripe) {
    kit.page.drawRectangle({ x: M, y: up(top + h), width: CONTENT_W, height: h, color: INK.wash });
  }
  const xs = colX();
  const cells = [r.time, r.actor, r.event, r.task, r.project, r.change, r.reason];

  cells.forEach((value, i) => {
    const w = COLS[i].w * CONTENT_W - 10;
    /* Only the three wide columns wrap; the rest are one line and clipped. */
    const lines = i === 3 || i === 5 || i === 6 ? wrap(kit.font, value, size, w, 2) : [fit(kit.font, value, size, w)];
    lines.forEach((l, n) => {
      text(kit, l, {
        x: xs[i] + 5,
        top: top + 4 + n * 9.5,
        size,
        bold: i === 3 && n === 0,
        color: i === 6 ? INK.soft : INK.text,
        width: w,
        align: COLS[i].align,
      });
    });
  });

  line(kit, M, top + h, CONTENT_W, INK.hair, 0.5);
  return top + h;
}

function drawFooter(kit: Kit, input: ActivityPdfInput, page: number, of: number) {
  line(kit, M, PAGE_H - 26, CONTENT_W, INK.hair);
  text(kit, `Exported by ${input.generatedFor}  ${input.generatedAt}`, {
    x: M, top: PAGE_H - 21, size: 7, color: INK.soft,
  });
  text(kit, `Page ${page} of ${of}`, {
    x: M, top: PAGE_H - 21, size: 7, color: INK.soft, align: 'right', width: CONTENT_W,
  });
}

export async function composeActivityHistory(input: ActivityPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Activity history — ${input.personName}`);
  pdf.setProducer(input.company.legalName);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await loadLogo(pdf);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let kit: Kit = { pdf, page, font, bold, italic };
  let y = drawMasthead(kit, input, logo);
  y = drawHeaderBlock(kit, input, y);
  y = drawTableHead(kit, y);

  const newPage = (continued: boolean) => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    kit = { pdf, page, font, bold, italic };
    y = drawMasthead(kit, input, logo);
    if (continued) {
      text(kit, `${input.personName}  ·  ${input.periodLabel}  (continued)`, {
        x: M, top: y, size: 8, bold: true,
      });
      y += 13;
    }
    y = drawTableHead(kit, y);
  };

  let stripe = false;
  for (const day of input.days) {
    /* ⚠️ A DAY BAND IS NEVER THE LAST THING ON A PAGE. Orphaned above the
       footer it reads as a day with no events in it. */
    if (y + 16 + rowHeight(kit, day.rows[0] ?? BLANK) > FLOOR) newPage(true);
    y = drawDayBand(kit, day, y);
    stripe = false;

    for (const row of day.rows) {
      if (y + rowHeight(kit, row) > FLOOR) {
        newPage(true);
        y = drawDayBand(kit, { ...day, label: `${day.label} (continued)` }, y);
        stripe = false;
      }
      y = drawRow(kit, row, y, stripe);
      stripe = !stripe;
    }
  }

  if (input.days.length === 0) {
    text(kit, 'No event matched these filters in this period.', {
      x: M, top: y + 12, size: 9, italic: true, color: INK.soft, width: CONTENT_W, align: 'center',
    });
  }

  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    drawFooter({ pdf, page: p, font, bold, italic }, input, i + 1, total);
  });

  return pdf.save();
}

const BLANK: ActivityPdfRow = {
  time: '',
  actor: '',
  event: '',
  task: '',
  project: '',
  change: '',
  reason: '',
};
