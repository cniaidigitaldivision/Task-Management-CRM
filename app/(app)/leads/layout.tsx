import { requireCrmAccess } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create — see
   the ⚠️ note on `requireRole()`. Without this the skeleton streams with a 200
   to somebody who may not be here, and the refusal arrives afterwards, inside
   the stream.

   ── ⚠️ A DEPARTMENT, NOT A RANK, SINCE 2026-09-10 ─────────────────────────
   Owner: *"all this CRM belongs to the sales manager and the salespersons. Plus
   admin and super admin are by default added."* So the floor is Admin, Super
   Admin, or anybody in the Sales department — which includes three people whose
   app role is `member`, the bottom of the rank ladder.

   ⚠️ THE TEAM COORDINATOR IS NO LONGER ADMITTED, and that reverses the answer of
   2026-09-09. He runs the digital team's tasks; leads were never his work.
   Migration 118 carries the full reasoning and the same rule in SQL.

   ⚠️ THIS FILE IS NOT THE FLOOR EITHER — migrations 117 and 118 are. Removing
   this would show an empty desk to the wrong person, not somebody else's leads.
   Both are set, deliberately, and only the database one is load-bearing
   (NFR-006). */
export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  await requireCrmAccess();
  return children;
}
