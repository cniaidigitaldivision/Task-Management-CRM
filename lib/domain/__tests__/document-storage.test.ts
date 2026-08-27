import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESTINATION,
  DESTINATION_META,
  MAX_BYTES,
  STORAGE_META,
  matchesStorage,
  maxLabel,
  storageHome,
  toDestination,
  type StorageFilter,
  type StorageHome,
} from '../document-storage';

/* ============================================================================
 * WHERE A DOCUMENT'S BYTES ARE
 * ----------------------------------------------------------------------------
 * These exist because the answer is derived from TWO nullable columns, and every
 * screen that got it wrong got it wrong by looking at one of them — or by reading
 * the `state` column, which answers a different question entirely.
 *
 * The four shapes below are not hypothetical. Each is a row this database
 * genuinely produces, and the migration that produces it is named.
 * ========================================================================= */

const row = (storagePath: string | null, driveFileId: string | null) => ({
  storagePath,
  driveFileId,
});

describe('reading the home off a row', () => {
  it('is the bucket for a pending upload — the shape migration 048 requires', () => {
    /* `documents_state_is_coherent`: pending => storage_path not null AND
       drive_file_id null. So this is every file waiting for approval. */
    expect(storageHome(row('documents/u/1-a.pdf', null))).toBe('bucket');
  });

  it('is the bucket for a document accepted since migration 048', () => {
    /* ⚠️ THE CASE THE OLD BADGE GOT WRONG. `markApproved` changes the state and
       moves nothing, so an accepted document keeps its `storage_path` and has no
       Drive id — and the register labelled it "In Drive" anyway. */
    expect(storageHome(row('documents/u/1-a.pdf', null))).toBe('bucket');
  });

  it('is Drive for a document approved under the pre-048 flow', () => {
    /* `markApprovedIntoDrive` sets the Drive ids and NULLS `storage_path`,
       because the old constraint demanded it. Those rows still exist. */
    expect(storageHome(row(null, 'drive-abc'))).toBe('drive');
  });

  it('is Drive for an upload sent straight there, which holds no local copy', () => {
    /* `createApprovedDocument` never sets `storage_path` — the bytes went to
       Google, so there is nothing of ours to clean up afterwards. */
    expect(storageHome(row(null, 'drive-abc'))).toBe('drive');
  });

  it('is both when a row genuinely holds a copy in each store', () => {
    /* ⚠️ Migration 048 deliberately stopped forbidding this. It is not a
       corruption to be normalised away: copying a bucket file into Drive later
       must not require deleting ours. */
    expect(storageHome(row('documents/u/1-a.pdf', 'drive-abc'))).toBe('both');
  });

  it('is none for a refused row, which is the normal shape of a refusal', () => {
    /* `markRejected` clears `storage_path` and the action deletes the object, on
       purpose. The ROW stays, with its reason. So "no home" must not read as a
       fault — see STORAGE_META.none. */
    expect(storageHome(row(null, null))).toBe('none');
  });
});

describe('the vocabulary', () => {
  it('has a label, a filter label, a token and a hint for every home', () => {
    const homes: StorageHome[] = ['bucket', 'drive', 'both', 'none'];
    for (const home of homes) {
      const meta = STORAGE_META[home];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.filterLabel.length).toBeGreaterThan(0);
      expect(meta.token.length).toBeGreaterThan(0);
      /* The hint is what a reader gets on hover, and a badge with an empty title
         is worse than no title — it looks like a bug in the tooltip. */
      expect(meta.hint.length).toBeGreaterThan(20);
    }
  });

  it('never labels a bucket-held file "In Drive" — the bug this module replaced', () => {
    expect(STORAGE_META.bucket.label).not.toMatch(/drive/i);
    expect(STORAGE_META.bucket.hint).toMatch(/not in Google Drive/i);
  });

  it('does not put "Supabase" in the badge, only in the explanation', () => {
    /* Deliberate: nobody outside this repository knows what a Supabase bucket
       is. The fact that matters on a badge is that the file is held HERE. */
    expect(STORAGE_META.bucket.label).not.toMatch(/supabase/i);
    expect(STORAGE_META.bucket.hint).toMatch(/supabase/i);
  });
});

describe('the Where filter', () => {
  const cases: ReadonlyArray<[StorageHome, StorageFilter, boolean]> = [
    ['bucket', 'anywhere', true],
    ['drive', 'anywhere', true],
    ['both', 'anywhere', true],
    ['none', 'anywhere', true],

    ['bucket', 'bucket', true],
    ['drive', 'bucket', false],
    ['none', 'bucket', false],

    ['bucket', 'drive', false],
    ['drive', 'drive', true],
    ['none', 'drive', false],
  ];

  for (const [home, filter, expected] of cases) {
    it(`${home} under "${filter}" → ${expected}`, () => {
      expect(matchesStorage(home, filter)).toBe(expected);
    });
  }

  it('shows a both-stores row under EITHER filter, on purpose', () => {
    /* ⚠️ Somebody filtering to Drive is asking "what would I find if I opened
       Drive". A file with a copy there is an honest answer, and hiding it because
       it is also held here would make the two filters add up to less than the
       whole register. */
    expect(matchesStorage('both', 'bucket')).toBe(true);
    expect(matchesStorage('both', 'drive')).toBe(true);
  });

  it('lets "anywhere" match everything, so the register is never silently short', () => {
    const homes: StorageHome[] = ['bucket', 'drive', 'both', 'none'];
    expect(homes.every((home) => matchesStorage(home, 'anywhere'))).toBe(true);
  });
});

describe('the destination posted by the upload form', () => {
  it('reads drive only from the exact value', () => {
    expect(toDestination('drive')).toBe('drive');
  });

  it('falls back to the bucket for anything else, including a missing field', () => {
    /* ⚠️ NOT AN ERROR. A missing `destination` is what a cached older client
       posts, and the safe reading of "I did not say" is "keep it here" — the
       store that needs no external service and no consent. */
    for (const value of ['bucket', '', 'Drive', 'DRIVE', 'gdrive', null, undefined]) {
      expect(toDestination(value)).toBe('bucket');
    }
    expect(DEFAULT_DESTINATION).toBe('bucket');
  });

  it('describes both destinations without promising the wrong thing', () => {
    /* The Drive card has to say there is no approval step, because that is the
       one consequence somebody would not guess and cannot undo. */
    expect(DESTINATION_META.drive.consequence).toMatch(/no approval/i);
    expect(DESTINATION_META.bucket.consequence).not.toMatch(/drive/i);
  });
});

describe('the two size ceilings', () => {
  it('caps the bucket at the Supabase project ceiling of 50 MB', () => {
    /* Not ours to raise from code — it needs a plan change, which is why the
       refusal names the number instead of suggesting a retry. */
    expect(MAX_BYTES.bucket).toBe(50 * 1024 * 1024);
    expect(maxLabel('bucket')).toBe('50 MB');
  });

  it('caps Drive at what the table permits, since it bypasses our storage', () => {
    /* ⚠️ 100 MB is `documents_size_sane` in migration 025. Raising this constant
       without raising that constraint would move the refusal from a sentence to a
       Postgres check violation. */
    expect(MAX_BYTES.drive).toBe(104857600);
    expect(maxLabel('drive')).toBe('100 MB');
  });

  it('keeps Drive the more permissive of the two, which is what the copy claims', () => {
    /* Both the form's hint and the over-size refusal offer "it would fit in the
       other one". That advice is only ever true in this direction. */
    expect(MAX_BYTES.drive).toBeGreaterThan(MAX_BYTES.bucket);
  });
});
