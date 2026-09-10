import type { Metadata } from 'next';

import { ClientList } from '@/components/crm/client-list';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmClients } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Clients' };

/* ============================================================================
 * CLIENTS — Step 9
 * ----------------------------------------------------------------------------
 * ── ⚠️ A ROUTE OF ITS OWN, NOT `/leads/clients` ────────────────────────────
 * `/leads/[id]` already exists, so a `clients` segment underneath it would sit
 * beside a dynamic one. Next resolves the static segment first, so it would
 * work — and it would mean a lead whose id was somehow the string "clients"
 * became unreachable, and that anybody reading the tree had to know the
 * precedence rule to be sure. Its own top-level route costs nothing and reads
 * as what it is: the owner's reference has "Clients & Leads" as two things.
 *
 * ── ⚠️ NO PROJECT DROPDOWN, AND THAT IS NOT AN OMISSION ────────────────────
 * `crm_clients` has no `project_id` — deliberately, since migration 111: one
 * person who enquires about two things is one client, and the link to projects
 * comes through their leads. So this page lists PEOPLE and names the projects
 * they bought on, rather than scoping to one project the way the desk does.
 * ========================================================================= */

export default async function ClientsPage() {
  const { user } = await requireCrmAccess();
  const clients = await crmClients(user.id);

  return (
    <ClientList
      clients={clients}
      /* ⚠️ The SERVER's clock, so "3d ago" is the same for everyone — and so
         React cannot report a reader's wrong system time as a hydration error
         instead of the clock problem it is. Same as the desk. */
      nowMs={nowMs()}
    />
  );
}
