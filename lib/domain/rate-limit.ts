/* ============================================================================
 * RATE LIMITING — FR-148
 * ----------------------------------------------------------------------------
 * LAYER 2. Pure: the attempts and the clock both arrive as arguments.
 *
 * ── WHY THE ACCOUNT LOCKOUT IS NOT ENOUGH ────────────────────────────────────
 * The three-strike lock (FR-155a) protects an ACCOUNT. It does nothing about
 * somebody trying one password against every address they can think of — each
 * account collects one failure, none reaches three, and the attacker walks the
 * whole staff list unimpeded. That is the common attack, not the rare one.
 *
 * So this limits by SOURCE rather than by target, and the two compose: the
 * lockout stops depth, this stops breadth.
 *
 * ── IT SLOWS DOWN BEFORE IT REFUSES ──────────────────────────────────────────
 * A hard cutoff at N attempts is easy to detect and step around — an attacker
 * learns the number and stays under it. A rising delay costs them time from the
 * first extra attempt and never gives a clean edge to calibrate against, while a
 * person mistyping twice notices nothing.
 *
 * ── AND IT FAILS OPEN, DELIBERATELY ──────────────────────────────────────────
 * With no IP — behind a proxy that strips it, or a runtime that does not supply
 * one — there is nothing to limit, and the honest response is to allow it. The
 * alternative is a shared bucket that every user shares, where one attacker
 * locks the whole company out of its own CRM. That is a denial-of-service handed
 * over for free, and it is a worse outcome than the attack being limited.
 *
 * The account lockout still applies underneath either way.
 * ========================================================================= */

export interface RateLimitDecision {
  /** False means refuse the attempt outright. */
  readonly allowed: boolean;
  /** Milliseconds to wait before answering. Rises with recent failures. */
  readonly delayMs: number;
  readonly recentFailures: number;
  readonly message?: string;
}

/** Failures from one source before anything changes. Two typos are free. */
export const FREE_ATTEMPTS = 5;

/** Above this, the source is refused entirely for the window. */
export const HARD_LIMIT = 20;

/** How far back failures are counted. */
export const WINDOW_MINUTES = 15;

/** Each failure past the free allowance adds this much, capped. */
const STEP_MS = 400;
const MAX_DELAY_MS = 4_000;

export function evaluateRateLimit(input: {
  /** Timestamps of failed attempts from this source, any order. */
  readonly failureTimes: readonly number[];
  readonly now: number;
  readonly windowMinutes?: number;
}): RateLimitDecision {
  const window = (input.windowMinutes ?? WINDOW_MINUTES) * 60_000;

  const recent = input.failureTimes.filter(
    /* Future-dated entries are discarded, and that discard is why C-19 happened
       once already: the caller must pass the DATABASE's clock, because these
       timestamps were written by it. A few seconds of skew otherwise throws away
       every fresh failure and the limit silently never applies. */
    (at) => at <= input.now && input.now - at <= window,
  );

  const count = recent.length;

  if (count >= HARD_LIMIT) {
    return {
      allowed: false,
      delayMs: 0,
      recentFailures: count,
      message: `Too many failed sign-in attempts from this connection. Try again in ${input.windowMinutes ?? WINDOW_MINUTES} minutes.`,
    };
  }

  const over = Math.max(0, count - FREE_ATTEMPTS);
  return {
    allowed: true,
    delayMs: Math.min(over * STEP_MS, MAX_DELAY_MS),
    recentFailures: count,
  };
}
