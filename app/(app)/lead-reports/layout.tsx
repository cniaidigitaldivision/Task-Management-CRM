import { requireCrmReports } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create.

   ⚠️ NOT UNDER `/reports`, AND THAT IS THE REASON THIS ROUTE EXISTS. The main
   reports page requires `team_coordinator` and above — and the sales manager is
   `member` in `users.role` (ADR-012: department seniority is not an app rank).
   A nested layout cannot widen a parent's floor, because the parent runs first
   and redirects. So `/reports/leads` would have blocked exactly the person these
   reports are for.

   ⚠️ AND IT IS NARROWER THAN THE DESK — `requireCrmReports`, not
   `requireCrmAccess`. Owner, 2026-09-12: *"lead reports will not be seen by the
   salesperson… the sales manager should see it."* These reports name people and
   compare them: how many each holds, how fast each answers, who closed what. A
   salesperson reading their colleagues' response times is a different product
   from one reading their own leads.

   The guard is a shared function rather than a copy of its condition, for the
   same reason `/leads` and `/clients` share theirs. */
export default async function LeadReportsLayout({ children }: { children: React.ReactNode }) {
  await requireCrmReports();
  return children;
}
