import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import type { CompanyLetterhead } from '@/lib/domain/invoice';

/* ============================================================================
 * THE CLIENT DIRECTORY AS A PDF — owner request, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"For the PDF use a proper format, a proper table, and everything should be
 * properly and sleekly organized … the proper header should be used in the same
 * way that we are using a header."*
 *
 * ── ⚠️ THE SAME LETTERHEAD AS THE INVOICE ─────────────────────────────────
 * The masthead is drawn exactly as `lib/pdf/invoice-pdf.ts` draws it — the dark
 * band, the gold rule, the logo, the legal name and the division — from the same
 * `CompanyLetterhead` settings and the same `logo.png`. Two documents from one
 * company must look like they came from one company.
 *
 * ── ⚠️ LANDSCAPE, WHERE THE INVOICE IS PORTRAIT ───────────────────────────
 * The report sheet's reason: nine columns do not set in portrait A4 without
 * truncating every name. A list is read across; an invoice is read down.
 *
 * ── ⚠️ NOTHING IS COMPUTED HERE ───────────────────────────────────────────
 * Every string arrives already worded by `lib/domain/crm-client-board.ts` —
 * the same module the screen draws from — so the PDF cannot say a different
 * thing from the page it was exported from.
 * ========================================================================= */

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const M = 36;
const CONTENT_W = PAGE_W - M * 2;
const FLOOR = PAGE_H - 46;
const ROW_H = 30;

const hex = (value: string) => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* The invoice's palette — the light theme, because paper has no dark mode. */
const INK = {
  text: hex('#12222a'),
  soft: hex('#5b6f77'),
  rule: hex('#dde7e8'),
  wash: hex('#f4f8f8'),
  band: hex('#0e2a2c'),
  brand: hex('#0e5c63'),
  gold: hex('#d4a63c'),
  white: rgb(1, 1, 1),
  green: hex('#15803d'),
  amber: hex('#b45309'),
  red: hex('#b91c1c'),
  blue: hex('#1d4ed8'),
  grey: hex('#5b6f77'),
} as const;

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS outside it — one em dash
 * in a project name would fail the whole export (the invoice's own warning).
 * A name written in Urdu script cannot be drawn by a standard PDF font at all;
 * it becomes dashes here, and the CSV and Excel exports keep it exactly.
 */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/·/g, '·')
    .replace(/[^\x20-\xff]/g, '-');
}

interface Kit {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
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

function text(
  kit: Kit,
  raw: string,
  o: { x: number; top: number; size: number; bold?: boolean; color?: ReturnType<typeof rgb>; width?: number; align?: 'left' | 'right' },
) {
  const font = o.bold ? kit.bold : kit.font;
  const s = o.width ? fit(font, raw, o.size, o.width) : safe(raw);
  const w = font.widthOfTextAtSize(s, o.size);
  const x = o.align === 'right' && o.width ? o.x + o.width - w : o.x;
  kit.page.drawText(s, { x, y: up(o.top + o.size), size: o.size, font, color: o.color ?? INK.text });
}

export interface ClientPdfRow {
  readonly ref: string;
  readonly name: string;
  readonly company: string;
  readonly phone: string;
  readonly email: string;
  readonly project: string;
  readonly owner: string;
  readonly status: string;
  readonly statusTone: 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'gold';
  readonly value: string;
  /** "quoted", when the figure is a quotation rather than a booking. */
  readonly valueNote?: string;
  readonly next: string;
  readonly nextLate: boolean;
  readonly lastContact: string;
}

export interface ClientPdfInput {
  readonly company: CompanyLetterhead;
  readonly title: string;
  readonly generatedFor: string;
  readonly generatedAt: string;
  /** What the export is of — the filters, in words. */
  readonly scope: string;
  readonly summary: ReadonlyArray<{ label: string; value: string }>;
  readonly rows: readonly ClientPdfRow[];
}

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    return null;
  }
}

/* The columns, as fractions of the content width. */
/* ⚠️ MEASURED BY READING THE PDF BACK, not by eye: at 0.075 the Value column
   printed "PKR 2.1M..." and the last header printed "Last conta...". */
const COLS: ReadonlyArray<{ key: string; label: string; w: number; align?: 'right' }> = [
  { key: 'ref', label: 'No.', w: 0.07 },
  { key: 'client', label: 'Client / company', w: 0.17 },
  { key: 'contact', label: 'Contact', w: 0.17 },
  { key: 'project', label: 'Linked project', w: 0.12 },
  { key: 'owner', label: 'Owner', w: 0.08 },
  { key: 'status', label: 'Relationship', w: 0.1 },
  { key: 'value', label: 'Value', w: 0.09, align: 'right' },
  { key: 'next', label: 'Next action', w: 0.11 },
  { key: 'last', label: 'Last contact', w: 0.09, align: 'right' },
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

/** The invoice's masthead, with this document's title on the right. */
function drawMasthead(kit: Kit, input: ClientPdfInput, logo: PDFImage | null) {
  kit.page.drawRectangle({ x: 0, y: up(78), width: PAGE_W, height: 78, color: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(81), width: PAGE_W, height: 3, color: INK.gold });

  let x = M;
  const logoH = 30;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x, y: up(22 + logoH), width: logoW, height: logoH });
    x += logoW + 12;
  }
  text(kit, input.company.legalName, { x, top: 24, size: 13, bold: true, color: INK.white });
  if (input.company.division) text(kit, input.company.division, { x, top: 41, size: 8, color: hex('#9fb6b8') });

  text(kit, input.title.toUpperCase(), { x: M, top: 22, size: 18, bold: true, color: INK.white, align: 'right', width: CONTENT_W });
  text(kit, input.generatedAt, { x: M, top: 46, size: 9, color: INK.gold, align: 'right', width: CONTENT_W });
}

/** A slim header for pages two onward, so a stray page still says what it is. */
function drawContinuation(kit: Kit, input: ClientPdfInput) {
  kit.page.drawRectangle({ x: 0, y: up(28), width: PAGE_W, height: 28, color: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(30), width: PAGE_W, height: 2, color: INK.gold });
  text(kit, `${input.company.legalName}  ·  ${input.title}`, { x: M, top: 9, size: 8.5, bold: true, color: INK.white });
  text(kit, input.generatedAt, { x: M, top: 9, size: 8.5, color: INK.gold, align: 'right', width: CONTENT_W });
}

function drawScope(kit: Kit, input: ClientPdfInput): number {
  let top = 96;
  text(kit, `Prepared for ${input.generatedFor}`, { x: M, top, size: 8.5, color: INK.soft });
  text(kit, input.scope, { x: M, top, size: 8.5, color: INK.soft, align: 'right', width: CONTENT_W });
  top += 18;

  /* The summary strip — the page's own cards, in figures. */
  const n = input.summary.length;
  const gap = 8;
  const w = (CONTENT_W - gap * (n - 1)) / n;
  input.summary.forEach((s, i) => {
    const x = M + i * (w + gap);
    kit.page.drawRectangle({ x, y: up(top + 40), width: w, height: 40, color: INK.wash, borderColor: INK.rule, borderWidth: 0.7 });
    kit.page.drawRectangle({ x, y: up(top + 40), width: 3, height: 40, color: INK.brand });
    text(kit, s.label, { x: x + 11, top: top + 7, size: 7.5, color: INK.soft, width: w - 18 });
    text(kit, s.value, { x: x + 11, top: top + 19, size: 13, bold: true, width: w - 18 });
  });
  return top + 54;
}

function drawTableHead(kit: Kit, top: number): number {
  const xs = colX();
  kit.page.drawRectangle({ x: M, y: up(top + 20), width: CONTENT_W, height: 20, color: INK.brand });
  COLS.forEach((c, i) => {
    const w = c.w * CONTENT_W - 10;
    text(kit, c.label, { x: xs[i] + 6, top: top + 6, size: 7.5, bold: true, color: INK.white, width: w, align: c.align });
  });
  return top + 20;
}

function drawRow(kit: Kit, r: ClientPdfRow, top: number, zebra: boolean) {
  const xs = colX();
  if (zebra) kit.page.drawRectangle({ x: M, y: up(top + ROW_H), width: CONTENT_W, height: ROW_H, color: INK.wash });
  kit.page.drawLine({ start: { x: M, y: up(top + ROW_H) }, end: { x: M + CONTENT_W, y: up(top + ROW_H) }, thickness: 0.5, color: INK.rule });
  const w = (i: number) => COLS[i].w * CONTENT_W - 12;
  const x = (i: number) => xs[i] + 6;

  text(kit, r.ref, { x: x(0), top: top + 10, size: 7.5, color: INK.soft, width: w(0) });

  text(kit, r.name, { x: x(1), top: top + 5, size: 8.5, bold: true, width: w(1) });
  text(kit, r.company || '—', { x: x(1), top: top + 17, size: 7, color: INK.soft, width: w(1) });

  text(kit, r.phone || '—', { x: x(2), top: top + 5, size: 7.5, width: w(2) });
  text(kit, r.email || '—', { x: x(2), top: top + 17, size: 7, color: INK.soft, width: w(2) });

  text(kit, r.project || '—', { x: x(3), top: top + 10, size: 7.5, width: w(3) });
  text(kit, r.owner || 'Nobody', { x: x(4), top: top + 10, size: 7.5, width: w(4) });

  /* The relationship as a pill, in the screen's own colour for it. */
  const tone = r.statusTone === 'gold' ? INK.gold : INK[r.statusTone];
  const label = fit(kit.bold, r.status, 7, w(5) - 10);
  const pillW = kit.bold.widthOfTextAtSize(label, 7) + 12;
  kit.page.drawRectangle({ x: x(5), y: up(top + 21), width: pillW, height: 12, color: rgb(1, 1, 1), borderColor: tone, borderWidth: 0.8 });
  kit.page.drawText(label, { x: x(5) + 6, y: up(top + 18.5), size: 7, font: kit.bold, color: tone });

  text(kit, r.value, { x: x(6), top: top + (r.valueNote ? 5 : 10), size: 8, bold: true, width: w(6), align: 'right' });
  if (r.valueNote) text(kit, r.valueNote, { x: x(6), top: top + 17, size: 7, color: INK.soft, width: w(6), align: 'right' });
  text(kit, r.next, { x: x(7), top: top + 10, size: 7.5, color: r.nextLate ? INK.red : INK.text, width: w(7) });
  text(kit, r.lastContact, { x: x(8), top: top + 10, size: 7.5, color: INK.soft, width: w(8), align: 'right' });
}

function drawFooter(kit: Kit, input: ClientPdfInput, page: number, of: number) {
  kit.page.drawLine({ start: { x: M, y: up(FLOOR + 10) }, end: { x: M + CONTENT_W, y: up(FLOOR + 10) }, thickness: 0.6, color: INK.rule });
  const c = input.company;
  const contact = [c.phone, c.email, c.website].filter((x) => x && x.trim()).join('   ·   ');
  text(kit, contact || c.legalName, { x: M, top: FLOOR + 17, size: 7.5, color: INK.soft, width: CONTENT_W * 0.6 });
  text(kit, `Confidential — client records   ·   Page ${page} of ${of}`, {
    x: M,
    top: FLOOR + 17,
    size: 7.5,
    color: INK.soft,
    align: 'right',
    width: CONTENT_W,
  });
}

export async function composeClientListPdf(input: ClientPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.company.legalName} — ${input.title}`);
  pdf.setAuthor(input.company.legalName);
  pdf.setCreator('Taskly CRM');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);

  const pages: PDFPage[] = [];
  const newPage = (first: boolean): { kit: Kit; top: number } => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    const kit: Kit = { pdf, page, font, bold };
    if (first) {
      drawMasthead(kit, input, logo);
      return { kit, top: drawTableHead(kit, drawScope(kit, input)) };
    }
    drawContinuation(kit, input);
    return { kit, top: drawTableHead(kit, 42) };
  };

  let { kit, top } = newPage(true);
  if (input.rows.length === 0) {
    text(kit, 'No clients match what was on screen when this was exported.', { x: M, top: top + 16, size: 9, color: INK.soft });
  }
  input.rows.forEach((r, i) => {
    if (top + ROW_H > FLOOR) ({ kit, top } = newPage(false));
    drawRow(kit, r, top, i % 2 === 1);
    top += ROW_H;
  });

  pages.forEach((page, i) => drawFooter({ pdf, page, font, bold }, input, i + 1, pages.length));
  return pdf.save();
}
