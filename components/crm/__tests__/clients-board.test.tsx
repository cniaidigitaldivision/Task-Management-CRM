import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/app/actions/crm-client-board', () => ({
  bulkClientAction: async () => ({ ok: true, done: 0, refused: [] }),
  clientActivityAction: async () => ({ ok: true, moments: [] }),
  updateClientAction: async () => ({ ok: true }),
  addClientAction: async () => ({ ok: true }),
  clientDuplicatesAction: async () => ({ duplicates: [] }),
  clientOwnerChoicesAction: async () => ({ manages: false, people: [] }),
  importClientsAction: async () => ({ ok: true, added: 0, failed: [] }),
  importMatchesAction: async () => [],
}));
vi.mock('@/app/actions/crm-documents', () => ({ uploadCrmDocumentAction: async () => ({ ok: true }) }));
vi.mock('@/app/actions/crm-lead-bundles', () => ({ leadBundlesAction: async () => ({ at: 0, bundles: {} }) }));
vi.mock('@/components/crm/lead-details-modal', () => ({ LeadDetailsModal: () => null }));
vi.mock('@/components/crm/related-items', () => ({ RelatedItemsDialog: () => null, seedRelated: () => ({}) }));
vi.mock('@/components/crm/edit-lead-details', () => ({ EditLeadDetails: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => () => {} }));

import { ClientsBoard } from '@/components/crm/clients-board';
import type { ClientRow } from '@/lib/db/queries/crm-client-board';

/* ============================================================================
 * THE CLIENTS PAGE, AS THE OWNER DREW IT (2026-09-22)
 * ----------------------------------------------------------------------------
 * A static render — what is on screen when the page opens. The rules behind
 * every chip and figure have their own tests (lib/domain/__tests__/
 * crm-client-board.test.ts).
 * ========================================================================= */

/* Monday 22 September 2026, 3:00 PM Karachi. */
const NOW = Date.parse('2026-09-22T10:00:00.000Z');
const DAY = 86_400_000;

const row = (over: Partial<ClientRow> & { id: string }): ClientRow => ({
  refNo: 1042,
  name: 'Faisal Rehman',
  company: null,
  phoneE164: '+923001238726',
  email: 'faisal@chitralroyalhomes.com',
  city: 'Islamabad',
  notes: null,
  source: 'meta_lead_ad',
  preferredChannel: 'whatsapp',
  status: 'active',
  archivedAt: null,
  createdAt: new Date(NOW - 60 * DAY).toISOString(),
  ownerId: 'sarah',
  ownerName: 'Sarah Malik',
  leadIds: [`lead-${over.id}`],
  primaryLeadId: `lead-${over.id}`,
  primaryProjectId: 'p1',
  primaryProjectName: 'Chitral Royal Homes',
  projectNames: ['Chitral Royal Homes'],
  leadStage: 'won',
  openDeals: 1,
  wonLeads: 1,
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

const paint = (rows: ClientRow[]) =>
  renderToStaticMarkup(
    <ClientsBoard
      clients={rows}
      projects={[{ id: 'p1', name: 'Chitral Royal Homes' }]}
      nowMs={NOW}
      viewerId="sarah"
      viewerName="Sarah Malik"
    />,
  );

describe('the Clients page as it first draws', () => {
  const html = paint([
    row({ id: 'f' }),
    row({ id: 'k', name: 'Kamran Sheikh', company: 'AGC Construction', nextAt: new Date(NOW - 2 * DAY).toISOString(), nextKind: 'call', nextLabel: null }),
    row({ id: 'a', name: 'Ayesha Noor', status: 'prospect', bookedValue: 0, quotedValue: 850_000 }),
    row({ id: 'm', name: 'Mohsin Ahmed', lastContactAt: new Date(NOW - 45 * DAY).toISOString(), nextAt: null }),
    row({ id: 'x', name: 'Archived Person', archivedAt: new Date(NOW - DAY).toISOString() }),
  ]);

  it('carries the owner’s heading and both header actions', () => {
    expect(html).toContain('Manage client relationships, projects, communication and sales records.');
    expect(html).toContain('Import clients');
    expect(html).toContain('Add client');
  });

  it('draws the five cards', () => {
    for (const label of ['Total clients', 'Active', 'New this month', 'Needs attention', 'Outstanding']) {
      expect(html).toContain(label);
    }
  });

  it('draws every tab, the view switch and every filter', () => {
    for (const t of ['All clients', 'Prospects', 'Needs attention', 'Dormant', 'Archived']) expect(html).toContain(t);
    expect(html).toContain('Table');
    expect(html).toContain('Cards');
    for (const f of ['All projects', 'All owners', 'All statuses', 'More filters', 'Export']) expect(html).toContain(f);
  });

  it('heads the directory as the design does', () => {
    for (const col of ['Client / company', 'Contact', 'Linked project', 'Owner', 'Relationship', 'Value', 'Next action', 'Actions']) {
      expect(html).toContain(col);
    }
    expect(html).toContain('Bulk actions');
  });

  it('⚠️ says why a client needs attention, and how quiet a dormant one is', () => {
    expect(html).toContain('Call overdue · 2 days');
    expect(html).toContain('No activity');
    expect(html).toContain('45 days');
  });

  it('⚠️ calls quoted money quoted, and keeps an archived client off the main list', () => {
    expect(html).toContain('quoted');
    expect(html).not.toContain('Archived Person');
    expect(html).toContain('4 records');
  });

  it('opens the preview on the first client with every section of the design', () => {
    for (const s of ['Relationship overview', 'Linked project', 'Related records', 'Recent activity', 'Open related items', 'View full record']) {
      expect(html).toContain(s);
    }
    expect(html).toContain('CLI-01042');
    expect(html).toContain('1 unpaid');
  });

  it('⚠️ says activity is being read rather than that there is none', () => {
    expect(html).toContain('Reading what happened with');
    expect(html).not.toContain('Nothing has happened with this client yet');
  });
});

describe('an empty page', () => {
  it('says there are no clients and offers to add one', () => {
    const html = paint([]);
    expect(html).toContain('No clients yet.');
    expect(html).toContain('Pick a client to see their summary.');
  });
});
