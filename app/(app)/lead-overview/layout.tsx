import { requireCrmReports } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create.

   ⚠️ `requireCrmReports`, THE SAME GUARD AS `/lead-reports` — not
   `requireCrmAccess`. Every figure on this page is a WHOLE-PROJECT figure: how
   many leads the team has never contacted, who has gone quiet, what arrived and
   went unanswered. That is a management view of other people's work, which is a
   different product from a salesperson reading their own desk.

   ⚠️ AND THE DATABASE REFUSES IT TOO, INDEPENDENTLY. `app.crm_lead_attention`
   ends in `having app.crm_manages_project(...)`, so a salesperson who reached
   this route another way gets NO ROW rather than a row of zeros — the page then
   says whose screen it is, instead of reassuringly reporting nothing wrong.
   Migration 135's self-check asserts exactly that. */
export default async function LeadOverviewLayout({ children }: { children: React.ReactNode }) {
  await requireCrmReports();
  return children;
}
