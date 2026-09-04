import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary `loading.tsx` creates — see the
   ⚠️ note on `requireRole()`. Without this the skeleton streams with a 200 to a
   Member and the refusal arrives afterwards, inside the stream.

   ⚠️ `team_coordinator` AND ABOVE, on the owner's instruction 2026-09-04:
   *"this only visible to admin, superadmin and team coordinator."* Same floor as
   /reports. What a reader then sees INSIDE is decided by row-level security on
   every query, so a Coordinator's Studio covers their projects without this file
   having to know anything about it. */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await requireRole('team_coordinator');
  return children;
}
