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
 * ── ⚠️ THE DEFAULT IS EXACTLY TODAY: `from = to = today` ────────────────────
 * It was `to = today` with an OPEN START, so the board opened on "everything up
 * to and including today" — today's work plus everything still late. That was
 * my call and not what was asked for, and the owner corrected it on 2026-09-03:
 * *"by default the tasks page should show the today task only… when I open the
 * page it shows all the tasks till today. It should only display today's task."*
 *
 * The reason for the open start was real and is worth keeping on the record:
 * overdue work no longer appears on the board by default. Two things stop that
 * being a hole. The Overdue card above the board is counted division-wide by
 * `taskTotals` and NOT by the window, so a non-zero count is still visible on
 * the page the moment it opens — the number says "look", and the range control
 * beside it is one press from showing what it counted. And clearing the start
 * date reopens the window backwards without touching anything else.
 *
 * ── UNDATED WORK STILL APPEARS ──────────────────────────────────────────────
 * `listTasks` keeps `due_date is null` in every window, deliberately: a task
 * with no date can never match any range, so excluding it here would make it
 * reachable ONLY through All — work that exists and is invisible. It has always
 * behaved this way, browser-side before the window moved to SQL.
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

  /* Absent means nobody has chosen yet, so today — on BOTH ends now. An empty
     string is somebody's deliberate choice and stays unbounded on that side, so
     clearing the start date is how the board is opened backwards. */
  return {
    dueFrom: params.from === undefined ? today : params.from || undefined,
    dueTo: params.to === undefined ? today : params.to || undefined,
    showAll: false,
  };
}
