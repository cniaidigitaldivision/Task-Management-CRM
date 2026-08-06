import { readFileSync } from 'node:fs';

/* ============================================================================
 * .env.local, FOR THE INTEGRATION SUITE ONLY
 * ----------------------------------------------------------------------------
 * `lib/db/client.ts` reads `process.env.DATABASE_URL` at *module scope* and
 * throws if it is missing — deliberately, so a misconfigured deployment fails at
 * startup rather than on the first query. That means the variable has to exist
 * before the test file's imports are evaluated, which is why this is a
 * `setupFiles` entry and not a call inside a test.
 *
 * Next.js loads .env.local itself; Vitest does not, and adding a dependency to
 * do fifteen lines of parsing is not worth it.
 *
 * `??=`, so a variable already exported in the shell wins. That is what lets CI
 * point the suite at a different database without editing a file.
 * ========================================================================= */

try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    /* A quoted connection string is the specific failure worth guarding: it
       parses as a hostname, and postgres.js prints the URL it was given — with
       the password in it — when it cannot parse one. */
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ??= value;
  }
} catch {
  /* Absent .env.local is not an error here — each suite reports its own skip. */
}
