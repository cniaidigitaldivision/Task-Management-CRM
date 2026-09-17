import { randomUUID } from 'node:crypto';
import { NextResponse, after } from 'next/server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { fetchMedia, whatsAppConfigFor } from '@/lib/crm/whatsapp';
import { withAppRole } from '@/lib/db/client';
import { crmMessageMedia } from '@/lib/db/queries/crm-leads';
import { signedUrl, uploadObject } from '@/lib/storage/bucket';

/* ============================================================================
 * SEEING WHAT WAS SENT — Step 8, and 184
 * ----------------------------------------------------------------------------
 * ── ⚠️ OUR STORED COPY FIRST, META SECOND ───────────────────────────────────
 * Meta forgets an inbound media id after 7 days and an uploaded one after 30.
 * 184 keeps our own copy (`media_path`): everything we send is stored before it
 * goes, and every inbound attachment is copied by the webhook the moment it
 * arrives. When a copy exists, this answers with a short-lived signed link to it.
 *
 * ⚠️ A REDIRECT, NOT THE BYTES. A Vercel function cannot return a body over
 * 4.5 MB, so a 12 MB video streamed through here would fail in production. The
 * browser follows the redirect straight to the private bucket, with a link that
 * works for an hour for this one file.
 *
 * ── ⚠️ AND THE PERMISSION IS RLS, NOT A CHECK WRITTEN HERE ─────────────────
 * `crmMessageMedia` reads under the caller's own session. 138's policy delegates
 * to the lead, so somebody who may not read the lead gets null and this answers
 * 404 — indistinguishable from a message that does not exist. A deleted message's
 * attachment answers 404 too.
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const download = new URL(request.url).searchParams.has('download');

  /* ⚠️ `getCurrentUser`, not `requireUser` — an <img> cannot follow a redirect
     to a login page. A 401 is the honest answer. */
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'No such attachment.' }, { status: 404 });
  const found = await crmMessageMedia(user.id, id);
  if (!found) return NextResponse.json({ error: 'No such attachment.' }, { status: 404 });

  const redirectTo = async (path: string) => {
    const link = await signedUrl(path, download ? (found.filename ?? 'attachment') : undefined);
    if (!link.ok) return null;
    return NextResponse.redirect(link.value, {
      status: 302,
      /* Just under the link's own hour, and private — it is per person. */
      headers: { 'cache-control': 'private, max-age=3000' },
    });
  };

  if (found.path) {
    const res = await redirectTo(found.path);
    if (res) return res;
  }

  if (!found.mediaId) {
    return NextResponse.json({ error: 'This file is no longer available.' }, { status: 410 });
  }

  const ready = await whatsAppConfigFor(user.id, found.projectId);
  if (!ready.ok) {
    return NextResponse.json(
      {
        error:
          ready.why === 'no-token'
            ? 'This server has no WhatsApp connection configured, so attachments cannot be fetched.'
            : 'This project has no WhatsApp number, so its attachments cannot be fetched.',
      },
      { status: 503 },
    );
  }

  const file = await fetchMedia(ready.config, found.mediaId);
  if (!file) {
    return NextResponse.json(
      {
        error:
          'WhatsApp no longer has this file. Meta keeps attachments a client sends for 7 days, '
          + 'and this one arrived before the CRM kept its own copies.',
      },
      { status: 410 },
    );
  }
  const mime = file.mime || found.mime || 'application/octet-stream';

  /* ⚠️ KEPT NOW, so the next view is instant and it survives Meta's expiry. */
  after(async () => {
    try {
      const safe = (found.filename ?? `attachment.${(mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '')}`)
        .replace(/[^\w.\-() ]+/g, '_').slice(-80);
      const path = `crm-whatsapp/${found.leadId}/${randomUUID()}/${safe}`;
      const put = await uploadObject({ path, body: new Uint8Array(file.data), contentType: mime });
      if (put.ok) {
        await withAppRole((tx) => tx`select app.crm_message_store_media(${found.messageId}::uuid, ${path}, ${file.data.length})`);
      }
    } catch (error) {
      console.error('[whatsapp-media] could not keep an attachment:', error);
    }
  });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'content-type': mime,
      'content-disposition': `${download ? 'attachment' : 'inline'}${
        found.filename ? `; filename="${found.filename.replace(/["\\]/g, '_')}"` : ''
      }`,
      'cache-control': 'private, max-age=3600, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
