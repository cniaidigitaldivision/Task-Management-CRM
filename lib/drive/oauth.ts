import 'server-only';

import { readRefreshToken, recordFailure } from '@/lib/db/queries/drive';

/* ============================================================================
 * GOOGLE OAUTH — the CRM acts AS the division's own account
 * ----------------------------------------------------------------------------
 * ── WHY NOT THE SERVICE ACCOUNT THE CLIENT WAS BUILT FOR ─────────────────────
 * A service account has no Drive storage of its own. A file it uploads is owned
 * by it, and Google refuses with "Service Accounts do not have storage quota".
 * The escapes — a Shared Drive, or domain-wide delegation — both need Google
 * Workspace, and the division's account is a consumer @gmail.com.
 *
 * Reading folders would have worked; approving a document INTO Drive, which is
 * the whole feature, would not. Acting as the account itself has no such
 * problem: files are owned by that account and land in its My Drive.
 *
 * ── WHAT IS STORED, AND WHAT IS NOT ──────────────────────────────────────────
 * The REFRESH token is stored, sealed (migration 027 refuses a plaintext one).
 * The ACCESS token is never stored — it lives for an hour, is cached in memory,
 * and is re-minted from the refresh token when it lapses. Persisting it would
 * add a second secret to protect for no benefit.
 * ========================================================================= */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/* `drive.file` would be tighter, but it only ever sees files this app created —
   it cannot list a folder the owner already has, which is exactly what the
   folder sync and the approval target both need. `drive` is the narrowest scope
   that does the job. `userinfo.email` is what lets the screen say WHOSE Drive is
   connected rather than "connected". */
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Null when the owner has not created the OAuth client yet. */
export function oauthConfig(): OAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The redirect Google sends the person back to.
 *
 * Derived from the REQUEST, not from an environment variable, for the same
 * reason `lib/app-url.ts` derives the app URL: a fixed value is wrong on
 * localhost, wrong on a preview deployment, and only right in production. Both
 * of the URIs registered in Google Cloud are produced by this.
 */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/drive/callback`;
}

/**
 * Where to send somebody to grant access.
 *
 * `access_type=offline` plus `prompt=consent` is what makes Google return a
 * REFRESH token. Without both, a second authorisation returns only an access
 * token and the connection silently dies an hour later — the single most common
 * way this flow is got wrong.
 */
export function authorizeUrl(input: {
  config: OAuthConfig;
  origin: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: redirectUri(input.origin),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: input.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface ExchangeResult {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly email: string;
}

/** Trade the one-time code for tokens, and find out whose account it is. */
export async function exchangeCode(input: {
  config: OAuthConfig;
  origin: string;
  code: string;
}): Promise<{ ok: true; value: ExchangeResult } | { ok: false; reason: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: redirectUri(input.origin),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    /* Google's own message is genuinely useful here — `redirect_uri_mismatch`
       names the exact misconfiguration — so it is passed through rather than
       replaced with something generic. */
    return { ok: false, reason: `Google refused the code: ${detail.slice(0, 300)}` };
  }

  const body = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
  };

  if (!body.refresh_token) {
    /* Google withholds the refresh token when the account has already granted
       this client and `prompt=consent` was not honoured. Saying so plainly beats
       "something went wrong", because the fix is specific. */
    return {
      ok: false,
      reason:
        'Google did not return a refresh token. Remove this app at myaccount.google.com → Security → Third-party access, then connect again.',
    };
  }
  if (!body.access_token) return { ok: false, reason: 'Google returned no access token.' };

  const who = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  const email = who.ok ? (((await who.json()) as { email?: string }).email ?? '') : '';

  return {
    ok: true,
    value: { refreshToken: body.refresh_token, accessToken: body.access_token, email },
  };
}

/* ── ACCESS TOKEN CACHE ──────────────────────────────────────────────────────
   Per process, like the service-account cache it replaces. Several instances
   each hold their own, which is fine: tokens are independent and a cold start
   costs one extra request to Google. */
let cached: { value: string; expiresAtMs: number } | null = null;

/** Reset the cache — used when the connection changes underneath us. */
export function forgetAccessToken(): void {
  cached = null;
}

/**
 * A usable access token, minted from the stored refresh token.
 *
 * This is what `lib/drive/client.ts` calls instead of signing a service-account
 * JWT. Every other function in that file is unchanged.
 */
export async function accessTokenFromRefresh(): Promise<
  { ok: true; value: string } | { ok: false; reason: string; configured: boolean }
> {
  const config = oauthConfig();
  if (!config) {
    return {
      ok: false,
      configured: false,
      reason:
        'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not set, so Drive cannot be connected.',
    };
  }

  /* A minute of headroom, so a request cannot set off with a token that expires
     while it is in flight. */
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return { ok: true, value: cached.value };
  }

  const refresh = await readRefreshToken();
  if (!refresh) {
    return {
      ok: false,
      configured: true,
      reason: 'Google Drive is not connected yet. An Admin can connect it from Documents.',
    };
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    /* `invalid_grant` means the token is no longer good, and Google does not say
       which of the several reasons applies: revoked in the account, password
       changed, or — much the likeliest here — the seven-day expiry that Google
       puts on refresh tokens from an OAuth client still in Testing mode. All
       three have the same fix, so the message names it rather than guessing at
       the cause. Recorded so the Documents screen can say "reconnect" instead of
       failing silently on every approval from then on. */
    const message = detail.includes('invalid_grant')
      ? 'The Google connection has expired or was revoked. Press Connect Google Drive again on the Documents screen — nothing already in Drive is affected.'
      : `Google refused the refresh token: ${detail.slice(0, 200)}`;
    await recordFailure(message).catch(() => {});
    return { ok: false, configured: true, reason: message };
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    return { ok: false, configured: true, reason: 'Google returned no access token.' };
  }

  cached = {
    value: body.access_token,
    expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return { ok: true, value: cached.value };
}
