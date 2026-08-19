import 'server-only';

/* ============================================================================
 * THE LIBRARY BUCKET — the agency's own documents
 * ----------------------------------------------------------------------------
 * A second bucket, `cni-library`, separate from `CNI-Task Management Docs`.
 *
 * ── ⚠️ WHY A SEPARATE BUCKET AND NOT A FOLDER ────────────────────────────────
 * The two hold different things with different rules. `CNI-Task Management Docs`
 * is a staging area for client uploads awaiting approval — files arrive from
 * anybody, are approved into Google Drive, and are then DELETED locally. The
 * library is permanent reference material written only by Admins.
 *
 * A folder inside one bucket would give them a shared mime allow-list and a
 * shared size limit, and any cleanup routine written for pending uploads would
 * be one path-prefix mistake away from deleting the rate card.
 * ========================================================================= */

const BUCKET = 'cni-library';
const SIGNED_URL_SECONDS = 120;
const API_TIMEOUT_MS = 15_000;

export type LibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_STORAGE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * A short-lived signed URL for one stored object.
 *
 * ⚠️ TWO MINUTES, and it never leaves the server. The route that calls this
 * fetches the URL itself and streams the bytes on, so the token is not in the
 * browser's history and cannot be shared. Long-lived signed URLs handed to a
 * client are bearer tokens in a query string that outlive the session.
 */
export async function signedLibraryUrl(path: string): Promise<LibraryResult<string>> {
  const settings = config();
  if (!settings) {
    return { ok: false, message: 'File storage is not configured.' };
  }

  try {
    const response = await fetch(
      `${settings.url}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.key}`,
          apikey: settings.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return { ok: false, message: 'That document could not be opened.' };
    }

    const payload = (await response.json()) as {
      signedURL?: string;
      signedUrl?: string;
    };
    const relative = payload.signedURL ?? payload.signedUrl;
    if (!relative) return { ok: false, message: 'File storage returned no link.' };

    /* The API answers a path, not a URL. */
    return { ok: true, value: `${settings.url}/storage/v1${relative.replace(/^\/storage\/v1/, '')}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message.includes('timeout')
        ? 'File storage did not respond.'
        : 'File storage could not be reached.',
    };
  }
}

/** Upload one document. Admin-only paths call this; the route never does. */
export async function uploadLibraryObject(input: {
  path: string;
  body: Uint8Array;
  contentType: string;
}): Promise<LibraryResult<string>> {
  const settings = config();
  if (!settings) return { ok: false, message: 'File storage is not configured.' };

  try {
    const response = await fetch(
      `${settings.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${input.path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.key}`,
          apikey: settings.key,
          'Content-Type': input.contentType,
          'x-upsert': 'true',
        },
        body: input.body as unknown as BodyInit,
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      /* The two failures worth naming, for the same reason as the document
         upload: the raw JSON blob is diagnosable and unactionable. */
      if (/invalid_mime_type/.test(text)) {
        return { ok: false, message: 'That file type is not accepted by the library.' };
      }
      if (/exceeded the maximum|Payload too large|413/.test(text)) {
        return { ok: false, message: 'That file is over the 50 MB storage limit.' };
      }
      return { ok: false, message: 'That document could not be stored.' };
    }

    return { ok: true, value: input.path };
  } catch {
    return { ok: false, message: 'That document could not be stored.' };
  }
}

export async function removeLibraryObject(path: string): Promise<boolean> {
  const settings = config();
  if (!settings) return false;
  try {
    const response = await fetch(
      `${settings.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${path}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${settings.key}`, apikey: settings.key },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
