import { describe, expect, it } from 'vitest';

import {
  buildActivityFeed,
  feedCounts,
  filterFeed,
  groupFeedByDay,
  groupOfKind,
  FEED_FILTERS,
  type FeedEvent,
  type FeedNote,
} from '@/lib/domain/crm-activity-feed';

/* ============================================================================
 * The feed is what the Activity tab shows, so what it drops is what somebody
 * cannot see. These tests are about the four ways it could lie: a kind with no
 * chip, a note whose words go missing, a future appointment presented as
 * history, and an enum value printed as English.
 * ========================================================================= */

/** Every value in `public.crm_activity_kind`, read off the database. */
const ALL_KINDS = [
  'imported', 'assigned', 'stage_changed', 'note_added', 'call_attempted',
  'call_connected', 'call_no_answer', 'whatsapp_sent', 'email_sent', 'won',
  'lost', 'temperature_set', 'next_action_set', 'created',
] as const;

const NOW = Date.parse('2026-09-18T07:00:00.000Z'); // Fri 18 Sep, 12:00 Karachi

const event = (over: Partial<FeedEvent> & { kind: string }): FeedEvent => ({
  id: over.id ?? `e-${over.kind}`,
  outcome: null,
  occurredAt: '2026-09-18T05:00:00.000Z',
  actorName: 'Ume Habiba',
  ...over,
});

const note = (over: Partial<FeedNote> & { id: string }): FeedNote => ({
  body: 'Asked for the corner plot.',
  createdAt: '2026-09-18T05:00:00.000Z',
  authorName: 'Ume Habiba',
  ...over,
});

describe('every kind has a chip', () => {
  it('sorts all fourteen kinds into a filter that exists', () => {
    const keys = new Set(FEED_FILTERS.map((f) => f.key));
    for (const kind of ALL_KINDS) {
      expect(keys.has(groupOfKind(kind)), kind).toBe(true);
    }
  });

  it('shows every entry under "All activity"', () => {
    const feed = buildActivityFeed({
      activity: ALL_KINDS.map((kind) => event({ kind, id: kind })),
      notes: [],
      nowMs: NOW,
    });
    expect(feed).toHaveLength(ALL_KINDS.length);
    expect(filterFeed(feed, 'all')).toHaveLength(ALL_KINDS.length);

    /* And the five chips between them account for every last one — a row no
       chip can reach is a row somebody will swear the system lost. */
    const counts = feedCounts(feed);
    const chips = counts.messages + counts.stage + counts.followups + counts.documents + counts.notes;
    expect(chips).toBe(feed.length);
  });
});

describe('what the detail line says', () => {
  it('names both stages on a stage change', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'stage_changed', detail: { from: 'new', to: 'contacted' } })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.title).toBe('Stage changed');
    expect(entry.detail).toBe('New → Contacted');
  });

  it('turns a lost_reason enum into English', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'lost', outcome: 'no_answer', detail: { from: 'qualified', to: 'lost' } })],
      notes: [],
      nowMs: NOW,
    });
    /* ⚠️ "no_answer" is database vocabulary. It must never reach a screen. */
    expect(entry.detail).not.toContain('no_answer');
    expect(entry.detail).toContain('From Qualified');
  });

  it('carries the note body onto its timeline row', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'note_added', detail: { note_id: 'n1' } })],
      notes: [note({ id: 'n1', body: 'Wants a call after Maghrib.' })],
      nowMs: NOW,
    });
    expect(entry.detail).toBe('Wants a call after Maghrib.');
  });

  it('says so when the note behind the row was withdrawn', () => {
    /* The activity row outlives the note — `crm_lead_activity` has no delete
       policy at any rank. The feed must not draw an empty line. */
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'note_added', detail: { note_id: 'gone' } })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.detail).toBe('This note was withdrawn.');
  });

  it('draws a note once, not twice', () => {
    const feed = buildActivityFeed({
      activity: [event({ kind: 'note_added', detail: { note_id: 'n1' } })],
      notes: [note({ id: 'n1' })],
      nowMs: NOW,
    });
    expect(feed).toHaveLength(1);
  });

  it('still shows a note whose timeline row is missing', () => {
    const feed = buildActivityFeed({ activity: [], notes: [note({ id: 'n9', body: 'Orphan.' })], nowMs: NOW });
    expect(feed).toHaveLength(1);
    expect(feed[0].detail).toBe('Orphan.');
  });
});

describe('history only', () => {
  const appointment = {
    id: 'a1',
    kind: 'site_visit',
    status: 'scheduled',
    location: 'Chitral site office',
    outcome: null,
    ownerName: 'Ume Habiba',
  };

  it('keeps an appointment that has already happened', () => {
    const feed = buildActivityFeed({
      activity: [],
      notes: [],
      appointments: [{ ...appointment, scheduledAt: '2026-09-17T05:00:00.000Z' }],
      nowMs: NOW,
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].group).toBe('followups');
  });

  it('leaves a booked visit out until it happens', () => {
    const feed = buildActivityFeed({
      activity: [],
      notes: [],
      appointments: [{ ...appointment, scheduledAt: '2026-09-20T05:00:00.000Z' }],
      nowMs: NOW,
    });
    expect(feed).toHaveLength(0);
  });

  it('takes a follow-up at the hour it was finished, and skips the pending one', () => {
    const base = {
      title: 'Second nudge',
      channel: 'whatsapp',
      status: 'done',
      dueAt: '2026-09-17T05:00:00.000Z',
      outcomeNote: null,
      doneByName: 'Ume Habiba',
    };
    const feed = buildActivityFeed({
      activity: [],
      notes: [],
      followUps: [
        { ...base, id: 'f1', doneAt: '2026-09-17T06:30:00.000Z' },
        { ...base, id: 'f2', status: 'pending', doneAt: null },
      ],
      nowMs: NOW,
    });
    expect(feed.map((e) => e.id)).toEqual(['followup:f1']);
    expect(feed[0].at).toBe(Date.parse('2026-09-17T06:30:00.000Z'));
  });

  it('files a quotation under Documents with its money and its status', () => {
    const feed = buildActivityFeed({
      activity: [],
      notes: [],
      quotations: [{
        id: 'q1',
        number: 'QT-2051',
        version: 2,
        status: 'sent',
        netAmount: 4_500_000,
        propertyLabel: '5 Marla · Block B',
        preparedByName: 'Ume Habiba',
        createdAt: '2026-09-16T05:00:00.000Z',
      }],
      nowMs: NOW,
    });
    expect(feed[0].group).toBe('documents');
    expect(feed[0].title).toBe('Quotation QT-2051 · v2');
    expect(feed[0].detail).toContain('4,500,000');
    expect(feed[0].opens).toBe('quotations');
  });
});

describe('the days', () => {
  it('heads the groups Today, Yesterday and then the date', () => {
    const feed = buildActivityFeed({
      activity: [
        event({ id: 'a', kind: 'call_connected', occurredAt: '2026-09-18T05:00:00.000Z' }),
        event({ id: 'b', kind: 'call_connected', occurredAt: '2026-09-17T05:00:00.000Z' }),
        event({ id: 'c', kind: 'call_connected', occurredAt: '2026-09-13T05:00:00.000Z' }),
      ],
      notes: [],
      nowMs: NOW,
    });
    expect(groupFeedByDay(feed, NOW).map((d) => d.label)).toEqual(['Today', 'Yesterday', '13 Sep 2026']);
  });

  it('groups by the Karachi day, not the UTC one', () => {
    /* 19:30 UTC on the 17th is 00:30 on the 18th in Karachi — the five hours
       that make `current_date` a different day here every evening. */
    const feed = buildActivityFeed({
      activity: [event({ kind: 'call_connected', occurredAt: '2026-09-17T19:30:00.000Z' })],
      notes: [],
      nowMs: NOW,
    });
    expect(groupFeedByDay(feed, NOW)[0].label).toBe('Today');
  });

  it('puts the newest first', () => {
    const feed = buildActivityFeed({
      activity: [
        event({ id: 'old', kind: 'call_connected', occurredAt: '2026-09-10T05:00:00.000Z' }),
        event({ id: 'new', kind: 'call_connected', occurredAt: '2026-09-18T05:00:00.000Z' }),
      ],
      notes: [],
      nowMs: NOW,
    });
    expect(feed.map((e) => e.id)).toEqual(['new', 'old']);
  });
});

describe('who did it', () => {
  it('calls a null actor on an imported row the importer, not Unknown', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'imported', actorName: null, detail: { form: '102931' } })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.by).toBe('The importer');
    expect(entry.detail).toBe('From a Meta lead form');
  });

  it('marks anything else with no actor as automatic', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'whatsapp_sent', actorName: null })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.by).toBe('Automatic');
  });
});

describe('a stage that moved by itself', () => {
  it('says what moved it, beside the two stages', () => {
    /* 209 writes the evidence into `why`. */
    const [entry] = buildActivityFeed({
      activity: [event({
        kind: 'stage_changed',
        actorName: null,
        detail: { from: 'new', to: 'contacted', why: 'the client replied to us' },
      })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.detail).toContain('New → Contacted');
    expect(entry.detail).toContain('the client replied to us');
    expect(entry.by).toBe('Automatic');
  });

  it('says nothing extra when a person moved it', () => {
    const [entry] = buildActivityFeed({
      activity: [event({ kind: 'stage_changed', detail: { from: 'new', to: 'contacted' } })],
      notes: [],
      nowMs: NOW,
    });
    expect(entry.detail).toBe('New → Contacted');
    expect(entry.by).toBe('Ume Habiba');
  });
});
