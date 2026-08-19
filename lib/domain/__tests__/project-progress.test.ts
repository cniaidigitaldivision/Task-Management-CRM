import { describe, expect, it } from 'vitest';

import {
  VERDICT_LABEL,
  VERDICT_TOKEN,
  projectProgress,
  type ProgressVerdict,
} from '../project-progress';

/* ============================================================================
 * PROGRESS AGAINST WHAT WAS PROMISED
 * ----------------------------------------------------------------------------
 * These tests exist because the three rules are each counter-intuitive on their
 * own, and every one of them decides whether a client shows red or green in a
 * report the CEO reads.
 * ========================================================================= */

const at = (over: Partial<Parameters<typeof projectProgress>[0]> = {}) =>
  projectProgress({
    assetsPublished: 0,
    reelsPublished: 0,
    assetsTargetMin: null,
    assetsTargetMax: null,
    reelsTargetMin: null,
    ...over,
  });

describe('rule 1 — the MINIMUM is the promise, not the ceiling', () => {
  it('calls SPARK met at 14 of "14–16"', () => {
    /* The whole point. Reading the ceiling as the target would report a client
       who got exactly what was sold as underserved. */
    const p = at({ assetsPublished: 14, assetsTargetMin: 14, assetsTargetMax: 16, reelsPublished: 2, reelsTargetMin: 2 });
    expect(p.verdict).toBe('met');
    expect(p.assetsRemaining).toBe(0);
  });

  it('still calls it met at 15 and 16 — inside the range is not a shortfall', () => {
    for (const published of [15, 16]) {
      const p = at({ assetsPublished: published, assetsTargetMin: 14, assetsTargetMax: 16, reelsPublished: 2, reelsTargetMin: 2 });
      expect(p.verdict, `${published} of 14–16`).toBe('met');
    }
  });

  it('is behind at 13, and says how many are left', () => {
    const p = at({ assetsPublished: 13, assetsTargetMin: 14, assetsTargetMax: 16 });
    expect(p.verdict).toBe('behind');
    expect(p.assetsRemaining).toBe(1);
    expect(p.summary).toContain('1 to go');
  });

  it('flags going above the ceiling, because it may be unbilled work', () => {
    const p = at({ assetsPublished: 20, assetsTargetMin: 14, assetsTargetMax: 16, reelsPublished: 2, reelsTargetMin: 2 });
    expect(p.verdict).toBe('exceeded');
    expect(p.summary).toMatch(/billed/i);
  });
});

describe('rule 2 — "up to 75" is a ceiling with no floor', () => {
  it('is untargeted rather than behind when no minimum was agreed', () => {
    /* PERFORMANCE has assetsMin null. A project on it cannot MISS a target it
       was never given, and a report must not paint it red. */
    const p = at({ assetsPublished: 3, assetsTargetMin: null, assetsTargetMax: 75 });
    expect(p.verdict).toBe('untargeted');
    expect(p.assetsPercent).toBeNull();
    expect(p.assetsRemaining).toBe(0);
  });

  it('is untargeted even at zero published', () => {
    expect(at({ assetsTargetMax: 75 }).verdict).toBe('untargeted');
  });

  it('still judges reels when only the reel minimum exists', () => {
    /* "Up to 75 assets, at least 4 of them reels" is a coherent deal, so the
       missing asset minimum must not switch the reel check off. */
    const p = at({ assetsPublished: 30, assetsTargetMax: 75, reelsPublished: 1, reelsTargetMin: 4 });
    expect(p.verdict).toBe('short_on_reels');
    expect(p.reelsRemaining).toBe(3);
  });

  it('reports no minimum plainly when there is no ceiling either', () => {
    /* PLATINUM: the document says "high-volume", which is a description. */
    const p = at({ assetsPublished: 40 });
    expect(p.verdict).toBe('untargeted');
    expect(p.summary).toMatch(/no monthly minimum/i);
  });
});

describe('rule 3 — reels sit INSIDE the asset total', () => {
  it('is short on reels even when assets are over the minimum', () => {
    /* The case that justifies judging reels separately: 16 assets is more than
       the 14 promised, and the client still did not get their reels. */
    const p = at({ assetsPublished: 16, assetsTargetMin: 14, assetsTargetMax: 16, reelsPublished: 0, reelsTargetMin: 2 });
    expect(p.verdict).toBe('short_on_reels');
    expect(p.assetsRemaining).toBe(0);
    expect(p.reelsRemaining).toBe(2);
  });

  it('does not double-count: reels are not added on top of assets', () => {
    /* 14 assets of which 2 are reels = 14 published, not 16. If reels were
       additive this would read as behind. */
    const p = at({ assetsPublished: 14, assetsTargetMin: 14, reelsPublished: 2, reelsTargetMin: 2 });
    expect(p.verdict).toBe('met');
  });

  it('prefers "behind" over "short on reels" when both are true', () => {
    /* Assets are the bigger problem and the one to fix first; saying "short on
       reels" would understate it. */
    const p = at({ assetsPublished: 5, assetsTargetMin: 14, reelsPublished: 0, reelsTargetMin: 2 });
    expect(p.verdict).toBe('behind');
    expect(p.summary).toContain('reel');
  });

  it('ignores reels entirely when none were promised', () => {
    const p = at({ assetsPublished: 14, assetsTargetMin: 14, reelsPublished: 0, reelsTargetMin: null });
    expect(p.verdict).toBe('met');
    expect(p.reelsPercent).toBeNull();
  });
});

describe('the numbers a bar draws', () => {
  it('never exceeds 100, however far over the target', () => {
    const p = at({ assetsPublished: 200, assetsTargetMin: 14, reelsPublished: 50, reelsTargetMin: 2 });
    expect(p.assetsPercent).toBe(100);
    expect(p.reelsPercent).toBe(100);
  });

  it('never goes below 0', () => {
    expect(at({ assetsPublished: 0, assetsTargetMin: 14 }).assetsPercent).toBe(0);
  });

  it('is null when there is nothing to measure against', () => {
    const p = at({ assetsPublished: 9 });
    expect(p.assetsPercent).toBeNull();
    expect(p.reelsPercent).toBeNull();
  });

  it('treats a target of zero as met rather than dividing by it', () => {
    /* 0 is a legitimate agreed target — "we publish nothing this month" — and
       must not produce NaN or Infinity in a percentage. */
    const p = at({ assetsPublished: 0, assetsTargetMin: 0 });
    expect(p.verdict).toBe('met');
    expect(Number.isFinite(p.assetsPercent!)).toBe(true);
  });
});

describe('presentation', () => {
  it('gives every verdict a token and a label', () => {
    const all: ProgressVerdict[] = ['untargeted', 'met', 'exceeded', 'short_on_reels', 'behind'];
    for (const verdict of all) {
      expect(VERDICT_TOKEN[verdict]).toBeTruthy();
      expect(VERDICT_LABEL[verdict]).toBeTruthy();
    }
  });

  it('never paints an untargeted project red', () => {
    /* The failure this guards: a project with no agreed minimum showing as a
       problem in a board report, which would send somebody chasing a target
       that was never sold. */
    expect(VERDICT_TOKEN.untargeted).not.toContain('error');
    expect(VERDICT_TOKEN.exceeded).not.toContain('error');
  });

  it('always produces a summary sentence', () => {
    for (const input of [
      {},
      { assetsPublished: 5, assetsTargetMin: 14 },
      { assetsPublished: 16, assetsTargetMin: 14, assetsTargetMax: 16, reelsTargetMin: 2 },
      { assetsPublished: 99, assetsTargetMin: 1, assetsTargetMax: 2 },
    ]) {
      expect(at(input).summary.length).toBeGreaterThan(0);
    }
  });
});
