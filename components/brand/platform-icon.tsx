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
import { brandMark } from '@/lib/brand/service-marks';

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
 * The app-icon tile for ANY brand mark — a platform or a service.
 *
 * ── ⚠️ EXTRACTED FROM `PlatformIcon` ON 2026-08-24, AND NOT COPIED ───────────
 * Credentials now draw real logos too (Gmail, WordPress, cPanel, Meta — see
 * `lib/brand/service-marks.ts`), and they have to look identical to the platform
 * tiles beside them on the same screens. Everything that makes a tile a tile lives
 * here exactly once: the 28% rounding, the 0.62 glyph ratio, the inset hairline,
 * the Instagram gradient, LinkedIn's geometry, and the knockout tone. A second
 * renderer for the same tile is how a Gmail row ends up one pixel rounder than the
 * Instagram row under it.
 *
 * `aria-hidden` throughout: every caller renders the brand's NAME beside it, so
 * announcing the logo as well would read the same thing twice.
 *
 * ⚠️ `markKey` is passed separately from `mark` because two marks need a special
 * case that the data cannot carry — Instagram is a gradient rather than a flat
 * hex, and LinkedIn is shapes rather than a path. Both are documented in
 * `platform-marks.ts`; this is where they are honoured.
 */
export function BrandTile({
  mark,
  markKey,
  className,
  size = 20,
}: {
  mark: PlatformMark;
  /** The key it was looked up by, for the two marks that need one. */
  markKey?: string;
  className?: string;
  size?: number;
}) {
  const fill = mark.glyph === 'dark' ? '#111111' : '#FFFFFF';

  /* ══ FULL-COLOUR LOGOS ══════════════════════════════════════════════════════
     Owner, 2026-08-24, of the Access tab: *"use gmail this icon"* — the four-colour
     M rather than the white-on-red silhouette.

     ── ⚠️ A WHITE TILE, NOT THE BRAND COLOUR ────────────────────────────────
     A multicolour mark has no single colour to sit on: painting Gmail's red M on a
     red tile makes it vanish, and picking one of its four would be arbitrary. So it
     gets white, which is what Gmail's own app icon uses and what the owner's image
     shows.

     ⚠️ WHITE IN BOTH THEMES, deliberately. A brand's colours are fixed — Gmail's
     blue is Gmail's blue at midnight — and re-grounding them on a dark surface
     would either wash the pale segments out or require inventing a dark-mode
     Gmail, which is not a thing. The border is what keeps a white tile from
     glaring against a dark surface. */
  /* ══ REAL MULTI-PATH ARTWORK ═══════════════════════════════════════════════
     Checked FIRST, before the clipped-layers form: a mark carrying its own paths
     has nothing to reconstruct, so there is no reason to prefer the approximation.
     Same white tile and the same reasoning as below — a logo of several colours has
     no single colour to sit on. */
  if (mark.art) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-grid shrink-0 place-items-center rounded-[28%]', className)}
        style={{
          width: size,
          height: size,
          background: '#FFFFFF',
          boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.10)',
        }}
      >
        <svg
          viewBox={mark.art.viewBox}
          width={size * 0.72}
          height={size * 0.72}
          role="presentation"
          focusable="false"
        >
          {mark.art.paths.map((piece, i) => (
            <path key={i} d={piece.d} fill={piece.fill} />
          ))}
        </svg>
      </span>
    );
  }

  if (mark.layers && mark.path) {
    /* The clip ids have to be unique per tile: two Gmail rows on one page would
       otherwise share ids, and every browser resolves a duplicate id to the FIRST
       one in the document — so the second tile would silently take the first's
       clipping. `React.useId` is not usable here (this is called from list
       callbacks, not always a component boundary), so the key and index compose
       into something stable and local instead. */
    const idBase = `bm-${markKey ?? 'x'}`;

    return (
      <span
        aria-hidden="true"
        className={cn('inline-grid shrink-0 place-items-center rounded-[28%]', className)}
        style={{
          width: size,
          height: size,
          background: '#FFFFFF',
          /* Darker hairline than the brand tiles get: white needs a real edge on a
             white-ish surface, where a brand colour supplies its own. */
          boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.10)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          /* Slightly larger than the 0.62 a knocked-out glyph gets. That ratio
             exists to leave a coloured margin around a white mark; here the tile is
             white, so the art has to fill more of it or the logo looks lost. */
          width={size * 0.74}
          height={size * 0.74}
          role="presentation"
          focusable="false"
        >
          <defs>
            {mark.layers.map((layer, i) =>
              layer.clip ? (
                <clipPath key={i} id={`${idBase}-${i}`}>
                  <rect
                    x={layer.clip[0]}
                    y={layer.clip[1]}
                    width={layer.clip[2]}
                    height={layer.clip[3]}
                  />
                </clipPath>
              ) : null,
            )}
          </defs>
          {mark.layers.map((layer, i) => (
            <path
              key={i}
              d={mark.path}
              fill={layer.fill}
              clipPath={layer.clip ? `url(#${idBase}-${i})` : undefined}
            />
          ))}
        </svg>
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
        background: markKey === 'instagram' ? INSTAGRAM_GRADIENT : mark.hex,
        /* A hairline of the brand colour, so a black tile (X, TikTok, Threads,
           Anthropic) still has an edge against a dark theme's surface. */
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
        {markKey === 'linkedin' ? (
          <LinkedInGlyph fill={fill} />
        ) : (
          <path d={mark.path} fill={fill} />
        )}
      </svg>
    </span>
  );
}

/**
 * A monogram tile, for a brand we hold no mark for.
 *
 * Shared for the same reason `BrandTile` is: a platform added to the database
 * tomorrow and a credential pointing at Outlook both land here, and they should
 * land in the same place.
 */
export function MonogramTile({
  name,
  className,
  size = 20,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[28%] bg-bg-active font-semibold text-text-secondary',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function PlatformIcon({
  slug,
  className,
  size = 20,
}: {
  slug: string;
  className?: string;
  size?: number;
}) {
  /* ── ⚠️ `brandMark`, NOT `platformMark` ────────────────────────────────────
     This looked in PLATFORM_MARKS only, so the Documents header asked for
     `googledrive` — which lives in SERVICE_MARKS — and got a grey "G" monogram
     where the Drive logo should have been. The symptom was on screen and easy to
     miss: a tile appeared, it just was not the logo.

     `brandMark` resolves across both tables and exists for exactly this, in its
     own words: *"A renderer only ever wants 'the tile for this mark' and should
     not have to know which table a key came from."* This component is that
     renderer. Platform marks still win a name collision, because the lookup order
     is unchanged. */
  const mark = brandMark(slug);

  /* An unknown key gets a neutral tile with its first letter rather than a hole.
     A platform added to the database tomorrow must not break this row. */
  if (!mark) return <MonogramTile name={slug} size={size} className={className} />;

  return <BrandTile mark={mark} markKey={slug} size={size} className={className} />;
}
