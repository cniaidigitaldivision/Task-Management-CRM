import { describe, expect, it } from 'vitest';

import { allowedTransitions, evaluateTransition } from '../task-machine';
import {
  CONTENT_KIND_LABEL,
  CONTENT_KINDS,
  PLACEMENT_KINDS,
  PUBLISH_PROOF_KINDS,
  TASK_STATUSES,
} from '../constants';
import type { ContentKind, Role, TaskStatus } from '../constants';

/* ============================================================================
 * PUBLISHED WORK IS CLOSED BY A LINK — owner rule, 2026-08-24
 * ----------------------------------------------------------------------------
 * *"The static post, reel, carousel, story, and reel, along with all these kinds
 * of things that are published, must have some URL. Consider them done or even
 * let them move to the done status only when their URL will be provided.
 * Otherwise not to let them move into the done category."*
 *
 * The rule is about anything that gets PUBLISHED, not about particular formats —
 * so it is the five kinds in `COUNTS_AS_ASSET`. Website work, ad creative,
 * reports and untyped work keep the behaviour they had: *"for now it will behave
 * the same as a normal task"* — the "whoever raised it closes it" rule tested
 * next door in task-machine-done.test.ts.
 *
 * ⚠️ It began as ['static','reel'] earlier the same day and was widened after the
 * owner clarified. The narrow version is kept in mind here because the direction
 * of the risk changed with it: a gate that is too narrow lets an unverifiable
 * figure through, and one that is too wide leaves somebody unable to close
 * finished work. The subset invariant at the foot of this file is what stops the
 * second failure mode.
 *
 * ── WHAT IS ACTUALLY BEING GUARDED ───────────────────────────────────────────
 * Not tidiness. `published_on` and the placement links are what every client
 * report counts (migration 033, lib/db/queries/project-report.ts). A post marked
 * done with no link produces a delivery figure the client is shown and nobody
 * can check — so this gate is the difference between a report that is evidence
 * and one that is a claim.
 * ========================================================================= */

const ME = 'user-me';

/** A task I raised and I am doing, so no authority rule can be what refuses it.
 *  Every assertion below is then unambiguously about the publish gate. */
const mine = (
  role: Role,
  contentKind: ContentKind | null,
  placementUrlCount: number,
) => ({
  actorRole: role,
  actorId: ME,
  assigneeId: ME,
  createdById: ME,
  contentKind,
  placementUrlCount,
});

describe('a static post with no link recorded', () => {
  it('cannot go from To Do to Done', () => {
    const verdict = evaluateTransition('todo', 'done', mine('member', 'static', 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe('publish_proof_required');
  });

  it('cannot go from In Review to Done either', () => {
    /* The gate is on the destination, not on one particular route into it. */
    const verdict = evaluateTransition('in_review', 'done', mine('team_coordinator', 'static', 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe('publish_proof_required');
  });

  it('says what to do next, not merely that it was refused', () => {
    const verdict = evaluateTransition('todo', 'done', mine('member', 'static', 0));
    /* A refusal that does not name the remedy reads as a broken control. It has
       to point at the panel where the link is pasted. */
    expect(verdict.ok === false && verdict.message).toContain('Where it went');
    expect(verdict.ok === false && verdict.message.toLowerCase()).toContain('static post');
  });

  it('is not offered Done as an allowed transition', () => {
    /* This is what keeps the board from accepting the drag and the drawer from
       listing the option — see `canMove` and the `allowed` list. */
    expect(allowedTransitions('todo', mine('member', 'static', 0))).not.toContain('done');
  });

  it('can still be moved anywhere else', () => {
    /* ⚠️ The gate must not be a general freeze. Somebody who has not posted yet
       still needs to start the work, block it, or cancel it. */
    const from = 'todo' satisfies TaskStatus;
    const allowed = allowedTransitions(from, mine('team_coordinator', 'static', 0));
    expect(allowed).toContain('in_progress');
    expect(allowed).toContain('cancelled');
  });
});

describe('a reel is treated exactly like a static post', () => {
  it('is refused with no link', () => {
    expect(evaluateTransition('in_review', 'done', mine('admin', 'reel', 0)).ok).toBe(false);
  });

  it('is permitted once a link exists', () => {
    expect(evaluateTransition('in_review', 'done', mine('admin', 'reel', 1)).ok).toBe(true);
  });
});

describe('carousel, story and long video — added 2026-08-24', () => {
  /* These three were closable with no link at all until the owner widened the
     rule. Each is asserted from both sides, because "it is gated" and "it can
     still be finished once posted" are different failures. */
  for (const kind of ['carousel', 'story', 'video'] as const) {
    it(`a ${kind} with no link cannot reach Done`, () => {
      const verdict = evaluateTransition('in_review', 'done', mine('member', kind, 0));
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.code).toBe('publish_proof_required');
    });

    it(`a ${kind} with a link can`, () => {
      expect(evaluateTransition('in_review', 'done', mine('member', kind, 1)).ok).toBe(true);
    });

    it(`a ${kind} refusal names the format, not "content"`, () => {
      /* CONTENT_KIND_LABEL, lowercased — "a carousel cannot be marked as done",
         not "a content item". The sentence has to be about the thing on screen. */
      const verdict = evaluateTransition('in_review', 'done', mine('member', kind, 0));
      expect(verdict.ok === false && verdict.message.toLowerCase()).toContain(
        CONTENT_KIND_LABEL[kind].toLowerCase(),
      );
    });
  }
});

describe('once the link is there', () => {
  it('one placement URL is enough', () => {
    /* One, not all of them. A reel cross-posted to four platforms goes out over
       days (migration 034's own comment), so requiring every placement to be
       filled in would make Done unreachable until the last platform. */
    expect(evaluateTransition('todo', 'done', mine('member', 'static', 1)).ok).toBe(true);
  });

  it('several are fine too', () => {
    expect(evaluateTransition('todo', 'done', mine('member', 'static', 4)).ok).toBe(true);
  });
});

describe('no rank buys past it', () => {
  /* Deliberately not role-gated, like BR-002. An Admin marking an unpublished
     post as done produces exactly the unverifiable figure this exists to stop. */
  for (const role of ['member', 'team_coordinator', 'admin', 'super_admin'] as const) {
    it(`a ${role} is refused just the same`, () => {
      const verdict = evaluateTransition('in_review', 'done', mine(role, 'static', 0));
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.code).toBe('publish_proof_required');
    });
  }
});

describe('the gate is narrow, and that is the point', () => {
  it('ordinary work with no content kind is untouched', () => {
    /* A coordinator's admin task was never part of what the client was promised
       and has no link to paste. Refusing it would be a dead end. */
    expect(evaluateTransition('todo', 'done', mine('member', null, 0)).ok).toBe(true);
  });

  const NOT_GATED = CONTENT_KINDS.filter((k) => !PUBLISH_PROOF_KINDS.includes(k));

  for (const kind of NOT_GATED) {
    it(`a ${kind} task closes without a link`, () => {
      expect(evaluateTransition('todo', 'done', mine('member', kind, 0)).ok).toBe(true);
    });
  }

  it('covers every kind that gets published, and nothing else', () => {
    /* Widened from ['static','reel'] on 2026-08-24 — *"all these kinds of things
       that are published must have some URL"*. If this fails, somebody changed
       the scope; make sure that was asked for. */
    expect([...PUBLISH_PROOF_KINDS].sort()).toEqual([
      'carousel',
      'reel',
      'static',
      'story',
      'video',
    ]);
  });

  it('leaves website, ad, report and other alone', () => {
    /* Owner: *"the website, ads, and reports and the other things will be
       available. For now it will behave the same as a normal task."* */
    for (const kind of ['website', 'ad', 'report', 'other'] as const) {
      expect(PUBLISH_PROOF_KINDS).not.toContain(kind);
    }
  });

  it('⚠️ never gates a kind the placements panel cannot record', () => {
    /* THE INVARIANT THAT KEEPS THIS RULE SURVIVABLE, and the reason
       PLACEMENT_KINDS lives in the domain rather than inside the panel.

       A gated kind with no row available in "Where it went" is not "blocked
       until you act" — it is permanently unclosable, refused by a message
       pointing at a panel that has no row for it. `ad` is the live temptation:
       an ad creative IS published, so it reads as belonging here, but adding it
       without first adding it to the panel builds exactly that dead end. */
    for (const kind of PUBLISH_PROOF_KINDS) {
      expect(PLACEMENT_KINDS).toContain(kind);
    }
  });
});

describe('the gate applies to done and nothing else', () => {
  const OTHER_STATUSES = TASK_STATUSES.filter((s) => s !== 'done');

  it('cancelling an unpublished post is still allowed', () => {
    /* A post that will never go out has to be closeable, and cancelled already
       carries a written reason (FR-043). Gating it would leave dead deliverables
       on the board for ever. */
    const verdict = evaluateTransition('todo', 'cancelled', {
      ...mine('team_coordinator', 'static', 0),
      reason: 'Client pulled the campaign.',
    });
    expect(verdict.ok).toBe(true);
  });

  it('never refuses a non-done move for want of a link', () => {
    for (const from of TASK_STATUSES) {
      for (const to of OTHER_STATUSES) {
        const verdict = evaluateTransition(from, to, {
          ...mine('super_admin', 'static', 0),
          reason: 'because',
        });
        if (!verdict.ok) {
          expect(verdict.code).not.toBe('publish_proof_required');
        }
      }
    }
  });
});

describe('a caller that supplies neither field', () => {
  it('is not gated — absence means "no proof required"', () => {
    /* ⚠️ THIS IS THE RISK THE OPTIONAL FIELDS BUY, WRITTEN DOWN. Three of the
       four call sites ask only about moves that cannot reach Done, so requiring
       the fields everywhere would be ceremony. The price is that a NEW caller
       which forgets them waves the post through instead of failing loudly.

       The two sites that can reach Done are `changeStatusAction` (authoritative)
       and the board's `canMove` (the courtesy), and both pass the fields. This
       test exists to keep the trade-off visible rather than to bless it. */
    expect(
      evaluateTransition('todo', 'done', {
        actorRole: 'member',
        actorId: ME,
        assigneeId: ME,
        createdById: ME,
      }).ok,
    ).toBe(true);
  });
});
