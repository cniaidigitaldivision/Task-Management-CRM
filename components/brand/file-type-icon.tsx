import {
  FILE_TYPE_MARKS,
  FOLD_PATH,
  PAGE_PATH,
  type FileTypeMark,
} from '@/lib/brand/file-type-marks';

export { FILE_TYPE_MARKS };
export type { FileTypeMark };

/* ============================================================================
 * FILE-TYPE ICON — owner request 2026-09-04
 * ----------------------------------------------------------------------------
 * PDF · Excel · PPT · CSV · Google Slides, for the Reports & Exports drawer.
 * The shapes and colours live in `lib/brand/file-type-marks.ts`; see that file
 * for why these are drawn rather than being the vendors' own logos.
 *
 * ── ⚠️ NOT `'use client'`, ON PURPOSE ──────────────────────────────────────
 * It is a pure function of its props with no state, no effect and no handler,
 * so it renders on the server and ships no JavaScript. Marking it as a client
 * component would pull five icons' worth of markup into the bundle for nothing —
 * and the whole point of keeping the path data in `lib/brand/` is that a server
 * renderer can use it too.
 * ========================================================================= */

export function FileTypeIcon({
  type,
  size = 22,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const mark = FILE_TYPE_MARKS[type];
  if (!mark) return null;

  /* ⚠️ THE LETTERS SCALE WITH THE ICON but are floored, because below about
     6px a three-letter block is a grey smudge that reads as a rendering fault
     rather than as text. At that size the colour is doing the identifying. */
  const letterSize = Math.max(6, size * 0.3);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={mark.label}
    >
      <path d={PAGE_PATH} fill={mark.color} />
      {/* The turned corner, a shade darker so the fold reads as a fold. */}
      <path d={FOLD_PATH} fill={mark.block} fillOpacity="0.55" />
      {/* The letter block sits on the lower half, as every file-type icon does. */}
      <rect x="5" y="12.4" width="15" height="7.2" rx="1.4" fill={mark.block} />
      <text
        x="12.5"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={letterSize}
        fontWeight="700"
        /* A stack rather than a single family: this renders on Windows, macOS
           and in a headless Chrome, and a missing family would fall back to a
           serif that does not fit the block. */
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        letterSpacing="-0.3"
      >
        {mark.letters}
      </text>
    </svg>
  );
}
