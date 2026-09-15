/* ============================================================================
 * QUOTATIONS — the number a client is actually told
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock of its own, no framework. The form runs these so
 * nobody is refused after filling a panel in, and the server runs the same ones
 * because a rule that lives only in a component is not a rule.
 *
 * ── ⚠️ EVERY FIGURE IS WHOLE RUPEES, HELD AS AN INTEGER ────────────────────
 * PKR 4,500,000 as a float prints as 4499999.999999 on somebody's quotation
 * eventually, and Pakistan has no circulating subunit — rupees ARE the minor
 * unit. Migration 151 stores bigint for the same reason; this module never
 * introduces a decimal.
 *
 * ── ⚠️ AND THE NET IS STORED, NOT RECOMPUTED ON READ ───────────────────────
 * The document said a number. That number is what it said, whatever arithmetic
 * we would do today. This file computes it once, at the moment of writing; a
 * generated column would quietly restate history the first time the formula
 * changed, and a client holding a printed page would be right and the system
 * wrong.
 * ========================================================================= */

export const QUOTATION_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'expired',
  'superseded',
  'rejected',
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

const LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  sent: 'Sent',
  expired: 'Expired',
  superseded: 'Replaced',
  rejected: 'Rejected',
};

const TOKEN: Record<string, string> = {
  draft: 'neutral-500',
  pending_approval: 'gold-700',
  approved: 'feedback-success',
  sent: 'accent-primary',
  expired: 'neutral-500',
  superseded: 'neutral-500',
  rejected: 'feedback-error',
};

export function quotationStatusLabel(status: string): string {
  /* An unrecognised value shows ITSELF rather than "Unknown" — the same rule
     `stageLabel` follows, so a status added to the enum and forgotten here looks
     odd on screen instead of vanishing into a word that conceals it. */
  return LABEL[status] ?? status;
}

export function quotationStatusToken(status: string): string {
  return TOKEN[status] ?? 'neutral-500';
}

/** Statuses a salesperson may still edit. Mirrors the policy in 151. */
export function isEditableQuotation(status: string): boolean {
  return status === 'draft' || status === 'pending_approval' || status === 'rejected';
}

/**
 * What the client is asked to pay.
 *
 * ⚠️ THE DISCOUNT THAT COUNTS IS THE APPROVED ONE, once there is one. While a
 * quotation is still being asked for, the figure on it is what the salesperson
 * WANTS to offer; the moment a manager approves a different number, that is what
 * the document says. Using the requested figure after approval would print a
 * price nobody authorised.
 */
export function netAmount(input: {
  basePrice: number;
  premiumCharges: number;
  requestedDiscount: number;
  approvedDiscount: number;
  approved: boolean;
}): number {
  const discount = input.approved ? input.approvedDiscount : input.requestedDiscount;
  return input.basePrice + input.premiumCharges - discount;
}

/**
 * ⚠️ A DISCOUNT NEEDS SOMEBODY ELSE'S APPROVAL; A QUOTATION AT LIST PRICE DOES
 * NOT.
 *
 * The owner's standing rule is that a salesperson may not *"approve their own
 * discounts"* — it is about the discount, not about the existence of a document.
 * Requiring a manager for every quotation at full price would put a person in
 * the way of a number they have no discretion over, and the usual result is that
 * people stop using the system and send prices from WhatsApp instead.
 *
 * So: no discount, they may send it. Any discount at all, somebody else decides.
 */
export function needsApproval(requestedDiscount: number): boolean {
  return requestedDiscount > 0;
}

export interface NewQuotation {
  readonly basePrice: string;
  readonly premiumCharges: string;
  readonly requestedDiscount: string;
  readonly validUntil: string | null;
  readonly terms: string;
}

/** Digits only — "1,20,00,000" and "12000000" are the same number. */
export function toRupees(text: string): number | null {
  const digits = text.trim().replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * What the write path must refuse. Sentences, not a boolean.
 *
 * `todayIso` is passed in rather than read here, so the rules stay pure and a
 * test can sit at any date it likes.
 */
export function quotationProblems(input: NewQuotation, todayIso: string): string[] {
  const problems: string[] = [];

  const base = toRupees(input.basePrice);
  const premium = input.premiumCharges.trim() ? toRupees(input.premiumCharges) : 0;
  const discount = input.requestedDiscount.trim() ? toRupees(input.requestedDiscount) : 0;

  if (base === null || base <= 0) {
    problems.push('Enter the price. A quotation without one is not a quotation.');
  }
  if (premium === null) {
    problems.push('Premium charges should be a number of rupees, or left empty.');
  }
  if (discount === null) {
    problems.push('The discount should be a number of rupees, or left empty.');
  }

  /* ⚠️ THE SAME CEILING THE DATABASE ENFORCES (151), checked here so somebody
     is told in words rather than by a constraint violation. "Net −200,000" is
     the kind of figure that makes a client distrust every other number on the
     page. */
  if (base !== null && premium !== null && discount !== null && discount > base + premium) {
    problems.push('The discount is larger than the price. Nothing can be sold for less than nothing.');
  }

  if (input.validUntil) {
    /* ⚠️ COMPARED AS TEXT, in YYYY-MM-DD. Parsing both to Date and comparing
       would drag the browser's timezone into a question about a calendar day —
       and for five hours each evening Karachi is a different date from UTC. */
    if (input.validUntil < todayIso) {
      problems.push('That validity date has already passed. A client cannot accept an expired offer.');
    }
  }

  if (input.terms.trim().length > 4000) {
    problems.push('The terms are too long — keep them under 4000 characters.');
  }

  return problems;
}

/**
 * The next number in the series, from the highest already used.
 *
 * ⚠️ NOT A COUNT, AND NOT A TIMESTAMP. A count re-uses a number the moment a
 * quotation is deleted, and two documents sharing a number is the one thing a
 * client will notice. A timestamp is unique and unreadable — nobody says "can
 * you resend 1758039201".
 *
 * ⚠️ AND IT NEVER GOES BACKWARDS. The highest wins even if the series has gaps,
 * because a gap is harmless and a repeat is not.
 */
export function nextQuotationNumber(existing: readonly string[], prefix = 'QT-'): string {
  let highest = 1041;
  for (const n of existing) {
    const m = /(\d+)\s*$/.exec(n.trim());
    if (!m) continue;
    const value = Number(m[1]);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }
  return `${prefix}${highest + 1}`;
}
