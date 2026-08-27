import { redirect } from 'next/navigation';

import { requireEnrolledUser } from '@/lib/auth/current-user';
import { assistantAccessFor } from '@/lib/db/queries/assistant';
import { mayUseAssistant } from '@/lib/domain/assistant-access';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * WHO MAY REACH THE ASSISTANT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"This facility will only be provided to upper levels,
 * like this super admin, admin, or team coordinator [...] Later on maybe I can
 * have a radio button for each member [...] that I can switch on and off at my
 * choice."*
 *
 * ── ⚠️ THIS IS NOT `requireRole('team_coordinator')`, AND THAT IS THE POINT ─
 * The obvious line is a rank floor, and it is subtly wrong: it would refuse a
 * Member the owner had explicitly SWITCHED ON, so the control on the access
 * screen would appear to work and then do nothing. It would also admit a
 * Coordinator who had been switched OFF, and leave the refusal to a component
 * further in — by which point their page payload has already been built.
 *
 * `mayUseAssistant` is the composed rule and it lives in one place, so the
 * layout, the page and the ask action cannot disagree about who is allowed.
 * Rank is the default underneath it, not a second gate in front of it.
 *
 * ── ⚠️ WHY THE CHECK BELONGS IN THE LAYOUT ─────────────────────────────────
 * `app/(app)/monthly-report/layout.tsx` documents the measured regression: a
 * `redirect()` from inside a Suspense boundary is delivered in the stream as an
 * HTTP 200 rather than a 307. A layout escapes its OWN segment's boundary but
 * never an ancestor's — which is why this is a top-level segment.
 *
 * ⚠️ Do NOT add a `loading.tsx` here. It would put this refusal inside a new
 * boundary and turn the 307 straight back into a 200.
 *
 * ── ⚠️ "MAY USE IT" IS NOT THE SAME AS "MAY ADMINISTER IT", AND THIS SEGMENT
 *    CONTAINS BOTH ─────────────────────────────────────────────────────────
 * The first version of this file gated the whole `/assistant` tree on
 * `mayUseAssistant`, which was right when the tree was one page. It is not any
 * more, and the difference is a trap somebody walked into within the hour:
 *
 *   The owner opened /assistant/activity and switched an Admin OFF. That Admin
 *   was then refused by this layout — including on the ACTIVITY page, which is
 *   where the switch lives. Measured: both routes returned 307 to /dashboard.
 *
 * Point that at the person holding the only other Admin account, or at yourself
 * by mistake, and the control that could undo it is behind the thing it just
 * did. The way back would be another Admin, or SQL.
 *
 * So the gate is now the UNION: you get past here if you may ASK, or if you may
 * administer the feature. What each of those then reaches is decided one level
 * down — `page.tsx` sends an administrator who may not ask to the activity
 * screen rather than to a chat box that would refuse every question, and
 * `activity/layout.tsx` refuses an asker who may not administer.
 *
 * ⚠️ This widens nothing. `assistant.view_usage` and `assistant.manage_access`
 * are Admin-and-above already, and the database narrows every read behind them
 * regardless of what this file decides.
 * ========================================================================= */
export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireEnrolledUser();
  const actor = { id: user.id, role: user.role };
  const override = await assistantAccessFor(user.id);

  const mayAsk = mayUseAssistant(actor, override);
  const mayAdminister =
    can(actor, 'assistant.view_usage') || can(actor, 'assistant.manage_access');

  if (!mayAsk && !mayAdminister) {
    redirect(user.role === 'member' ? '/my-work' : '/dashboard');
  }

  return children;
}
