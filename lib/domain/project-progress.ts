/* ============================================================================
 * PROGRESS AGAINST WHAT WAS PROMISED
 * ----------------------------------------------------------------------------
 * Pure by contract — no clock, no database. The published counts and the agreed
 * targets come in; a verdict comes out. Which is why this can be tested
 * exhaustively, and why the rule lives here rather than being re-derived by every
 * progress bar and every report.
 *
 * ── THE RULES, FROM THE OWNER'S OWN DECISIONS (2026-08-19) ────────────────────
 *
 * 1. THE MINIMUM IS THE PROMISE. SPARK says "14–16 monthly content assets", and
 *    14 published means the target is MET. 15 and 16 are bonus, not a shortfall
 *    against 16. Treating the ceiling as the target would report a client who got
 *    exactly what was sold as underserved.
 *
 * 2. "UP TO 75" IS A CEILING WITH NO FLOOR. PERFORMANCE has assetsMin = null. A
 *    project on it cannot "miss" — there is nothing it was promised. So the
 *    verdict is `untargeted`, not `behind`, and a report must not colour it red.
 *
 * 3. REELS SIT INSIDE THE ASSET TOTAL. Not on top. 14–16 assets OF WHICH at
 *    least 2 are reels. So a project can publish 16 assets — over the minimum —
 *    and still be short, because none of them were reels. That case is exactly
 *    why reels are judged separately instead of being folded into one number.
 * ========================================================================= */

export type ProgressVerdict =
  /** No minimum was agreed, so nothing can be missed. Never red. */
  | 'untargeted'
  /** The minimum is met, and every reel promised was delivered. */
  | 'met'
  /** Above the ceiling. Worth seeing — it may mean an add-on went unbilled. */
  | 'exceeded'
  /** Assets are met but the reel minimum is not. See rule 3. */
  | 'short_on_reels'
  /** Below the agreed minimum. */
  | 'behind';

export interface ProgressInput {
  readonly assetsPublished: number;
  readonly reelsPublished: number;
  readonly assetsTargetMin: number | null;
  readonly assetsTargetMax: number | null;
  readonly reelsTargetMin: number | null;
}

export interface Progress {
  readonly verdict: ProgressVerdict;
  /** 0–100, for a bar. Null when there is no minimum to measure against —
   *  a bar with no target is a bar that has to be honest about it. */
  readonly assetsPercent: number | null;
  readonly reelsPercent: number | null;
  /** How many more assets to reach the minimum. 0 once it is met. */
  readonly assetsRemaining: number;
  readonly reelsRemaining: number;
  /** One sentence, so the bar and the report say the same thing. */
  readonly summary: string;
}

/** Clamped, because 20 of 14 is 142% and a bar cannot draw that. The verdict
 *  carries the overshoot; the bar just fills. */
function percent(done: number, target: number): number {
  if (target <= 0) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / target) * 100)));
}

export function projectProgress(input: ProgressInput): Progress {
  const {
    assetsPublished,
    reelsPublished,
    assetsTargetMin,
    assetsTargetMax,
    reelsTargetMin,
  } = input;

  const reelsNeeded = reelsTargetMin ?? 0;
  const reelsRemaining = Math.max(0, reelsNeeded - reelsPublished);
  const reelsPercent = reelsNeeded > 0 ? percent(reelsPublished, reelsNeeded) : null;

  /* ── No minimum agreed: rule 2 ─────────────────────────────────────────────
     A reel minimum can still exist without an asset minimum, and it is still
     judged — "up to 75 assets, at least 4 of them reels" is a coherent deal. */
  if (assetsTargetMin === null) {
    if (reelsNeeded > 0 && reelsRemaining > 0) {
      return {
        verdict: 'short_on_reels',
        assetsPercent: null,
        reelsPercent,
        assetsRemaining: 0,
        reelsRemaining,
        summary: `${assetsPublished} published, but ${reelsRemaining} more reel${
          reelsRemaining === 1 ? '' : 's'
        } needed.`,
      };
    }
    return {
      verdict: 'untargeted',
      assetsPercent: null,
      reelsPercent,
      assetsRemaining: 0,
      reelsRemaining: 0,
      summary:
        assetsTargetMax === null
          ? `${assetsPublished} published. No monthly minimum agreed.`
          : `${assetsPublished} published, up to ${assetsTargetMax} allowed.`,
    };
  }

  const assetsRemaining = Math.max(0, assetsTargetMin - assetsPublished);
  const assetsPercent = percent(assetsPublished, assetsTargetMin);

  if (assetsRemaining > 0) {
    return {
      verdict: 'behind',
      assetsPercent,
      reelsPercent,
      assetsRemaining,
      reelsRemaining,
      summary: `${assetsPublished} of ${assetsTargetMin} — ${assetsRemaining} to go${
        reelsRemaining > 0
          ? `, including ${reelsRemaining} reel${reelsRemaining === 1 ? '' : 's'}`
          : ''
      }.`,
    };
  }

  /* ── Rule 3: assets met, reels not ─────────────────────────────────────────
     Reported as its own verdict rather than folded into "behind", because the
     fix is different: they are not short of work, they are short of the RIGHT
     work, and somebody needs to shoot a reel rather than post more graphics. */
  if (reelsRemaining > 0) {
    return {
      verdict: 'short_on_reels',
      assetsPercent,
      reelsPercent,
      assetsRemaining: 0,
      reelsRemaining,
      summary: `${assetsPublished} of ${assetsTargetMin} assets met, but ${reelsRemaining} more reel${
        reelsRemaining === 1 ? '' : 's'
      } needed.`,
    };
  }

  if (assetsTargetMax !== null && assetsPublished > assetsTargetMax) {
    return {
      verdict: 'exceeded',
      assetsPercent,
      reelsPercent,
      assetsRemaining: 0,
      reelsRemaining: 0,
      summary: `${assetsPublished} published — above the ${assetsTargetMax} ceiling. Worth checking it was billed.`,
    };
  }

  return {
    verdict: 'met',
    assetsPercent,
    reelsPercent,
    assetsRemaining: 0,
    reelsRemaining: 0,
    summary:
      assetsTargetMax !== null && assetsTargetMax !== assetsTargetMin
        ? `${assetsPublished} published — target of ${assetsTargetMin}–${assetsTargetMax} met.`
        : `${assetsPublished} of ${assetsTargetMin} — met.`,
  };
}

/** The feedback token each verdict paints with, so every screen agrees. */
export const VERDICT_TOKEN: Readonly<Record<ProgressVerdict, string>> = {
  untargeted: 'text-tertiary',
  met: 'feedback-success',
  exceeded: 'feedback-info',
  short_on_reels: 'feedback-warning',
  behind: 'feedback-error',
};

export const VERDICT_LABEL: Readonly<Record<ProgressVerdict, string>> = {
  untargeted: 'No target',
  met: 'On target',
  exceeded: 'Over the ceiling',
  short_on_reels: 'Short on reels',
  behind: 'Behind',
};
