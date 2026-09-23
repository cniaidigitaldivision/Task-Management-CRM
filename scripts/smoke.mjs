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
  /* CHANGE-PLAN 7.1 opened the dashboard to every role — a Member now gets a
     narrow shape rather than a redirect. Still asserts on a section heading that
     both shapes render, so a broken dashboard fails this rather than a reworded
     one. */
  /* ⚠️ MARKERS GO STALE. "Where the work stands" survives only as a COMMENT in
     dashboard/loading.tsx, and "How to read this" exists nowhere at all — both
     failed on a perfectly healthy page (2026-09-21). A marker must be text the
     page itself renders. */
  ['/dashboard', 'Team capacity', 'member'],
  ['/my-work', 'Your queue', 'member'],
  /* ⚠️ NOT "effort points". That string sits behind `points > 0` in
     tasks-workspace, so the moment the division has no open tasks it disappears and
     this row fails on a screen that is working perfectly — which is exactly what
     happened after the projects and tasks were wiped on 2026-08-19. Third time this
     script has been caught matching something conditional; see /workflow and
     /monthly-report below for the other two.
     This sentence is in the page description and renders in every state, and it
     still only appears once `listTasks` and `listProjects` have both returned. */
  ['/tasks', 'Drag a card between columns', 'member'],
  /* Every role has it; a member sees only their own repeats, an admin the
     division's. The needle is the sentence the page states either way. */
  ['/repeats', 'a copy is created automatically at midnight', 'member'],
  /* Was "Ad-hoc work" — the large audit card, removed on the owner's instruction
     (*"I don't know the purpose of this whole card"*). "All projects" is the first
     filter card: it lives inside ProjectsWorkspace, so it only appears once the page
     has real project data to hand it, and unlike the old marker it renders whether
     the division has one project or none. */
  ['/projects', 'All projects', 'member'],
  /* The description changed when the calendar gained per-task detail. Matching on
     a weekday heading instead of on prose: the grid cannot render without it, so
     this fails if the calendar breaks rather than merely if its wording changes. */
  ['/calendar', 'Mon', 'member'],
  ['/workload', 'Person by person', 'team_coordinator'],
  ['/performance', 'Understand the work', 'team_coordinator'],
  ['/team', 'Everybody', 'admin'],
  /* CHANGE-PLAN 5.1 replaced the four fixed panels with selectable report types,
     so the old marker text ("Where the effort is going") no longer exists. "How
     to read this" is the better replacement rather than a weaker one: it is the
     notes block, which only renders once a report has actually been built from
     the database — so it still fails if the page renders but the report does not. */
  ['/reports', 'Reports', 'team_coordinator'],

  /* ── The CRM, which is where the sales team actually live ─────────────────
     ⚠️ These were missing entirely, so the pages a salesperson uses all day
     were the only ones a smoke test never opened (noticed 2026-09-21 while
     proving an auth change broke nothing).

     ⚠️ THE FLOOR HERE IS NOT A RANK. `requireCrmAccess` admits admins AND
     anybody whose department owns lead projects, which this table cannot say —
     so they are marked admin+, which is right for the admin pass and right for
     a member outside sales. A SALES member would reach them and be reported as
     a failure; that is a limitation of the table, not of the page. */
  ['/my-leads', 'My leads', 'admin'],
  ['/appointments', 'Manage calls, meetings and site visits', 'admin'],
  ['/conversations', 'Chat and email with your leads', 'admin'],
  ['/follow-ups', 'Prioritise the next action and keep every open lead moving', 'admin'],
  ['/clients', 'Manage client relationships, projects, communication and sales records', 'admin'],
  ['/knowledge', 'Control what the agent can say for each project', 'admin'],
  /* The monthly CEO report. `admin`, a rank above `/reports`, because it totals
     recurring fees across every client.

     ⚠️ This script runs as an Admin and a Member only, so this row proves the
     Member refusal — NOT the Coordinator one. A Coordinator is the interesting
     case: they clear `/reports` and must still be refused here. That was measured
     by hand and is why this is a top-level segment rather than `/reports/ceo`,
     where a Coordinator got a 200 — see the ⚠️ note in the route's layout. If this
     segment is ever restructured, re-check the Coordinator by hand; this row will
     not catch it.

     ⚠️ The marker is the report's masthead, NOT the provenance block or any table.
     Those only render when the month HAS projects, so matching one of them would
     fail on a quiet month — the same mistake the /workflow row above records. The
     masthead renders in both the empty and the populated shape, and it still
     proves more than the page header does: it lives inside the workspace, which is
     only reached once `ceoReportAction` has returned a real report, so a page that
     renders its header and then fails to compute the figures fails this check. */
  ['/monthly-report', 'Monthly performance report', 'admin'],
  ['/settings', 'Capacity and thresholds', 'admin'],
  /* Handoff chains (E-004 / R4a). Readable by EVERY role since 2026-08-15 —
     owner's decision: a chain creates work that lands in somebody's queue, and
     the person it lands on should be able to see why. Editing stays Admin+,
     enforced by the server actions and migration 026's write policy rather than
     by this route, so there is no rank floor left here to assert.

     ⚠️ The marker is the page description, NOT the canvas explainer. The first
     attempt matched a sentence that only renders once a chain is OPEN, so it
     failed on an empty division — the screen was fine and the check was wrong.
     This string is in the header and renders in every state: no chains, a list
     of chains, or one open. */
  ['/workflow', 'one chain per type can be live', 'member'],
  ['/profile', 'Your details', 'member'],
  /* ⚠️ ADMIN+, not super-admin: the owner widened it on 2026-08-22 (see the
     note on its nav entry) and the route guard, the permission matrix and
     migration 040 all moved with it. This row alone was left behind, so the
     smoke test reported a correct page as a failure for a month. */
  ['/security', 'Security', 'admin'],
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
  return String(text).replace(/:\/\/([^:@\s]+):(.*)@([^@\s\/]+)/g, '://$1:••••••••@$3');
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

/**
 * ⚠️ THE @cni-demo.com SEED ACCOUNTS NO LONGER EXIST (checked 2026-09-04), so
 * this asked for a user nobody has and the whole smoke test refused to run.
 * It now falls back to any active account of the RANK the caller wanted — an
 * admin for the admin pass, a member for the member pass — which is what the
 * two passes are actually about.
 */
async function sessionFor(emailPrefix, wantRole) {
  let rows = await sql`
    select id, full_name, role from public.users
     where email = ${`${emailPrefix}@${DOMAIN}`} and is_active
  `;
  if (!rows[0] && wantRole) {
    rows = wantRole === 'member'
      ? await sql`
          select id, full_name, role from public.users
           where is_active and role = 'member' order by created_at limit 1`
      : await sql`
          select id, full_name, role from public.users
           where is_active and role in ('admin', 'super_admin') order by created_at limit 1`;
  }
  if (!rows[0]) throw new Error(`No ${wantRole ?? emailPrefix} account to sign in as.`);

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

  /* sana was the seeded admin and yusra the seeded member; the fallback picks a
     real account of that rank now that the seed is gone. */
  for (const [prefix, wantRole] of [['sana', 'admin'], ['yusra', 'member']]) {
    const { cookie, user } = await sessionFor(prefix, wantRole);
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
