/* ============================================================================
 * THE SCHEDULE GENERATOR — TURNING A RHYTHM INTO ACTUAL WORK
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-22: *"daily tasks should be automatically created, and these
 * things should be properly working."*
 *
 * `cadence.ts` already answers "what goes out in August, exactly?" — its
 * `monthPlan()` returns every date with the static posts and reels that date
 * carries, and its header has said since it was written that it *"feeds the
 * schedule generator"*. That generator is this file. Until now the plan was
 * drawn on the project page and nothing ever became a task, which is why a
 * project with a 22-asset package showed `Today 0/3` and an empty week: the
 * expectation was computed, the work was not.
 *
 * Pure by contract: no clock, no database (doc 20 §5). The caller supplies the
 * month plan, what already exists, and the window to fill.
 *
 * ── ⚠️ IT TOPS UP. IT DOES NOT INSERT. ───────────────────────────────────────
 * This is the whole design, and it is what makes running it twice harmless.
 *
 * The naive generator inserts one row per planned slot, so pressing the button
 * again doubles the month and a nightly job that retries after a timeout
 * silently triples a day. Guarding that with a "generated" flag on the row
 * would work right up until somebody edits one, and then the flag is a lie.
 *
 * So nothing is marked. The generator counts what the day ALREADY holds and
 * creates only the difference. Three consequences, all of them wanted:
 *
 *   · Running it twice is a no-op the second time.
 *   · A task a Coordinator made by hand COUNTS toward that day's quota — the
 *     generator tops the day up to three, it does not add three more.
 *   · Deleting a generated task and re-running brings it back, which is the
 *     behaviour somebody who deleted it by accident expects.
 *
 * ── ⚠️ WHY THE WINDOW IS AN ARGUMENT AND NOT "THE WHOLE MONTH" ───────────────
 * Filling the month from the 1st would date-stamp work onto days that have
 * already passed, and a task due last Tuesday is overdue the moment it is
 * created. A project would open onto a wall of invented lateness that nobody
 * was ever asked to do.
 *
 * The caller therefore names the window. The button asks for today→month end;
 * the nightly job (phase 3) will ask for tomorrow alone. One function serves
 * both because neither one gets to assume what the other meant.
 * ========================================================================= */

import type { MonthPlan } from './cadence';
import { CONTENT_KIND_LABEL, EFFORT_POINTS, type ContentKind, type EffortSize } from './constants';

/** The only two kinds a rhythm can produce. A cadence agrees static posts and
 *  reels; carousels and stories are a human's choice on an individual task. */
export type ScheduledKind = Extract<ContentKind, 'static' | 'reel'>;

/** What a date already holds, so the generator knows what is missing.
 *  Counts are of NON-DELETED tasks; a soft-deleted task is not work. */
export interface DayTally {
  /** 'YYYY-MM-DD'. */
  readonly date: string;
  readonly staticPosts: number;
  readonly reels: number;
}

export interface ScheduledTask {
  /** 'YYYY-MM-DD' — becomes the task's due date. */
  readonly date: string;
  readonly contentKind: ScheduledKind;
  readonly title: string;
  readonly effortSize: EffortSize;
  readonly effortPoints: number;
}

export interface ScheduleRequest {
  readonly plan: MonthPlan;
  readonly existing: readonly DayTally[];
  /** Inclusive 'YYYY-MM-DD'. Dates before this are left alone. */
  readonly from: string;
  /** Inclusive 'YYYY-MM-DD'. */
  readonly to: string;
}

/* ── EFFORT ───────────────────────────────────────────────────────────────────
   A reel is filmed, cut and captioned; a static post is designed once. Sizing
   them identically would make the workload screen — which is driven by these
   points — report a reel-heavy week as no busier than a quiet one, and that
   screen is the reason capacity limits exist at all. */
const EFFORT_FOR: Readonly<Record<ScheduledKind, EffortSize>> = {
  static: 'S',
  reel: 'M',
};

/* Month abbreviations, indexed 1-12. Derived from the date STRING rather than
   a Date object: `new Date('2026-08-21')` is UTC midnight and reports July for
   anyone behind UTC, which is the exact trap `cadence.ts` documents. */
const MONTH_ABBR = [
  '',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** '2026-08-21' → '21 Aug'. Pure string work, no timezone to get wrong. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_ABBR[Number(month)] ?? ''}`.trim();
}

/**
 * Title for one generated task.
 *
 * The day's position is included ONLY when the day carries more than one of a
 * kind. "Static post 1 of 1 — 21 Aug" is noise; with three a day, a board of
 * identical titles is unusable and the numbering is the only thing telling them
 * apart.
 */
function titleFor(kind: ScheduledKind, date: string, slot: number, of: number): string {
  const label = CONTENT_KIND_LABEL[kind];
  const position = of > 1 ? ` ${slot} of ${of}` : '';
  return `${label}${position} — ${shortDate(date)}`;
}

/**
 * The tasks that must be created for the plan to be satisfied in this window.
 *
 * Returns them in date order, static posts before reels within a date, so the
 * rows land on the board in an order a human would have chosen.
 */
export function scheduleShortfall(request: ScheduleRequest): ScheduledTask[] {
  const { plan, existing, from, to } = request;

  /* ISO dates compare correctly as strings — 'YYYY-MM-DD' is lexicographically
     ordered by construction, which is the reason the format is used. */
  const tally = new Map<string, DayTally>();
  for (const day of existing) tally.set(day.date, day);

  const out: ScheduledTask[] = [];

  for (const day of plan.days) {
    if (day.isOff) continue;
    if (day.date < from || day.date > to) continue;

    const have = tally.get(day.date);

    for (const kind of ['static', 'reel'] as const) {
      const wanted = kind === 'static' ? day.staticPosts : day.reels;
      if (wanted <= 0) continue;

      const held = (kind === 'static' ? have?.staticPosts : have?.reels) ?? 0;

      /* `Math.max(0, …)` matters: a day may legitimately hold MORE than the
         rhythm asks for, because somebody added an extra post. That is not an
         error and there is nothing to remove — the generator only ever adds. */
      const missing = Math.max(0, wanted - held);

      for (let index = 0; index < missing; index += 1) {
        const size = EFFORT_FOR[kind];
        out.push({
          date: day.date,
          contentKind: kind,
          /* Numbered from what the day already holds, so topping a day up from
             one to three produces "2 of 3" and "3 of 3" rather than restarting
             at one and colliding with the task already sitting there. */
          title: titleFor(kind, day.date, held + index + 1, wanted),
          effortSize: size,
          effortPoints: EFFORT_POINTS[size],
        });
      }
    }
  }

  return out;
}

/* ----------------------------------------------------------------------------
 * WINDOWS THAT CROSS A MONTH BOUNDARY
 * ----------------------------------------------------------------------------
 * `monthPlan()` answers for ONE month, which suits the button — it fills the
 * month on screen. The nightly job does not have a month on screen: it keeps a
 * rolling horizon topped up, and on the 25th that horizon runs into next month.
 *
 * Asking for a plan of "August" and then filling dates in September would
 * silently produce nothing, because September's dates are absent from August's
 * `days`. The caller therefore needs to know which months a range touches, and
 * this is that, kept pure and here rather than derived with a Date loop at the
 * call site where a timezone would eventually get into it.
 * ------------------------------------------------------------------------- */

/** Every 'YYYY-MM-01' a date range touches, in order. Both bounds inclusive. */
export function monthsSpanning(from: string, to: string): string[] {
  if (from > to) return [];

  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));

  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));

  /* Integer arithmetic on year/month, never `setMonth` on a Date — adding a
     month to 31 January with a Date gives 3 March. */
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return out;
}

/** A one-line summary for the action to hand back to the person who pressed the
 *  button. Says nothing happened when nothing did, rather than "created 0". */
export function describeShortfall(tasks: readonly ScheduledTask[]): string {
  if (tasks.length === 0) return 'Already up to date — nothing to add.';

  const statics = tasks.filter((t) => t.contentKind === 'static').length;
  const reels = tasks.length - statics;

  const parts: string[] = [];
  if (statics > 0) parts.push(`${statics} static ${statics === 1 ? 'post' : 'posts'}`);
  if (reels > 0) parts.push(`${reels} ${reels === 1 ? 'reel' : 'reels'}`);

  return `Added ${parts.join(' and ')}.`;
}
