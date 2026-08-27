/* ============================================================================
 * WHERE A DOCUMENT'S BYTES ACTUALLY ARE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24:
 *
 *   "In the File tab I told you that the file which is uploaded over there will
 *    only be saved in the bucket, right? It will not be saved in Google Drive. On
 *    the document page how will you handle it? How can I see which files are in
 *    Google Drive and which files are in the Supabase bucket?"
 *
 * ── THE QUESTION WAS UNANSWERABLE FROM THE SCREEN, AND THAT WAS THE BUG ──────
 * Since migration 048 a document can be in either place, and after this change it
 * can be in either place BY CHOICE. Two columns already carried the answer —
 * `storage_path` and `drive_file_id` — and no screen read them as a pair. What the
 * register showed instead was the STATE: "Waiting", "In Drive", "Refused". Those
 * are two different facts, and conflating them is why the filter labelled
 * "In Drive" listed files sitting in Supabase:
 *
 *     state      = has somebody decided about this file yet
 *     home (here) = which store you would have to open to read it
 *
 * A file can be approved and in the bucket. A file can be approved and in Drive.
 * Before this module the screen said "In Drive" to both.
 *
 * ── ⚠️ WHY `both` IS A CASE AND NOT AN IMPOSSIBILITY ────────────────────────
 * Migration 048 deliberately stopped forbidding it — read the header there. A row
 * approved into Drive last week and a row approved into the bucket today are both
 * legitimately `approved`, and copying a bucket file into Drive later must not
 * require deleting our own copy. So `both` is a real state and gets its own label
 * rather than being resolved arbitrarily to whichever we check first.
 *
 * ── ⚠️ AND `none` IS NOT A BUG, IT IS A REFUSED FILE ─────────────────────────
 * `markRejected` clears `storage_path` and the action deletes the object, on
 * purpose: a refused file never reaches the company Drive and keeping the bytes
 * serves nobody. The ROW stays, with its reason. So a row with no home is the
 * normal shape of a refusal, and the label says "not held" rather than shouting
 * about a fault.
 *
 * ── WHY THIS IS IN lib/domain AND NOT WITH THE QUERIES ───────────────────────
 * Same reason as `folder-access.ts`: the register, the project Files tab and the
 * upload form all have to say the same words about the same row, and two of the
 * three are client components. `lib/db/queries/documents.ts` is `server-only`, so
 * the vocabulary cannot live there without dragging that into the browser bundle.
 * ========================================================================= */

/** Which store you would have to open to read the file. */
export type StorageHome = 'bucket' | 'drive' | 'both' | 'none';

/**
 * Read the home off a row.
 *
 * ⚠️ Takes the two nullable columns rather than a `DocumentRow`, so this stays
 * callable from a test, from a query result and from anything else that happens to
 * know those two facts — and so importing it never drags the row type's
 * server-only neighbours along.
 */
export function storageHome(document: {
  readonly storagePath: string | null;
  readonly driveFileId: string | null;
}): StorageHome {
  const inBucket = document.storagePath !== null;
  const inDrive = document.driveFileId !== null;

  if (inBucket && inDrive) return 'both';
  if (inDrive) return 'drive';
  if (inBucket) return 'bucket';
  return 'none';
}

/**
 * What each home is called on screen.
 *
 * ⚠️ THE LABELS NAME THE PLACE, NOT THE TECHNOLOGY, with one exception. "Google
 * Drive" is the name the owner and the team use and is the name on the folder they
 * would go and open, so it stays. The other one is deliberately NOT "Supabase":
 * nobody outside this repository knows what a Supabase bucket is, and the fact
 * that matters to a reader is that the file is held BY THIS SYSTEM and served
 * through it. `hint` carries the technical name for whoever wants it.
 */
export const STORAGE_META: Record<
  StorageHome,
  {
    /** For a badge. Two words at most — it sits beside a filename. */
    readonly label: string;
    /** For a filter control, where the noun is already implied by the label. */
    readonly filterLabel: string;
    /** A design token name, without the `--`. */
    readonly token: string;
    /** The `title` on the badge. Says what it means for the reader. */
    readonly hint: string;
  }
> = {
  bucket: {
    label: 'In storage',
    filterLabel: 'This system',
    token: 'accent-primary',
    hint: "Held in this system's own private storage (the Supabase bucket) and served by a link that expires. It is not in Google Drive.",
  },
  drive: {
    label: 'In Drive',
    filterLabel: 'Google Drive',
    token: 'feedback-info',
    hint: 'The file itself lives in the company Google Drive. This system holds the register entry, not the bytes.',
  },
  both: {
    label: 'Storage + Drive',
    filterLabel: 'Google Drive',
    token: 'feedback-info',
    hint: "There is a copy in this system's private storage and a copy in the company Google Drive.",
  },
  none: {
    label: 'Not held',
    filterLabel: 'This system',
    token: 'text-tertiary',
    hint: 'No file is attached any more — normal for a refused upload, where the bytes are deleted and only the reason is kept.',
  },
};

/* ==========================================================================
 * THE FILTER
 * ========================================================================== */

/** What the register's "Where" control can be set to. */
export type StorageFilter = 'anywhere' | 'bucket' | 'drive';

/**
 * Whether a row belongs under the chosen filter.
 *
 * ⚠️ A `both` row matches BOTH the bucket filter and the Drive filter, and that is
 * the point rather than a shortcut. Somebody filtering to "Google Drive" is asking
 * "what would I find if I opened Drive" — a file with a copy there is an honest
 * answer to that, and hiding it because it is also held here would make the two
 * filters add up to less than the whole list.
 */
export function matchesStorage(home: StorageHome, filter: StorageFilter): boolean {
  if (filter === 'anywhere') return true;
  if (filter === 'bucket') return home === 'bucket' || home === 'both';
  return home === 'drive' || home === 'both';
}

/* ==========================================================================
 * THE CHOICE, AT UPLOAD TIME
 * ========================================================================== */

/**
 * Where an upload is being sent.
 *
 * Owner, 2026-08-24: *"When I create and want to upload something on the document
 * page, how can I manage or select whether I want to save it in Google Drive or
 * whether it is going to be saved in the Supabase bucket?"*
 *
 * ── ⚠️ THIS IS A DESTINATION, NOT AN APPROVAL SETTING ────────────────────────
 * The two got tangled once already and it produced an inverted rule (see the note
 * in `requestDocumentAction`). Keeping them apart:
 *
 *   destination   which store the bytes are written to. Chosen on the form.
 *   approval      whether the row lands `pending`. Decided by RANK for a bucket
 *                 upload, and not applicable to Drive at all.
 *
 * Drive has no approval queue and cannot have one: the queue exists so a refused
 * file never reaches the company Drive, and a file already written there has
 * passed the point the queue was protecting. That is why choosing Drive requires
 * having been granted access to a specific folder — the permission is checked
 * BEFORE the write instead of after it.
 */
export type UploadDestination = 'bucket' | 'drive';

/** `'bucket'` is the default everywhere, and is the answer for a bad value. */
export const DEFAULT_DESTINATION: UploadDestination = 'bucket';

/** Validates a form field. Anything unrecognised is not an error — it is the
 *  default, because a missing `destination` is what an older client posts. */
export function toDestination(value: string | null | undefined): UploadDestination {
  return value === 'drive' ? 'drive' : DEFAULT_DESTINATION;
}

export const DESTINATION_META: Record<
  UploadDestination,
  {
    readonly label: string;
    /** One line under the label, saying what choosing it actually does. */
    readonly consequence: string;
  }
> = {
  bucket: {
    label: 'This system',
    consequence: 'Held in private storage here. Opens from a link that expires.',
  },
  drive: {
    label: 'Google Drive',
    consequence: 'Written into a Drive folder straight away. No approval step.',
  },
};

/* ==========================================================================
 * THE TWO SIZE CEILINGS
 * ----------------------------------------------------------------------------
 * ⚠️ THEY DIFFER BECAUSE THE PATHS DIFFER, AND PRETENDING OTHERWISE CAUSED A BUG
 * ONCE ALREADY (see the long note in app/actions/documents.ts). Restated:
 *
 *   bucket   50 MB — the Supabase project's own ceiling. Not ours to raise from
 *            code; it needs a plan change. Exceeding it produces an HTTP 413 with
 *            a message nobody can read, so it is refused here with a sentence.
 *   drive    100 MB — never touches Supabase, so it is bounded instead by
 *            `documents_size_sane` on the table (migration 025) and by what one
 *            request can buffer in memory.
 *
 * ⚠️ NEITHER SUITS RAW VIDEO. Both buffer the whole file server-side. Real footage
 * needs a resumable upload sent from the browser directly to Drive, with the
 * server only minting the session. Not built; the refusal says so.
 * ========================================================================= */

export const MAX_BYTES: Record<UploadDestination, number> = {
  bucket: 50 * 1024 * 1024,
  drive: 100 * 1024 * 1024,
};

/** "50 MB" — used in a hint and in a refusal, so the two cannot disagree. */
export function maxLabel(destination: UploadDestination): string {
  return `${Math.round(MAX_BYTES[destination] / 1_048_576)} MB`;
}
