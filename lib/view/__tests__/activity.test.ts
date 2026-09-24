import { describe, expect, it } from 'vitest';

import { dayWord, eventKind, phraseOf, sizeWord, statusWord } from '@/lib/view/activity';

/* ============================================================================
 * Every fixture below is a real row shape, copied from the live log on
 * 2026-09-24 — not one invented for the test.
 * ========================================================================= */

describe('phraseOf', () => {
  it('reads a status move as before → after in our words', () => {
    const p = phraseOf({
      action: 'in_review',
      before: { status: 'in_progress' },
      after: { reason: null, status: 'in_review' },
    });
    expect(p.verb).toBe('changed status of');
    expect(p.changes).toEqual([{ field: 'Status', from: 'In progress', to: 'Awaiting review' }]);
  });

  /* ⚠️ 10 of the 112 in_progress rows have no `before`. */
  it('does not invent a starting state when the log has none', () => {
    const p = phraseOf({ action: 'in_progress', before: null, after: { status: 'in_progress' } });
    expect(p.verb).toBe('moved');
    expect(p.changes[0]).toEqual({ field: 'Status', from: null, to: 'In progress' });
  });

  it('shows only the fields an edit actually changed', () => {
    const p = phraseOf({
      action: 'updated',
      before: { dueDate: '2026-09-09', priority: 'medium', effortPoints: 4 },
      after: { dueDate: '2026-09-05', priority: 'medium', effortPoints: 4 },
    });
    expect(p.changes).toEqual([{ field: 'Due date', from: '9 Sep 2026', to: '5 Sep 2026' }]);
  });

  /* ⚠️ THE 86 NO-OP EDITS. Saying "edited" with no diff sends somebody looking
     for a change that was never made. */
  it('says so when an edit changed nothing', () => {
    const same = { dueDate: '2026-09-17', priority: 'medium', effortPoints: 4 };
    const p = phraseOf({ action: 'updated', before: same, after: { ...same } });
    expect(p.changes).toHaveLength(0);
    expect(p.verb).toBe('saved');
    expect(p.note).toBe('No field changed');
  });

  it('names both sides of a reassignment', () => {
    const p = phraseOf({
      action: 'reassigned',
      before: { assigneeId: 'c53c7b4a-6d3e-4938-a060-a207f290ef22' },
      after: { assigneeId: '4222f182-b233-43df-8bee-dbeeaf12e10c', overrideReason: null },
      fromName: 'Rafay Abbasi',
      toName: 'Abdul Moiz',
    });
    expect(p.changes).toEqual([{ field: 'Assignee', from: 'Rafay Abbasi', to: 'Abdul Moiz' }]);
  });

  it('calls an unassigned task unassigned rather than guessing a person', () => {
    const p = phraseOf({
      action: 'reassigned',
      before: { assigneeId: null },
      after: { assigneeId: 'c53c7b4a-6d3e-4938-a060-a207f290ef22' },
      fromName: null,
      toName: 'Abdul Moiz',
    });
    expect(p.changes[0].from).toBe('Nobody');
  });

  it('carries the file name and its size', () => {
    const p = phraseOf({
      action: 'attachment_added',
      after: { fileName: 'Khattar Qabeela Meeting (2).jpg', sizeBytes: 1018036 },
    });
    expect(p.verb).toBe('uploaded a file to');
    expect(p.note).toBe('Khattar Qabeela Meeting (2).jpg (994 KB)');
  });

  /* ⚠️ NOT "handed over" — the owner asked what that meant and it meant nothing. */
  it('describes a workflow handoff as a workflow', () => {
    expect(phraseOf({ action: 'task.handoff' }).verb).toBe('was created by a workflow from');
  });

  it('falls back to a readable action rather than a wrong label', () => {
    expect(phraseOf({ action: 'task.some_future_thing' }).verb).toBe('task some future thing');
  });
});

describe('eventKind', () => {
  it('folds all eight status actions into one filter', () => {
    for (const a of ['backlog', 'todo', 'in_progress', 'in_review', 'revisions', 'blocked', 'done', 'cancelled']) {
      expect(eventKind(a)).toBe('status');
    }
  });

  it('separates the kinds a manager actually filters by', () => {
    expect(eventKind('created')).toBe('created');
    expect(eventKind('updated')).toBe('edited');
    expect(eventKind('reassigned')).toBe('assigned');
    expect(eventKind('attachment_added')).toBe('file');
    expect(eventKind('attachment_removed')).toBe('file');
    expect(eventKind('task.handoff')).toBe('workflow');
    expect(eventKind('task.placement_recorded')).toBe('placement');
    expect(eventKind('member_added')).toBe('project');
    expect(eventKind('role_changed')).toBe('people');
  });
});

describe('the small words', () => {
  it('writes a date the way the rest of the page does', () => {
    expect(dayWord('2026-09-09')).toBe('9 Sep 2026');
    expect(dayWord(null)).toBeNull();
    /* Anything that is not a date passes through rather than becoming NaN. */
    expect(dayWord('soon')).toBe('soon');
  });

  it('writes a file size', () => {
    expect(sizeWord(1018036)).toBe('994 KB');
    expect(sizeWord(3_500_000)).toBe('3.3 MB');
    expect(sizeWord(825854)).toBe('806 KB');
    expect(sizeWord(0)).toBeNull();
    expect(sizeWord(null)).toBeNull();
  });

  it('uses our status vocabulary, and leaves an unknown one alone', () => {
    expect(statusWord('in_review')).toBe('Awaiting review');
    expect(statusWord('revisions')).toBe('Changes requested');
    expect(statusWord('something_new')).toBe('something_new');
  });
});
