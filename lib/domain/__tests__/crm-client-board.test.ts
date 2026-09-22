import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  attention,
  cards,
  displayStatus,
  importRows,
  inTab,
  money,
  NO_FILTERS,
  nextLine,
  parseCsv,
  phoneLabel,
  quietDays,
  refLabel,
  sortClients,
  toCsv,
  valueOf,
  type ClientLike,
} from '@/lib/domain/crm-client-board';

/* Monday 22 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-22T10:00:00.000Z');
const DAY = 86_400_000;

const client = (over: Partial<ClientLike> & { id: string }): ClientLike => ({
  refNo: 1042,
  name: 'Faisal Rehman',
  company: null,
  phoneE164: '+923001238726',
  email: 'faisal@chitralroyalhomes.com',
  city: 'Islamabad',
  source: 'meta_lead_ad',
  preferredChannel: 'whatsapp',
  status: 'active',
  archivedAt: null,
  createdAt: new Date(NOW - 60 * DAY).toISOString(),
  ownerId: 'sarah',
  ownerName: 'Sarah Malik',
  primaryProjectId: 'p1',
  primaryProjectName: 'Chitral Royal Homes',
  projectNames: ['Chitral Royal Homes'],
  openDeals: 1,
  lastContactAt: new Date(NOW - DAY).toISOString(),
  lastDirection: 'outbound',
  nextAt: new Date(NOW + DAY).toISOString(),
  nextKind: 'follow_up',
  nextLabel: 'Follow-up',
  properties: 3,
  quotations: 2,
  appointments: 1,
  bookings: 1,
  invoices: 2,
  unpaidInvoices: 1,
  unpaidAmount: 250_000,
  overdueInvoices: 0,
  bookedValue: 4_500_000,
  quotedValue: 0,
  ...over,
});

describe('what status a client shows', () => {
  it('keeps what a person set when nothing else is true', () => {
    expect(displayStatus(client({ id: 'a' }), NOW)).toBe('active');
    expect(displayStatus(client({ id: 'b', status: 'prospect' }), NOW)).toBe('prospect');
    expect(displayStatus(client({ id: 'c', status: 'onboarding' }), NOW)).toBe('onboarding');
  });

  it('⚠️ an overdue promise makes it need attention, and says which', () => {
    const c = client({ id: 'a', nextAt: new Date(NOW - 2 * DAY).toISOString(), nextKind: 'call', nextLabel: null });
    expect(displayStatus(c, NOW)).toBe('attention');
    expect(attention(c, NOW)?.text).toBe('Call overdue · 2 days');
  });

  it('an overdue invoice and a client waiting on us both need attention', () => {
    expect(attention(client({ id: 'a', overdueInvoices: 1 }), NOW)?.because).toBe('invoice');
    expect(attention(client({ id: 'b', lastDirection: 'inbound' }), NOW)?.text).toBe('Waiting for your reply');
  });

  it('⚠️ an appointment in the past is not an overdue promise', () => {
    /* The reader only returns FUTURE appointments as next; a past one is
       recorded or cancelled elsewhere, never a thing the client is owed. */
    expect(attention(client({ id: 'a', nextKind: 'appointment', nextAt: new Date(NOW - DAY).toISOString() }), NOW)).toBeNull();
  });

  it('an active client nobody has spoken to in 45 days is dormant', () => {
    const quiet = client({ id: 'a', lastContactAt: new Date(NOW - 45 * DAY).toISOString(), nextAt: null });
    expect(displayStatus(quiet, NOW)).toBe('dormant');
    expect(quietDays(quiet, NOW)).toBe(45);
    expect(displayStatus(client({ id: 'b', lastContactAt: new Date(NOW - 44 * DAY).toISOString(), nextAt: null }), NOW)).toBe('active');
  });

  it('⚠️ a prospect is never quietly relabelled dormant', () => {
    expect(displayStatus(client({ id: 'a', status: 'prospect', lastContactAt: null, nextAt: null }), NOW)).toBe('prospect');
  });

  it('archived outranks everything', () => {
    expect(displayStatus(client({ id: 'a', archivedAt: new Date(NOW).toISOString(), overdueInvoices: 3 }), NOW)).toBe('archived');
  });
});

describe('the next action cell', () => {
  it('says the thing and the day', () => {
    expect(nextLine(client({ id: 'a' }), NOW)).toEqual({ text: 'Follow-up', when: 'Tomorrow', tone: 'grey' });
    expect(nextLine(client({ id: 'b', nextAt: new Date(NOW + 3 * DAY).toISOString(), nextKind: 'meeting' }), NOW).text).toBe('Meeting');
  });

  it('⚠️ says how quiet it is when nothing is owed', () => {
    const n = nextLine(client({ id: 'a', nextAt: null, lastContactAt: new Date(NOW - 45 * DAY).toISOString() }), NOW);
    expect(n).toEqual({ text: 'No activity', when: '45 days', tone: 'grey' });
  });
});

describe('the tabs', () => {
  it('counts onboarding as active, and keeps archived out of every other tab', () => {
    expect(inTab(client({ id: 'a', status: 'onboarding' }), 'active', NOW)).toBe(true);
    const gone = client({ id: 'b', archivedAt: new Date(NOW).toISOString() });
    expect(inTab(gone, 'all', NOW)).toBe(false);
    expect(inTab(gone, 'archived', NOW)).toBe(true);
  });
});

describe('search and filters', () => {
  const rows = [
    client({ id: 'f' }),
    client({ id: 'a', name: 'Ayesha Noor', phoneE164: '+923214567890', email: 'ayesha@demo.com', company: 'Demo Co', projectNames: ['Demo'], refNo: 1043, ownerId: 'sahad' }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(rows, { ...NO_FILTERS, ...f }, NOW).map((r) => r.id);

  it('finds a client by name, company, email or number', () => {
    expect(ids({ q: 'ayesha' })).toEqual(['a']);
    expect(ids({ q: 'demo co' })).toEqual(['a']);
    expect(ids({ q: 'chitralroyal' })).toEqual(['f']);
    expect(ids({ q: 'CLI-01043' })).toEqual(['a']);
  });

  it('⚠️ matches a phone on its digits, however it is typed', () => {
    expect(ids({ q: '0321 456' })).toEqual(['a']);
    expect(ids({ q: '+92 300 123' })).toEqual(['f']);
  });

  it('narrows by project, owner and relationship', () => {
    expect(ids({ project: 'Demo' })).toEqual(['a']);
    expect(ids({ owner: 'sahad' })).toEqual(['a']);
    expect(ids({ status: 'active' })).toEqual(['f', 'a']);
  });
});

describe('the order', () => {
  it('puts what needs somebody first, then what is owed soonest', () => {
    const rows = [
      client({ id: 'later', nextAt: new Date(NOW + 5 * DAY).toISOString() }),
      client({ id: 'late', nextAt: new Date(NOW - DAY).toISOString(), nextKind: 'call' }),
      client({ id: 'soon', nextAt: new Date(NOW + DAY).toISOString() }),
    ];
    expect(sortClients(rows, NOW).map((r) => r.id)).toEqual(['late', 'soon', 'later']);
  });
});

describe('the five cards', () => {
  it('⚠️ compares with last month only where last month can be rebuilt', () => {
    const rows = [
      client({ id: 'old1' }),
      client({ id: 'old2' }),
      client({ id: 'new', createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      client({ id: 'lastmonth', createdAt: '2026-08-15T05:00:00.000Z' }),
    ];
    const c = cards(rows, NOW);
    /* Three existed when September began; four now. */
    expect(c.total).toEqual({ value: 4, delta: 33, caption: 'from last month' });
    /* One new in September, one in August. */
    expect(c.fresh.value).toBe(1);
    expect(c.fresh.delta).toBe(0);
    /* No history exists for these, so no trend is drawn. */
    expect(c.active.delta).toBeNull();
    expect(c.attention.delta).toBeNull();
    expect(c.outstanding.delta).toBeNull();
    expect(c.outstanding.value).toBe(1_000_000);
    expect(c.outstanding.caption).toBe('4 unpaid invoices');
  });

  it('says what the needs-attention figure is made of', () => {
    const c = cards(
      [
        client({ id: 'a', nextAt: new Date(NOW - DAY).toISOString(), nextKind: 'call' }),
        client({ id: 'b', lastDirection: 'inbound' }),
      ],
      NOW,
    );
    expect(c.attention.value).toBe(2);
    expect(c.attention.caption).toBe('1 overdue · 1 waiting');
  });
});

describe('words', () => {
  it('writes money the way the design does', () => {
    expect(money(4_500_000)).toBe('PKR 4.5M');
    expect(money(1_850_000)).toBe('PKR 1.85M');
    expect(money(850_000)).toBe('PKR 850K');
    expect(money(12_000_000)).toBe('PKR 12M');
    expect(money(900)).toBe('PKR 900');
  });

  it('⚠️ calls quoted money quoted, never booked', () => {
    expect(valueOf(client({ id: 'a', bookedValue: 0, quotedValue: 850_000 }))).toEqual({ amount: 850_000, kind: 'quoted' });
    expect(valueOf(client({ id: 'b' })).kind).toBe('booked');
  });

  it('numbers and phones', () => {
    expect(refLabel(1042)).toBe('CLI-01042');
    expect(phoneLabel('+923001238726')).toBe('+92 300 123 8726');
  });
});

describe('export', () => {
  it('writes a sheet Excel opens as UTF-8, one client per line', () => {
    const csv = toCsv([client({ id: 'a' })], NOW);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('CLI-01042,Faisal Rehman');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  it('⚠️ never lets a name run as a formula', () => {
    const csv = toCsv([client({ id: 'a', name: '=HYPERLINK("x")' })], NOW);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('import', () => {
  it('reads quoted fields, commas and newlines inside quotes', () => {
    expect(parseCsv('Name,Notes\r\n"Rehman, Faisal","line one\nline two"\r\n')).toEqual([
      ['Name', 'Notes'],
      ['Rehman, Faisal', 'line one\nline two'],
    ]);
  });

  it('finds the columns by their names, whatever order they are in', () => {
    const { rows, missing } = importRows([
      ['Mobile', 'Client name', 'E-mail', 'Location', 'Status'],
      ['0300 1234567', 'Ayesha Noor', 'AYESHA@DEMO.COM', 'Lahore', 'prospect'],
    ]);
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ name: 'Ayesha Noor', phone: '0300 1234567', email: 'ayesha@demo.com', city: 'Lahore', status: 'prospect', problems: [] });
  });

  it('⚠️ marks what is wrong with a row instead of dropping it', () => {
    const { rows } = importRows([
      ['Name', 'Phone', 'Email'],
      ['', '0300 1234567', ''],
      ['Hina', '', 'not-an-email'],
    ]);
    expect(rows[0].problems).toContain('no name');
    expect(rows[1].problems).toContain('email looks wrong');
  });

  it('says so when the sheet has no name or contact column', () => {
    expect(importRows([['Foo', 'Bar'], ['1', '2']]).missing).toEqual(['name', 'phone']);
  });
});
