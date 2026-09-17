import { describe, expect, it } from 'vitest';

import {
  groupTodos,
  todoIsUrgent,
  todoLabel,
  todoSummary,
  TODO_KINDS,
} from '@/lib/domain/crm-todos';

/* ============================================================================
 * WHAT A SALESPERSON OWES, AND WHEN
 * ----------------------------------------------------------------------------
 * The owner's rule is *"clear your to-dos, then you can leave"*, which only
 * works if the list is finishable and true. These tests pin the two places that
 * would quietly break it: work with no planned time, and work that is scheduled
 * ahead being mistaken for work that is late.
 * ========================================================================= */

/* 2026-09-16, 14:00 UTC = 19:00 Karachi — deliberately in the evening window
   where the Karachi date and the UTC date agree, so a failure here is about the
   grouping rule and not about the fixture. */
const NOW = Date.parse('2026-09-16T14:00:00.000Z');
const DAY = 864e5;
const at = (offsetDays: number | null, kind = 'next_action') => ({
  kind,
  dueAt: offsetDays === null ? null : new Date(NOW + DAY * offsetDays).toISOString(),
});

describe('which pile a to-do lands in', () => {
  it('splits past, today and ahead', () => {
    const { overdue, today, later } = groupTodos([at(-2), at(0), at(3)], NOW);

    expect(overdue).toHaveLength(1);
    expect(today).toHaveLength(1);
    expect(later).toHaveLength(1);
  });

  it('⚠️ work with NO planned time is overdue, not "later"', () => {
    /* The most important line in this module. A lead nobody has given a next
       action is not scheduled for the future — it is unplanned, which is exactly
       what this page exists to surface. Filing it under "coming up" would hide
       the 640 leads that have no next action at all, which is the single
       commonest fault in this database. */
    const { overdue, later } = groupTodos([at(null)], NOW);

    expect(overdue).toHaveLength(1);
    expect(later).toHaveLength(0);
  });

  it('and undated work sorts to the very top of overdue', () => {
    /* It has been waiting longest by definition — nobody ever gave it a moment. */
    const { overdue } = groupTodos([at(-1), at(null), at(-5)], NOW);

    expect(overdue[0].dueAt).toBeNull();
  });

  it('overdue runs oldest first', () => {
    const { overdue } = groupTodos([at(-1), at(-9), at(-4)], NOW);

    expect(overdue.map((t) => t.dueAt)).toEqual([
      at(-9).dueAt,
      at(-4).dueAt,
      at(-1).dueAt,
    ]);
  });

  it('⚠️ groups by the Karachi day, not the browser or UTC', () => {
    /* `current_date` is a different day here for five hours every evening. A
       to-do list that disagreed with the rest of the product about which day it
       was would be worse than no grouping. 2026-09-16T20:00Z is already the 17th
       in Karachi. */
    const lateEvening = Date.parse('2026-09-16T20:00:00.000Z');
    const { today } = groupTodos(
      [{ kind: 'next_action', dueAt: '2026-09-17T02:00:00.000Z' }],
      lateEvening,
    );

    expect(today).toHaveLength(1);
  });
});

describe('which ones cannot wait', () => {
  it('⚠️ only first contact and an unrecorded visit are urgent', () => {
    /* The two where the delay IS the damage: a lead's intent decays by the hour,
       and a visit nobody wrote up is forgotten by the next morning. If everything
       shouted, nothing would. */
    expect(todoIsUrgent('first_contact')).toBe(true);
    expect(todoIsUrgent('record_visit')).toBe(true);
    expect(todoIsUrgent('next_action')).toBe(false);
    expect(todoIsUrgent('send_quotation')).toBe(false);
  });
});

describe('urgency and grouping agree', () => {
  it('⚠️ an undated item is BOTH overdue and urgent, never one without the other', () => {
    /* The screenshot caught this: an undated first contact sat under the red
       "Overdue" heading styled as calmly as next Tuesday's call. A row that
       disagrees with the group it is in teaches people to ignore the heading. */
    const { overdue } = groupTodos([at(null, 'first_contact')], NOW);

    expect(overdue).toHaveLength(1);
    expect(todoIsUrgent('first_contact')).toBe(true);
  });
});

describe('what each row tells you to do', () => {
  it('every kind reads as an instruction, not a noun', () => {
    /* "Quotation" is a topic; "Send the approved quotation" is something somebody
       can finish. A list of nouns is a list of things to think about. */
    for (const kind of TODO_KINDS) {
      const label = todoLabel(kind);
      expect(label.length).toBeGreaterThan(6);
      expect(label).not.toBe(kind);
    }
  });

  it('an unrecognised kind shows itself rather than vanishing', () => {
    expect(todoLabel('something_new')).toBe('something_new');
  });
});

describe('the sentence at the top', () => {
  it('⚠️ names the uncontacted leads ahead of any total', () => {
    /* "23 to-dos" is a statistic somebody scrolls past. "4 leads have never been
       contacted" is a decision about the next ten minutes. */
    const groups = groupTodos([at(-1, 'first_contact'), at(-2), at(0)], NOW);

    expect(todoSummary(groups, 4)).toContain('never been contacted');
  });

  it('falls back to the counts when nobody is waiting on first contact', () => {
    const groups = groupTodos([at(-2), at(0)], NOW);

    expect(todoSummary(groups, 0)).toContain('overdue');
  });

  it('⚠️ says the day is clear when it is — the owner\'s own rule', () => {
    /* *"clear your to-dos, then you can leave today."* Work scheduled ahead does
       not stop the day being finished, so it must not read as outstanding. */
    const groups = groupTodos([at(4), at(6)], NOW);

    expect(todoSummary(groups, 0)).toContain('Nothing owed today');
  });
});
