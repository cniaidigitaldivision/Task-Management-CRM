'use client';

import * as React from 'react';
import { Lightbulb, Loader2, Sparkles, TriangleAlert } from 'lucide-react';

import { recommendForTaskAction, type RecommendPayload } from '@/app/actions/recommend';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress';
import type { RecommendationFlag } from '@/lib/domain/recommendation';

/* ============================================================================
 * WHO SHOULD TAKE THIS — doc 07
 * ----------------------------------------------------------------------------
 * ── THE SCORE IS SHOWN WITH ITS WORKING ──────────────────────────────────────
 * Every row can be expanded into the six dimensions that produced it. A ranked
 * list with no explanation is an oracle, and an oracle is either obeyed without
 * thought or ignored entirely — both worse than a number somebody can argue
 * with. "Ranked first mostly on skills, but it would push them over their
 * limit" is a decision a Coordinator can actually make.
 *
 * ── AND IT REFUSES TO RANK WHEN RANKING IS USELESS ───────────────────────────
 * Below the floor it shows what to change instead of who to pick. Five people
 * all scoring 20 is not a choice, and presenting it as one is how a tool
 * teaches people to ignore it.
 * ========================================================================= */

const FLAG_LABEL: Record<RecommendationFlag, string> = {
  stretch: 'Stretch — none of the skills',
  over_soft: 'Would go over the warning line',
  over_hard: 'Would go over their limit',
  at_max_concurrent: 'At their task limit',
  unavailable: 'Away this week',
  new_to_team: 'New — judged neutrally',
};

const FLAG_TOKEN: Record<RecommendationFlag, string> = {
  stretch: 'feedback-warning',
  over_soft: 'feedback-warning',
  over_hard: 'feedback-error',
  at_max_concurrent: 'feedback-warning',
  unavailable: 'feedback-error',
  new_to_team: 'accent-secondary',
};

const DIMENSIONS: Array<{ key: keyof RecommendPayload['ranked'][number]['dimensions']; label: string }> = [
  { key: 'skill', label: 'Skills' },
  { key: 'availability', label: 'Room this week' },
  { key: 'deadlineFit', label: 'Time before due' },
  { key: 'fairness', label: 'Fair share' },
  { key: 'performance', label: 'Recent record' },
  { key: 'projectFamiliarity', label: 'Knows the project' },
];

export function RecommendPanel({
  taskId,
  currentAssigneeId,
  onPick,
  busy,
}: {
  taskId: string;
  currentAssigneeId: string | null;
  /** Hands the choice back — this panel never assigns anybody itself. */
  onPick: (userId: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<RecommendPayload | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setData(await recommendForTaskAction(taskId));
    setLoading(false);
  }, [taskId]);

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="md"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Who should take this?
      </Button>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border border-border-subtle bg-bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          Who should take this
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Hide
        </Button>
      </div>

      {loading && (
        <p className="flex items-center gap-1.5 text-micro text-text-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Scoring the team…
        </p>
      )}

      {data && !data.ok && <p className="text-micro text-text-tertiary">{data.error}</p>}

      {data?.ok && data.usedInference && (
        <p className="rounded-lg bg-bg-surface-sunken px-2.5 py-2 text-micro text-text-secondary">
          <Lightbulb
            className="mr-1 inline h-3.5 w-3.5 align-[-2px]"
            strokeWidth={2}
            aria-hidden="true"
          />
          No skills are tagged on this task, so it was scored as if it needs{' '}
          <span className="font-semibold text-text-primary">
            {data.inferred.map((i) => i.label).join(', ')}
          </span>
          , guessed from the wording. Tagging them properly makes this more accurate.
        </p>
      )}

      {data?.ok && data.noGoodMatch && (
        <div
          className="space-y-2 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-warning) 32%, transparent)',
          }}
        >
          <p className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
            <TriangleAlert
              className="h-3.5 w-3.5"
              style={{ color: 'var(--feedback-warning)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            No good match for this task
          </p>
          <p className="text-micro text-text-secondary">
            Nobody clears the usability floor. Picking the least bad person here is how a task
            arrives late and surprises everybody — these are the things that would actually help.
          </p>
          <ol className="space-y-1.5">
            {data.advice.map((item, index) => (
              <li key={item.kind} className="text-micro text-text-secondary">
                <span className="font-semibold text-text-primary">
                  {index + 1}. {item.title}
                </span>{' '}
                — {item.detail}
              </li>
            ))}
          </ol>
        </div>
      )}

      {data?.ok && data.ranked.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {data.ranked.slice(0, 5).map((person, index) => {
            const isOpen = expanded === person.userId;
            const isCurrent = person.userId === currentAssigneeId;

            return (
              <li key={person.userId} className="py-2">
                <div className="flex items-start gap-2.5">
                  <span className="tabular mt-1 w-4 shrink-0 text-micro font-semibold text-text-tertiary">
                    {index + 1}
                  </span>
                  <Avatar name={person.name} size="sm" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-caption font-semibold text-text-primary">
                        {person.name}
                      </span>
                      {isCurrent && (
                        <span className="text-micro text-text-tertiary">already assigned</span>
                      )}
                      <span className="tabular ml-auto text-caption font-semibold text-text-primary">
                        {Math.round(person.score)}
                      </span>
                    </div>

                    <ProgressBar
                      value={person.score}
                      token={
                        person.score >= 70
                          ? 'feedback-success'
                          : person.score >= 40
                            ? 'accent-primary'
                            : 'feedback-warning'
                      }
                      size="sm"
                    />

                    <p className="mt-1 text-micro text-text-secondary">{person.why}</p>

                    {person.flags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {person.flags.map((flag) => (
                          <Badge key={flag} token={FLAG_TOKEN[flag]} size="sm" variant="outline">
                            {FLAG_LABEL[flag]}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {isOpen && (
                      <dl className="mt-2 space-y-1 rounded-lg bg-bg-surface-sunken p-2.5">
                        {DIMENSIONS.map((dimension) => (
                          <div key={dimension.key} className="flex items-center gap-2">
                            <dt className="w-32 shrink-0 text-micro text-text-tertiary">
                              {dimension.label}
                            </dt>
                            <dd className="flex flex-1 items-center gap-2">
                              <ProgressBar
                                value={person.dimensions[dimension.key]}
                                token="accent-secondary"
                                size="sm"
                              />
                              <span className="tabular w-8 shrink-0 text-right text-micro text-text-secondary">
                                {Math.round(person.dimensions[dimension.key])}
                              </span>
                            </dd>
                          </div>
                        ))}
                        {person.penaltyPoints !== 0 && (
                          <p
                            className="pt-1 text-micro font-semibold"
                            style={{ color: 'var(--feedback-error)' }}
                          >
                            {person.penaltyPoints} for the flags above
                          </p>
                        )}
                        <p className="pt-1 text-micro text-text-tertiary">
                          Projected {person.projectedUtilisationPct}% of their week with this added.
                        </p>
                      </dl>
                    )}

                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : person.userId)}
                      >
                        {isOpen ? 'Hide the working' : 'Why?'}
                      </Button>
                      {!isCurrent && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => onPick(person.userId)}
                        >
                          Assign to {person.name.split(' ')[0]}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data?.ok && data.skillGaps.length > 0 && (
        <p className="text-micro text-text-tertiary">
          Nobody is rated 3 or above in{' '}
          <span className="font-semibold text-text-secondary">{data.skillGaps.join(', ')}</span>.
          When that keeps happening it is a hiring signal rather than a scheduling one.
        </p>
      )}

      <p className="text-micro text-text-tertiary">
        A suggestion, not a decision. The capacity rules still apply when you assign.
      </p>
    </section>
  );
}
