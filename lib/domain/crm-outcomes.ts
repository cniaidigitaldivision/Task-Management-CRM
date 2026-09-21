/* ============================================================================
 * WHAT HAPPENED, AND WHAT IT MEANS FOR THE STAGE
 * ----------------------------------------------------------------------------
 * The owner's eight outcomes, and the rules that go with them (Phase 1 spec).
 *
 * ── ⚠️ THE STAGE IS RECOMMENDED, NEVER IMPOSED ─────────────────────────────
 * "Interested" usually means `qualified` — but a lead already in `negotiation`
 * who says they are interested has not gone backwards, and a CRM that demoted
 * them would be rewriting a salesperson's own judgement. So `suggestStage`
 * returns a suggestion the form pre-selects and the person can change.
 *
 * ⚠️ AND IT NEVER SUGGESTS MOVING BACKWARDS. `STAGE_ORDER` is a sequence, so
 * "further along" is comparable — and the one thing a suggestion must not do is
 * quietly undo progress somebody recorded by hand.
 * ========================================================================= */

import { STAGE_ORDER, type CrmStage } from './crm-stages';

export const OUTCOMES = [
  'client_replied',
  'no_response',
  'interested',
  'not_interested',
  'wrong_contact',
  'call_later',
  'site_visit_requested',
  'booking_confirmed',
] as const;

export type CrmOutcome = (typeof OUTCOMES)[number];

interface OutcomeMeta {
  readonly label: string;
  /** What the form should pre-select as the next stage, when it is an advance. */
  readonly suggests: CrmStage | null;
  /** A design token for the chip. */
  readonly token: string;
  /** What the form must collect before this outcome may be recorded. */
  readonly requires: ReadonlyArray<'time' | 'reason' | 'contact_check' | 'booking'>;
  /** Said on the form, so somebody knows what pressing it will do. */
  readonly impact: string;
}

const META: Record<CrmOutcome, OutcomeMeta> = {
  client_replied: {
    label: 'Client replied',
    suggests: 'qualified',
    token: 'feedback-success',
    requires: [],
    impact: 'Pauses any running sequence — they are talking, so an automated chase would talk over them.',
  },
  no_response: {
    label: 'No response',
    suggests: null,
    token: 'neutral-500',
    /* 2026-09-21 · no longer asks for a time: this form schedules nothing. */
    requires: [],
    impact: 'Keeps the stage as it is. Any running sequence carries on unless you pause it.',
  },
  interested: {
    label: 'Interested',
    suggests: 'qualified',
    token: 'feedback-success',
    requires: [],
    impact: 'Moves them to Qualified unless they are already further along.',
  },
  not_interested: {
    label: 'Not interested',
    suggests: 'lost',
    token: 'feedback-error',
    requires: ['reason'],
    impact: 'Closes the lead as Lost and stops every sequence. A reason is required.',
  },
  wrong_contact: {
    label: 'Wrong contact',
    suggests: 'lost',
    token: 'feedback-error',
    requires: ['reason', 'contact_check'],
    impact: 'Closes the lead. ⚠️ Confirm the number first — a mistyped digit looks exactly like a wrong number.',
  },
  call_later: {
    label: 'Call later',
    suggests: null,
    token: 'accent-primary',
    requires: ['time'],
    impact: 'Keeps the stage and books the callback. A time is required — that is the whole outcome.',
  },
  site_visit_requested: {
    label: 'Site visit requested',
    suggests: 'visit_scheduled',
    token: 'chart-1',
    requires: ['time'],
    impact: 'Moves them to Visit scheduled and books the appointment.',
  },
  booking_confirmed: {
    label: 'Booking confirmed',
    suggests: 'won',
    token: 'feedback-success',
    requires: ['booking'],
    impact: 'Closes the lead as Won and stops every sequence.',
  },
};

export function outcomeLabel(outcome: string): string {
  return META[outcome as CrmOutcome]?.label ?? outcome;
}

export function outcomeToken(outcome: string): string {
  return META[outcome as CrmOutcome]?.token ?? 'neutral-500';
}

export function outcomeImpact(outcome: string): string {
  return META[outcome as CrmOutcome]?.impact ?? '';
}

export function outcomeRequires(outcome: string): OutcomeMeta['requires'] {
  return META[outcome as CrmOutcome]?.requires ?? [];
}

/**
 * The stage this outcome suggests, given where the lead already is.
 *
 * ⚠️ NEVER BACKWARDS. A lead in `negotiation` who says "interested" stays in
 * negotiation — the suggestion is `qualified`, which is behind them, and taking
 * it would undo work somebody did by hand.
 *
 * ⚠️ EXCEPT THE TWO EXITS. `won` and `lost` are not "further along", they are
 * out — and "not interested" has to be able to close a lead from anywhere.
 */
export function suggestStage(outcome: string, current: string): string {
  const wanted = META[outcome as CrmOutcome]?.suggests;
  if (!wanted) return current;
  if (wanted === 'won' || wanted === 'lost') return wanted;

  const at = STAGE_ORDER.indexOf(current as CrmStage);
  const to = STAGE_ORDER.indexOf(wanted);
  /* An unknown current stage (a retired one) has index -1; treat the suggestion
     as an advance rather than refusing to move at all. */
  return to > at ? wanted : current;
}

/** Every outcome, for the form. */
export const OUTCOME_OPTIONS = OUTCOMES.map((value) => ({
  value,
  label: META[value].label,
}));

/**
 * What the write path must refuse.
 *
 * ⚠️ RETURNED AS A LIST OF SENTENCES, not a boolean. A form that says "invalid"
 * makes somebody guess which field; each of these names the field and why.
 */
export function outcomeProblems(input: {
  outcome: string;
  stage: string;
  nextActionAt: string | null;
  nextAction: string | null;
  lostReason: string | null;
  contactConfirmed: boolean;
}): string[] {
  const problems: string[] = [];
  const needs = outcomeRequires(input.outcome);

  if (needs.includes('time') && !input.nextActionAt) {
    problems.push(
      input.outcome === 'call_later'
        ? 'Choose when to call back — that is what "call later" means.'
        : 'Choose the date and time of the visit.',
    );
  }

  if (needs.includes('reason') && !input.lostReason) {
    problems.push('Choose a reason. A lost lead with no reason teaches nobody anything.');
  }

  if (needs.includes('contact_check') && !input.contactConfirmed) {
    problems.push(
      'Confirm you checked the number. A mistyped digit looks exactly like a wrong number, and closing the lead hides a real person.',
    );
  }

  /* ── ⚠️ NO NEXT ACTION IS ASKED FOR, EVER ──────────────────────────────────
     It began as *"every open lead should leave the form with a next action"*,
     was relaxed on 2026-09-19 to "unless something is already planned", and on
     2026-09-21 the owner removed it outright, recording a visit as done:

       *"I explicitly told you to exclude all next steps. Just one pause in the
       active sequence is fine but this next action, like 'schedule follow-up'
       or 'add a task,' are the only things that should not be added. This is
       just to update the visit scheduler or this type of thing."*

     Follow-ups are scheduled in the follow-up wizard. This form records what
     happened and moves the stage — and asks for a time only where the time IS
     the outcome: a callback, or a visit being booked. */
  return problems;
}
