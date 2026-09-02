import { describe, expect, it } from 'vitest';

import { dailyBoard, dailyState, canComplete, canPublish, publishTarget } from '../daily';
import { evaluateTransition } from '../task-machine';
import type { Role } from '../constants';

/* ============================================================================
 * PUBLISHING SUBMITS FOR REVIEW — owner rule, 2026-09-02
 * ----------------------------------------------------------------------------
 * *"Put the link of Facebook and Instagram and mark as published. When it is
 * marked as published it should automatically move to in review. Then I review
 * it and give me a notification that this task is in review."*
 *
 * Before this, the daily board's "Mark as published" moved the task straight to
 * Done — so on the one board where most of the division's work happens, BR-002
 * (whoever did the work does not sign it off) was unreachable. Two rules had to
 * change together, and the interaction between them is the subtlety worth
 * pinning: To Do can now reach Review directly, and the person who pasted the
 * link becomes the assignee, which is what makes "not the assignee" mean
 * something.
 * ========================================================================= */

const POSTER = 'user-poster';
const KASHIF = 'user-kashif';
const HABIBA = 'user-habiba';

/** An auto-created content task, claimed by whoever pasted the live link. */
const claimedPost = (status: string) => ({
  actorRole: 'member' as Role,
  actorId: POSTER,
  assigneeId: POSTER,
  createdById: KASHIF,
  contentKind: 'static' as const,
  placementUrlCount: 2,
  status,
});

describe('publishing a post submits it for review', () => {
  it('lets the person who posted it send To Do straight to Review', () => {
    const v = evaluateTransition('todo', 'in_review', claimedPost('todo'));
    expect(v.ok).toBe(true);
  });

  /* The owner asked for exactly this and it was refused before: To Do reached
     In Progress, Backlog, Done or Cancelled, and Review only via In Progress. */
  it('no longer forces a detour through In Progress', () => {
    const before = evaluateTransition('todo', 'in_progress', claimedPost('todo'));
    const direct = evaluateTransition('todo', 'in_review', claimedPost('todo'));
    expect(before.ok).toBe(true);
    expect(direct.ok).toBe(true);
  });

  it('still refuses Backlog straight to Review — planning is not submitting', () => {
    expect(evaluateTransition('backlog', 'in_review', claimedPost('backlog')).ok).toBe(false);
  });
});

describe('the review gate the claim exists to make real', () => {
  /* ⚠️ THE POINT OF ASSIGNING THE POSTER. With assignee_id null — which is how
     every auto-created post arrived — `forbidsAssignee` matches nobody, so the
     person who did the work could also approve it. */
  it('will not let the poster approve their own post', () => {
    const v = evaluateTransition('in_review', 'done', claimedPost('in_review'));
    expect(v.ok).toBe(false);
  });

  it('lets the coordinator who raised it approve', () => {
    const v = evaluateTransition('in_review', 'done', {
      ...claimedPost('in_review'),
      actorRole: 'team_coordinator',
      actorId: KASHIF,
    });
    expect(v.ok).toBe(true);
  });

  it('lets an Admin who raised nothing approve, so review is not one person', () => {
    const v = evaluateTransition('in_review', 'done', {
      ...claimedPost('in_review'),
      actorRole: 'admin',
      actorId: HABIBA,
    });
    expect(v.ok).toBe(true);
  });

  /* ── ⚠️ THE ONE CASE THAT IS NOT A SECOND PAIR OF EYES, AND IS MEANT NOT TO BE
     Asserted because it is surprising in this flow and worth knowing rather than
     discovering. `forbidsAssignee` carries a deliberate carve-out from
     2026-08-24: it does not apply when the assignee ALSO raised the task, on the
     grounds that where requester and doer are the same person by construction
     there is nothing to separate.

     Kashif raises every auto-created post. So if KASHIF is also the one who
     pastes the link, assignee and creator collapse to him and he may approve his
     own post. For everybody else — the actual case, a Member posting work Kashif
     raised — the two differ and the gate holds. This test exists so that if the
     carve-out is ever tightened, the change is a decision rather than a
     surprise. */
  it('does let Kashif approve a post he both raised and published himself', () => {
    const v = evaluateTransition('in_review', 'done', {
      ...claimedPost('in_review'),
      actorRole: 'team_coordinator',
      actorId: KASHIF,
      assigneeId: KASHIF,
    });
    expect(v.ok).toBe(true);
  });

  it('still demands a live link before Done, whoever is approving', () => {
    const v = evaluateTransition('in_review', 'done', {
      ...claimedPost('in_review'),
      actorRole: 'admin',
      actorId: HABIBA,
      placementUrlCount: 0,
    });
    expect(v.ok).toBe(false);
    /* Narrowed, because `code` only exists on the refusal arm of the verdict. */
    if (!v.ok) expect(v.code).toBe('publish_proof_required');
  });
});

describe('the daily board after publishing', () => {
  const TODAY = '2026-09-02';
  const post = (status: string, dueDate: string | null = TODAY) => ({
    id: `t-${status}`,
    status,
    dueDate,
    contentKind: 'static' as const,
  });

  /* Without a state of its own, a submitted post falls through to `pending` —
     status is not done, day is today — and reappears under "to post today"
     behind a button that cannot fire. That dead control is what this fixes. */
  it('shows a submitted post as waiting, not as still to post', () => {
    expect(dailyState(post('in_review'), TODAY)).toBe('submitted');
    const board = dailyBoard([post('in_review')], TODAY, '2026-08-25');
    expect(board.submitted).toHaveLength(1);
    expect(board.pending).toHaveLength(0);
  });

  it('will not offer to publish a submitted post again', () => {
    expect(canPublish(post('in_review'), TODAY)).toBe(false);
  });

  /* ── ⚠️ THE REGRESSION THIS BLOCK EXISTS FOR ──────────────────────────────
     Owner, 2026-09-02, within the hour of the review flow shipping: a post due
     THAT DAY sat in In Review and would not move to Done, refused with *"the
     day has passed, so it counts as a blank day"* about today's own date.

     Cause: `canComplete` asked only whether the daily state was `pending`, and
     adding a `submitted` state for In Review quietly made every post awaiting
     approval fail it. The earlier version of this very test asserted the broken
     behaviour as correct — it was written thinking `canComplete` gated only the
     publish button, when it also gates approval to Done. Hence two functions
     now, and hence this case named after what it is. */
  it('KEEPS a submitted post approvable — approving is not publishing again', () => {
    expect(canComplete(post('in_review'), TODAY)).toBe(true);
  });

  it('still lets whoever raised it complete an unpublished post today', () => {
    expect(canComplete(post('todo'), TODAY)).toBe(true);
  });

  /* Went out on time; the reviewer was simply late. Refusing here would mean a
     post published on time can never be completed because somebody slept. */
  it('approves a post submitted before midnight and reviewed the next day', () => {
    expect(canComplete(post('in_review', '2026-08-28'), TODAY)).toBe(true);
  });

  /* And the missed-day rule is not weakened by that, because nothing can ENTER
     review late — so nothing can be approved out of a genuinely blank day. */
  it('refuses to publish a post whose day went blank', () => {
    expect(canPublish(post('todo', '2026-08-28'), TODAY)).toBe(false);
    expect(canComplete(post('todo', '2026-08-28'), TODAY)).toBe(false);
  });

  /* Like `done`, ahead of the date checks: a post submitted at 11pm and
     approved tomorrow was not a blank day, and calling it missed would
     understate delivery to a client. */
  it('does not call a submitted post missed once its day has passed', () => {
    expect(dailyState(post('in_review', '2026-08-28'), TODAY)).toBe('submitted');
    const board = dailyBoard([post('in_review', '2026-08-28')], TODAY, '2026-08-25');
    expect(board.missed).toHaveLength(0);
    expect(board.submitted).toHaveLength(1);
  });

  it('keeps an untouched post fillable, and a blank past day missed', () => {
    expect(dailyState(post('todo'), TODAY)).toBe('pending');
    expect(dailyState(post('todo', '2026-08-28'), TODAY)).toBe('missed');
  });

  /* Sent back for changes is actionable again, not stuck in review. */
  it('returns a post sent back for revisions to the fillable list', () => {
    const board = dailyBoard([post('revisions')], TODAY, '2026-08-25');
    expect(board.pending).toHaveLength(1);
    expect(board.submitted).toHaveLength(0);
  });
});

/* ============================================================================
 * WHERE PUBLISHING SENDS IT — owner rule, 2026-09-02
 * ----------------------------------------------------------------------------
 * *"If somebody creates his own task, you do not need to approve it. It can be
 * moved directly to the done status."*
 *
 * The publish button originally sent EVERY post to Review, including posts the
 * clicker had raised themselves — two clicks by one person, no second pair of
 * eyes, and the daily board contradicting the task board about the same rule.
 * ========================================================================= */
describe('publishTarget', () => {
  it('sends delegated work to Review', () => {
    expect(publishTarget({ createdById: KASHIF }, POSTER)).toBe('in_review');
  });

  it('sends work you raised yourself straight to Done', () => {
    expect(publishTarget({ createdById: KASHIF }, KASHIF)).toBe('done');
  });

  /* The realistic case for the auto-created posts: Kashif set up each project's
     posting schedule, so he is the creator of all 269 of them. A member posting
     one is therefore always the delegated path. */
  it('treats every auto-created post as delegated for anybody but its raiser', () => {
    expect(publishTarget({ createdById: KASHIF }, 'user-abdul-moiz')).toBe('in_review');
    expect(publishTarget({ createdById: HABIBA }, 'user-rafay')).toBe('in_review');
    expect(publishTarget({ createdById: HABIBA }, HABIBA)).toBe('done');
  });
});
