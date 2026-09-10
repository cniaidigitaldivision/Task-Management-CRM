import * as React from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { CrmSalesPerson } from '@/lib/db/queries/crm-leads';
import { responseBand, responseTime } from '@/lib/domain/crm-stages';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE SALES TEAM — Step 7b of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-10: *"The manager can see: who the person is on which lead, who
 * is responsible for which lead, how they are responding… how instantly they are
 * replying or engaging with the client."*
 *
 * ── ⚠️ A TABLE, NOT A CHART, AND THAT IS A DECISION ────────────────────────
 * Three people and four measures each. A grouped bar chart of that is four
 * colours carrying no meaning, and the reader still has to look up the numbers.
 * The one thing genuinely COMPARED across people is the workload, so that gets a
 * bar — one hue, more-is-longer — and everything else is a figure in a column.
 *
 * ⚠️ THE BAR IS A FILL AND THE TEXT IS INK. `--chart-1` and its family are chart
 * FILLS: measured as text they run 2.8–3.8:1 on white and fail WCAG in light
 * theme while passing in dark, which is why nobody catches it in review. Bars,
 * dots and ring segments have no contrast requirement; every number and label
 * here wears a text token instead.
 *
 * ── ⚠️ AND IT REFUSES TO COMPUTE A RATE FROM NOTHING ───────────────────────
 * No lead has ever been closed. A "conversion %" column would read 0% for
 * everybody, which looks like a fact about the salespeople and is a fact about
 * the calendar. Counts only, until there are outcomes — the same rule
 * `07-AI-PLAN.md` sets for scoring.
 * ========================================================================= */

export function SalesTeamPanel({
  team,
  nowMs,
}: {
  team: readonly CrmSalesPerson[];
  nowMs: number;
}) {
  if (team.length === 0) return null;

  /* The bar is proportional to the busiest person, not to a fixed ceiling — the
     question is "who is carrying more", and a scale nobody reaches would make
     every bar a stub. */
  const busiest = Math.max(1, ...team.map((p) => p.openLeads));

  const anyCalls = team.some((p) => p.medianResponseMinutes !== null);
  const anyWon = team.some((p) => p.wonLeads > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>The sales team</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <Th>Who</Th>
                <Th>Open leads</Th>
                {anyWon && <Th>Won</Th>}
                <Th>Usually answers in</Th>
                <Th>Last given a lead</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((person) => {
                const answers = responseTime(person.medianResponseMinutes);
                const band = responseBand(person.medianResponseMinutes);

                return (
                  <tr key={person.id} className="border-b border-border-subtle last:border-b-0">
                    <Td>
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={person.name} src={person.avatarUrl ?? undefined} size="xs" />
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm text-text-primary">
                            {person.name}
                          </span>
                          {person.isManager && (
                            <span className="block text-micro text-text-secondary">
                              Manager — not in the rota
                            </span>
                          )}
                        </span>
                      </span>
                    </Td>

                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-right text-body-sm font-semibold tabular-nums text-text-primary">
                          {person.openLeads}
                        </span>
                        {/* ⚠️ NO BAR AT ALL FOR ZERO, not a minimum-width stub.
                            A 2px mark against 0 reads as a small quantity, which
                            is a different fact from holding nothing — and the
                            manager legitimately sits at zero.

                            ⚠️ `aria-hidden`: the number beside it is the value,
                            and a screen reader announcing a bar twice is noise. */}
                        {person.openLeads > 0 && (
                          <span
                            aria-hidden="true"
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.max(4, Math.round((person.openLeads / busiest) * 100))}%`,
                              maxWidth: '7rem',
                              backgroundColor: person.isManager
                                ? 'var(--neutral-500)'
                                : 'var(--chart-1)',
                            }}
                          />
                        )}
                      </span>
                      {person.totalLeads > person.openLeads && (
                        <span className="mt-0.5 block text-micro text-text-secondary tabular-nums">
                          {person.totalLeads} in all
                        </span>
                      )}
                    </Td>

                    {anyWon && (
                      <Td>
                        <span className="text-body-sm tabular-nums text-text-primary">
                          {person.wonLeads}
                        </span>
                      </Td>
                    )}

                    <Td>
                      {answers ? (
                        <span
                          className={cn(
                            'text-body-sm tabular-nums',
                            /* ⚠️ `money-*`, NOT `feedback-*`. This was written
                               with `feedback-success` and measured at **3.77:1
                               in light** against a 4.5 floor — passing in dark,
                               which is why review would not have caught it. It
                               is the same trap as the chart tokens: those hues
                               are FILLS. The `money-*` family exists precisely
                               for coloured FIGURES, mapping to darkened hues in
                               light and back in dark — measured 5.48 / 8.40 and
                               6.47 / 5.84. */
                            band === 'slow'
                              ? 'font-semibold text-[var(--money-out)]'
                              : band === 'fast'
                                ? 'text-[var(--money-in)]'
                                : 'text-text-primary',
                          )}
                        >
                          {answers}
                        </span>
                      ) : (
                        /* ⚠️ NOT "0m". Null means nobody has logged a call yet,
                           and a zero would read as answering instantly. */
                        <span className="text-caption text-text-secondary">No calls yet</span>
                      )}
                    </Td>

                    <Td>
                      {person.lastGivenAt ? (
                        <time
                          dateTime={person.lastGivenAt}
                          title={new Date(person.lastGivenAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Karachi',
                          })}
                          className="text-caption text-text-secondary"
                        >
                          {relativeAge(person.lastGivenAt, nowMs)}
                        </time>
                      ) : (
                        <span className="text-caption text-text-secondary">Never</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── ⚠️ WHAT THE NUMBERS DO NOT YET SAY ────────────────────────────
            The owner asked to be able to tell "is it the staff or the campaign".
            Answering that needs closed leads, and there are none. Saying so is
            what stops somebody reading an empty Won column as poor performance
            rather than as a pipeline three weeks old. */}
        {!anyCalls && (
          <p className="mt-3 text-caption leading-relaxed text-text-secondary">
            Nobody has logged a call yet, so there are no response times to compare. They fill in
            from the moment somebody presses <strong>Spoke to them</strong> or{' '}
            <strong>No answer</strong> on a lead.
          </p>
        )}
        {anyCalls && !anyWon && (
          <p className="mt-3 text-caption leading-relaxed text-text-secondary">
            No lead has been closed yet, so there is nothing to compare on outcome — only on
            workload and how quickly people answer.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-2 py-2 text-caption font-medium text-text-secondary">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2.5 align-top">{children}</td>;
}
