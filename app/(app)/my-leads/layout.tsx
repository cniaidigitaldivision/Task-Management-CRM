import { requireCrmAccess } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create.

   ⚠️ `requireCrmAccess`, NOT `requireCrmReports` — and the difference from
   `/lead-overview` next door is the whole point. That page shows the team's
   work and is the manager's. Everything here is filtered to the caller's own
   leads by `app.crm_my_day` (migration 136), so it discloses nothing somebody
   could not already read off their own desk.

   A salesperson opening this sees their own day. A manager opening it sees
   theirs — normally empty, because they distribute rather than carry. */
export default async function MyLeadsLayout({ children }: { children: React.ReactNode }) {
  await requireCrmAccess();
  return children;
}
