import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  cardCounts,
  displayStatus,
  dueLine,
  inTab,
  NO_FILTERS,
  priority,
  rowAction,
  sequenceLine,
  silenceFor,
  sortForQueue,
  type BoardRowLike,
} from '@/lib/domain/crm-followup-board';

/* Monday 21 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const H = 3_600_000;

const row = (over: Partial<BoardRowLike> & { id: string }): BoardRowLike & { lastMessageAt: string | null } => ({
  leadName: 'Faisal Rehman',
  projectName: 'Chitral Royal Homes',
  purpose: 'quotation',
  channel: 'whatsapp',
  mode: 'auto_send',
  status: 'due',
  dueAt: new Date(NOW - H).toISOString(),
  title: 'Quotation check-in',
  quotationNumber: 'QT-1042',
  quotationStatus: 'approved',
  appointmentRef: null,
  sequenceRunId: 'seq-1',
  sequenceState: 'active',
  stepNo: 1,
  stepTotal: 3,
  awaitingOurReply: false,
  lastMessageAt: new Date(NOW - 20 * H).toISOString(),
  ...over,
});

describe('what each row says it is', () => {
  it('⚠️ a client waiting for an answer beats every other state', () => {
    const r = row({ id: 'a', awaitingOurReply: true, dueAt: new Date(NOW + 48 * H).toISOString() });
    expect(displayStatus(r, NOW)).toBe('reply_needed');
  });

  it('holds a chase whose discount nobody has approved', () => {
    expect(displayStatus(row({ id: 'b', quotationStatus: 'pending_approval' }), NOW)).toBe('waiting_approval');
  });

  it('tells overdue from due today from scheduled, by the Karachi day', () => {
    expect(displayStatus(row({ id: 'c', dueAt: new Date(NOW - 30 * H).toISOString() }), NOW)).toBe('overdue');
    expect(displayStatus(row({ id: 'd', dueAt: new Date(NOW - H).toISOString() }), NOW)).toBe('due_now');
    expect(displayStatus(row({ id: 'e', dueAt: new Date(NOW + H).toISOString() }), NOW)).toBe('scheduled');
  });

  it('keeps what already happened', () => {
    expect(displayStatus(row({ id: 'f', status: 'done' }), NOW)).toBe('sent');
    expect(displayStatus(row({ id: 'g', status: 'cancelled' }), NOW)).toBe('stopped');
    expect(displayStatus(row({ id: 'h', status: 'failed' }), NOW)).toBe('failed');
  });
});

describe('the four cards', () => {
  const rows = [
    row({ id: '1' }),
    row({ id: '2', dueAt: new Date(NOW - 30 * H).toISOString() }),
    row({ id: '3', awaitingOurReply: true }),
    row({ id: '4', dueAt: new Date(NOW + 48 * H).toISOString() }),
    row({ id: '5', status: 'done' }),
  ];

  it('counts what is open, and takes the sequence count as given', () => {
    const c = cardCounts(rows, NOW, 5);
    expect(c.dueToday).toBe(2); // the due-now one and the one the client replied to
    expect(c.overdue).toBe(1);
    expect(c.replyNeeded).toBe(1);
    expect(c.activeSequences).toBe(5);
  });

  it('⚠️ never counts something already sent', () => {
    expect(cardCounts([row({ id: 'x', status: 'done', dueAt: new Date(NOW).toISOString() })], NOW).dueToday).toBe(0);
  });
});

describe('the tabs', () => {
  const due = row({ id: 'due' });
  const later = row({ id: 'later', dueAt: new Date(NOW + 48 * H).toISOString() });
  const sent = row({ id: 'sent', status: 'done' });
  const manual = row({ id: 'manual', sequenceRunId: null, sequenceState: null, stepNo: null, stepTotal: null });

  it('my queue is what is owed now, never what is merely open', () => {
    expect(inTab(due, 'queue', NOW)).toBe(true);
    expect(inTab(later, 'queue', NOW)).toBe(false);
    expect(inTab(later, 'scheduled', NOW)).toBe(true);
  });

  it('completed holds everything closed, and sequences only what is in one', () => {
    expect(inTab(sent, 'completed', NOW)).toBe(true);
    expect(inTab(due, 'sequences', NOW)).toBe(true);
    expect(inTab(manual, 'sequences', NOW)).toBe(false);
  });
});

describe('the filters', () => {
  const rows = [
    row({ id: 'w' }),
    row({ id: 'e', channel: 'email', purpose: 'no_response', title: 'Second nudge', leadName: 'Hina Shahzad', projectName: 'Demo', quotationNumber: 'QT-1043' }),
    row({ id: 'l', dueAt: new Date(NOW + 30 * H).toISOString() }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(rows, { ...NO_FILTERS, ...f }, NOW).map((r) => r.id);

  it('searches the lead, the project, the title and the reference', () => {
    expect(ids({ q: 'hina' })).toEqual(['e']);
    expect(ids({ q: 'QT-1043' })).toEqual(['e']);
    expect(ids({ q: 'quotation check' })).toEqual(['w', 'l']);
  });

  it('by channel, purpose, project and when it is due', () => {
    expect(ids({ channel: 'email' })).toEqual(['e']);
    expect(ids({ purpose: 'no_response' })).toEqual(['e']);
    expect(ids({ project: 'Demo' })).toEqual(['e']);
    expect(ids({ due: 'today' })).toEqual(['w', 'e']);
    expect(ids({ due: 'tomorrow' })).toEqual(['l']);
  });
});

describe('the order of the queue', () => {
  it('a reply first, then overdue, then by when it is due', () => {
    const rows = [
      row({ id: 'later', dueAt: new Date(NOW + 5 * H).toISOString() }),
      row({ id: 'overdue', dueAt: new Date(NOW - 30 * H).toISOString() }),
      row({ id: 'reply', awaitingOurReply: true }),
      row({ id: 'due', dueAt: new Date(NOW - H).toISOString() }),
    ];
    expect(sortForQueue(rows, NOW).map((r) => r.id)).toEqual(['reply', 'overdue', 'due', 'later']);
  });
});

describe('the words on a row', () => {
  it('says when it is due the way a person would', () => {
    expect(dueLine(new Date(NOW - H).toISOString(), NOW, 'due_now')).toEqual({ day: 'Today', time: '2:00 PM' });
    expect(dueLine(new Date(NOW + 20 * H).toISOString(), NOW, 'scheduled')).toEqual({ day: 'Tomorrow', time: '11:00 AM' });
    expect(dueLine(new Date(NOW).toISOString(), NOW, 'reply_needed')).toEqual({ day: 'Now', time: '' });
  });

  it('says where it is in its sequence, or that there is none', () => {
    expect(sequenceLine(row({ id: 'a' }))).toBe('Step 1 of 3');
    expect(sequenceLine(row({ id: 'b', sequenceState: 'paused' }))).toBe('Paused on reply');
    expect(sequenceLine(row({ id: 'c', sequenceRunId: null }))).toBe('Manual');
  });

  it('counts the silence in hours, then in days', () => {
    expect(silenceFor(new Date(NOW - 20 * H).toISOString(), NOW)).toBe('no reply 20h');
    expect(silenceFor(new Date(NOW - 72 * H).toISOString(), NOW)).toBe('no reply 3d');
    expect(silenceFor(new Date(NOW - 10 * 60_000).toISOString(), NOW)).toBeNull();
  });
});

describe('the suggested priority', () => {
  it('⚠️ says the facts it used, never a bare number', () => {
    const p = priority(row({ id: 'a' }), NOW);
    expect(p.level).toBe('High');
    expect(p.why).toBe('due now · approved quote · no reply 20h');
  });

  it('a client who has just replied is the highest thing on the list', () => {
    expect(priority(row({ id: 'b', awaitingOurReply: true }), NOW).level).toBe('High');
  });

  it('something scheduled with nothing behind it is low', () => {
    const p = priority(row({ id: 'c', dueAt: new Date(NOW + 48 * H).toISOString(), quotationStatus: null, lastMessageAt: null }), NOW);
    expect(p.level).toBe('Low');
    expect(p.why).toBe('scheduled');
  });
});

describe('what the button on the row does', () => {
  it('matches what the row actually is', () => {
    expect(rowAction(row({ id: 'a', awaitingOurReply: true }), NOW)).toBe('reply');
    expect(rowAction(row({ id: 'b', quotationStatus: 'pending_approval' }), NOW)).toBe('approval');
    expect(rowAction(row({ id: 'c' }), NOW)).toBe('review');
    expect(rowAction(row({ id: 'd', dueAt: new Date(NOW + 30 * H).toISOString() }), NOW)).toBe('preview');
    expect(rowAction(row({ id: 'e', channel: 'call', mode: 'remind_me' }), NOW)).toBe('done');
    /* ⚠️ 234 retired review_first, but old rows still carry it — and no
       machine will send one, so the row asks a person to close it. */
    expect(rowAction(row({ id: 'r', mode: 'review_first' }), NOW)).toBe('done');
    expect(rowAction(row({ id: 'f', status: 'done' }), NOW)).toBe('none');
  });
});
