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
 * One design consequence worth knowing: the wordmark in the artwork is dark
 * teal, so it is illegible on a dark background. Rather than alter the logo,
 * <LogoPlate> places it on a light surface that works in both themes.
 * ========================================================================= */

import Image from 'next/image';

import { DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';
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
 * Brand plate — the logo on a guaranteed-light surface
 * ------------------------------------------------------------------------ */

/**
 * Wraps the logo in a light panel so the dark-teal wordmark stays legible
 * against a dark sidebar or a dark theme. The plate is the thing that adapts;
 * the artwork never does.
 */
export function LogoPlate({
  width = 168,
  className,
  priority = false,
}: {
  width?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-xl border px-4 py-3',
        'shadow-sm transition-colors duration-[120ms]',
        className,
      )}
      style={{
        backgroundColor: 'var(--brand-plate-bg)',
        borderColor: 'var(--brand-plate-border)',
      }}
    >
      <Logo width={width} priority={priority} />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Lockups
 * ------------------------------------------------------------------------ */

/** Large, centred — sign-in, activation, empty states. */
export function LogoHero({ className, width = 280 }: { className?: string; width?: number }) {
  return (
    <span className={cn('inline-flex flex-col items-center', className)}>
      <Logo width={width} priority />
    </span>
  );
}

/** Sidebar header. Collapses to a compact plate when the rail is narrow. */
export function LogoSidebar({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <LogoPlate
      width={collapsed ? 44 : 158}
      className={cn(collapsed ? 'px-2 py-2' : 'px-4 py-3', className)}
      priority
    />
  );
}
