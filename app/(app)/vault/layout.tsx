import { requireNotExecutive } from '@/lib/auth/current-user';

/* ⚠️ THE FLOOR SITS ABOVE THE SUSPENSE BOUNDARY `loading.tsx` CREATES.
   Owner, 2026-09-25: *"Yeah store credentials in our case. Definitely hide
   it."* Migration 259 already empties the vault for this role; this stops the
   page loading at all.

   A `redirect()` from inside the page is delivered IN THE STREAM rather than
   as an HTTP 307, so the route answered 200 with a skeleton and an Executive
   simply stayed on it. The page-level guard is kept as a second line, but this
   is the one that turns them away. `/leads` and `/finance` carry the same note
   for the same reason — found by walking the app as an Executive, not by
   reading the route. */
export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  await requireNotExecutive();
  return children;
}
