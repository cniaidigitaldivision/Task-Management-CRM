'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';

/* ============================================================================
 * THE STAGE DIRECTOR
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"as the page loads these cards should not suddenly all
 * appear at once. I want that when the preloaded video comes, then one by one
 * each card will pop up"*, and *"when I scroll to the progress, these bars will
 * load."*
 *
 * Two jobs, one observer, one component — because both are the same idea: hold
 * an animation until the moment it is worth playing.
 *
 *   1. CURTAIN UP. Every tile is created paused. When the backdrop video can
 *      play, the whole grid is released and the tiles run their staggered
 *      entrance in order.
 *
 *   2. ON APPROACH. Anything marked `data-reveal` starts paused too, and is
 *      released when it scrolls into view — so the bars in the lower half fill
 *      as the reader reaches them rather than having finished long before.
 *
 * ── ⚠️ THE VIDEO MUST NEVER BE ABLE TO HIDE THE DASHBOARD ───────────────────
 * Gating the curtain purely on `canplay` would mean a blocked autoplay, a
 * failed request, or a browser that never fires the event leaves every tile at
 * `opacity: 0` — a blank page, caused by a decoration. So the curtain rises on
 * whichever comes FIRST: the video being ready, or a hard 1200ms timeout. The
 * timeout is not a fallback for a rare case; it is the guarantee.
 *
 * ── ⚠️ WHY `animation-play-state` AND NOT A MOUNTED FLAG ────────────────────
 * The alternative is rendering the tiles only once ready, which reflows the
 * whole grid at curtain-up and costs a second layout of everything. Pausing
 * leaves the tiles laid out from the first paint — they are simply held on
 * their first frame, and releasing them changes one property that the
 * compositor already owns.
 * ========================================================================= */

/** The longest the dashboard will ever wait for the backdrop. */
const CURTAIN_MS = 1200;

export function StageDirector() {
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-stage]');
    if (!root) return;

    /* ── ⚠️ REDUCED MOTION SKIPS THE WHOLE CHOREOGRAPHY ────────────────────
       Not "plays it faster" — the entrance, the stagger and the scroll reveal
       are all incidental motion. The stage is marked ready at once and every
       `data-reveal` is released immediately, so the page is simply there. */
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
      root.dataset.stage = 'ready';
      for (const el of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
        el.dataset.reveal = 'in';
      }
      return;
    }

    let raised = false;
    const raise = () => {
      if (raised) return;
      raised = true;
      root.dataset.stage = 'ready';
    };

    /* Whichever happens first — see the header. */
    const timer = window.setTimeout(raise, CURTAIN_MS);
    const video = document.querySelector<HTMLVideoElement>('.room-cut');
    if (video) {
      /* `readyState >= 3` is HAVE_FUTURE_DATA: enough decoded to start playing.
         Checked as well as listened for, because a cached video can already be
         ready before this effect runs and would never fire the event. */
      if (video.readyState >= 3) raise();
      else video.addEventListener('canplay', raise, { once: true });
    }

    /* ── On approach ────────────────────────────────────────────────────── */
    const seen = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          (entry.target as HTMLElement).dataset.reveal = 'in';
          /* Unobserved immediately: this is a one-way trip. Leaving it observed
             would re-fire on every scroll past and re-run a finished animation,
             which reads as the page glitching. */
          observer.unobserve(entry.target);
        }
      },
      /* A negative bottom margin means "in view" fires when the element is
         properly on screen rather than as its first pixel appears — otherwise
         a bar finishes filling before the reader has actually reached it. */
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    );

    for (const el of document.querySelectorAll('[data-reveal]')) observer.observe(el);

    return () => {
      window.clearTimeout(timer);
      video?.removeEventListener('canplay', raise);
      observer.disconnect();
    };
  }, []);

  return null;
}
