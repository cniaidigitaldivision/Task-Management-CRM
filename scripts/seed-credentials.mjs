/* ============================================================================
 * SAMPLE CREDENTIALS, FOR LOOKING AT THE ACCESS TAB
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"I want data to add some random credentials in the GC Royal
 * project, added by admin: me, Habiba… add 3 or 4 dummy credentials… 2 or 3 with
 * multiple directions, like some with Facebook, some with Gmail, and some like
 * this one. It would be easy for me to look at."*
 *
 * ── ⚠️ THE PASSWORDS ARE FAKE AND MUST STAY FAKE ─────────────────────────────
 * Every secret below is an obvious placeholder with `demo` in it. This script
 * exists so the vault has something to LOOK at — five brands, five icons, a mix of
 * projects and notes — and a plausible-looking real password in seed data is how a
 * placeholder ends up being trusted as a live login.
 *
 * ── WHY A SCRIPT AND NOT SQL ────────────────────────────────────────────────
 * `credentials_secret_is_sealed` makes "the secret is encrypted" a property of the
 * table, so a plain INSERT cannot put a password in. Sealing happens in the
 * application (`lib/auth/secret-box.ts`), and that is deliberate: there is no path
 * from anywhere to that column that could carry plaintext.
 *
 * ⚠️ `seal` IS RE-IMPLEMENTED HERE, NOT IMPORTED. `secret-box.ts` is TypeScript and
 * carries `server-only`; a .mjs script cannot import either. So the format is
 * reproduced exactly — v1, AES-256-GCM, `v1.iv.tag.ciphertext` in base64url — and
 * `assertReadable` below decrypts what it wrote before committing anything. If the
 * two implementations ever diverge, this script fails rather than filling the vault
 * with rows nothing can open.
 *
 * ── SAFE TO RUN TWICE ───────────────────────────────────────────────────────
 * Each row is matched on (project, label) and skipped when it already exists, so
 * this neither duplicates nor overwrites. It also never touches a credential it did
 * not create.
 *
 *   node scripts/seed-credentials.mjs            # add them
 *   node scripts/seed-credentials.mjs --remove   # take them back out
 * ========================================================================= */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

/* ---- .env.local ----------------------------------------------------------
 * ⚠️ SPLIT ON `/\r?\n/`, NOT `'\n'`. This file has CRLF line endings — it is a
 * Windows machine — and splitting on the newline alone leaves a `\r` on every
 * value. That found TWO keys out of seventeen and reported "DATABASE_URL is not
 * set" for a file that plainly sets it.
 *
 * Copied verbatim from `scripts/migrate.mjs`, which had already solved this. The
 * quote-stripping matters for the same reason its comment says: a quoted URL fed
 * to postgres.js fails to parse and the error message contains the password.
 * ------------------------------------------------------------------------- */
function readEnvLocal() {
  const env = {};
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    console.error('✗ .env.local not found.');
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnvLocal();
const remove = process.argv.includes('--remove');

if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}
if (!env.MFA_ENCRYPTION_KEY) {
  console.error('✗ MFA_ENCRYPTION_KEY is not set in .env.local — secrets cannot be sealed.');
  process.exit(1);
}

const KEY = Buffer.from(env.MFA_ENCRYPTION_KEY.trim(), 'base64');
if (KEY.length !== 32) {
  console.error(`✗ MFA_ENCRYPTION_KEY must decode to 32 bytes; got ${KEY.length}.`);
  process.exit(1);
}

/** The exact format `lib/auth/secret-box.ts` writes. */
function seal(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** ⚠️ Proves the sealed value is readable before it is stored. Without this, a
 *  divergence from the app's format would be discovered by somebody pressing
 *  Reveal on a client's login and getting a decryption error. */
function assertReadable(sealed, expected) {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1') throw new Error(`sealed with the wrong version: ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const out =
    decipher.update(Buffer.from(body, 'base64url'), undefined, 'utf8') + decipher.final('utf8');
  if (out !== expected) throw new Error('a sealed secret did not decrypt to what went in');
}

/* ============================================================================
 * THE ROWS
 * ----------------------------------------------------------------------------
 * Five brands so the Access list shows five different logos, and `service` is set
 * explicitly on each — which is the point of migration 051 and means none of these
 * depends on the URL being guessable.
 * ========================================================================= */
const ROWS = [
  {
    label: 'Gmail — client mailbox',
    kind: 'email',
    service: 'gmail',
    url: 'https://mail.google.com/mail/u/0',
    username: 'gcroyal.official@gmail.com',
    secret: 'demo-not-a-real-password-1',
    notes:
      'Primary mailbox for client correspondence.\nDemo data — this is not a working password.',
  },
  {
    label: 'Facebook Page — GC Royal',
    kind: 'social',
    service: 'facebook',
    url: 'https://facebook.com/gcroyalemporium',
    username: 'social@gcroyal.com',
    secret: 'demo-not-a-real-password-2',
    notes: 'Page login for scheduling and comment replies.\nDemo data.',
  },
  {
    label: 'Instagram — GC Royal',
    kind: 'social',
    service: 'instagram',
    url: 'https://instagram.com/gcroyalemporium',
    username: 'gcroyal.social',
    secret: 'demo-not-a-real-password-3',
    notes: 'Reels and stories. Two-factor is on the studio phone.\nDemo data.',
  },
  {
    label: 'Meta Business Suite',
    kind: 'advertising',
    service: 'meta',
    url: 'https://business.facebook.com/latest/home',
    username: 'ads@gcroyal.com',
    secret: 'demo-not-a-real-password-4',
    notes: 'Ad account and page roles live here.\nDemo data.',
  },
  {
    label: 'Hosting / cPanel',
    kind: 'hosting',
    service: 'cpanel',
    url: 'https://gcroyal.com/cpanel',
    username: 'gcroyal',
    /* ⚠️ Deliberately no secret. It exercises the "no password stored" state —
       the dashed lock well on the list and "None stored" in the panel — which is
       a real state the owner has not seen yet. */
    secret: '',
    notes: 'Renewal is annual in March. Password held by the hosting reseller.',
  },
  {
    label: 'WordPress Admin',
    kind: 'hosting',
    service: 'wordpress',
    url: 'https://gcroyal.com/wp-admin',
    username: 'gcroyal-admin',
    secret: 'demo-not-a-real-password-5',
    notes: 'Website admin. Plugin updates on the first of the month.\nDemo data.',
  },
];

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
});

try {
  /* The project and the author, both looked up by name rather than hard-coded:
     an id pasted into a script is an id that is wrong on the next database. */
  const [project] = await sql`
    select id, name from public.projects where name ilike ${'%GC Royal%'} limit 1
  `;
  if (!project) throw new Error('No project matching "GC Royal" — nothing to attach these to.');

  const [author] = await sql`
    select id, full_name, role from public.users
     where role in ('admin', 'super_admin') and is_active
       and full_name ilike ${'%Habiba%'}
     limit 1
  `;
  if (!author) throw new Error('No active admin matching "Habiba" to record as the author.');

  console.log(`\nProject: ${project.name}`);
  console.log(`Author:  ${author.full_name} (${author.role})\n`);

  if (remove) {
    const gone = await sql`
      delete from public.credentials
       where project_id = ${project.id}
         and label in ${sql(ROWS.map((r) => r.label))}
      returning label
    `;
    console.log(gone.length ? `Removed ${gone.length}:` : 'Nothing to remove.');
    for (const row of gone) console.log(`  − ${row.label}`);
  } else {
    let added = 0;
    for (const row of ROWS) {
      const [existing] = await sql`
        select id from public.credentials
         where project_id = ${project.id} and label = ${row.label} limit 1
      `;
      if (existing) {
        console.log(`  = ${row.label} (already there, left alone)`);
        continue;
      }

      const sealed = row.secret ? seal(row.secret) : '';
      if (sealed) assertReadable(sealed, row.secret);

      await sql`
        insert into public.credentials
          (label, kind, project_id, issued_to_id, username, secret_encrypted,
           url, service, notes, created_by_id, updated_by_id)
        values
          (${row.label}, ${row.kind}, ${project.id}, null,
           ${row.username}, ${sealed}, ${row.url}, ${row.service}, ${row.notes},
           ${author.id}, ${author.id})
      `;
      console.log(`  + ${row.label}  [${row.service}]${sealed ? '' : '  (no password)'}`);
      added += 1;
    }
    console.log(`\n${added} added.`);
  }

  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
