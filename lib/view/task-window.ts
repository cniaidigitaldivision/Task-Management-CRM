/* ============================================================================
 * WHICH TASKS THE BOARD ASKS FOR
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-02: *"by default it should show only today's tasks not the
 * whole month's tasks. When I want to see all the tasks, I will put the All
 * filter."* And, in the same message, the reason it mattered: *"my system is
 * getting heavy and slow… nothing is in my database right now, only 300
 * tasks."*
 *
 * Both were the same fault. /tasks read EVERY task and filtered in the browser:
 * measured on the live database that day, 318 rows of which 293 were due in the
 * future, serialising to 275 kB for a screen showing 25 cards. A browser-side
 * filter cannot help with that — the rows have already been read, serialised,
 * sent to Karachi, parsed and hydrated by the time it runs.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 * It is four lines of ternaries that decide what the page reads, and it was
 * wrong the first time it was written (see `absent vs cleared` below). Inline in
 * a Server Component it could only be checked by loading the page and squinting;
 * out here it is a pure function with a test naming each case.
 * ========================================================================= */

/** The due-date bounds to hand `listTasks`, plus what the toolbar should show. */
export interface TaskWindow {
  /** Undefined ⇒ unbounded on that side. */
  readonly dueFrom: string | undefined;
  readonly dueTo: string | undefined;
  /** True when no date bound applies at all — the owner's "All". */
  readonly showAll: boolean;
}

/** Just the search params this cares about. */
export interface TaskWindowParams {
  readonly range?: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Resolve the board's due window from the URL.
 *
 * ── ⚠️ THE DEFAULT IS `to = today` WITH NO `from`, NOT `from = to = today` ───
 * A window of exactly today would also hide OVERDUE work, which is the one
 * thing on a task board nobody can afford to miss — and the page carries an
 * Overdue card that would then have contradicted the board sitting beneath it.
 * An open-ended start reads as "everything up to and including today": due
 * today, everything late, and undated work. That is the question somebody
 * opening a task board is actually asking.
 *
 * ── ⚠️ ABSENT AND EMPTY ARE DIFFERENT ANSWERS ───────────────────────────────
 * This is the bug this file exists to prevent. The first cut read the end date
 * as `params.to || today`, which treats a deliberately cleared box as "no
 * answer" and snaps the window back to today — so emptying the end date
 * silently refilled itself and the range could not be opened forwards at all.
 *
 * No parameter means nobody has chosen yet, so: today. An empty parameter is
 * somebody's choice, so: unbounded.
 */
export function resolveTaskWindow(params: TaskWindowParams, today: string): TaskWindow {
  if (params.range === 'all') {
    return { dueFrom: undefined, dueTo: undefined, showAll: true };
  }

  return {
    dueFrom: params.from || undefined,
    dueTo: params.to === undefined ? today : params.to || undefined,
    showAll: false,
  };
}
