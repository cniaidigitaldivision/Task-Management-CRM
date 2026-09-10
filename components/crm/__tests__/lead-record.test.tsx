/* ============================================================================
 * WHAT THE LEAD RECORD PUTS ON SCREEN
 * ----------------------------------------------------------------------------
 * Renders to a HTML string and asserts on the words. No jsdom, no DOM — see the
 * note in vitest.config.mts for why that is enough and what it deliberately does
 * NOT cover (layout, contrast and theme are settled in a browser instead).
 *
 * ⚠️ THE FIXTURE IS A REAL LEAD'S SHAPE, read off the live table on 2026-09-10:
 * the same five answer keys, the same `imported` activity row with a NULL actor,
 * the same absent owner. A tidy fixture would test a record this data does not
 * have, and every assertion below is about a case the real 615 rows contain.
 * ========================================================================= */
import type { Route } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LeadRecord } from '@/components/crm/lead-record';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadSibling,
} from '@/lib/db/queries/crm-leads';

const NOW = Date.parse('2026-09-10T09:00:00.000Z');

const LEAD: CrmLeadRecord = {
  id: '955d695c-1ae8-4052-81f0-18bafea1f635',
  projectId: 'abc',
  projectName: 'Chitral Royal Homes',
  fullName: 'Mukhtar Ahmad',
  phone: '03439040510',
  phoneE164: '+923439040510',
  email: null,
  city: 'CHITHRAL',
  answers: {
    city: 'CHITHRAL',
    full_name: 'Mukhtar Ahmad',
    phone_number: '03439040510',
    'are_you_looking_for_plots_&_villa_?': 'plots',
    'which__size_are_you_interested_in?_': '10_marla_(commercial)',
  },
  stage: 'new',
  temperature: null,
  lostReason: null,
  nextAction: null,
  nextActionAt: null,
  submittedAt: '2026-09-09T18:26:50.000Z',
  importedAt: '2026-09-09T20:02:56.000Z',
  firstContactedAt: null,
  closedAt: null,
  ownerId: null,
  ownerName: null,
  formName: 'Chitral Royal Homes-copy-copy-copy',
  campaignName: null,
  source: 'meta_lead_ad',
  externalId: '1234567890123456',
};

/* ⚠️ NULL ACTOR, `imported` — every one of the 615 activity rows held today. */
const IMPORTED: CrmLeadEvent = {
  id: 'e1',
  kind: 'imported',
  outcome: null,
  occurredAt: '2026-09-09T20:02:56.000Z',
  actorId: null,
  actorName: null,
  actorAvatarUrl: null,
};

function render(props: Partial<React.ComponentProps<typeof LeadRecord>> = {}) {
  return renderToStaticMarkup(
    <LeadRecord
      lead={LEAD}
      notes={[]}
      activity={[IMPORTED]}
      alsoEnquired={[]}
      backHref={'/leads?project=abc' as Route}
      nowMs={NOW}
      {...props}
    />,
  );
}

describe('the person, and reaching them', () => {
  it('shows the name, the number as a person reads it, and the city', () => {
    const html = render();

    expect(html).toContain('Mukhtar Ahmad');
    /* ⚠️ `0343 9040510`, not `+923439040510`. The stored form is E.164; the read
       form is what somebody dials. See lib/domain/phone.ts. */
    expect(html).toContain('0343 9040510');
    expect(html).toContain('CHITHRAL');
  });

  it('offers a dialling link and a WhatsApp link built from the normalised number', () => {
    const html = render();

    expect(html).toContain('href="tel:+923439040510"');
    expect(html).toContain('href="https://wa.me/923439040510"');
  });

  it('refuses both links when the number could not be parsed, and says why', () => {
    /* One of the three: a Meta test lead whose "phone number" is a sentence. */
    const html = render({
      lead: {
        ...LEAD,
        fullName: '<test lead: dummy data>',
        phone: 'call me on the landline',
        phoneE164: null,
      },
    });

    /* ⚠️ THE POINT. A tel: link built from a guess rings a stranger. */
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain('wa.me');
    expect(html).toContain('could not be read as a mobile');
    /* And what they typed is still on the page — nothing is hidden. */
    expect(html).toContain('call me on the landline');
  });

  it('says the name was not given rather than calling the person unknown', () => {
    const html = render({ lead: { ...LEAD, fullName: null } });
    expect(html).toContain('Name not given');
  });
});

describe('what they told the form', () => {
  it('asks the question in words, not in Meta’s key', () => {
    const html = render();

    expect(html).toContain('Which size are you interested in?');
    expect(html).toContain('Are you looking for plots &amp; villa?');
    /* ⚠️ The raw key must never reach the screen — a salesperson would be
       decoding their own CRM. */
    expect(html).not.toContain('which__size_are_you_interested_in');
  });

  it('opens up a machine choice value but keeps the raw one as evidence', () => {
    const html = render();

    expect(html).toContain('10 marla (commercial)');
    expect(html).toContain('title="10_marla_(commercial)"');
  });
});

describe('the record', () => {
  it('separates when they enquired from when we imported them', () => {
    /* ⚠️ THE BACKFILL PULLED THREE MONTHS IN ONE AFTERNOON. Collapsing these two
       would have made 615 people look like they all arrived at once, and
       response time is the number this desk exists to improve. */
    const html = render();

    expect(html).toContain('Enquired');
    expect(html).toContain('Imported');
    /* ⚠️ `dateTime`, camelCase — that is what this React version emits into the
       static markup, not the lowercased attribute a browser would show. */
    expect(html).toContain('dateTime="2026-09-09T18:26:50.000Z"');
    expect(html).toContain('dateTime="2026-09-09T20:02:56.000Z"');
  });

  it('reads dates in Karachi, not UTC', () => {
    /* Submitted 18:26 UTC on the 9th = 23:26 Karachi, same day. And the import
       an hour and a half later is already the 10th in Karachi while still being
       the 9th in UTC — the fault line 109 of the 615 leads sit on. */
    const html = render();

    expect(html).toContain('9 Sept 2026, 23:26');
    expect(html).toContain('10 Sept 2026, 01:02');
  });

  it('labels the source column "Came from" and shows the form, never the word campaign', () => {
    const html = render();

    expect(html).toContain('Came from');
    expect(html).toContain('Chitral Royal Homes-copy-copy-copy');
    /* ⚠️ `crm_campaigns` is empty. A heading saying "Campaign" over a form name
       is how spend gets judged by the wrong figure. */
    expect(html).not.toContain('Campaign');
  });

  it('says a lead is unassigned rather than leaving the owner blank', () => {
    expect(render()).toContain('Unassigned');
  });

  it('names the lost reason in the words the team says', () => {
    const html = render({ lead: { ...LEAD, stage: 'lost', lostReason: 'wrong_number' } });

    expect(html).toContain('Wrong or invalid number');
    expect(html).not.toContain('wrong_number');
  });
});

describe('the timeline', () => {
  it('calls a null actor on an imported row the importer, not a former member', () => {
    /* ⚠️ EVERY ACTIVITY ROW HELD TODAY IS THIS ONE. Labelling it "Former member"
       would accuse a cron job of resigning. */
    const html = render();

    expect(html).toContain('Imported');
    expect(html).toContain('By the importer');
    expect(html).not.toContain('Former member');
  });

  it('names a real person when one acted', () => {
    const html = render({
      activity: [
        {
          id: 'e2',
          kind: 'assigned',
          outcome: null,
          occurredAt: '2026-09-10T08:00:00.000Z',
          actorId: 'u1',
          actorName: 'Ume Habiba',
          actorAvatarUrl: null,
        },
        IMPORTED,
      ],
    });

    expect(html).toContain('Assigned');
    expect(html).toContain('Ume Habiba');
  });
});

describe('notes', () => {
  it('says where writing will appear rather than drawing a box that does not save', () => {
    /* ⚠️ Step 5 READS. A note box that looked live and dropped what somebody
       typed about a quotation is the worst state this page could be in. */
    const html = render();

    expect(html).toContain('Nothing has been written about this lead yet');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<button');
  });

  it('shows a note with its author', () => {
    const note: CrmLeadNote = {
      id: 'n1',
      body: 'Quoted 5 marla at 42 lakh, asked to call back Friday.',
      createdAt: '2026-09-10T07:00:00.000Z',
      authorId: 'u1',
      authorName: 'Ume Habiba',
      authorAvatarUrl: null,
    };
    const html = render({ notes: [note] });

    expect(html).toContain('Quoted 5 marla at 42 lakh');
    expect(html).toContain('Ume Habiba');
  });
});

describe('the same number, enquiring twice', () => {
  const sibling: CrmLeadSibling = {
    id: 'other-lead',
    submittedAt: '2026-07-28T15:19:17.000Z',
    stage: 'new',
    projectName: 'Chitral Royal Homes',
    formName: 'Chitral Royal Homes-copy',
  };

  it('warns when the number is on another lead, and links to it', () => {
    /* 615 leads carry 597 distinct numbers — roughly eighteen people enquired
       twice, and the second salesperson to open one needs to know. */
    const html = render({ alsoEnquired: [sibling] });

    expect(html).toContain('This number enquired before');
    expect(html).toContain('href="/leads/other-lead"');
    expect(html).toContain('somebody may already have spoken to them');
  });

  it('claims nothing at all when it found nothing', () => {
    /* ⚠️ A sales member sees only the sibling leads assigned to THEM, so "0
       other enquiries" would be a sentence this page cannot stand behind. */
    const html = render({ alsoEnquired: [] });

    expect(html).not.toContain('enquired before');
  });
});

describe('getting back', () => {
  it('returns to the list that was left, filters and all', () => {
    const html = render({ backHref: '/leads?project=abc&stage=new&page=9' as Route });

    expect(html).toContain('href="/leads?project=abc&amp;stage=new&amp;page=9"');
    expect(html).toContain('Back to the lead desk');
  });
});
