import { requireUser } from '@/lib/auth/current-user';

/* ── EVERYONE MAY LOOK; ADMIN+ MAY CHANGE (owner, 2026-08-15) ────────────────
   This was `requireRole('admin')`. The owner asked for chains to be visible to
   every role and editable only by Super Admin and Admin, and that split is
   already how migration 026 is written: `handoff_chains_select` is
   `app.current_user_id() is not null`, `handoff_chains_write` is
   `acting_at_least('admin')`. The route guard was the only thing narrower than
   the data.

   It is the right thing to open, too: a chain creates work that lands in
   somebody's queue, and the person it lands on should be able to see WHY. A
   Member who finds a task they did not create can now read the chain that made
   it instead of asking.

   Editing is gated in three independent places — the page hides the controls,
   every server action calls `requireRole('admin')`, and the RLS policy refuses
   the write. Hiding a button is a courtesy; the other two are the enforcement. */
export default async function WorkflowLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}
