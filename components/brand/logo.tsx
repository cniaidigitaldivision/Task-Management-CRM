/* ============================================================================
 * CNI — AI & DIGITAL DIVISION · LOGO
 * ----------------------------------------------------------------------------
 * FR-200 · FR-209
 *
 * ⛔ THE LOGO IS USED EXACTLY AS SUPPLIED. It is never recreated, recoloured,
 *    cropped, stretched or altered in any way.
 *
 * Source artwork : logo/Gemini_Generated_Image_dnmem1dnmem1dnme.png
 * Served from    : public/brand/cni-ai-digital-division.png
 * Natural size   : 2390 × 1792 (4:3), transparent background
 *
 * How the rules are enforced here:
 *   · Only ONE dimension is ever specified; the other is derived from the
 *     natural ratio. Independent width/height would distort it.
 *   · `object-contain` guarantees letterboxing rather than cropping if a
 *     container is ever the wrong shape.
 *   · next/image optimises delivery (WebP, correct resolution) so the 5 MB
 *     source is never shipped to a browser — the artwork is untouched, only
 *     the transport is efficient.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE GLOW, TWICE REVISED  (owner decisions, sessions 08 and 15)
 *
 * Session 08: "The white plate behind it does not look good. Behind the logo
 * just add a gradient glow of gold colour." A plate was replaced by a
 * four-layer bloom with a near-opaque cream core.
 *
 * Session 15: "the gradient behind it is too much glowing… it's shouting too
 * much." Correct. It is now ONE warm layer at low alpha, fading within about a
 * tenth of the artwork's width.
 *
 * ⚠️ THAT CHANGE HAD A CONSEQUENCE, AND IT IS THE REASON <LogoMark> EXISTS.
 * The cream core was not decoration. The supplied wordmark "AI & DIGITAL" is
 * dark teal, and the navigation rail is #071e22 — a contrast ratio of roughly
 * 2.3:1, which is unreadable. The core was the light field underneath it.
 *
 * Remove the core and the full artwork simply cannot go on the rail. So the
 * rail now shows <LogoMark> — the brain alone, which is teal AND gold and
 * reads perfectly on dark — with the division name set as real HTML beside it,
 * taking its colour from the rail's own tokens.
 *
 * The full artwork stays where it belongs: the sign-in screen, which is white.
 *
 * The gradient lives in styles/tokens.css (`.brand-glow`) because a component
 * may not contain a raw colour (BR-025).
 * ========================================================================= */

import Image from 'next/image';

import { DIVISION_NAME, ORGANISATION_NAME, ORGANISATION_SHORT_NAME } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

const LOGO_SRC = '/brand/cni-ai-digital-division.png';
const NATURAL_WIDTH = 2390;
const NATURAL_HEIGHT = 1792;
const ALT = `${ORGANISATION_NAME} — ${DIVISION_NAME}`;

/* --------------------------------------------------------------------------
 * Base image
 * ------------------------------------------------------------------------ */

export function Logo({
  width,
  className,
  priority = false,
  decorative = false,
}: {
  /** Rendered width in px. Height is always derived from the natural ratio. */
  width: number;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
}) {
  // Derived, never specified independently — this is what makes distortion
  // structurally impossible rather than merely avoided by convention.
  const height = Math.round((width * NATURAL_HEIGHT) / NATURAL_WIDTH);

  return (
    <Image
      src={LOGO_SRC}
      alt={decorative ? '' : ALT}
      width={width}
      height={height}
      priority={priority}
      aria-hidden={decorative || undefined}
      className={cn('h-auto w-auto max-w-full object-contain select-none', className)}
      style={{ width, height }}
      draggable={false}
      quality={95}
      sizes={`${width}px`}
    />
  );
}

/* --------------------------------------------------------------------------
 * Brand glow — the logo lit from behind
 * ------------------------------------------------------------------------ */

/**
 * The artwork sitting in a soft gold aura. Replaces the old white plate.
 *
 * `size` picks the glow's spread, not the logo's width — a hero lockup needs a
 * far wider bloom than a 40px rail mark for the effect to read at all.
 */
export function LogoGlow({
  width = 168,
  size = 'md',
  className,
  priority = false,
  decorative = false,
}: {
  width?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  priority?: boolean;
  decorative?: boolean;
}) {
  return (
    <span
      className={cn(
        'brand-glow inline-flex items-center justify-center',
        size === 'sm' && 'brand-glow-sm',
        size === 'lg' && 'brand-glow-lg',
        className,
      )}
    >
      <Logo width={width} priority={priority} decorative={decorative} />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * The mark alone
 * ------------------------------------------------------------------------ */

/* ── MEASURED, NOT EYEBALLED ──────────────────────────────────────────────
   Read off the artwork's own alpha channel: the opaque pixels fall into three
   bands with clear gaps between them.

     0.102 – 0.657   the polygonal brain          ← this is the mark
     0.701 – 0.816   "AI & DIGITAL", dark teal    ← unreadable on the rail
     0.859 – 0.922   "DIVISION", gold

   The brain spans 0.227 – 0.850 horizontally. Those exact figures plus about a
   percent of breathing room are below, as fractions so they survive the artwork
   being re-exported at a different resolution.

   Re-derive with: sharp(src).ensureAlpha().raw() and count opaque pixels per
   row. Do not adjust these by guessing — the second band is only 4% of the
   height away from the first, and clipping into it puts half a letterform in
   the sidebar. */
const MARK = { left: 0.219, top: 0.092, width: 0.639, height: 0.575 } as const;
const MARK_RATIO = (MARK.width * NATURAL_WIDTH) / (MARK.height * NATURAL_HEIGHT);

/**
 * The polygonal brain, without the wordmark.
 *
 * ⛔ THE ARTWORK IS STILL NOT ALTERED. Nothing is redrawn, recoloured or
 *    re-exported — the same file is served and a window of it is shown, the way
 *    a picture frame shows part of a photograph. The rule that matters is that
 *    the logo is never *changed*, and it is not.
 *
 * Cropped with CSS rather than a second image file for a practical reason: one
 * asset cannot fall out of step with another. A separate mark-only PNG would be
 * one more thing to re-export the day the brand is refreshed, and the day
 * somebody forgets is the day the rail and the sign-in screen disagree.
 */
export function LogoMark({
  width = 40,
  className,
  priority = false,
}: {
  width?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn('relative block overflow-hidden', className)}
      style={{ width, height: Math.round(width / MARK_RATIO) }}
    >
      <Image
        src={LOGO_SRC}
        alt=""
        aria-hidden="true"
        width={NATURAL_WIDTH}
        height={NATURAL_HEIGHT}
        priority={priority}
        sizes={`${Math.round(width / MARK.width)}px`}
        className="absolute max-w-none"
        style={{
          width: `${100 / MARK.width}%`,
          /* Percentages on an absolutely positioned box resolve against the
             CONTAINER, not the image — so the image's own offsets are converted
             into container terms here rather than looking obviously wrong. */
          left: `-${(MARK.left / MARK.width) * 100}%`,
          top: `-${(MARK.top / MARK.height) * 100}%`,
          height: 'auto',
        }}
      />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Lockups
 * ------------------------------------------------------------------------ */

/** Large, centred — sign-in, activation, empty states. */
export function LogoHero({ className, width = 300 }: { className?: string; width?: number }) {
  return (
    <span className={cn('inline-flex flex-col items-center', className)}>
      <LogoGlow width={width} size="lg" priority />
    </span>
  );
}

/**
 * The navigation rail.
 *
 * ── WHY THIS IS THE MARK PLUS TEXT, NOT THE ARTWORK ──────────────────────────
 * It used to be the whole artwork, which worked only because a near-opaque
 * cream glow sat behind it. With the glow reduced to a whisper — the owner's
 * instruction in session 15 — the supplied wordmark "AI & DIGITAL" is dark teal
 * on a #071e22 rail, about 2.3:1. Unreadable.
 *
 * The brain is teal AND gold and reads beautifully on dark. So the brain is the
 * image, and the words are words: real HTML, taking their colour from
 * `--sidebar-heading` and `--sidebar-muted`, crisp at any zoom, selectable,
 * and legible by construction rather than by luck.
 *
 * Collapsed, the text goes and the mark stays.
 */
export function LogoSidebar({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="brand-glow brand-glow-sm inline-flex shrink-0">
        <LogoMark width={collapsed ? 38 : 42} priority />
      </span>

      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className="truncate text-body-sm font-semibold tracking-tight"
            style={{ color: 'var(--sidebar-heading)' }}
          >
            {ORGANISATION_SHORT_NAME} {'·'} CRM
          </span>
          <span
            className="truncate text-micro"
            style={{ color: 'var(--sidebar-muted)' }}
          >
            {DIVISION_NAME}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Compact horizontal lockup: the glowing mark plus typeset text.
 *
 * For places too small for the full artwork to be legible — a browser tab
 * strip, a mobile header, an email signature block. The text is real HTML, so
 * it stays crisp at any size and takes its colour from the surface it is on.
 */
export function LogoWordmark({
  className,
  markWidth = 40,
}: {
  className?: string;
  markWidth?: number;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoGlow width={markWidth} size="sm" decorative />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-body-sm font-semibold tracking-tight">
          {ORGANISATION_SHORT_NAME} CRM
        </span>
        <span className="mt-1 text-micro font-medium tracking-[0.06em] uppercase opacity-70">
          {DIVISION_NAME}
        </span>
      </span>
    </span>
  );
}
