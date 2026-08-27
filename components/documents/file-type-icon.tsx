import { extensionOf } from '@/lib/domain/file-kind';
import { extensionForMime } from '@/lib/domain/content-disposition';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE OWNER'S FILE-TYPE ICONS
 * ----------------------------------------------------------------------------
 * Owner, supplying ten PNGs: *"These are all file icons. In the document project
 * files where the files are appearing, I want it to use these icon images
 * according to the extension."*
 *
 * Ten artworks: PDF, JPG, PNG, DOCX, XLSX, PPTX, TXT, MP3, MP4, ZIP. Each was
 * opened and identified before being mapped — the filenames were
 * "ChatGPT Image … (1..10).png" and carried no clue as to which was which, so
 * mapping them by their numbering would have been a coin toss ten times over.
 *
 * ── ⚠️ THE SOURCES WERE 1248px AND ABOUT 800KB EACH ─────────────────────────
 * Shipped as supplied, a ten-row table would have pulled 7.6 MB of images to draw
 * something the size of a fingernail. They are trimmed of their transparent margin
 * and resized to 96px — three times the 32px drawn, so a 3× screen still gets a
 * crisp icon — which takes the whole set to 84 KB.
 *
 * ── ⚠️ THE EXTENSION DECIDES, AND THE MIME TYPE IS THE FALLBACK ─────────────
 * That order is deliberate and it is the same rule `fileKind` follows: browsers
 * routinely send `application/octet-stream` for a .docx, so a mime-first lookup
 * would show the generic icon for half the real uploads. Three of this division's
 * own documents have NO extension at all ("logo", "business Purposal") — those are
 * exactly the rows the mime type rescues.
 *
 * ── WHY A FALLBACK AT ALL ───────────────────────────────────────────────────
 * There are ten artworks and far more than ten file types. An .ai, a .psd or a
 * .keynote has no icon here, and inventing one by relabelling the PDF artwork
 * would put the wrong badge on the row. Anything unmapped returns null and the
 * caller draws the tinted lucide glyph it drew before — which is honest, and looks
 * deliberate rather than broken.
 * ========================================================================= */

/** The ten artworks, by their own name. */
type IconName = 'pdf' | 'jpg' | 'png' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'mp3' | 'mp4' | 'zip';

/**
 * Extension → artwork.
 *
 * ⚠️ Several extensions share one icon, which is correct rather than lazy: a .jpeg
 * and a .jpg are the same thing, and there is no separate .webp artwork to use. The
 * grouping is by what the artwork DEPICTS — the PNG icon is a picture, so every
 * still-image format that is not a JPEG points at it.
 */
const BY_EXTENSION: Readonly<Record<string, IconName>> = {
  pdf: 'pdf',

  jpg: 'jpg',
  jpeg: 'jpg',
  /* The PNG artwork is a generic picture, so it carries the other image formats.
     ⚠️ svg included: it is a picture to everybody except a developer, and the
     alternative is the generic glyph on a file people think of as an image. */
  png: 'png',
  webp: 'png',
  gif: 'png',
  svg: 'png',
  bmp: 'png',
  tif: 'png',
  tiff: 'png',
  heic: 'png',

  doc: 'docx',
  docx: 'docx',

  xls: 'xlsx',
  xlsx: 'xlsx',
  /* A CSV opens in Excel for everybody here, and the spreadsheet artwork says
     "columns of numbers" better than the text one does. */
  csv: 'xlsx',

  ppt: 'pptx',
  pptx: 'pptx',

  txt: 'txt',
  md: 'txt',
  rtf: 'txt',
  log: 'txt',

  mp3: 'mp3',
  wav: 'mp3',
  m4a: 'mp3',
  aac: 'mp3',
  ogg: 'mp3',
  flac: 'mp3',

  mp4: 'mp4',
  mov: 'mp4',
  avi: 'mp4',
  mkv: 'mp4',
  webm: 'mp4',
  m4v: 'mp4',

  zip: 'zip',
  rar: 'zip',
  '7z': 'zip',
  tar: 'zip',
  gz: 'zip',
};

/**
 * Which artwork a file gets, or null when there is none for it.
 *
 * Exported separately from the component so a caller can decide what to draw
 * INSTEAD — see the header on why there is a fallback at all.
 */
export function fileIconName(mimeType: string | null, name: string): IconName | null {
  const fromName = extensionOf(name);
  if (fromName && BY_EXTENSION[fromName]) return BY_EXTENSION[fromName];

  /* No usable extension. `extensionForMime` is the vetted mime→suffix table that
     already exists for Content-Disposition headers, so the two agree about what a
     .docx is called. */
  const fromMime = extensionForMime(mimeType);
  if (fromMime && BY_EXTENSION[fromMime]) return BY_EXTENSION[fromMime];

  return null;
}

/**
 * The artwork for one file. Renders nothing when there is no artwork for it.
 *
 * ⚠️ A plain `<img>`, not `next/image`. These are ten static PNGs of 5 KB each,
 * already sized for their slot; routing them through the optimiser would add a
 * serverless invocation per icon per row to re-encode something that is smaller
 * than the request. The same reasoning as `components/ui/avatar.tsx`.
 */
export function FileTypeIcon({
  mimeType,
  name,
  size = 32,
  className,
}: {
  mimeType: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const icon = fileIconName(mimeType, name);
  if (!icon) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above
    <img
      src={`/file-icons/${icon}.png`}
      /* ⚠️ Empty alt with `aria-hidden`: every row prints the file's name and its
         type in the next column, so announcing "PDF icon" reads the same fact a
         third time. The icon is decoration on a labelled row. */
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
