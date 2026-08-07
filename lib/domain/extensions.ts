import type { Role } from './constants';

/* ============================================================================
 * TIME EXTENSIONS — FR-183 to FR-188, BR-018, doc 17 §5
 * ----------------------------------------------------------------------------
 * ── THE SPLIT IS THE WHOLE FEATURE ───────────────────────────────────────────
 * A Coordinator SETS the original limit. Only an Admin EXTENDS it. Setting a
 * budget is planning; spending past it is a cost decision, and the owner was
 * explicit: "only the admin can further give the time."
 *
 * That means `sees_all_work()` — the test used almost everywhere else for
 * "senior enough" — is deliberately the wrong test here, and the RLS policy
 * `tx_decide` uses `acting_at_least('admin')` instead. This module states the
 * same rule so the server action can refuse with a sentence rather than letting
 * the database refuse with a permission error.
 *
 * ── A DECLINE NEEDS A REASON AND AN APPROVAL DOES NOT ────────────────────────
 * FR-186. Not an oversight: approving agrees with the reason already written by
 * the requester, so there is nothing to add. Declining contradicts it, and
 * "no" with no explanation is the thing that makes people stop asking and
 * start working off the books — which is precisely what this feature exists to
 * prevent.
 * ========================================================================= */

export const MIN_EXTENSION_MINUTES = 5;
export const MAX_EXTENSION_MINUTES = 60 * 40; // 40 hours — a working week, capped.

/* The five values of `public.extension_status`, spelled exactly as the enum
   spells them. A near-miss here ("partial" for "partially_approved") does not
   fail to compile and does not fail to run until the first write, which is the
   worst possible moment to find out. */
export type ExtensionStatus =
  | 'pending'
  | 'approved'
  | 'partially_approved'
  | 'declined'
  | 'cancelled';

export const EXTENSION_STATUS_LABEL: Record<ExtensionStatus, string> = {
  pending: 'Awaiting a decision',
  approved: 'Approved',
  partially_approved: 'Partly approved',
  declined: 'Declined',
  cancelled: 'Withdrawn',
};

/** BR-018 / FR-184. Coordinators are read-only on this. */
export function canDecideExtensions(role: Role): boolean {
  return role === 'admin' || role === 'super_admin';
}

export type Check = { readonly ok: true } | { readonly ok: false; readonly message: string };

const ok: Check = { ok: true };
const no = (message: string): Check => ({ ok: false, message });

export function validateRequest(input: {
  requestedMinutes: unknown;
  reason: string;
  hasTimeLimit: boolean;
  pendingAlready: boolean;
}): Check {
  if (!input.hasTimeLimit) {
    /* Extending a limit that does not exist is not a small edge case — the
       granted minutes would be added to null and the task would end up with a
       limit nobody set, arrived at by accident. */
    return no('This task has no time limit, so there is nothing to extend. Ask for one to be set.');
  }

  if (input.pendingAlready) {
    return no('There is already a request waiting on this task. One at a time.');
  }

  const minutes =
    typeof input.requestedMinutes === 'number'
      ? input.requestedMinutes
      : Number(String(input.requestedMinutes ?? '').trim());

  if (!Number.isInteger(minutes) || minutes < MIN_EXTENSION_MINUTES) {
    return no(`Ask for at least ${MIN_EXTENSION_MINUTES} minutes.`);
  }
  if (minutes > MAX_EXTENSION_MINUTES) {
    return no(
      `${Math.round(MAX_EXTENSION_MINUTES / 60)} hours is the most that can be requested at once. If the work is genuinely that far out, the estimate was wrong — say so and have the task re-planned.`,
    );
  }

  /* FR-183: the reason is mandatory. A one-word reason is technically a reason
     and tells the Admin nothing, so there is a floor. */
  const reason = input.reason.trim();
  if (reason.length < 10) {
    return no('Say what happened, in a sentence. The Admin deciding this was not there.');
  }

  return ok;
}

export function validateDecision(input: {
  role: Role;
  decision: 'approve' | 'decline';
  requestedMinutes: number;
  grantedMinutes: unknown;
  note: string;
  currentStatus: ExtensionStatus;
}): Check {
  if (!canDecideExtensions(input.role)) {
    return no(
      'Only an Admin can grant or decline extra time. A Coordinator sets the original limit but does not extend it (BR-018).',
    );
  }

  if (input.currentStatus !== 'pending') {
    /* Two Admins open the same request. Without this, the second decision
       silently overwrites the first and the requester is told two different
       things by two notifications. */
    return no('This request has already been decided.');
  }

  if (input.decision === 'decline') {
    // FR-186.
    return input.note.trim().length < 10
      ? no('A decline needs a reason. Being told no with no explanation is why people stop asking.')
      : ok;
  }

  const granted =
    typeof input.grantedMinutes === 'number'
      ? input.grantedMinutes
      : Number(String(input.grantedMinutes ?? '').trim());

  if (!Number.isInteger(granted) || granted < MIN_EXTENSION_MINUTES) {
    return no(`Grant at least ${MIN_EXTENSION_MINUTES} minutes, or decline.`);
  }

  if (granted > input.requestedMinutes) {
    /* Not a safety rail — an Admin may well think the request was too modest.
       But granting more than was asked for through the *approval* box means the
       requester is notified of a number they never mentioned. Raising the limit
       directly is the honest way to do that, and it is audited as what it is. */
    return no(
      `They asked for ${input.requestedMinutes} minutes. To give more than that, change the task's time limit directly — an approval should not exceed its request.`,
    );
  }

  return ok;
}

/** What the decision becomes. Partial is its own status, not a lesser approval. */
export function outcomeStatus(
  decision: 'approve' | 'decline',
  requestedMinutes: number,
  grantedMinutes: number,
): ExtensionStatus {
  if (decision === 'decline') return 'declined';
  return grantedMinutes < requestedMinutes ? 'partially_approved' : 'approved';
}

/** Minutes → "2h 15m". Nobody reads 135 as two and a quarter hours. */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * The context an Admin needs to decide, per doc 17 §5 — "an Admin approving
 * blind is just rubber-stamping".
 *
 * The interesting one is `estimateLooksLow`: when the same kind of task
 * habitually runs over, the extension is a symptom of a bad estimate rather
 * than slow work, and saying so turns each approval into a correction to how
 * the team estimates rather than a judgement on a person.
 */
export interface DecisionContext {
  readonly consumedMinutes: number;
  readonly limitMinutes: number;
  readonly overByMinutes: number;
  readonly priorExtensionsOnTask: number;
  readonly requesterUtilisationPct: number | null;
  readonly daysToDue: number | null;
  readonly estimateLooksLow: boolean;
}

export function buildDecisionContext(input: {
  consumedMinutes: number;
  limitMinutes: number;
  priorExtensionsOnTask: number;
  requesterUtilisationPct: number | null;
  daysToDue: number | null;
}): DecisionContext {
  return {
    ...input,
    overByMinutes: Math.max(0, input.consumedMinutes - input.limitMinutes),
    /* Two or more extensions on one task is no longer an incident; the number
       the work was budgeted against was wrong. */
    estimateLooksLow: input.priorExtensionsOnTask >= 1,
  };
}
