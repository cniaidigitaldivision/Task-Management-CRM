'use client';

import * as React from 'react';
import { Sparkles, RefreshCw, Copy, Check } from 'lucide-react';

import { readLeadWithAiAction } from '@/app/actions/crm-lead-ai';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadInsight } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * WHAT THE MODEL MADE OF THIS LEAD — Step 11
 * ----------------------------------------------------------------------------
 * ⚠️ IT SAYS IT IS A SUGGESTION, EVERY TIME. `07-AI-PLAN.md`: *"Must be
 * labelled as a suggestion. A script presented as fact makes a junior
 * salesperson sound like a robot."* The line under the title is not decoration.
 *
 * ⚠️ AND THE DRAFT IS COPIED, NEVER SENT. There is no send button here and
 * there will not be one until there is a track record: *"One bad generated
 * message goes to a real client under the division's name."* Copy, read it,
 * paste it, change it.
 * ========================================================================= */

export function LeadInsightPanel({
  leadId,
  insight,
}: {
  leadId: string;
  /** Null when nobody has asked yet. Costs nothing until somebody does. */
  insight: CrmLeadInsight | null;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function read() {
    setBusy(true);
    const result = await readLeadWithAiAction(leadId);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not work.' });
      return;
    }
    toast({ tone: 'ok', text: 'Read.' });
  }

  async function copyDraft() {
    if (!insight?.draftMessage) return;
    try {
      await navigator.clipboard.writeText(insight.draftMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: 'error', text: 'Could not copy — select the text instead.' });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-4" aria-hidden="true" />
                Before you call
              </span>
            </CardTitle>
            {/* ⚠️ The caveat is permanent, not a first-run hint. */}
            <p className="mt-1 text-caption text-text-secondary">
              Suggestions from what this person actually wrote. Read them, do not recite them.
            </p>
          </div>

          {insight && (
            <Button variant="ghost" size="sm" onClick={() => void read()} disabled={busy}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {busy ? 'Reading…' : 'Read again'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardBody>
        {!insight ? (
          <div className="py-2">
            <p className="text-body text-text-secondary">
              Nothing has been read yet for this lead.
            </p>
            <Button className="mt-3" size="sm" onClick={() => void read()} disabled={busy}>
              <Sparkles className="size-4" aria-hidden="true" />
              {busy ? 'Reading…' : 'Read this lead'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ⚠️ SAID PLAINLY WHEN IT IS STALE, rather than silently refreshed.
                Re-reading costs money, so it is the salesperson's call — but
                advice about a stage the lead has left is worse than none, and
                they can only judge that if they are told. */}
            {!insight.current && (
              <p className="rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2 text-caption text-text-secondary">
                This lead has changed since it was read. &ldquo;Read again&rdquo; for an
                up-to-date version.
              </p>
            )}

            <p className="text-body text-text-primary">{insight.summary}</p>

            {insight.talkingPoints.length > 0 && (
              <div>
                <p className="text-caption font-medium text-text-secondary">Worth opening with</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {insight.talkingPoints.map((point) => (
                    <li key={point} className="text-body text-text-primary">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insight.draftMessage && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-caption font-medium text-text-secondary">
                    A first message — yours to change
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => void copyDraft()}>
                    {copied ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {/* ⚠️ A TEXTAREA, NOT A PARAGRAPH — so it reads as a draft to be
                    edited rather than as a message that has been approved. */}
                <textarea
                  readOnly
                  value={insight.draftMessage}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2 text-body text-text-primary"
                />
              </div>
            )}

            <p className="text-caption text-text-tertiary">
              Read {new Date(insight.generatedAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })}
              {' · '}
              {insight.model}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
