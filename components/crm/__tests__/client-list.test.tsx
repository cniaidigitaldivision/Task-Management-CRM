import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClientList } from '@/components/crm/client-list';
import type { CrmClient } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * WHAT THE CLIENTS PAGE PUTS ON SCREEN — Step 9
 * ----------------------------------------------------------------------------
 * ⚠️ THE EMPTY CASE IS THE REAL ONE TODAY. Not a single one of the 615 leads has
 * reached `won`, so the state this screen is actually in is the one with nothing
 * in it — and that is the case most likely to read as a broken page rather than
 * as a three-week-old pipeline.
 * ========================================================================= */

const NOW = Date.parse('2026-09-10T09:00:00.000Z');

const KHURRAM: CrmClient = {
  id: 'c1',
  name: 'Khurram Shahzad',
  phoneE164: '+923001260001',
  email: null,
  city: 'Islamabad',
  firstLeadAt: '2026-07-12T10:00:00.000Z',
  convertedAt: '2026-09-09T10:00:00.000Z',
  leadCount: 3,
  wonCount: 2,
  projects: ['Chitral Royal Homes'],
};

const ONE_OFF: CrmClient = {
  id: 'c2',
  name: 'Bilal Khan',
  phoneE164: null,
  email: null,
  city: null,
  firstLeadAt: '2026-09-01T10:00:00.000Z',
  convertedAt: '2026-09-08T10:00:00.000Z',
  leadCount: 1,
  wonCount: 1,
  projects: ['Chitral Royal Homes', 'Internal CRM'],
};

const render = (clients: CrmClient[]) =>
  renderToStaticMarkup(<ClientList clients={clients} nowMs={NOW} />);

describe('when nobody has bought yet', () => {
  it('⚠️ names the exact action that fills the page', () => {
    /* "No clients yet" alone reads as broken. Saying WHICH control creates one
       makes it a state rather than a fault. */
    const html = render([]);

    expect(html).toContain('Nobody has become a client yet');
    expect(html).toContain('Won');
    expect(html).toContain('quotation accepted');
  });

  it('says there is no separate button, because there is not', () => {
    /* Migration 126 does it with a trigger. Somebody hunting for a "convert"
       control would not find one. */
    expect(render([])).toContain('no separate button');
  });

  it('draws no table at all', () => {
    expect(render([])).not.toContain('<table');
  });
});

describe('the client list', () => {
  it('⚠️ leads with the repeat enquirers, not the total', () => {
    /* "2 clients" is a number; "1 of them came back" changes what somebody does
       next, and it is what the reference screenshot's lead-count column is for. */
    const html = render([KHURRAM, ONE_OFF]);

    expect(html).toContain('come to us more than once');
    expect(html).toContain('>1<');
  });

  it('says nothing about repeats when nobody has repeated', () => {
    expect(render([ONE_OFF])).not.toContain('come to us more than once');
  });

  it('shows both counts, because they answer different questions', () => {
    /* How many times they came to us, and how many of those they bought on. */
    const html = render([KHURRAM]);

    expect(html).toContain('>3<');
    expect(html).toContain('enquiries');
    expect(html).toContain('2 won');
  });

  it('does not label a single enquiry as "enquiries"', () => {
    const html = render([ONE_OFF]);
    expect(html).not.toContain('enquiries');
  });

  it('names every project they bought on', () => {
    /* ⚠️ A client has no project of their own — migration 111. The link is
       through their leads, so somebody who bought a plot AND the CRM shows
       both. */
    const html = render([ONE_OFF]);

    expect(html).toContain('Chitral Royal Homes');
    expect(html).toContain('Internal CRM');
  });

  it('reaches them by link, and says so plainly when it cannot', () => {
    /* ⚠️ The same rule as the desk: `tel:` records nothing, so logging belongs
       on the lead where the timeline is. */
    const html = render([KHURRAM]);
    expect(html).toContain('href="tel:+923001260001"');
    expect(html).toContain('href="https://wa.me/923001260001"');

    const noNumber = render([ONE_OFF]);
    expect(noNumber).toContain('No number');
    expect(noNumber).not.toContain('href="tel:');
  });

  it('separates when they first came to us from when they became a client', () => {
    /* Khurram enquired in July and bought in September — two months of work,
       and collapsing them would hide it. */
    const html = render([KHURRAM]);

    expect(html).toContain('dateTime="2026-07-12T10:00:00.000Z"');
    expect(html).toContain('dateTime="2026-09-09T10:00:00.000Z"');
  });

  it('⚠️ prints no rate, average or lifetime value anywhere', () => {
    /* Every one of those divides by a number that is zero or a price this system
       has never been told. Same refusal as the sales team panel.

       ⚠️ THE WORDS, NOT A BARE `%`. A percent sign appears in the markup as a
       CSS length — `-inset-x-8` and the header glow both emit one — so the
       first version of this failed against a page with no percentage on it.
       Fourth time a loose needle has done that; the fix is to assert on what a
       reader would actually see. */
    const html = render([KHURRAM, ONE_OFF]).toLowerCase();

    for (const word of ['conversion', 'average', 'lifetime', 'rate']) {
      expect(html, word).not.toContain(word);
    }
  });
});
