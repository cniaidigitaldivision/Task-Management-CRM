'use server';

/* ============================================================================
 * EVERY VISIBLE ROW'S DRAWER, FETCHED BEFORE ANYBODY CLICKS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"If this table is loaded then all relevant data should be
 * loaded, and whenever I click on that, it will instantly show all these
 * things."*
 *
 * The desk calls this in the background once the table is on screen, for the
 * rows on screen, and keeps the answer. Opening a drawer then reads what is
 * already in memory — no server render, no query, no wait, for the first row
 * or the fortieth.
 *
 * ⚠️ `at` IS THE SERVER'S CLOCK, so the desk can tell whether this answer or the
 * page's own render is the newer one. After somebody saves something, the page
 * re-renders with fresh data; a background fetch that STARTED before the save
 * must not overwrite it when it lands a moment later.
 * ========================================================================= */

import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmLeadBundles, type CrmLeadBundle } from '@/lib/db/queries/crm-leads';

export interface LeadBundlesResult {
  readonly at: number;
  readonly bundles: Record<string, CrmLeadBundle>;
}

export async function leadBundlesAction(leadIds: string[]): Promise<LeadBundlesResult> {
  const { user } = await requireCrmAccess();
  /* Taken BEFORE the reads, so a save that lands during them is never treated as
     older than this answer. */
  const at = Date.now();
  if (!Array.isArray(leadIds) || leadIds.length === 0) return { at, bundles: {} };

  try {
    /* ⚠️ RLS decides every row. A lead this person cannot see is simply absent
       from the answer, and the drawer falls back to fetching it the slow way —
       which will refuse it too. */
    return { at, bundles: await crmLeadBundles(user.id, leadIds.slice(0, 50)) };
  } catch {
    /* A failed prefetch costs nothing but speed: the drawer still opens from the
       row and asks for the one lead it needs. */
    return { at, bundles: {} };
  }
}
