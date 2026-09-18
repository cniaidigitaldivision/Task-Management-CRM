import type { Metadata } from 'next';

import { ConversationsWorkspace } from '@/components/crm/conversations-workspace';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmConversations, crmLeadBundles, type CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Conversations' };

/* ============================================================================
 * CONVERSATIONS — chat, email and the lead's context, in one place
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, with a design: *"design this page exactly as I have here…
 * like WhatsApp on an app like that… I want that instant thing. Each thing
 * should be properly wired up."*
 *
 * ── ⚠️ INSTANT IS A DATA DECISION, NOT A CSS ONE ───────────────────────────
 * WhatsApp Web feels immediate because every conversation is already in the
 * browser before it is clicked. So this page does the same: it loads the list
 * AND the full thread of the first several conversations in ONE wave, and the
 * client fetches the rest in the background. Clicking a name then reads memory —
 * no server render, no query, no spinner, for the first or the twentieth.
 *
 * That is the same arrangement `/my-leads` uses for its drawer
 * (`leadBundlesAction`), and the reason the owner stopped feeling that screen.
 *
 * ⚠️ NINE, NOT ALL OF THEM. The list holds up to a hundred conversations and
 * bundling every one would be a hundred threads nobody asked for. Nine covers
 * what the list shows without scrolling; the rest arrive in the background a
 * moment later, ordered by what is nearest the top.
 *
 * ⚠️ AND THE URL RECORDS WHICH IS OPEN, IT DOES NOT DECIDE WHEN IT OPENS. Rule
 * Zero, law 2: the pane switches in the click's own frame and the address bar
 * catches up behind it. Otherwise every click on a name would re-run this whole
 * render — which is precisely the bug the owner caught on the drawer.
 * ========================================================================= */

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmAccess();
  const params = await searchParams;

  const channel =
    params.channel === 'whatsapp' ? 'whatsapp' : params.channel === 'email' ? 'email' : null;
  const search = params.q ?? null;

  /* ── ⚠️ ONE BUNDLE, NOT NINE — AND IN THE SAME WAVE WHEN IT CAN BE ────────
     Owner, 2026-09-18: *"still the page is taking a lot of time to load. Why is
     that so?"* Measured before answering: the list query is **0.5 ms**, so it was
     never the list. It was this — the page awaited NINE full bundles before
     rendering a pixel, and a bundle is thirteen queries that run in series on one
     connection (`transactions-run-queries-in-series`). Nine of them is most of a
     second here and several times that from Karachi.

     Only the OPEN conversation is needed to draw the screen. The other eight were
     a prefetch dressed up as a dependency — and the client already fetches them in
     the background, which is where a prefetch belongs.

     ⚠️ AND WHEN THE URL NAMES THE LEAD, NOTHING IS WAITED FOR TWICE. `?lead=` is
     known before any query runs, so the list and that lead's bundle leave together
     (law 4). Only a bare `/conversations` has to learn which conversation is first
     before it can fetch it — one short wave, then one. */
  const named = params.lead ?? null;

  const [conversations, namedBundle] = await Promise.all([
    crmConversations(user.id, { channel, search }),
    named ? crmLeadBundles(user.id, [named]) : Promise.resolve({} as Record<string, CrmLeadBundle>),
  ]);

  const wanted =
    named && conversations.some((c) => c.leadId === named)
      ? named
      : (conversations[0]?.leadId ?? null);

  /* Already in hand when the URL named it; otherwise the first conversation's. */
  const bundles =
    wanted && !namedBundle[wanted]
      ? await crmLeadBundles(user.id, [wanted])
      : namedBundle;

  return (
    <ConversationsWorkspace
      conversations={conversations}
      bundles={bundles}
      openLeadId={wanted}
      channel={channel}
      search={search ?? ''}
      viewerName={user.fullName}
      nowMs={nowMs()}
    />
  );
}
