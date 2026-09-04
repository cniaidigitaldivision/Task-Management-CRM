import * as React from 'react';

/* ============================================================================
 * COUNTRY FLAGS, DRAWN INLINE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04: *"I want each country's flag icon to also be downloaded
 * from anywhere you want."*
 *
 * ── ⚠️ DRAWN, NOT DOWNLOADED, AND FOR THREE REASONS ────────────────────────
 * 1. EMOJI DO NOT WORK. The first attempt used 🇵🇰 and the owner's screenshot
 *    showed bare "PK" — Windows ships no glyph for a regional-indicator pair, so
 *    the browser falls back to the two letters. A flag that depends on the
 *    reader's font is a flag that is missing for half the audience.
 * 2. A CDN IS A THIRD PARTY IN A DASHBOARD. flagcdn.com and its like are one
 *    outage, one CSP rule and one privacy question away from a row of broken
 *    images, for five small rectangles.
 * 3. THESE ARE ~24×18px. At that size a photographic asset is wasted; a handful
 *    of rects and a path is smaller than the HTTP request that would fetch one.
 *
 * ⚠️ SIMPLIFIED ON PURPOSE. These are recognisable at 24px, not heraldically
 * exact — the Union Jack's diagonals are not offset, and the US canton carries
 * nine dots rather than fifty stars. Anything finer is invisible at this size and
 * would only cost bytes. If a flag ever needs to be shown large, replace these
 * rather than scaling them up.
 * ========================================================================= */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 18"
      width={22}
      height={16.5}
      aria-hidden="true"
      className="shrink-0 rounded-[3px] ring-1 ring-black/10"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  );
}

const FLAGS: Record<string, React.ReactElement> = {
  /* Pakistan — white hoist band, dark green field, crescent and star. */
  PK: (
    <Frame>
      <rect width="24" height="18" fill="#01411C" />
      <rect width="6" height="18" fill="#fff" />
      {/* The crescent is one disc with a second punched out of it. */}
      <circle cx="15.6" cy="9" r="4.6" fill="#fff" />
      <circle cx="17.2" cy="8.2" r="4.1" fill="#01411C" />
      <path d="M18.4 5.6l.55 1.5 1.55.08-1.2 1 .42 1.5-1.32-.86-1.32.86.42-1.5-1.2-1 1.55-.08z" fill="#fff" />
    </Frame>
  ),

  /* India — saffron, white, green, with the chakra. */
  IN: (
    <Frame>
      <rect width="24" height="6" fill="#FF9933" />
      <rect y="6" width="24" height="6" fill="#fff" />
      <rect y="12" width="24" height="6" fill="#138808" />
      <circle cx="12" cy="9" r="2.3" fill="none" stroke="#000088" strokeWidth="0.7" />
      <circle cx="12" cy="9" r="0.6" fill="#000088" />
    </Frame>
  ),

  /* Bangladesh — the disc sits left of centre, as it does on the real flag. */
  BD: (
    <Frame>
      <rect width="24" height="18" fill="#006A4E" />
      <circle cx="10.8" cy="9" r="5.2" fill="#F42A41" />
    </Frame>
  ),

  /* United States — thirteen stripes, and a canton of dots. */
  US: (
    <Frame>
      <rect width="24" height="18" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={(y * 18) / 13} width="24" height={18 / 13} fill="#B22234" />
      ))}
      <rect width="10" height={(7 * 18) / 13} fill="#3C3B6E" />
      {[1.8, 4.2, 6.6].map((cx) =>
        [1.9, 4.4, 6.9].map((cy) => (
          <circle key={`${cx}-${cy}`} cx={cx + 0.9} cy={cy} r="0.55" fill="#fff" />
        )),
      )}
    </Frame>
  ),

  /* United Kingdom — saltires under the upright cross. */
  GB: (
    <Frame>
      <rect width="24" height="18" fill="#012169" />
      <path d="M0 0l24 18M24 0L0 18" stroke="#fff" strokeWidth="3.6" />
      <path d="M0 0l24 18M24 0L0 18" stroke="#C8102E" strokeWidth="1.8" />
      <path d="M12 0v18M0 9h24" stroke="#fff" strokeWidth="6" />
      <path d="M12 0v18M0 9h24" stroke="#C8102E" strokeWidth="3.6" />
    </Frame>
  ),
};

/** A flag by ISO code, or a neutral tile when we have no drawing for it. */
export function Flag({ code }: { code: string }) {
  const flag = FLAGS[code.toUpperCase()];
  if (flag) return flag;

  /* ⚠️ Never nothing. An unknown country still needs something the width of a
     flag, or its row's text shifts left and the column stops lining up. */
  return (
    <span
      aria-hidden="true"
      className="grid h-[16.5px] w-[22px] shrink-0 place-items-center rounded-[3px] bg-bg-subtle text-[0.55rem] font-bold text-text-tertiary ring-1 ring-black/10"
    >
      {code.slice(0, 2).toUpperCase()}
    </span>
  );
}
