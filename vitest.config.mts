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
 * ── ⚠️ `components/**` IS INCLUDED, AND IT STILL NEEDS NO jsdom ────────────
 * Added 2026-09-10 for the CRM lead desk. A component test here renders with
 * `renderToStaticMarkup` and asserts on the HTML STRING — no DOM, no jsdom, no
 * environment change, and it stays in the same millisecond budget as the rest.
 *
 * What it is for: the desk decides what a person READS — a phone formatted for
 * a human, an age counted from when they enquired, "Unassigned" rather than a
 * blank, and a `tel:` link that is never built from a number we could not parse.
 * Those are decisions, and a decision that only exists inside JSX is one nothing
 * can hold still.
 *
 * ⚠️ It is NOT a substitute for looking at the page. Layout, contrast and theme
 * are settled in a browser against the real stylesheet; a string renderer cannot
 * see them. Both were done for the desk — the strip's empty chips came back at
 * 2.42:1 and had to be changed.
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
    include: ['{lib,components}/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    reporters: 'dot',
  },
});
