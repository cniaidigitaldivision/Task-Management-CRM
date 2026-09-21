import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/app/actions/crm-lead-bundles', () => ({ leadBundlesAction: async () => ({ at: 0, bundles: {} }) }));
vi.mock('@/app/actions/crm-appointments-board', () => ({
  saveAppointmentNotesAction: async () => ({ ok: true }),
  bookableLeadsAction: async () => [],
}));
vi.mock('@/app/actions/crm-leads', () => ({
  closeAppointmentAction: async () => ({ ok: true }),
  bookAppointmentAction: async () => ({ ok: true }),
  rescheduleAppointmentAction: async () => ({ ok: true }),
}));
vi.mock('@/components/crm/lead-details-modal', () => ({ LeadDetailsModal: () => null }));
vi.mock('@/components/crm/related-items', () => ({ RelatedItemsDialog: () => null, seedRelated: () => ({}) }));
vi.mock('@/components/crm/record-outcome', () => ({ RecordOutcome: () => null }));
vi.mock('@/components/crm/edit-lead-details', () => ({ EditLeadDetails: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => () => {} }));

import { AppointmentsBoard } from '@/components/crm/appointments-board';
import type { BoardAppointment } from '@/lib/db/queries/crm-appointments-board';

/* ============================================================================
 * THE APPOINTMENTS PAGE, AS THE OWNER DREW IT (2026-09-21)
 * ----------------------------------------------------------------------------
 * A static render: what is on screen when the page opens. Filters, clicks and
 * the calendar are client state and are covered by the rules' own tests
 * (lib/domain/__tests__/crm-appointment-board.test.ts).
 * ========================================================================= */

/* Monday 21 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const H = 3_600_000;

const row = (over: Partial<BoardAppointment> & { id: string }): BoardAppointment => ({
  refNo: 201,
  leadId: `lead-${over.id}`,
  leadName: 'Faisal Rehman',
  leadPhone: '+923000000001',
  leadStage: 'visit_scheduled',
  leadNextAction: null,
  leadNextActionAt: null,
  projectName: 'Chitral Royal Homes',
  kind: 'site_visit',
  status: 'confirmed',
  scheduledAt: new Date(NOW + 20 * H).toISOString(),
  durationMinutes: 30,
  location: 'Demo sales office, Islamabad',
  notes: 'Client wants to inspect plot access and discuss instalments.',
  outcome: null,
  outcomeAt: null,
  clientInterested: null,
  ownerId: 'me',
  ownerName: 'Sarah Malik',
  propertyId: 'p1',
  propertyCode: 'A-101',
  propertyLabel: '5 Marla Plot · A-101, Block A',
  quotationId: 'q1',
  quotationNumber: 'QT-1042',
  confirmationSent: true,
  reminderStatus: 'planned',
  reminderAt: new Date(NOW + 18 * H).toISOString(),
  feedbackStatus: null,
  feedbackAt: null,
  moved: false,
  ...over,
});

const render = (rows: BoardAppointment[]) =>
  renderToStaticMarkup(
    <AppointmentsBoard appointments={rows} nowMs={NOW} viewerId="me" viewerName="Sarah Malik" windowFrom="24 March 2026" />,
  );

describe('the page as drawn', () => {
  const html = render([
    row({ id: 'a' }),
    row({ id: 'b', refNo: 204, kind: 'call', status: 'scheduled', leadName: 'Hina Shahzad', scheduledAt: new Date(NOW + 2 * H).toISOString(), propertyCode: null }),
    row({ id: 'c', refNo: 199, status: 'completed', leadName: 'Ayesha Noor', scheduledAt: new Date(NOW - 96 * H).toISOString(), outcome: 'Client attended the site visit.', clientInterested: true }),
  ]);

  it('has the header, the Schedule button and the four cards', () => {
    expect(html).toContain('Appointments');
    expect(html).toContain('Schedule appointment');
    for (const label of ['Today', 'Upcoming', 'Awaiting confirmation', 'Completed this week']) expect(html).toContain(label);
  });

  it('has List and Calendar, the search and every filter', () => {
    expect(html).toContain('>list<');
    expect(html).toContain('>calendar<');
    expect(html).toContain('Search lead or appointment');
    expect(html).toContain('All types');
    expect(html).toContain('All statuses');
    expect(html).toContain('Select date range');
    expect(html).toContain('>Project<');
    expect(html).toContain('Saved view');
  });

  it('lists every appointment by its number, with lead, project, type, related item and status', () => {
    expect(html).toContain('APPT-201');
    expect(html).toContain('APPT-204');
    expect(html).toContain('Faisal Rehman · Chitral Royal Homes');
    expect(html).toContain('A-101 · QT-1042');
    expect(html).toContain('Confirmed');
    expect(html).toContain('Client confirmation needed');
    expect(html).toContain('Completed');
  });

  it('opens with the first row\'s details on the right — the soonest one still to come', () => {
    /* The call at 5 PM today is sooner than the visit tomorrow. */
    expect(html).toContain('Appointment details');
    expect(html).toContain('Last recorded outcome (APPT-204)');
    expect(html).toContain('View lead');
  });

  it('has the three buttons in the details panel', () => {
    expect(html).toContain('Reschedule');
    expect(html).toContain('Cancel appointment');
    expect(html).toContain('Record outcome');
  });
});

describe('what an owed appointment looks like', () => {
  it('⚠️ leads the list as Needs recording, and says it on the list header', () => {
    const html = render([row({ id: 'late', status: 'scheduled', scheduledAt: new Date(NOW - 3 * H).toISOString() }), row({ id: 'soon' })]);
    expect(html).toContain('Needs recording');
    expect(html).toContain('1 needs recording');
    expect(html).toContain('Nothing is recorded for this site visit yet');
  });

  it('⚠️ never offers a one-click No-show', () => {
    expect(render([row({ id: 'late', scheduledAt: new Date(NOW - 3 * H).toISOString() })])).not.toContain('No-show');
  });
});

describe('the details panel', () => {
  const html = render([row({ id: 'a' })]);

  it('says when, where, who and the reminder in words', () => {
    expect(html).toContain('22 September 2026, 11:00 – 11:30 AM PKT');
    expect(html).toContain('Demo sales office, Islamabad');
    expect(html).toContain('You · Sarah Malik');
    expect(html).toContain('WhatsApp · 2 hours before · Scheduled');
  });

  it('links the property and the quotation by name, and shows the notes', () => {
    expect(html).toContain('View property A-101');
    expect(html).toContain('View quotation QT-1042');
    expect(html).toContain('Client wants to inspect plot access');
  });
});

describe('never a dead button (owner, 2026-09-21: "these buttons are not working")', () => {
  it('a completed appointment offers Edit outcome and Book another — not three disabled buttons', () => {
    const html = render([row({ id: 'done', status: 'completed', scheduledAt: new Date(NOW - 5 * H).toISOString(), outcome: 'Visit done' })]);
    expect(html).toContain('Edit outcome');
    expect(html).toContain('Book another site visit');
    expect(html).not.toContain('Cancel appointment');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg[^>]*>[^]*?Record outcome/);
  });

  it('a cancelled one offers Book again', () => {
    expect(render([row({ id: 'x', status: 'cancelled' })])).toContain('Book again');
  });
});

describe('an office visit', () => {
  it('is a type of its own in the filter and on the row', () => {
    const html = render([row({ id: 'o', kind: 'office_visit' })]);
    expect(html).toContain('Office visits');
    expect(html).toContain('Office visit');
  });
});

describe('an empty diary', () => {
  it('says so and offers to schedule one', () => {
    const html = render([]);
    expect(html).toContain('No appointments yet');
    expect(html).toContain('Pick an appointment to see its details.');
  });

  it('states the window it reaches back to', () => {
    expect(render([])).toContain('from 24 March 2026 onwards');
  });
});
