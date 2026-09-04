'use client';

import * as React from 'react';

/* ============================================================================
 * ANIMATE WHEN SEEN, NOT WHEN LOADED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04: *"it should scroll when focused on it. For example if I
 * load the page, focus is above. When I go down it doesn't animate."*
 *
 * Exactly right, and it is the flaw in every entrance animation started on
 * mount: the Studio is four rows tall, so by the time anybody scrolls to the
 * heatmap its bars finished growing seconds ago, unwatched. The work went into
 * motion nobody saw.
 *
 * ── ⚠️ IT FIRES ONCE AND THEN DISCONNECTS ──────────────────────────────────
 * Deliberately not a toggle. A panel that re-animates every time it scrolls
 * past is a page that will not settle, and on a dashboard somebody scrolls up
 * and down while reading it would be actively distracting. Once seen, it stays
 * seen.
 * ========================================================================= */

export function useInView<T extends HTMLElement = HTMLDivElement>(): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* ⚠️ NO OBSERVER, NO ANIMATION — SO FALL OPEN, NOT CLOSED. Without this an
       old browser or a test environment would leave every panel stuck at its
       start frame, i.e. invisible. A missing nicety must never hide the data. */
    if (typeof IntersectionObserver === 'undefined') {
      /* Scheduled, not synchronous — React's `set-state-in-effect` rule refuses
         the direct form, and a setState during the effect pass forces a second
         render before the first has painted. */
      const settle = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(settle);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        observer.disconnect();
      },
      {
        /* A panel counts as seen once a fifth of it has arrived — waiting for
           the whole card means a tall panel animates only after its top has
           already been read. */
        threshold: 0.2,
        /* And nudged upward, so a panel that is technically on screen but
           tucked under the sticky topbar does not start where it cannot be
           watched. */
        rootMargin: '-40px 0px -40px 0px',
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, inView };
}
