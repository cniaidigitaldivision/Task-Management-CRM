import type { Metadata } from 'next';

import { TodoList } from '@/components/crm/todo-list';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmMyTodos } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'My to-dos' };

/* ============================================================================
 * MY TO-DOS — the sales team's own list
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-16: *"I want a separate thing for the sales team with the name
 * 'to-dos' where sales-related to-dos will just be displayed."*
 *
 * ── ⚠️ ONE QUERY, NO `searchParams`, NOTHING TO TICK ───────────────────────
 * The whole page is a single `union all` over state that already exists. There
 * is no `crm_todos` table and there must not be one: a stored to-do can be
 * ticked off separately from the thing it refers to, and the first time somebody
 * clears "ring Faisal" without ringing Faisal, the list stops being true and
 * nothing ever reconciles it.
 *
 * ── ⚠️ AND IT IS `/todos`, NOT `/my-leads/todos` ───────────────────────────
 * A nested route would inherit that page's nine queries to draw a list that owes
 * them nothing. Same reasoning that put `/clients` beside `/leads`.
 * ========================================================================= */

export default async function TodosPage() {
  const { user } = await requireCrmAccess();

  const todos = await crmMyTodos(user.id);

  return (
    <TodoList
      todos={todos}
      /* ⚠️ THE SERVER'S CLOCK. "Overdue" decides which group a row lands in, so a
         reader whose laptop is an hour out would be shown work as late before it
         was — and React would report the disagreement as a hydration error
         rather than as the clock problem it is. */
      nowMs={nowMs()}
    />
  );
}
