#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — PRINT THE CURRENT TWO-FACTOR CODE
 * ----------------------------------------------------------------------------
 *     npm run demo:code                        every account that has a factor
 *     npm run demo:code -- sana@cni-demo.com
 *     npm run demo:code -- --enrol sana@cni-demo.com   re-enrol a lost factor
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
 * ── ⚠️ THIS NOW REQUIRES THE ENCRYPTION KEY, NOT JUST THE DATABASE ───────────
 * The plan said this script would be DELETED once secrets were encrypted, on the
 * reasoning that it only worked because of the plaintext gap. That turned out to
 * be half right, and the distinction is worth stating rather than acting on the
 * original note.
 *
 * Encryption changed who can do this. Before: anybody holding the database.
 * After: anybody holding the database AND MFA_ENCRYPTION_KEY — which lives in
 * the application environment and never in Postgres, so a database dump alone is
 * now worthless. That is the whole threat this closed.
 *
 * A local script reading .env.local has both, and always will. Keeping it is
 * therefore not a hole; it is a developer on their own machine using their own
 * key. It stays because a demo where the Admin cannot sign in is worse than a
 * script that needs two secrets to run.
 *
 * It has no place anywhere but a development machine.
 * ========================================================================= */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
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

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

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

const args = process.argv.slice(2);
const wanted = args.find((a) => a.includes('@'));
/* ── --enrol ─────────────────────────────────────────────────────────────────
   Restores a demo account that has lost its authenticator. Needed because a
   test once reset the seeded Admin's own factor — permitted by FR-146's
   self-exception, and it left the account unsignable-in with no way back short
   of re-seeding the whole division and losing the data with it. */
const enrolling = args.includes('--enrol');
const env = readEnvLocal();
for (const key of ['DATABASE_URL', 'MFA_ENCRYPTION_KEY']) {
  if (!env[key]) {
    console.error(`✗ ${key} is not set in .env.local`);
    process.exit(1);
  }
}

/* Mirrors lib/auth/secret-box.ts. A stored value without the version prefix
   predates encryption and is still plaintext. */
const MFA_KEY = Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64');

function sealSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MFA_KEY, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

function openSecret(stored) {
  if (!stored.startsWith('v1.')) return stored;
  const [, ivPart, tagPart, dataPart] = stored.split('.');
  const decipher = createDecipheriv('aes-256-gcm', MFA_KEY, Buffer.from(ivPart, 'base64url'));
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
  if (enrolling) {
    if (!wanted) {
      console.error('✗ Which account? npm run demo:code -- --enrol sana@cni-demo.com');
      process.exit(1);
    }

    const who = await sql`select id, role from public.users where email = ${wanted}`;
    if (!who[0]) {
      console.error(`✗ No account for ${wanted}.`);
      process.exit(1);
    }

    const secret = base32Encode(randomBytes(20));
    await sql.begin(async (tx) => {
      await tx`delete from public.mfa_factors where user_id = ${who[0].id} and type = 'totp'`;
      await tx`
        insert into public.mfa_factors
          (user_id, type, secret_encrypted, friendly_name, is_primary, verified_at)
        values (${who[0].id}, 'totp', ${sealSecret(secret)}, 'Demo authenticator', true, now())
      `;
    });

    console.log(`
  [32m✓[0m Fresh authenticator enrolled for ${wanted} (${who[0].role}).`);
    console.log(`    setup key:  ${secret}`);
    console.log(`    code now:   [1m${totpAt(secret, Date.now())}[0m`);
    console.log(`    Any previous authenticator for this account no longer works.
`);

    await sql.end({ timeout: 5 });
    process.exit(0);
  }

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
    const secret = openSecret(row.secret);
    console.log(`  ${row.email}  (${row.role})`);
    console.log(`    code:  \x1b[1m${totpAt(secret, now)}\x1b[0m`);
    /* The next code too, because typing a six-digit code with four seconds left
       fails and looks like the code was wrong. */
    if (secondsLeft <= 8) {
      console.log(`    next:  ${totpAt(secret, now + 30_000)}  (use this one)`);
    }
    console.log(`    setup key for an authenticator app:  ${secret}`);
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
