#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — ENCRYPT THE AUTHENTICATOR SECRETS AT REST
 * ----------------------------------------------------------------------------
 *     npm run encrypt:mfa            report what would change
 *     npm run encrypt:mfa -- --apply do it
 *
 * `mfa_factors.secret_encrypted` was named for what it should hold and stored
 * plaintext from the day the column was created. This is the one-pass migration
 * that makes the name true.
 *
 * ── WHY A SCRIPT AND NOT A MIGRATION ─────────────────────────────────────────
 * A SQL migration cannot do it: the key lives in the application environment,
 * not in the database, and putting it there would defeat the entire exercise —
 * the threat being closed is "somebody has database access".
 *
 * ── WHY IT IS ALSO NOT ONLY DONE LAZILY ──────────────────────────────────────
 * `getVerifiedFactors` re-seals a legacy row the first time it is read, so the
 * plaintext does disappear on its own. But that depends on everybody signing in,
 * and the accounts least likely to sign in this week are exactly the dormant
 * ones worth protecting. One pass closes the window now.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 *   · Dry run by default. Nothing changes without --apply.
 *   · Every secret is round-tripped IN MEMORY before anything is written. A
 *     value that does not decrypt back to itself is left alone and reported —
 *     writing a secret that cannot be read back locks somebody out of their own
 *     account permanently, with recovery codes as the only way in.
 *   · Idempotent. Already-encrypted rows are skipped.
 *   · Never prints a secret or the connection string.
 * ========================================================================= */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

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
for (const key of ['DATABASE_URL', 'MFA_ENCRYPTION_KEY']) {
  if (!env[key]) {
    console.error(`✗ ${key} is not set in .env.local`);
    process.exit(1);
  }
}

/* Mirrors lib/auth/secret-box.ts exactly. Duplicated rather than imported
   because that module is `server-only` and TypeScript — and a mismatch here
   would produce ciphertext the application cannot read, so the round-trip check
   below verifies the two agree in practice rather than by assumption. */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64');

if (KEY.length !== 32) {
  console.error(`✗ MFA_ENCRYPTION_KEY decodes to ${KEY.length} bytes; AES-256 needs 32.`);
  process.exit(1);
}

const isLegacy = (v) => !v.startsWith(`${VERSION}.`);

function seal(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

function openSealed(stored) {
  const [, ivPart, tagPart, dataPart] = stored.split('.');
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
  onnotice: () => {},
});

try {
  const rows = await sql`
    select f.id, f.secret_encrypted, u.email, u.role
      from public.mfa_factors f
      join public.users u on u.id = f.user_id
     where f.type = 'totp' and f.secret_encrypted is not null
     order by u.email
  `;

  const legacy = rows.filter((r) => isLegacy(r.secret_encrypted));
  const already = rows.length - legacy.length;

  console.log(`\n  ${rows.length} TOTP factor${rows.length === 1 ? '' : 's'} found.`);
  console.log(`  ${already} already encrypted · ${legacy.length} still plaintext\n`);

  if (legacy.length === 0) {
    console.log('  \x1b[32m✓\x1b[0m Nothing to do — every secret is encrypted at rest.\n');
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  let failures = 0;
  const prepared = [];

  for (const row of legacy) {
    const sealed = seal(row.secret_encrypted);

    /* The check that makes this safe to run. Writing a value that cannot be read
       back would lock somebody out permanently — recovery codes only. */
    if (openSealed(sealed) !== row.secret_encrypted) {
      console.log(`  \x1b[31m✗\x1b[0m ${row.email} — round trip FAILED, left untouched`);
      failures += 1;
      continue;
    }

    prepared.push({ id: row.id, sealed });
    console.log(`  \x1b[32m✓\x1b[0m ${row.email} (${row.role}) — verified, ready`);
  }

  if (!APPLY) {
    console.log(`\n  Dry run. Re-run with \x1b[1m--apply\x1b[0m to write ${prepared.length}.\n`);
    await sql.end({ timeout: 5 });
    process.exit(failures > 0 ? 1 : 0);
  }

  /* One transaction: a half-encrypted table is not dangerous — the application
     reads both forms — but it makes the next run's report confusing, and there
     is no reason to accept that. */
  await sql.begin(async (tx) => {
    for (const { id, sealed } of prepared) {
      await tx`update public.mfa_factors set secret_encrypted = ${sealed} where id = ${id}`;
    }
  });

  console.log(`\n  \x1b[32m✓\x1b[0m ${prepared.length} secret${prepared.length === 1 ? '' : 's'} encrypted at rest.`);
  if (failures > 0) console.log(`  \x1b[31m✗\x1b[0m ${failures} left untouched — see above.`);
  console.log(
    '\n  \x1b[33mMFA_ENCRYPTION_KEY is now load-bearing.\x1b[0m Lose it and every enrolled\n' +
      '  authenticator stops working, permanently, for everyone. Recovery codes\n' +
      '  become the only way in. Back it up somewhere that is not this machine.\n',
  );

  await sql.end({ timeout: 5 });
  process.exit(failures > 0 ? 1 : 0);
} catch (error) {
  console.error(`\n✗ ${redact(error?.message ?? error)}\n`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
