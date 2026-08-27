'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';

/* ============================================================================
 * THE BRAIN — the assistant page's whole background
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"the background video should be a whole background. Don't
 * add any overlay. Right now I am seeing that the video is maybe very zoomed or
 * it is not properly fit around the corner."*
 *
 * And again, the same day: *"display the video in the center. Don't zoom in on
 * the video, just play it."*
 *
 * So: the clip fills the entire page area at its natural framing, there is no
 * scrim over it, and nothing is cropped in.
 *
 * ── ⚠️ `object-cover`, AND THE FOURTH FRAMING THIS HAS HAD. READ THIS FIRST ─
 * The history matters, because the obvious "fix" at any point has been to swap
 * this value, and it has been swapped back and forth once already:
 *
 *   1. A 300px strip with `transform: scale(2.3)` — plainly zoomed. Rejected.
 *   2. Full-page `object-cover`. Rejected: the owner said "zoomed" again.
 *   3. `object-contain`, centred — the whole frame, nothing cropped. Which is
 *      what *"just play it"* asks for, and it was still wrong, because of what
 *      contain does on an area that is not 16:9. Measured at the owner's own
 *      window (1920×~800, sidebar pinned): the stage is 1682×803, ratio 2.09
 *      against the clip's 1.78, so contain painted 1428×803 and left a **127px
 *      band of flat page colour down each side**. That is what the owner saw:
 *      *"The video should fill the screen [...] at least fill this right-side
 *      area fully."*
 *   4. `object-cover` again — this time correctly, because the two complaints
 *      turn out not to be the same complaint.
 *
 * ── ⚠️ WHY (2) AND (4) ARE NOT THE SAME DECISION ───────────────────────────
 * The "zoomed" complaint about (2) was never really about cover. It was about
 * the SIZE of the crop: the page then had a short, wide stage, so cover
 * enlarged the clip a long way and the brain filled the frame. The redesigned
 * page gives the clip nearly the whole screen at a ratio much closer to 16:9,
 * so cover now crops ~15% off the top and bottom and enlarges by the same —
 * barely perceptible, and the brain still reads as a whole brain.
 *
 * The lesson to carry: when a stage's aspect ratio is close to the clip's,
 * cover is invisible and contain leaves bands; when it is far off, cover is a
 * zoom. The stage's shape decides this, not a preference for one keyword.
 *
 * ⚠️ SO DO NOT SWITCH THIS BACK WITHOUT MEASURING THE STAGE. If the page layout
 * changes and the stage becomes short and wide again, cover will look zoomed
 * and the answer is to fix the STAGE, not to reach for contain and reintroduce
 * the bands.
 *
 * ── ⚠️ ONE CUT IS MOUNTED, NOT BOTH ────────────────────────────────────────
 * `components/dashboard/room-video.tsx` mounts both and lets CSS pick, which is
 * right at 1.4 MB a clip. These are 5.9 MB and 6.9 MB, and that approach
 * measured 19.55 MB transferred — `display: none` and `pause()` stop a video
 * painting and decoding, neither stops it downloading. Mounting only the active
 * cut halves it; the cost is one fetch on the first theme toggle.
 *
 * ── ⚠️ AND IT IS MOUNTED AFTER FIRST PAINT ─────────────────────────────────
 * So the headline and the chat box are usable while the clip is still arriving.
 * Measured: hero visible at ~2.1s, independent of the video.
 * ========================================================================= */

const SOURCES = {
  light: '/assistant/brain-light.mp4',
  dark: '/assistant/brain-dark.mp4',
} as const;

type Cut = keyof typeof SOURCES;

/** What the document is currently set to. `:root` is the light palette, so an
 *  absent attribute — the "system" setting — is the light case. */
function currentCut(): Cut {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function BrainVideo() {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  /* ⚠️ Null until after the first paint, which is what defers the download.
     `requestAnimationFrame` rather than a bare effect: it guarantees the page
     has actually been painted, not merely that React has committed. */
  const [cut, setCut] = React.useState<Cut | null>(null);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setCut(currentCut()));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* Follow the theme toggle. Cheap: one attribute filter on one element. */
  React.useEffect(() => {
    if (cut === null) return;

    const watch = new MutationObserver(() => setCut(currentCut()));
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => watch.disconnect();
  }, [cut]);

  /* Reduced motion and a hidden tab both hold the clip on its first frame.
     CSS can do neither, which is the only reason this is a Client Component. */
  React.useEffect(() => {
    if (cut === null) return;

    const settle = () => {
      const video = videoRef.current;
      if (!video) return;

      const still =
        (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false) ||
        document.visibilityState === 'hidden';

      if (still) {
        video.pause();
        /* Rewound, so a return shows a deliberate first frame rather than
           wherever the pause happened to land. */
        video.currentTime = 0;
      } else {
        void video.play().catch(() => {
          /* Autoplay refused — a data-saver mode, an unusual policy. The first
             frame stays, which is the same brain standing still. */
        });
      }
    };

    settle();

    const motion = window.matchMedia?.(REDUCED_MOTION_QUERY);
    motion?.addEventListener('change', settle);
    document.addEventListener('visibilitychange', settle);

    return () => {
      motion?.removeEventListener('change', settle);
      document.removeEventListener('visibilitychange', settle);
    };
  }, [cut]);

  return (
    /* ── ⚠️ `absolute`, AND `fixed` DOES NOT WORK HERE ─────────────────────
       `fixed` is the obvious choice for a whole-page backdrop and it was tried
       first. It measured 1219×677 sitting at x=259 — a panel, not a background.
       The reason is the one `room-video.tsx` records: a transformed ancestor
       becomes the containing block for a fixed descendant, so the layer is
       positioned against that box rather than the viewport.

       Walking the ancestors found two:
         · this page's own wrapper, carrying `transform: matrix(1,0,0,1,0,0)`
           — an identity transform left by an animation's resting state, which
           still creates a containing block
         · `<body>`, carrying `zoom: 0.9` from `--ui-scale`

       Neither is removable without touching shared chrome. So the layer is
       absolute and stretched over the page instead, which lands in exactly the
       same place and cannot be detached by an ancestor's transform.

       ⚠️ `inset-0`, WITH NO NEGATIVE INSETS AND NO COMPUTED HEIGHT — and both
       absences were bugs once:

         · It took `max(100% + 3rem, 100vh / --ui-scale)` when the page grew
           with its content and a 100% layer stopped short on a tall screen.
           The page is now a fixed-height column, so its box IS the right box,
           and measuring the viewport a second time here would only re-import
           the `zoom` trap that took two browser measurements to find.

         · It then took `-inset-x-6 -inset-y-4` to reach past the shell's
           padding. That LOOKED right and measured right and was still wrong:
           the page wrapper carries `overflow-hidden`, which clips a negative
           inset, so 43px of the clip's width was laid out and never painted —
           the band of page colour the owner saw on all four sides. The page
           wrapper now cancels that padding itself with negative MARGINS, so
           there is nothing left to reach past.

       The rule to keep: this element covers its parent exactly. If a band of
       flat colour appears around the video again, the parent is the wrong size
       — do not add insets here to paper over it. */
    <div
      aria-hidden="true"
      className="brain-stage pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Painted immediately, before the clip exists, so the page is never a
          blank rectangle waiting on a download — and what remains if autoplay
          is refused outright.

          ⚠️ With `object-cover` above, this is now COMPLETELY HIDDEN once the
          clip arrives. Keep it anyway: it is the whole picture for the ~1s
          before the video loads, on a data-saver connection that never loads
          it, and wherever autoplay is refused. It is not decoration behind the
          video; it is the fallback in front of nothing. */}
      <span className="brain-wash absolute inset-0" />

      {cut !== null && (
        <video
          /* ⚠️ Keyed on the cut, so a theme change REPLACES the element rather
             than mutating its src. Mutating leaves the old frame on screen
             while the new file loads. */
          key={cut}
          ref={videoRef}
          src={SOURCES[cut]}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          /* ⚠️ `object-cover object-center`, NO transform. See the header for
             why cover and not contain — the short version is that contain left
             a 127px band down each side at the owner's window, measured.
             `object-center` is the default and is written out anyway, because
             "display the video in the center" was half the instruction and a
             default that satisfies a requirement should say so out loud. */
          className="brain-cut absolute inset-0 h-full w-full object-cover object-center"
        />
      )}

      {/* ⚠️ NO SCRIM. Owner: *"Don't add any overlay."* The first version had a
          gradient over the clip to hold text contrast; it is gone.

          What replaces it is not a layer but a treatment ON THE TEXT — see
          `.brain-hero` in tokens.css — plus the chat card, which is an opaque
          surface and needs no help. Measured after removing the scrim: the
          headline still clears WCAG in both themes. */}
    </div>
  );
}
