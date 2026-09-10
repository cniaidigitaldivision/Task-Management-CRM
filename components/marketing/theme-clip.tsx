'use client';

/* ============================================================================
 * A BACKGROUND CLIP THAT FOLLOWS THE THEME
 * ----------------------------------------------------------------------------
 * The dashboard's control-room clip and the assistant's brain clip, both of
 * which the application ships in a light and a dark cut. On the homepage the
 * theme switch changes the footage, not only the paint.
 *
 * ── ⚠️ ONE `src`, ASSIGNED HERE — NEVER BOTH CUTS WITH ONE HIDDEN ───────────
 * The dashboard mounts both and hides one in CSS, which is affordable at 1.4 MB
 * a cut inside a tool people are already signed in to. It is not affordable
 * here: HIDING A <video> DOES NOT STOP IT DOWNLOADING, and the assistant's cuts
 * are ~6 MB each. Both cuts of both clips is 15.5 MB before a visitor has read
 * the headline, on whatever connection they arrived on.
 *
 * ── WHY THERE IS NO `poster` ATTRIBUTE ──────────────────────────────────────
 * There is a still for every cut, but it is applied as a CSS background in
 * home.css rather than here. A poster would have to be picked in JavaScript,
 * and the theme is not known until React hydrates — the server render assumes
 * light, so a dark visitor would be handed the light still and have it swapped
 * underneath them. CSS reads `data-theme`, which the pre-paint script stamps
 * before the first frame, so the correct still is right immediately and costs
 * no JavaScript at all. See the note at `--still-room` in home.css.
 * ========================================================================= */

import * as React from 'react';

import { useTheme } from '@/components/brand/theme-provider';

const CUTS = {
  room: { light: '/dashboard/room-light.mp4', dark: '/dashboard/room-dark.mp4' },
  brain: { light: '/assistant/brain-light.mp4', dark: '/assistant/brain-dark.mp4' },
} as const;

export function ThemeClip({
  clip,
  className,
  /** Hold the download until the element is nearly on screen. For the ~6 MB
   *  assistant cuts, which sit well below the fold. */
  lazy = false,
}: {
  clip: keyof typeof CUTS;
  className?: string;
  lazy?: boolean;
}) {
  const { resolved, isHydrated } = useTheme();
  const ref = React.useRef<HTMLVideoElement>(null);

  /* ⚠️ ONE EFFECT, AND THE OBSERVER STARTS THE LOAD ITSELF. Splitting this into
     "observe" and "load" needed a piece of state that no render reads, and
     setting state from an effect body to reach the second one is a cascading
     render — react-hooks/set-state-in-effect refuses it, correctly. The
     observer's callback is already the right place to act. */
  React.useEffect(() => {
    const el = ref.current;
    /* Before hydration `resolved` is the server's assumption, not this
       visitor's theme, so committing to a cut now could fetch the wrong one —
       megabytes then thrown away. The still is already on screen. */
    if (!el || !isHydrated) return;

    const want = CUTS[clip][resolved === 'dark' ? 'dark' : 'light'];

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
       playing by the time it is read. On a theme change this effect re-runs and
       observes afresh: if the element is on screen the callback fires at once
       and the cut swaps; if it is not, the swap waits until it is looked at,
       which is exactly when it matters. */
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
  }, [clip, resolved, isHydrated, lazy]);

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
