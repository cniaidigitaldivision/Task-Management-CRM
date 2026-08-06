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
 * THE GLOW REPLACED THE PLATE  (owner decision, Session 08)
 *
 *   "The white plate behind it, the white space behind it does not look good.
 *    Behind the logo just add a gradient glow of gold colour and make it more
 *    shaded so it enhances the effect of shading towards the logo."
 *
 * The plate existed for a real reason, and the glow had to inherit that job:
 * the supplied artwork's wordmark is dark teal, so on a dark rail it is
 * illegible. A plain coloured glow would have made the logo unreadable.
 *
 * <LogoGlow> solves both at once. Its core is a warm near-white at 97%
 * opacity, so the wordmark keeps a light field underneath it; from there it
 * graduates out through gold and fades to fully transparent. There is no
 * rectangle, no border and no hard edge — so there is no "white space" left to
 * notice, which was the actual complaint.
 *
 * The gradient itself lives in styles/tokens.css (`.brand-glow`) because a
 * component may not contain a raw colour (BR-025), and because a glow assembled
 * from four stacked layers belongs in one place rather than inline on a span.
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
 * Sidebar header.
 *
 * The artwork carries the wordmark, so nothing is set beside it at full width —
 * a second, typeset "CNI CRM" next to a logo that already says CNI would be
 * saying it twice. Collapsed, the glow tightens and the width halves.
 */
export function LogoSidebar({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <LogoGlow
      width={collapsed ? 40 : 150}
      size={collapsed ? 'sm' : 'md'}
      className={className}
      priority
    />
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
