'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';

import { recordOutcomeAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import { LOST_REASONS, STAGE_ORDER, lostReasonLabel, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import {
  OUTCOME_OPTIONS,
  outcomeImpact,
  outcomeLabel,
  outcomeProblems,
  outcomeRequires,
  outcomeToken,
  suggestStage,
} from '@/lib/domain/crm-outcomes';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RECORD OUTCOME — the form behind the stage dropdown
 * ----------------------------------------------------------------------------
 * The owner's Phase 1 form: current stage · outcome · recommended next stage ·
 * notes · next action · date and time · channel · pause the sequence · impact.
 *
 * ── ⚠️ THE OUTCOME IS THE FIRST QUESTION, NOT THE STAGE ────────────────────
 * The stage dropdown on the row opens this, and it is deliberately not a stage
 * picker. "What happened?" is the question somebody can answer immediately after
 * a call; "which stage is this now?" is a question about a funnel they did not
 * design. The outcome then RECOMMENDS a stage, which they can override.
 *
 * ── ⚠️ AND IT NEVER RECOMMENDS GOING BACKWARDS ─────────────────────────────
 * A lead in negotiation who says "interested" stays in negotiation. The
 * suggestion is `qualified`, which is behind them, and taking it would undo work
 * somebody recorded by hand. `suggestStage` is where that lives.
 *
 * ── ⚠️ THE RULES ARE SHOWN, THEN ENFORCED AGAIN ON THE SERVER ──────────────
 * What is here is a courtesy — so nobody is told "no" after writing a paragraph.
 * The rule itself is `outcomeProblems` on the server, plus two database
 * constraints (155) that cannot be talked out of.
 * ========================================================================= */

export function RecordOutcome({
  leadId,
  leadName,
  currentStage,
}: {
  leadId: string;
  leadName: string;
  currentStage: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();

  const [outcome, setOutcome] = React.useState<string>('client_replied');
  const [stage, setStage] = React.useState<string>(() => suggestStage('client_replied', currentStage));
  /* ⚠️ Once somebody picks a stage by hand, the outcome stops overruling it —
      otherwise changing the outcome silently undoes their choice. */
  const [stageTouched, setStageTouched] = React.useState(false);
  const [nextAction, setNextAction] = React.useState('');
  const [nextActionType, setNextActionType] = React.useState('call');
  const [nextActionAt, setNextActionAt] = React.useState('');
  const [lostReason, setLostReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [contactConfirmed, setContactConfirmed] = React.useState(false);
  const [pauseSequence, setPauseSequence] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const pickOutcome = (next: string) => {
    setOutcome(next);
    if (!stageTouched) setStage(suggestStage(next, currentStage));
  };

  const needs = outcomeRequires(outcome);
  const closing = stage === 'won' || stage === 'lost';

  const problems = outcomeProblems({
    outcome,
    stage,
    nextActionAt: nextActionAt || null,
    nextAction,
    lostReason: lostReason || null,
    contactConfirmed,
  });

  const close = () => {
    const next = new URLSearchParams(search.toString());
    next.delete('action');
    router.push(`/my-leads?${next.toString()}` as Route);
  };

  async function save() {
    setBusy(true);
    const result = await recordOutcomeAction(leadId, {
      outcome,
      stage,
      nextAction,
      nextActionType: closing ? null : nextActionType,
      nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
      lostReason: stage === 'lost' ? lostReason || null : null,
      note,
      contactConfirmed,
      pauseSequence,
    });
    setBusy(false);

    if (!result.ok) {
      /* ⚠️ The form stays open and keeps everything typed. The owner's standing
         rule since the team forms: *"I don't need to enter it again and again."* */
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    toast({ tone: 'ok', text: `Recorded — ${leadName} is now ${stageLabel(stage)}.` });
    close();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={close}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record what happened with ${leadName}`}
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">What happened?</h2>
            <p className="mt-0.5 truncate text-caption text-text-secondary">
              {leadName} · currently {stageLabel(currentStage)}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cancel"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── The outcome ───────────────────────────────────────────── */}
          <fieldset>
            <legend className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              The outcome
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOME_OPTIONS.map((o) => {
                const on = outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pickOutcome(o.value)}
                    aria-pressed={on}
                    className="rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors"
                    style={
                      on
                        ? {
                            backgroundColor: `color-mix(in oklab, var(--${outcomeToken(o.value)}) 16%, transparent)`,
                            borderColor: `var(--${outcomeToken(o.value)})`,
                            color: `var(--${outcomeToken(o.value)})`,
                          }
                        : { borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {/* ⚠️ WHAT PRESSING SAVE WILL DO, in a sentence, before it is
                pressed. The owner's spec calls it the impact summary, and it is
                the difference between a form somebody trusts and one they test
                on a lead they do not care about. */}
            <p className="mt-2 text-caption leading-relaxed text-text-secondary">
              {outcomeImpact(outcome)}
            </p>
          </fieldset>

          {/* ── The stage ─────────────────────────────────────────────── */}
          <label className="block">
            <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              Stage
              {!stageTouched && stage !== currentStage && (
                <span className="ml-1 font-normal normal-case text-text-secondary">
                  · suggested by the outcome
                </span>
              )}
            </span>
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setStageTouched(true);
              }}
              className="min-h-[2.4rem] w-full rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary"
              style={{ color: `var(--${stageToken(stage)})` }}
            >
              {STAGE_ORDER.map((st) => (
                <option key={st} value={st}>
                  {stageLabel(st)}
                </option>
              ))}
            </select>
          </label>

          {stage === 'lost' && (
            <label className="block">
              <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                Why was it lost?
              </span>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="min-h-[2.4rem] w-full rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary"
              >
                <option value="">Choose a reason…</option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {lostReasonLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {needs.includes('contact_check') && (
            <label className="flex items-start gap-2 rounded-lg border border-gold-700/40 bg-[color-mix(in_oklab,var(--gold-700)_8%,transparent)] px-3 py-2.5">
              <input
                type="checkbox"
                checked={contactConfirmed}
                onChange={(e) => setContactConfirmed(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border-default"
              />
              <span className="text-caption leading-relaxed text-text-primary">
                I checked the number against what they typed. ⚠️ A mistyped digit looks exactly
                like a wrong number, and closing the lead hides a real person.
              </span>
            </label>
          )}

          {/* ── What happens next ─────────────────────────────────────── */}
          {!closing && (
            <fieldset className="space-y-3 rounded-xl border border-border-subtle px-3 py-3">
              <legend className="px-1 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                What happens next
              </legend>

              <input
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="Call back about the corner plot"
                className="min-h-[2.4rem] w-full rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary"
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  aria-label="How"
                  value={nextActionType}
                  onChange={(e) => setNextActionType(e.target.value)}
                  className="min-h-[2.4rem] rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary"
                >
                  <option value="call">Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="meeting">Meeting</option>
                  <option value="site_visit">Site visit</option>
                  <option value="task">Task</option>
                </select>
                <input
                  type="datetime-local"
                  aria-label="When"
                  value={nextActionAt}
                  onChange={(e) => setNextActionAt(e.target.value)}
                  className="min-h-[2.4rem] rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary"
                />
              </div>
            </fieldset>
          )}

          <label className="block">
            <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              Note
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What was said, in your own words."
              className="w-full rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 text-body-sm text-text-primary"
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={pauseSequence}
              onChange={(e) => setPauseSequence(e.target.checked)}
              className="size-4 rounded border-border-default"
            />
            <span className="text-caption text-text-secondary">
              Pause any running sequence
            </span>
          </label>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-feedback-error/40 bg-[color-mix(in_oklab,var(--feedback-error)_7%,transparent)] px-3 py-2">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-caption text-text-primary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-feedback-error" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="min-h-[2.4rem] rounded-xl px-3 text-body-sm font-medium text-text-secondary hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || problems.length > 0}
            className={cn(
              'min-h-[2.4rem] rounded-xl bg-accent-primary px-4 text-body-sm font-medium text-white transition-opacity',
              (busy || problems.length > 0) && 'opacity-40',
            )}
          >
            {busy ? 'Saving…' : `Record ${outcomeLabel(outcome).toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
