import { requireRole } from '@/lib/auth/current-user';

/* ============================================================================
 * THE RANK FLOOR FOR FINANCE
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE FLOOR IS COORDINATOR, AND THAT IS NOT A MISTAKE ─────────────────
 * The ledger is Admin-only. The FORM is not. Owner, 2026-08-26: *"the team
 * coordinator can also add expenses. The list of expenses, their report, or
 * their analysis should only be visible to the admin and the super admin."*
 *
 * A Coordinator therefore has to reach this route — they file from it — so
 * refusing them here would take away the one thing they were given. What they
 * must not receive is any FIGURE, and that is decided one level down, in
 * page.tsx, which branches on the server and builds two entirely different
 * payloads. A Member gets a 307 from here and never reaches either.
 *
 * ── ⚠️ WHY THIS IS A TOP-LEVEL SEGMENT ──────────────────────────────────────
 * `/monthly-report/layout.tsx` documents the regression at length: nested under
 * `/reports`, its `loading.tsx` wrapped every descendant in a Suspense boundary,
 * and a `redirect()` from inside a boundary is delivered in the stream as an
 * HTTP 200 rather than a 307. A layout escapes its OWN segment's boundary but
 * never an ancestor's. Measured both ways there; not repeated here.
 *
 * ⚠️ Do NOT add a `loading.tsx` to this segment. It would put this layout's own
 * refusal inside a new boundary and turn the 307 straight back into a 200.
 * ========================================================================= */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireRole('team_coordinator');
  return children;
}
