import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PropertyRecord } from '@/components/crm/property-record';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmPropertyActivity, crmPropertyByCode, crmPropertyStatusSpans,
} from '@/lib/db/queries/crm-properties';

export const metadata: Metadata = { title: 'Property' };

/* ============================================================================
 * ONE PLOT — the owner's detail reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * ── ⚠️ A ROUTE, NOT A DIALOG, AND THAT IS A CHANGE OF MIND ON THE RECORD ──
 * The owner's first instruction about this page was *"Don't bring it anywhere
 * else. It's all on this page."* Her seventh reference then draws a full screen
 * with a breadcrumb reading Properties / Chitral Royal Homes / PROP-A101 — which
 * is a URL, not a modal. Both are right for what they are: the panel answers
 * "what is this plot" while you skim the list, and this answers "tell me
 * everything", which is a thing somebody links to a colleague.
 *
 * ── ⚠️ THE CODE IS THE URL, NOT THE UUID ──────────────────────────────────
 * `/properties/PROP-A101` is a link a salesperson can read, paste into a
 * message and recognise. A uuid in the address bar is a link nobody can check
 * before they send it.
 *
 * ⚠️ Which means the code must be unique per project — it is, by
 * `crm_properties_code_uq` — and that two projects CAN hold the same code. The
 * reader takes the first the caller can see; the page names its project in the
 * breadcrumb so there is no doubt which one is on screen.
 *
 * ── ⚠️ ONE WAVE — Rule Zero, law 4 ────────────────────────────────────────
 * The plot and its history owe each other nothing, so they leave together.
 * ========================================================================= */

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [{ user }, { code }] = await Promise.all([requireCrmAccess(), params]);
  const property = await crmPropertyByCode(user.id, decodeURIComponent(code));

  /* ⚠️ `notFound()` for a plot they cannot see, not a "denied" page. Telling
     somebody a PROP-B201 exists on a scheme they have no access to is itself a
     disclosure — the same reasoning the lead drawer uses. */
  if (!property) notFound();

  /* ⚠️ ONE WAVE — law 4. The history and the activity owe each other nothing,
     and neither needs the other's answer, so they leave together. */
  const [activity, spans] = await Promise.all([
    crmPropertyActivity(user.id, property.id),
    crmPropertyStatusSpans(user.id, property.id),
  ]);

  return (
    <PropertyRecord
      property={property}
      activity={activity}
      spans={spans}
      viewerName={user.fullName}
    />
  );
}
