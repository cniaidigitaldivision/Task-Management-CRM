import { NextResponse } from 'next/server';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { getStoredReport } from '@/lib/db/queries/crm-reports';
import { reportFileName, reportToCsv, reportToXlsx } from '@/lib/export/report-writers';

/* ============================================================================
 * DOWNLOADING A FROZEN REPORT — Step 10
 * ----------------------------------------------------------------------------
 * ── ⚠️ IT WRITES THE STORED PAYLOAD, NOT A FRESH QUERY ─────────────────────
 * The whole reason `crm_reports` keeps the whole `Report` object is that the
 * file somebody downloads in December must match the figures they read in
 * September. Recomputing here — which would have been the obvious way to write
 * this route — would produce a file that disagrees with the page it was
 * downloaded from, and the page is the one that is right.
 *
 * ── ⚠️ AND THE WRITERS ARE REUSED, NOT REIMPLEMENTED ───────────────────────
 * `lib/export/report-writers.ts` already turns a `Report` into CSV or .xlsx, and
 * its CSV path routes every cell through `lib/domain/csv.ts`, which neutralises
 * a leading `=`, `+`, `-` or `@`. A lead's name is typed by a stranger into a
 * Meta form, so a name beginning `=HYPERLINK(...)` is a live formula the moment
 * the file opens. Writing CSV by hand here would have been a second copy of that
 * guard, and a second copy is the one that gets forgotten.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  /* ⚠️ THE SAME FLOOR AS THE PAGE. A route handler is reachable directly — its
     layout does not run — so the guard is repeated here rather than assumed. */
  const { user } = await requireCrmAccess();
  const { id } = await context.params;

  const found = await getStoredReport(user.id, id);
  /* ⚠️ 404 for both "no such report" and "not yours", the same as the lead
     record: with a uuid in the URL, confirming one exists is the whole of what
     an attacker wants. */
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const format = new URL(request.url).searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const stem = `${found.stored.kind}-${found.stored.generatedAt.slice(0, 10)}`;
  const fileName = reportFileName(stem, format);

  if (format === 'xlsx') {
    const buffer = await reportToXlsx(found.report);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${fileName}"`,
        /* ⚠️ A frozen report never changes, but it is also not public — so it
           may be cached by the browser and never by a proxy. */
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  return new NextResponse(reportToCsv(found.report), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, max-age=3600',
    },
  });
}
