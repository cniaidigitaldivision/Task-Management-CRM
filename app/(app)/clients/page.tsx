import type { Metadata } from 'next';

import { ClientsBoard } from '@/components/crm/clients-board';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmClientBoard } from '@/lib/db/queries/crm-client-board';
import { crmAddLeadProjects } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Clients' };

/* ============================================================================
 * CLIENTS — the owner's design, 2026-09-22 (was Step 9's list)
 * ----------------------------------------------------------------------------
 * ── ⚠️ STILL A ROUTE OF ITS OWN, NOT `/leads/clients` ──────────────────────
 * `/leads/[id]` already exists, so a `clients` segment underneath it would sit
 * beside a dynamic one; its own top-level route costs nothing.
 *
 * ── ⚠️ ONE WAVE, AND NO `searchParams` (Rule Zero, laws 1 and 4) ───────────
 * The board and the projects the caller may add a client to have nothing to
 * say to each other, so they leave together. Every tab, filter, view, page and
 * selection after that is client state over these rows.
 *
 * ── ⚠️ A CLIENT STILL HAS NO `project_id` ─────────────────────────────────
 * 111's rule, kept by 249: one person who enquires about two things is one
 * client, linked to projects through their leads. The project filter matches
 * any of a client's projects, and the preview names the one they are most
 * active on.
 * ========================================================================= */

export default async function ClientsPage() {
  const { user } = await requireCrmAccess();
  const [clients, projects] = await Promise.all([crmClientBoard(user.id), crmAddLeadProjects(user.id)]);

  return (
    <ClientsBoard
      clients={clients}
      projects={projects}
      /* The SERVER's clock — "overdue" and "45 days quiet" are decided with it,
         and a laptop an hour out would otherwise disagree with the render. */
      nowMs={nowMs()}
      viewerId={user.id}
      viewerName={user.fullName}
    />
  );
}
