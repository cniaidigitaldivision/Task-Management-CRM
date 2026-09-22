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
vi.mock('@/components/crm/lead-details-modal', () => ({ LeadDetailsModal: () => null }));
vi.mock('@/components/crm/edit-lead-details', () => ({ EditLeadDetails: () => null }));
vi.mock('@/components/crm/related-items', () => ({ RelatedItemsDialog: () => null, seedRelated: () => ({}) }));
vi.mock('@/components/crm/follow-up-conditions-dialog', () => ({
  FollowUpConditionsDialog: () => null,
  ConditionsButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>Advanced settings</button>
  ),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => () => {} }));

import { FollowUpsBoard } from '@/components/crm/followups-board';
import type { BoardFollowUp, BoardSequence } from '@/lib/db/queries/crm-followup-board';
import type { TabKey } from '@/lib/domain/crm-followup-board';

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
  condNoReply: true,
  condQuoteValid: true,
  condNotBooked: true,
  conditionsChanged: 0,
  condNoReplyDefault: true,
  condQuoteValidDefault: true,
  condNotBookedDefault: true,
  onReply: 'hold',
  onOptOut: 'stop_sales',
  onQuoteExpired: 'hold',
  maxAttempts: 8,
  retryGapMinutes: 10,
  bookedAt: null,
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

/* ⚠️ THE PAGE ITSELF OPENS ON SCHEDULED (the owner's choice, 2026-09-22).
   These renders name the tab they are inspecting, because a static render
   cannot click one. */
const paint = (rows: BoardFollowUp[], seqs: BoardSequence[] = [], startTab: TabKey = 'queue') =>
  renderToStaticMarkup(
    <FollowUpsBoard
      followUps={rows}
      sequences={seqs}
      nowMs={NOW}
      viewerName="Sarah Malik"
      windowFrom="22 August 2026"
      startTab={startTab}
    />,
  );

const asShipped = (rows: BoardFollowUp[], seqs: BoardSequence[] = []) =>
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
    /* ⚠️ ONE CONTROL PER QUESTION. "Due status" and "Saved view" said the
       same thing, so there is one View now, and a date range beside it. */
    for (const f of ['View', 'Purpose', 'Channel', 'Project', 'Date range']) expect(html).toContain(f);
    expect(html).not.toContain('Due status');
  });

  it('⚠️ says which tab is open — highlighted AND underlined', () => {
    /* Owner, 2026-09-22, with the design: *"These are tabs … they are
       highlighted and they are underlined."* An earlier build made them filled
       pills after they said the selection was invisible; this is their drawing,
       made findable — a 3px accent bar and the label in the accent colour. */
    /* Measured on the running page: the class was NOT winning — the bar came
       out `2.22px solid rgb(211,225,226)`, border-subtle, while the text was
       correctly teal. It is an inline token now, which cannot lose. */
    expect(html).toMatch(/aria-selected="true"[\s\S]{0,240}border-bottom-color:var\(--accent-primary\)/);
    expect(html).toMatch(/aria-selected="true"[^>]*class="[^"]*text-accent-primary/);
    expect(html).toMatch(/aria-selected="false"[\s\S]{0,240}border-bottom-color:transparent/);
  });

  it('heads the queue exactly as the design does', () => {
    for (const col of ['Lead / project', 'Purpose', 'Due', 'Channel', 'Related item', 'Sequence', 'Status', 'Actions']) {
      expect(html).toContain(col);
    }
  });

  it('⚠️ the queue is what is owed now, and leaves the future to Scheduled', () => {
    expect(html).toContain('Bilal Ahmed');
    expect(html).toContain('Hina Shahzad');
    expect(html).not.toContain('Sana Iqbal');
  });

  it('⚠️ but the page itself opens on Scheduled', () => {
    /* Owner, 2026-09-22: *"by default when the page loads, the schedule tab
       should open or should be selected."* */
    const shipped = asShipped([
      row({ id: 'due' }),
      row({ id: 'later', dueAt: new Date(NOW + 48 * H).toISOString(), leadName: 'Sana Iqbal' }),
    ]);
    expect(shipped).toMatch(/aria-selected="true"[^>]*>Scheduled</);
    expect(shipped).toContain('Sana Iqbal');
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
    expect(html).toContain('Only if they have not replied');
    expect(html).toContain('Consent active');
    /* 247 · and the way into the advanced settings. */
    expect(html).toContain('Advanced settings');
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
  it('⚠️ the card and the queue heading agree about how many sequences run', () => {
    /* A running sequence often has no step queued at this instant, so counting
       its rows put 2 on the card and 0 beside the tab that shows those same
       two. The tabs carry no counts now (the owner's design), and the heading
       is the one place a number appears — it must be the same number. */
    const html = paint([], [sequence({ id: 's1' }), sequence({ id: 's2', leadName: 'Hina Shahzad' })]);
    expect(html).toMatch(/Active sequences<\/span>[\s\S]{0,200}>2</);
  });

  it('never calls a running sequence "no sequence"', () => {
    const html = paint([], [sequence({ id: 's1' })]);
    expect(html).not.toContain('No sequence is running');
  });
});

describe('the Sequences tab, in the same rhythm as the others', () => {
  /* Owner, 2026-09-22: *"how pathetic is the way you are showing that the
     sequences are two leads? Please show them in a proper same rhythm … on
     both the right side and the left side, where the details will be
     displayed."* It was a strip of cards with an empty panel beside it. */
  const html = paint(
    [row({ id: '1', sequenceRunId: 'seq-1' })],
    [sequence({ id: 'seq-1' }), sequence({ id: 'seq-2', leadName: 'Hina Shahzad', state: 'paused', pauseReason: 'the client replied' })],
    'sequences',
  );

  it('heads a table, not a strip of cards', () => {
    for (const col of ['Lead / project', 'Sequence', 'Step', 'Next step', 'Status', 'Actions']) {
      expect(html).toContain(col);
    }
    expect(html).toContain('Running sequences');
    expect(html).toContain('2 sequences');
  });

  it('lists every sequence with where it has got to', () => {
    expect(html).toContain('Faisal Rehman');
    expect(html).toContain('Hina Shahzad');
    expect(html).toContain('Quotation chase');
    expect(html).toMatch(/1 of 3/);
    expect(html).toContain('the client replied');
  });

  it('⚠️ shows the selected sequence on the right, which it never did before', () => {
    expect(html).toContain('Sequence details');
    expect(html).toContain('The plan');
    expect(html).toContain('Day 1');
    expect(html).toContain('Day 7');
    expect(html).toContain('Steps sent');
  });

  it('offers what a person can do about it', () => {
    for (const label of ['Pause', 'Stop', 'Conversation', 'Open the lead']) expect(html).toContain(label);
  });

  it('offers Resume instead of Pause on a paused one', () => {
    const paused = paint([], [sequence({ id: 'seq-2', state: 'paused', pauseReason: 'the client replied' })], 'sequences');
    expect(paused).toContain('Resume');
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
