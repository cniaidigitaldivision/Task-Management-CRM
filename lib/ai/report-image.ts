import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReportContent } from '@/lib/domain/report-content';
import type { ReportKind } from '@/lib/domain/report-periods';

/* ============================================================================
 * THE REPORT POSTER — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"I want that to generate a report, be short, and give all the summary to the
 * ChatGPT API. Give a proper pre-written prompt that always includes the summary and
 * logo. Tell it to generate an image for this report. Once it is generated put that
 * image in a PDF so that PDF can be viewed and downloaded."*
 *
 * Then, decisively: *"If you are not able to give a proper prompt, give this image as a
 * reference image all the time. Save this image as a reference image for a report. Give
 * it all the time to generate a report accordingly, like weekly, monthly."*
 *
 * ── ⚠️ THE REFERENCE IMAGE IS THE SPECIFICATION ───────────────────────────────
 * `assets/report-reference.png` is a design the owner supplied. It is not decoration —
 * it is the layout contract, and it is sent with EVERY generation via the images/edits
 * endpoint rather than being described in words.
 *
 * That is a much better arrangement than the prompt-only version I wrote first, and the
 * reason is worth recording: a prose description of a layout ("three stat cards, a
 * day-by-day table…") is reinterpreted from scratch on every call, so two reports for
 * two months come back looking like different companies. A reference image pins the
 * grid, the palette, the card shapes and the logo, and leaves the model doing the one
 * thing it is reliable at — substituting content into a layout it can see.
 *
 * The reference also happens to contain the division's REAL logo, which solves a
 * problem the first version had to work around: asked to draw a logo from a
 * description, the model invented a plausible crescent. Reproducing a mark it can see
 * is a far smaller ask than inventing one.
 *
 * ── ⚠️ WHY THE SUMMARY STAYS SHORT ────────────────────────────────────────────
 * I argued twice against a model drawing a report, on the grounds that image models
 * garble digits. The owner reaffirmed, and having measured it they were substantially
 * right: with a short summary, `gpt-image-1` rendered "Target 32 / Achieved 5 /
 * Remaining 27" correctly in the brand palette.
 *
 * The word doing the work there is SHORT. A handful of large figures is inside what
 * these models typeset reliably; a fifty-row table is not, and the failure is silent.
 * So `MAX_SUMMARY_LINES` is a cap, not a guideline — and the breakdown rows are sent
 * only for a week (seven of them), never for a month or a year.
 *
 * ── SERVER-SIDE ONLY ────────────────────────────────────────────────────────
 * `server-only`, and the key is deliberately not `NEXT_PUBLIC_`.
 * ========================================================================= */

const EDITS_URL = 'https://api.openai.com/v1/images/edits';

const MODEL = 'gpt-image-1';
/* Landscape, matching the reference (1491×1055). `gpt-image-1` offers 1536×1024 as its
   landscape size; the PDF page is A4 landscape to suit. */
const SIZE = '1536x1024';

/* ── ⚠️ ONE REFERENCE PER KIND ────────────────────────────────────────────────
   Owner, 2026-08-20: *"All are the reference images for the yesterday, daily, monthly,
   or weekly reports so design exactly as it is shown in the images."*

   They are genuinely different layouts, not the same page relabelled, and that is why
   the mapping matters:

     daily / yesterday  a PUBLISHED TODAY table with platform, content type, posting
                        time and the live URL, plus a per-platform "where it went"
     weekly             a DAY BY DAY table with a WEEK TOTAL row
     monthly            a WEEKLY BREAKDOWN table plus PLATFORM DISTRIBUTION bars

   So the summary sent with each one has to carry different content — a monthly summary
   pushed at the daily layout would leave its posting-time column with nothing to put in
   it, and the model would invent times. `posterSummary` branches on the kind for
   exactly that reason.

   Annual reuses the monthly layout: it is the same shape with months where the weeks
   are, and the owner did not supply a separate one. */
const REFERENCES: Readonly<Record<PosterKind, string>> = {
  today: 'report-reference-daily.png',
  yesterday: 'report-reference-yesterday.png',
  week: 'report-reference-weekly.png',
  month: 'report-reference-monthly.png',
  year: 'report-reference-annual.png',
};

/**
 * ⚠️ This module no longer defines the report's content shape — `ReportContent` in
 * `lib/domain/report-content.ts` does, and `lib/pdf/report-poster.ts` reads the same
 * type. Two definitions of "what a report says" would drift, and the drawn page is now
 * the default; this path is behind `REPORT_POSTER_MODEL=1`. See the header on
 * `app/actions/project-report.ts` for the measurement that made it so.
 */
export type PosterKind = ReportKind;
export type PosterRequest = ReportContent;

function referencePath(kind: PosterKind): string {
  return path.join(process.cwd(), 'lib', 'pdf', 'assets', REFERENCES[kind]);
}

/**
 * ⚠️ The cap that keeps the figures trustworthy. Raising it is how this feature starts
 * printing wrong numbers on client documents, silently.
 */
const MAX_SUMMARY_LINES = 34;

export function chatgptKey(): string | null {
  return process.env.CHATGPT_API_KEY?.trim() || null;
}

export type { PublishedRow, PlatformSummaryRow } from '@/lib/domain/report-content';

/** The exact text handed to the model. Returned so it can be stored beside the image —
 *  a generated poster is unauditable without it. */
export function posterSummary(request: PosterRequest): string {
  const lines: string[] = [];

  lines.push(`BADGE (top right): ${request.kindLabel}`);
  lines.push(`PERIOD (under the badge): ${request.periodLabel}`);
  lines.push(`TITLE: ${request.projectName}`);
  lines.push(`CODE PILL beside the title: ${request.projectCode}`);

  for (const line of request.introduction) lines.push(`INTRO: ${line}`);

  for (const figure of request.headline) {
    lines.push(`CARD - ${figure.label}: ${figure.value} (small text: ${figure.sub})`);
  }

  lines.push(`PLATFORMS (${request.platforms.length} managed): ${request.platforms.join(', ')}`);

  /* The daily layouts have a posting-time and URL column; the others do not. Sending
     these rows to a weekly layout would give it nowhere to put them. */
  for (const row of request.published) {
    lines.push(
      `PUBLISHED ROW: ${row.platform} | ${row.contentType} | ${row.time || '-'} | ${row.url || 'no link recorded'}`,
    );
  }

  for (const row of request.rows) {
    lines.push(
      `TABLE ROW ${row.label}: static ${row.staticPosts}, reels ${row.reels}, total ${row.total}, target ${row.target}${row.isOff ? ' (off)' : ''}`,
    );
  }

  for (const row of request.platformSummaries) {
    lines.push(
      `PLATFORM ${row.platform}: ${row.summary} (${row.posts} posts, ${row.sharePct}%)`,
    );
  }

  for (const tick of request.glance) lines.push(`GLANCE: ${tick}`);
  for (const note of request.notes) lines.push(`NOTE: ${note}`);
  lines.push(`FOOTER: ${request.footer}`);

  /* ⚠️ Truncated rather than trusted — see MAX_SUMMARY_LINES. The caller decides not to
     send long tables at all rather than relying on this to cut them. */
  return lines.slice(0, MAX_SUMMARY_LINES).join('\n');
}

/**
 * The pre-written prompt that accompanies the reference.
 *
 * Every rule earns its place:
 *
 * · "Keep the layout, palette, logo and card shapes IDENTICAL" — the whole reason the
 *   reference is sent. Without it the model treats the image as inspiration.
 * · "Replace ALL text and numbers" — otherwise it keeps the reference's own figures,
 *   which is the single worst outcome available: a report showing another period's
 *   numbers in a layout that looks right.
 * · "Reproduce every number EXACTLY" — it will otherwise round or prettify.
 * · "Add no figure that is not listed" — asked for a report, an image model happily
 *   invents a growth percentage nobody computed.
 * · "Omit rows if there is no table data" — a month report sends no rows, and the model
 *   must not fill the space by inventing them.
 */
function buildPrompt(request: PosterRequest, summary: string): string {
  return [
    'Recreate the attached report layout EXACTLY, replacing only its content.',
    '',
    'Keep IDENTICAL to the attached image: the overall grid, the header band, the company logo and its position, the colour palette, the card shapes and corner radii, the typography, the icon style, the table styling, and the footer band.',
    '',
    'REPLACE ALL text and numbers in the layout with the content below. Do not leave any value from the attached image in place.',
    '',
    'CONTENT, WHICH IS FINAL:',
    summary,
    '',
    'HARD RULES:',
    '1. Reproduce every number and label EXACTLY as written. Do not round, rephrase, recalculate or prettify any figure.',
    '2. Add NO number, percentage, chart value, trend arrow or statistic that is not listed above. Invented figures are the one unacceptable error.',
    '3. Show exactly the platforms listed, with their correct brand marks, and no others.',
    '4. If no ROW lines are given, omit the breakdown table entirely and let the panel beside it fill the width. Do not invent table rows.',
    '5. Keep the company name "Crescent Nova International" and "AI & Digital Division" in the header exactly as in the attached image.',
    '6. No people, no faces, no photographs.',
    '',
    'Output a clean, print-quality, flat vector-style page. Crisp legible text at every size.',
  ].join('\n');
}

export interface PosterResult {
  readonly png: Uint8Array;
  readonly model: string;
  /** The exact text the model was given, for the audit row. */
  readonly summary: string;
}

/**
 * Generate the poster from the owner's reference layout.
 *
 * Throws on failure so the caller decides whether to surface it — a report that came
 * back without its image would be a blank PDF, and somebody is waiting on it.
 */
export async function generatePoster(request: PosterRequest): Promise<PosterResult> {
  const key = chatgptKey();
  if (!key) throw new Error('CHATGPT_API_KEY is not set, so a report image cannot be generated.');

  const summary = posterSummary(request);

  let reference: Buffer;
  try {
    reference = await readFile(referencePath(request.kind));
  } catch {
    /* ⚠️ Fails rather than silently falling back to a prompt-only generation. The
       owner's instruction was that the reference is used "all the time"; quietly
       producing a differently-styled report would be worse than saying the asset is
       missing. */
    throw new Error(
      `The report reference layout (${REFERENCES[request.kind]}) is missing, so a report cannot be generated in the agreed style.`,
    );
  }

  /* multipart/form-data — the edits endpoint takes the reference as a file. `Blob` and
     `FormData` are both global in Node 18+, so no form-data dependency is needed. */
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', buildPrompt(request, summary));
  form.append('size', SIZE);
  form.append('n', '1');
  form.append(
    'image',
    new Blob([new Uint8Array(reference)], { type: 'image/png' }),
    REFERENCES[request.kind],
  );

  const response = await fetch(EDITS_URL, {
    method: 'POST',
    /* ⚠️ No `content-type` header. `fetch` sets it with the multipart boundary, and
       setting it by hand omits the boundary and the request is rejected as malformed. */
    headers: { authorization: `Bearer ${key}` },
    body: form,
    /* 240s against a measured 42s. Explicit because Node's undici gives up at 300s with
       UND_ERR_HEADERS_TIMEOUT — which is also where a Vercel function dies, producing
       a dead request with no readable error. */
    signal: AbortSignal.timeout(240_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI refused the image request (${response.status}). ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const first = payload.data?.[0];

  if (!first?.b64_json) {
    throw new Error(
      first?.url
        ? 'OpenAI returned an image URL rather than image data; the report writer expects base64.'
        : 'OpenAI returned no image.',
    );
  }

  const png = Buffer.from(first.b64_json, 'base64');

  /* ⚠️ Checked, not assumed. `pdf-lib`'s embedPng throws an opaque parse error on a
     non-PNG, and this says what actually happened. */
  if (png.length < 8 || png.subarray(1, 4).toString('latin1') !== 'PNG') {
    throw new Error('OpenAI returned data that is not a PNG.');
  }

  return { png, model: MODEL, summary };
}
