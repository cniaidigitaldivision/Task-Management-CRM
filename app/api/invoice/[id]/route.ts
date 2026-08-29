import { requireUser } from '@/lib/auth/current-user';
import { contentDisposition } from '@/lib/domain/content-disposition';
import { invoicePdf } from '@/lib/pdf/invoice-document';

/* ============================================================================
 * VIEWING AN INVOICE — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"Issue, preview, then send"* — this is the preview. The Admin opens the exact
 * document the client will be emailed, reads it, and only then presses Send.
 *
 * ── ⚠️ IT PROXIES, LIKE `/api/library/[id]`, AND FOR THE SAME TWO REASONS ──
 *   1. A signed storage URL is a bearer token in a query string. Handed to the
 *      browser it lives in history and in any copied link, valid for its whole
 *      lifetime regardless of whether the person is still signed in.
 *   2. Supabase serves stored objects as `Content-Disposition: attachment`, so
 *      the browser downloads instead of displaying — and a preview you have to
 *      download first is not a preview.
 *
 * ── ⚠️ ADMIN ONLY, ENFORCED BY RLS RATHER THAN BY A ROLE CHECK HERE ────────
 * `invoicePdfBytes` reads through `withUser`, and `revenue_entries` is Admin+
 * (migration 064). A Coordinator who guesses an id gets the same 404 as somebody
 * asking for an invoice that does not exist — which is the right answer, because
 * distinguishing the two confirms the existence of a document they may not read.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** 404 for "no such invoice" and "not yours" alike. */
const refuse = () => new Response('Not found', { status: 404 });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse();

  const built = await invoicePdf(user.id, id);
  if (!built.ok) {
    /* A composition failure is ours, not theirs, and it is worth saying so —
       "not found" would send somebody hunting for a deleted invoice that is
       sitting right there. */
    return built.missing
      ? refuse()
      : new Response(built.message, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Length', String(built.bytes.byteLength));

  /* ⚠️ Through `contentDisposition`, not by interpolating the number into the
     header. A header value is a ByteString and `Headers.set` throws on anything
     above U+00FF — the bug that made every library document fail to open, in
     lib/domain/content-disposition.ts. An invoice number is ASCII by
     construction (`checkInvoiceNo`), so this is belt and braces rather than a
     live risk; it costs nothing and the alternative has already failed once. */
  headers.set(
    'Content-Disposition',
    contentDisposition(
      `${built.invoiceNo}.pdf`,
      new URL(request.url).searchParams.get('download') !== '1',
    ),
  );

  /* Private: this passed a per-user check, so no shared cache may keep it. */
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');

  return new Response(built.bytes as unknown as BodyInit, { status: 200, headers });
}
