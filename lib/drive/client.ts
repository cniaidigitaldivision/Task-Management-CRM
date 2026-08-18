import 'server-only';

import { accessTokenFromRefresh, oauthConfig } from './oauth';

/* ============================================================================
 * GOOGLE DRIVE — the only file in the application that talks to Google
 * ----------------------------------------------------------------------------
 * Owner request 2026-08-13: the company Gmail Drive, connected to the CRM.
 *
 * ── NO SDK, FOR THE SAME REASON AS RESEND ────────────────────────────────────
 * `googleapis` is roughly 20 MB and pulls in a generated client for every Google
 * product. What is used here is four REST calls. The SDK would be a large
 * dependency wrapping a small amount of code, with its failure modes further
 * away.
 *
 * ── ⚠️ OAUTH, NOT A SERVICE ACCOUNT (changed 2026-08-16) ─────────────────────
 * This file used to sign a service-account JWT. That was the right shape for a
 * Google Workspace domain and the WRONG one for this division, whose account is
 * a consumer @gmail.com: a service account has no Drive storage of its own, so a
 * file it uploads is owned by it and Google refuses with "Service Accounts do
 * not have storage quota". A Shared Drive or domain-wide delegation would fix
 * it, and both require Workspace.
 *
 * The failure would also have been late and confusing — listing folders works
 * fine, and only the approval-into-Drive step breaks.
 *
 * So the CRM acts AS the division's own account. Auth lives in `./oauth.ts`;
 * `accessToken()` below is the seam, and every operation in this file is
 * unchanged by the swap.
 *
 * ── ⚠️ NO CREDENTIAL IS HANDLED HERE ─────────────────────────────────────────
 * The client id and secret are read from the environment by `./oauth.ts`, and
 * the refresh token lives sealed in the database with no client read path
 * (migration 027). Nothing in this file logs, returns or embeds any of them.
 * Standing rule R5: the owner creates them and puts them in `.env.local`
 * themselves; they do not pass through a conversation.
 *
 * ── EVERY FUNCTION REPORTS RATHER THAN THROWS ────────────────────────────────
 * Same decision as `lib/email/send.ts`, for the same reason. A document row is
 * created before the upload is attempted; if Drive is unreachable and this threw,
 * the caller would be left with a row it believes failed and a file it cannot
 * find. So the outcome is a value, and the caller decides.
 * ========================================================================= */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Drive's own mime type for a folder. A folder is a file with this type. */
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';


export type DriveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly configured: boolean };

/** Whether Drive is usable, without revealing anything about the key. */
export function describeDrive(): {
  /** Whether the OAuth CLIENT exists. Not whether anybody has connected yet —
   *  those are different problems with different fixes, and conflating them is
   *  how "Drive is not working" becomes unactionable. */
  readonly configured: boolean;
  /** Kept for callers; the connected ACCOUNT now comes from the database via
   *  `connectionStatus()`, because it is a property of the connection rather
   *  than of the environment. */
  readonly account: string | null;
} {
  return { configured: oauthConfig() !== null, account: null };
}


/* ── AUTH IS NOW OAUTH, ACTING AS THE DIVISION'S OWN ACCOUNT ─────────────────
   This module used to sign a service-account JWT here. That cannot work for a
   consumer @gmail.com account: a service account has no Drive storage of its
   own, so a file it uploads is owned by it and Google refuses with "Service
   Accounts do not have storage quota". The escapes — a Shared Drive or
   domain-wide delegation — both require Google Workspace.

   Listing folders would have worked. Approving a document INTO Drive, which is
   the entire point, would not. So the CRM acts AS the account: files are owned
   by it and land in its My Drive, and no quota question arises.

   ⚠️ EVERYTHING BELOW THIS FUNCTION IS UNCHANGED. `accessToken()` was already
   the single place a token was obtained, so swapping its implementation leaves
   `listSubfolders`, `getFolder`, `uploadFile`, `createFolder` and `driveFetch`
   exactly as they were — including `supportsAllDrives` on every call. */
async function accessToken(): Promise<DriveResult<string>> {
  const result = await accessTokenFromRefresh();
  if (result.ok) return { ok: true, value: result.value };
  return { ok: false, configured: result.configured, reason: result.reason };
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
          ? ' The folder may not exist, or the connected Google account cannot see it.'
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
    `mimeType = '${FOLDER_MIME}'`,
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

export interface DriveChildren {
  /** Subfolders, newest first — the same list `listSubfolders` returns. */
  readonly folders: DriveFolder[];
  /** How many non-folder files sit directly in this folder. */
  readonly fileCount: number;
  /** True when the folder holds more children than one page can report, so
   *  `fileCount` is a floor rather than the true number. */
  readonly truncated: boolean;
}

/**
 * The children of one folder, split into subfolders and a file count.
 *
 * ── ONE CALL WHERE `listSubfolders` MADE ONE, AND ANSWERS TWICE AS MUCH ───────
 * `listSubfolders` asks Drive for `mimeType = folder` and throws the rest away.
 * The folder registry needed a file count too (owner, 2026-08-18: *"showing a
 * zero document… every folder has some documents"*), and the obvious way to get
 * one is a second request per folder. There is no need: dropping the mimeType
 * filter returns everything, and partitioning it here costs nothing. Same number
 * of round trips as before, both answers instead of one.
 *
 * ⚠️ `fileCount` IS A FLOOR, NOT A TOTAL. One page is 1000 children, and a folder
 * with more is reported as `truncated` rather than silently undercounted. Paging
 * through every folder of a large Drive to make a display number exact would turn
 * one sync into thousands of requests; a number the screen marks as "1000+" is
 * more honest and far cheaper than one that is quietly wrong.
 */
export async function listChildren(
  parentFolderId: string,
): Promise<DriveResult<DriveChildren>> {
  const query = [
    `'${parentFolderId.replace(/'/g, "\\'")}' in parents`,
    'trashed = false',
  ].join(' and ');

  const url = `${DRIVE_API}/files?${new URLSearchParams({
    q: query,
    /* `mimeType` is now part of the projection rather than the filter, because
       the partition happens here. */
    fields: 'nextPageToken, files(id,name,mimeType,createdTime,webViewLink)',
    orderBy: 'folder,createdTime desc',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })}`;

  const result = await driveFetch<{
    files?: Array<DriveFolder & { mimeType?: string }>;
    nextPageToken?: string;
  }>(url, { method: 'GET' });
  if (!result.ok) return result;

  const children = result.value.files ?? [];
  const folders: DriveFolder[] = [];
  let fileCount = 0;

  for (const child of children) {
    if (child.mimeType === FOLDER_MIME) {
      folders.push({
        id: child.id,
        name: child.name,
        createdTime: child.createdTime,
        webViewLink: child.webViewLink,
      });
    } else {
      /* Google Docs, Sheets and Slides have their own mime types and are files
         as far as anybody looking at the folder is concerned. Anything that is
         not a folder counts. */
      fileCount += 1;
    }
  }

  return {
    ok: true,
    value: { folders, fileCount, truncated: Boolean(result.value.nextPageToken) },
  };
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
