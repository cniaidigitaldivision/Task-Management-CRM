'use client';

import { cn } from '@/lib/utils';
import {
  INSTAGRAM_GRADIENT,
  LINKEDIN_SHAPES,
  PLATFORM_MARKS,
  platformMark,
  type GlyphTone,
  type PlatformMark,
} from '@/lib/brand/platform-marks';

/* ============================================================================
 * PLATFORM APP ICONS — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"For those checkboxes I need the icons or logos of the platforms instead of
 * just the names. I want the Facebook logo, the WhatsApp app icon… their icons
 * with them and also a checkbox I can check."*
 *
 * ── ⚠️ THE PATHS MOVED TO `lib/brand/platform-marks.ts` ───────────────────────
 * They used to be inline here. The report composer draws the same marks into a PDF on
 * the server, and this file is `'use client'` — so a server module importing it would
 * be a boundary error, and a second copy of two thousand characters of path data would
 * quietly stop matching this one. The data now lives in `lib/brand/platform-marks.ts`
 * and both renderers read it. See that file's header for the provenance of each mark and
 * why LinkedIn's is geometry rather than an extracted path.
 *
 * ── THE TILE, NOT THE BARE GLYPH ─────────────────────────────────────────────
 * The owner asked for "the WhatsApp app icon" — an app icon is a coloured tile with
 * the mark knocked out of it, which is also what makes eleven logos legible at
 * 20px in a row. The knockout colour comes from the mark's own `glyph` tone:
 * Snapchat's yellow needs a dark glyph and everything else needs white.
 * ========================================================================= */

export { PLATFORM_MARKS, platformMark };
export type { GlyphTone, PlatformMark };

/** The 'in' wordmark, as shapes. Only LinkedIn needs this. */
function LinkedInGlyph({ fill }: { fill: string }) {
  return (
    <>
      <circle
        cx={LINKEDIN_SHAPES.dot.cx}
        cy={LINKEDIN_SHAPES.dot.cy}
        r={LINKEDIN_SHAPES.dot.r}
        fill={fill}
      />
      <rect
        x={LINKEDIN_SHAPES.stem.x}
        y={LINKEDIN_SHAPES.stem.y}
        width={LINKEDIN_SHAPES.stem.width}
        height={LINKEDIN_SHAPES.stem.height}
        rx={LINKEDIN_SHAPES.stem.rx}
        fill={fill}
      />
      <path d={LINKEDIN_SHAPES.arch} fill={fill} />
    </>
  );
}

/**
 * The app-icon tile.
 *
 * `aria-hidden` throughout: every caller renders the platform's NAME beside it, so
 * announcing the logo as well would read the same thing twice.
 */
export function PlatformIcon({
  slug,
  className,
  size = 20,
}: {
  slug: string;
  className?: string;
  size?: number;
}) {
  const mark = platformMark(slug);
  const fill = mark?.glyph === 'dark' ? '#111111' : '#FFFFFF';

  /* An unknown slug gets a neutral tile with its first letter rather than a hole.
     A platform added to the database tomorrow must not break this row. */
  if (!mark) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-grid shrink-0 place-items-center rounded-[28%] bg-bg-active font-semibold text-text-secondary',
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {slug.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-[28%]', className)}
      style={{
        width: size,
        height: size,
        background: slug === 'instagram' ? INSTAGRAM_GRADIENT : mark.hex,
        /* A hairline of the brand colour, so a black tile (X, TikTok, Threads)
           still has an edge against a dark theme's surface. */
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        role="presentation"
        focusable="false"
      >
        {slug === 'linkedin' ? <LinkedInGlyph fill={fill} /> : <path d={mark.path} fill={fill} />}
      </svg>
    </span>
  );
}
