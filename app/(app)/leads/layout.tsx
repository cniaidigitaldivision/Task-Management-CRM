import { requireRole } from '@/lib/auth/current-user';

/* The rank floor, above the Suspense boundary `loading.tsx` would create — see
   the ⚠️ note on `requireRole()`. Without this the skeleton streams with a 200
   to a Member and the refusal arrives afterwards, inside the stream.

   ⚠️ `admin` AND ABOVE, MATCHING THE STUDIO, AND DELIBERATELY THE NARROW START.
   Leads carry a stranger's name, phone and number — the most sensitive rows
   this product will hold — and widening a floor later is a decision somebody
   makes on purpose, whereas narrowing one takes access away from people who had
   grown used to it. When the owner says who works the pipeline, this changes
   here first.

   ⚠️ THIS FILE IS THE FLOOR, not nav-config.ts. The nav item is only a link;
   removing it there would hide the page while leaving the URL open to anybody
   who typed it. Both are set, and only this one is load-bearing (NFR-006). */
export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin');
  return children;
}
