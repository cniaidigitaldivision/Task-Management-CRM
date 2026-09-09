import type { Metadata } from 'next';
import { Globe, Megaphone, MessageCircle, Phone, Radio } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { DIVISION_NAME } from '@/lib/domain/constants';

export const metadata: Metadata = { title: 'Campaign & Lead Desk' };

/* ============================================================================
 * CAMPAIGN & LEAD DESK
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-09: *"In the left sidebar in that branch I will start working…
 * for all leads management. Leads are coming from the campaigns, right? I have
 * access to all marketing APIs so I want to start working on that."*
 *
 * ── ⚠️ THIS PAGE HAS NO NUMBERS ON IT, AND THAT IS THE POINT ───────────────
 * Nothing in this database holds a lead yet. There is no table, no import, no
 * webhook. The tempting version of this scaffold is a row of stat cards reading
 * "0 leads · 0 qualified · 0% conversion" over a chart with a plausible curve —
 * and that is the one thing that must not ship, because it is the version
 * somebody screenshots for a client before anybody has connected anything.
 *
 * The same rule the Analytics tab of the Studio carries: no placeholder chart,
 * ever. So this page says what it is for, what it needs, and what has to be
 * decided — which is genuinely the most useful thing it can hold today.
 *
 * ⚠️ AND THE NAME. It mirrors "Trend & Engagement Studio": two nouns and a
 * place. The two nouns are the halves that must not collapse into each other —
 * a CAMPAIGN is what was run and paid for, a LEAD is the person it produced.
 * Reporting one as the other is how a month of spend gets judged by the wrong
 * number. Change it in three places if the owner prefers another: here, the
 * metadata above, and nav-config.ts.
 * ========================================================================= */

/** What a lead can arrive from, once something is connected. Named, not
 *  counted — the count is what this page refuses to invent. */
const SOURCES = [
  {
    /* No Facebook glyph in this icon set — and a brand mark would be wrong
       here anyway, since this row is the CHANNEL rather than the company. */
    icon: Megaphone,
    label: 'Meta lead ads',
    detail:
      'Instant forms on Facebook and Instagram. The system-user tokens are already in place per business suite, so this is the shortest route to a first real lead.',
  },
  {
    icon: MessageCircle,
    label: 'WhatsApp',
    detail:
      'Click-to-WhatsApp campaigns and inbound messages. The division already runs a WhatsApp Business API automation project.',
  },
  {
    icon: Globe,
    label: 'Website forms',
    detail: 'A contact or enquiry form posting into an endpoint here.',
  },
  {
    icon: Phone,
    label: 'Calls and walk-ins',
    detail:
      'Entered by hand. Worth planning for from the start — a pipeline that only counts what an API sends will disagree with what the team knows.',
  },
] as const;

/** The questions that decide the shape of everything else. */
const DECISIONS = [
  {
    question: 'What is a lead, exactly?',
    detail:
      'The fields every source must produce: name, phone, what they asked about, when, and which campaign brought them. Sources that cannot fill one of those decide whether it is optional.',
  },
  {
    question: 'Who owns a lead, and who may read one?',
    detail:
      'This page is Admin-only today, which is the safe start rather than the answer. A lead carries a stranger’s phone number, so the rule wants deciding before the table exists, not after.',
  },
  {
    question: 'What are the stages?',
    detail:
      'New, contacted, qualified, won, lost — or whatever the team actually says out loud. The task board’s statuses were built this way and it is why they get used.',
  },
  {
    question: 'Which project does a lead belong to?',
    detail:
      'Leads for a client’s campaign belong to that client’s project, which is what would let the Studio and this desk answer the same question the same way.',
  },
] as const;

export default async function LeadsPage() {
  /* ⚠️ Repeated from the layout on purpose: a page is reachable without its
     layout in some render paths, and a floor that exists in only one of the two
     is not a floor. Same pattern as the Studio. */
  await requireRole('admin');

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Campaign & Lead Desk"
        description="Where the people a campaign brings in are worked, from first enquiry to won or lost."
      />

      {/* ── Nothing is connected, said plainly ─────────────────────────────── */}
      <section className="rounded-2xl border border-dashed border-border-default bg-bg-surface px-6 py-10 text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-xl"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
            color: 'var(--accent-primary)',
          }}
        >
          <Radio className="size-5" strokeWidth={2} />
        </span>

        <h2 className="mt-3 text-h3 font-semibold text-text-primary">No lead source is connected</h2>
        <p className="mx-auto mt-2 max-w-xl text-body-sm leading-relaxed text-text-secondary">
          Nothing here is counted yet, and nothing is invented — there is no lead table, no import
          and no webhook. This page shows figures the moment a real one arrives, and not before.
        </p>
      </section>

      {/* ── Where leads will come from ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-body font-semibold text-text-primary">Where leads will come from</h2>
          <p className="mt-0.5 text-caption text-text-secondary">
            Named, not counted. Each becomes real once it is connected.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {SOURCES.map((source) => {
            const Icon = source.icon;
            return (
              <li
                key={source.label}
                className="rounded-xl border border-border-subtle bg-bg-surface p-4"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
                  <span className="text-body-sm font-semibold text-text-primary">{source.label}</span>
                  <span className="ml-auto rounded-full bg-bg-subtle px-2 py-0.5 text-micro text-text-tertiary">
                    Not connected
                  </span>
                </span>
                <p className="mt-1.5 text-caption leading-relaxed text-text-secondary">
                  {source.detail}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── What has to be decided ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-body font-semibold text-text-primary">What has to be decided first</h2>
          <p className="mt-0.5 text-caption text-text-secondary">
            Four questions. Each one changes the table underneath, so they are cheaper to answer now
            than after the first thousand rows.
          </p>
        </div>

        <ol className="space-y-2">
          {DECISIONS.map((decision, index) => (
            <li
              key={decision.question}
              className="flex gap-3 rounded-xl border border-border-subtle bg-bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-lg bg-bg-subtle text-micro font-semibold tabular-nums text-text-tertiary"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-text-primary">
                  {decision.question}
                </span>
                <span className="mt-1 block text-caption leading-relaxed text-text-secondary">
                  {decision.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
