import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/* ============================================================================
 * VITEST — domain unit tests only
 * ----------------------------------------------------------------------------
 * `lib/domain/` is pure by contract (doc 20 §1): no database, no framework, no
 * React, no clock, no randomness. So these tests need no jsdom, no test
 * database and no server — which is exactly why the architecture insists the
 * intelligence lives there. They run in milliseconds and can be exhaustive.
 *
 * `.next` is excluded explicitly: Vitest's default exclude list does not cover
 * it, and the build output contains copies of source files that would
 * otherwise be collected and run twice.
 * ========================================================================= */

export default defineConfig({
  resolve: {
    alias: {
      /* `server-only` is a guard, not a library: its default entry throws so
       * that importing a server module from a Client Component is a build error
       * rather than a leaked secret. Vitest resolves that default entry and
       * every test touching lib/auth/ or lib/db/ fails before it starts.
       *
       * Aliased to a local no-op. Not to `server-only/empty` (not an exported
       * subpath) and not via Vite's `react-server` condition, which would change
       * how React itself resolves for the sake of one small guard.
       *
       * The guard still protects the real build — `next build` resolves the real
       * package and still refuses a bad import. */
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),

      /* `@/…` — the same mapping as tsconfig's `paths` (`{"@/*": ["./*"]}`).
       *
       * Without it, a test could only import modules whose own imports were
       * relative. `tsc` resolved `@/lib/domain/session-policy` happily, so the
       * test typechecked and then failed at run time with "Cannot find package".
       * That quietly put anything under `lib/auth/` and `lib/db/` out of reach —
       * which the note above already assumed was solved. */
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    reporters: 'dot',
  },
});
