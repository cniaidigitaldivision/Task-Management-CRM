/* Generates the email header mark from the supplied artwork.
 *
 * The artwork is 4.1 MB at 2390x1792 — unusable in an email even if it could be
 * reached. This crops it to the brain (the same fractions components/brand/logo.tsx
 * measured off the alpha channel), composites it onto the rail's own #071e22 so
 * there is no transparency for a mail client to mishandle, and writes a base64
 * TS module so nothing has to be read from disk at runtime.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const SRC = 'public/brand/cni-ai-digital-division.png';
const NATURAL = { w: 2390, h: 1792 };
/* Identical to MARK in components/brand/logo.tsx. Kept in step by the comment
   there; if the artwork is re-exported both move together. */
const MARK = { left: 0.219, top: 0.092, width: 0.639, height: 0.575 };
const BAND = { r: 0x07, g: 0x1e, b: 0x22 }; /* --sidebar-bg */

const crop = {
  left: Math.round(MARK.left * NATURAL.w),
  top: Math.round(MARK.top * NATURAL.h),
  width: Math.round(MARK.width * NATURAL.w),
  height: Math.round(MARK.height * NATURAL.h),
};

/* Displayed at 44px tall; rendered at 2x so it stays crisp on a phone. */
const OUT_H = 88;
const OUT_W = Math.round((crop.width / crop.height) * OUT_H);

const png = await sharp(SRC)
  .extract(crop)
  .resize(OUT_W, OUT_H, { fit: 'contain', background: { ...BAND, alpha: 1 } })
  .flatten({ background: BAND })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

console.log(`mark: ${OUT_W}x${OUT_H}, ${png.length} bytes, ${Math.ceil(png.length * 1.37)} b64`);

const file = `import 'server-only';

/* ============================================================================
 * THE HEADER MARK, AS BYTES
 * ----------------------------------------------------------------------------
 * ⚠️ THIS IS WHY THE LOGO USED TO ARRIVE AS A BROKEN BOX.
 *
 * The header image was <img src="\${appUrl}/brand/..."> — an absolute URL built
 * from whichever link the message carried. In development that resolves to
 * http://localhost:4310, which is a host inside this laptop: Gmail's image proxy
 * cannot reach it, so every test message showed an empty frame. In production it
 * would have resolved, and then served the 4.1 MB source artwork into an inbox.
 *
 * Both problems disappear if the image travels WITH the message. Resend takes
 * attachments with a content_id, and \`<img src="cid:...">\` is how every mail
 * client has embedded images since before webmail existed — no remote fetch, so
 * nothing to block, and it works offline and on localhost alike.
 *
 * Generated, not hand-made — regenerate with scripts/make-email-mark.mjs after
 * any change to the artwork:
 *   · cropped to the brain alone (the wordmark in the artwork is dark teal and
 *     would vanish against the band it sits on — the same reason <LogoMark>
 *     exists for the navigation rail);
 *   · flattened onto #071e22, the rail's own background, so there is no alpha
 *     channel for Outlook to render as black;
 *   · \${OUT_W}x\${OUT_H}, displayed at half that, so it stays sharp on a phone.
 *
 * Base64 in a module rather than a file read at runtime: a file would have to be
 * traced into the serverless bundle, and a logo that works locally and 404s in
 * production is precisely the bug this file exists to end.
 * ========================================================================= */

/** Referenced from the templates as \`cid:\${CID}\`. */
export const MARK_CID = 'taskly-mark';
export const MARK_FILENAME = 'taskly.png';
export const MARK_WIDTH = ${OUT_W / 2};
export const MARK_HEIGHT = ${OUT_H / 2};

/** ${png.length} bytes. Nothing else in this file should be edited by hand. */
export const MARK_BASE64 =
  '${png.toString('base64')}';
`;

await writeFile('lib/email/mark.ts', file, 'utf8');
console.log('wrote lib/email/mark.ts');
