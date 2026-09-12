import { requireCrmAccess } from '@/lib/auth/current-user';

/* The access floor, above the Suspense boundary `loading.tsx` would create — see
   the ⚠️ note on `requireRole()`.

   ⚠️ THE SAME FLOOR AS `/leads`, and deliberately the same function rather than
   a copy of its condition: a client is a lead who bought, so anybody who may
   read the lead may read the client. Two differently-worded checks for one
   audience is how the two drift apart.

   ⚠️ AND THIS FILE IS NOT THE FLOOR — migrations 124 and 126 are (NFR-006).
   Removing it would show an empty table to the wrong person, not somebody
   else's clients. */
export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  await requireCrmAccess();
  return children;
}
