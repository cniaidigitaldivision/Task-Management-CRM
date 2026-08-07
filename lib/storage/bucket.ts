import 'server-only';

import { SIGNED_URL_SECONDS } from '@/lib/domain/attachments';

/* ============================================================================
 * SUPABASE STORAGE — the only file in the application that talks to a bucket
 * ----------------------------------------------------------------------------
 * ── WHY THIS NEEDS A PRIVILEGED KEY, AND WHY THAT IS NOT THE FORBIDDEN ONE ───
 * `.env.example` says, correctly: do not add the service-role key, it bypasses
 * row-level security. That rule is about the DATABASE, and it stands — nothing
 * in this application reads or writes `public.*` with an elevated key, and the
 * whole identity model (C-14, C-18) depends on that staying true.
 *
 * A private bucket is a different problem with no equivalent answer. Supabase
 * Storage is a separate HTTP service; it cannot see `app.user_id`, the
 * transaction-local setting our RLS is built on, because it is not on our
 * connection and not in our transaction. So storage cannot be authorised the
 * way every other read in this system is. The choices are:
 *
 *   a public bucket        every file readable by URL, forever, by anyone —
 *                          which is what we just moved away from
 *   the publishable key    it ships to the browser, so granting it access to
 *                          the bucket is the public bucket with extra steps
 *   a server-side key      privileged, never leaves the server, and used only
 *                          after our own permission check has already passed
 *
 * The third is the only one that is not a hole. The guardrails are:
 *
 *   1. The key is read HERE and nowhere else. `npm run lint` fails the build if
 *      any other file mentions it — see eslint.config.mjs.
 *   2. This module exports four narrow functions. It never returns a client, so
 *      no caller can reach past it into the database side of the API.
 *   3. Every caller is a server action that has already run `requireUser()` and
 *      a task-visibility check through RLS. The key moves bytes; it never
 *      decides who may see them.
 *
 * ── AND IT DEGRADES RATHER THAN CRASHING ─────────────────────────────────────
 * `describeStorage()` reports whether it is configured, exactly like
 * `describeSender()` does for email. With no key the attachments panel says so
 * in plain words and everything else on the page keeps working. A missing
 * optional credential must never take down a task screen.
 * ========================================================================= */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'CNI-Task Management Docs';
const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SECRET = process.env.SUPABASE_STORAGE_KEY ?? '';

/** A slow network must not hold a server action open indefinitely. */
const UPLOAD_TIMEOUT_MS = 60_000;
const API_TIMEOUT_MS = 10_000;

export interface StorageStatus {
  readonly configured: boolean;
  readonly bucket: string;
  /** What to tell somebody, when it is not configured. */
  readonly reason: string | null;
}

export function describeStorage(): StorageStatus {
  if (!PROJECT_URL) {
    return {
      configured: false,
      bucket: BUCKET,
      reason: 'NEXT_PUBLIC_SUPABASE_URL is not set.',
    };
  }
  if (!SECRET) {
    return {
      configured: false,
      bucket: BUCKET,
      reason:
        'SUPABASE_STORAGE_KEY is not set, so files cannot be stored or fetched. Everything else on this task works.',
    };
  }
  return { configured: true, bucket: BUCKET, reason: null };
}

/** Path segments are encoded individually — `encodeURIComponent` eats the `/`. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function endpoint(kind: 'object' | 'sign', path: string): string {
  const bucket = encodeURIComponent(BUCKET);
  return kind === 'sign'
    ? `${PROJECT_URL}/storage/v1/object/sign/${bucket}/${encodePath(path)}`
    : `${PROJECT_URL}/storage/v1/object/${bucket}/${encodePath(path)}`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${SECRET}`,
    apikey: SECRET,
    ...extra,
  };
}

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/**
 * Turn whatever the Storage API said into something a person can act on.
 *
 * Its errors are JSON when they are polite and HTML when they are not, so the
 * body is only read as a hint. The status code is what actually gets mapped —
 * a 413 in particular arrives with no useful body at all, and "Request Entity
 * Too Large" tells nobody what to do next.
 */
async function readError(response: Response, fallback: string): Promise<string> {
  if (response.status === 413) {
    return 'That file is larger than the bucket allows. The limit is 25 MB.';
  }
  if (response.status === 415) {
    return 'That kind of file is not accepted by the bucket.';
  }
  if (response.status === 401 || response.status === 403) {
    /* Ours, not theirs. Saying "you do not have permission" would be a lie —
       the person is permitted; the server's key is wrong or expired. */
    return 'File storage rejected this server’s credentials. An Admin needs to check SUPABASE_STORAGE_KEY.';
  }
  if (response.status === 404) {
    return 'That file is no longer in storage.';
  }

  const body = await response.text().catch(() => '');
  const detail = body.slice(0, 200).trim();
  return detail && !detail.startsWith('<') ? `${fallback} (${detail})` : fallback;
}

export async function uploadObject(input: {
  path: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
}): Promise<StorageResult<{ path: string }>> {
  const status = describeStorage();
  if (!status.configured) return { ok: false, message: status.reason ?? 'Storage is not set up.' };

  try {
    const response = await fetch(endpoint('object', input.path), {
      method: 'POST',
      headers: headers({
        'Content-Type': input.contentType || 'application/octet-stream',
        /* Refuse rather than overwrite. Paths carry a uuid so a collision
           should be impossible — which is exactly why one would mean something
           has gone wrong, and silently replacing a file in that case is the
           worst available response. */
        'x-upsert': 'false',
      }),
      body: input.body as BodyInit,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, message: await readError(response, 'The upload was rejected.') };
    }
    return { ok: true, value: { path: input.path } };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'The upload timed out. A slower connection may need a smaller file.'
          : 'File storage could not be reached. The task itself is unaffected.',
    };
  }
}

/**
 * A link that works for an hour and then does not.
 *
 * This is the whole reason the bucket is private. A permanent URL forwarded
 * once is access forever, to anybody, with no account — including after
 * somebody leaves. An hour is long enough to open a file and come back to it
 * after a meeting, and short enough that a link pasted into a group chat is
 * spent by the time it is read.
 */
export async function signedUrl(
  path: string,
  downloadAs?: string,
): Promise<StorageResult<string>> {
  const status = describeStorage();
  if (!status.configured) return { ok: false, message: status.reason ?? 'Storage is not set up.' };

  try {
    const response = await fetch(endpoint('sign', path), {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, message: await readError(response, 'That file could not be opened.') };
    }

    const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
    const relative = payload.signedURL ?? payload.signedUrl;
    if (!relative) return { ok: false, message: 'File storage returned no link.' };

    /* The API answers a path, not a URL. `?download=` makes the browser save it
       under the original name instead of navigating to it — without it, a PDF
       opens in a tab called `9f2c1e....pdf`, which is the storage path rather
       than anything the person recognises. */
    const absolute = new URL(
      relative.startsWith('/') ? `${PROJECT_URL}/storage/v1${relative}` : relative,
    );
    if (downloadAs) absolute.searchParams.set('download', downloadAs);

    return { ok: true, value: absolute.toString() };
  } catch {
    return { ok: false, message: 'File storage could not be reached.' };
  }
}

/**
 * Remove the object.
 *
 * A 404 counts as success: the caller's intent is "this file should not exist",
 * and it does not. Treating it as an error would leave a database row somebody
 * cannot delete, pointing at a file that is already gone.
 */
export async function removeObject(path: string): Promise<StorageResult<null>> {
  const status = describeStorage();
  if (!status.configured) return { ok: false, message: status.reason ?? 'Storage is not set up.' };

  try {
    const response = await fetch(endpoint('object', path), {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok && response.status !== 404) {
      return { ok: false, message: await readError(response, 'The file could not be removed.') };
    }
    return { ok: true, value: null };
  } catch {
    return { ok: false, message: 'File storage could not be reached.' };
  }
}
