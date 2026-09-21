import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppointmentsDesk } from '@/components/crm/appointments-desk';
import type { CrmDiaryRow } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * WHAT THE APPOINTMENTS SCREEN PUTS ON SCREEN — Phase H, for Phase E
 * ----------------------------------------------------------------------------
 * ⚠️ THE EMPTY CASE IS THE REAL ONE TODAY. `crm_appointments` holds zero rows,
 * so the state the owner will actually open this page in is the one with nothing
 * in it — and an empty diary that does not say how to fill it reads as a broken
 * screen rather than as a feature nobody has used yet. Same reasoning as the
 * clients page, which has been empty since it was built.
 *
 * ⚠️ AND THE THREE EMPTIES MEAN DIFFERENT THINGS. "Nothing to write up" is good
 * news; "nothing booked" is a prompt; "no appointments at all" has to name the
 * control that creates one. One sentence covering all three would be wrong twice.
 * ========================================================================= */

const NOW = Date.parse('2026-09-16T09:00:00.000Z');
const DAY = 864e5;

const row = (over: Partial<CrmDiaryRow> & { id: string }): CrmDiaryRow => ({
  leadId: `lead-${over.id}`,
  leadName: 'Ayesha Noor',
  kind: 'site_visit',
  status: 'scheduled',
  scheduledAt: new Date(NOW + DAY).toISOString(),
  durationMinutes: 60,
  location: 'Plot A-101, Block A',
  propertyLabel: '5 Marla Plot · A-101, Block A',
  projectName: 'Demo — Product Enquiries [demo]',
  outcome: null,
  outcomeAt: null,
  ...over,
});

const render = (appointments: CrmDiaryRow[]) =>
  renderToStaticMarkup(
    <AppointmentsDesk appointments={appointments} backDays={60} limit={300} nowMs={NOW} />,
  );

describe('when the diary is completely empty', () => {
  it('⚠️ names the exact control that fills it', () => {
    /* The owner opens this today with zero rows. "No appointments" alone is
       indistinguishable from a page that failed to load. */
    const html = render([]);

    expect(html).toContain('No appointments yet');
    expect(html).toContain('Record Outcome');
    expect(html).toContain('site visit requested');
  });

  it('lands on Upcoming rather than an empty Needs recording', () => {
    /* ⚠️ Opening on a tab that is empty BECAUSE THERE IS NOTHING TO DO is a
       worse first impression than opening on the one that is empty because the
       diary is. The default follows what is actionable. */
    const html = render([]);
    const upcoming = html.indexOf('Upcoming');

    expect(upcoming).toBeGreaterThan(-1);
    expect(html).not.toContain('Nothing waiting to be written up');
  });
});

describe('when something has happened and nobody wrote it up', () => {
  const owed = [row({ id: 'a', scheduledAt: new Date(NOW - DAY * 2).toISOString() })];

  it('opens on Needs recording, because that is the actionable one', () => {
    const html = render(owed);

    expect(html).toContain('Needs recording');
    /* The write-up control is only offered on that tab, so its presence is what
       proves the tab is the one selected. */
    expect(html).toContain('It happened');
  });

  it('⚠️ offers Done or Cancel — never a one-click No-show', () => {
    /* Owner, 2026-09-21, after a stray click closed a visit: *"'Not shown' is
       not a scenario… It's done or it cancels."* A client who did not come is a
       reason chosen inside the Cancel confirmation. */
    const html = render(owed);

    expect(html).not.toContain('No-show');
    expect(html).toContain('Cancel');
  });

  it('⚠️ does not offer a write-up on a visit that has not happened yet', () => {
    /* Offering "did not turn up" on a visit three days away is an invitation to
       close something by accident. */
    const html = render([row({ id: 'b', scheduledAt: new Date(NOW + DAY * 3).toISOString() })]);

    expect(html).not.toContain('It happened');
    expect(html).not.toContain('No-show');
  });
});

describe('calling off a booked visit', () => {
  it('⚠️ is offered on Upcoming — and this screen is the only place it exists', () => {
    /* `closeAppointmentAction` has accepted `cancelled` since 152 and no screen
       ever sent it: Today's plan shows its buttons only on a PAST appointment, so
       a client ringing to move tomorrow's visit left the diary uncorrectable. */
    const html = render([row({ id: 'h', scheduledAt: new Date(NOW + DAY * 3).toISOString() })]);

    expect(html).toContain('Cancel');
  });

  it('⚠️ does not fire on the first click', () => {
    /* The one irreversible thing on this page — a stray click cancels a real
       client's visit. It opens a confirmation with a required reason instead
       (cancel-appointment-dialog), which is closed on render. */
    const html = render([row({ id: 'i', scheduledAt: new Date(NOW + DAY * 3).toISOString() })]);

    expect(html).not.toContain('Why? (required)');
    expect(html).not.toContain('Cancel the site visit');
  });
});

describe('what each row actually says', () => {
  it('carries the lead, the project, the unit and the length', () => {
    const html = render([row({ id: 'c', scheduledAt: new Date(NOW - DAY).toISOString() })]);

    expect(html).toContain('Ayesha Noor');
    expect(html).toContain('Demo — Product Enquiries [demo]');
    expect(html).toContain('5 Marla Plot');
    expect(html).toContain('60 min');
  });

  it('links the name to the real record rather than a second drawer', () => {
    /* ⚠️ This screen deliberately has no drawer of its own — a second copy of
       the record is a second thing to keep in step. */
    const html = render([row({ id: 'd' })]);

    expect(html).toContain('/my-leads?lead=lead-d');
  });

  it('⚠️ shows the outcome on a recorded one, not just the status', () => {
    /* A "Completed" badge alone tells you a visit happened, which the lead's
       timeline already said. What was SAID at it is the reason to keep the row.

       ⚠️ RENDERED FROM THE *owed* BUCKET so it is on the opening tab — a static
       render cannot press Done. Which bucket a status lands in is proved in
       `lib/domain/__tests__/crm-appointments.test.ts` instead, which is exactly
       why that rule was moved out of this component. */
    const html = render([
      row({
        id: 'e',
        scheduledAt: new Date(NOW - DAY * 3).toISOString(),
        outcome: 'They came with their brother and asked about the payment plan.',
      }),
    ]);

    expect(html).toContain('asked about the payment plan');
  });
});

describe('the window is stated, never implied', () => {
  it('says how far back it reaches', () => {
    /* ⚠️ A diary that silently stopped at sixty days would have somebody
       concluding a visit was never recorded. */
    expect(render([])).toContain('last 60 days');
  });

  it('admits the cap only when it has actually been hit', () => {
    const under = render([row({ id: 'f' })]);
    expect(under).not.toContain('capped at');
  });
});

describe('a cancelled appointment', () => {
  it('⚠️ is counted and kept, not hidden', () => {
    /* Today's plan hides these — it is a list of what to do next. This is a
       record, and "we cancelled that" is a fact about the week. The Done tab's
       own count is what proves the row survived; the row itself is behind a
       click a static render cannot make. */
    const html = render([
      row({ id: 'g', status: 'cancelled', scheduledAt: new Date(NOW + DAY).toISOString() }),
    ]);

    expect(html).toContain('Done');
    expect(html).toMatch(/Done<span[^>]*>1<\/span>/);
  });
});
