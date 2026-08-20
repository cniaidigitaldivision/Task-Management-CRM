import 'server-only';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ============================================================================
 * THE PDF — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"I want that to generate a report always in PDF format… Once it is generated put
 * that image in a PDF so that PDF can be viewed and downloaded."*
 *
 * ── ⚠️ WHY A REAL PDF AND NOT THE BROWSER'S PRINT DIALOGUE ────────────────────
 * Every other report in this system is print-to-PDF, deliberately: the print
 * stylesheet means the paper cannot disagree with the screen and there is no PDF engine
 * to carry. This one is different because the artefact IS a bitmap. There is no HTML
 * for a browser to lay out — the whole page is one generated image — and the owner
 * asked for a file that can be downloaded, not a dialogue that has to be driven.
 *
 * `pdf-lib` is pure JavaScript with no native dependencies, so it runs on a Vercel
 * function unchanged. It is the only dependency this feature adds.
 *
 * ── ⚠️ THE FOOTER IS THE FACTUAL BACKSTOP ────────────────────────────────────
 * A thin band of exact figures under the poster, drawn with real text. It exists
 * because the poster above it is a bitmap: nobody can select a number out of it, search
 * it, or check it. Three lines of machine-set type make the PDF self-verifying without
 * spoiling the design — and if the model ever does garble a figure, the footer is where
 * the discrepancy shows.
 * ========================================================================= */

/* A4 LANDSCAPE in PDF points (72 per inch).
   ⚠️ Landscape because the owner's reference layout is landscape (1491×1055) and the
   generated poster is 1536×1024. Fitting a 3:2 image onto a portrait page would leave
   two thirds of the sheet blank and shrink the text to unreadable. */
const A4_WIDTH = 841.89;
const A4_HEIGHT = 595.28;
const MARGIN = 24;

export interface ReportPdfInput {
  /** The generated poster. */
  readonly poster: Uint8Array;
  readonly projectName: string;
  readonly periodLabel: string;
  readonly kindLabel: string;
  /** The exact figures, drawn as real text under the poster. */
  readonly figures: readonly { readonly label: string; readonly value: string }[];
  readonly generatedOn: string;
  readonly generatedBy: string;
  readonly model: string;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  pdf.setTitle(`${input.projectName} — ${input.periodLabel}`);
  pdf.setAuthor('Crescent Nova International · AI & Digital Division');
  pdf.setSubject(`${input.kindLabel} for ${input.projectName}`);
  /* ⚠️ No `setCreationDate` with a live clock: two PDFs built from the same stored
     image would then differ byte for byte, and "is this the file I sent?" stops having
     an answer. The generation date is in the footer, where a human can read it. */
  pdf.setProducer('CNI CRM');

  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  const teal = rgb(0.059, 0.298, 0.298);
  const gold = rgb(0.788, 0.659, 0.298);
  const grey = rgb(0.42, 0.45, 0.45);

  /* ── The poster ───────────────────────────────────────────────────────────
     Fitted by width. `scaleToFit` would letterbox it; the leftover vertical space is
     wanted for the footer, so the width is what is pinned. */
  const poster = await pdf.embedPng(input.poster);
  const posterWidth = A4_WIDTH - MARGIN * 2;
  const posterHeight = (poster.height / poster.width) * posterWidth;

  /* The footer needs about 76pt. If the poster would eat into that, it is scaled down
     rather than overlapping — an overlap would put our figures on top of the model's. */
  const FOOTER = 76;
  const available = A4_HEIGHT - MARGIN * 2 - FOOTER;
  const drawHeight = Math.min(posterHeight, available);
  const drawWidth = (poster.width / poster.height) * drawHeight;

  page.drawImage(poster, {
    x: (A4_WIDTH - drawWidth) / 2,
    y: A4_HEIGHT - MARGIN - drawHeight,
    width: drawWidth,
    height: drawHeight,
  });

  /* ── ⚠️ NO LOGO OVERLAY ANY MORE ─────────────────────────────────────────
     The first version composited `public/brand/cni-ai-digital-division.png` into a band
     the prompt told the model to leave empty. That is obsolete now the owner has
     supplied a reference layout which already CONTAINS the real logo: the model
     reproduces it in place, and painting ours over the top would land on whatever it
     drew, at a position that shifts between generations.

     ⚠️ The trade is real and worth naming: a reproduced logo is an approximation. It is
     closer than the invented crescent the prompt-only version produced, but it is not
     the file. If exactness matters more than matching the reference, the fix is to
     render the whole page ourselves — see the note in project-report-sheet.tsx. */

  /* ── The footer: exact figures, as selectable text ───────────────────────── */
  const footerTop = A4_HEIGHT - MARGIN - drawHeight - 14;

  page.drawLine({
    start: { x: MARGIN, y: footerTop },
    end: { x: A4_WIDTH - MARGIN, y: footerTop },
    thickness: 0.75,
    color: gold,
  });

  page.drawText(`${input.projectName} — ${input.kindLabel}, ${input.periodLabel}`, {
    x: MARGIN,
    y: footerTop - 15,
    size: 9,
    font: bold,
    color: teal,
  });

  /* The figures on one line. Drawn rather than rasterised, so they can be selected,
     searched and copied out of the PDF — which is the point of having them. */
  const figureLine = input.figures
    .map((figure) => `${figure.label}: ${figure.value}`)
    .join('   ·   ');

  page.drawText(truncate(figureLine, 110), {
    x: MARGIN,
    y: footerTop - 30,
    size: 8.5,
    font: regular,
    color: rgb(0.15, 0.17, 0.17),
  });

  page.drawText(
    truncate(
      `Figures computed from CNI CRM records. Poster rendered by ${input.model}. ` +
        `Generated ${input.generatedOn} by ${input.generatedBy}.`,
      130,
    ),
    { x: MARGIN, y: footerTop - 44, size: 7.5, font: regular, color: grey },
  );

  page.drawText(
    truncate(
      'An asset counts in the period it was published. Reels are counted inside the asset total. ' +
        'The target excludes agreed rest days.',
      140,
    ),
    { x: MARGIN, y: footerTop - 56, size: 7.5, font: regular, color: grey },
  );

  return pdf.save();
}

/**
 * ⚠️ `pdf-lib`'s `drawText` does not wrap and silently runs off the page, so a long
 * line becomes an invisible truncation with no ellipsis to warn anybody. Cutting it
 * here makes the loss visible.
 *
 * Also strips characters WinAnsi cannot encode — `drawText` throws on them, and a
 * project name with an em dash or a curly quote in it would otherwise fail the whole
 * PDF. The em dash and the middle dot used above are both in WinAnsi; anything outside
 * it becomes a hyphen.
 */
function truncate(text: string, max: number): string {
  const safe = text.replace(/[^ -ÿ–—‘’“”•·]/g, '-');
  return safe.length <= max ? safe : `${safe.slice(0, max - 1)}…`.replace('…', '...');
}
