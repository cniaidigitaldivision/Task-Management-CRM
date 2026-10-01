import type { Metadata } from 'next';

import { PropertiesBoard } from '@/components/crm/properties-board';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmCatalogueProjects, crmPropertyBoard } from '@/lib/db/queries/crm-properties';

export const metadata: Metadata = { title: 'Properties' };

/* ============================================================================
 * PROPERTIES — the owner's design, 2026-09-27
 * ----------------------------------------------------------------------------
 * Owner: *"create a property page with the exact same UI that I am showing you
 * ... Each and every detail, including sleekness, sizes, fonts, and coloring."*
 *
 * ── ⚠️ ONE WAVE, AND NO `searchParams` — Rule Zero, laws 1 and 4 ──────────
 * The catalogue and the projects somebody may add to have nothing to say to
 * each other, so they leave together. Every tab, filter, search, selection,
 * page and dialog after that is CLIENT state over these rows — pressing
 * "Available" must not re-run a 150-row query to hide 68 of them.
 *
 * ── ⚠️ AND THE PANEL IS DRAWN FROM THE ROW — law 3 ────────────────────────
 * `crmPropertyBoard` returns the documents, the linked items and the payment
 * stages with every row, so clicking down the list costs no round trips at all.
 * The `/my-leads` pattern the handover names as the reference.
 *
 * ── ⚠️ THE SALESPERSON IS THE PERSON THIS PAGE IS FOR ─────────────────────
 * Owner: *"Right now at that level, I'm watching that salespersons can view all
 * of the properties. He can add or import the properties."* Migration 266
 * widened `crm_properties_write` to the project's department to match, which
 * reverses 150 — see that file's header. Verified as Sarah, not as an admin:
 * the board read 0 rows for her until a `join public.projects` came out of the
 * query, and an admin session could never have shown that.
 * ========================================================================= */

export default async function PropertiesPage() {
  const { user } = await requireCrmAccess();
  const [properties, projects] = await Promise.all([
    crmPropertyBoard(user.id),
    crmCatalogueProjects(user.id),
  ]);

  return (
    <PropertiesBoard
      properties={properties}
      projects={projects}
      viewerName={user.fullName}
    />
  );
}
