import { describe, expect, it } from 'vitest';

import {
  ACCESS_MEANS,
  ACCESS_META,
  FOLDER_ACCESS,
  accessAtLeast,
  isFolderAccess,
  type FolderAccess,
} from '../folder-access';

/* ============================================================================
 * FOLDER ACCESS LEVELS
 * ----------------------------------------------------------------------------
 * These tests exist for one reason: this list is duplicated. `public.folder_access`
 * in migration 028 is a Postgres enum whose ORDER decides what every policy on
 * `documents` permits, and this array has to be the same list in the same order.
 * A test cannot reach into Postgres from here, so it pins the half it can see —
 * loudly enough that changing it without changing the migration fails.
 * ========================================================================= */

describe('the level list', () => {
  it('is exactly the four levels of migration 028, in ascending order', () => {
    /* ⚠️ If this fails, migration 028's enum must change in the same commit, and
       `alter type … add value … before/after` must NOT be used to do it. */
    expect(FOLDER_ACCESS).toEqual(['none', 'view', 'upload', 'manage']);
  });

  it('starts at the closed end, so index 0 is the safe default', () => {
    expect(FOLDER_ACCESS[0]).toBe('none');
  });

  it('has a label and a sentence for every level', () => {
    for (const level of FOLDER_ACCESS) {
      expect(ACCESS_META[level].label.length).toBeGreaterThan(0);
      expect(ACCESS_META[level].token.length).toBeGreaterThan(0);
      expect(ACCESS_MEANS[level].length).toBeGreaterThan(0);
    }
  });

  it('says out loud, in the two levels that skip approval, that they skip it', () => {
    /* The whole point of `upload` is that it bypasses the queue. A label that
       does not say so lets somebody grant it thinking it means "can add, pending
       review" — which is what the word normally means everywhere else. */
    expect(ACCESS_META.upload.label.toLowerCase()).toContain('no approval');
    expect(ACCESS_MEANS.upload).toContain('without waiting for approval');
    expect(ACCESS_MEANS.manage).toContain('without approval');
  });

  it('warns that manage includes deleting', () => {
    expect(ACCESS_META.manage.label.toLowerCase()).toContain('delete');
    expect(ACCESS_MEANS.manage).toContain('delete');
  });
});

describe('accessAtLeast', () => {
  it('is true when the levels are equal', () => {
    for (const level of FOLDER_ACCESS) {
      expect(accessAtLeast(level, level)).toBe(true);
    }
  });

  it('is a total order matching the array index', () => {
    for (const [i, level] of FOLDER_ACCESS.entries()) {
      for (const [j, min] of FOLDER_ACCESS.entries()) {
        expect(accessAtLeast(level, min)).toBe(i >= j);
      }
    }
  });

  it('lets view read but not upload', () => {
    expect(accessAtLeast('view', 'view')).toBe(true);
    expect(accessAtLeast('view', 'upload')).toBe(false);
    expect(accessAtLeast('view', 'manage')).toBe(false);
  });

  it('lets upload read and add but not delete', () => {
    expect(accessAtLeast('upload', 'view')).toBe(true);
    expect(accessAtLeast('upload', 'upload')).toBe(true);
    expect(accessAtLeast('upload', 'manage')).toBe(false);
  });

  it('lets manage do everything', () => {
    for (const min of FOLDER_ACCESS) {
      expect(accessAtLeast('manage', min)).toBe(true);
    }
  });

  it('grants none nothing beyond none', () => {
    expect(accessAtLeast('none', 'none')).toBe(true);
    expect(accessAtLeast('none', 'view')).toBe(false);
    expect(accessAtLeast('none', 'upload')).toBe(false);
    expect(accessAtLeast('none', 'manage')).toBe(false);
  });

  it('fails CLOSED on a level it has never heard of', () => {
    /* Reachable if a database row ever carries a value this build predates —
       a rollback, or a migration applied ahead of a deploy. `indexOf` returns -1
       for the unknown level, so the comparison must refuse rather than permit.
       The cast is the point of the test: it simulates data, not code. */
    const rogue = 'owner' as FolderAccess;
    expect(accessAtLeast(rogue, 'view')).toBe(false);
    expect(accessAtLeast(rogue, 'manage')).toBe(false);
    /* And it does not accidentally satisfy `none` either, which would be the
       harmless-looking version of the same bug. */
    expect(accessAtLeast(rogue, 'none')).toBe(false);
  });
});

describe('isFolderAccess', () => {
  it('accepts every real level', () => {
    for (const level of FOLDER_ACCESS) {
      expect(isFolderAccess(level)).toBe(true);
    }
  });

  it('refuses anything else, including near misses from a form', () => {
    for (const value of ['', ' ', 'View', 'VIEW', 'read', 'write', 'owner', 'true', 'null']) {
      expect(isFolderAccess(value)).toBe(false);
    }
  });
});
