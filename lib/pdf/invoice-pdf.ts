import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import {
  INVOICE_KIND_META,
  longDate,
  termsLabel,
  type CompanyLetterhead,
  type InvoiceKind,
} from '@/lib/domain/invoice';
import { plain } from '@/lib/domain/money';

/* ============================================================================
 * THE INVOICE — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"A proper PDF with my proper template. The template should have a proper
 * logo, some professional text, not too much, and be filled with text. A proper
 * table that will define the exact amount, the due date, and all that stuff. At
 * the bottom, whether it's the CEO or from my account, you can say the CTO, and
 * attach my signature to that PDF."*
 *
 * ── ⚠️ A4 PORTRAIT, WHERE THE REPORT SHEET IS LANDSCAPE ────────────────────
 * Not a style choice. `lib/pdf/report-sheet.ts` is landscape because twelve
 * columns cannot set in 43pt. An invoice has five columns and is READ AS A
 * DOCUMENT — it gets printed, signed, filed and attached to a bank transfer.
 * Every invoice anybody has ever received is portrait A4, and a landscape one
 * announces itself as software output rather than as a document.
 *
 * ── ⚠️ NOTHING ON THIS PAGE IS INVENTED ────────────────────────────────────
 * Every block reads off `CompanyLetterhead`, and a block whose fields are blank
 * is OMITTED rather than filled with a placeholder. The temptation is
 * "Bank: [your bank]" so the layout looks finished; the consequence is an
 * invoice a client pays into an account that does not exist. A gap is a thing
 * somebody notices and fills in. See `hasBankDetails`.
 *
 * ── ⚠️ EVERY FIGURE COMES IN ALREADY COMPUTED ──────────────────────────────
 * This file does no arithmetic on money at all — not even a subtotal. The
 * totals arrive from `lib/domain/invoice.ts`, which is the same pure module the
 * form previews from and the server stored from. The number on the paper is the
 * number on the screen BY CONSTRUCTION. A composer that re-adds its own column
 * is a second opinion about what a client owes.
 *
 * ── PAGINATION ─────────────────────────────────────────────────────────────
 * The line table breaks across pages when it has to, and the totals, the
 * payment block and the signature always sit together on the LAST page. A
 * signature on its own orphan page reads as an afterthought, and a total
 * separated from the lines it totals is the thing a client queries.
 * ========================================================================= */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const M = 44;
const CONTENT_W = PAGE_W - M * 2;
/** Nothing is drawn below this; the footer band lives here. */
const FLOOR = PAGE_H - 64;

const hex = (value: string) => {
  const n = parseInt(value.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* The light palette, from styles/tokens.css. Paper has no dark mode, and the
   dark palette on white is unreadable — the same call report-sheet.ts makes. */
const INK = {
  text: hex('#12222a'),
  soft: hex('#5b6f77'),
  rule: hex('#dde7e8'),
  hairline: hex('#e6eded'),
  wash: hex('#f4f8f8'),
  band: hex('#0e2a2c'),
  brand: hex('#0e5c63'),
  gold: hex('#d4a63c'),
  white: rgb(1, 1, 1),
  danger: hex('#dc2626'),
} as const;

const up = (fromTop: number) => PAGE_H - fromTop;

/**
 * ⚠️ Helvetica is WinAnsi-encoded and `drawText` THROWS on anything outside it.
 * One em dash in a project name would fail the whole invoice — and this
 * division's own data is full of them: four of five library documents are
 * titled with one, and `lib/domain/content-disposition.ts` exists because one
 * crashed a route. Every string drawn goes through here.
 */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xff]/g, '-');
}

const widthOf = (font: PDFFont, text: string, size: number) =>
  font.widthOfTextAtSize(safe(text), size);

/** Greedy wrap. A single word longer than the line is broken rather than left
 *  to overflow — a long service description has to go somewhere. */
function wrap(font: PDFFont, raw: string, size: number, max: number): string[] {
  const text = safe(raw).trim();
  if (text === '') return [''];

  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= max) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (font.widthOfTextAtSize(word, size) <= max) {
      line = word;
      continue;
    }
    /* One word wider than the column. Break it rather than overflow. */
    let chunk = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > max) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    line = chunk;
  }

  if (line) lines.push(line);
  return lines;
}

interface Kit {
  page: PDFPage;
  readonly bold: PDFFont;
  readonly regular: PDFFont;
}

function text(
  kit: Kit,
  value: string,
  o: {
    x: number;
    top: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    align?: 'left' | 'right' | 'centre';
    width?: number;
  },
): void {
  const size = o.size ?? 9.5;
  const font = o.bold ? kit.bold : kit.regular;
  const drawn = safe(value);

  let x = o.x;
  if (o.align === 'right' && o.width !== undefined) {
    x = o.x + o.width - widthOf(font, drawn, size);
  } else if (o.align === 'centre' && o.width !== undefined) {
    x = o.x + (o.width - widthOf(font, drawn, size)) / 2;
  }

  kit.page.drawText(drawn, { x, y: up(o.top + size), size, font, color: o.color ?? INK.text });
}

function rule(kit: Kit, top: number, color = INK.rule, x = M, w = CONTENT_W, thickness = 0.7) {
  kit.page.drawRectangle({ x, y: up(top), width: w, height: thickness, color });
}

function box(
  kit: Kit,
  o: { x: number; top: number; w: number; h: number; fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb> },
) {
  kit.page.drawRectangle({
    x: o.x,
    y: up(o.top + o.h),
    width: o.w,
    height: o.h,
    color: o.fill,
    borderColor: o.border,
    borderWidth: o.border ? 0.7 : 0,
  });
}

/* ============================================================================
 * WHAT THE COMPOSER NEEDS
 * ========================================================================= */

export interface InvoicePdfInput {
  readonly invoiceNo: string;
  readonly kind: InvoiceKind;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly paymentTermsDays: number;

  readonly billedToName: string;
  readonly billedToPerson: string | null;
  readonly billedToEmail: string | null;
  readonly billedToAddress: string | null;

  readonly lines: ReadonlyArray<{
    description: string;
    quantity: number;
    unitPricePkr: number;
    amountPkr: number;
  }>;

  /** Already computed — this file does no money arithmetic. See the header. */
  readonly subtotalPkr: number;
  readonly taxRatePct: number | null;
  readonly taxPkr: number | null;
  readonly totalPkr: number;

  readonly clientNote: string | null;
  readonly company: CompanyLetterhead;

  readonly signedByName: string;
  readonly signedByTitle: string | null;
  /** The drawn signature as PNG bytes, or null to print the rule alone. */
  readonly signaturePng: Uint8Array | null;

  /** Stamped across the page when the invoice has been voided. */
  readonly voided: boolean;
}

const ASSETS = path.join(process.cwd(), 'lib', 'pdf', 'assets', 'render');

async function loadLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readFile(path.join(ASSETS, 'logo.png')));
  } catch {
    /* A missing asset must not fail an invoice somebody is trying to send. The
       wordmark below still identifies who issued it. */
    return null;
  }
}

/* ============================================================================
 * THE DOCUMENT
 * ========================================================================= */

export async function composeInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${input.invoiceNo}`);
  pdf.setAuthor(input.company.legalName);
  pdf.setSubject(`${INVOICE_KIND_META[input.kind].label} for ${input.billedToName}`);
  pdf.setProducer('Taskly');
  pdf.setCreator('Taskly');

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await loadLogo(pdf);

  let signature: PDFImage | null = null;
  if (input.signaturePng) {
    try {
      signature = await pdf.embedPng(input.signaturePng);
    } catch {
      /* ⚠️ Checked, not assumed. `embedPng` throws an opaque parse error on a
         file that is not really a PNG, and an unsendable invoice is a worse
         outcome than one signed with a printed name. `lib/ai/report-image.ts`
         records the same lesson. */
      signature = null;
    }
  }

  const pages: PDFPage[] = [];
  const newPage = (): Kit => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    return { page, bold, regular };
  };

  let kit = newPage();
  let cursor = drawMasthead(kit, input, logo);

  cursor = drawParties(kit, input, cursor);

  /* ── The line table, breaking across pages when it must ─────────────────── */
  const COLS = tableColumns();
  cursor = drawTableHead(kit, COLS, cursor);

  for (const [index, line] of input.lines.entries()) {
    const descriptionLines = wrap(regular, line.description, 9.5, COLS.description.w - 8);
    const rowH = Math.max(22, descriptionLines.length * 12 + 10);

    /* ⚠️ MEASURED BEFORE IT IS DRAWN. A row's height is not known until its
       description has been wrapped, so the break is decided first — drawing and
       growing as you go is how a row's background stops halfway down its text.
       The reserve keeps the totals block off a page of its own. */
    if (cursor + rowH > FLOOR - 40) {
      kit = newPage();
      cursor = drawContinuationHead(kit, input);
      cursor = drawTableHead(kit, COLS, cursor);
    }

    drawRow(kit, COLS, line, cursor, rowH, index);
    cursor += rowH;
  }

  rule(kit, cursor, INK.rule);
  cursor += 14;

  /* ── Totals, payment and signature belong together on the last page ────── */
  const tailH = totalsHeight(input) + signatureHeight() + paymentHeight(input);
  if (cursor + tailH > FLOOR) {
    kit = newPage();
    cursor = drawContinuationHead(kit, input);
  }

  cursor = drawTotals(kit, input, cursor);
  cursor = drawPaymentBlock(kit, input, cursor);
  drawSignature(kit, input, signature, cursor);

  if (input.voided) drawVoidStamp(kit);

  /* The footer goes on every page, and it can only be drawn once the total
     number of pages is known — hence the second pass. */
  pages.forEach((page, index) => {
    drawFooter({ page, bold, regular }, input, index + 1, pages.length);
  });

  return pdf.save();
}

/* ── The masthead ─────────────────────────────────────────────────────────── */

function drawMasthead(kit: Kit, input: InvoicePdfInput, logo: PDFImage | null): number {
  const { company } = input;

  /* A dark band, the same one the email template opens with. The document and
     the message it arrives in are recognisably the same thing. */
  box(kit, { x: 0, top: 0, w: PAGE_W, h: 96, fill: INK.band });
  kit.page.drawRectangle({ x: 0, y: up(99), width: PAGE_W, height: 3, color: INK.gold });

  let x = M;
  const logoH = 34;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    kit.page.drawImage(logo, { x, y: up(28 + logoH), width: logoW, height: logoH });
    x += logoW + 12;
  }

  text(kit, company.legalName, { x, top: 28, size: 14, bold: true, color: INK.white });
  if (company.division) {
    text(kit, company.division, { x, top: 46, size: 8.5, color: hex('#9fb6b8') });
  }

  /* The word INVOICE, right-aligned and unmissable. It is the first thing
     somebody opening the attachment needs to know it is. */
  text(kit, 'INVOICE', {
    x: M,
    top: 24,
    size: 22,
    bold: true,
    color: INK.white,
    align: 'right',
    width: CONTENT_W,
  });
  text(kit, input.invoiceNo, {
    x: M,
    top: 52,
    size: 10,
    color: INK.gold,
    align: 'right',
    width: CONTENT_W,
  });
  text(kit, INVOICE_KIND_META[input.kind].label, {
    x: M,
    top: 66,
    size: 8,
    color: hex('#9fb6b8'),
    align: 'right',
    width: CONTENT_W,
  });

  return 122;
}

/** A slim header for pages two onward, so a stray page still identifies itself. */
function drawContinuationHead(kit: Kit, input: InvoicePdfInput): number {
  box(kit, { x: 0, top: 0, w: PAGE_W, h: 40, fill: INK.band });
  text(kit, input.company.legalName, { x: M, top: 14, size: 9.5, bold: true, color: INK.white });
  text(kit, `Invoice ${input.invoiceNo} (continued)`, {
    x: M,
    top: 14,
    size: 9.5,
    color: INK.gold,
    align: 'right',
    width: CONTENT_W,
  });
  return 62;
}

/* ── Who, to whom, and when ───────────────────────────────────────────────── */

function drawParties(kit: Kit, input: InvoicePdfInput, top: number): number {
  const { company } = input;
  const colW = (CONTENT_W - 20) / 2;
  const rightX = M + colW + 20;

  text(kit, 'FROM', { x: M, top, size: 7.5, bold: true, color: INK.soft });
  text(kit, 'BILL TO', { x: rightX, top, size: 7.5, bold: true, color: INK.soft });

  let leftY = top + 14;
  let rightY = top + 14;

  text(kit, company.legalName, { x: M, top: leftY, size: 10.5, bold: true });
  leftY += 15;

  /* ⚠️ Only what exists. A blank line where an address should be reads as a
     rendering fault; an omitted block reads as a company that has not filled it
     in — which is the truth, and is fixable in Settings. */
  for (const line of company.addressLines) {
    text(kit, line, { x: M, top: leftY, size: 9, color: INK.soft });
    leftY += 12;
  }
  for (const [label, value] of [
    ['', company.phone],
    ['', company.email],
    ['', company.website],
    ['NTN ', company.ntn],
    ['STRN ', company.strn],
  ] as const) {
    if (!value) continue;
    text(kit, `${label}${value}`, { x: M, top: leftY, size: 9, color: INK.soft });
    leftY += 12;
  }

  text(kit, input.billedToName, { x: rightX, top: rightY, size: 10.5, bold: true });
  rightY += 15;
  if (input.billedToPerson && input.billedToPerson !== input.billedToName) {
    text(kit, `Attn: ${input.billedToPerson}`, { x: rightX, top: rightY, size: 9, color: INK.soft });
    rightY += 12;
  }
  if (input.billedToAddress) {
    for (const line of input.billedToAddress.split(/\r?\n/).filter((l) => l.trim())) {
      for (const wrapped of wrap(kit.regular, line, 9, colW)) {
        text(kit, wrapped, { x: rightX, top: rightY, size: 9, color: INK.soft });
        rightY += 12;
      }
    }
  }
  if (input.billedToEmail) {
    text(kit, input.billedToEmail, { x: rightX, top: rightY, size: 9, color: INK.soft });
    rightY += 12;
  }

  /* ── The three dates, in a tinted strip ─────────────────────────────────
     ⚠️ THE DUE DATE IS THE LOUDEST THING HERE, in the brand colour and bold.
     It is the one fact on the page the owner named twice — *"I should know that
     after the 10th of September this invoice is due"* — and it is what the
     whole document exists to communicate alongside the amount. */
  const stripTop = Math.max(leftY, rightY) + 10;
  box(kit, { x: M, top: stripTop, w: CONTENT_W, h: 40, fill: INK.wash, border: INK.hairline });

  const cell = CONTENT_W / 3;
  const dates: ReadonlyArray<[string, string, boolean]> = [
    ['ISSUE DATE', longDate(input.issuedOn), false],
    ['DUE DATE', longDate(input.dueOn), true],
    ['TERMS', termsLabel(input.paymentTermsDays), false],
  ];

  dates.forEach(([label, value, loud], index) => {
    const x = M + cell * index + 12;
    text(kit, label, { x, top: stripTop + 9, size: 7, bold: true, color: INK.soft });
    text(kit, value, {
      x,
      top: stripTop + 21,
      size: 10,
      bold: loud,
      color: loud ? INK.brand : INK.text,
    });
    if (index > 0) {
      kit.page.drawRectangle({
        x: M + cell * index,
        y: up(stripTop + 32),
        width: 0.7,
        height: 24,
        color: INK.hairline,
      });
    }
  });

  return stripTop + 58;
}

/* ── The table ────────────────────────────────────────────────────────────── */

interface Columns {
  description: { x: number; w: number };
  quantity: { x: number; w: number };
  rate: { x: number; w: number };
  amount: { x: number; w: number };
}

function tableColumns(): Columns {
  const amountW = 92;
  const rateW = 86;
  const quantityW = 46;
  const descriptionW = CONTENT_W - amountW - rateW - quantityW;
  return {
    description: { x: M, w: descriptionW },
    quantity: { x: M + descriptionW, w: quantityW },
    rate: { x: M + descriptionW + quantityW, w: rateW },
    amount: { x: M + descriptionW + quantityW + rateW, w: amountW },
  };
}

function drawTableHead(kit: Kit, cols: Columns, top: number): number {
  box(kit, { x: M, top, w: CONTENT_W, h: 24, fill: INK.band });

  text(kit, 'DESCRIPTION', { x: cols.description.x + 8, top: top + 8, size: 7.5, bold: true, color: INK.white });
  text(kit, 'QTY', { x: cols.quantity.x, top: top + 8, size: 7.5, bold: true, color: INK.white, align: 'right', width: cols.quantity.w - 8 });
  text(kit, 'RATE (PKR)', { x: cols.rate.x, top: top + 8, size: 7.5, bold: true, color: INK.white, align: 'right', width: cols.rate.w - 8 });
  text(kit, 'AMOUNT (PKR)', { x: cols.amount.x, top: top + 8, size: 7.5, bold: true, color: INK.white, align: 'right', width: cols.amount.w - 8 });

  return top + 24;
}

function drawRow(
  kit: Kit,
  cols: Columns,
  line: { description: string; quantity: number; unitPricePkr: number; amountPkr: number },
  top: number,
  height: number,
  index: number,
): void {
  /* Zebra striping. Faint enough to survive a black-and-white printer without
     turning into a grey block. */
  if (index % 2 === 1) {
    box(kit, { x: M, top, w: CONTENT_W, h: height, fill: hex('#fafcfc') });
  }

  const lines = wrap(kit.regular, line.description, 9.5, cols.description.w - 16);
  lines.forEach((value, i) => {
    text(kit, value, { x: cols.description.x + 8, top: top + 6 + i * 12, size: 9.5 });
  });

  /* ⚠️ A whole quantity prints as "1", not "1.00". Half a day prints as "0.5".
     `toLocaleString` would give "1" for both 1 and 1.004, so the check is on
     the value rather than on the formatting. */
  const quantity = Number.isInteger(line.quantity)
    ? String(line.quantity)
    : String(Math.round(line.quantity * 100) / 100);

  text(kit, quantity, { x: cols.quantity.x, top: top + 6, size: 9.5, align: 'right', width: cols.quantity.w - 8, color: INK.soft });
  text(kit, plain(line.unitPricePkr), { x: cols.rate.x, top: top + 6, size: 9.5, align: 'right', width: cols.rate.w - 8, color: INK.soft });
  text(kit, plain(line.amountPkr), { x: cols.amount.x, top: top + 6, size: 9.5, bold: true, align: 'right', width: cols.amount.w - 8 });

  rule(kit, top + height, INK.hairline);
}

/* ── Totals ───────────────────────────────────────────────────────────────── */

function totalsHeight(input: InvoicePdfInput): number {
  return input.taxPkr === null ? 54 : 76;
}

function drawTotals(kit: Kit, input: InvoicePdfInput, top: number): number {
  const boxW = 250;
  const x = M + CONTENT_W - boxW;
  let y = top;

  const row = (label: string, value: string, o?: { bold?: boolean; color?: ReturnType<typeof rgb> }) => {
    text(kit, label, { x, top: y, size: 9.5, color: INK.soft });
    text(kit, value, {
      x,
      top: y,
      size: o?.bold ? 12 : 9.5,
      bold: o?.bold,
      color: o?.color,
      align: 'right',
      width: boxW,
    });
    y += o?.bold ? 20 : 16;
  };

  /* ⚠️ The subtotal is printed ONLY when there is a tax line to separate it
     from the total. On an untaxed invoice "Subtotal 120,000 / Total 120,000" is
     the same number twice, which invites the reader to look for the difference. */
  if (input.taxPkr !== null) {
    row('Subtotal', plain(input.subtotalPkr));
    row(`${input.company.taxLabel} @ ${trimRate(input.taxRatePct ?? 0)}%`, plain(input.taxPkr));
    rule(kit, y - 4, INK.rule, x, boxW);
    y += 6;
  }

  box(kit, { x, top: y - 4, w: boxW, h: 30, fill: INK.wash, border: INK.hairline });
  text(kit, 'TOTAL DUE', { x: x + 10, top: y + 6, size: 8.5, bold: true, color: INK.soft });
  text(kit, `PKR ${plain(input.totalPkr)}`, {
    x,
    top: y + 3,
    size: 13,
    bold: true,
    color: INK.brand,
    align: 'right',
    width: boxW - 10,
  });

  return y + 44;
}

/** `16` not `16.00`, `16.5` kept. A trailing zero reads as precision. */
function trimRate(rate: number): string {
  const one = Math.round(rate * 100) / 100;
  return Number.isInteger(one) ? String(one) : String(one);
}

/* ── How to pay ───────────────────────────────────────────────────────────── */

function paymentHeight(input: InvoicePdfInput): number {
  const bank = [input.company.bankName, input.company.bankTitle, input.company.bankAccount, input.company.bankIban]
    .filter(Boolean).length;
  const note = input.clientNote ? 30 : 0;
  return (bank > 0 ? 34 + bank * 12 : 0) + note;
}

function drawPaymentBlock(kit: Kit, input: InvoicePdfInput, top: number): number {
  const { company } = input;
  let y = top;

  const bank: Array<[string, string]> = [];
  if (company.bankName) bank.push(['Bank', company.bankName]);
  if (company.bankTitle) bank.push(['Account title', company.bankTitle]);
  if (company.bankAccount) bank.push(['Account no.', company.bankAccount]);
  if (company.bankIban) bank.push(['IBAN', company.bankIban]);

  /* Omitted entirely when there is nothing true to say — see the file header. */
  if (bank.length > 0) {
    text(kit, 'HOW TO PAY', { x: M, top: y, size: 7.5, bold: true, color: INK.soft });
    y += 14;
    for (const [label, value] of bank) {
      text(kit, label, { x: M, top: y, size: 9, color: INK.soft });
      text(kit, value, { x: M + 90, top: y, size: 9, bold: true });
      y += 12;
    }
    y += 10;
  }

  if (input.clientNote) {
    for (const line of wrap(kit.regular, input.clientNote, 9, CONTENT_W - 260)) {
      text(kit, line, { x: M, top: y, size: 9, color: INK.soft });
      y += 12;
    }
    y += 8;
  }

  return y;
}

/* ── The signature ────────────────────────────────────────────────────────── */

/** The signature block is a fixed height, so the last-page reserve can be
 *  worked out before anything is drawn. */
function signatureHeight(): number {
  return 96;
}

function drawSignature(
  kit: Kit,
  input: InvoicePdfInput,
  signature: PDFImage | null,
  top: number,
): void {
  /* Pinned toward the bottom of the page rather than following the content.
     A signature that floats up under a short invoice reads as part of the
     table; at the foot of the page it reads as somebody signing off. */
  const y = Math.max(top, FLOOR - 96);
  const blockW = 200;
  const x = M + CONTENT_W - blockW;

  if (signature) {
    /* ⚠️ Fitted to a box, never stretched. A signature scaled on one axis is
       somebody else's handwriting. */
    const maxW = blockW - 10;
    const maxH = 42;
    const scale = Math.min(maxW / signature.width, maxH / signature.height);
    const w = signature.width * scale;
    const h = signature.height * scale;
    kit.page.drawImage(signature, { x: x + (blockW - w) / 2, y: up(y + 44), width: w, height: h });
  }

  rule(kit, y + 48, INK.rule, x, blockW);

  text(kit, input.signedByName, {
    x,
    top: y + 54,
    size: 9.5,
    bold: true,
    align: 'centre',
    width: blockW,
  });
  if (input.signedByTitle) {
    text(kit, input.signedByTitle, {
      x,
      top: y + 67,
      size: 8,
      color: INK.soft,
      align: 'centre',
      width: blockW,
    });
  }
  text(kit, `For ${input.company.legalName}`, {
    x,
    top: input.signedByTitle ? y + 78 : y + 67,
    size: 7.5,
    color: INK.soft,
    align: 'centre',
    width: blockW,
  });
}

/* ── Void ─────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ A REGENERATED VOID COPY IS STAMPED, so a PDF that has already left the
 * building cannot be mistaken for a live invoice when somebody re-downloads it
 * from the archive. The client's original copy is of course unstamped — nothing
 * can change that, which is exactly why voiding is a record rather than an edit.
 */
function drawVoidStamp(kit: Kit): void {
  kit.page.drawText('VOID', {
    x: PAGE_W / 2 - 150,
    y: PAGE_H / 2 - 40,
    size: 110,
    font: kit.bold,
    color: INK.danger,
    opacity: 0.12,
    /* pdf-lib's own helper rather than a hand-built object — the shape of a
       Rotation is internal and a cast past the type would break silently. */
    rotate: degrees(18),
  });
}

/* ── The footer ───────────────────────────────────────────────────────────── */

function drawFooter(kit: Kit, input: InvoicePdfInput, page: number, of: number): void {
  const top = PAGE_H - 40;
  rule(kit, top - 10, INK.hairline);

  const note = input.company.footerNote || '';
  if (note) text(kit, note, { x: M, top, size: 7.5, color: INK.soft });

  text(kit, `Invoice ${input.invoiceNo}`, {
    x: M,
    top,
    size: 7.5,
    color: INK.soft,
    align: 'centre',
    width: CONTENT_W,
  });

  /* ⚠️ "Page 1 of 3" rather than "Page 1". A client who receives two of three
     pages has no way to know a page is missing without the total. */
  text(kit, `Page ${page} of ${of}`, {
    x: M,
    top,
    size: 7.5,
    color: INK.soft,
    align: 'right',
    width: CONTENT_W,
  });
}
