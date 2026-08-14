/* ============================================================================
 * A BROWSER SESSION FOR A DEMO ACCOUNT — for looking at a page while building it
 * ----------------------------------------------------------------------------
 * `npm run demo:session [emailPrefix] [hours]`
 *
 * Prints a `cni_session` cookie value for a seeded `@cni-demo.com` account so a
 * screen can be opened and looked at. It exists because the alternative is worse:
 * verifying a redesign against `curl` output, or asking the owner to hand over a
 * password. This mints a session row directly, the same way `scripts/smoke.mjs`
 * already does, and no password is involved at any point.
 *
 * ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────────
 * Refuses any address outside `@cni-demo.com`. A tool that can mint a session for
 * a real person's account is a tool that can impersonate them, and there is no
 * development convenience worth that. The domain check is the whole safety
 * property, so it is the first thing the script does.
 *
 * Sessions are short-lived (one hour by default, four at most) and each one is a
 * real row, so it shows up in Security → Sessions and can be revoked from there
 * like any other.
 *
 * The signing mirrors lib/auth/session.ts. A cookie built differently from the way
 * the application reads it would fail for a reason unrelated to whatever is being
 * looked at.
 * ========================================================================= */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const DOMAIN = 'cni-demo.com';
const prefix = process.argv[2] ?? 'sana'; // the seeded Admin — see scripts/smoke.mjs
const hours = Math.min(4, Math.max(1, Number(process.argv[3] ?? 1)));

const email = prefix.includes('@') ? prefix : `${prefix}@${DOMAIN}`;
if (!email.endsWith(`@${DOMAIN}`)) {
  console.error(`✗ Refused. This only issues sessions for @${DOMAIN} accounts.`);
  console.error('  A real person\'s session is not a development convenience.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
for (const key of ['DATABASE_URL', 'SESSION_SECRET']) {
  if (!env[key]) {
    console.error(`✗ ${key} is not set in .env.local`);
    process.exit(1);
  }
}

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

try {
  const rows = await sql`
    select id, full_name, role from public.users
     where email = ${email} and is_active
  `;
  if (!rows[0]) {
    console.error(`✗ No active ${email}. Run npm run seed:demo.`);
    process.exit(1);
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const signature = createHmac('sha256', env.SESSION_SECRET).update(token, 'utf8').digest('base64url');

  const [session] = await sql`
    insert into public.sessions
      (user_id, refresh_token_hash, device_fingerprint, expires_at, absolute_expires_at, user_agent)
    values (
      ${rows[0].id}, ${hash}, 'demo-session-script',
      now() + (${hours} || ' hours')::interval,
      now() + (${hours} || ' hours')::interval,
      'cni-demo-session/1.0'
    )
    returning id
  `;

  console.log(`${rows[0].full_name} · ${rows[0].role} · ${email}`);
  console.log(`session ${session.id}, valid ${hours}h`);
  console.log('');
  console.log(`cni_session=${token}.${signature}`);
} finally {
  await sql.end();
}
