import { describe, expect, it } from 'vitest';

import { resolveTaskWindow } from '../task-window';

/* ============================================================================
 * THE BOARD'S DUE WINDOW
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-02: the board must open on today, and "All" must still exist.
 * These cases are the ones that decide whether it does — including the one that
 * was already wrong once.
 * ========================================================================= */

const TODAY = '2026-09-02';

describe('resolveTaskWindow', () => {
  it('opens on today when nothing is in the URL', () => {
    expect(resolveTaskWindow({}, TODAY)).toEqual({
      dueFrom: undefined,
      dueTo: TODAY,
      showAll: false,
    });
  });

  /* The whole point of the default. A window of exactly today would drop
     yesterday's unfinished work off the board while the Overdue card above it
     kept counting it. */
  it('leaves the start unbounded, so overdue and undated work still arrive', () => {
    const w = resolveTaskWindow({}, TODAY);
    expect(w.dueFrom).toBeUndefined();
    expect(w.dueTo).toBe(TODAY);
  });

  it('drops every bound for the owner’s All filter', () => {
    expect(resolveTaskWindow({ range: 'all' }, TODAY)).toEqual({
      dueFrom: undefined,
      dueTo: undefined,
      showAll: true,
    });
  });

  it('ignores from/to once All is asked for', () => {
    const w = resolveTaskWindow({ range: 'all', from: '2026-01-01', to: '2026-01-31' }, TODAY);
    expect(w.dueFrom).toBeUndefined();
    expect(w.dueTo).toBeUndefined();
  });

  it('honours a window somebody picked', () => {
    expect(resolveTaskWindow({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toEqual({
      dueFrom: '2026-09-01',
      dueTo: '2026-09-30',
      showAll: false,
    });
  });

  /* ── ⚠️ THE REGRESSION THIS FILE EXISTS FOR ───────────────────────────────
     `params.to || today` reads a cleared box as "no answer" and refills it with
     today, so the range could never be opened forwards. Absent is not empty. */
  it('treats a CLEARED end date as unbounded, not as today', () => {
    expect(resolveTaskWindow({ to: '' }, TODAY).dueTo).toBeUndefined();
  });

  it('still defaults an ABSENT end date to today', () => {
    expect(resolveTaskWindow({ from: '2026-08-01' }, TODAY).dueTo).toBe(TODAY);
  });

  it('lets a start alone mean "from here onwards"', () => {
    const w = resolveTaskWindow({ from: '2026-08-01', to: '' }, TODAY);
    expect(w).toEqual({ dueFrom: '2026-08-01', dueTo: undefined, showAll: false });
  });

  it('reads an unrecognised range as no range at all, rather than erroring', () => {
    expect(resolveTaskWindow({ range: 'last_fortnight' }, TODAY).dueTo).toBe(TODAY);
  });
});
