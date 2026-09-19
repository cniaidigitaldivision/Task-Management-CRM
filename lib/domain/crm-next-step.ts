/* ============================================================================
 * WHAT TO DO NEXT — suggested from the lead's own record
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-19: *"The next section should be something like AI
 * recommendations. The quotation is what you have now — do this to him… follow-
 * ups scheduled… If I set something by myself, like I have set some follow-ups,
 * that should be displayed in the next section… It should be something useful
 * for me."*
 *
 * So the Next action card now answers two questions, in this order:
 *
 *   1. What is already coming — anything a person scheduled (`crm-planned.ts`).
 *   2. What to do next — at most two suggestions, from this file.
 *
 * ── ⚠️ RULES, NOT A MODEL, AND THAT IS THE RIGHT TOOL HERE ─────────────────
 * Every suggestion below is a fact about the record plus the step that follows
 * it: "a quotation went out and nothing is scheduled → follow up in two days".
 * A model asked the same question would be slower, paid for on every page open,
 * and — the part that matters — occasionally wrong about the facts it is
 * reasoning from. `docs/crm-ai/01-THE-AGENT-LADDER.md` Tier 0: the thing most
 * often mistaken for AI is most of the value. Each suggestion says WHY, so the
 * salesperson can see it is grounded and argue with it.
 *
 * ⚠️ AND IT NEVER SUGGESTS WHAT IS ALREADY PLANNED. A lead with a follow-up on
 * Sunday is not told to schedule a follow-up; that is the noise the owner
 * complained about in the Record Outcome form, arriving from another direction.
 * ========================================================================= */

export type NextStepAction =
  /** Open the chat and answer. */
  | 'reply'
  /** Open the follow-ups, to plan one. */
  | 'follow_up'
  /** Open the qualifying questions on this screen. */
  | 'qualify'
  /** Open the quotations. */
  | 'quotation';

export interface NextStep {
  readonly key: string;
  /** What to do, as a sentence a salesperson would say. */
  readonly title: string;
  /** Why — the fact in the record this rests on. */
  readonly why: string;
  readonly action: NextStepAction;
  /** The button's own words. */
  readonly cta: string;
}

export interface NextStepInput {
  readonly stage: string;
  /** Who spoke last in the conversation, if anybody has. */
  readonly lastDirection: 'inbound' | 'outbound' | null;
  /** Something is already scheduled — a follow-up, a visit, a running plan. */
  readonly planned: boolean;
  /** How many of the qualifying answers are still missing. */
  readonly qualificationGaps: number;
  /** Any quotation exists on this lead, raised or sent. */
  readonly hasQuotation: boolean;
}

const CLOSED = new Set(['won', 'lost']);

/**
 * Up to two suggestions, most useful first. Empty for a closed lead.
 *
 * ⚠️ "THEY ARE WAITING" ALWAYS COMES FIRST, whatever else is planned. A client
 * whose message is the last one in the chat outranks every plan, and on WhatsApp
 * the 24-hour window is running while they wait.
 */
export function nextSteps(input: NextStepInput): readonly NextStep[] {
  if (CLOSED.has(input.stage)) return [];

  const out: NextStep[] = [];

  if (input.lastDirection === 'inbound') {
    out.push({
      key: 'reply',
      title: 'Reply — they are waiting',
      why: 'Their message is the last one in the chat.',
      action: 'reply',
      cta: 'Open the chat',
    });
  }

  /* ── The follow-up the stage calls for, only when nothing is planned ────── */
  if (!input.planned) {
    const f = followUpFor(input);
    if (f) out.push(f);
  }

  /* ── Qualifying answers, while they still decide what gets quoted ──────── */
  if (
    input.qualificationGaps > 0 &&
    ['new', 'contacted', 'proposal_pending', 'quotation_sent'].includes(input.stage) &&
    input.lastDirection !== null
  ) {
    out.push({
      key: 'qualify',
      title: 'Ask the qualifying questions',
      why: `${input.qualificationGaps} of the qualifying answers ${input.qualificationGaps === 1 ? 'is' : 'are'} still missing — budget, who decides, what for, when.`,
      action: 'qualify',
      cta: 'Answer them',
    });
  }

  /* ── A qualified lead with no price yet ────────────────────────────────── */
  if (input.stage === 'qualified' && !input.hasQuotation) {
    out.push({
      key: 'quotation',
      title: 'Send a quotation',
      why: 'They are qualified and have not been sent a price yet.',
      action: 'quotation',
      cta: 'Open quotations',
    });
  }

  return out.slice(0, 2);
}

function followUpFor(input: NextStepInput): NextStep | null {
  switch (input.stage) {
    case 'quotation_sent':
      return {
        key: 'follow_quotation',
        title: 'Follow up on the quotation in 2 days',
        why: 'A quotation went out and nothing is scheduled after it.',
        action: 'follow_up',
        cta: 'Plan the follow-up',
      };
    case 'proposal_pending':
      return {
        key: 'follow_proposal',
        title: 'Follow up on the proposal in 2 days',
        why: 'A proposal went out and nothing is scheduled after it.',
        action: 'follow_up',
        cta: 'Plan the follow-up',
      };
    case 'visit_scheduled':
      return {
        key: 'remind_visit',
        title: 'Remind them the day before the visit',
        why: 'A visit is booked and no reminder is scheduled.',
        action: 'follow_up',
        cta: 'Plan the reminder',
      };
    case 'visited':
      return {
        key: 'after_visit',
        title: 'Ask how the visit went, and share the final price',
        why: 'The visit is done and nothing is scheduled after it.',
        action: 'follow_up',
        cta: 'Plan the follow-up',
      };
    case 'negotiation':
      return {
        key: 'close',
        title: 'Agree the terms and fix a payment date',
        why: 'They are negotiating and nothing is scheduled.',
        action: 'follow_up',
        cta: 'Plan the next step',
      };
    case 'nurture':
      return {
        key: 're_engage',
        title: 'Re-engage in a few weeks with something new',
        why: 'The lead is parked after going quiet.',
        action: 'follow_up',
        cta: 'Plan it',
      };
    default:
      break;
  }

  /* new / contacted / qualified */
  if (input.lastDirection === null) {
    return {
      key: 'first_message',
      title: 'Send the first message',
      why: 'Nobody has written to them yet.',
      action: 'reply',
      cta: 'Open the chat',
    };
  }
  if (input.lastDirection === 'outbound') {
    return {
      key: 'chase',
      title: 'Follow up if they have not replied in 2 days',
      why: 'We wrote last and nothing is scheduled.',
      action: 'follow_up',
      cta: 'Plan the follow-up',
    };
  }
  return null;
}
