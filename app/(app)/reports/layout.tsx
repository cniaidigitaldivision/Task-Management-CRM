import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. Without this the skeleton streams with a 200 to a
   Member and the refusal arrives afterwards, inside the stream. */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('team_coordinator');
  return children;
}
