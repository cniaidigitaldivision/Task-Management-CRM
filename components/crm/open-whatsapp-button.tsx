'use client';

import * as React from 'react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';

/* ============================================================================
 * "WHATSAPP" ON THE LEAD RECORD — Step 8
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-13: *"When I click on the chat button or the whatsapp button in
 * the row, it brings me to that link of whatsapp on the web. It's not opening
 * the chat in the right bottom where I was talking about."*
 *
 * ── ⚠️ AN EVENT, NOT A LINK, AND NOT A SHARED PARENT ───────────────────────
 * The panel it opens is `WhatsAppChat`, which is mounted as a SIBLING of
 * `LeadRecord` rather than inside it — deliberately, because it calls
 * `useRouter` and `LeadRecord` is rendered by 30 tests with no router mounted.
 * So this button cannot reach the panel's state through props, and lifting that
 * state to a shared provider would drag the router hook back into the tree the
 * tests render.
 *
 * A `?chat=1` link would also work, and that IS how an arrival from the desk is
 * handled — but from a page you are already on, it costs a server round trip to
 * open a panel that is already in the DOM. One window event costs nothing and
 * the panel is open on the next frame.
 *
 * ⚠️ AND IT IS EMPHATICALLY NOT `wa.me`. That link opens the SALESPERSON'S OWN
 * WhatsApp: the message leaves from a personal handset, and `crm_lead_messages`
 * never sees it — no thread, no response time, no "who replied". It is the one
 * click that quietly undoes everything Step 8 is for.
 * ========================================================================= */

/** What `WhatsAppChat` listens for. Namespaced so it cannot collide. */
export const OPEN_WHATSAPP_EVENT = 'crm:open-whatsapp';

export function OpenWhatsAppButton({ leadName }: { leadName: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WHATSAPP_EVENT))}
      aria-label={`Open the WhatsApp chat with ${leadName}`}
      /* Same shape as `ReachButton` beside it, so Call and WhatsApp read as one
         row of controls rather than two different kinds of thing. */
      className="inline-flex min-h-[2.4rem] items-center gap-2 rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default hover:bg-bg-subtle"
    >
      <span className="inline-flex" style={{ color: WA_GREEN }}>
        <WhatsAppMark className="size-4" />
      </span>
      WhatsApp
    </button>
  );
}
