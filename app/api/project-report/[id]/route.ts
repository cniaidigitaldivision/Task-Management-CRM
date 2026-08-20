import { NextResponse, type NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth/current-user';
import { getProject } from '@/lib/db/queries/projects';
import { getProjectReport } from '@/lib/db/queries/report-files';
import { buildReportPdf } from '@/lib/pdf/report-pdf';
import { composeReportPdf } from '@/lib/pdf/report-poster';
import { parseReportContent } from '@/lib/domain/report-content';
import { signedLibraryUrl } from '@/lib/storage/library';
import { REPORT_KIND_LABEL, isReportKind } from '@/lib/domain/report-periods';

/* ============================================================================
 * THE REPORT PDF — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"I want that to generate a report always in PDF format… so that PDF can be viewed and
 * downloaded."*
 *
 * ── ⚠️ TWO BRANCHES, AND THE FIRST ONE IS THE LIVE PATH ───────────────────────
 * A row carries EITHER the content it was built from or a stored poster PNG:
 *
 *   content   → `composeReportPdf` DRAWS the owner's layout with real type. Every glyph
 *               is typeset, so nothing can be misspelled, and the same row always yields
 *               the same bytes.
 *   imagePath → the older `gpt-image-1` posters, wrapped by `buildReportPdf`. Kept
 *               working because some have already gone to a client, and a PDF a client
 *               received must stay reproducible.
 *
 * Migration 039's `project_reports_renderable` check guarantees one of the two is
 * present, so this route always has something to render.
 *
 * ⚠️ Content is preferred where a row has BOTH — which the image path now writes
 * deliberately, so a garbled poster can be re-rendered as a drawn page without
 * regenerating anything. `?poster=1` asks for the stored image instead.
 *
 * ── ⚠️ THE PDF IS BUILT PER REQUEST AND THAT IS THE POINT ─────────────────────
 * It is a pure function of the stored row: free, instant, and identical every time. So
 * there is no second copy to drift, and a change to the layout applies to every report
 * ever generated the next time it is opened.
 *
 * ── ⚠️ THE STORED OBJECT IS PRIVATE AND STAYS PRIVATE ─────────────────────────
 * The bucket is not public. The image branch mints a short-lived signed URL server-side,
 * fetches the PNG itself, and streams a PDF — so the browser never sees a storage URL
 * and a report cannot be shared by copying a link out of the network tab. Same reasoning
 * as `/api/library/[id]`.
 *
 * ── AUTHORISATION IS THE PROJECT'S, NOT A SEPARATE RULE ───────────────────────
 * `getProjectReport` runs under RLS, whose policy defers to `app.project_is_visible`.
 * So a report is readable by exactly the people who can open the project it describes,
 * and there is no second rule here to drift from that one.
 * ========================================================================= */

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await requireUser();

  const report = await getProjectReport(user.id, id);
  /* ⚠️ 404 for both "no such report" and "not visible to you". Distinguishing them
     would confirm that a report exists to somebody probing ids. */
  if (!report) return new NextResponse('Not found', { status: 404 });

  /* The project supplies the name for the footer and the filename. It is fetched rather
     than denormalised onto the report row so a renamed project produces a correctly
     named PDF next time it is downloaded. */
  const project = await getProject(user.id, report.projectId);
  if (!project) return new NextResponse('Not found', { status: 404 });

  const generatedOn = report.createdAt.slice(0, 10);
  const generatedBy = report.createdByName ?? 'unknown';

  /* ── The drawn page. See the header on why it wins where both are present. ─── */
  const wantsPoster = request.nextUrl.searchParams.get('poster') === '1';
  const content = wantsPoster ? null : parseReportContent(report.content);

  let pdf: Uint8Array;

  if (content) {
    /* ⚠️ The project's CURRENT name is not substituted in. The content carries the name
       as it was when the report was made, and a client's report should say what it said
       — a renamed project must not silently rewrite a document already sent. The current
       name is used for the FILENAME only, below, which is a convenience and not a
       claim. */
    pdf = await composeReportPdf(content, { generatedOn, generatedBy });
  } else {
    if (!report.imagePath) {
      /* ⚠️ Unreachable while `project_reports_renderable` holds — but stated rather than
         non-null asserted, because a constraint dropped by a future migration would
         otherwise surface here as a crash rather than a sentence. */
      return new NextResponse('That report has neither stored content nor an image.', {
        status: 410,
      });
    }

    const signed = await signedLibraryUrl(report.imagePath);
    if (!signed.ok) {
      return new NextResponse('The report image could not be read.', { status: 502 });
    }

    const imageResponse = await fetch(signed.value, {
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);

    if (!imageResponse?.ok) {
      /* The row points at an object that is gone — which is recoverable by generating
         again, so it says so rather than returning a broken file. */
      return new NextResponse('The report image is no longer available.', { status: 410 });
    }

    const poster = new Uint8Array(await imageResponse.arrayBuffer());

    /* The stored figures, as selectable text under the poster. Read from the row rather
       than recomputed: they are what the model was actually given, and recomputing could
       silently disagree with the picture if the underlying tasks have since changed. */
    const figures = Object.entries(report.figures)
      .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
      .map(([key, value]) => ({
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: String(value),
      }));

    pdf = await buildReportPdf({
      poster,
      projectName: project.name,
      periodLabel: report.periodLabel,
      kindLabel: isReportKind(report.kind) ? REPORT_KIND_LABEL[report.kind] : report.kind,
      figures,
      generatedOn,
      generatedBy,
      model: report.model,
    });
  }

  /* `?download=1` switches the disposition. Owner asked for both viewing and
     downloading, and the difference between them is only this header — a separate route
     would be a second place to get the authorisation wrong. */
  const download = request.nextUrl.searchParams.get('download') === '1';
  const filename = `${slug(project.name)}-${slug(report.periodLabel)}.pdf`;

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(pdf.byteLength),
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      /* Private and revalidated. A report is scoped to a reader, so a shared cache must
         never hold it — and the underlying poster is immutable, so the browser may. */
      'cache-control': 'private, max-age=300',
    },
  });
}

/** A filename-safe slug. ⚠️ Not `encodeURIComponent`: a `%` in a `filename=` value is
 *  interpreted by some clients as an escape and mangles the download. */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}
