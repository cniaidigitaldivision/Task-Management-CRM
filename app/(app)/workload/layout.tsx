import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. */
export default async function WorkloadLayout({ children }: { children: React.ReactNode }) {
  await requireRole('team_coordinator');
  return children;
}
