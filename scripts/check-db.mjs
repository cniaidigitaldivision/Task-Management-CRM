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

/* Failures are COUNTED, not just printed. The first version of this script
 * printed "Ready" after two red crosses, which is worse than not checking at
 * all — it told the owner the connection was correct when it was connected as
 * `postgres` with row-level security bypassed. A check that can report success
 * alongside a failure is not a check. */
let failures = 0;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

/** Never print a secret, even partially — a prefix still narrows a search. */
function redact(url) {
  return url.replace(/:\/\/([^:@\s]+):(.*)@([^@\s\/]+)/, '://$1:••••••••@$3');
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

/* ---- 4 · the role override in the URL is INFORMATIONAL ONLY -------------
 * Supabase's pooler (Supavisor) does not forward libpq startup options, so
 * `?options=-c role=cni_app` is silently dropped and the session stays as
 * `postgres`. Measured, not assumed — see registry C-18.
 *
 * The role is therefore taken per transaction with SET LOCAL ROLE instead,
 * which is also the only thing that CAN work behind a transaction-mode pooler:
 * a session-level SET would leak to whichever tenant reused the backend next.
 * Check 6 below tests that path, because that is the one the app uses. */
const options = parsed.searchParams.get('options') ?? '';
if (/-c\s*role\s*=\s*cni_app/.test(decodeURIComponent(options))) {
  info('URL declares role=cni_app — harmless, but the pooler ignores it (registry C-18).');
}

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
  info(`Session role is "${row.current_user}" (expected — the pooler drops the URL option).`);

  /* ---- 6 · THE CHECK THAT MATTERS ---------------------------------------
   * Exactly what withUser() does on every request: one transaction, SET LOCAL
   * ROLE, SET LOCAL identity. If this works, row-level security binds. */
  const inTx = await sql.begin(async (tx) => {
    await tx`select set_config('role', 'cni_app', true)`;
    const [who] = await tx`
      select current_user                                as who,
             (select rolbypassrls from pg_roles
               where rolname = current_user)             as bypasses_rls,
             (select count(*)::int from public.users)    as visible_no_identity
    `;
    return who;
  });

  if (inTx.who === 'cni_app') {
    ok('Inside a transaction with SET LOCAL ROLE, the session is \x1b[1mcni_app\x1b[0m.');
  } else {
    bad(`SET LOCAL ROLE did not take effect — still "${inTx.who}".`);
    info('Without this the app cannot enforce row-level security at all.');
  }

  if (inTx.bypasses_rls === false) {
    ok('That role does NOT bypass row-level security.');
  } else {
    bad('That role bypasses row-level security.');
  }

  /* The real proof. Fail-closed is the property registry C-14 rests on, so it
     is asserted from outside rather than assumed. */
  if (inTx.visible_no_identity === 0) {
    ok('With no app.user_id set, users returns 0 rows — failing closed, as designed.');
  } else {
    bad(`users returned ${inTx.visible_no_identity} rows with no identity set. Expected 0.`);
  }

  if (failures === 0) {
    console.log('\n  \x1b[32mReady.\x1b[0m Everything checks out.\n');
  } else {
    console.log(
      `\n  \x1b[31mNOT ready — ${failures} check${failures === 1 ? '' : 's'} failed.\x1b[0m` +
        ' Send this output to Claude; it redacts the password.\n',
    );
    process.exitCode = 1;
  }
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
