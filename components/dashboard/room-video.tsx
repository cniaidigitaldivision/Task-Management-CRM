'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE ROOM — a video backdrop, one cut per theme
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: a globe clip behind the whole dashboard, a bright one for
 * the light theme and a darker one for dark, with the tiles moved aside so the
 * globe shows through the middle.
 *
 * ── ⚠️ BOTH CUTS ARE MOUNTED; CSS PICKS ────────────────────────────────────
 * Swapping one element's `src` on a theme change tears the video down and
 * re-fetches it — a blank hole for as long as the network takes, every time
 * somebody presses the toggle. Two mounted elements swap instantly and neither
 * ever reloads, and the correct one is painted on the FIRST frame because the
 * choice is a CSS attribute selector rather than React state.
 *
 * The cost is that both files are fetched; the effect below pays it back by
 * pausing whichever cut is hidden, so only one is ever decoding.
 *
 * ── ⚠️ ABSOLUTE, NOT FIXED ──────────────────────────────────────────────────
 * `fixed` would be the nicer effect — a room that holds still while the page
 * scrolls over it. It cannot be relied on here: `.reveal-children > *` animates
 * a transform on this page's own wrapper, and a transformed ancestor becomes the
 * containing block for a fixed descendant, so the position would shift
 * mid-entrance. Written as what it actually is.
 *
 * ── ⚠️ THE SCRIM IS NOT OPTIONAL ────────────────────────────────────────────
 * The masthead sits directly on this backdrop with no card behind it. A video
 * playing under live text is exactly how a dashboard becomes unreadable at the
 * one moment the clip happens to brighten. The scrim holds contrast steady
 * whatever frame is showing, and is deliberately lighter over the top third so
 * the globe still reads through the corridor the grid leaves open.
 * ========================================================================= */

const CUTS = [
  { theme: 'light', src: '/dashboard/room-light.mp4' },
  { theme: 'dark', src: '/dashboard/room-dark.mp4' },
] as const;

export function RoomVideo() {
  const stage = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = stage.current;
    if (!node) return;

    /* ⚠️ CSS cannot pause a `<video>`, which is the only reason this component
       needs to be a Client Component at all. Three cases stop a clip, and each
       is one CSS alone would miss:

         · the cut is the hidden one — `display: none` stops the browser
           PAINTING a video but does not pause the element, which goes on
           reporting itself as playing. Measured: `paused` stayed false with the
           wrapper hidden. Whether a given engine also stops decoding is an
           implementation detail, and a backdrop nobody can see must not depend
           on one;
         · reduced motion — a looping clip behind the whole page is the largest
           piece of incidental motion here, so it holds on its first frame;
         · a backgrounded tab. */
    const settle = () => {
      const still =
        (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false) ||
        document.visibilityState === 'hidden';

      for (const video of node.querySelectorAll('video')) {
        /* `offsetParent` is null for a `display: none` element — a cheap and
           exact test for "is this the cut actually on screen". */
        const shown = video.offsetParent !== null;
        if (shown && !still) {
          void video.play().catch(() => {
            /* Autoplay can still be refused — a data-saver mode, an unusual
               policy. The first frame stays, which is the same room standing
               still, so there is nothing to recover from and nothing to
               report. */
          });
        } else {
          video.pause();
          /* Rewound, so what shows on a return is a deliberate first frame
             rather than wherever the pause happened to land. */
          video.currentTime = 0;
        }
      }
    };

    settle();

    const watchTheme = new MutationObserver(settle);
    watchTheme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const motion = window.matchMedia?.(REDUCED_MOTION_QUERY);
    motion?.addEventListener('change', settle);
    document.addEventListener('visibilitychange', settle);

    return () => {
      watchTheme.disconnect();
      motion?.removeEventListener('change', settle);
      document.removeEventListener('visibilitychange', settle);
    };
  }, []);

  return (
    <div
      ref={stage}
      aria-hidden="true"
      className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-20 overflow-hidden rounded-2xl"
    >
      {/* ── ⚠️ NATURAL ASPECT, TOP-ANCHORED — NOT `object-cover` ─────────────
          Cover is wrong for these clips. The page is roughly square and the
          videos are 16:9, so cover scales by HEIGHT — about 1.7× — and crops
          800px of width, blowing the globe up far wider than any gap the cards
          could leave for it.

          At natural aspect (`w-full`, height by ratio) the globe lands about
          450px across and dead centre, which is exactly the corridor the grid
          leaves open. Anchored to the top so it sits in the stage row.

          ⚠️ `room-cut-light` is the DEFAULT and dark is the exception, because
          `:root` is the light palette in styles/tokens.css — the default has to
          be the light case. */}
      {CUTS.map((cut) => (
        <video
          key={cut.theme}
          src={cut.src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          data-room={cut.theme}
          className={cn('room-cut absolute inset-x-0 top-0 w-full')}
          style={{
            /* Owner, 2026-08-26: *"there is a lot of overlay added. Can you
               reduce it?"* Raised from 0.62 — the clip now carries most of the
               backdrop and the scrim below only protects the text. */
            opacity: 0.9,
            /* The clip's own bottom edge is faded out. Without this the video
               simply STOPS partway down the page, and because its lowest rows
               are the darker studio floor, the cut showed as a hard horizontal
               seam across the full width. The scrim cannot hide it — the scrim
               covers the whole wrapper, so it dims both sides of the join
               equally. */
            maskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
          }}
        />
      ))}

      {/* ── ⚠️ THE SCRIM IS DARK-THEME ONLY ──────────────────────────────────
          Owner, 2026-08-26: *"remove overlay in light theme."* It is gone
          there entirely — `.room-scrim` is `display: none` under light — so the
          clip plays at full strength and the page reads as the room itself.

          It is KEPT for dark, and that is not an oversight. The dark clip is a
          bright globe on near-black, and the tiles below it are translucent
          glass: without a wash, the light text in the lower half sits directly
          over the clip's brightest frames and the contrast swings as it plays.
          The light clip is a pale studio, so nothing there needs protecting.

          One theme needs it, one does not — so it is drawn for one and not the
          other, rather than compromised for both. */}
      <span
        className="room-scrim absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in oklab, var(--bg-base) 10%, transparent) 0%, color-mix(in oklab, var(--bg-base) 18%, transparent) 42%, color-mix(in oklab, var(--bg-base) 64%, transparent) 70%, var(--bg-base) 90%)',
        }}
      />
    </div>
  );
}
