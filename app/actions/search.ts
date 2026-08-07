'use server';

import { requireUser } from '@/lib/auth/current-user';
import { search, tasksInRange, type CalendarTask, type SearchResults } from '@/lib/db/queries/search';

/* ============================================================================
 * SEARCH AND CALENDAR ACTIONS
 * ----------------------------------------------------------------------------
 * Thin on purpose. The scoping happens in the database — every query runs under
 * `withUser`, so RLS has already removed the rows an actor may not see. There
 * is no filter here to get wrong, which is the point: search is the classic
 * place a permission model leaks, and the leak is almost always a client-side
 * filter over a server query that fetched too much.
 * ========================================================================= */

export async function searchAction(term: string): Promise<SearchResults> {
  const user = await requireUser();
  return search(user.id, term);
}

export async function calendarAction(range: {
  from: string;
  to: string;
}): Promise<CalendarTask[]> {
  const user = await requireUser();
  return tasksInRange(user.id, range);
}
