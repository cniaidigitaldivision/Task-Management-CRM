import { describe, expect, it } from 'vitest';

import { isRetryableRefusal } from '../whatsapp';

/* ============================================================================
 * "NEVER" AND "NOT YET" ARE DIFFERENT ANSWERS
 * ----------------------------------------------------------------------------
 * The follow-up queue settles a refusal as `failed`, which is terminal and
 * retried by nothing. That is right for a message that is broken and wrong for
 * one that was merely early.
 *
 * It became real on 2026-09-19: the owner added a Confirm button to
 * `appointment_confirmed`, and editing an approved template sends it back to
 * PENDING. Meta refuses a send on a PENDING template with 132001. Any visit
 * booked during that window — with the client's 24-hour window closed, the only
 * case that needs a template at all — would have had its confirmation refused
 * once and then never sent, even after approval. Silently.
 *
 * ⚠️ THE DEFAULT MUST BE TO STOP. A retry is not free: it is the same refusal
 * eight times and a "your visit is tomorrow" that lands the day after. So this
 * list stays short, and anything not on it is permanent.
 * ========================================================================= */

describe('isRetryableRefusal', () => {
  it('waits for a template that is still being approved', () => {
    /* The one that prompted this. Editing an approved template causes it. */
    expect(isRetryableRefusal(132001)).toBe(true);
  });

  it('waits for a template Meta paused for quality, because it un-pauses', () => {
    expect(isRetryableRefusal(132015)).toBe(true);
  });

  it('waits out both rate limits rather than dropping the message', () => {
    expect(isRetryableRefusal(130429)).toBe(true); // the business's throughput cap
    expect(isRetryableRefusal(131056)).toBe(true); // the per-recipient pair cap
  });

  it("waits out Meta's own transient failure", () => {
    expect(isRetryableRefusal(131000)).toBe(true);
    expect(isRetryableRefusal(500)).toBe(true);
  });

  /* ── The other half, which matters more ──────────────────────────────────── */

  it('does NOT retry a message that is wrong, however many times it is sent', () => {
    /* Parameter count mismatch: the template wants five and got four. Sending
       the identical thing again produces the identical refusal. */
    expect(isRetryableRefusal(132000)).toBe(false);
    /* Hydrated text too long. */
    expect(isRetryableRefusal(132005)).toBe(false);
    /* Character policy violation in the filled-in text. */
    expect(isRetryableRefusal(132007)).toBe(false);
    /* Parameter format mismatch. */
    expect(isRetryableRefusal(132012)).toBe(false);
  });

  it('does NOT retry a closed 24-hour window, because time only makes it worse', () => {
    /* ⚠️ THE TEMPTING WRONG ANSWER. 131047 looks transient — "try again later" —
       but the window only ever closes further. The way out is a template, or the
       client writing first; neither happens by waiting, and eight retries would
       just be eight identical refusals against a lead nobody is helping. */
    expect(isRetryableRefusal(131047)).toBe(false);
  });

  it('does NOT retry a number that cannot receive the message at all', () => {
    expect(isRetryableRefusal(131026)).toBe(false); // undeliverable
    expect(isRetryableRefusal(131051)).toBe(false); // unsupported message type
  });

  it('treats an unknown code as permanent, so a new failure stops rather than loops', () => {
    expect(isRetryableRefusal(999999)).toBe(false);
    expect(isRetryableRefusal(0)).toBe(false);
  });

  it('treats a missing code as permanent', () => {
    /* ⚠️ A REFUSAL WITH NO CODE IS NOT A NETWORK FAILURE. Those are marked
       retryable at the point they are caught, where the distinction is known;
       here, no code means Meta answered and said no without naming why. */
    expect(isRetryableRefusal(undefined)).toBe(false);
  });
});
