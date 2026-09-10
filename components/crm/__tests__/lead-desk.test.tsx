/* ============================================================================
 * WHAT THE LEAD DESK PUTS ON SCREEN
 * ----------------------------------------------------------------------------
 * Renders to a HTML string and asserts on the words. No jsdom, no DOM — see the
 * note in vitest.config.mts for why that is enough and what it deliberately does
 * NOT cover (layout, contrast and theme were settled in a browser instead).
 *
 * ⚠️ THE ROWS BELOW ARE REAL, copied off the live table on 2026-09-10 — including
 * the Meta test lead whose "phone number" is a sentence, and the CHITHRAL
 * spelling. A tidy fixture would test a shape this data does not have, and it is
 * exactly the awkward rows that decide whether a screen is honest.
 * ========================================================================= */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams('project=abc'),
}));

import { LeadDesk } from '@/components/crm/lead-desk';
import type { CrmLeadRow, CrmProjectOption } from '@/lib/db/queries/crm-leads';

const PROJECTS: CrmProjectOption[] = [
  { id: 'abc', name: 'Chitral Royal Homes', code: 'CRH', leads: 615, forms: 6, connection: 'live' },
  {
    id: 'def',
    name: 'The Executive Housing Project',
    code: 'TEH',
    leads: 0,
    forms: 0,
    connection: 'not-connected',
  },
  { id: 'ghi', name: 'Investo 21', code: 'INV', leads: 0, forms: 2, connection: 'no-leads-yet' },
];

/* Real values, copied off the live table. */
const ROWS: CrmLeadRow[] = [
  {
    id: '955d695c-1ae8-4052-81f0-18bafea1f635',
    fullName: 'Mukhtar Ahmad',
    phone: '03439040510',
    phoneE164: '+923439040510',
    city: 'CHITHRAL',
    stage: 'new',
    temperature: null,
    nextAction: null,
    nextActionAt: null,
    submittedAt: '2026-09-09T18:26:50.000Z',
    ownerId: null,
    ownerName: null,
    formName: 'Chitral Royal Homes-copy-copy-copy',
    campaignName: null,
    lastActivityKind: 'imported',
    lastActivityAt: '2026-09-09T19:00:00.000Z',
    noteCount: 0,
  },
  /* The unparseable-number case — one of the three. */
  {
    id: 'b2',
    fullName: '<test lead: dummy data>',
    phone: 'call me on the landline',
    phoneE164: null,
    city: null,
    stage: 'lost',
    temperature: 'cold',
    nextAction: null,
    nextActionAt: null,
    submittedAt: '2026-07-28T15:19:17.000Z',
    ownerId: null,
    ownerName: null,
    formName: 'Chitral Royal Homes-copy',
    campaignName: null,
    lastActivityKind: 'imported',
    lastActivityAt: null,
    noteCount: 0,
  },
  /* A fully worked lead — the shape Steps 6-7 will produce. */
  {
    id: 'c3',
    fullName: 'Tariq Qasim',
    phone: '0346 9019309',
    phoneE164: '+923469019309',
    city: 'Chitral',
    stage: 'negotiation',
    temperature: 'hot',
    nextAction: 'Call back about the 5 Marla plot',
    nextActionAt: '2026-09-08T09:00:00.000Z', // overdue
    submittedAt: '2026-09-01T10:00:00.000Z',
    ownerId: 'u1',
    ownerName: 'Abdul Moiz',
    formName: 'CRH  ( 17/08/26 )',
    campaignName: 'CRH Sept Plots',
    lastActivityKind: 'call_no_answer',
    lastActivityAt: '2026-09-09T08:00:00.000Z',
    noteCount: 3,
  },
];

const NOW = Date.parse('2026-09-10T09:00:00.000Z');

const base = {
  projects: PROJECTS,
  rows: ROWS,
  total: 615,
  stageCounts: { new: 612, negotiation: 2, lost: 1 },
  owners: [{ id: 'u1', name: 'Abdul Moiz', leads: 1 }],
  forms: [{ id: 'f1', name: 'Chitral Royal Homes-copy', leads: 553 }],
  page: 1,
  perPage: 25,
  filters: {
    stage: null,
    ownerId: null,
    temperature: null,
    formId: null,
    search: null,
    from: null,
    to: null,
  },
  /* Step 7. The manager's view by default — `canShareOut` false is the
     salesperson's, and has its own cases below. */
  unassigned: 0,
  salesTeam: [
    { id: 'u1', name: 'Sale Tester', avatarUrl: null, isManager: false,
      openLeads: 12, totalLeads: 14, wonLeads: 0, lastGivenAt: '2026-09-10T04:00:00.000Z',
      medianResponseMinutes: 35 },
    { id: 'u2', name: 'Sale 2 tester', avatarUrl: null, isManager: false,
      openLeads: 3, totalLeads: 3, wonLeads: 0, lastGivenAt: null,
      medianResponseMinutes: null },
    { id: 'u3', name: 'sale manager tester', avatarUrl: null, isManager: true,
      openLeads: 0, totalLeads: 0, wonLeads: 0, lastGivenAt: null,
      medianResponseMinutes: null },
  ],
  canShareOut: true,
  nowMs: NOW,
};

describe('the live project', () => {
  const html = renderToStaticMarkup(<LeadDesk {...base} selected={PROJECTS[0]} />);

  it('renders without throwing', () => {
    expect(html.length).toBeGreaterThan(1000);
  });

  it('shows the people, their numbers formatted, and their cities', () => {
    expect(html).toContain('Mukhtar Ahmad');
    expect(html).toContain('0343 9040510');
    expect(html).toContain('CHITHRAL');
  });

  it('ages a lead from when THEY enquired', () => {
    expect(html).toContain('14h ago');
  });

  it('flags an overdue next action', () => {
    expect(html).toContain('Overdue');
    expect(html).toContain('Call back about the 5 Marla plot');
  });

  it('shows stage and temperature as words, never enum names', () => {
    expect(html).toContain('Negotiation');
    expect(html).toContain('Hot');
    expect(html).not.toContain('follow_up');
    expect(html).not.toContain('call_no_answer');
    expect(html).toContain('No answer');
  });

  it('names the owner, and says Unassigned rather than blank', () => {
    expect(html).toContain('Abdul Moiz');
    expect(html).toContain('Unassigned');
    expect(html).toContain('Not set');
  });

  it('builds a tel: and wa.me link only from a parsed number', () => {
    expect(html).toContain('tel:+923439040510');
    expect(html).toContain('https://wa.me/923439040510');
    expect(html).toContain('No usable number');
    /* ⚠️ Never a link built from the unparseable value. */
    expect(html).not.toContain('call me on the landline"');
  });

  it('draws every stage in the strip, including the empty ones', () => {
    for (const label of [
      'New',
      'Contacted',
      'Follow up',
      'Qualified',
      'Visited',
      'Scheduled',
      'Negotiation',
      'Won',
      'Lost',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('shows the campaign when there is one, the form when there is not', () => {
    expect(html).toContain('CRH Sept Plots');
    expect(html).toContain('Chitral Royal Homes-copy-copy-copy');
  });

  it('marks the other projects in the dropdown', () => {
    expect(html).toContain('not connected');
    expect(html).toContain('no leads yet');
    expect(html).toContain('615 leads');
  });

  it('names the owner of a lead somebody holds', () => {
    /* ⚠️ THE BANNER THAT USED TO BE ASSERTED HERE IS GONE. It said owner and
       next action "fill in once assignment and calling are built" — both are
       built now, and the share-out control replaced it (see its own cases
       below). What still matters is that a held lead names who holds it, which
       is what migration 121's reader exists for: the sales manager reads one
       row of `users`, so a plain join would print "Former member" here. */
    expect(html).toContain('Abdul Moiz');
    expect(html).not.toContain('Former member');
  });
});

describe('sharing leads out — Step 7', () => {
  it('offers it to the manager, and says what the rule is', () => {
    /* ⚠️ THE RULE IS PRINTED. A salesperson who cannot see how the rota works
       has no way to check it, and an unexplained allocation gets argued with. */
    const html = renderToStaticMarkup(
      <LeadDesk {...base} selected={PROJECTS[0]} unassigned={312} />,
    );

    expect(html).toContain('312');
    expect(html).toContain('fewest open leads');
    expect(html).toContain('waited longest');
    expect(html).toContain('Share out');
  });

  it('⚠️ offers it to nobody who cannot hand leads out', () => {
    /* A salesperson told "312 leads have nobody working them" is being shown a
       queue they cannot take from — which reads as a complaint about them. */
    const html = renderToStaticMarkup(
      <LeadDesk {...base} selected={PROJECTS[0]} unassigned={312} canShareOut={false} />,
    );

    expect(html).not.toContain('Share out');
    expect(html).not.toContain('fewest open leads');
  });

  it('says so plainly when there is nobody in Sales to give them to', () => {
    /* ⚠️ Not a disabled button somebody has to guess about. */
    const html = renderToStaticMarkup(
      /* The manager alone, with no salespeople under them — the rota has
         nowhere to put a lead. */
      <LeadDesk
        {...base}
        selected={PROJECTS[0]}
        unassigned={312}
        salesTeam={base.salesTeam.filter((p) => p.isManager)}
      />,
    );

    expect(html).toContain('nobody in the Sales department');
    expect(html).toContain('Team page');
    expect(html).not.toContain('Share out');
  });

  it('disappears once every lead has an owner', () => {
    const html = renderToStaticMarkup(
      <LeadDesk {...base} selected={PROJECTS[0]} unassigned={0} />,
    );
    expect(html).not.toContain('Share out');
  });

  it('tells a salesperson with nothing yet where leads come from', () => {
    /* ⚠️ An empty desk with no sentence reads as broken. It is not — it means
       the manager has not shared any out. */
    const html = renderToStaticMarkup(
      <LeadDesk
        {...base}
        selected={PROJECTS[0]}
        rows={[]}
        total={0}
        stageCounts={{}}
        canShareOut={false}
      />,
    );

    expect(html).toContain('Nothing has been given to you yet');
    expect(html).toContain('notification the moment one is yours');
  });
});

describe('the sales team panel — Step 7b', () => {
  const html = renderToStaticMarkup(<LeadDesk {...base} selected={PROJECTS[0]} />);

  it('shows each person and what they are carrying', () => {
    expect(html).toContain('The sales team');
    expect(html).toContain('Sale Tester');
    expect(html).toContain('Sale 2 tester');
    expect(html).toContain('Open leads');
  });

  it('marks the manager as outside the rota', () => {
    /* Otherwise a manager holding 0 looks idle rather than excluded. */
    expect(html).toContain('Manager — not in the rota');
  });

  it('⚠️ says "No calls yet" rather than printing a zero', () => {
    /* THE ONE THAT MATTERS. A null median rendered as "0m" would tell a manager
       their salesperson answers instantly — the most flattering possible
       reading of no data at all. */
    expect(html).toContain('No calls yet');
    expect(html).not.toContain('>0m<');
  });

  it('reads a real response time in words', () => {
    expect(html).toContain('35m');
  });

  it('⚠️ draws no bar at all for somebody holding nothing', () => {
    /* A minimum-width stub against 0 reads as a small quantity, which is a
       different fact from holding none — and the manager legitimately sits at
       zero. Two salespeople have bars; the manager has none. */
    const bars = html.match(/border-radius:9999px|rounded-full/g) ?? [];
    const withZero = renderToStaticMarkup(
      <LeadDesk
        {...base}
        selected={PROJECTS[0]}
        salesTeam={base.salesTeam.map((p) => ({ ...p, openLeads: 0 }))}
      />,
    );
    /* Nobody holding anything → strictly fewer rounded marks than when two do. */
    expect((withZero.match(/rounded-full/g) ?? []).length).toBeLessThan(bars.length);
  });

  it('⚠️ shows no Won column and no conversion rate while nothing is closed', () => {
    /* A "0% conversion" column reads as a fact about the salespeople and is a
       fact about the calendar — the pipeline is three weeks old.

       ⚠️ `</th>` MATTERS IN THIS NEEDLE. A bare `>Won<` also matches the stage
       chip in the strip above, where "Won" is a legitimate pipeline stage — the
       first version of this assertion failed against a panel that was correct.
       Likewise `%` alone matches the bar widths this very panel sets. */
    expect(html).not.toContain('>Won</th>');
    expect(html).not.toContain('conversion');
    expect(html).toContain('No lead has been closed yet');
  });

  it('adds the Won column the moment somebody closes one', () => {
    const withWin = renderToStaticMarkup(
      <LeadDesk
        {...base}
        selected={PROJECTS[0]}
        salesTeam={base.salesTeam.map((p) =>
          p.id === 'u1' ? { ...p, wonLeads: 2 } : p,
        )}
      />,
    );
    expect(withWin).toContain('>Won</th>');
  });

  it('⚠️ is not shown to a salesperson at all', () => {
    /* Colleagues' response times are the manager's view. Migration 120's guard
       returns them an empty roster, so this is belt and braces. */
    const staff = renderToStaticMarkup(
      <LeadDesk {...base} selected={PROJECTS[0]} canShareOut={false} salesTeam={[]} />,
    );
    expect(staff).not.toContain('The sales team');
  });
});

describe('the projects that are not live', () => {
  it('says not connected, and why', () => {
    const html = renderToStaticMarkup(<LeadDesk {...base} selected={PROJECTS[1]} rows={[]} total={0} stageCounts={{}} />);
    expect(html).toContain('The Executive Housing Project is not connected');
    expect(html).toContain('No Meta lead form is linked');
    expect(html).not.toContain('<table');
  });

  it('distinguishes "connected but nothing yet" from "not connected"', () => {
    const html = renderToStaticMarkup(<LeadDesk {...base} selected={PROJECTS[2]} rows={[]} total={0} stageCounts={{}} />);
    expect(html).toContain('Investo 21 has no leads yet');
    expect(html).toContain('2 lead forms are linked');
  });
});

describe('an empty filter result', () => {
  it('says the leads still exist rather than looking deleted', () => {
    const html = renderToStaticMarkup(<LeadDesk {...base} selected={PROJECTS[0]} rows={[]} total={0} />);
    expect(html).toContain('No leads match these filters');
  });
});
