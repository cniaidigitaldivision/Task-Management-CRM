import 'server-only';

import postgres from 'postgres';

/* ============================================================================
 * DATABASE CLIENT — LAYER 1
 * ----------------------------------------------------------------------------
 * The only module that opens a connection. Everything else goes through
 * `withUser` or `withAppRole`; nothing imports `sql` directly except
 * lib/db/queries/.
 *
 * `server-only` is the first import on purpose: it makes importing this file
 * from a Client Component a BUILD error rather than a runtime surprise. A
 * connection string reaching the browser bundle is the kind of mistake that is
 * obvious in hindsight and invisible in review.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ REGISTRY C-18 — THE POOLER DROPS THE URL ROLE OPTION
 *
 * Registry C-14 said the app would adopt `cni_app` through the connection
 * string: `?options=-c role=cni_app`. Measured against the real database, that
 * is silently ignored — Supabase's pooler (Supavisor) does not forward libpq
 * startup options. The session stays `postgres`, which has BYPASSRLS, so every
 * policy in migration 005 is skipped and nothing looks wrong.
 *
 * That was found by `npm run check:db`, not by reading documentation, and it is
 * the exact failure the checker was written to catch.
 *
 * The role is therefore taken PER TRANSACTION with `SET LOCAL ROLE`. That is
 * not a workaround — behind a transaction-mode pooler it is the only correct
 * mechanism. A session-level `SET ROLE` would persist on the backend after the
 * transaction ends and leak to whichever request reused that connection next,
 * which is worse than the problem it solves.
 * ========================================================================= */

const connectionString = process.env.DATABASE_URL;

/* ── WHY THIS NO LONGER THROWS WHEN THE MODULE LOADS ──────────────────────────
 * It used to, on the reasoning that a misconfigured deployment should fail at
 * startup rather than on its first query. Correct at runtime — and wrong during
 * a BUILD, which is not a deployment and has no business holding production
 * database credentials.
 *
 * `next build` evaluates this module while collecting page data, so the throw
 * made the build itself require a live connection string. Deploying to Vercel
 * before adding the environment variables therefore failed with
 * "Failed to collect configuration for /security" — a message that says nothing
 * about the actual cause. Verified by building with .env.local moved aside.
 *
 * So the check moved to the three entry points below. Nothing can reach the
 * database without passing through one of them, the error is still immediate
 * and still says exactly what to do, and a build no longer needs a secret it
 * should never have needed.
 *
 * The placeholder is a syntactically valid URL that resolves to nothing.
 * postgres.js does not connect until a query is issued, so during a build it is
 * never dialled — and if it somehow were, `assertConfigured()` has already
 * thrown the readable error first. */
const MISSING_URL_MESSAGE =
  'DATABASE_URL is not set. Locally: copy .env.example to .env.local, fill it in, ' +
  'and run `npm run check:db`. On Vercel: add it under Project Settings → ' +
  'Environment Variables, then redeploy.';

function assertConfigured(): void {
  if (!connectionString) throw new Error(MISSING_URL_MESSAGE);
}

export const sql = postgres(connectionString ?? 'postgres://localhost:5432/unconfigured', {
  /* ── POOL SIZE IS SMALLER IN PRODUCTION, NOT LARGER ────────────────────────
     Counter-intuitive until you count what is actually running. On a laptop
     there is one Node process, so 10 connections is 10 connections. On Vercel
     there are as many function instances as there is traffic, and EACH one keeps
     its own pool — so `max: 10` across eight warm instances is eighty client
     connections against a pooler that permits a few hundred for the whole
     project, shared with migrations, the SQL editor and every other tool.

     Exhausting it does not fail cleanly either: new requests queue on connect
     and time out, which reads as "the site is slow" rather than "the pool is
     full". Three per instance is ample for a seven-person team, and the pooler's
     own job is to multiplex them onto far fewer real backends. */
  max: process.env.NODE_ENV === 'production' ? 3 : 10,

  /* Shorter in production for the same reason: an idle serverless instance
     should give its connection back rather than sit on it until it is frozen. */
  idle_timeout: process.env.NODE_ENV === 'production' ? 10 : 20,
  connect_timeout: 15,

  /* Required behind a transaction-mode pooler. Named prepared statements live
     on a backend connection, and transaction mode hands you a different one
     each time — so a statement prepared on connection A is missing when the
     next query lands on connection B. postgres.js prepares by default, so this
     must be off or queries fail intermittently under load, which is the worst
     way for a bug like this to present. */
  prepare: false,

  transform: { undefined: null },
  onnotice: () => {},
});

/* ==========================================================================
 * THE IDENTITY CONTRACT (registry C-14)
 * ========================================================================== */

/**
 * The transaction handle passed to every callback below.
 *
 * Taken from postgres.js's own exported type rather than inferred from
 * `sql.begin` — that method is overloaded (the first argument can be an
 * isolation level *or* the callback), so inference picks the wrong overload
 * and collapses the callback parameter to `never`.
 */
export type Tx = postgres.TransactionSql<Record<string, never>>;

/* ==========================================================================
 * TRANSIENT FAILURES
 * ==========================================================================
 * A page crashed with `getaddrinfo ENOTFOUND aws-0-ap-southeast-1.pooler…`
 * while the hostname was perfectly resolvable a second either side of it. A
 * momentary DNS or socket failure between the app and the pooler is not a bug in
 * either — it is what networks do — and there is no reason for it to become a
 * failed page when trying again immediately almost always succeeds.
 *
 * ── WHAT IS RETRIED, AND WHAT DELIBERATELY IS NOT ────────────────────────────
 * ONLY failures that happened *reaching* the database: DNS lookup, refused or
 * reset connection, timeout, a connection closed under us. Those are safe to
 * repeat because the transaction never started, so nothing can be applied twice.
 *
 * A query that reached Postgres and was rejected — a constraint violation, an
 * RLS refusal, a permission error — is NOT retried. It would fail identically
 * every time, and retrying it would turn a clear "this is not allowed" into a
 * slow one. Every such error carries a SQLSTATE `code`; the absence of one is
 * what identifies a connection-level failure.
 *
 * Two attempts, ~250ms apart. Enough to ride out a blip; short enough that a
 * genuine outage still fails while somebody is waiting rather than after
 * several seconds of silence.
 * ========================================================================== */

const TRANSIENT_CODES = new Set([
  'ENOTFOUND', // DNS did not resolve — the case that prompted this
  'EAI_AGAIN', // DNS timed out
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'CONNECTION_CLOSED', // postgres.js: the socket went away mid-flight
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
]);

function isTransient(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;

  /* A SQLSTATE is five characters and means Postgres answered. Those are real
     answers — a constraint, a policy, a permission — and must not be retried. */
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return false;

  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTransient(error)) throw error;

    await new Promise((resolve) => setTimeout(resolve, 250));
    return run();
  }
}

/**
 * Run queries as `cni_app` **as a specific user**. This is how nearly all
 * application code should reach the database.
 *
 *     const tasks = await withUser(session.userId, (tx) =>
 *       tx`select * from tasks`
 *     )
 *
 * Two settings, both `SET LOCAL`, so both die with the transaction and cannot
 * leak across a pooled connection:
 *
 *   role         → cni_app, which does NOT bypass row-level security
 *   app.user_id  → read by app.current_user_id(), which every policy keys off
 *
 * Forget either and the query returns nothing rather than everything: with no
 * `app.user_id`, `app.current_user_id()` is NULL and every policy predicate is
 * false. Fail-closed by construction, verified by `npm run check:db`.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) {
    // An empty id would set app.user_id to '' — which current_user_id() maps to
    // NULL, so it would fail closed anyway. Refusing loudly is better than
    // silently returning nothing and looking like missing data.
    throw new Error('withUser requires a user id. Use withAppRole for pre-auth work.');
  }
  assertConfigured();

  return withRetry(
    () =>
      sql.begin(async (tx) => {
        await tx`select set_config('role', 'cni_app', true)`;
        await tx`select set_config('app.user_id', ${userId}, true)`;
        return fn(tx);
      }) as Promise<T>,
  );
}

/**
 * Run as `cni_app` with **no identity**, for the pre-authentication surface
 * (registry C-15) — sign-in, token redemption, recording attempts.
 *
 * Row-level security still applies and still fails closed; these paths work
 * because they call the `app.auth_*` SECURITY DEFINER functions, which are the
 * small, individually reviewed set allowed to see across it.
 *
 * ⚠️ Do not reach for this to "get around" a policy. If a query needs data the
 * acting user cannot see, that is a permission question — answer it in
 * lib/domain/permissions.ts, not by dropping the identity.
 */
export async function withAppRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertConfigured();
  return withRetry(
    () =>
      sql.begin(async (tx) => {
        await tx`select set_config('role', 'cni_app', true)`;
        return fn(tx);
      }) as Promise<T>,
  );
}

/**
 * Break-glass (doc 16 §6). Requires an explicit, greppable call — there is no
 * way to reach it by accident. Every trigger that honours it writes a
 * `critical` security event that commits.
 *
 * Nothing in the application calls this. It exists so a genuine disaster has a
 * documented path, rather than "immutable" quietly meaning "unrecoverable".
 */
export async function withBreakGlass<T>(reason: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!reason || reason.trim().length < 20) {
    throw new Error('Break-glass requires a written reason of at least 20 characters.');
  }
  assertConfigured();

  return sql.begin(async (tx) => {
    await tx`select set_config('app.break_glass', 'on', true)`;
    return fn(tx);
  }) as Promise<T>;
}
