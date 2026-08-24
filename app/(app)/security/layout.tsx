import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`.

   'admin' since 2026-08-22 by owner decision — see the note beside
   `security_dashboard.view` in lib/domain/permissions.ts, and migration 040,
   which moved the row-level policies this screen reads. Both are required: this
   guard alone opens the door onto empty panels. */
export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin');
  return children;
}
