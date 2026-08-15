import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`.

   Without this file the redirect is delivered INSIDE the stream: the 200 is
   already committed by the time the page's own guard runs, so a Member receives
   a rendered skeleton of a screen they may not see. That was found by the smoke
   test in redesign step 2 and it applies to every rank-gated route. */
export default async function WorkflowLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin');
  return children;
}
