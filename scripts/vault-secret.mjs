#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — PUT A SECRET FROM .env.local INTO SUPABASE VAULT
 * ----------------------------------------------------------------------------
 *     node scripts/vault-secret.mjs CRON_SECRET
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `pg_cron` calls `/api/meta-sync` every two hours (migration 102) and has to
 * authenticate. The token cannot live in the migration — a credential committed
 * to git stays in the history for good, and a later commit removing it changes
 * nothing — so it lives in Supabase Vault and the job reads it at call time.
 *
 * Getting it there by hand means pasting a live token into a SQL editor, which
 * leaves it in the editor's query history and on a clipboard. This moves it from
 * the file that already holds it straight into the vault, and nothing in between
 * ever sees it.
 *
 * ── ⚠️ IT NEVER PRINTS THE VALUE, ON ANY PATH ────────────────────────────────
 * Not on success, not in an error, not in a diagnostic. postgres.js echoes the
 * connection URL when it cannot parse one, and that URL contains the database
 * password — so every error here goes through `redact()`, the same guard
 * `scripts/migrate.mjs` uses. The output is safe to paste into a chat.
 *
 * ── ⚠️ IDEMPOTENT, BECAUSE THE FIRST ATTEMPT MAY HAVE HALF-WORKED ────────────
 * `vault.create_secret` refuses a duplicate name. Re-running after a typo would
 * otherwise fail with a unique-violation and leave the wrong value in place, so
 * an existing entry is UPDATED. Running this twice is safe and is the correct
 * way to rotate.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

/** Never print a secret, even partially — a prefix still narrows a search. */
function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):(.*)@([^@\s/]+)/g, '://$1:••••••••@$3');
}

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error('✗ .env.local not found. Run this from the project root.');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    /* Strip surrounding quotes. A quoted value would be stored WITH the quotes
       and the bearer comparison would fail on a token that looks correct. */
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const name = process.argv[2];
if (!name || !/^[A-Z0-9_]+$/.test(name)) {
  console.error('Usage: node scripts/vault-secret.mjs <ENV_VAR_NAME>');
  console.error('   eg: node scripts/vault-secret.mjs CRON_SECRET');
  process.exit(1);
}

const env = readEnvLocal();
const value = env[name];

if (!value) {
  console.error(`✗ ${name} is not set in .env.local, so there is nothing to store.`);
  process.exit(1);
}

/* ⚠️ THE MIGRATION CONNECTION, NOT THE APP'S. Writing to the vault needs the
   owning role; `cni_app` has no business touching it. Same connection
   scripts/migrate.mjs uses. */
const url = env.DIRECT_DATABASE_URL || env.DATABASE_URL;
if (!url) {
  console.error('✗ Neither DIRECT_DATABASE_URL nor DATABASE_URL is set in .env.local.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [existing] = await sql`
    select id from vault.secrets where name = ${name} limit 1
  `;

  if (existing) {
    await sql`select vault.update_secret(${existing.id}::uuid, ${value}, ${name}, null)`;
    console.log(`✓ ${name} updated in Supabase Vault.`);
  } else {
    await sql`
      select vault.create_secret(
        ${value},
        ${name},
        ${'Read by app.trigger_meta_sync() — see migration 102.'}
      )
    `;
    console.log(`✓ ${name} created in Supabase Vault.`);
  }

  /* Read back through the same view the cron job uses, and compare LENGTHS
     rather than values — enough to prove the round trip worked, without either
     end printing the secret. */
  const [check] = await sql`
    select length(decrypted_secret) as len
      from vault.decrypted_secrets where name = ${name} limit 1
  `;

  if (!check) {
    console.error('✗ Stored, but not readable back through vault.decrypted_secrets.');
    process.exit(1);
  }
  if (Number(check.len) !== value.length) {
    console.error(
      `✗ Stored ${check.len} characters but .env.local holds ${value.length}. Not a match — check for stray quotes or whitespace.`,
    );
    process.exit(1);
  }

  console.log(`✓ Verified: ${check.len} characters, readable by the cron job.`);
} catch (error) {
  console.error(`✗ Failed: ${redact(error?.message ?? error)}`);
  process.exit(1);
} finally {
  await sql.end();
}
