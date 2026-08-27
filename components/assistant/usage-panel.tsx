'use client';

import * as React from 'react';
import { ChevronRight, MessageSquare, Wallet } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { AskedQuestion, UsageLine } from '@/lib/db/queries/assistant';

/* ============================================================================
 * WHAT IT IS USED FOR, AND WHAT IT COSTS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"Mention me in usage if it is possible, or somewhere I
 * can see the history. Also what people are searching for — usage is very
 * important because maybe one person uses all the credits and someone didn't
 * use it so I should have some check and balance."*
 *
 * ── ⚠️ THE SPEND FIGURES ARE NOW FOR EVERYBODY, AND THAT IS NEW ────────────
 * The first version of this panel could only show the reader's OWN cost, and
 * said so at length. That was migration 069's history rule leaking into a place
 * it was never aimed at: token counts live on the ANSWER row, answers are
 * private to the asker, so an Admin's "usage" screen reported one person.
 *
 * Migration 072 separates the two ideas — what an answer SAID stays private,
 * what it COST does not — with a SECURITY DEFINER function that returns
 * aggregates and no text. So `spend` below covers the whole division and the
 * apology is gone.
 *
 * ── ⚠️ `asks` AND `spend` WILL NOT ALWAYS AGREE, AND THAT IS INFORMATION ───
 * `asks` counts questions; `spend` counts answers. A question the model failed
 * to answer has no answer row, so it is an ask that cost nothing. The gap is
 * shown rather than reconciled — it is how a run of timeouts becomes visible on
 * a screen somebody actually looks at.
 * ========================================================================= */

export interface UsagePerson {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly roleTitle: string | null;
}

export function UsagePanel({
  asks,
  spend,
  mine,
  questions,
  rangeLabel,
  onInspect,
}: {
  asks: readonly UsageLine[];
  spend: readonly UsageLine[];
  mine: readonly UsageLine[];
  questions: readonly AskedQuestion[];
  rangeLabel: string;
  onInspect: (person: UsagePerson) => void;
}) {
  const totalAsks = asks.reduce((sum, line) => sum + line.asks, 0);
  const totalSpend = spend.reduce((sum, line) => sum + line.costUsd, 0);
  const totalAnswers = spend.reduce((sum, line) => sum + line.asks, 0);
  const totalTokens = spend.reduce(
    (sum, line) => sum + line.promptTokens + line.completionTokens,
    0,
  );
  const myCost = mine.reduce((sum, line) => sum + line.costUsd, 0);

  const busiest = Math.max(1, ...asks.map((line) => line.asks));
  const dearest = Math.max(0.000001, ...spend.map((line) => line.costUsd));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
      {/* ── Who is asking ───────────────────────────────────────────────────
          The owner's reference design: a feed of real questions with the asker
          on each line and a way into the detail.

          ⚠️ THE QUESTION IS THE HEADLINE, not the name. "What tools are over
          budget this month?" is what tells an owner whether this feature earns
          its keep; who typed it is context. A list sorted and titled the other
          way round reads as surveillance and answers a question nobody asked. */}
      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle>Who is asking</CardTitle>
            <CardDescription>
              {totalAsks} {totalAsks === 1 ? 'question' : 'questions'} · {rangeLabel}
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody className="px-0 py-0">
          {questions.length === 0 ? (
            <p className="px-5 py-12 text-center text-caption text-text-tertiary">
              Nobody has asked the assistant anything yet.
            </p>
          ) : (
            /* ── ⚠️ THE FEED SCROLLS INSIDE ITSELF ─────────────────────────
                Measured on real data: forty questions made this card 1,150px
                tall, the column beside it ended at 340px, and the page was two
                thirds empty space with a wall of near-identical lines in it.

                A cap plus an inner scroll keeps the two columns roughly in
                proportion and puts the newest questions — the ones somebody is
                actually here to read — at the top of a box rather than at the
                top of a very long page. `overscroll-contain` stops a scroll
                that reaches the end from carrying on into the page. */
            <ul className="max-h-[34rem] divide-y divide-border-subtle overflow-y-auto overscroll-contain">
              {questions.map((question) => (
                <li key={question.id}>
                  {/* ⚠️ The whole row is the control, not a chevron at the end
                      of it. A 4px target beside a 60px row is the sort of thing
                      that tests fine with a mouse and is unusable on a laptop
                      trackpad in a hurry. */}
                  <button
                    type="button"
                    onClick={() =>
                      onInspect({
                        id: question.askedById,
                        fullName: question.askedBy,
                        avatarUrl: question.avatarUrl,
                        roleTitle: question.roleTitle,
                      })
                    }
                    className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-bg-surface-hover"
                  >
                    <Avatar name={question.askedBy} src={question.avatarUrl} size="sm" />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-text-primary">
                        <span className="font-semibold">{question.askedBy}</span>{' '}
                        <span className="text-text-tertiary">asked:</span> {question.content}
                      </span>
                      <span className="mt-0.5 block text-micro text-text-tertiary">
                        {shortWhen(question.createdAt)}
                        {question.roleTitle && ` · ${question.roleTitle}`}
                      </span>
                    </span>

                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-border-subtle px-5 py-3 text-micro text-text-tertiary">
            Open a line to see everything that person has asked. Their answers stay with them.
          </p>
        </CardBody>
      </Card>

      <div className="space-y-5">
        {/* ── The money ─────────────────────────────────────────────────────
            ⚠️ FOUR DECIMAL PLACES ON A PERSON, TWO ON THE TOTAL. A single
            question costs around $0.015, so a per-person figure rounded to
            cents reads $0.02 for everybody and the comparison the owner came
            here to make — who is spending it — becomes invisible. The total is
            a real sum of money and belongs in cents. */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-accent-primary" aria-hidden="true" />
                Spend
              </CardTitle>
              <CardDescription>{rangeLabel}</CardDescription>
            </div>
          </CardHeader>

          <CardBody className="space-y-3">
            <div>
              <p className="tabular text-h1 leading-none font-bold text-text-primary">
                ${totalSpend.toFixed(2)}
              </p>
              <p className="mt-1.5 text-micro text-text-tertiary">
                {totalAnswers} {totalAnswers === 1 ? 'answer' : 'answers'} ·{' '}
                {totalTokens.toLocaleString('en-PK')} tokens
                {/* Only worth saying when it is not the whole figure. */}
                {spend.length > 1 && ` · yours $${myCost.toFixed(2)}`}
              </p>
            </div>

            {spend.length === 0 ? (
              <p className="text-caption text-text-tertiary">
                Nothing has been answered in this period, so nothing was charged.
              </p>
            ) : (
              <ul className="space-y-2">
                {spend.map((line) => (
                  <li key={line.userId}>
                    <button
                      type="button"
                      onClick={() =>
                        onInspect({
                          id: line.userId,
                          fullName: line.fullName,
                          avatarUrl: line.avatarUrl,
                          roleTitle: line.roleTitle,
                        })
                      }
                      className="group flex w-full items-center gap-2.5 text-left"
                    >
                      <Avatar name={line.fullName} src={line.avatarUrl} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-micro text-text-secondary group-hover:text-text-primary">
                          {line.fullName}
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-bg-surface-sunken">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${(line.costUsd / dearest) * 100}%`,
                              backgroundColor: 'var(--money-out)',
                            }}
                          />
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-micro font-semibold text-text-primary">
                        ${line.costUsd.toFixed(4)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ── The volume ────────────────────────────────────────────────────
            Separate from the money on purpose. Somebody can ask twice as much
            and cost half as much — short questions against small tools — and
            one bar chart carrying both numbers would hide exactly that. */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-accent-primary" aria-hidden="true" />
                Questions per person
              </CardTitle>
              <CardDescription>{rangeLabel}</CardDescription>
            </div>
          </CardHeader>

          <CardBody>
            {asks.length === 0 ? (
              <p className="text-caption text-text-tertiary">
                Nobody has asked anything in this period.
              </p>
            ) : (
              <ul className="space-y-2">
                {asks.map((line) => (
                  <li key={line.userId}>
                    <button
                      type="button"
                      onClick={() =>
                        onInspect({
                          id: line.userId,
                          fullName: line.fullName,
                          avatarUrl: line.avatarUrl,
                          roleTitle: line.roleTitle,
                        })
                      }
                      className="group flex w-full items-center gap-2.5 text-left"
                    >
                      <Avatar name={line.fullName} src={line.avatarUrl} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-micro text-text-secondary group-hover:text-text-primary">
                          {line.fullName}
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-bg-surface-sunken">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${(line.asks / busiest) * 100}%`,
                              backgroundColor: 'var(--accent-primary)',
                            }}
                          />
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-micro font-semibold text-text-primary">
                        {line.asks}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* ⚠️ Shown only when the two counts actually differ. A line saying
                "0 went unanswered" on every screen is noise that trains people
                to stop reading the place the real warning will appear. */}
            {totalAsks > totalAnswers && (
              <p className="mt-3 border-t border-border-subtle pt-2.5 text-micro text-text-secondary">
                {totalAsks - totalAnswers} of these got no answer — the model failed or timed
                out. They cost nothing.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `26 Aug, 14:32`.
 *
 * ⚠️ Formatted from the ISO parts rather than through `toLocaleString`, which
 * would render differently on the server and in the browser and trip a
 * hydration mismatch — the same reason every money helper in this codebase pins
 * its locale.
 */
function shortWhen(iso: string): string {
  const [date, time = ''] = iso.split('T');
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}, ${time.slice(0, 5)}`;
}
