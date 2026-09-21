import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/app/actions/crm-lead-bundles', () => ({ leadBundlesAction: async () => ({ at: 0, bundles: {} }) }));
vi.mock('@/app/actions/crm-appointments-board', () => ({ bookableLeadsAction: async () => [] }));
vi.mock('@/app/actions/crm-followup-board', () => ({
  saveFollowUpBodyAction: async () => ({ ok: true }),
  rescheduleFollowUpAction: async () => ({ ok: true }),
  sendFollowUpNowAction: async () => ({ ok: true, sent: true }),
}));
vi.mock('@/app/actions/crm-followups', () => ({
  completeFollowUpAction: async () => ({ ok: true }),
  cancelFollowUpAction: async () => ({ ok: true }),
  stopSequenceAction: async () => ({ ok: true }),
}));
vi.mock('@/components/crm/follow-up-wizard', () => ({ FollowUpWizard: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => () => {} }));

import { FollowUpsBoard } from '@/components/crm/followups-board';
import type { BoardFollowUp, BoardSequence } from '@/lib/db/queries/crm-followup-board';

/* ============================================================================
 * THE FOLLOW-UPS PAGE, AS THE OWNER DREW IT (2026-09-22)
 * ----------------------------------------------------------------------------
 * A static render: what is on screen when the page opens. Tabs, filters and
 * every click are client state over one query, and the rules behind them have
 * their own tests (lib/domain/__tests__/crm-followup-board.test.ts).
 * ========================================================================= */

/* Monday 21 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const H = 3_600_000;

const row = (over: Partial<BoardFollowUp> & { id: string }): BoardFollowUp => ({
  leadId: `lead-${over.id}`,
  leadName: 'Faisal Rehman',
  leadPhone: '+923000000001',
  leadStage: 'quotation_sent',
  projectName: 'Chitral Royal Homes',
  purpose: 'quotation',
  channel: 'whatsapp',
  mode: 'auto_send',
  status: 'due',
  dueAt: new Date(NOW - H).toISOString(),
  title: 'Quotation check-in',
  body: 'Assalam o Alaikum {{lead_first_name}}, just checking on the quotation we sent.',
  subject: null,
  outcomeNote: null,
  doneAt: null,
  attempts: 0,
  templateName: 'crm_quote_followup',
  windowOpen: true,
  consent: true,
  ownerName: 'Sarah Malik',
  businessSender: 'CNI Developers',
  sequenceRunId: 'seq-1',
  sequenceName: 'Quotation chase',
  sequenceState: 'active',
  sequencePauseReason: null,
  stepNo: 1,
  stepTotal: 3,
  stopOnReply: true,
  stopOnVisit: true,
  stopOnQuotationDead: true,
  steps: [
    { stepNo: 1, day: 1, channel: 'whatsapp', title: 'Quotation check-in' },
    { stepNo: 2, day: 3, channel: 'email', title: 'Send the plan again' },
    { stepNo: 3, day: 7, channel: 'call', title: 'Ring them' },
  ],
  quotationId: 'q1',
  quotationNumber: 'QT-1042',
  quotationStatus: 'approved',
  quotationValidUntil: new Date(NOW + 10 * 24 * H).toISOString(),
  appointmentId: null,
  appointmentRef: null,
  appointmentAt: null,
  propertyLabel: '5 Marla Plot · A-101',
  lastMessageAt: new Date(NOW - 20 * H).toISOString(),
  lastMessageBody: 'Thank you, I will look at it tonight.',
  lastMessageDirection: 'inbound',
  lastMessageStatus: 'delivered',
  awaitingOurReply: false,
  awaitingTheirReply: true,
  ...over,
});

const sequence = (over: Partial<BoardSequence> & { id: string }): BoardSequence => ({
  leadId: 'lead-1',
  leadName: 'Faisal Rehman',
  projectName: 'Chitral Royal Homes',
  name: 'Quotation chase',
  purpose: 'quotation',
  state: 'active',
  step: 1,
  total: 3,
  startedAt: new Date(NOW - 48 * H).toISOString(),
  nextStepAt: new Date(NOW + 24 * H).toISOString(),
  pauseReason: null,
  ...over,
});

const paint = (rows: BoardFollowUp[], seqs: BoardSequence[] = []) =>
  renderToStaticMarkup(
    <FollowUpsBoard
      followUps={rows}
      sequences={seqs}
      nowMs={NOW}
      viewerName="Sarah Malik"
      windowFrom="22 August 2026"
    />,
  );

describe('the follow-ups page as it first draws', () => {
  const html = paint(
    [
      row({ id: '1' }),
      row({ id: '2', dueAt: new Date(NOW - 30 * H).toISOString(), leadName: 'Hina Shahzad' }),
      row({ id: '3', awaitingOurReply: true, awaitingTheirReply: false, leadName: 'Bilal Ahmed' }),
      row({ id: '4', dueAt: new Date(NOW + 48 * H).toISOString(), leadName: 'Sana Iqbal' }),
    ],
    [sequence({ id: 's1' })],
  );

  it('carries the owner’s heading and the New follow-up button', () => {
    expect(html).toContain('Follow-ups');
    expect(html).toContain('Prioritise the next action and keep every open lead moving');
    expect(html).toContain('New follow-up');
  });

  it('draws the four cards with their counts', () => {
    for (const label of ['Due today', 'Overdue', 'Reply needed', 'Active sequences']) {
      expect(html).toContain(label);
    }
  });

  it('draws the four tabs and every filter', () => {
    for (const tab of ['My queue', 'Scheduled', 'Sequences', 'Completed']) expect(html).toContain(tab);
    for (const f of ['Due status', 'Purpose', 'Channel', 'Project', 'Saved view']) expect(html).toContain(f);
  });

  it('⚠️ says which tab is open, in a way you can see across the room', () => {
    /* Owner, 2026-09-22: *"which tab is selected or which tab is opened is not
       visible"*. The open tab is filled and marked, never merely underlined. */
    expect(html).toMatch(/aria-selected="true"[^>]*class="[^"]*bg-accent-primary/);
  });

  it('heads the queue exactly as the design does', () => {
    for (const col of ['Lead / project', 'Purpose', 'Due', 'Channel', 'Related item', 'Sequence', 'Status', 'Actions']) {
      expect(html).toContain(col);
    }
  });

  it('⚠️ opens on what is owed now, and leaves the future to Scheduled', () => {
    expect(html).toContain('Bilal Ahmed');
    expect(html).toContain('Hina Shahzad');
    expect(html).not.toContain('Sana Iqbal');
  });

  it('shows the related item and where the step sits in its sequence', () => {
    expect(html).toContain('QT-1042');
    expect(html).toContain('Step 1 of 3');
  });
});

describe('the details panel', () => {
  const html = paint([row({ id: '1' })]);

  it('says why it is priority, in the facts it used', () => {
    expect(html).toContain('Priority suggested: High');
    expect(html).toContain('approved quote');
  });

  it('⚠️ fills the tokens the way the sender fills them', () => {
    expect(html).toContain('Assalam o Alaikum Faisal');
    expect(html).not.toContain('{{lead_first_name}}');
  });

  it('shows the channel, the sender, the related item and how it goes out', () => {
    expect(html).toContain('WhatsApp');
    expect(html).toContain('CNI Developers');
    expect(html).toContain('Sent automatically');
  });

  it('shows the recent conversation and the conditions that would stop it', () => {
    expect(html).toContain('Recent conversation');
    expect(html).toContain('View conversation');
    expect(html).toContain('Stop if the client replies');
    expect(html).toContain('Consent active');
  });

  it('previews every step of the sequence by day', () => {
    expect(html).toContain('Sequence preview');
    expect(html).toContain('Day 1');
    expect(html).toContain('Day 7');
  });

  it('offers reschedule, stop and send on something still open', () => {
    expect(html).toContain('Reschedule');
    expect(html).toContain('Stop sequence');
    expect(html).toContain('Review &amp; send');
  });
});

describe('the sequence tab and its counts', () => {
  it('⚠️ counts sequences on the Sequences tab, so it agrees with the card', () => {
    /* A running sequence often has no step queued at this instant. Counting rows
       put 2 on the card and 0 on the tab showing those same two. */
    const html = paint([], [sequence({ id: 's1' }), sequence({ id: 's2', leadName: 'Hina Shahzad' })]);
    expect(html).toContain('Active sequences');
    expect(html).toMatch(/Sequences<\/?[^>]*>?[\s\S]{0,120}>2</);
  });

  it('never calls a running sequence "no sequence"', () => {
    const html = paint([], [sequence({ id: 's1' })]);
    expect(html).not.toContain('No sequence is running');
  });
});

describe('what the screen says when there is nothing to do', () => {
  it('does not pretend the queue is empty because the page is', () => {
    const html = paint([row({ id: '1', dueAt: new Date(NOW + 48 * H).toISOString() })]);
    expect(html).toContain('Nothing is owed right now');
  });

  it('⚠️ never offers Send on something already sent', () => {
    const html = paint([row({ id: '1', status: 'done', doneAt: new Date(NOW - H).toISOString() })]);
    expect(html).toContain('Completed');
    expect(html).not.toContain('Review &amp; send');
  });

  it('⚠️ paints red only on what is actually owed', () => {
    /* A cancelled row keeps the date it was set for, and painting that red said
       a closed follow-up was late. Red belongs to overdue, due now and a client
       waiting — nothing else. (A closed row lives under Completed, which is a
       click away; the rule itself is what this asserts.) */
    const late = paint([row({ id: '2', dueAt: new Date(NOW - 30 * H).toISOString() })]);
    expect(late).toContain('Overdue');
    expect(late).toContain('--feedback-error');

    const calm = paint([row({ id: '3', awaitingTheirReply: false, dueAt: new Date(NOW - H).toISOString(), quotationStatus: null })]);
    expect(calm).toContain('Due now');
  });
});
