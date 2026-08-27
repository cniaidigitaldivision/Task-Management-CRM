import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { contentDisposition, nameWithExtension } from '@/lib/domain/content-disposition';
import { signedLibraryUrl } from '@/lib/storage/library';

/* ============================================================================
 * VIEWING A LIBRARY DOCUMENT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"It gives me a proper PDF view like that or opens a next tab, a blank tab, or
 * a PDF view instead of downloading each time."*
 *
 * ── ⚠️ WHY THIS PROXIES INSTEAD OF HANDING OUT THE SIGNED URL ─────────────────
 * The shorter implementation returns Supabase's signed URL and lets the browser
 * follow it. Two problems, and the second is the owner's actual complaint:
 *
 *   1. A signed URL is a bearer token in a query string. Once handed to the
 *      browser it is in history, in any copied link, and valid for its whole
 *      lifetime regardless of whether the person is still signed in.
 *
 *   2. Supabase serves stored objects with `Content-Disposition: attachment`,
 *      so the browser DOWNLOADS rather than displays — which is exactly what the
 *      owner asked to stop happening. Proxying lets the header be set to
 *      `inline`, and a PDF then opens in the browser's own viewer.
 *
 * The signed URL is minted server-side, used server-side, and never reaches the
 * client.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** 404 for "no such document" and "not yours" alike — distinguishing them would
 *  confirm the existence of something the caller may not read. */
const refuse = () => new Response('Not found', { status: 404 });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse();

  /* Read through RLS as the caller. `library_documents_select` is "anybody signed
     in", so this is not a permission gate so much as proof the row exists — but
     it runs as the user regardless, so tightening that policy later needs no
     change here. */
  const rows = await withUser(user.id, (tx) => tx`
    select storage_path, mime_type, title, is_viewable
      from public.library_documents where id = ${id}
  `).catch(() => []);

  const doc = rows[0];
  if (!doc) return refuse();

  const signed = await signedLibraryUrl(doc.storage_path as string);
  if (!signed.ok) return new Response(signed.message, { status: 502 });

  let upstream: Response;
  try {
    upstream = await fetch(signed.value);
  } catch {
    return new Response('The library could not be reached.', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return refuse();

  const headers = new Headers();
  headers.set('Content-Type', (doc.mime_type as string) || 'application/octet-stream');

  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  /* ⚠️ `inline` is the whole point of the route — see the header. `?download=1`
     asks for the other behaviour, which is what a design source needs since no
     browser can render an .ai file. */
  const wantsDownload =
    new URL(request.url).searchParams.get('download') === '1' || !doc.is_viewable;

  /* ── ⚠️ THIS LINE IS WHY NOTHING IN THE LIBRARY OPENED ────────────────────
     It used to be

         const safeName = String(doc.title).replace(/["\\\r\n]/g, '_');
         headers.set('Content-Disposition', `…; filename="${safeName}.pdf"`);

     and it THREW on four of the five library documents. A header value is a
     ByteString, so `Headers.set` refuses any character above U+00FF — and the
     titles contain an em dash (U+2014). The route died before returning, Next
     answered 500, and the tab the person had just opened showed nothing. Only
     "Full Package Deck" worked, because it is the one title with no dash.

     Two bugs in one line, in fact: the `.pdf` was also unconditional, so a
     download-only design source arrived named `.pdf`. `contentDisposition` emits
     an ASCII fallback plus RFC 5987 `filename*`, and `nameWithExtension` takes the
     suffix from the stored path. See lib/domain/content-disposition.ts. */
  headers.set(
    'Content-Disposition',
    contentDisposition(
      nameWithExtension(
        String(doc.title),
        String(doc.storage_path),
        (doc.mime_type as string | null) ?? null,
      ),
      !wantsDownload,
    ),
  );

  /* Private: this passed a per-user check, so no shared cache may keep it. */
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');

  return new Response(upstream.body, { status: 200, headers });
}
