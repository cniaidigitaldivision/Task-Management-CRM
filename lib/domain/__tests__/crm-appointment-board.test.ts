import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  cardCounts,
  dateLines,
  displayStatus,
  listTitle,
  NO_FILTERS,
  reminderLine,
  sortForList,
  timeRange,
  weekOf,
  type BoardRowLike,
} from '@/lib/domain/crm-appointment-board';

/* Monday 21 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const H = 3_600_000;

const row = (over: Partial<BoardRowLike> & { id: string }): BoardRowLike => ({
  refNo: 201,
  leadName: 'Faisal Rehman',
  projectName: 'Chitral Royal Homes',
  kind: 'site_visit',
  status: 'scheduled',
  scheduledAt: new Date(NOW + 24 * H).toISOString(),
  durationMinutes: 30,
  confirmationSent: false,
  propertyCode: 'A-101',
  quotationNumber: 'QT-1042',
  location: 'Demo sales office, Islamabad',
  ...over,
});

describe('what each row says it is', () => {
  it('⚠️ a past appointment nobody recorded needs recording, whatever it was', () => {
    expect(displayStatus(row({ id: 'a', status: 'confirmed', scheduledAt: new Date(NOW - H).toISOString() }), NOW)).toBe('needs_recording');
  });

  it('tells a confirmed client from one who has been asked and one who has not', () => {
    expect(displayStatus(row({ id: 'b', status: 'confirmed' }), NOW)).toBe('confirmed');
    expect(displayStatus(row({ id: 'c', confirmationSent: true }), NOW)).toBe('awaiting');
    expect(displayStatus(row({ id: 'd' }), NOW)).toBe('scheduled');
  });

  it('keeps what was recorded', () => {
    expect(displayStatus(row({ id: 'e', status: 'completed', scheduledAt: new Date(NOW - 50 * H).toISOString() }), NOW)).toBe('completed');
    expect(displayStatus(row({ id: 'f', status: 'cancelled' }), NOW)).toBe('cancelled');
  });
});

describe('the four cards', () => {
  const rows = [
    row({ id: '1', scheduledAt: new Date(NOW + 2 * H).toISOString() }), // today, later
    row({ id: '2', scheduledAt: new Date(NOW - 2 * H).toISOString() }), // today, owed
    row({ id: '3', status: 'cancelled', scheduledAt: new Date(NOW + 3 * H).toISOString() }), // today, cancelled
    row({ id: '4', confirmationSent: true }), // tomorrow, awaiting
    row({ id: '5', status: 'confirmed', scheduledAt: new Date(NOW + 72 * H).toISOString() }),
    row({ id: '6', status: 'completed', scheduledAt: new Date(NOW - 26 * H).toISOString() }), // Sunday 20th — last week
    row({ id: '7', status: 'completed', scheduledAt: new Date(NOW - 4 * H).toISOString() }), // this week
  ];

  it('counts Today without the cancelled one, Upcoming as what is still to come', () => {
    const c = cardCounts(rows, NOW);
    expect(c.today).toBe(3);
    expect(c.upcoming).toBe(3);
    expect(c.awaiting).toBe(1);
    expect(c.needsRecording).toBe(1);
  });

  it('⚠️ "this week" is Monday to Sunday in Karachi — Sunday the 20th was last week', () => {
    expect(weekOf('2026-09-21')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(cardCounts(rows, NOW).completedThisWeek).toBe(1);
  });
});

describe('the filters', () => {
  const rows = [
    row({ id: 'v', refNo: 201 }),
    row({ id: 'm', refNo: 204, kind: 'meeting', leadName: 'Hina Shahzad', projectName: 'Demo — Product Enquiries', quotationNumber: 'QT-1043' }),
    row({ id: 'o', refNo: 199, status: 'completed', scheduledAt: new Date(NOW - 96 * H).toISOString(), leadName: 'Ayesha Noor' }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(rows, { ...NO_FILTERS, ...f }, NOW).map((a) => a.id);

  it('searches the reference, the lead, the property and the quotation', () => {
    expect(ids({ q: 'appt-204' })).toEqual(['m']);
    expect(ids({ q: 'hina' })).toEqual(['m']);
    expect(ids({ q: 'QT-1043' })).toEqual(['m']);
    expect(ids({ q: 'a-101 faisal' })).toEqual(['v']);
  });

  it('by type, status, project and Karachi date range', () => {
    expect(ids({ kind: 'meeting' })).toEqual(['m']);
    expect(ids({ status: 'upcoming' })).toEqual(['v', 'm']);
    expect(ids({ status: 'completed' })).toEqual(['o']);
    expect(ids({ project: 'Chitral Royal Homes' })).toEqual(['v', 'o']);
    expect(ids({ from: '2026-09-22', to: '2026-09-22' })).toEqual(['v', 'm']);
    expect(ids({ to: '2026-09-18' })).toEqual(['o']);
  });

  it('the list says what it is showing', () => {
    expect(listTitle('upcoming')).toBe('Upcoming appointments');
    expect(listTitle('all')).toBe('All appointments');
    expect(listTitle('awaiting')).toBe('Awaiting confirmation');
  });
});

describe('the order', () => {
  it('owed first, then soonest coming, then most recent past', () => {
    const rows = [
      row({ id: 'past-old', status: 'completed', scheduledAt: new Date(NOW - 96 * H).toISOString() }),
      row({ id: 'later', scheduledAt: new Date(NOW + 72 * H).toISOString() }),
      row({ id: 'owed', scheduledAt: new Date(NOW - 2 * H).toISOString() }),
      row({ id: 'soon', scheduledAt: new Date(NOW + 2 * H).toISOString() }),
      row({ id: 'past-new', status: 'completed', scheduledAt: new Date(NOW - 5 * H).toISOString() }),
    ];
    expect(sortForList(rows, NOW).map((a) => a.id)).toEqual(['owed', 'soon', 'later', 'past-new', 'past-old']);
  });
});

describe('the words in the details panel', () => {
  it('a time range in Karachi, with the meridiem only where it changes', () => {
    expect(timeRange('2026-09-19T06:00:00.000Z', 30)).toBe('19 September 2026, 11:00 – 11:30 AM PKT');
    expect(timeRange('2026-09-19T06:30:00.000Z', 90)).toBe('19 September 2026, 11:30 AM – 1:00 PM PKT');
  });

  it('Today and Tomorrow by the Karachi day', () => {
    expect(dateLines(new Date(NOW + 2 * H).toISOString(), NOW)).toEqual({ day: 'Today', time: '5:00 PM' });
    expect(dateLines('2026-09-22T05:00:00.000Z', NOW)).toEqual({ day: 'Tomorrow', time: '10:00 AM' });
    expect(dateLines('2026-09-17T11:00:00.000Z', NOW).day).toBe('17 Sep 2026');
  });

  it('the reminder: how long before, and whether it went', () => {
    expect(reminderLine('2026-09-19T06:00:00.000Z', 'planned', '2026-09-19T04:00:00.000Z')).toBe('WhatsApp · 2 hours before · Scheduled');
    expect(reminderLine('2026-09-19T06:00:00.000Z', 'done', '2026-09-18T06:00:00.000Z')).toBe('WhatsApp · 1 day before · Sent');
    expect(reminderLine('2026-09-19T06:00:00.000Z', null, null)).toBe('No reminder');
  });
});
