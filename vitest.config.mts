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
  test: {
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    reporters: 'dot',
  },
});
