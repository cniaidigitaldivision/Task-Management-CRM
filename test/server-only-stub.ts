/* ============================================================================
 * `server-only` stub, for the test runner only
 * ----------------------------------------------------------------------------
 * `server-only` is a guard rather than a library: its entry point throws, so
 * that importing a server module from a Client Component fails the BUILD
 * instead of leaking a connection string into the browser bundle.
 *
 * Vitest resolves that throwing entry, so every test touching lib/auth/ or
 * lib/db/ dies before it starts. vitest.config.mts aliases the package to this
 * file, which does nothing.
 *
 * The guard is untouched where it matters — `next build` still resolves the real
 * package and still refuses a bad import. This only stops it shouting at a test
 * runner that has no client/server boundary to protect.
 *
 * Aliased here rather than at `server-only/empty` (not an exported subpath) or
 * via Vite's `react-server` condition (which would change how React itself
 * resolves, for one small guard).
 * ========================================================================= */

export {};
