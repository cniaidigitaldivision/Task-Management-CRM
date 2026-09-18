import type { Metadata } from 'next';

import { ConversationsWorkspace } from '@/components/crm/conversations-workspace';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { crmConversations, crmLeadBundles } from '@/lib/db/queries/crm-leads';
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

  /* ⚠️ THE LIST FIRST, BECAUSE THE BUNDLES DEPEND ON IT. This is the one real
     dependency on the page — which conversations to preload is the list's own
     answer — so it is two waves rather than one, and the second is wide rather
     than deep. Everything inside each wave leaves together. */
  const conversations = await crmConversations(user.id, { channel, search });

  const wanted =
    params.lead && conversations.some((c) => c.leadId === params.lead)
      ? params.lead
      : (conversations[0]?.leadId ?? null);

  /* The open one first, then the top of the list — what a person clicks next. */
  const preload = [...new Set([wanted, ...conversations.slice(0, 9).map((c) => c.leadId)])].filter(
    (id): id is string => id !== null,
  );

  const bundles = preload.length > 0 ? await crmLeadBundles(user.id, preload) : {};

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
