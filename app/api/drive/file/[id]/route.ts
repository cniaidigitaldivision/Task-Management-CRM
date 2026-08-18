import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { fileContentResponse, getFileMeta, isGoogleNativeType } from '@/lib/drive/client';

/* ============================================================================
 * STREAMING ONE DRIVE FILE — owner request 2026-08-18
 * ----------------------------------------------------------------------------
 * *"If it is like a PDF it can be opened in a PDF or in a next tab… for a video
 * it should be displayed in a popup, like the same as it is opening in the Google
 * Drive… it can also be viewable, right?"*
 *
 * ── WHY THE CRM SERVES THE BYTES INSTEAD OF LINKING TO DRIVE ─────────────────
 * The team has no Google account on this Drive. A `webViewLink` would refuse
 * every one of them. The CRM holds the only credential, so the CRM fetches — and
 * that turns out to be the right thing anyway, because it means access is decided
 * HERE, per request, by our own rules rather than by Google's sharing settings.
 *
 * ── ⚠️ THE PERMISSION CHECK IS THE WHOLE POINT OF THIS FILE ──────────────────
 * A file id in a URL is a request to read somebody's document. Drive ids travel:
 * they appear in URLs, get pasted into chats, and sit in browser history. So
 * being signed in is NOT sufficient. Every request:
 *
 *   1. asks Drive which folders hold the file            (`parents`)
 *   2. maps those Drive ids to rows in `drive_folders`
 *   3. asks `app.folder_grants(folder, 'view')` for the CALLER
 *
 * Step 3 is the same predicate the `documents` policies use, so a Member's access
 * to a file is decided by exactly the rule that decides their access to the
 * register — the folder's everyone level, or a grant naming them (031), or being
 * Coordinator+. There is no separate answer for files that could drift.
 *
 * A file whose folder is not in our registry is refused. That is deliberate: the
 * registry is what access is expressed against, so a file outside it has no
 * access rule, and "no rule" must mean no.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

/** 404 for both "no such file" and "not yours". Distinguishing them would let
 *  somebody enumerate what exists in a Drive they cannot read. */
const refuse = () => new Response('Not found', { status: 404 });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await context.params;

  if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) return refuse();

  const meta = await getFileMeta(id);
  if (!meta.ok) return refuse();

  /* Google Docs/Sheets/Slides have no bytes. Sending the viewer an empty stream
     would look like a corrupt file, so it is named as what it is. */
  if (isGoogleNativeType(meta.value.mimeType)) {
    return new Response(
      'That is a Google Docs, Sheets or Slides file. It has no downloadable content — open it in Google Drive.',
      { status: 415, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  /* ── MAY THIS PERSON READ IT ─────────────────────────────────────────────── */
  const parents = meta.value.parents;
  if (parents.length === 0) return refuse();

  const allowed = await withUser(user.id, async (tx) => {
    const rows = await tx`
      select 1
        from public.drive_folders f
       where f.drive_folder_id = any(${parents}::text[])
         and app.folder_grants(f.id, 'view'::public.folder_access)
       limit 1
    `;
    return rows.length > 0;
  }).catch(() => false);

  if (!allowed) return refuse();

  /* ── THE BYTES ───────────────────────────────────────────────────────────── */
  const range = request.headers.get('range');
  const upstream = await fileContentResponse(id, range);
  if (!upstream.ok) return refuse();

  const headers = new Headers();
  headers.set('Content-Type', meta.value.mimeType);

  /* Passed through so a <video> can seek: the browser needs the 206, the
     Content-Range and the byte length that Drive computed, not ones we invent. */
  for (const header of ['content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.value.headers.get(header);
    if (value) headers.set(header, value);
  }
  /* Set even when Drive omits it, so the browser knows seeking is possible. */
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes');

  /* `inline` is what makes a PDF open in the browser's viewer instead of landing
     in the downloads folder — the owner's actual complaint. `?download=1` asks
     for the other behaviour explicitly.

     ⚠️ The filename is quoted and stripped of quotes and newlines: a name is
     user-controlled data going into a response header, and a newline there is
     header injection. */
  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const safeName = meta.value.name.replace(/["\\\r\n]/g, '_');
  headers.set(
    'Content-Disposition',
    `${wantsDownload ? 'attachment' : 'inline'}; filename="${safeName}"`,
  );

  /* Private: this passed a per-user check, so no shared cache may keep it. */
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');

  return new Response(upstream.value.body, {
    status: upstream.value.status, // 200, or 206 for a range
    headers,
  });
}
