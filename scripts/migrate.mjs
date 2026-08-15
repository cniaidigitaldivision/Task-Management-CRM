#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — APPLY A MIGRATION FILE
 * ----------------------------------------------------------------------------
 *     node scripts/migrate.mjs lib/db/migrations/012_work_core.sql
 *     npm run migrate -- lib/db/migrations/012_work_core.sql
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `lib/db/migrations/*.sql` is the schema's single source of truth (registry
 * C-16). Until now migrations were applied by pasting them through the Supabase
 * MCP, which meant the file on disk and the database were two separate acts of
 * typing — and the only thing keeping them identical was care.
 *
 * This applies the file itself. There is one copy of the SQL and it is the one
 * in version control.
 *
 * ── TWO PROPERTIES THAT MATTER ───────────────────────────────────────────────
 *   1. ONE TRANSACTION. The whole file commits or none of it does. A migration
 *      that half-applies leaves a schema no file describes, which is far worse
 *      than a migration that fails.
 *   2. IT NEVER PRINTS THE CONNECTION STRING. postgres.js echoes the URL it was
 *      given when it cannot parse it, and that URL contains the password. Every
 *      error path here goes through redact(). This script is safe to share.
 *
 * It connects as the migration owner (whatever DATABASE_URL is), NOT as
 * `cni_app` — DDL is the one job that legitimately needs the owning role.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import postgres from 'postgres';

/** Never print a secret, even partially — a prefix still narrows a search. */
function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):(.*)@([^@\s\/]+)/g, '://$1:••••••••@$3');
}

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error('✗ .env.local not found. Copy .env.example and fill it in.');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    /* Strip surrounding quotes. A quoted URL fed to postgres.js fails to parse
       and the error message contains the password — see the header. */
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/migrate.mjs <path-to-.sql>');
  process.exit(1);
}

let sqlText;
try {
  sqlText = readFileSync(resolve(process.cwd(), file), 'utf8');
} catch {
  console.error(`✗ Cannot read ${file}`);
  process.exit(1);
}

const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

console.log(`\nApplying ${basename(file)} …`);

const sql = postgres(env.DATABASE_URL, {
  prepare: false, // mandatory behind a transaction-mode pooler
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
  onnotice: (n) => {
    /* Surface RAISE NOTICE, which is how the verification blocks report. */
    if (n.message) console.log(`  ${n.message}`);
  },
});

try {
  /* `.simple()` is required: a file holds many statements, and the extended
     query protocol permits exactly one per message. The migration must contain
     no BEGIN/COMMIT of its own — sql.begin() owns the transaction. */
  await sql.begin((tx) => tx.unsafe(sqlText).simple());
  console.log(`\x1b[32m✓\x1b[0m ${basename(file)} applied.\n`);
  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\x1b[31m✗\x1b[0m ${basename(file)} FAILED — nothing was committed.`);
  console.error(`  ${redact(err?.message ?? err)}`);
  if (err?.position) console.error(`  at character ${err.position}`);
  if (err?.detail) console.error(`  detail: ${redact(err.detail)}`);
  if (err?.hint) console.error(`  hint: ${redact(err.hint)}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
