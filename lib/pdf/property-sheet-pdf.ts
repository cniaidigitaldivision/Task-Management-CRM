import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import type { CompanyLetterhead } from '@/lib/domain/invoice';

/* ============================================================================
 * THE PROPERTY SHEET — the document a customer is actually sent
 * ----------------------------------------------------------------------------
 * The Share dialog's fourth channel. Portrait A4, one plot, on the company's
 * own letterhead — the same masthead the invoice and the client list draw, from
 * the same settings and the same logo, because two documents from one company
 * must look like they came from one company.
 *
 * ── ⚠️ IT IS BUILT FROM THE SAME ALLOW-LIST AS THE MESSAGE ────────────────
 * `PropertySheetInput` carries what a customer may see and nothing else. There
 * is no `notes`, no `leads`, no `booking` field on the type, so this file could
 * not print one if somebody asked it to — the same guarantee `shareLines()`
 * gives the WhatsApp text, for the same reason.
 *
 * ── ⚠️ AND IT SAYS THE PLOT IS NOT HELD ───────────────────────────────────
 * A price and an availability on company letterhead reads as an offer. The
 * footer says, on every page, that availability is confirmed at booking. The
 * owner asked for that sentence in the message; a printed sheet needs it more,
 * because it outlives the conversation.
 *
 * ── ⚠️ NOTHING LEGAL IS GENERATED ─────────────────────────────────────────
 * Owner: *"Do not generate dummy NOCs, title documents or government
 * approvals."* This is a marketing information sheet and says so in the footer.
 * It is not an allotment, an agreement or a title.
 * ========================================================================= */

const PAGE_W = 595.28; // A4 portrait — one plot reads DOWN, not across
const PAGE_H = 841.89;
const M = 42;
const CONTENT_W = PAGE_W - M * 2;
const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets');

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
  grey: hex('#5b6f77'),
} as const;

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS outside it — one em
 * dash in a project name would fail the whole export. Urdu script cannot be
 * drawn by a standard PDF font at all and becomes dashes; the CSV and Excel
 * exports keep it exactly.
 */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
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
  o: {
    x: number; top: number; size: number; bold?: boolean;
    color?: ReturnType<typeof rgb>; width?: number; align?: 'left' | 'right';
  },
) {
  const font = o.bold ? kit.bold : kit.font;
  const s = o.width ? fit(font, raw, o.size, o.width) : safe(raw);
  const w = font.widthOfTextAtSize(s, o.size);
  const x = o.align === 'right' && o.width ? o.x + o.width - w : o.x;
  kit.page.drawText(s, { x, y: up(o.top + o.size), size: o.size, font, color: o.color ?? INK.text });
}

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * ⚠️ WHAT MAY BE ON THE SHEET. Nothing internal has a field here.
 * ------------------------------------------------------------------------- */

export interface PropertySheetInput {
  readonly letterhead: CompanyLetterhead;
  /** `21 Sep 2026` — passed in, never read from the clock here. */
  readonly generatedOn: string;
  readonly preparedBy: string;

  readonly code: string;
  readonly plotNumber: string;
  readonly block: string;
  readonly projectName: string;
  readonly projectCity: string;

  readonly rows: readonly (readonly [string, string])[];
  readonly features: readonly string[];

  readonly basePrice: string;
  readonly premium: string;
  readonly total: string;
  readonly status: string;
  readonly statusTone: 'green' | 'amber' | 'red' | 'grey';

  readonly stages: readonly { readonly label: string; readonly share: string; readonly amount: string }[];
}

const TONE = { green: INK.green, amber: INK.amber, red: INK.red, grey: INK.grey } as const;

function masthead(kit: Kit, input: PropertySheetInput, logo: PDFImage | null): number {
  kit.page.drawRectangle({ x: 0, y: up(92), width: PAGE_W, height: 92, color: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(95), width: PAGE_W, height: 3, color: INK.gold });

  let x = M;
  if (logo) {
    const h = 34;
    const w = (logo.width / logo.height) * h;
    kit.page.drawImage(logo, { x: M, y: up(30 + h), width: w, height: h });
    x = M + w + 14;
  }
  text(kit, input.letterhead.legalName, { x, top: 30, size: 14, bold: true, color: INK.white, width: 300 });
  text(kit, input.letterhead.division ?? '', { x, top: 48, size: 9, color: INK.gold, width: 300 });

  text(kit, 'PROPERTY INFORMATION SHEET', {
    x: PAGE_W / 2, top: 30, size: 9, bold: true, color: INK.white,
    width: CONTENT_W / 2 - 10, align: 'right',
  });
  text(kit, input.generatedOn, {
    x: PAGE_W / 2, top: 45, size: 9, color: INK.rule,
    width: CONTENT_W / 2 - 10, align: 'right',
  });
  text(kit, `Prepared by ${input.preparedBy}`, {
    x: PAGE_W / 2, top: 59, size: 8, color: INK.rule,
    width: CONTENT_W / 2 - 10, align: 'right',
  });
  return 116;
}

function section(kit: Kit, title: string, top: number): number {
  text(kit, title.toUpperCase(), { x: M, top, size: 8.5, bold: true, color: INK.brand });
  kit.page.drawRectangle({ x: M, y: up(top + 14), width: CONTENT_W, height: 0.8, color: INK.rule });
  return top + 22;
}

export async function composePropertySheetPdf(input: PropertySheetInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.projectName} - ${input.plotNumber || input.code}`);
  pdf.setAuthor(input.letterhead.legalName);
  pdf.setSubject('Property information sheet');

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const kit: Kit = {
    pdf,
    page,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await loadLogo(pdf);

  let top = masthead(kit, input, logo);

  /* ── the plot ─────────────────────────────────────────────────────────── */
  text(kit, input.plotNumber ? `Plot ${input.plotNumber}` : input.code,
    { x: M, top, size: 22, bold: true, width: CONTENT_W - 130 });
  if (input.block) {
    const w = kit.bold.widthOfTextAtSize(safe(`Plot ${input.plotNumber}`), 22);
    text(kit, `· Block ${input.block}`, { x: M + w + 8, top: top + 4, size: 14, color: INK.soft });
  }

  /* the availability chip, right-aligned on the same line */
  const chipW = kit.bold.widthOfTextAtSize(safe(input.status), 9) + 20;
  kit.page.drawRectangle({
    x: PAGE_W - M - chipW, y: up(top + 20), width: chipW, height: 18,
    color: INK.wash, borderColor: TONE[input.statusTone], borderWidth: 0.8,
  });
  text(kit, input.status, {
    x: PAGE_W - M - chipW, top: top + 6, size: 9, bold: true,
    color: TONE[input.statusTone], width: chipW, align: 'right',
  });
  text(kit, input.status, { x: PAGE_W - M - chipW + 10, top: top + 6, size: 9, bold: true, color: TONE[input.statusTone] });

  top += 28;
  text(kit, `${input.projectName}${input.projectCity ? ` · ${input.projectCity}` : ''}`,
    { x: M, top, size: 10.5, color: INK.soft, width: CONTENT_W });
  top += 26;

  /* ── core information, two columns ───────────────────────────────────── */
  top = section(kit, 'Property details', top);
  const colW = (CONTENT_W - 20) / 2;
  const half = Math.ceil(input.rows.length / 2);
  input.rows.forEach(([k, v], i) => {
    const col = i < half ? 0 : 1;
    const line = i < half ? i : i - half;
    const x = M + col * (colW + 20);
    const y = top + line * 17;
    text(kit, k, { x, top: y, size: 9, color: INK.soft, width: colW * 0.48 });
    text(kit, v, { x: x + colW * 0.5, top: y, size: 9.5, bold: true, width: colW * 0.5 });
  });
  top += half * 17 + 10;

  if (input.features.length > 0) {
    let fx = M;
    for (const f of input.features) {
      const w = kit.font.widthOfTextAtSize(safe(f), 8.5) + 14;
      if (fx + w > PAGE_W - M) break;
      kit.page.drawRectangle({
        x: fx, y: up(top + 15), width: w, height: 15,
        color: INK.wash, borderColor: INK.rule, borderWidth: 0.6,
      });
      text(kit, f, { x: fx + 7, top: top + 4, size: 8.5, color: INK.soft });
      fx += w + 6;
    }
    top += 26;
  }

  /* ── pricing ─────────────────────────────────────────────────────────── */
  top = section(kit, 'Pricing', top);
  const boxW = (CONTENT_W - 16) / 3;
  ([['Base price', input.basePrice, false], ['Premium charges', input.premium, false],
    ['Total price', input.total, true]] as const).forEach(([label, value, strong], i) => {
    const x = M + i * (boxW + 8);
    kit.page.drawRectangle({
      x, y: up(top + 46), width: boxW, height: 46,
      color: strong ? INK.wash : INK.white, borderColor: INK.rule, borderWidth: 0.8,
    });
    text(kit, label, { x: x + 10, top: top + 10, size: 8.5, color: INK.soft, width: boxW - 20 });
    text(kit, value, { x: x + 10, top: top + 24, size: 13, bold: true, width: boxW - 20 });
  });
  top += 60;

  /* ── the payment plan ────────────────────────────────────────────────── */
  if (input.stages.length > 0) {
    top = section(kit, 'Payment plan', top);
    kit.page.drawRectangle({ x: M, y: up(top + 18), width: CONTENT_W, height: 18, color: INK.wash });
    text(kit, 'Stage', { x: M + 8, top: top + 5, size: 8.5, bold: true, color: INK.soft });
    text(kit, 'Share', { x: M + CONTENT_W - 210, top: top + 5, size: 8.5, bold: true, color: INK.soft, width: 60, align: 'right' });
    text(kit, 'Amount', { x: M + CONTENT_W - 140, top: top + 5, size: 8.5, bold: true, color: INK.soft, width: 132, align: 'right' });
    top += 18;

    for (const st of input.stages) {
      kit.page.drawRectangle({ x: M, y: up(top + 18), width: CONTENT_W, height: 0.6, color: INK.rule });
      text(kit, st.label, { x: M + 8, top: top + 5, size: 9, width: CONTENT_W - 230 });
      text(kit, st.share, { x: M + CONTENT_W - 210, top: top + 5, size: 9, color: INK.soft, width: 60, align: 'right' });
      text(kit, st.amount, { x: M + CONTENT_W - 140, top: top + 5, size: 9, bold: true, width: 132, align: 'right' });
      top += 18;
    }
    top += 8;
  }

  /* ── the footer, on the floor ────────────────────────────────────────── */
  const foot = PAGE_H - 62;
  kit.page.drawRectangle({ x: M, y: up(foot), width: CONTENT_W, height: 0.8, color: INK.rule });
  text(kit, 'Availability and pricing are subject to confirmation at the time of booking.',
    { x: M, top: foot + 8, size: 8.5, bold: true, color: INK.soft, width: CONTENT_W });
  /* ⚠️ The owner's legal line, on the document it protects. */
  text(kit, 'This is a property information sheet. It is not an allotment letter, an agreement, a NOC or a title document.',
    { x: M, top: foot + 21, size: 8, color: INK.soft, width: CONTENT_W });
  const contact = [input.letterhead.phone, input.letterhead.email, input.letterhead.website]
    .filter(Boolean).join('  ·  ');
  if (contact) {
    text(kit, contact, { x: M, top: foot + 34, size: 8, color: INK.soft, width: CONTENT_W });
  }

  return pdf.save();
}
