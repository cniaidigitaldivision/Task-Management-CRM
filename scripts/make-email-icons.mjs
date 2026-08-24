/* ============================================================================
 * THE EMAIL'S ICONS, AS PNG BYTES
 * ----------------------------------------------------------------------------
 * Generates lib/email/icons.ts. Run after changing any icon or colour:
 *
 *     node scripts/make-email-icons.mjs
 *
 * ── WHY NOT INLINE SVG, WHICH IS WHAT THE APP USES ───────────────────────────
 * Gmail strips <svg> entirely — the single most-used client for this team would
 * show nothing at all. Outlook's Word renderer is no better. So every icon in a
 * message has to arrive as a raster image, and the only way to make one appear
 * without a network fetch (blocked by default in most clients) is to attach it
 * and reference it by content id. Same mechanism as the header mark.
 *
 * ── EACH ICON IS FLATTENED ONTO THE COLOUR IT SITS ON ────────────────────────
 * A transparent PNG is a coin flip in email: Outlook composites some alpha onto
 * black, and a dark icon on a black square is worse than no icon. So the
 * background is baked in per icon, which is why the same shield appears twice
 * below with two different `bg` values.
 *
 * Rendered at 2x and displayed at half size, so it stays sharp on a phone.
 * ========================================================================= */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

/* Palette — copied from styles/tokens.css, same as templates.ts. */
const GOLD = '#d4a63c';
/* gold-800 — the only gold that passes contrast on a light panel (5.4:1), which
   is why the glyphs sitting on the tinted boxes are stroked in it and not in
   the brand gold above. */
const GOLD_DEEP = '#8c6417';
const TEAL = '#0e5c63';
const CHIP_BG = '#f8edd9'; /* gold-100 */
const PANEL_BG = '#f4f8f8'; /* neutral-50 */
const FOOT_BG = '#eef3f3';
const WHITE = '#ffffff';

/** Lucide-style stroked glyph, centred in a 24-unit box. */
const stroke = (paths, colour, width = 2) => `
  <g fill="none" stroke="${colour}" stroke-width="${width}"
     stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;

const USER_PLUS = `
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <line x1="19" y1="8" x2="19" y2="14"/>
  <line x1="22" y1="11" x2="16" y2="11"/>`;

const USERS = `
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>`;

const SHIELD = `
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  <circle cx="12" cy="11" r="1.6"/>
  <line x1="12" y1="12.6" x2="12" y2="15"/>`;

const MAIL = `
  <rect x="2" y="5" width="20" height="14" rx="2.5"/>
  <path d="m3 7 9 6 9-6"/>`;

/**
 * A glyph on a plain background.
 *
 * `pad` keeps the stroke off the edge — a 2-unit stroke at the boundary of the
 * viewBox is clipped in half, which reads as a broken icon rather than a thin one.
 */
function plain({ glyph, colour, bg, size, weight = 2 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-2 -2 28 28">
    <rect x="-2" y="-2" width="28" height="28" fill="${bg}"/>
    ${stroke(glyph, colour, weight)}
  </svg>`;
  return Buffer.from(svg);
}

/**
 * A glyph inside a ringed disc — the hero badge at the top of the message.
 *
 * Drawn as ONE image rather than a CSS-rounded box holding an icon, because
 * `border-radius` is unsupported in Outlook: the ring would arrive as a square.
 */
function badge({ glyph, colour, ring, fill, bg, size }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="${bg}"/>
    <circle cx="32" cy="32" r="30" fill="${fill}" stroke="${ring}" stroke-width="1.6"/>
    <g transform="translate(20 20) scale(1)">
      ${stroke(glyph, colour, 1.9)}
    </g>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * The little dark tab hanging off the gold rule, from the reference design.
 *
 * An image because the CSS ways of drawing a triangle — a zero-size box with
 * coloured borders, or a rotated square — both depend on `transform` or on
 * border rendering that Outlook's Word engine does not do. 20x10, so it reads
 * as a notch rather than an arrow.
 */
function notch({ colour, bg, w, h }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <path d="M0 0 H${w} L${w / 2} ${h} Z" fill="${colour}"/>
  </svg>`;
  return Buffer.from(svg);
}

/* Each entry: the constant name, the displayed size, and the artwork. */
const ICONS = [
  {
    name: 'NOTCH',
    display: 20,
    height: 10,
    svg: notch({ colour: '#0e2a2c', bg: WHITE, w: 20, h: 10 }),
  },
  {
    name: 'INVITE_BADGE',
    display: 64,
    svg: badge({
      glyph: USER_PLUS,
      colour: TEAL,
      ring: GOLD,
      fill: '#fdf8ef',
      bg: WHITE,
      size: 128,
    }),
  },
  {
    name: 'ROLE',
    display: 18,
    svg: plain({ glyph: USERS, colour: GOLD_DEEP, bg: CHIP_BG, size: 36 }),
  },
  {
    name: 'SHIELD_NOTE',
    display: 18,
    svg: plain({ glyph: SHIELD, colour: GOLD_DEEP, bg: PANEL_BG, size: 36 }),
  },
  {
    name: 'SHIELD_RULE',
    display: 16,
    svg: plain({ glyph: SHIELD, colour: GOLD, bg: WHITE, size: 32 }),
  },
  {
    name: 'MAIL',
    display: 20,
    svg: plain({ glyph: MAIL, colour: '#6d8388', bg: FOOT_BG, size: 40 }),
  },
  /* Reused by the reset and unlock messages so they share the shape. */
  {
    name: 'KEY_BADGE',
    display: 64,
    svg: badge({
      glyph: SHIELD,
      colour: TEAL,
      ring: GOLD,
      fill: '#fdf8ef',
      bg: WHITE,
      size: 128,
    }),
  },
];

const parts = [];
for (const icon of ICONS) {
  const png = await sharp(icon.svg).png({ compressionLevel: 9 }).toBuffer();
  console.log(`${icon.name.padEnd(14)} ${png.length} bytes`);
  parts.push({ ...icon, base64: png.toString('base64') });
}

const total = parts.reduce((n, p) => n + p.base64.length, 0);
console.log(`total base64: ${Math.round(total / 1024)} KB`);

const body = parts
  .map(
    (p) => `
/** ${p.display}x${p.height ?? p.display}px as displayed, rendered at 2x. */
export const ${p.name}: EmailIcon = {
  cid: '${p.name.toLowerCase().replace(/_/g, '-')}',
  filename: '${p.name.toLowerCase().replace(/_/g, '-')}.png',
  width: ${p.display},
  height: ${p.height ?? p.display},
  base64:
    '${p.base64}',
};`,
  )
  .join('\n');

await writeFile(
  'lib/email/icons.ts',
  `import 'server-only';

/* ============================================================================
 * EMAIL ICONS — GENERATED, DO NOT EDIT BY HAND
 * ----------------------------------------------------------------------------
 * Written by scripts/make-email-icons.mjs. Re-run it after changing an icon or
 * a colour; editing the base64 below by hand is not a thing anybody can do.
 *
 * ⚠️ WHY THESE ARE IMAGES AND NOT SVG OR EMOJI.
 * Gmail strips <svg> completely, so the app's lucide icons cannot travel into a
 * message. Emoji render as a different picture in every client and look nothing
 * like a designed interface. So each one is a PNG, attached to the message and
 * referenced with \`cid:\`, which needs no network fetch and is therefore not
 * blocked by the image-blocking every major client does by default.
 *
 * Each is flattened onto the exact colour it sits on — a transparent PNG gets
 * composited onto black by some Outlook versions, and a dark glyph on a black
 * square is worse than no icon at all. That is why the shield appears twice.
 * ========================================================================= */

export interface EmailIcon {
  readonly cid: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly base64: string;
}
${body}
`,
  'utf8',
);

console.log('wrote lib/email/icons.ts');
