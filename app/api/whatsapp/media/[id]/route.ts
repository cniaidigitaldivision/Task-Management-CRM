import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { fetchMedia, whatsAppConfigFor } from '@/lib/crm/whatsapp';
import { crmMessageMedia } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * SEEING WHAT THEY SENT — Step 8
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-13: *"He can message. He can send an image. He can send
 * files."* Sending those has worked since migration 139. RECEIVING them did
 * not: the webhook stored the attachment's Meta id, the bubble drew a grey chip
 * with a filename on it, and there was no way to open the thing. `fetchMedia`
 * had been written and was called by nothing.
 *
 * ── ⚠️ WHY A ROUTE AND NOT A STORED FILE ───────────────────────────────────
 * Meta keeps inbound media for about 30 days and serves it only to a bearer
 * token. Copying every attachment into our own bucket on arrival would mean the
 * webhook doing a two-call download inside Meta's retry window — and Meta retries
 * a slow webhook, which is how you get the same photo five times. So the id is
 * stored on the way in and the bytes are fetched when somebody actually looks.
 *
 * ⚠️ THE COST OF THAT IS AN EXPIRY, AND IT IS SAID OUT LOUD. Past ~30 days the
 * fetch fails, and the answer is a sentence about the age of the file rather
 * than a broken image icon.
 *
 * ── ⚠️ AND THE PERMISSION IS RLS, NOT A CHECK WRITTEN HERE ─────────────────
 * `crmMessageMedia` reads under the caller's own session. 138's policy delegates
 * to the lead, so somebody who may not read the lead gets null and this answers
 * 404 — indistinguishable from a message that does not exist, so the route
 * cannot be used to find out which ids are real.
 * ========================================================================= */

/* Node, not Edge: the config read opens a Postgres connection. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  /* ⚠️ `getCurrentUser`, not `requireUser` — this is an API route, and
     `requireUser` redirects, which turns a missing session into a 307 towards a
     login page that an <img> tag cannot follow. A 401 is the honest answer. */
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const found = await crmMessageMedia(user.id, id);
  if (!found) {
    return NextResponse.json({ error: 'No such attachment.' }, { status: 404 });
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
          'WhatsApp no longer has this file. Attachments are kept for about 30 days, '
          + 'and this one is either older than that or was removed.',
      },
      { status: 410 },
    );
  }

  const mime = file.mime || found.mime || 'application/octet-stream';

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'content-type': mime,
      /* ⚠️ `inline`, so an image opens in the tab rather than downloading — but
         the filename is still carried for the ones somebody does save. Quotes
         escaped: a filename with a `"` in it would otherwise truncate the
         header and hand the browser a nonsense name. */
      'content-disposition': found.filename
        ? `inline; filename="${found.filename.replace(/["\\]/g, '_')}"`
        : 'inline',
      /* ⚠️ `private`, never `public`. This is somebody's conversation with a
         client and it is authorised per user — a shared CDN copy would serve it
         to the next person who guessed the id. Immutable because a WhatsApp
         attachment never changes once sent. */
      'cache-control': 'private, max-age=3600, immutable',
      /* Belt and braces against a clever mime: nothing here is ever executed. */
      'x-content-type-options': 'nosniff',
    },
  });
}
