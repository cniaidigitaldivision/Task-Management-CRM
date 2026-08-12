#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — SIGNED-IN SMOKE TEST
 * ----------------------------------------------------------------------------
 *     npm run smoke                 against http://localhost:4310
 *     npm run smoke -- <base-url>
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `next build` proves every page COMPILES. It does not prove a single one
 * RENDERS — a page that throws in its data fetch builds perfectly and returns
 * 500 the first time somebody opens it. Every screen in this application reads
 * the database through row-level security under a real identity, and that is
 * exactly the seam a build cannot reach.
 *
 * So this mints a real session for a real seeded user, presents the real signed
 * cookie, and fetches every route as that person. Twice: once as the Admin and
 * once as a Member, because the two see genuinely different data and a page that
 * assumes the Admin's shape breaks only for the Member.
 *
 * It never prints the connection string (postgres.js echoes the URL it was given
 * on a parse failure, and that URL contains the password), and it revokes the
 * sessions it created on the way out.
 * ========================================================================= */

import { createHmac, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const BASE = process.argv[2] ?? 'http://localhost:4310';
const DOMAIN = 'cni-demo.com';

/* ── Each route names something that MUST appear in its own output ────────────
   Checking only for the absence of error text does not work: Next.js embeds the
   default not-found boundary in the RSC payload of every page in development, so
   "This page could not be found" is present on a perfectly healthy screen. That
   produced 23 false failures on the first run of this script.

   A positive marker is also a stronger test — it proves the page reached its own
   content, not merely that it returned a 200 with a shell in it. */
/* `minRole` mirrors nav-config's role lists and the requireRole() call on each
   page. A route above the actor's rank MUST redirect — and asserting that is
   half the value of this script: the first run found that a Member could reach
   /team and /workload by typing the URL, because the sidebar hiding a link is
   convenience and never security (NFR-006). */
const APP_ROUTES = [
  ['/dashboard', 'Where the work stands', 'team_coordinator'],
  ['/my-work', 'Your queue', 'member'],
  ['/tasks', 'effort points', 'member'],
  ['/projects', 'Ad-hoc work', 'member'],
  ['/calendar', 'Every dated task', 'member'],
  ['/workload', 'Person by person', 'team_coordinator'],
  ['/team', 'Everybody', 'admin'],
  /* CHANGE-PLAN 5.1 replaced the four fixed panels with selectable report types,
     so the old marker text ("Where the effort is going") no longer exists. "How
     to read this" is the better replacement rather than a weaker one: it is the
     notes block, which only renders once a report has actually been built from
     the database — so it still fails if the page renders but the report does not. */
  ['/reports', 'How to read this', 'team_coordinator'],
  ['/settings', 'Capacity and thresholds', 'admin'],
  ['/profile', 'Your details', 'member'],
  ['/security', 'Security', 'super_admin'],
];

const RANK = { super_admin: 4, admin: 3, team_coordinator: 2, member: 1 };
const PUBLIC_ROUTES = [
  ['/login', 'Sign in'],
  ['/forgot-password', 'Send me a code'],
  ['/reset-password', 'Set a new password'],
  ['/activate', 'This link is not usable'],
  /* Deliberately asserts the CLOSED state, not just a 200. A Super Admin exists
     and the database permits exactly one, so the form must never appear again —
     and 'Setup' alone matched both the open form and the closed door. On a public
     URL the difference is who owns the system. */
  ['/setup', 'Setup is closed'],
];

function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):([^@\s]*)@/g, '://$1:••••••••@');
}

function readEnvLocal() {
  const env = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    console.error('✗ .env.local not found.');
    process.exit(1);
  }
  return env;
}

const env = readEnvLocal();
for (const key of ['DATABASE_URL', 'SESSION_SECRET']) {
  if (!env[key]) {
    console.error(`✗ ${key} is not set in .env.local`);
    process.exit(1);
  }
}

/* Mirrors lib/auth/session.ts exactly. A cookie this script builds differently
   from the way the app reads it would fail for a reason that has nothing to do
   with the pages being tested. */
const sign = (token) =>
  createHmac('sha256', env.SESSION_SECRET).update(token, 'utf8').digest('base64url');
const encodeCookie = (token) => `${token}.${sign(token)}`;
const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
  onnotice: () => {},
});

const created = [];

async function sessionFor(emailPrefix) {
  const rows = await sql`
    select id, full_name, role from public.users
     where email = ${`${emailPrefix}@${DOMAIN}`} and is_active
  `;
  if (!rows[0]) throw new Error(`No seeded user ${emailPrefix}@${DOMAIN}. Run npm run seed:demo.`);

  const token = randomBytes(32).toString('base64url');
  const sessionRows = await sql`
    insert into public.sessions
      (user_id, refresh_token_hash, device_fingerprint, expires_at, absolute_expires_at, user_agent)
    values (
      ${rows[0].id}, ${hashToken(token)}, 'smoke-test-fingerprint',
      now() + interval '1 hour', now() + interval '2 hours', 'cni-smoke/1.0'
    )
    returning id
  `;
  created.push(sessionRows[0].id);

  return { cookie: `cni_session=${encodeCookie(token)}`, user: rows[0] };
}

/**
 * Fetches a route and proves it did the right thing *for this actor*.
 *
 * When the actor's rank is below the route's floor, a redirect is the pass and a
 * 200 is the failure. That inversion is the point: the same request is correct or
 * incorrect depending on who makes it, which is exactly what a build cannot check.
 */
async function check([path, marker, minRole], cookie, label, actorRole) {
  const shouldReach = !actorRole || !minRole || RANK[actorRole] >= RANK[minRole];

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
    });
  } catch (error) {
    bad(`${label} ${path} — could not connect (${redact(error?.message ?? error)})`);
    return;
  }

  if (!shouldReach) {
    if (response.status === 307 || response.status === 302) {
      ok(`${label} ${path} — correctly refused (${response.status}); ${minRole}+ only`);
    } else {
      bad(
        `${label} ${path} — returned ${response.status} to a ${actorRole}, but it is ${minRole}+ only and must redirect`,
      );
    }
    return;
  }

  if (response.status !== 200) {
    bad(`${label} ${path} — HTTP ${response.status}`);
    return;
  }

  const body = await response.text();

  /* A thrown render returns 200 in development, so the status alone proves
     nothing. These two strings only appear on an actual error overlay. */
  for (const crash of ['Application error', 'Unhandled Runtime Error']) {
    if (body.includes(crash)) {
      bad(`${label} ${path} — rendered an error page ("${crash}")`);
      return;
    }
  }

  if (!body.includes(marker)) {
    bad(`${label} ${path} — rendered, but "${marker}" is missing from the output`);
    return;
  }

  ok(`${label} ${path} — ${response.status}, ${(body.length / 1024).toFixed(0)}kB`);
}

try {
  console.log(`\nCNI CRM — signed-in smoke test against ${BASE}\n`);

  console.log('  Public routes');
  for (const route of PUBLIC_ROUTES) await check(route, null, '   ');

  /* The guard itself. A protected route that returns 200 without a cookie is the
     single worst outcome this script can find. */
  console.log('\n  The session guard');
  const unguarded = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
  if (unguarded.status === 307 || unguarded.status === 302) {
    ok(`/dashboard without a cookie redirects (${unguarded.status})`);
  } else {
    bad(`/dashboard without a cookie returned ${unguarded.status} — it must redirect`);
  }

  for (const prefix of ['sana', 'yusra']) {
    const { cookie, user } = await sessionFor(prefix);
    console.log(`\n  As ${user.full_name} (${user.role})`);
    for (const route of APP_ROUTES) await check(route, cookie, '   ', user.role);
  }

  console.log(
    failures === 0
      ? `\n\x1b[32m✓\x1b[0m Every route rendered for both roles.\n`
      : `\n\x1b[31m✗\x1b[0m ${failures} problem${failures === 1 ? '' : 's'}.\n`,
  );
} catch (error) {
  bad(redact(error?.message ?? error));
} finally {
  /* Always clean up, even after a failure — a smoke run must not leave live
     sessions behind that would let anybody in with a stale cookie. */
  if (created.length > 0) {
    await sql`
      update public.sessions
         set revoked_at = now(), revoked_reason = 'smoke_test_complete'
       where id = any(${created}::uuid[])
    `.catch(() => {});
  }
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
}
