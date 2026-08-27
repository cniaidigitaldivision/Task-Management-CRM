'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';

/* ============================================================================
 * RELEASING THE BARS AS THE READER REACHES THEM
 * ----------------------------------------------------------------------------
 * Anything marked `data-reveal="out"` is held on its first frame until it is
 * properly on screen, then flipped to `in` so its transition plays.
 *
 * ── ⚠️ WHY NOT `components/dashboard/stage-director.tsx` ────────────────────
 * That component does this AND raises a curtain over `.bento-tile`, gated on a
 * backdrop video's `canplay`. It also returns immediately when there is no
 * `[data-stage]` root — which is exactly what happened here: the finance page
 * had no such root, the director bailed on its first line, and every waterfall
 * bar sat at `width: 0` permanently. Measured in the browser; the markup and the
 * CSS were both correct and the page still showed eight invisible bars.
 *
 * Giving finance a `data-stage` root instead would import a curtain that gates
 * on a video this page does not have. This is the half that applies.
 *
 * ── ⚠️ A BAR THAT NEVER REVEALS IS A BAR THAT READS AS ZERO ────────────────
 * `[data-reveal='out']` sets width to 0, so a failure here does not degrade to
 * "no animation" — it degrades to "no spending", which is a false statement
 * about money. Hence the `IntersectionObserver` check below: where the API is
 * missing, everything is released at once rather than left at zero.
 * ========================================================================= */

export function Reveal() {
  React.useEffect(() => {
    const release = (el: Element) => {
      (el as HTMLElement).dataset.reveal = 'in';
    };

    const releaseAll = () => {
      document.querySelectorAll('[data-reveal="out"]').forEach(release);
    };

    /* Reduced motion: everything is simply there. The entrance is incidental,
       and a held bar would be the only lasting effect. */
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
      releaseAll();
      return;
    }

    /* No observer, no held state — see the header. */
    if (typeof IntersectionObserver === 'undefined') {
      releaseAll();
      return;
    }

    const seen = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          release(entry.target);
          /* A one-way trip — leaving it observed re-fires on every scroll past
             and replays a finished animation, which reads as a glitch. */
          observer.unobserve(entry.target);
        }
      },
      /* Fires when the element is properly on screen rather than as its first
         pixel appears, so a bar is not already full by the time it is reached. */
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    );

    const watch = () => {
      for (const el of document.querySelectorAll('[data-reveal="out"]')) {
        if (!seen.has(el)) observer.observe(el);
      }
    };
    watch();

    /* ⚠️ Switching tabs mounts `[data-reveal]` nodes that did not exist when
       this effect ran. Without watching for them they keep their zero width for
       as long as the tab stays open — which is the same false "nothing was
       spent" the header describes. A MutationObserver rather than a poll: the
       DOM already knows when this happens. */
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}
