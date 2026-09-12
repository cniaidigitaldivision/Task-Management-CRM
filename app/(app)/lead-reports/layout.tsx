import { requireCrmAccess } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create.

   ⚠️ NOT UNDER `/reports`, AND THAT IS THE REASON THIS ROUTE EXISTS. The main
   reports page requires `team_coordinator` and above — and the sales manager is
   `member` in `users.role` (ADR-012: department seniority is not an app rank).
   A nested layout cannot widen a parent's floor, because the parent runs first
   and redirects. So `/reports/leads` would have blocked exactly the person these
   reports are for.

   The same guard as `/leads` and `/clients`, deliberately the same function
   rather than a copy of its condition. */
export default async function LeadReportsLayout({ children }: { children: React.ReactNode }) {
  await requireCrmAccess();
  return children;
}
