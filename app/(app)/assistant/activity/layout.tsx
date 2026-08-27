import { redirect } from 'next/navigation';

import { requireEnrolledUser } from '@/lib/auth/current-user';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * WHO MAY SEE WHAT THE ASSISTANT IS BEING USED FOR
 * ----------------------------------------------------------------------------
 * ── ⚠️ A SECOND GATE, ON TOP OF THE ONE ABOVE IT, AND IT IS NOT REDUNDANT ──
 * `app/(app)/assistant/layout.tsx` decides who may USE the assistant, which is
 * Coordinators and above plus anybody switched on by name. This decides who may
 * see what everybody else asked and what it cost — a strictly narrower thing,
 * and one the permission matrix has always kept separate (`assistant.use` vs
 * `assistant.view_usage`).
 *
 * Without this file a Coordinator could reach the roster of overrides and the
 * team's spend simply by typing the URL, because the parent layout would have
 * already said yes.
 *
 * ── ⚠️ WHY THE CHECK BELONGS IN A LAYOUT ───────────────────────────────────
 * `app/(app)/monthly-report/layout.tsx` documents the measured regression: a
 * `redirect()` from inside a Suspense boundary is delivered in the STREAM as an
 * HTTP 200 rather than a 307. A layout escapes its own segment's boundary but
 * never an ancestor's — and there is no `loading.tsx` anywhere in the assistant
 * tree, which is what keeps this a real 307.
 *
 * ⚠️ Do NOT add a `loading.tsx` here or in the parent. It would put this
 * refusal inside a new boundary and turn the 307 straight back into a 200.
 *
 * ── ⚠️ AND IT IS ONLY HALF THE BOUNDARY ────────────────────────────────────
 * The other half is in the database: migration 069's policies narrow the access
 * roster and the questions to an Admin, and migration 072's spend function
 * refuses anybody below one outright. This layout stops the WRONG SCREEN being
 * built; those stop the wrong DATA being returned. Neither is sufficient alone,
 * which is why both exist.
 * ========================================================================= */
export default async function AssistantActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireEnrolledUser();
  const actor = { role: user.role, id: user.id };

  /* Either permission is enough to have something to look at: usage without
     access management is a read-only view of the same screen, and the panels
     below render independently. Both are Admin-and-above today. */
  if (!can(actor, 'assistant.view_usage') && !can(actor, 'assistant.manage_access')) {
    redirect('/assistant');
  }

  return children;
}
