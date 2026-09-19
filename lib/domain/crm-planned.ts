/* ============================================================================
 * WHAT THIS LEAD ALREADY HAS PLANNED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-19: *"The next action should not be compulsory when I manually
 * change something. If he wants to do something, then he can add on… maybe I
 * have set some other follow-ups. I don't need these follow-ups."*
 *
 * ── ⚠️ THE OLD RULE'S INTENT WAS RIGHT AND ITS TEST WAS WRONG ──────────────
 * `outcomeProblems` has refused to save an open lead with no next action since
 * Phase 1, on the owner's own rule: *"every open lead should leave the form with
 * a next action."* The INTENT is **no open lead goes quiet**. But the check asked
 * *"did you type one just now?"* rather than **"does this lead have anything
 * planned?"** — so a lead with a three-step sequence running was told to invent a
 * fourth thing, by a form arguing with a plan the same person made an hour ago.
 *
 * This answers the question the rule should have been asking, from rows every
 * screen already holds. No round trip: the drawer has `related`, the desk and the
 * Conversations page have the row.
 * ========================================================================= */

export interface PlannedThing {
  /** What is already coming — "Second nudge", "Site visit", the next action's own words. */
  readonly what: string;
  /** When, as an ISO string, or null when the plan has no date yet. */
  readonly at: string | null;
  /** Where it came from, so the form can say so honestly. */
  readonly source: 'follow_up' | 'sequence' | 'next_action' | 'appointment';
}

interface PlannedInput {
  /** The lead's own next action, if it has one. */
  readonly nextAction?: string | null;
  readonly nextActionAt?: string | null;
  /** A running plan: its state, and how far through it is. */
  readonly sequence?: { readonly state: string; readonly step: number; readonly total: number } | null;
  /** Follow-ups on this lead. Only the unfinished ones count. */
  readonly followUps?: ReadonlyArray<{
    readonly title: string;
    readonly status: string;
    readonly dueAt: string;
    readonly doneAt?: string | null;
  }>;
  /** Appointments. Only one still to happen counts. */
  readonly appointments?: ReadonlyArray<{
    readonly kind: string;
    readonly status: string;
    readonly scheduledAt: string;
  }>;
  readonly nowMs: number;
}

const OPEN_FOLLOW_UP = ['planned', 'due'];
const LIVE_SEQUENCE = ['scheduled', 'active'];
const OPEN_APPOINTMENT = ['scheduled', 'confirmed'];

/**
 * The soonest thing already coming to this lead, or null when nothing is.
 *
 * ⚠️ THE SOONEST, NOT THE FIRST FOUND. A lead can have a next action on Friday
 * and a sequence step tomorrow; naming Friday would tell somebody the lead is
 * quieter than it is, and the whole point of this is to be believed.
 *
 * ⚠️ AND ONLY THINGS THAT HAVE NOT HAPPENED. A follow-up that is done, a visit
 * that is over and a stopped sequence are history. Counting them would let a lead
 * that genuinely has nothing planned pass the check — which is the bug the
 * original rule existed to prevent, reintroduced from the other side.
 */
export function plannedSummary(input: PlannedInput): PlannedThing | null {
  const found: PlannedThing[] = [];

  for (const f of input.followUps ?? []) {
    if (f.doneAt) continue;
    if (!OPEN_FOLLOW_UP.includes(f.status)) continue;
    found.push({ what: f.title.trim() || 'A follow-up', at: f.dueAt, source: 'follow_up' });
  }

  for (const a of input.appointments ?? []) {
    if (!OPEN_APPOINTMENT.includes(a.status)) continue;
    if (Date.parse(a.scheduledAt) <= input.nowMs) continue;
    found.push({ what: a.kind === 'site_visit' ? 'Site visit' : 'Appointment', at: a.scheduledAt, source: 'appointment' });
  }

  /* ⚠️ A SEQUENCE HAS NO DATE HERE ON PURPOSE. Its next step's moment lives on
     the run, which not every caller holds; claiming a time we cannot see would
     be worse than saying "a plan is running" and letting the tab show when. */
  const seq = input.sequence;
  if (seq && LIVE_SEQUENCE.includes(seq.state)) {
    const total = seq.total > 0 ? seq.total : 0;
    found.push({
      what: total > 0 ? `Sequence, step ${Math.min(seq.step + 1, total)} of ${total}` : 'A sequence is running',
      at: null,
      source: 'sequence',
    });
  }

  const next = (input.nextAction ?? '').trim();
  if (next !== '') {
    const at = input.nextActionAt ?? null;
    /* A next action whose moment has passed is not a plan, it is an overdue
       thing — and the form is the right place to be asked about it again. */
    if (at === null || Date.parse(at) > input.nowMs) {
      found.push({ what: next, at, source: 'next_action' });
    }
  }

  if (found.length === 0) return null;

  /* Dated things first, soonest wins; an undated plan only speaks when nothing
     dated does. */
  const dated = found.filter((f) => f.at !== null && !Number.isNaN(Date.parse(f.at)));
  if (dated.length > 0) {
    return dated.reduce((a, b) => (Date.parse(a.at as string) <= Date.parse(b.at as string) ? a : b));
  }
  return found[0];
}
