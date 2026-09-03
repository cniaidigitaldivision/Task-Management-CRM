/* ============================================================================
 * THE LIBRARY'S VOCABULARY — migration 035
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS IS IN `lib/domain/` AND NOT WITH THE QUERY ────────────────────
 * `lib/db/queries/library.ts` starts with `import 'server-only'`, whose entry
 * point throws if it is ever pulled into a client bundle. The library panel is a
 * client component and needs these categories to render its filter chips, so
 * importing them from the query module made the production build fail with:
 *
 *     You're importing a module that depends on "server-only"
 *
 * A `import type` would have been erased and been fine; these are VALUES, so they
 * are not. Exactly the same trap as `lib/domain/folder-access.ts`, which exists
 * for the same reason — and the second time it has been hit, which is why the
 * rule is written down here: **anything a client component needs to render lives
 * in `lib/domain/`, never in a query module.**
 *
 * ── ⚠️ MIRRORS `public.library_category` ──────────────────────────────────────
 * Add a value here and it must be added to the enum in the same commit, or the
 * filter offers something the database refuses.
 * ========================================================================= */

export const LIBRARY_CATEGORIES = [
  'package_card',
  'package_detail',
  'rate_card',
  'booklet',
  'deck',
  'design_source',
  'other',
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_CATEGORY_LABEL: Readonly<Record<LibraryCategory, string>> = {
  package_card: 'Package card',
  package_detail: 'Package detail',
  rate_card: 'Rate card',
  booklet: 'Booklet',
  deck: 'Deck',
  design_source: 'Design source',
  other: 'Other',
};

/* ============================================================================
 * WHAT MAY BE PUT IN THE LIBRARY — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"There is no button to upload any file in this category or in this company
 * library. Add a modal which will pop up to let me add any documentation in this
 * company library."*
 *
 * ── ⚠️ WHY THE LIBRARY DOES NOT REUSE `validateUpload` ───────────────────────
 * `lib/domain/attachments.ts` is the rule for the OTHER bucket. The two lists
 * are now nearly identical, and the one real difference is the reason this file
 * still exists separately:
 *
 *   only the library      .ai, .eps and .ps — a design SOURCE is a first-class
 *                         category here (migration 035) and is not attachable
 *                         to a task at all
 *   only attachments      audio and video, which belong against a task rather
 *                         than in a reference library
 *
 * ── ⚠️ OFFICE WAS THE OTHER DIFFERENCE, UNTIL 2026-09-03 ────────────────────
 * This note used to record that Word, Excel and PowerPoint were attachments-only
 * because *"the `cni-library` bucket's own allow-list has none of them, so
 * offering one would produce a 415 after the person had already chosen the
 * file."* That was an accurate description of the bucket and a poor description
 * of what the library is for. The owner, trying to file a .pptx: *"all text,
 * PowerPoint, PDF, Word, Excel, any file that I want to keep it in a safer
 * place."* A company library that takes the rate card as a PDF but refuses the
 * deck it was built from is a library with a gap in it.
 *
 * The BUCKET was widened first and the list below second — in that order,
 * deliberately. Widening the bucket alone only makes storage more permissive
 * than the form, which refuses politely; widening the form alone is precisely
 * the 415-after-choosing failure described above.
 *
 * ⚠️ THE LIST BELOW IS THE `cni-library` BUCKET'S ALLOW-LIST, TRANSCRIBED. The
 * bucket is the enforcement; this exists so the refusal is a sentence rather
 * than an HTTP status. Changing one without the other reintroduces exactly the
 * failure this is here to prevent — a file the form accepted and storage did
 * not. A test asserts the two stay in step.
 * ========================================================================= */

/** 50 MB — `file_size_limit` on the `cni-library` bucket, to the byte. */
export const LIBRARY_MAX_BYTES = 50 * 1024 * 1024;

export const LIBRARY_MAX_LABEL = '50 MB';

/** The bucket's `allowed_mime_types`, minus `application/octet-stream` — see
 *  `UNINFORMATIVE` below for why that one is handled as an absence of an answer
 *  rather than as a type anybody meant to send. */
const LIBRARY_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  /* .eps and .ps */
  'application/postscript',
  /* .ai — Illustrator's own type, which few browsers report. */
  'application/illustrator',
  'application/zip',
  'application/x-zip-compressed',
  /* ── Office and plain text, added 2026-09-03 ──────────────────────────────
     Owner, with a .pptx in hand: *"I want to add PowerPoint files and it is not
     letting me upload… all text, PowerPoint, PDF, Word, Excel, any file that I
     want to keep it in a safer place."*

     Two types per Office format, and both are needed: the `vnd.ms-*` pair are
     the pre-2007 binaries (.doc, .xls, .ppt) and the `openxmlformats` triplet
     are the modern zipped ones (.docx, .xlsx, .pptx). A machine reporting
     either is telling the truth about a real file. */
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/rtf',
]);

/**
 * The extensions those types correspond to.
 *
 * ⚠️ THIS IS NOT BELT AND BRACES, IT IS THE MAIN PATH FOR HALF THE LIST. A
 * browser reads `File.type` out of the operating system's registry, and no
 * ordinary Windows machine has an entry for `.ai` or `.eps` — both arrive as an
 * empty string or `application/octet-stream`. The same trap that was refusing
 * PowerPoint uploads on the other bucket (see lib/domain/attachments.ts), and
 * here it would refuse the design sources the library has a CATEGORY for.
 */
const LIBRARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'ai', 'eps', 'ps',
  'zip',
  /* ⚠️ THE OFFICE ENTRIES ARE THE MAIN PATH, NOT A SAFETY NET. The file that
     prompted this — Taskly_Final_AutoPlay_Working (2).pptx — is exactly the case
     the note above describes: a .pptx arrives from a machine with no Office
     install, or out of a zip, or off a phone, and the browser reports an empty
     type. Without these the extension fallback has nothing to match and an
     ordinary PowerPoint is refused twice over. */
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'txt', 'csv', 'md', 'rtf',
]);

/** For the file picker. Extensions, because that is what `accept` wants. */
export const LIBRARY_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.ai,.eps,.ps,.zip,' +
  '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.rtf';

/** Types that mean "the browser could not tell", not "this is binary rubbish". */
const UNINFORMATIVE: ReadonlySet<string> = new Set([
  '',
  'application/octet-stream',
  'application/binary',
  'binary/octet-stream',
]);

export function libraryExtensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 1 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export type LibraryCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Whether this file may go in the library, in words somebody can act on.
 *
 * Pure, so the dialogue can run it before a byte moves and the server action can
 * run the same function again — which is the point. The client copy is a
 * courtesy; `uploadLibraryDocumentAction` is the one that decides.
 */
export function validateLibraryUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): LibraryCheck {
  const name = input.fileName.trim();
  if (!name) return { ok: false, message: 'That file has no name.' };
  if (name.length > 255) {
    return { ok: false, message: 'That file name is too long — rename it and try again.' };
  }

  /* A zero-byte file is a failed export or a drag that landed wrong. Storing one
     means somebody downloads nothing later and wonders what the system lost. */
  if (input.sizeBytes <= 0) {
    return { ok: false, message: 'That file is empty. Check it exported properly.' };
  }
  if (input.sizeBytes > LIBRARY_MAX_BYTES) {
    const mb = Math.round(input.sizeBytes / 1_048_576);
    return {
      ok: false,
      message: `That file is ${mb} MB and the library holds up to ${LIBRARY_MAX_LABEL}. Split it — the package details are already two parts for this reason — or keep the large original in Google Drive and put the reading copy here.`,
    };
  }

  const extension = libraryExtensionOf(name);
  const claimed = input.mimeType.trim().toLowerCase();

  /* The type is trusted when it says something; the extension is the fallback,
     never an override. Both are allow-lists, so nothing new becomes storable. */
  if (!LIBRARY_MIME.has(claimed)) {
    if (!UNINFORMATIVE.has(claimed) || !LIBRARY_EXTENSIONS.has(extension)) {
      const what = UNINFORMATIVE.has(claimed)
        ? extension
          ? `.${extension} files`
          : 'A file with no name or type'
        : input.mimeType;
      return {
        ok: false,
        message: `${what} cannot go in the company library. Documents (PDF, Word, Excel, PowerPoint, text, CSV, Markdown, RTF), images (PNG, JPEG, WebP, GIF, SVG), design sources (.ai, .eps) and zip archives can.`,
      };
    }
  }

  return { ok: true };
}

/* ── ⚠️ WHAT A BROWSER CAN ACTUALLY DISPLAY ──────────────────────────────────
 * `is_viewable` decides whether the row offers "open in a tab" or only a
 * download, and `/api/library/[id]` reads it to choose `Content-Disposition:
 * inline` or `attachment`. It is a fact about the file, so it is DERIVED here
 * rather than asked on the form — a checkbox for it would be a way to promise a
 * viewer that does not exist.
 *
 * ⚠️ SVG IS DELIBERATELY NOT VIEWABLE, AND IT IS THE ONLY SURPRISING ENTRY.
 * Every browser renders an SVG perfectly well, which is exactly the problem: an
 * SVG is a document that can carry script, and this route serves it from THIS
 * application's own origin with the reader's session cookie attached. Served
 * `inline`, an uploaded SVG is stored XSS with same-origin reach. Served
 * `attachment` — which is what `is_viewable: false` produces — it is an inert
 * download. The same reasoning that keeps SVG out of the public avatar bucket.
 * ------------------------------------------------------------------------- */
const VIEWABLE_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const VIEWABLE_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp']);

export function isLibraryViewable(mimeType: string, fileName: string): boolean {
  const claimed = mimeType.trim().toLowerCase();
  if (VIEWABLE_MIME.has(claimed)) return true;
  /* Same fallback as the validator, and needed for the same reason: a PDF off a
     network share can arrive with no type at all, and answering "not viewable"
     would quietly downgrade it to a download for ever. */
  if (UNINFORMATIVE.has(claimed)) return VIEWABLE_EXTENSIONS.has(libraryExtensionOf(fileName));
  return false;
}

/**
 * The category a file most likely belongs to, from its extension alone.
 *
 * Only ever a PRE-SELECTION in the form — the person can change it, and the
 * server takes what they chose. It exists for the one case where the guess is
 * certain rather than convenient: a `.ai` is a design source by definition, and
 * leaving that on the default of "Other" produces a library whose `design_source`
 * chip is empty while design sources sit in it.
 */
export function suggestLibraryCategory(fileName: string): LibraryCategory {
  const extension = libraryExtensionOf(fileName);
  if (extension === 'ai' || extension === 'eps' || extension === 'ps' || extension === 'svg') {
    return 'design_source';
  }
  return 'other';
}

/** A `library_category` if the string is one, and null otherwise. Used on the
 *  server: a posted field is a claim, and the enum refuses anything else with a
 *  Postgres error nobody can read. */
export function toLibraryCategory(value: string): LibraryCategory | null {
  return (LIBRARY_CATEGORIES as readonly string[]).includes(value)
    ? (value as LibraryCategory)
    : null;
}
