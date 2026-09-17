import { describe, expect, it } from 'vitest';

import {
  followUpCounts,
  followUpState,
  sequenceTimeline,
  stepTitle,
  type FollowUpInput,
  type SequenceInput,
} from '@/lib/domain/crm-followups';

const steps = [
  { stepNo: 1, channel: 'whatsapp', delayDays: 0, purpose: 'quotation', body: 'Just checking you received the quotation.' },
  { stepNo: 2, channel: 'email', delayDays: 2, purpose: 'quotation', body: 'Any questions on the payment plan?' },
  { stepNo: 3, channel: 'email', delayDays: 5, purpose: 'quotation', body: 'The quotation expires shortly.' },
];
const seq = (o: Partial<SequenceInput>): SequenceInput => ({
  id: 'ls1', state: 'active', currentStep: 1, nextStepAt: '2026-09-20T05:00:00.000Z', steps, ...o,
});
const row = (o: Partial<FollowUpInput>): FollowUpInput => ({
  id: 'f1', status: 'done', mode: 'auto_send', dueAt: '2026-09-14T04:00:00.000Z', doneAt: '2026-09-14T04:00:05.000Z',
  leadSequenceId: 'ls1', sequenceStepNo: 1, ...o,
});

describe('stepTitle', () => {
  it('reads like the reference', () => {
    expect(stepTitle('whatsapp', 'quotation')).toBe('WhatsApp quotation check-in');
    expect(stepTitle('email', 'no_response')).toBe('Email follow-up');
    expect(stepTitle('call', 'Ask about the site visit')).toBe('Call Ask about the site visit');
  });
});

describe('sequenceTimeline', () => {
  it('takes a queued step from its row, and projects the rest from next_step_at plus each delay', () => {
    const t = sequenceTimeline(seq({}), [row({})]);
    expect(t.map((s) => s.status)).toEqual(['sent', 'upcoming', 'upcoming']);
    expect(t[0].at).toBe('2026-09-14T04:00:05.000Z');
    expect(t[1].at).toBe('2026-09-20T05:00:00.000Z');
    // step 3 is five days after step 2
    expect(t[2].at).toBe('2026-09-25T05:00:00.000Z');
  });

  it('never calls a step waiting on a person "queued"', () => {
    const t = sequenceTimeline(seq({ currentStep: 1 }), [row({ status: 'due', mode: 'review_first', doneAt: null })]);
    expect(t[0].status).toBe('needs_you');
    const auto = sequenceTimeline(seq({ currentStep: 1 }), [row({ status: 'due', mode: 'auto_send', doneAt: null })]);
    expect(auto[0].status).toBe('queued');
  });

  it('while paused, gives no invented dates — only how long after resuming', () => {
    const t = sequenceTimeline(seq({ state: 'paused', nextStepAt: null }), [row({})]);
    expect(t.map((s) => s.status)).toEqual(['sent', 'paused', 'paused']);
    expect(t[1].at).toBeNull();
    expect(t[1].daysAfterResume).toBe(0);
    expect(t[2].daysAfterResume).toBe(5);
  });

  it('marks what will never run once stopped', () => {
    const t = sequenceTimeline(seq({ state: 'stopped', nextStepAt: null }), [row({})]);
    expect(t.map((s) => s.status)).toEqual(['sent', 'stopped', 'stopped']);
  });

  it('ignores rows that belong to a different sequence run', () => {
    const t = sequenceTimeline(seq({ currentStep: 0 }), [row({ leadSequenceId: 'older' })]);
    expect(t[0].status).toBe('upcoming');
  });
});

describe('followUpState and counts', () => {
  const now = Date.parse('2026-09-17T09:00:00.000Z'); // 14:00 in Karachi

  it('is due today in Karachi, overdue once past, planned later', () => {
    expect(followUpState({ status: 'planned', dueAt: '2026-09-17T12:00:00.000Z' }, now)).toBe('due');
    expect(followUpState({ status: 'planned', dueAt: '2026-09-17T06:00:00.000Z' }, now)).toBe('overdue');
    expect(followUpState({ status: 'planned', dueAt: '2026-09-19T06:00:00.000Z' }, now)).toBe('planned');
    expect(followUpState({ status: 'done', dueAt: '2026-09-10T06:00:00.000Z' }, now)).toBe('done');
  });

  it('counts people-work and the steps still to run', () => {
    const t = sequenceTimeline(seq({}), [row({})]);
    const counts = followUpCounts(
      [
        row({}),
        row({ id: 'm1', status: 'planned', leadSequenceId: null, sequenceStepNo: null, dueAt: '2026-09-17T06:00:00.000Z', doneAt: null }),
        row({ id: 'm2', status: 'planned', leadSequenceId: null, sequenceStepNo: null, dueAt: '2026-09-22T06:00:00.000Z', doneAt: null }),
        row({ id: 'm3', status: 'cancelled', leadSequenceId: null, sequenceStepNo: null, doneAt: null }),
      ],
      t,
      now,
    );
    expect(counts).toEqual({ active: 1, scheduled: 1 + 2, completed: 1 });
  });
});
