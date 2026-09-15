/* ============================================================================
 * HOW URGENT IS THIS LEAD?
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-14, choosing between three options: *"Priority: high, low,
 * normal. Use these words and the recommendation."* The recommendation was to
 * DERIVE it rather than store it.
 *
 * ── ⚠️ WHY DERIVED, AND NOT A COLUMN ───────────────────────────────────────
 * A stored `priority` would sit beside `temperature` (hot · warm · cold) looking
 * like the same thing, and the two would disagree within a week — a lead marked
 * "Hot" in January and never touched since is not high priority, it is neglected.
 * They answer different questions:
 *
 *     temperature  →  will they buy?        set by the salesperson, after talking
 *     priority     →  who do I ring first?  set by the clock
 *
 * The clock needs no maintenance and cannot go stale, so it is computed here.
 *
 * ⚠️ AND IT IS COMPUTED IN ONE PLACE. The row, the drawer and any future sort
 * all read this function. Two definitions of "high priority" on two screens is
 * how somebody stops trusting both — and the person most likely to notice is the
 * one being measured by it.
 * ========================================================================= */

export type LeadPriority = 'high' | 'normal' | 'low';

export interface PriorityInput {
  readonly stage: string;
  readonly nextActionAt: string | null;
  /** 'inbound' when THEY wrote last, which means we owe a reply. */
  readonly lastMessageDirection: 'inbound' | 'outbound' | null;
}

export interface PriorityVerdict {
  readonly level: LeadPriority;
  /** ⚠️ Why, in words, for the tooltip. A rating somebody cannot interrogate is
   *  a rating they argue with. */
  readonly reason: string;
}

const CLOSED = new Set(['won', 'lost']);

export function leadPriority(lead: PriorityInput, nowMs: number): PriorityVerdict {
  /* ⚠️ CLOSED FIRST, BEFORE ANYTHING ELSE IS LOOKED AT. A won lead with an
     unanswered message is not urgent — the deal is done and the message is
     usually "thank you". Checking the clock first would put finished business at
     the top of the list every time somebody said goodbye. */
  if (CLOSED.has(lead.stage)) {
    return { level: 'low', reason: 'This lead is closed.' };
  }

  /* ⚠️ THE UNANSWERED REPLY OUTRANKS THE OVERDUE DATE, and deliberately. An
     overdue follow-up is our own plan slipping; an unanswered message is a real
     person waiting — and on WhatsApp it is also a 24-hour window closing, after
     which we cannot write freely at all. One of those two has a deadline set by
     Meta rather than by us. */
  if (lead.lastMessageDirection === 'inbound') {
    return { level: 'high', reason: 'They wrote last and are waiting for a reply.' };
  }

  if (lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < nowMs) {
    return { level: 'high', reason: 'The next action is overdue.' };
  }

  /* ⚠️ NO PLAN IS NOT LOW — IT IS THE DEFAULT. A lead nobody has decided
     anything about is ordinary work waiting to be picked up, and calling it
     "low" would file it behind leads that at least have a date on them. The
     desk's "No next action" card is what surfaces these; priority is not the
     place to bury them. */
  if (lead.nextActionAt === null) {
    return { level: 'normal', reason: 'Open, with no next action set yet.' };
  }

  return { level: 'normal', reason: 'Planned, and not yet due.' };
}

/** The word on the chip. */
export function priorityLabel(level: LeadPriority): string {
  return level === 'high' ? 'High' : level === 'low' ? 'Low' : 'Normal';
}

/**
 * The dot's colour.
 *
 * ⚠️ `feedback-error` FOR HIGH, NOT A NEUTRAL RED. High priority here always
 * means something is already late or already waiting — it is a failure state,
 * not a label, and it should read like the overdue dates it usually accompanies.
 */
export function priorityToken(level: LeadPriority): string {
  return level === 'high'
    ? 'feedback-error'
    : level === 'low'
      ? 'neutral-500'
      : 'feedback-success';
}
