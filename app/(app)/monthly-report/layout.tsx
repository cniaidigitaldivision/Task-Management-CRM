import { requireRole } from '@/lib/auth/current-user';

/* ============================================================================
 * THE RANK FLOOR FOR THE MONTHLY REPORT
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS IS A TOP-LEVEL SEGMENT AND NOT `/reports/ceo` ─────────────────
 * It was written as `/reports/ceo` first, which was wrong, and measurably so: a
 * Team Coordinator got **HTTP 200** on it instead of a redirect.
 *
 * The cause is the one documented on `requireRole()`. `app/(app)/reports/
 * loading.tsx` puts everything below `reports/layout.tsx` inside a Suspense
 * boundary, and a `redirect()` from inside a boundary cannot be an HTTP 307 —
 * Next.js has already sent the headers, so it is delivered inside the stream. A
 * layout escapes its OWN segment's boundary, which is what makes the pattern work
 * everywhere else; it cannot escape an ANCESTOR'S. Nested one level under
 * `/reports`, this gate had no way out.
 *
 * Measured both ways: as `/reports/ceo` a Coordinator got 200; as a top-level
 * segment they get 307. Every other rank-gated route here — team, settings,
 * security, workload, workflow — is a top-level segment with its own layout beside
 * its own loading.tsx, for exactly this reason.
 *
 * ── ADMIN, WHERE `/reports` IS COORDINATOR ───────────────────────────────────
 * This page totals recurring monthly fees across every client, and revenue is not
 * a coordinator's business — no other reporting screen shows it. So a Coordinator
 * may reach `/reports` and must not reach this.
 *
 * ── WHY THE CHECK IS DUPLICATED IN `page.tsx` ────────────────────────────────
 * The layout is what makes the refusal a real redirect. The page is the security
 * boundary and returns the actor. Both stay; deleting either leaves something
 * broken. See the ⚠️ note on `requireRole()`.
 *
 * ⚠️ Do NOT add a `loading.tsx` to this segment. It would put this layout's own
 * refusal inside a new boundary and turn the 307 straight back into a 200 —
 * measured on the five other rank-gated routes. `scripts/smoke.mjs` asserts the
 * refusal, but only for a Member; the Coordinator case is the one that regressed
 * here, so it is worth re-checking by hand if this segment is ever restructured.
 * ========================================================================= */
export default async function MonthlyReportLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin');
  return children;
}
