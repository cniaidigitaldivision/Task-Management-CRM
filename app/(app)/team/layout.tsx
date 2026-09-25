import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary that `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  /* ⚠️ THE LAYOUT HAS ITS OWN FLOOR, AND IT RUNS FIRST. Changing only
     page.tsx left an Executive bounced to the dashboard from a link the
     sidebar had just offered them — found by walking the app as one,
     not by reading the page. Rank 3 admits Admin, Super Admin and the
     Executive, and still refuses a Coordinator. */
  await requireRole('executive');
  return children;
}
