/* ============================================================================
 * PREPARING THE REPORT ILLUSTRATIONS  ·  node scripts/prep-report-assets.mjs
 * ----------------------------------------------------------------------------
 * The owner supplied the report artwork on 2026-08-20 as full-page transparent PNGs —
 * `lib/pdf/assets/decor-*.png` and `page-background.png`, each 1448×1086 with the
 * illustration floating somewhere inside a mostly-empty field.
 *
 * ⚠️ Those originals cannot be placed on a page. Drawing one at "x=600, width=120" puts
 * the transparent field there, not the picture — so each is trimmed to the bounding box
 * of its opaque pixels first, and downscaled to roughly 2.5× the size it is actually
 * drawn at. The results go in `lib/pdf/assets/render/` and are read by
 * `lib/pdf/report-poster.ts`.
 *
 * ⚠️ The originals STAY. They are the owner's source assets: if the layout changes and
 * something needs to be drawn larger, it is re-derived from them rather than upscaled
 * from a render copy. This script is idempotent — re-run it after replacing an original.
 *
 * It also prints a measurement of the empty circle in the activity illustration, which
 * is where the report's headline total is drawn. ⚠️ That measurement is UNRELIABLE and
 * is printed as a hint only: the monitor screen behind the circle is nearly as light as
 * the circle itself, so no luminance threshold separates them. `ACTIVITY_CIRCLE` in
 * `report-poster.ts` was set by eye against a rendered page, which is the only check
 * that actually matters.
 * ========================================================================= */
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';

const root = process.cwd();
const out = path.join(root, 'lib', 'pdf', 'assets', 'render');
await mkdir(out, { recursive: true });

/** The bounding box of everything that is not transparent. */
async function bbox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      /* > 12 rather than > 0: these were exported with a faint anti-aliased halo, and
         trimming to it leaves a visible transparent margin on every side. */
      if (data[(y * width + x) * channels + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${file} is fully transparent`);
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** A hint at where the empty circle is. See the header on why this is only a hint. */
async function measureCircle(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const light = (x, y) => {
    const i = (y * width + x) * channels;
    if (data[i + 3] < 200) return false;
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    return lo > 230 && hi - lo < 14;
  };
  const runs = (n, at) => {
    const found = [];
    let start = -1;
    for (let i = 0; i < n; i++) {
      if (at(i)) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        found.push({ start, len: i - start });
        start = -1;
      }
    }
    if (start >= 0) found.push({ start, len: n - start });
    return found;
  };

  let row = { len: 0, start: 0, at: 0 };
  for (let y = 0; y < height; y++) {
    for (const run of runs(width, (x) => light(x, y))) {
      const mid = run.start + run.len / 2;
      if (mid > width * 0.3 && mid < width * 0.7 && run.len > row.len) row = { ...run, at: y };
    }
  }
  const cx = Math.round(row.start + row.len / 2);
  let col = { len: 0, start: 0 };
  for (const run of runs(height, (y) => light(cx, y))) if (run.len > col.len) col = run;

  return {
    cx: cx / width,
    cy: (col.start + col.len / 2) / height,
    r: row.len / 2 / width,
  };
}

const JOBS = [
  /* Quantised to 64 colours: 480 KB → 120 KB with no visible banding, because the sheet
     spans only a handful of near-white values. It is embedded in every PDF. */
  {
    src: 'lib/pdf/assets/page-background.png',
    dst: 'background.png',
    width: 900,
    trim: false,
    colours: 64,
  },
  { src: 'lib/pdf/assets/decor-activity-monitor.png', dst: 'activity.png', width: 560, circle: true },
  { src: 'lib/pdf/assets/decor-desk.png', dst: 'desk.png', width: 320 },
  /* Not currently placed by the composer — kept rendered so a layout change can use
     them without another round trip to the owner. */
  { src: 'lib/pdf/assets/decor-plant.png', dst: 'plant.png', width: 200 },
  { src: 'lib/pdf/assets/decor-megaphone.png', dst: 'megaphone.png', width: 200 },
  { src: 'lib/pdf/assets/decor-engagement.png', dst: 'engagement.png', width: 220 },
  { src: 'public/brand/cni-ai-digital-division.png', dst: 'logo.png', width: 220 },
];

let total = 0;
for (const job of JOBS) {
  const src = path.join(root, job.src);
  const source = await sharp(src).metadata();
  const box =
    job.trim === false
      ? { left: 0, top: 0, width: source.width, height: source.height }
      : await bbox(src);

  const dst = path.join(out, job.dst);
  await sharp(src)
    .extract(box)
    .resize({ width: job.width })
    .png(
      job.colours
        ? { compressionLevel: 9, palette: true, colours: job.colours }
        : { compressionLevel: 9, palette: false },
    )
    .toFile(dst);

  const written = await sharp(dst).metadata();
  /* ⚠️ `metadata().size` is only populated for buffers, not for files read from disk —
     it comes back undefined here and reported every asset as "0 KB". */
  const bytes = (await stat(dst)).size;
  total += bytes;
  console.log(
    `${job.dst.padEnd(16)} ${written.width}×${written.height}  ` +
      `${((bytes / 1024) | 0).toString().padStart(4)} KB   ` +
      `(from ${source.width}×${source.height}, trimmed to ${box.width}×${box.height})`,
  );

  if (job.circle) {
    const circle = await measureCircle(dst);
    console.log(
      `  hint · empty circle ≈ cx ${circle.cx.toFixed(3)} cy ${circle.cy.toFixed(3)} ` +
        `r ${circle.r.toFixed(3)} — verify against a rendered page, see the header`,
    );
  }
}

console.log(`\n${((total / 1024) | 0)} KB written to lib/pdf/assets/render/`);
