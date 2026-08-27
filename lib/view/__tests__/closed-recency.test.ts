import { describe, expect, it } from 'vitest';

import { toTaskView } from '../task-view';
import { SYSTEM_DEFAULTS, type TaskStatus } from '@/lib/domain/constants';
import type { TaskRow } from '@/lib/db/queries/types';

/* ============================================================================
 * "IT IS DONE IN THE PROJECT BUT NOT ON THE TASK PAGE" — owner, 2026-08-24
 * ----------------------------------------------------------------------------
 * *"That project is showing that one post is done but on the task page it's not
 * showing in the done category."*
 *
 * The data was never wrong. The tasks board mounted with `hideClosed = true` and
 * dropped every done and cancelled task before the board was built — and because
 * the board renders its eight columns from the status enum rather than from the
 * data, Done was drawn as a permanently empty column. The project page, which has
 * no such filter, disagreed with it about work that had genuinely been finished.
 *
 * `recentlyClosed` is the fix: closed work stays for
 * `SYSTEM_DEFAULTS.closedVisibleDays` and then falls off, so the Done column
 * fills the moment somebody closes something without becoming an archive of
 * every task ever.
 *
 * ── WHY THE FLAG IS COMPUTED ON THE SERVER ───────────────────────────────────
 * Same reason `overdue` is a field and not a comparison: a `Date.now()` in the
 * component puts the server and the browser on different days at midnight and
 * across any timezone gap, which React reports as a hydration mismatch. So the
 * window is measured once, against the server's clock, and these tests pass a
 * fixed `nowMs` — which is the other half of that decision, since a rule tested
 * against the real clock is only tested on the day somebody runs it.
 * ========================================================================= */

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-24T09:00:00Z');

const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

/** Only the fields `toTaskView` actually reads. Everything else is filler. */
function row(over: {
  status: TaskStatus;
  completedAt?: string | null;
  updatedAt?: string;
}): TaskRow {
  /* ⚠️ No `as TaskRow`. A cast here would swallow a newly added column, and the
     next person would find this file compiling happily while asserting against a
     row shape the query no longer returns. */
  return {
    id: 't1',
    reference: 'TSK-1',
    title: 'A static post',
    description: null,
    projectId: 'p1',
    projectName: 'GC Royal Premium',
    projectCode: 'GCR',
    projectType: 'client',
    otherDescription: null,
    parentTaskId: null,
    assigneeId: 'u1',
    assigneeName: 'Najmulah',
    assigneeAvatarUrl: null,
    createdById: 'u1',
    createdByName: 'Najmulah',
    priority: 'medium',
    effortSize: 'M',
    effortPoints: 3,
    startDate: null,
    startTime: null,
    dueDate: null,
    dueTime: null,
    blockedReason: null,
    cancelledReason: null,
    assignmentOverrideReason: null,
    timeLimitMinutes: null,
    timeSpentMinutes: 0,
    timerState: 'not_started',
    timerStartedAt: null,
    extensionMinutesGranted: 0,
    recurrenceRule: null,
    contentKind: 'static',
    sourceDriveUrl: null,
    assetDriveUrl: null,
    publishedOn: null,
    placementCount: 0,
    placementLiveCount: 0,
    commentCount: 0,
    attachmentCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    subtaskCount: 0,
    createdAt: daysAgo(60),
    updatedAt: over.updatedAt ?? daysAgo(60),
    completedAt: over.completedAt ?? null,
    status: over.status,
  };
}

describe('work that is still open', () => {
  /* `recentlyClosed` must be false for every open status, so the board filter
     never has to special-case "open but not recently closed". */
  for (const status of ['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'revisions'] as const) {
    it(`${status} is not "recently closed"`, () => {
      expect(toTaskView(row({ status }), NOW).recentlyClosed).toBe(false);
    });
  }
});

describe('a task closed today', () => {
  it('is recently closed — the exact case the owner reported', () => {
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(0) }), NOW);
    expect(view.recentlyClosed).toBe(true);
  });

  it('and so appears in the Done column rather than vanishing', () => {
    /* The filter the board applies, asserted here so the fix is pinned to the
       behaviour rather than to the flag's name. */
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(0) }), NOW);
    const hiddenByBoard = !view.recentlyClosed;
    expect(hiddenByBoard).toBe(false);
  });
});

describe('the window', () => {
  const window = SYSTEM_DEFAULTS.closedVisibleDays;

  it('keeps a task closed one day inside it', () => {
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(window - 1) }), NOW);
    expect(view.recentlyClosed).toBe(true);
  });

  it('keeps a task closed exactly on the boundary', () => {
    /* Inclusive. An off-by-one here is a task disappearing a day early, which is
       the original complaint in miniature. */
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(window) }), NOW);
    expect(view.recentlyClosed).toBe(true);
  });

  it('drops a task closed one day past it', () => {
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(window + 1) }), NOW);
    expect(view.recentlyClosed).toBe(false);
  });

  it('drops last quarter entirely', () => {
    const view = toTaskView(row({ status: 'done', completedAt: daysAgo(90) }), NOW);
    expect(view.recentlyClosed).toBe(false);
  });
});

describe('cancelled work, which has no completion stamp', () => {
  /* Migration 012 constrains `completed_at is not null` to mean exactly
     `status = 'done'`, so a cancelled task has none and `updated_at` is all
     there is to date it by. */
  it('falls back to updatedAt and stays for the window', () => {
    const view = toTaskView(
      row({ status: 'cancelled', completedAt: null, updatedAt: daysAgo(1) }),
      NOW,
    );
    expect(view.recentlyClosed).toBe(true);
  });

  it('falls off once that stamp is old', () => {
    const view = toTaskView(
      row({ status: 'cancelled', completedAt: null, updatedAt: daysAgo(45) }),
      NOW,
    );
    expect(view.recentlyClosed).toBe(false);
  });
});

describe('a stamp that cannot be read', () => {
  it('errs toward showing the task, not hiding it', () => {
    /* Deliberate direction. A visible stale card is a nuisance somebody can
       explain; a finished task that cannot be found is the bug this whole field
       was added to fix. */
    const view = toTaskView(
      row({ status: 'done', completedAt: 'not-a-timestamp' }),
      NOW,
    );
    expect(view.recentlyClosed).toBe(true);
  });
});

describe('what the board needs to judge a drop', () => {
  it('carries the content kind and the placement URL count through', () => {
    /* Without these two on the card, `canMove` cannot ask about the publish gate
       and a static post with no link drags cleanly into Done before the server
       bounces it. */
    const view = toTaskView(row({ status: 'todo' }), NOW);
    expect(view.contentKind).toBe('static');
    expect(view.placementUrlCount).toBe(0);
  });
});
