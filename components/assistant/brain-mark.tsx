import * as React from 'react';
import Image from 'next/image';

import { cn } from '@/lib/utils';

/* ============================================================================
 * THE ASSISTANT'S FACE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"add the Taskly AI assistance [...] I am a Taskly AI
 * assistant."* And, on seeing the first version: *"You have added a circle and
 * a gradient or something like that. I don't want that. Just a brain is enough.
 * Don't make a circle around it or a boundary around it. Make some glow in the
 * back. That will be fine but it should be the same color as the brain [...]
 * Just make it a little more prominent."*
 *
 * ── ⚠️ WHAT WAS REMOVED, AND WHY IT WAS THERE ──────────────────────────────
 * The first version had three layers borrowed from `control-room.tsx`: a bloom,
 * a 1px ring ON the edge, and a faint inner fill. That treatment is right in its
 * original home, where the brain sits on a busy dashboard tile and needs a disc
 * to separate it from the panels around it.
 *
 * Here it was wrong twice over. The ring drew a hard boundary around a subject
 * whose whole appeal is that it is a cut-out with no boundary, and the inner
 * fill put a visible plate behind a transparent PNG. Both said "icon in a
 * button" on a surface that wanted "a brain, glowing".
 *
 * So: the artwork, a soft bloom behind it, and nothing else. No border, no
 * background, no plate.
 *
 * ── ⚠️ THE GLOW IS THE BRAIN'S CYAN, NOT THE BRAND TEAL ────────────────────
 * `--brain-glow` in tokens.css, and the note there explains why the two are not
 * interchangeable. Do not "correct" it to `--accent-primary`.
 *
 * ── ⚠️ ONE COMPONENT, FOUR SIZES, AND WHY THAT IS NOT OVER-ENGINEERING ─────
 * This appears at 22px beside every answer, at 34px in the drawer's title bar,
 * and at 112px in the greeting. Written inline at each site the bloom was
 * copied three times and had already drifted by the second — its blur is in
 * absolute pixels and does not scale with the box, so a 10px blur that looks
 * right at 112px is a grey smudge at 22px.
 *
 * Scaling the blur with the size is the reason this is a component.
 * ========================================================================= */

const SIZES = {
  /* ⚠️ Every one of these is a step up from the first version. Owner: *"Just
     make it a little more prominent."* The brain is the assistant's only mark,
     and at 20px beside a name it read as a bullet point. */
  xs: { box: 'h-[1.375rem] w-[1.375rem]', img: 44, blur: 5, spread: 0.75 },
  sm: { box: 'h-[2.125rem] w-[2.125rem]', img: 68, blur: 8, spread: 0.8 },
  md: { box: 'h-14 w-14', img: 112, blur: 12, spread: 0.85 },
  lg: { box: 'h-28 w-28', img: 224, blur: 20, spread: 0.9 },
} as const;

export function BrainMark({
  size = 'sm',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <span
      aria-hidden="true"
      className={cn('relative grid shrink-0 place-items-center', s.box, className)}
    >
      {/* ── The glow, and ONLY the glow ─────────────────────────────────────
          ⚠️ `-inset-[N]%` scaled with the box, so the bloom always spills the
          same PROPORTION past the artwork. A fixed inset would be a halo at
          22px and a hairline at 112px.

          ⚠️ It fades to transparent by 65%, well inside its own box, which is
          what keeps it a glow rather than a disc. A stop nearer the edge grows
          a visible rim — the circle the owner asked to remove, arriving by
          another route. */}
      <span
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: `-${Math.round((1 - s.spread) * 100)}%`,
          background: `radial-gradient(circle, rgb(var(--brain-glow) / var(--brain-glow-strength)) 0%, rgb(var(--brain-glow) / 0) 65%)`,
          filter: `blur(${s.blur}px)`,
        }}
      />

      {/* ⚠️ `h-full w-full`, not 86%. The brain used to be inset to sit inside
          the ring; with the ring gone, insetting it only makes the mark smaller
          than the space it occupies. */}
      <Image
        src="/dashboard/brain-cutout.png"
        alt=""
        width={s.img}
        height={s.img}
        /* ⚠️ Never `priority`. This is chrome on a page whose backdrop is a
           several-megabyte video; competing with it for the first paint is how
           the headline arrives late. */
        className="relative h-full w-full object-contain"
      />
    </span>
  );
}
