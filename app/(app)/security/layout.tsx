import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. */
export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  await requireRole('super_admin');
  return children;
}
