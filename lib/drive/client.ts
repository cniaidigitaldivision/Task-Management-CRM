import 'server-only';

import { createSign } from 'node:crypto';

/* ============================================================================
 * GOOGLE DRIVE — the only file in the application that talks to Google
 * ----------------------------------------------------------------------------
 * Owner request 2026-08-13: the company Gmail Drive, connected to the CRM.
 *
 * ── NO SDK, FOR THE SAME REASON AS RESEND ────────────────────────────────────
 * `googleapis` is roughly 20 MB and pulls in a generated client for every Google
 * product. What is used here is four REST calls and one signed JWT. The auth is
 * the only non-obvious part and it is thirty lines of `node:crypto`, so the SDK
 * would be a large dependency wrapping a small amount of code — and the failure
 * modes would be further away.
 *
 * ── A SERVICE ACCOUNT, NOT OAUTH ─────────────────────────────────────────────
 * The owner chose one company account connected once. That means a service
 * account: it has no interactive login, no refresh token to expire, and nothing
 * breaks when a person leaves. The trade is that Drive must be **shared with the
 * service account's email** — it cannot see anything by default, which is the
 * correct default and the step people forget.
 *
 * ── ⚠️ THE KEY IS NEVER HANDLED HERE, ONLY READ ───────────────────────────────
 * `GOOGLE_SERVICE_ACCOUNT_JSON` is read from the environment and nothing in this
 * file logs it, returns it, or includes it in an error. Standing rule R5 — the
 * owner creates it and puts it in `.env.local` themselves; it does not pass
 * through a conversation. `describeDrive()` exists so a screen can say whether it
 * is configured without going anywhere near its contents.
 *
 * ── EVERY FUNCTION REPORTS RATHER THAN THROWS ────────────────────────────────
 * Same decision as `lib/email/send.ts`, for the same reason. A document row is
 * created before the upload is attempted; if Drive is unreachable and this threw,
 * the caller would be left with a row it believes failed and a file it cannot
 * find. So the outcome is a value, and the caller decides.
 * ========================================================================= */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Read-write on Drive files. Not the `.readonly` scope — approving uploads. */
const SCOPE = 'https://www.googleapis.com/auth/drive';

export type DriveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly configured: boolean };

interface ServiceAccount {
  readonly client_email: string;
  readonly private_key: string;
}

/**
 * The service-account credentials, or null.
 *
 * A malformed value is treated as absent rather than thrown: an unparseable
 * environment variable is a configuration problem to be reported on a screen, not
 * a crash on whatever page happened to touch Drive first.
 */
function credentials(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      /* A key pasted into a .env file usually arrives with literal `\n` rather
         than real newlines, and PEM parsing fails cryptically on that. Fixing it
         here is the difference between "it works" and an hour lost to a message
         about an unsupported key format. */
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

/** Whether Drive is usable, without revealing anything about the key. */
export function describeDrive(): {
  readonly configured: boolean;
  /** The service account's address — the one Drive must be shared WITH. */
  readonly account: string | null;
} {
  const creds = credentials();
  return { configured: creds !== null, account: creds?.client_email ?? null };
}

/* ==========================================================================
 * AUTH — a signed JWT exchanged for an access token
 * ==========================================================================
 * Google's service-account flow: sign a claim set with the account's private key,
 * POST it, receive a bearer token. The token lasts an hour and is cached in the
 * module for slightly less than that — re-signing on every call would add an RSA
 * signature and a round trip to Google before each Drive request.
 *
 * The cache is per-process, so several instances hold their own. That is fine:
 * tokens are independent, and a cold start costs one extra request.
 * ========================================================================== */

let cachedToken: { value: string; expiresAtMs: number } | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

async function accessToken(): Promise<DriveResult<string>> {
  const creds = credentials();
  if (!creds) {
    return {
      ok: false,
      configured: false,
      reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not set, so Drive is not connected.',
    };
  }

  /* Renewed a minute early, so a request cannot set off with a token that
     expires while it is in flight. */
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return { ok: true, value: cachedToken.value };
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: creds.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify(claims),
  )}`;

  let assertion: string;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    assertion = `${unsigned}.${signer.sign(creds.private_key, 'base64url')}`;
  } catch {
    /* Deliberately says nothing about the key itself beyond that it did not
       work — an error message is a place secrets leak. */
    return {
      ok: false,
      configured: true,
      reason:
        'The service-account private key could not be used to sign a request. Check it was copied whole, including the BEGIN and END lines.',
    };
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        configured: true,
        reason: `Google refused the credentials (${response.status}). ${body.slice(0, 200)}`,
      };
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      return { ok: false, configured: true, reason: 'Google returned no access token.' };
    }

    cachedToken = {
      value: body.access_token,
      expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return { ok: true, value: cachedToken.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      configured: true,
      reason: message.includes('timeout')
        ? 'Google did not respond within ten seconds.'
        : `Could not reach Google: ${message}`,
    };
  }
}

/** One authenticated Drive request. Shared so error handling exists once. */
async function driveFetch<T>(
  url: string,
  init: RequestInit,
): Promise<DriveResult<T>> {
  const token = await accessToken();
  if (!token.ok) return token;

  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token.value}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      /* 404 on a folder almost always means the same thing, and it is the step
         people miss — so it is named rather than left as a status code. */
      const hint =
        response.status === 404
          ? ' The folder may not exist, or the Drive folder has not been shared with the service account.'
          : '';
      return {
        ok: false,
        configured: true,
        reason: `Drive refused the request (${response.status}).${hint} ${body.slice(0, 200)}`,
      };
    }

    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      configured: true,
      reason: message.includes('timeout')
        ? 'Drive did not respond within thirty seconds.'
        : `Could not reach Drive: ${message}`,
    };
  }
}

/* ==========================================================================
 * THE FOUR OPERATIONS THIS APPLICATION NEEDS
 * ========================================================================== */

export interface DriveFolder {
  readonly id: string;
  readonly name: string;
  readonly createdTime: string;
  readonly webViewLink: string | null;
}

/**
 * The subfolders of one folder, newest first.
 *
 * `'me' in owners` is deliberately NOT filtered on: a folder somebody else in the
 * company created inside a shared folder still needs to become a project.
 *
 * Only the first page is read. A hundred new project folders between two polls is
 * not a real situation, and pagination here would mean holding a page token in the
 * sync cursor for a case that does not occur.
 */
export async function listSubfolders(
  parentFolderId: string,
): Promise<DriveResult<DriveFolder[]>> {
  const query = [
    `'${parentFolderId.replace(/'/g, "\\'")}' in parents`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ].join(' and ');

  const url = `${DRIVE_API}/files?${new URLSearchParams({
    q: query,
    fields: 'files(id,name,createdTime,webViewLink)',
    orderBy: 'createdTime desc',
    pageSize: '100',
    /* Shared Drives are opt-in on every call. Without these two, a folder in a
       Team Drive is invisible and the answer is an empty list rather than an
       error — the worst kind of failure to diagnose. */
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })}`;

  const result = await driveFetch<{ files?: DriveFolder[] }>(url, { method: 'GET' });
  if (!result.ok) return result;
  return { ok: true, value: result.value.files ?? [] };
}

/** One folder's metadata, to confirm a configured id is real and reachable. */
export async function getFolder(folderId: string): Promise<DriveResult<DriveFolder>> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(folderId)}?${new URLSearchParams({
    fields: 'id,name,createdTime,webViewLink',
    supportsAllDrives: 'true',
  })}`;
  return driveFetch<DriveFolder>(url, { method: 'GET' });
}

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly webViewLink: string | null;
}

/**
 * Upload bytes to Drive.
 *
 * Multipart rather than resumable. Resumable is the right choice for very large
 * files over unreliable connections; these arrive from the CRM's own storage,
 * already accepted and size-capped, and resumable would mean holding an upload
 * URL across requests for a case the size limit already excludes.
 */
export async function uploadFile(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  parentFolderId: string | null;
}): Promise<DriveResult<DriveFile>> {
  const token = await accessToken();
  if (!token.ok) return token;

  const metadata = {
    name: input.name,
    ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
  };

  /* Built by hand because the boundary has to appear in the Content-Type header
     as well as in the body, and `FormData` chooses its own. */
  const boundary = `cni-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(input.bytes), tail]);

  try {
    const response = await fetch(
      `${DRIVE_UPLOAD}/files?${new URLSearchParams({
        uploadType: 'multipart',
        fields: 'id,name,webViewLink',
        supportsAllDrives: 'true',
      })}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.value}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        configured: true,
        reason: `Drive refused the upload (${response.status}). ${text.slice(0, 200)}`,
      };
    }

    return { ok: true, value: (await response.json()) as DriveFile };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      configured: true,
      reason: message.includes('timeout')
        ? 'The upload to Drive timed out after a minute.'
        : `Could not upload to Drive: ${message}`,
    };
  }
}

/**
 * Create a folder.
 *
 * Used when a project is created in the CRM and wants a Drive folder — the
 * opposite direction to the poll. Not called by the poll itself, which would
 * otherwise create a folder for the project it had just created from a folder.
 */
export async function createFolder(
  name: string,
  parentFolderId: string,
): Promise<DriveResult<DriveFolder>> {
  return driveFetch<DriveFolder>(
    `${DRIVE_API}/files?${new URLSearchParams({
      fields: 'id,name,createdTime,webViewLink',
      supportsAllDrives: 'true',
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }),
    },
  );
}
