#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — PRINT THE CURRENT TWO-FACTOR CODE
 * ----------------------------------------------------------------------------
 *     npm run demo:code                    every account that has a factor
 *     npm run demo:code -- sana@cni-demo.com
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Two-factor is mandatory for Admin and Super Admin (FR-145), and `seed:demo`
 * enrols a real factor so those accounts can actually be signed in as. It prints
 * the secret once — and a secret printed once, in a wall of console output, is a
 * secret you have already lost.
 *
 * This reads the enrolled secret and computes the code that is valid right now,
 * so getting in never depends on having kept that scrollback.
 *
 * ── ⚠️ THIS IS A DEVELOPMENT TOOL, AND IT ONLY WORKS BECAUSE OF A GAP ────────
 * `mfa_factors.secret_encrypted` is named for what it is supposed to hold and
 * currently holds plaintext — key management has not been built (doc 16 §4 wants
 * it encrypted at rest). While that is true, anything with database access can
 * mint codes, which is exactly what this script does.
 *
 * When the secret is genuinely encrypted, this script stops working. That is the
 * point at which it should be deleted rather than given the decryption key.
 * ========================================================================= */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

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

/* RFC 6238, matching lib/auth/totp.ts: SHA-1, 6 digits, 30-second period. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpAt(secret, atMs) {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** 6).padStart(6, '0');
}

const wanted = process.argv.slice(2).find((a) => a.includes('@'));
const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
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
    select u.email, u.role, f.secret_encrypted as secret
      from public.mfa_factors f
      join public.users u on u.id = f.user_id
     where f.type = 'totp'
       and f.secret_encrypted is not null
       and f.verified_at is not null
       and (${wanted ?? null}::text is null or u.email = ${wanted ?? null})
     order by u.email
  `;

  if (rows.length === 0) {
    console.log(
      wanted
        ? `\nNo verified authenticator on ${wanted}.\n`
        : '\nNo account has a verified authenticator yet.\n',
    );
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const now = Date.now();
  const secondsLeft = 30 - Math.floor((now / 1000) % 30);
  const line = '─'.repeat(58);

  console.log(`\n${line}`);
  console.log('  TWO-FACTOR CODES — valid right now');
  console.log(line);

  for (const row of rows) {
    console.log(`  ${row.email}  (${row.role})`);
    console.log(`    code:  \x1b[1m${totpAt(row.secret, now)}\x1b[0m`);
    /* The next code too, because typing a six-digit code with four seconds left
       fails and looks like the code was wrong. */
    if (secondsLeft <= 8) {
      console.log(`    next:  ${totpAt(row.secret, now + 30_000)}  (use this one)`);
    }
    console.log(`    setup key for an authenticator app:  ${row.secret}`);
  }

  console.log(line);
  console.log(`  This code expires in ${secondsLeft}s. Re-run for a fresh one.`);
  console.log(line + '\n');

  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (error) {
  console.error(`\n✗ ${redact(error?.message ?? error)}\n`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
