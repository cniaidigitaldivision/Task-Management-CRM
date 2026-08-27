/* ============================================================================
 * BUILDING A `Content-Disposition` HEADER THAT DOES NOT THROW
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"in the Company Library tab the files are not opening.
 * That's a PDF file. When I click it, it opens in a new tab but that's not opening
 * actually."*
 *
 * ── ⚠️ THE CAUSE WAS AN EM DASH IN THE TITLE ─────────────────────────────────
 * Four of the five library documents are called things like
 *
 *     Package Details — part 1 of 2 (pages 1–16)
 *
 * and both routes that stream a file built their header as
 *
 *     headers.set('Content-Disposition', `inline; filename="${name}"`)
 *
 * An HTTP header value is a ByteString. `Headers.set` therefore REFUSES anything
 * above U+00FF, and it refuses by throwing:
 *
 *     TypeError: Cannot convert argument to a ByteString because the character
 *     at index 34 has a value of 8212 which is greater than 255
 *
 * U+2014 EM DASH is 8212. So the route threw before it returned, Next answered
 * 500, and the new tab the person had just opened showed nothing. Reproduced by
 * running that one `set` call against the real titles — which is also why the one
 * document that DID open is "Full Package Deck": it is the only title with no dash
 * in it.
 *
 * ⚠️ NOT A LIBRARY-ONLY BUG. `app/api/drive/file/[id]` had the identical line, and
 * it takes its name straight from Google Drive — so any Drive file named with an
 * em dash, a curly quote, an accent or a word of Urdu was equally unopenable.
 * Both routes now call this.
 *
 * ── WHAT RFC 6266 ACTUALLY WANTS ─────────────────────────────────────────────
 * Two parameters, not one:
 *
 *     filename="Package Details - part 1 of 2.pdf"          ASCII, for old clients
 *     filename*=UTF-8''Package%20Details%20%E2%80%94%20...  the real name
 *
 * Every current browser prefers `filename*` and gets the exact name; anything that
 * does not understand it falls back to the ASCII form instead of getting nothing.
 * Building only the ASCII form would silently mangle every non-English filename,
 * which for this division is not an edge case.
 * ========================================================================= */

/** Characters that must never reach a header value, even after transliteration.
 *  A CR or LF here is header injection; a quote or backslash breaks out of the
 *  quoted-string. Stripped rather than escaped — a filename does not need them. */
const FORBIDDEN = /["\\\r\n\t]/g;

/**
 * Punctuation worth transliterating rather than replacing with a dash.
 *
 * These are what a word processor produces automatically, so they are in almost
 * every human-written title. Without this table the catch-all below would turn
 * `Package Details — part 1` into `Package Details - part 1` anyway by accident —
 * but a curly apostrophe would become `Client-s brief`, and that is a name that
 * looks corrupted rather than transliterated. Naming the common marks explicitly
 * is what keeps the fallback readable.
 *
 * ⚠️ WRITTEN AS `\uXXXX` ESCAPES, NOT AS THE CHARACTERS THEMSELVES. The whole bug
 * was a character nobody could see in the string it broke, and a regex holding a
 * literal em dash is unreviewable: a reader cannot tell it from a hyphen, and an
 * editor or a copy-paste can substitute one silently.
 */
const TRANSLITERATE: ReadonlyArray<readonly [RegExp, string]> = [
  /* U+2010..U+2015 — hyphen, non-breaking hyphen, figure dash, en dash, em dash,
     horizontal bar. U+2014 is the one that broke the library. */
  [/[\u2010-\u2015]/g, '-'],
  /* U+2018..U+201B curly single quotes, plus U+2032 prime, which gets used as one. */
  [/[\u2018-\u201B\u2032]/g, "'"],
  /* U+201C..U+201F curly double quotes, plus U+2033 double prime. DROPPED rather
     than converted: a straight double quote is what closes the quoted-string this
     value sits inside, so turning one into the other would break the header. */
  [/[\u201C-\u201F\u2033]/g, ''],
  [/\u2026/g, '...'],
  /* Non-breaking, en, em, thin, hair and ideographic spaces. Invisible in a
     filename and illegal in a header, which is the worst combination. */
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
  /* Zero-width joiners and the BOM. Invisible, and they survive a naive trim. */
  [/[\u200B-\u200D\uFEFF]/g, ''],
];

/**
 * The ASCII-only fallback name.
 *
 * ⚠️ Anything still non-ASCII after transliteration becomes `-`, and a run of them
 * collapses to one. A name written entirely in a non-Latin script would otherwise
 * come out as a row of dashes as long as the original, which is noise. `download`
 * is used when nothing legible survives, because an empty `filename=""` makes some
 * browsers save the file as the URL's last path segment — which here is a UUID.
 */
export function asciiFallback(name: string): string {
  let out = name;
  for (const [pattern, replacement] of TRANSLITERATE) out = out.replace(pattern, replacement);

  out = out
    .replace(FORBIDDEN, '')
    /* Printable ASCII only. This is the catch-all behind the table above, and it
       covers the control characters too — legal in a filename on some systems,
       illegal in a header value everywhere. */
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/-{2,}/g, '-')
    .trim();

  return out === '' || out === '-' ? 'download' : out;
}

/**
 * The complete header value for one file.
 *
 * @param name   The filename to offer, extension included. Untrusted text.
 * @param inline True to display it in the browser, false to save it to disk.
 */
export function contentDisposition(name: string, inline: boolean): string {
  const disposition = inline ? 'inline' : 'attachment';
  const fallback = asciiFallback(name);

  /* `encodeURIComponent` leaves ! ' ( ) * alone and RFC 5987's ext-value grammar
     does not permit them raw. Encoded explicitly rather than trusted — a single
     quote in particular would end the value early. */
  const encoded = encodeURIComponent(name).replace(
    /['()!*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * The suffix for a mime type — a short, explicit list, not a rule.
 *
 * ── ⚠️ WHY NOT DERIVE IT FROM THE SUBTYPE ────────────────────────────────────
 * The obvious version reads the part after the slash, and it is wrong more often
 * than it is right: `text/plain` becomes `.plain`, `application/octet-stream`
 * becomes `.octet-stream`, and an Office file becomes forty characters of
 * `vnd.openxmlformats-officedocument…`. Every one of those is a filename that
 * fails to open, which is the bug being fixed rather than a cosmetic problem.
 *
 * So: the handful this system actually serves, and `null` for anything else. This
 * is a FALLBACK — the storage path carries the real extension for every current
 * row, and this only fires for a path that has none.
 */
const MIME_EXTENSION: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'application/zip': 'zip',
  'application/postscript': 'ai',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** ⚠️ Exported for the Files table's type pill as well as for the header below.
 *  Three of this division's own documents are named "logo", "business Purposal" and
 *  "Social Media Strategy" — no extensions at all — so a pill built only from the
 *  filename would read "Documents" where the mockup reads "PDF". The mime type
 *  knows, and this is already the vetted list for turning one into a suffix. */
export function extensionForMime(mimeType: string | null): string | null {
  if (!mimeType) return null;
  /* The parameters go: `text/plain; charset=utf-8` is still text/plain. */
  const bare = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSION[bare] ?? null;
}

/**
 * A human title plus the right extension, taken from the stored path.
 *
 * ── ⚠️ THE SECOND BUG IN THAT SAME LINE ─────────────────────────────────────
 * The library route appended `.pdf` unconditionally — `filename="${safeName}.pdf"`
 * — so a design source, the one kind of library file that is download-only
 * *precisely because* no browser can render it, was saved as `Logo Suite.pdf` and
 * then opened in nothing. The extension has to come from the file, not from an
 * assumption about what files are.
 *
 * A library row holds a title ("Corporate Profile & Service Booklet") and a storage
 * path that carries the real extension. The title is what somebody should see in
 * their downloads folder; the extension is what makes it open when they
 * double-click. Neither alone is enough.
 *
 * Falls back to a KNOWN mime type, then to no extension at all — better a name
 * with none than a `.pdf` that is not one.
 */
export function nameWithExtension(
  title: string,
  storagePath: string,
  mimeType: string | null,
): string {
  const fromPath = /\.([a-z0-9]{1,8})$/i.exec(storagePath)?.[1]?.toLowerCase() ?? null;
  const extension = fromPath ?? extensionForMime(mimeType);
  if (!extension) return title;

  /* Not appended twice. A title somebody typed as "Rate Card.pdf" is common, and
     "Rate Card.pdf.pdf" is the kind of detail that makes software look careless. */
  return title.toLowerCase().endsWith(`.${extension}`) ? title : `${title}.${extension}`;
}
