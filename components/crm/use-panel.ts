'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

/* ============================================================================
 * A PANEL THAT OPENS AND CLOSES AT ONCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"if I click on a cross button, it is taking time to
 * render… These are just UI clicks to view the same data in detail, which is
 * already loaded. Why is it taking too much time?"*
 *
 * They were right, and the answer was embarrassing.
 *
 * ── ⚠️ CLOSING A PANEL WAS A ROUND TRIP TO SINGAPORE ───────────────────────
 * Every panel on this page closed with `router.push()`. `/my-leads` is a
 * DYNAMIC route — it reads `searchParams` — so a push re-runs the whole server
 * render: the project list, the lead list, the counts, the owner options, and
 * the drawer's own three queries. All of it, to hide a box that was already
 * drawn and whose contents nobody was going to look at again.
 *
 * Measured from Karachi, where one round trip to the pooler is 101 ms: about
 * 1.4 seconds of waiting to dismiss a dialog. Even co-located on Vercel it is
 * a server render nobody needed.
 *
 * ── THE RULE THIS ENCODES ──────────────────────────────────────────────────
 * ⚠️ THE URL IS A RECORD OF WHAT IS OPEN, NOT THE MECHANISM THAT OPENS IT.
 * It still matters — it is what makes a drawer survive a refresh, a back button
 * and a pasted link, and none of that is given up here. It simply stops being
 * the thing the eye waits for: the panel hides on the spot from local state,
 * and the URL catches up afterwards inside a transition.
 *
 * ⚠️ AND `replace`, NOT `push`. Opening a drawer and closing it again should
 * not leave two entries in the history so that Back reopens it. Closing undoes
 * the entry rather than stacking another one on top.
 * ========================================================================= */

export interface PanelState {
  /** True once the person has dismissed it. Render nothing when set. */
  readonly closed: boolean;
  /** Hide immediately; sync the URL in the background. */
  readonly close: () => void;
}

export function usePanel(buildClosedUrl: () => string): PanelState {
  const router = useRouter();
  const [closed, setClosed] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const close = React.useCallback(() => {
    /* ⚠️ THIS LINE IS THE WHOLE FIX. It runs in the click's own frame, so the
       panel is gone before anything touches the network. */
    setClosed(true);

    startTransition(() => {
      router.replace(buildClosedUrl() as Route);
    });
  }, [router, buildClosedUrl]);

  /* ⚠️ ESCAPE CLOSES IT, on the same instant path. A dialog that can only be
     dismissed by hitting a small target is one people fight with. */
  React.useEffect(() => {
    if (closed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closed, close]);

  return { closed, close };
}

/**
 * Move to another URL on this page without waiting for the server to answer
 * before the interface reacts — for a tab inside an open panel, where the panel
 * stays put and only its contents change.
 *
 * ⚠️ THE CALLER UPDATES ITS OWN STATE FIRST, then calls this. React keeps the
 * current contents on screen through the transition rather than blanking them,
 * so the tab highlights at once and its rows arrive when they arrive.
 */
export function useSoftNavigate(): (url: string) => void {
  const router = useRouter();
  const [, startTransition] = React.useTransition();

  return React.useCallback(
    (url: string) => {
      startTransition(() => {
        router.replace(url as Route);
      });
    },
    [router],
  );
}
