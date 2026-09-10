'use client';

/* ============================================================================
 * A BACKGROUND CLIP
 * ----------------------------------------------------------------------------
 * ── ⚠️ IT NO LONGER FOLLOWS THE THEME, AND THE NAME IS THE ONLY THING LEFT ──
 * This used to hold a light and a dark cut of each clip and swap them with the
 * page's theme switch. The homepage is dark only now (owner's instruction), so
 * there is one cut per clip and no `useTheme` — which also means this component
 * no longer re-runs its effect when somebody changes theme inside the product.
 *
 * ── WHY THERE IS STILL NO `poster` ATTRIBUTE ────────────────────────────────
 * The still is a CSS background in home.css. It paints with the first frame of
 * CSS, before this component has mounted, and it is what stands in when
 * autoplay is refused or motion is unwanted. A `poster` would arrive later and
 * buy nothing.
 *
 * ── ⚠️ THE HERO CLIP IS 6.4 MB ──────────────────────────────────────────────
 * Owner-supplied and used as given. It is NOT lazy, because it is the hero and
 * a visitor is looking straight at it — but it is the single heaviest thing on
 * the page by a wide margin, and the poster is what carries the first paint
 * while it streams. The assistant's clip below the fold IS lazy.
 * ========================================================================= */

import * as React from 'react';

/* ⚠️ THE ASSISTANT PANEL SHOWS THE CONTROL ROOM, NOT THE BRAIN, AND THAT IS
   DELIBERATE. The owner's new hero clip is itself a glowing brain, so the
   assistant's own brain cut directly below it made the page look like it was
   repeating itself — two near-identical clips within one scroll. The control
   room reads as "your own tables", which is what that section actually claims,
   and it is 1.3 MB against the brain's 6.9. Swap `room` back to
   '/assistant/brain-dark.mp4' to undo this; the still in home.css must change
   with it. */
const CLIPS = {
  hero: '/home/hero.mp4',
  room: '/dashboard/room-dark.mp4',
} as const;

export function ThemeClip({
  clip,
  className,
  /** Hold the download until the element is nearly on screen. For anything
   *  below the fold; never for the hero. */
  lazy = false,
}: {
  clip: keyof typeof CLIPS;
  className?: string;
  lazy?: boolean;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);

  /* ⚠️ ONE EFFECT, AND THE OBSERVER STARTS THE LOAD ITSELF. Splitting this into
     "observe" then "load" needs a piece of state no render reads, and setting
     state from an effect body to reach the second half is a cascading render
     that react-hooks/set-state-in-effect refuses, correctly. */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const want = CLIPS[clip];

    const start = () => {
      if (el.getAttribute('src') !== want) {
        el.src = want;
        el.load();
      }
      /* ⚠️ Paused, not merely un-animated, for anybody who asked their system
         to stop moving things: CSS cannot pause a <video>, and an autoplaying
         clip is exactly the motion that request is about. The still stands in. */
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.pause();
        return;
      }
      void el.play().catch(() => {
        /* Autoplay refused — a data saver, a battery mode, a browser policy.
           Nothing to recover: the still is already the visible frame. */
      });
    };

    if (!lazy || typeof IntersectionObserver === 'undefined') {
      start();
      return;
    }

    /* `rootMargin` starts the fetch early enough that the clip is usually
       playing by the time it is read. */
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        start();
      },
      { rootMargin: '320px' },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [clip, lazy]);

  return (
    <video
      ref={ref}
      className={className}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
    />
  );
}
