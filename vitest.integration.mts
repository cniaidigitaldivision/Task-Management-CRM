import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/* ============================================================================
 * INTEGRATION TESTS — these talk to the REAL database
 * ----------------------------------------------------------------------------
 * Kept in a separate config, and out of `npm run test`, for one reason: the unit
 * suite must stay runnable with no network, no credentials and no shared state.
 * The moment a database is required to run `npm run test`, the tests stop being
 * run — on a laptop without .env.local, in CI without a secret, by anyone
 * checking out the repo for the first time.
 *
 *     npm run test        640 pure domain tests, no I/O
 *     npm run test:auth   this file, needs .env.local
 *
 * Single-threaded and single-file: these share one database, and two suites
 * creating fixtures concurrently would interfere.
 * ========================================================================= */

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Argon2 at m=64MiB t=3 costs ~100ms a call and this suite makes several.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: 'verbose',
  },
});
