import { monthPlan, type Cadence } from './cadence';
import { isoWeekday } from './attendance';
import type { ContentKind } from './constants';

/* ============================================================================
 * THE CONTENT TRACKER — WHAT THE RHYTHM STILL OWES
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03, replacing the bulk month:
 *
 *   *"You will just set a tracker, which will check every day whether the post
 *   task is done, whether the reel task is done, whether the 2 reel tasks in a
 *   week are done… If during the project creation it is said that one static
 *   post daily, then the tracker will just observe that a daily one static post
 *   task should create, whether it is created by any of the team members which
 *   is who is working on that project."*
 *
 * And the enforcement, in the same message:
 *
 *   *"if someone of the team member that is working on that project is trying to
 *   create a third reel task. It would not let them create and give them a
 *   message or a error that the target of a week is achieved."*
 *
 *   *"No other static post task will be created for that project on a same day
 *   by any other member of that project."*
 *
 * ── ⚠️ THIS FILE DOES NO CALENDAR ARITHMETIC OF ITS OWN ─────────────────────
 * `monthPlan` already turns a cadence into a target per date, including off
 * days and which weekdays carry reels, and it is already tested. Re-deriving
 * "is today a posting day" here would be a second answer to a question that has
 * one — and the two would disagree the first time either changed. So the day's
 * target is looked UP in the plan, never recomputed.
 *
 * ── ⚠️ A NULL TARGET IS NOT A TARGET OF ZERO ────────────────────────────────
 * The distinction `contractTargets` and `projectProgress` already depend on. A
 * project with no agreed rhythm (a website build, a one-off event) must never be
 * told it has met or missed anything, and must never have a creation refused —
 * refusing on a null target would make every untargeted project unusable.
 * ========================================================================= */

/** What already exists in the database, for one project and one day. */
export interface ContentCounts {
  /** Static content tasks already on that date, raised by anybody. */
  readonly staticOnDay: number;
  /** Reel tasks already in that date's ISO week, raised by anybody. */
  readonly reelsInWeek: number;
  /** Who raised them, so a refusal can name a person instead of a number. */
  readonly staticRaisedBy: readonly string[];
  readonly reelsRaisedBy: readonly string[];
}

/** The tracker's answer for one day. */
export interface DayStanding {
  /** The project does not post on this weekday at all. */
  readonly isOffDay: boolean;
  /** Null when no rhythm was agreed — see the header. */
  readonly staticTarget: number | null;
  readonly staticHave: number;
  readonly staticOwed: number;
  /** How many reels the rhythm puts on THIS date (0 unless a reel day). */
  readonly reelTargetToday: number;
  readonly reelsOwedToday: number;
  /** The weekly reel promise, and where the week stands against it. */
  readonly reelWeekTarget: number | null;
  readonly reelsInWeek: number;
  readonly reelsOwedThisWeek: number;
  /** True when nothing at all is outstanding for this date. */
  readonly settled: boolean;
}

/**
 * Monday-to-Sunday bounds of the ISO week containing `day`.
 *
 * ⚠️ Monday-first, because every other week in this product is: the attendance
 * board, the calendar page, the overview chart and `reel_days` all count Monday
 * as day 1. A Sunday-first week here would put a Sunday reel in the wrong
 * week's tally and quietly allow a third reel.
 *
 * ⚠️ UTC parts throughout — `new Date('2026-09-06').getDay()` answers in the
 * local zone, which is the previous day anywhere behind UTC. `lib/now.ts` and
 * `cadence.ts` both document this trap.
 */
export function isoWeekBounds(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number);
  const at = Date.UTC(y, m - 1, d);
  const back = (isoWeekday(day) - 1) * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(at - back), to: iso(at - back + 6 * 86_400_000) };
}

/**
 * Where a project stands against its rhythm on one day.
 *
 * `counts` comes from the database; everything else is the agreed cadence. Pure,
 * so the refusal messages and the "owed today" list are computed from the same
 * function the tests exercise.
 */
export function dayStanding(cadence: Cadence, counts: ContentCounts, day: string): DayStanding {
  /* Looked up in the plan, not recomputed — see the header. */
  const plan = monthPlan(cadence, `${day.slice(0, 7)}-01`);
  const planned = plan.days.find((entry) => entry.date === day);

  const isOffDay = planned?.isOff ?? false;

  /* ⚠️ `staticPostsPerDay` is the source of truth for whether a target EXISTS;
     `planned.staticPosts` is that target applied to this date, and is 0 on an
     off day. Reading only the second would make an off day indistinguishable
     from a project with no rhythm at all. */
  const staticTarget =
    cadence.staticPostsPerDay === null ? null : (planned?.staticPosts ?? 0);

  const staticOwed =
    staticTarget === null ? 0 : Math.max(0, staticTarget - counts.staticOnDay);

  const reelTargetToday = planned?.reels ?? 0;
  const reelsOwedToday = Math.max(0, reelTargetToday - counts.reelsInWeek);

  const reelWeekTarget = cadence.reelsPerWeek;
  const reelsOwedThisWeek =
    reelWeekTarget === null ? 0 : Math.max(0, reelWeekTarget - counts.reelsInWeek);

  return {
    isOffDay,
    staticTarget,
    staticHave: counts.staticOnDay,
    staticOwed,
    reelTargetToday,
    reelsOwedToday,
    reelWeekTarget,
    reelsInWeek: counts.reelsInWeek,
    reelsOwedThisWeek,
    settled: staticOwed === 0 && reelsOwedThisWeek === 0,
  };
}

/** Comma-separated names, or an empty string. Kept small and local. */
function nameList(names: readonly string[]): string {
  const unique = [...new Set(names.filter((n) => n.trim().length > 0))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * May this content task be created, or is the target already accounted for?
 *
 * Returns the refusal sentence, or null to allow. One call, one sentence, so the
 * server action and the form show the reader the same words.
 *
 * ⚠️ ONLY `static` AND `reel` ARE CAPPED. They are the two the owner set targets
 * for. A carousel, a story, a video or an untyped task is real work somebody
 * decided to do and has no agreed number to exceed — capping those would refuse
 * work nobody promised a quantity of.
 *
 * ⚠️ AND ONLY WHERE A TARGET EXISTS. A null target means no rhythm was agreed,
 * so there is nothing to be full.
 */
export function contentCapRefusal(input: {
  readonly cadence: Cadence;
  readonly contentKind: ContentKind | null;
  readonly dueDate: string | null;
  readonly counts: ContentCounts;
  readonly projectName: string;
}): string | null {
  const { cadence, contentKind, dueDate, counts, projectName } = input;

  /* No date means the task is not on any day, so it cannot fill a day's quota
     or a week's. It is also not a scheduled deliverable in the sense the target
     is about. */
  if (!dueDate) return null;

  if (contentKind === 'static') {
    const target = cadence.staticPostsPerDay;
    if (target === null || counts.staticOnDay < target) return null;

    const who = nameList(counts.staticRaisedBy);
    const raised = who ? `, raised by ${who}` : '';
    return target === 1
      ? `${projectName} already has a static post for that day${raised}. One a day is what was agreed — nobody needs to raise a second.`
      : `${projectName} already has its ${target} static posts for that day${raised}.`;
  }

  if (contentKind === 'reel') {
    const target = cadence.reelsPerWeek;
    if (target === null || counts.reelsInWeek < target) return null;

    const who = nameList(counts.reelsRaisedBy);
    const raised = who ? ` (${who})` : '';
    const { to } = isoWeekBounds(dueDate);
    return `This week's ${target} reel${target === 1 ? '' : 's'} for ${projectName} are already accounted for${raised}. The target of the week is achieved — the next reel belongs to the week beginning ${nextMonday(to)}.`;
  }

  return null;
}

/** The Monday after a week's Sunday. Used only to finish the sentence above. */
function nextMonday(weekEndIso: string): string {
  const [y, m, d] = weekEndIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

/** One outstanding thing a project owes, ready for the "owed today" list. */
export interface OwedLine {
  readonly kind: 'static' | 'reel';
  readonly count: number;
  /** Why it is owed, when the number alone would not say. */
  readonly note: string | null;
}

/**
 * What a project still owes on `day`, as lines a person can act on.
 *
 * ── ⚠️ THE REEL LINE IS THE WEEK'S DEBT, NOT THE DAY'S ──────────────────────
 * Owner's rhythm is *"two reels in a week"*, and `reel_days` names which
 * weekdays they were pencilled in for. Offering a reel ONLY on those two days
 * would mean a week where somebody was ill on both loses its reels with no way
 * to catch up — the target is weekly, so the offer is weekly, and the note says
 * where the week stands.
 *
 * The static line is the day's, because that target is daily.
 *
 * ⚠️ An off day owes nothing, and a project with no rhythm owes nothing — a
 * null target is not a target of zero.
 */
export function owedLines(cadence: Cadence, counts: ContentCounts, day: string): OwedLine[] {
  const standing = dayStanding(cadence, counts, day);
  const lines: OwedLine[] = [];

  if (standing.staticOwed > 0) {
    lines.push({ kind: 'static', count: standing.staticOwed, note: null });
  }

  if (standing.reelsOwedThisWeek > 0) {
    const target = standing.reelWeekTarget ?? 0;
    lines.push({
      kind: 'reel',
      count: standing.reelsOwedThisWeek,
      /* "1 of 2 done this week" — the number on its own would not say whether
         this is the start of the week or the end of it. */
      note: `${standing.reelsInWeek} of ${target} done this week`,
    });
  }

  return lines;
}
