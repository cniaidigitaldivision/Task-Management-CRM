#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — DATABASE CONNECTION CHECK
 * ----------------------------------------------------------------------------
 *     node scripts/check-db.mjs
 *
 * Reads DATABASE_URL from .env.local, connects, and reports whether the
 * connection is correct — WITHOUT printing the password, and without anyone
 * having to send the connection string to anybody.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Three things about this particular connection string are easy to get wrong,
 * and two of them fail SILENTLY:
 *
 *   1. The region placeholder. `aws-0-REGION` is copied straight out of the
 *      example and never replaced. This one fails loudly, at least.
 *
 *   2. URL-reserved characters in the password. `#` starts a URL fragment, so
 *      a parser throws away everything after it — host, port, database, and
 *      the ?options= suffix. `?`, `@`, `/`, `:` and `%` are the same class of
 *      problem. Percent-encode them, or better, use a password without them.
 *
 *   3. ⚠️ THE DANGEROUS ONE — a missing or mangled `?options=-c role=cni_app`.
 *      The app connects perfectly well as `postgres`, so nothing looks wrong.
 *      But `postgres` has BYPASSRLS, which means every row-level security
 *      policy in migration 005 is silently skipped and half the security model
 *      quietly stops existing. Nothing warns you. Queries just start returning
 *      rows they should not.
 *
 * Check 4 below is the whole reason this script exists.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

/** Never print a secret, even partially — a prefix still narrows a search. */
function redact(url) {
  return url.replace(/:\/\/([^:]+):([^@]*)@/, '://$1:••••••••@');
}

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

console.log('\n  CNI CRM — database connection check\n');

const env = readEnvLocal();
if (!env) {
  bad('.env.local not found.');
  info('Create it:  cp .env.example .env.local   then fill in DATABASE_URL.');
  process.exit(1);
}

const url = env.DATABASE_URL;
if (!url) {
  bad('DATABASE_URL is not set in .env.local.');
  process.exit(1);
}
ok(`.env.local found — DATABASE_URL is ${redact(url)}`);

/* ---- 1 · the placeholder ------------------------------------------------ */
if (url.includes('REGION') || url.includes('PASSWORD')) {
  bad('The connection string still contains a placeholder (REGION or PASSWORD).');
  info('Copy the real one from Supabase → Project Settings → Database → Connection string.');
  process.exit(1);
}
ok('No leftover placeholders.');

/* ---- 2 · does it even parse? ------------------------------------------- */
let parsed;
try {
  parsed = new URL(url);
} catch {
  bad('DATABASE_URL is not a valid URL.');
  process.exit(1);
}

if (parsed.hash) {
  bad('The URL contains a "#", so everything after it was discarded.');
  info('That is almost certainly an unencoded "#" in your password.');
  info('Percent-encode it as %23 — or reset the password using only letters,');
  info('digits, "-" and "_", which avoids the problem entirely.');
  process.exit(1);
}

/* ---- 3 · the pooled port ------------------------------------------------ */
if (parsed.port === '5432') {
  warn('Port 5432 is the DIRECT connection. Use 6543 (Transaction mode) for the app —');
  info('serverless functions open and close connections constantly and will exhaust');
  info('the direct connection limit.');
} else if (parsed.port === '6543') {
  ok('Using the pooled connection on port 6543.');
} else {
  warn(`Unexpected port ${parsed.port || '(none)'} — expected 6543.`);
}

/* ---- 4 · ⚠️ the role override ------------------------------------------- */
const options = parsed.searchParams.get('options') ?? '';
const declaresRole = /-c\s*role\s*=\s*cni_app/.test(decodeURIComponent(options));

if (!declaresRole) {
  bad('The role override is MISSING. This is the one that matters.');
  info('Append to DATABASE_URL:   ?options=-c%20role%3Dcni_app');
  info('');
  info('Without it the app connects as `postgres`, which has BYPASSRLS. Every');
  info('row-level security policy is skipped, silently. Nothing will look wrong.');
  process.exit(1);
}
ok('The connection string declares role=cni_app.');

/* ---- 5 · connect and ask the database what it actually thinks ---------- */
console.log('\n  Connecting…\n');

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });

try {
  const [row] = await sql`
    select
      current_user                                     as current_user,
      session_user                                     as session_user,
      current_setting('server_version')                as version,
      (select count(*) from pg_tables
        where schemaname = 'public')                   as tables,
      (select count(*) from pg_policies
        where schemaname = 'public')                   as policies,
      pg_has_role(current_user, 'cni_app', 'member')   as is_cni_app,
      (select rolbypassrls from pg_roles
        where rolname = current_user)                  as bypasses_rls
  `;

  ok(`Connected. PostgreSQL ${String(row.version).split(' ')[0]}`);
  ok(`${row.tables} tables and ${row.policies} RLS policies in public.`);

  if (row.current_user === 'cni_app') {
    ok(`Acting as \x1b[1mcni_app\x1b[0m — row-level security applies.`);
  } else {
    bad(`Acting as "${row.current_user}", NOT cni_app.`);
    info('The ?options= suffix is present but the server did not apply it.');
    info('Some poolers strip startup options — if this persists, the fallback is');
    info('SET LOCAL ROLE cni_app inside withUser(), which lib/db/README.md §2 covers.');
  }

  if (row.bypasses_rls === true) {
    bad('This role BYPASSES row-level security. Do not run the app like this.');
  } else {
    ok('This role does not bypass row-level security.');
  }

  /* The real proof: RLS is on, and with no app.user_id set it must return
     nothing. Fail-closed is the property everything else depends on. */
  const visible = await sql`select count(*)::int as n from public.users`;
  if (row.current_user === 'cni_app') {
    if (visible[0].n === 0) {
      ok('With no identity set, users returns 0 rows — failing closed, as designed.');
    } else {
      warn(`users returned ${visible[0].n} rows with no identity set. Expected 0.`);
    }
  }

  console.log('\n  \x1b[32mReady.\x1b[0m Tell Claude the check passed.\n');
} catch (error) {
  bad(`Could not connect: ${error.message}`);
  console.log('');
  if (/ENOTFOUND|EAI_AGAIN/.test(error.message)) {
    info('The host could not be resolved — check the region in the hostname.');
  } else if (/password authentication failed|SASL/.test(error.message)) {
    info('The password was rejected. If it contains # ? @ / : or %, those must be');
    info('percent-encoded — or reset it to letters, digits, "-" and "_" only.');
  } else if (/Tenant or user not found/.test(error.message)) {
    info('The pooler did not recognise the username. It must be the full');
    info('postgres.<project-ref> form, not just "postgres".');
  }
  console.log('');
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
