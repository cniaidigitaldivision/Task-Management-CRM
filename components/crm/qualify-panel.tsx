'use client';

import * as React from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, Copy } from 'lucide-react';

import { saveQualificationAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord } from '@/lib/db/queries/crm-leads';
import {
  bantQuestions,
  paymentModeLabel,
  PAYMENT_MODES,
  qualificationGaps,
  qualificationStarted,
  suggestTemperature,
  type Bant,
} from '@/lib/domain/crm-qualification';
import { temperatureLabel } from '@/lib/domain/crm-stages';
import { cn } from '@/lib/utils';

/* ============================================================================
 * QUALIFY — the four things you must find out before spending money on somebody
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-16: *"I want to properly implement a BANT tester… when I want
 * to convert my status from contacted to qualified, I should know all these
 * things first."*
 *
 * ── ⚠️ THIS PANEL IS THE ONLY WAY THROUGH 167'S GATE ───────────────────────
 * The trigger refuses a lead reaching `qualified` — or anything past it — with
 * any of the four unanswered. So this is not a nice-to-have form: without it the
 * stage dropdown has an option that always fails.
 *
 * ── ⚠️ IT RECORDS ANSWERS; IT DOES NOT MOVE THE STAGE ──────────────────────
 * Two separate acts. A salesperson who learns the client is just browsing has
 * qualified them perfectly well, and marching them into `qualified` for it would
 * make the stage mean "somebody asked four questions".
 *
 * ── ⚠️ AND IT CARRIES THE WORDS TO SAY, NOT ONLY THE FIELDS TO FILL ────────
 * Each question shows the sentence to actually put to the client, copyable. A
 * form of four dropdowns tells a new salesperson what to record and nothing
 * about how to find it out — which is the part they do not yet know.
 * ========================================================================= */

export function QualifyPanel({ lead }: { lead: CrmLeadRecord }) {
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  const [draft, setDraft] = React.useState({
    budgetBand: lead.budgetBand ?? '',
    authority: lead.authority ?? '',
    purpose: lead.purpose ?? '',
    timeline: lead.timeline ?? '',
    paymentMode: lead.paymentMode ?? '',
    locationPreference: lead.locationPreference ?? '',
    qualificationNote: lead.qualificationNote ?? '',
    budget: lead.budget === null ? '' : String(lead.budget),
    temperature: lead.temperature ?? '',
  });

  /* ⚠️ SHUT BY DEFAULT, AND THE OWNER WAS RIGHT TO ASK FOR IT. This sat open on
     every lead, so four dropdowns and a textarea were the first thing anybody saw
     on a record they had opened to READ. Owner: *"Once I fill it, it is done…
     then it should be minimized and not show again. If I want to add it, then I
     can add it, but not all the time display them."*

     ⚠️ CLIENT STATE, SO IT OPENS IN THE CLICK'S OWN FRAME — Rule Zero. And it
     resets with the lead, below, so opening a colleague's record does not inherit
     a panel somebody left open on the last one. */
  const [open, setOpen] = React.useState(false);

  /* ⚠️ THE DRAFT FOLLOWS THE LEAD. The drawer is reused as somebody clicks from
     row to row, so state keyed to the component would show the last lead's
     answers against this one's name — which on a qualification form is not a
     cosmetic bug, it is recording the wrong person's budget. */
  const [seen, setSeen] = React.useState(lead.id);
  if (seen !== lead.id) {
    setSeen(lead.id);
    setOpen(false);
    setDraft({
      budgetBand: lead.budgetBand ?? '',
      authority: lead.authority ?? '',
      purpose: lead.purpose ?? '',
      timeline: lead.timeline ?? '',
      paymentMode: lead.paymentMode ?? '',
      locationPreference: lead.locationPreference ?? '',
      qualificationNote: lead.qualificationNote ?? '',
      budget: lead.budget === null ? '' : String(lead.budget),
      temperature: lead.temperature ?? '',
    });
  }

  const bant: Bant = {
    budgetBand: draft.budgetBand || null,
    authority: draft.authority || null,
    purpose: draft.purpose || null,
    timeline: draft.timeline || null,
  };
  /* ⚠️ THE QUESTION SET FOLLOWS THE LEAD, not the screen. An ERP enquiry is asked
     which service they want and what software budget they have; a plot enquiry is
     asked whether they are investing or building. The server decided which —
     `app.crm_lead_sells` — from the attached item, then the campaign, then the
     project. */
  const questions = bantQuestions((lead.sells as 'property' | 'service' | 'mixed') ?? 'property');
  const isService = lead.sells === 'service';

  const gaps = qualificationGaps(bant);
  const started = qualificationStarted(bant);
  const suggestion = started ? suggestTemperature(bant) : null;

  function save() {
    startTransition(async () => {
      const result = await saveQualificationAction({ leadId: lead.id, ...draft,
        budgetBand: draft.budgetBand || null,
        authority: draft.authority || null,
        purpose: draft.purpose || null,
        timeline: draft.timeline || null,
        paymentMode: draft.paymentMode || null,
        temperature: draft.temperature || null,
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error ?? 'That did not save.' });
        return;
      }
      /* ⚠️ A PARTIAL SAVE REPORTS ITSELF. The action returns ok WITH a sentence
         when the gate is still shut — telling somebody "saved" and letting them
         discover it at the stage dropdown is the worse of the two. */
      /* ⚠️ IT SHUTS ITSELF ONLY WHEN THE GATE IS OPEN. A partial save that
         collapsed would hide the two questions still outstanding, and somebody
         would meet them again at the stage dropdown instead. */
      if (!result.error) setOpen(false);
      toast({
        tone: result.error ? 'warn' : 'ok',
        text: result.error ?? 'Qualification recorded.',
      });
    });
  }

  return (
    <section aria-busy={pending} className={cn('transition-opacity', pending && 'opacity-60')}>
      {/* ⚠️ THE WHOLE HEADER IS THE TOGGLE, not a small chevron beside it. A
          disclosure whose target is a 16px arrow is one people miss. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 rounded-lg py-1 text-left hover:opacity-80"
      >
        <ChevronDown
          className={cn('size-4 shrink-0 text-text-secondary transition-transform', !open && '-rotate-90')}
          aria-hidden="true"
        />
        <h3 className="text-micro font-semibold uppercase tracking-wide text-text-secondary">
          Qualifying
        </h3>
        {/* ⚠️ SAYS WHICH KIND OF LEAD IT THINKS THIS IS. If the system has it
            wrong, the salesperson sees that before answering four questions
            against the wrong scale — and the fix is the campaign's own setting. */}
        <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-caption text-text-secondary">
          {isService ? 'Services lead' : 'Property lead'}
        </span>
        {/* ⚠️ "Not asked yet" ON AN UNTOUCHED LEAD, never "0 of 4" — a progress
            figure on something nobody has started reads as a failure rather than
            as work not yet done. */}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium',
            gaps.length === 0
              ? 'bg-feedback-success/15 text-feedback-success'
              : 'text-text-secondary',
          )}
        >
          {gaps.length === 0 ? (
            <>
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> Qualified
            </>
          ) : started ? (
            <>
              <CircleDashed className="size-3.5" aria-hidden="true" />
              {4 - gaps.length} of 4
            </>
          ) : (
            <>
              <CircleDashed className="size-3.5" aria-hidden="true" /> Not asked yet
            </>
          )}
        </span>
      </button>

      {/* ── Shut: the answers, on one line ─────────────────────────────────
          ⚠️ THE ANSWERS, NOT A COUNT. Somebody reading a record wants to know
          they are buying within a month on a 1–3 lakh budget; "4 of 4" tells
          them only that a form was filled in. */}
      {!open && (
        <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
          {started ? (
            questions
              .map((q) => q.labelOf(bant[q.field]))
              .filter(Boolean)
              .join(' · ')
          ) : (
            <>
              Nothing asked yet.{' '}
              <span className="text-text-primary">
                This lead cannot move past Contacted until it is.
              </span>
            </>
          )}
        </p>
      )}

      {open && gaps.length > 0 && (
        <p className="mb-2.5 mt-2 rounded-lg border border-dashed border-border-default px-3 py-2 text-caption leading-relaxed text-text-secondary">
          This lead cannot move past <strong className="text-text-primary">Contacted</strong> until
          all four are recorded. ⚠️ <em>Didn&rsquo;t find out</em> is a valid answer — never asking
          is not.
        </p>
      )}

      {open && (
      <div className="space-y-2.5">
        {questions.map((q) => (
          <div key={q.field}>
            <label
              htmlFor={`bant-${q.field}-${lead.id}`}
              className="flex flex-wrap items-baseline gap-1.5 text-caption font-medium text-text-primary"
            >
              <span className="rounded bg-bg-subtle px-1 font-semibold text-text-secondary">
                {q.letter}
              </span>
              {q.label}
            </label>

            {/* ⚠️ THE SENTENCE TO SAY, COPYABLE. The gap between a field label
                and a question you can put to a client is where scripts die, and
                a new salesperson does not yet know how to ask about budget
                without sounding like a form. */}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(q.ask).then(
                  () => toast({ tone: 'ok', text: 'Question copied.' }),
                  () => toast({ tone: 'error', text: 'Could not copy — select it by hand.' }),
                );
              }}
              className="mt-0.5 flex w-full items-start gap-1.5 rounded text-left text-caption italic text-text-secondary hover:text-text-primary"
            >
              <Copy className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>&ldquo;{q.ask}&rdquo;</span>
            </button>

            <select
              id={`bant-${q.field}-${lead.id}`}
              value={draft[q.field] as string}
              onChange={(e) => setDraft((d) => ({ ...d, [q.field]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">— not asked yet —</option>
              {q.options.map((o) => (
                <option key={o} value={o}>
                  {q.labelOf(o)}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`bant-pay-${lead.id}`}
              className="text-caption font-medium text-text-primary"
            >
              How would they pay?
            </label>
            <select
              id={`bant-pay-${lead.id}`}
              value={draft.paymentMode}
              onChange={(e) => setDraft((d) => ({ ...d, paymentMode: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">—</option>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {paymentModeLabel(m)}
                </option>
              ))}
            </select>
          </div>
          {/* ⚠️ ABSENT FOR A SERVICE LEAD, not relabelled. "Which block or area?"
              has no software meaning, and inventing a question to fill the space
              is how a form starts collecting noise. */}
          {!isService && (
            <div>
              <label
                htmlFor={`bant-loc-${lead.id}`}
                className="text-caption font-medium text-text-primary"
              >
                Which block or area?
              </label>
              <input
                id={`bant-loc-${lead.id}`}
                value={draft.locationPreference}
                onChange={(e) => setDraft((d) => ({ ...d, locationPreference: e.target.value }))}
                placeholder="Block A, near the park"
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
              />
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor={`bant-note-${lead.id}`}
            className="text-caption font-medium text-text-primary"
          >
            Anything they said in their own words
          </label>
          {/* ⚠️ THE OBJECTION VERBATIM. The nine lost reasons are for reporting;
              this is what lets a manager coach and a campaign be retargeted —
              "too far from his children's school" is not an enum value. */}
          <textarea
            id={`bant-note-${lead.id}`}
            rows={2}
            value={draft.qualificationNote}
            onChange={(e) => setDraft((d) => ({ ...d, qualificationNote: e.target.value }))}
            placeholder="Wants to be near the park. Worried about possession timing."
            className="mt-1 w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </div>

        {/* ── Temperature ───────────────────────────────────────────────────
            ⚠️ SUGGESTED, NEVER SET. The salesperson heard the call and this did
            not. The reasons are shown instead of a score, because somebody can
            disagree with a sentence and can only be asserted at by a number. */}
        <div>
          <label
            htmlFor={`bant-temp-${lead.id}`}
            className="text-caption font-medium text-text-primary"
          >
            How warm are they?
          </label>
          {suggestion && (
            <p className="mt-0.5 text-caption text-text-secondary">
              Suggests <strong className="text-text-primary">{temperatureLabel(suggestion.temperature)}</strong>
              {' — '}
              {suggestion.reasons.join(', ')}.
              {draft.temperature !== suggestion.temperature && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, temperature: suggestion.temperature }))}
                  className="ml-1.5 underline underline-offset-2 hover:text-text-primary"
                >
                  Use it
                </button>
              )}
            </p>
          )}
          <select
            id={`bant-temp-${lead.id}`}
            value={draft.temperature}
            onChange={(e) => setDraft((d) => ({ ...d, temperature: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
          >
            <option value="">— not set —</option>
            {(['hot', 'warm', 'cold'] as const).map((t) => (
              <option key={t} value={t}>
                {temperatureLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className={cn(
            'w-full rounded-lg bg-accent-primary px-3 py-2 text-body-sm font-semibold text-white transition-opacity',
            pending && 'opacity-40',
          )}
        >
          {pending ? 'Saving…' : 'Save what you found out'}
        </button>

        {lead.qualifiedAt && (
          <p className="text-caption text-text-secondary">
            Qualified {new Date(lead.qualifiedAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
            })}
          </p>
        )}
      </div>
      )}
    </section>
  );
}
