#!/usr/bin/env node
/* ============================================================================
 * PERFORMANCE CHECK  —  npm run perf [baseUrl]
 * ----------------------------------------------------------------------------
 * Times the real signed-in pages and prints the numbers. Existence of this file
 * is the point: "it feels faster" is not a claim anybody can check, and the
 * owner reported a two-to-three second problem that turned out to be measurable
 * to the millisecond.
 *
 * It signs in as the demo Admin — the same cookie machinery smoke.mjs uses —
 * because an unauthenticated request only measures a redirect and a redirect
 * touches no data at all. That was how the first attempt at measuring this
 * produced numbers that looked fine while the application felt slow.
 *
 * Each page is fetched twice and the SECOND time is reported. The first fetch
 * of a dev build compiles the route, which is a number about the build tool
 * rather than about the application.
 * ========================================================================= */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GREEN = '[32m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

const BASE = process.argv[2] ?? 'http://localhost:4310';

/** Timings above these are worth someone's attention. */
const GOOD_MS = 400;
const POOR_MS = 1200;

const PAGES = [
  '/dashboard',
  '/my-work',
  '/tasks',
  '/projects',
  '/calendar',
  '/workload',
  '/team',
  '/reports',
  '/settings',
  '/profile',
];

function loadEnv() {
  try {
    /* `/\r?\n/`, not '\n' — a CRLF file leaves a trailing \r that `.` cannot
       match, so every key silently fails to parse. */
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* Values may come from the real environment. */
  }
}

loadEnv();

/* Mirrors lib/auth/session.ts, exactly as scripts/smoke.mjs does. A cookie
   built differently from the way the application reads it fails for a reason
   that has nothing to do with the pages being timed. */
const sign = (token) =>
  createHmac('sha256', process.env.SESSION_SECRET).update(token, 'utf8').digest('base64url');
const encodeCookie = (token) => `${token}.${sign(token)}`;
const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * A session cookie for the demo Admin, minted directly in the database.
 *
 * The same approach smoke.mjs takes, and for the same reason: signing in
 * through the form needs a password and a TOTP code, and this script exists to
 * measure page rendering rather than to re-test authentication.
 *
 * The session is deleted afterwards. A script that leaves a live session behind
 * every time it runs is a slow leak of valid credentials.
 */
async function signIn() {
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

  try {
    const [person] = await sql`
      select id from public.users where email = 'sana@cni-demo.com' and is_active
    `;
    if (!person) throw new Error('Run `npm run seed:demo` first.');

    const token = randomBytes(32).toString('base64url');
    const [session] = await sql`
      insert into public.sessions
        (user_id, refresh_token_hash, device_fingerprint, expires_at,
         absolute_expires_at, user_agent)
      values (
        ${person.id}, ${hashToken(token)}, 'perf-script',
        now() + interval '1 hour', now() + interval '2 hours', 'cni-perf/1.0'
      )
      returning id
    `;

    return { cookie: `cni_session=${encodeCookie(token)}`, sessionId: session.id };
  } finally {
    await sql.end();
  }
}

async function signOut(sessionId) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`delete from public.sessions where id = ${sessionId}`;
  } finally {
    await sql.end();
  }
}

function colour(ms) {
  if (ms <= GOOD_MS) return GREEN;
  if (ms <= POOR_MS) return YELLOW;
  return RED;
}

function bar(ms) {
  return '█'.repeat(Math.min(40, Math.max(1, Math.round(ms / 50))));
}

const { cookie, sessionId } = await signIn();

console.log(`\n${DIM}Base:${OFF} ${BASE}`);
console.log(`${DIM}Each page fetched twice; the second is reported.${OFF}\n`);

const results = [];

for (const path of PAGES) {
  const fetchOnce = async () => {
    const started = performance.now();
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    await response.arrayBuffer();
    return { ms: performance.now() - started, status: response.status };
  };

  await fetchOnce();
  const { ms, status } = await fetchOnce();

  results.push({ path, ms, status });

  const label = path.padEnd(12);
  const shown = `${Math.round(ms)} ms`.padStart(8);
  const note = status >= 300 && status < 400 ? `${DIM} (redirect — not measured)${OFF}` : '';
  console.log(`  ${label} ${colour(ms)}${shown}${OFF}  ${DIM}${bar(ms)}${OFF}${note}`);
}

const measured = results.filter((r) => r.status < 300);
if (measured.length > 0) {
  const total = measured.reduce((sum, r) => sum + r.ms, 0);
  const worst = measured.reduce((a, b) => (a.ms > b.ms ? a : b));

  console.log(
    `\n  ${DIM}average${OFF} ${Math.round(total / measured.length)} ms` +
      `   ${DIM}slowest${OFF} ${worst.path} at ${Math.round(worst.ms)} ms\n`,
  );

  if (worst.ms > POOR_MS) {
    console.log(
      `${YELLOW}Still slow.${OFF} ${DIM}Check that vercel.json pins the region next to the` +
        ` database, and that the page does not wait on queries in sequence.${OFF}\n`,
    );
  }
}

/* Every run would otherwise leave a valid session behind — a slow leak of
   working credentials from a script somebody runs whenever the app feels
   slow. */
await signOut(sessionId);
