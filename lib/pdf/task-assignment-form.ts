import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import type { CompanyLetterhead } from '@/lib/domain/invoice';

/* ============================================================================
 * TASK ASSIGNMENT FORM — CNI OFFICE, ISLAMABAD
 * ----------------------------------------------------------------------------
 * The owner's own paper form, sent 2026-09-24, reproduced so a person can export
 * their day from the Performance page and hand it in:
 *
 *   *"Every person can download or export their daily task in this template
 *   from the performance page ... you will show that today's tasks are: these
 *   ones are completed, these are left, these are overdue."*
 *
 * ── ⚠️ THE SIGNATURE BLOCKS ARE DRAWN EMPTY, ON PURPOSE ───────────────────
 * *"When they export it and take a hard copy, the signature will be done by
 * hand so no problem."* Individual, HOD, C.O.O and C.E.O each get a ruled box
 * and a date line, and this file never puts a name in one. A signature block
 * that arrived pre-filled would be a forgery, not a convenience.
 *
 * ── ⚠️ TEN ROWS IS THE PAPER FORM'S LIMIT, NOT OURS ───────────────────────
 * *"The number of tasks per day doesn't matter. If it goes to the next page, go
 * in there ... whether it's a 10-page or a 1-page, no problem."* Measured on
 * the live database: 30 of 209 person-days exceed ten tasks and the busiest is
 * 21. So the table runs onto as many pages as it needs, each numbered, and the
 * numbering continues rather than restarting.
 *
 * ── ⚠️ PORTRAIT, WHERE THE CLIENT DIRECTORY IS LANDSCAPE ──────────────────
 * This is a form that gets signed, not a list that gets scanned across. It has
 * to look like the sheet the office already uses.
 *
 * ── ⚠️ NOTHING IS COMPUTED HERE ───────────────────────────────────────────
 * Every string arrives already worded. The PDF cannot say a different thing
 * from the page it was exported from.
 * ========================================================================= */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const M = 36;
const CONTENT_W = PAGE_W - M * 2;
const FLOOR = PAGE_H - 40;

const hex = (value: string) => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* The invoice's palette — the light theme, because paper has no dark mode. */
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
  amber: hex('#b45309'),
  red: hex('#b91c1c'),
} as const;

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS outside it — one em dash
 * in a task title would fail the whole export. Anything it cannot draw becomes
 * a dash here, exactly as the invoice and the client directory do.
 */
function safe(raw: string): string {
  let out = '';
  for (const ch of raw ?? '') {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x2019 || c === 0x2018) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c === 0x2013 || c === 0x2014) out += '-';
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
  const overflowed = words.join(' ') !== lines.join(' ');
  if (overflowed) lines[lines.length - 1] = fit(font, `${lines[lines.length - 1]} ...`, size, max);
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

function box(kit: Kit, x: number, top: number, w: number, h: number, color = INK.rule) {
  kit.page.drawRectangle({
    x,
    y: up(top + h),
    width: w,
    height: h,
    borderColor: color,
    borderWidth: 0.7,
  });
}

/* ── What one sheet holds ────────────────────────────────────────────────── */

export interface FormRow {
  readonly reference: string;
  readonly description: string;
  readonly assignedBy: string;
  readonly priority: string;
  readonly startDate: string;
  readonly endDate: string;
  /** The wording that goes in "Progress on Task". */
  readonly progress: string;
  readonly tone: 'green' | 'amber' | 'red' | 'grey';
}

export interface TaskFormSheet {
  readonly name: string;
  readonly department: string;
  readonly designation: string;
  /** "Assigned By" for the header: one name, or "Various" when they differ. */
  readonly assignedBy: string;
  readonly assignedDate: string;
  /** Which of the three boxes to tick. */
  readonly priority: 'High' | 'Medium' | 'Low' | null;
  readonly dayLabel: string;
  readonly rows: readonly FormRow[];
  readonly completed: number;
  readonly remaining: number;
  readonly overdue: number;
}

export interface TaskFormInput {
  readonly company: CompanyLetterhead;
  readonly generatedAt: string;
  readonly generatedFor: string;
  readonly sheets: readonly TaskFormSheet[];
}

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    return null;
  }
}

/* The columns of the form's own table, as fractions of the content width.
   ⚠️ The paper form has five; ours has seven. "Assigned By" is here because the
   owner asked for the name on every row — one task has exactly one assigner,
   but a day's tasks can come from several people. "Priority" is here for the
   same reason: the header's three boxes describe the SHEET, and a day can hold
   a High task and a Low one. */
const COLS = [
  { key: 'no', label: 'S #', w: 0.055, align: 'center' as const },
  { key: 'desc', label: 'Task / Activity Description', w: 0.335 },
  { key: 'by', label: 'Assigned By', w: 0.125 },
  { key: 'pri', label: 'Priority', w: 0.08, align: 'center' as const },
  { key: 'start', label: 'Starting Date', w: 0.115, align: 'center' as const },
  { key: 'end', label: 'Ending Date', w: 0.115, align: 'center' as const },
  { key: 'prog', label: 'Progress on Task', w: 0.175, align: 'center' as const },
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

const TONE = { green: INK.green, amber: INK.amber, red: INK.red, grey: INK.soft } as const;

function drawMasthead(kit: Kit, input: TaskFormInput, logo: PDFImage | null): number {
  kit.page.drawRectangle({ x: 0, y: up(64), width: PAGE_W, height: 64, color: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(67), width: PAGE_W, height: 3, color: INK.gold });

  let x = M;
  const logoH = 26;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x, y: up(20 + logoH), width: logoW, height: logoH });
    x += logoW + 10;
  }
  text(kit, input.company.legalName, { x, top: 20, size: 11.5, bold: true, color: INK.white });
  if (input.company.division) {
    text(kit, input.company.division, { x, top: 35, size: 7.5, color: hex('#9fb6b8') });
  }
  text(kit, 'TASK ASSIGNMENT FORM', {
    x: M, top: 18, size: 13, bold: true, color: INK.white, align: 'right', width: CONTENT_W,
  });
  text(kit, 'CNI OFFICE, ISLAMABAD', {
    x: M, top: 36, size: 8.5, color: INK.gold, align: 'right', width: CONTENT_W,
  });
  return 78;
}

/** The form's own header block — the paper version's top table. */
function drawHeaderBlock(kit: Kit, sheet: TaskFormSheet, top: number): number {
  const labelW = 108;
  const rowH = 17;
  const rows: Array<[string, string]> = [
    ['Name', sheet.name],
    ['Department', sheet.department],
    ['Designation', sheet.designation],
  ];

  box(kit, M, top, CONTENT_W, rowH * 3);
  /* One merged label cell down the left, exactly as the form draws it. */
  line(kit, M + labelW, top, 0.7, INK.rule);
  kit.page.drawRectangle({
    x: M, y: up(top + rowH * 3), width: labelW, height: rowH * 3,
    borderColor: INK.rule, borderWidth: 0.7, color: INK.wash,
  });
  text(kit, 'Task Assigned To', { x: M + 6, top: top + rowH * 1.5 - 4, size: 8.5, bold: true });

  rows.forEach(([label, value], i) => {
    const y = top + rowH * i;
    if (i > 0) line(kit, M + labelW, y, CONTENT_W - labelW, INK.hair);
    text(kit, `${label}:`, { x: M + labelW + 6, top: y + 5, size: 8, italic: true, color: INK.soft });
    text(kit, value || '-', { x: M + labelW + 74, top: y + 5, size: 8.5, bold: true, width: CONTENT_W - labelW - 82 });
  });

  let y = top + rowH * 3;
  const meta: Array<[string, string]> = [
    ['Assigned By', sheet.assignedBy],
    ['Assigned Date', sheet.assignedDate],
  ];
  for (const [label, value] of meta) {
    box(kit, M, y, CONTENT_W, rowH);
    kit.page.drawRectangle({
      x: M, y: up(y + rowH), width: labelW, height: rowH,
      borderColor: INK.rule, borderWidth: 0.7, color: INK.wash,
    });
    text(kit, label, { x: M + 6, top: y + 5, size: 8.5, bold: true });
    text(kit, value || '-', { x: M + labelW + 6, top: y + 5, size: 8.5, width: CONTENT_W - labelW - 14 });
    y += rowH;
  }

  /* Priority, with the boxes ticked. */
  box(kit, M, y, CONTENT_W, rowH);
  kit.page.drawRectangle({
    x: M, y: up(y + rowH), width: labelW, height: rowH,
    borderColor: INK.rule, borderWidth: 0.7, color: INK.wash,
  });
  text(kit, 'Priority :', { x: M + 6, top: y + 5, size: 8.5, bold: true });
  let px = M + labelW + 8;
  for (const level of ['High', 'Medium', 'Low'] as const) {
    const on = sheet.priority === level;
    box(kit, px, y + 4.5, 8, 8, on ? INK.text : INK.rule);
    if (on) {
      /* A drawn tick, not a glyph — the WinAnsi font has no check mark. */
      kit.page.drawRectangle({ x: px + 2, y: up(y + 10.5), width: 4, height: 4, color: INK.text });
    }
    text(kit, level, { x: px + 12, top: y + 5, size: 8.5, italic: true });
    px += 12 + kit.italic.widthOfTextAtSize(level, 8.5) + 16;
  }
  y += rowH;

  /* The day this sheet is for, and how it went — the owner's "completed /
     left / overdue". */
  const bar = 18;
  kit.page.drawRectangle({ x: M, y: up(y + bar), width: CONTENT_W, height: bar, color: INK.wash });
  box(kit, M, y, CONTENT_W, bar);
  text(kit, `Task list for ${sheet.dayLabel}`, { x: M + 6, top: y + 5.5, size: 8.5, bold: true });
  const parts = [
    { t: `Completed ${sheet.completed}`, c: INK.green },
    { t: `Left ${sheet.remaining}`, c: INK.amber },
    { t: `Overdue ${sheet.overdue}`, c: sheet.overdue > 0 ? INK.red : INK.soft },
  ];
  let sx = M + CONTENT_W - 6;
  for (const p of [...parts].reverse()) {
    const w = kit.bold.widthOfTextAtSize(safe(p.t), 8.5);
    sx -= w;
    text(kit, p.t, { x: sx, top: y + 5.5, size: 8.5, bold: true, color: p.c });
    sx -= 14;
  }
  return y + bar + 10;
}

function drawTableHead(kit: Kit, top: number): number {
  const h = 24;
  const xs = colX();
  kit.page.drawRectangle({ x: M, y: up(top + h), width: CONTENT_W, height: h, color: INK.wash });
  box(kit, M, top, CONTENT_W, h);
  COLS.forEach((c, i) => {
    const w = c.w * CONTENT_W;
    if (i > 0) kit.page.drawRectangle({ x: xs[i], y: up(top + h), width: 0.7, height: h, color: INK.rule });
    const lines = wrap(kit.bold, c.label, 7.5, w - 8, 2);
    lines.forEach((ln, li) => {
      text(kit, ln, {
        x: xs[i] + 4, top: top + (lines.length === 1 ? 8 : 4) + li * 9,
        size: 7.5, bold: true, width: w - 8, align: c.align ?? 'left',
      });
    });
  });
  return top + h;
}

function drawRow(kit: Kit, r: FormRow, n: number, top: number): number {
  const xs = colX();
  const descW = COLS[1].w * CONTENT_W - 8;
  const descLines = wrap(kit.font, r.description, 8, descW, 2);
  const h = Math.max(26, 12 + descLines.length * 10);

  box(kit, M, top, CONTENT_W, h);
  COLS.forEach((c, i) => {
    if (i > 0) kit.page.drawRectangle({ x: xs[i], y: up(top + h), width: 0.7, height: h, color: INK.rule });
  });

  const mid = top + (h - 9) / 2;
  text(kit, `${n}.`, { x: xs[0], top: mid, size: 8, width: COLS[0].w * CONTENT_W, align: 'center' });

  descLines.forEach((ln, li) => {
    text(kit, ln, { x: xs[1] + 4, top: top + 6 + li * 10, size: 8, width: descW });
  });
  /* The reference under the title, so a row can be found in the system. */
  if (descLines.length === 1) {
    text(kit, r.reference, { x: xs[1] + 4, top: top + 16, size: 6.5, color: INK.soft, width: descW });
  } else {
    text(kit, r.reference, { x: xs[1] + 4, top: top + 6 + descLines.length * 10, size: 6.5, color: INK.soft, width: descW });
  }

  text(kit, r.assignedBy, { x: xs[2] + 4, top: mid, size: 7.5, width: COLS[2].w * CONTENT_W - 8 });
  text(kit, r.priority, { x: xs[3], top: mid, size: 7.5, width: COLS[3].w * CONTENT_W, align: 'center' });
  text(kit, r.startDate, { x: xs[4], top: mid, size: 7.5, width: COLS[4].w * CONTENT_W, align: 'center' });
  text(kit, r.endDate, { x: xs[5], top: mid, size: 7.5, width: COLS[5].w * CONTENT_W, align: 'center' });
  text(kit, r.progress, {
    x: xs[6], top: mid, size: 7.5, bold: true, color: TONE[r.tone],
    width: COLS[6].w * CONTENT_W, align: 'center',
  });
  return top + h;
}

/**
 * The signature blocks — always empty.
 *
 * ⚠️ NOTHING IS EVER PRINTED INTO ONE. See the file header.
 */
function drawSignatures(kit: Kit, top: number): number {
  let y = top + 12;
  const lineW = 150;
  text(kit, 'Signatures of Individual', {
    x: M, top: y, size: 8.5, bold: true, width: CONTENT_W - lineW - 8, align: 'right',
  });
  line(kit, M + CONTENT_W - lineW, y + 11, lineW, INK.text, 0.8);
  y += 22;

  for (const who of ['Signatures & Remarks of HOD', 'Signatures & Remarks of C.O.O', 'Signatures & Remarks of C.E.O']) {
    const h = 44;
    box(kit, M, y, CONTENT_W, h);
    kit.page.drawRectangle({ x: M, y: up(y + 14), width: CONTENT_W, height: 14, color: INK.wash });
    line(kit, M, y + 14, CONTENT_W, INK.rule);
    text(kit, who, { x: M + 6, top: y + 3.5, size: 8, bold: true });
    text(kit, 'Date:-', { x: M + 6, top: y + h - 13, size: 8 });
    text(kit, 'Signature', { x: M + CONTENT_W - 190, top: y + h - 13, size: 8 });
    line(kit, M + CONTENT_W - 140, y + h - 4, 134, INK.text, 0.8);
    y += h;
  }
  return y;
}

function drawFooter(kit: Kit, input: TaskFormInput, page: number, of: number) {
  line(kit, M, PAGE_H - 30, CONTENT_W, INK.hair);
  text(kit, `Exported by ${input.generatedFor}  ${input.generatedAt}`, {
    x: M, top: PAGE_H - 25, size: 7, color: INK.soft,
  });
  text(kit, `Page ${page} of ${of}`, {
    x: M, top: PAGE_H - 25, size: 7, color: INK.soft, align: 'right', width: CONTENT_W,
  });
}

export async function composeTaskAssignmentForms(input: TaskFormInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Task assignment form');
  pdf.setProducer(input.company.legalName);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await loadLogo(pdf);

  for (const sheet of input.sheets) {
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let kit: Kit = { pdf, page, font, bold, italic };
    let y = drawMasthead(kit, input, logo);
    y = drawHeaderBlock(kit, sheet, y);
    y = drawTableHead(kit, y);

    const rows = sheet.rows;
    for (let i = 0; i < rows.length; i += 1) {
      /* ⚠️ RESERVE THE SIGNATURE BLOCKS. They are ~160pt and must not be
         orphaned onto a page of their own with no tasks above them. */
      const isLast = i === rows.length - 1;
      const need = 28 + (isLast ? 170 : 0);
      if (y + need > FLOOR) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        kit = { pdf, page, font, bold, italic };
        y = drawMasthead(kit, input, logo);
        text(kit, `${sheet.name}  ·  ${sheet.dayLabel}  (continued)`, {
          x: M, top: y, size: 8.5, bold: true,
        });
        y += 14;
        y = drawTableHead(kit, y);
      }
      y = drawRow(kit, rows[i], i + 1, y);
    }

    if (rows.length === 0) {
      box(kit, M, y, CONTENT_W, 30);
      text(kit, 'No task was due, completed or outstanding on this day.', {
        x: M, top: y + 11, size: 8.5, italic: true, color: INK.soft, width: CONTENT_W, align: 'center',
      });
      y += 30;
    }

    if (y + 170 > FLOOR) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      kit = { pdf, page, font, bold, italic };
      y = drawMasthead(kit, input, logo);
    }
    drawSignatures(kit, y);
  }

  /* Page numbers last, once the total is known. */
  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    drawFooter({ pdf, page: p, font, bold, italic }, input, i + 1, total);
  });
  return pdf.save();
}
