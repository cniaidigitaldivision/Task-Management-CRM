#!/usr/bin/env node
/* ============================================================================
 * STORAGE CHECK  —  npm run storage:check
 * ----------------------------------------------------------------------------
 * Proves the bucket credential works, end to end, without touching the CRM:
 * uploads a tiny file, signs a link, downloads it back, compares the bytes,
 * and deletes it. Then tells you whether the bucket is private.
 *
 * Run it after adding SUPABASE_STORAGE_KEY. If this passes, attachments work;
 * if it fails, it says which step and why, which is a great deal more useful
 * than "the upload was rejected" appearing in a drawer.
 *
 * ── IT NEVER PRINTS THE KEY ──────────────────────────────────────────────────
 * Not even partially. A key fragment in a terminal is a key fragment in a
 * screenshot, and screenshots travel further than anybody expects.
 * ========================================================================= */

import { readFileSync } from 'node:fs';

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const YELLOW = '[33m';
const OFF = '[0m';

/* .env.local, read by hand. Adding dotenv for one script is a dependency the
   whole project then carries. */
function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* No .env.local — the values may come from the real environment. */
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'CNI-Task Management Docs';
const key = process.env.SUPABASE_STORAGE_KEY ?? '';

function done(passed, message, hint) {
  console.log(`${passed ? GREEN + '✓' : RED + '✗'}${OFF} ${message}`);
  if (hint) console.log(`  ${DIM}${hint}${OFF}`);
  return passed;
}

if (!url || !key) {
  console.log(`\n${RED}✗${OFF} Storage is not configured.\n`);
  if (!url) console.log(`  ${DIM}NEXT_PUBLIC_SUPABASE_URL is missing.${OFF}`);
  if (!key) {
    console.log(`  ${DIM}SUPABASE_STORAGE_KEY is missing.${OFF}`);
    console.log(`\n  Supabase dashboard → Project Settings → API keys → ${YELLOW}secret key${OFF}`);
    console.log(`  ${DIM}Paste it into .env.local and into Vercel. Never into a commit,`);
    console.log(`  a chat message or a screenshot.${OFF}`);
  }
  console.log('');
  process.exit(1);
}

const encodedBucket = encodeURIComponent(bucket);
const path = `_healthcheck/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
const encodedPath = path.split('/').map(encodeURIComponent).join('/');
const payload = `cni-crm storage check ${new Date().toISOString()}`;

const auth = { Authorization: `Bearer ${key}`, apikey: key };

console.log(`\n${DIM}Bucket:${OFF} ${bucket}`);
console.log(`${DIM}Project:${OFF} ${url}\n`);

let allPassed = true;

/* 1 · upload ------------------------------------------------------------- */
const upload = await fetch(`${url}/storage/v1/object/${encodedBucket}/${encodedPath}`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'text/plain', 'x-upsert': 'false' },
  body: payload,
});

if (!upload.ok) {
  const body = await upload.text().catch(() => '');
  allPassed = done(false, `Upload refused (HTTP ${upload.status})`, body.slice(0, 200));

  if (upload.status === 400 && body.includes('mime')) {
    console.log(
      `  ${YELLOW}The bucket's allowed types do not include text/plain.${OFF}\n` +
        `  ${DIM}That is fine for real use — this check just cannot run.${OFF}`,
    );
  }
  if (upload.status === 401 || upload.status === 403) {
    console.log(
      `  ${YELLOW}The key was rejected.${OFF} ${DIM}Make sure it is the SECRET key, not the` +
        ` publishable one — the publishable key cannot write to a private bucket.${OFF}`,
    );
  }
  console.log('');
  process.exit(1);
}
done(true, 'Uploaded a test file');

/* 2 · sign ---------------------------------------------------------------- */
const sign = await fetch(`${url}/storage/v1/object/sign/${encodedBucket}/${encodedPath}`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});

let signedUrl = null;
if (!sign.ok) {
  allPassed = done(false, `Could not sign a link (HTTP ${sign.status})`);
} else {
  const json = await sign.json();
  const relative = json.signedURL ?? json.signedUrl;
  signedUrl = relative?.startsWith('/') ? `${url}/storage/v1${relative}` : relative;
  done(true, 'Signed a one-minute download link');
}

/* 3 · download through the signed link ------------------------------------ */
if (signedUrl) {
  const back = await fetch(signedUrl);
  const text = back.ok ? await back.text() : '';
  allPassed =
    done(
      back.ok && text === payload,
      back.ok ? 'Downloaded it back, bytes match' : `Download failed (HTTP ${back.status})`,
    ) && allPassed;
}

/* 4 · the bucket must be private ------------------------------------------ */
const naked = await fetch(`${url}/storage/v1/object/public/${encodedBucket}/${encodedPath}`);
if (naked.ok) {
  allPassed = done(
    false,
    'THE BUCKET IS PUBLIC — that file was readable with no credentials at all',
    'Supabase dashboard → Storage → the bucket → uncheck "Public bucket".',
  );
} else {
  done(true, `Unsigned access refused (HTTP ${naked.status}) — the bucket is private`);
}

/* 5 · clean up ------------------------------------------------------------ */
const cleanup = await fetch(`${url}/storage/v1/object/${encodedBucket}/${encodedPath}`, {
  method: 'DELETE',
  headers: auth,
});
allPassed =
  done(cleanup.ok, cleanup.ok ? 'Removed the test file' : 'Could not remove the test file') &&
  allPassed;

console.log(
  allPassed
    ? `\n${GREEN}Storage is working.${OFF} Attachments will upload and download.\n`
    : `\n${RED}Something above needs attention.${OFF}\n`,
);
process.exit(allPassed ? 0 : 1);
