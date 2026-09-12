import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import type { CrmClient } from '@/lib/db/queries/crm-leads';
import { DIVISION_NAME } from '@/lib/domain/constants';
import { displayPhone, whatsAppDigits } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';

/* ============================================================================
 * CLIENTS — Step 9 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-09: *"Once he is interested, or we give some quotation and he
 * accepted… that would become our client."* And the reference screenshot's
 * *"Khurram · 16 Leads"* — one person, several enquiries.
 *
 * ── ⚠️ NOBODY IS A CLIENT YET, AND THIS PAGE SAYS SO IN WORDS ──────────────
 * Not one of the 615 leads has reached `won`. So the honest version of this
 * screen today is empty with an explanation of what fills it — and the
 * explanation has to name the exact action, because "no clients yet" alone reads
 * as something broken rather than as a pipeline three weeks old.
 *
 * ── ⚠️ AND IT COUNTS, IT DOES NOT RATE ─────────────────────────────────────
 * No "conversion %", no "average deal", no lifetime value. Every one of those is
 * a division by a number that is currently zero or a figure this system has
 * never been told — the CRM holds no prices. The same refusal as the sales team
 * panel: counts until there is something to divide.
 * ========================================================================= */

export function ClientList({
  clients,
  nowMs,
}: {
  clients: readonly CrmClient[];
  nowMs: number;
}) {
  /* ⚠️ THE HEADLINE IS THE REPEAT ENQUIRERS, not the total. "14 clients" is a
     number; "3 of them came back" is the thing that changes what somebody does
     next — and it is the fact the reference screenshot's lead-count column
     exists to show. */
  const repeat = clients.filter((c) => c.leadCount > 1);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Clients"
        description="The people who went past an enquiry and actually engaged."
      />

      {clients.length === 0 ? (
        <Empty />
      ) : (
        <>
          {repeat.length > 0 && (
            <p className="rounded-xl border border-dashed border-border-default bg-bg-surface px-4 py-2.5 text-caption leading-relaxed text-text-secondary">
              <strong className="text-text-primary">{repeat.length}</strong> of these{' '}
              {clients.length === 1 ? 'client' : 'clients'}{' '}
              {repeat.length === 1 ? 'has' : 'have'} come to us more than once.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-surface">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border-default bg-bg-subtle">
                  <Th>Client</Th>
                  <Th>Leads</Th>
                  <Th>On</Th>
                  <Th>First came to us</Th>
                  <Th>Became a client</Th>
                  <Th>Reach them</Th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const wa = whatsAppDigits(client.phoneE164);
                  return (
                    <tr
                      key={client.id}
                      className="border-b border-border-subtle last:border-b-0 hover:bg-bg-subtle/60"
                    >
                      <Td>
                        <span className="block truncate text-body-sm font-semibold text-text-primary">
                          {client.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-text-secondary">
                          <span className="tabular-nums">
                            {displayPhone(client.phoneE164)}
                          </span>
                          {client.city && (
                            <>
                              <Dot />
                              <span>{client.city}</span>
                            </>
                          )}
                        </span>
                      </Td>

                      <Td>
                        {/* ⚠️ TWO NUMBERS, because they answer different
                            questions: how many times this person came to us, and
                            how many of those they bought on. One figure would
                            hide whichever the reader needed. */}
                        <span className="text-body-sm font-semibold tabular-nums text-text-primary">
                          {client.leadCount}
                        </span>
                        {client.leadCount > 1 && (
                          <span className="ml-1.5 text-caption text-text-secondary">
                            enquiries
                          </span>
                        )}
                        {client.wonCount > 0 && (
                          <span className="mt-0.5 block text-micro text-text-secondary tabular-nums">
                            {client.wonCount} won
                          </span>
                        )}
                      </Td>

                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {client.projects.map((name) => (
                            <Badge key={name} token="chart-1" size="sm" dot={false}>
                              {name}
                            </Badge>
                          ))}
                        </span>
                      </Td>

                      <Td>
                        <Stamp iso={client.firstLeadAt} nowMs={nowMs} />
                      </Td>

                      <Td>
                        <Stamp iso={client.convertedAt} nowMs={nowMs} />
                      </Td>

                      <Td>
                        {/* ⚠️ LINKS, NOT ACTIONS — the same rule as the desk. A
                            `tel:` hands the number to the device and records
                            nothing; logging belongs on the lead, where the
                            timeline is. */}
                        <span className="flex items-center gap-1.5">
                          {client.phoneE164 ? (
                            <>
                              <Reach href={`tel:${client.phoneE164}`}>Call</Reach>
                              {wa && (
                                <Reach href={`https://wa.me/${wa}`} external>
                                  WhatsApp
                                </Reach>
                              )}
                            </>
                          ) : (
                            <span className="text-caption text-text-secondary">No number</span>
                          )}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ⚠️ IT NAMES THE EXACT ACTION THAT FILLS THIS PAGE. "No clients yet" on its own
 * reads as a screen that is broken or a feature that is unfinished; saying which
 * control creates one makes it a state rather than a fault.
 */
function Empty() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nobody has become a client yet</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="text-body-sm leading-relaxed text-text-secondary">
          A lead becomes a client the moment somebody moves it to{' '}
          <strong className="text-text-primary">Won</strong> on the lead desk — which means they
          committed: a quotation accepted, a deposit paid, or work started.
        </p>
        <p className="text-caption leading-relaxed text-text-secondary">
          Nothing else creates one, and there is no separate button to press. If the same person
          enquires twice and both are won, they stay one client with two enquiries.
        </p>
      </CardBody>
    </Card>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function Stamp({ iso, nowMs }: { iso: string | null; nowMs: number }) {
  if (!iso) return <span className="text-caption text-text-secondary">—</span>;

  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
      /* ⚠️ Secondary, not tertiary — 3.94:1 measured in light. This is the
         cell's value, not an aside. */
      className="text-caption text-text-secondary"
    >
      {relativeAge(iso, nowMs)}
    </time>
  );
}

function Reach({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="rounded-lg border border-border-subtle px-2 py-1 text-micro font-medium text-text-primary transition-colors hover:border-border-default hover:bg-bg-subtle"
    >
      {children}
    </a>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-text-disabled">
      ·
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2.5 text-caption font-medium text-text-secondary">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="max-w-[16rem] px-3 py-2.5 align-top">{children}</td>;
}
