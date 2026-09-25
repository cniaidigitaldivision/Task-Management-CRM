import { requireNotExecutive } from '@/lib/auth/current-user';

/* ⚠️ THE FLOOR SITS ABOVE THE SUSPENSE BOUNDARY `loading.tsx` CREATES.
   Owner: *"the calendar will not show."*

   A `redirect()` from inside the page is delivered IN THE STREAM rather than
   as an HTTP 307, so the route answered 200 with a skeleton and an Executive
   simply stayed on it. The page-level guard is kept as a second line, but this
   is the one that turns them away. `/leads` and `/finance` carry the same note
   for the same reason — found by walking the app as an Executive, not by
   reading the route. */
export default async function CalendarLayout({ children }: { children: React.ReactNode }) {
  await requireNotExecutive();
  return children;
}
