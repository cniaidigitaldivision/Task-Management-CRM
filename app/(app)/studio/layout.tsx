import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. Without this the skeleton streams with a 200 to a
   Member and the refusal arrives afterwards, inside the stream.

   ⚠️ `admin` AND ABOVE — NARROWED 2026-09-05, and the previous instruction is
   worth keeping because it changed. On 2026-09-04 the owner asked for *"admin,
   superadmin and team coordinator"*; on 2026-09-05, before merging, they asked
   for admin and super admin only. A Coordinator now gets the same 403 as a
   Member.

   ⚠️ THIS FILE IS THE FLOOR, not nav-config.ts. The nav item is a link, and
   removing it there would hide the Studio while leaving the URL open to anybody
   who typed it — so BOTH are changed, and only this one is load-bearing. */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  /* ⚠️ THE LAYOUT HAS ITS OWN FLOOR, AND IT RUNS FIRST. Changing only
     page.tsx left an Executive bounced to the dashboard from a link the
     sidebar had just offered them — found by walking the app as one,
     not by reading the page. Rank 3 admits Admin, Super Admin and the
     Executive, and still refuses a Coordinator. */
  await requireRole('executive');
  return children;
}
