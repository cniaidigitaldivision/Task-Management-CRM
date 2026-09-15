/* ============================================================================
 * ADDING A LEAD BY HAND — THE RULES, IN ONE PLACE
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no framework. The form runs these so nobody is
 * told "no" after pressing save, and `createLeadAction` runs the same ones
 * because the owner's rule is *"enforce these rules on the server/API, not only
 * in the UI."* One module, two callers, no chance of them drifting apart.
 *
 * ── ⚠️ WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
 * Who gets the lead. There is no owner in any of these types, because there is
 * no owner argument in `app.crm_create_lead` either — the rota decides, and the
 * absence of the field is the enforcement.
 * ========================================================================= */

import { toE164 } from './phone';

/**
 * The channels somebody may file a hand-typed lead under.
 *
 * ⚠️ `meta_lead_ad` AND `import` ARE MISSING ON PURPOSE. Both are written by
 * machines — the Meta importer and the bulk file loader — and letting a person
 * pick them would put a lead into the reporting bucket for a campaign that never
 * produced it, which is how a channel's cost-per-lead quietly becomes wrong.
 */
export const ADD_LEAD_SOURCES = [
  'walk_in',
  'referral',
  'whatsapp',
  'website',
  'facebook',
  'instagram',
  'google',
  'linkedin',
  'manual',
] as const;

export type AddLeadSource = (typeof ADD_LEAD_SOURCES)[number];

export function isAddLeadSource(value: string): value is AddLeadSource {
  return (ADD_LEAD_SOURCES as readonly string[]).includes(value);
}

/** The three a person may say they prefer. `task` is not a way to reach anybody. */
export const PREFERRED_CHANNELS = ['whatsapp', 'call', 'email'] as const;

/** Mirrors the CHECK in 111. */
const MAX_NAME = 200;
const MAX_LINE = 200;
const MAX_ENQUIRY = 4000;

export interface NewLeadInput {
  readonly projectId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string;
  readonly city: string;
  readonly source: string;
  readonly sourceDetail: string;
  readonly enquiry: string;
  readonly budget: string;
  readonly whatsappConsent: boolean | null;
  readonly preferredChannel: string | null;
  readonly preferredTime: string;
  readonly nextAction: string;
  readonly nextActionAt: string | null;
  readonly nextActionType: string | null;
}

/**
 * What the write path must refuse.
 *
 * ⚠️ SENTENCES, NOT A BOOLEAN — the same stance `outcomeProblems` takes. Each
 * one names the field and says why, so nobody has to guess which control a
 * refusal is about.
 */
export function newLeadProblems(input: NewLeadInput): string[] {
  const problems: string[] = [];

  if (!input.projectId) {
    problems.push('Choose the project this enquiry is about.');
  }

  const name = input.fullName.trim();
  if (!name) {
    problems.push('Enter the name of the person who enquired.');
  } else if (name.length > MAX_NAME) {
    problems.push(`The name is too long — keep it under ${MAX_NAME} characters.`);
  }

  const phone = input.phone.trim();
  const email = input.email.trim();

  /* ⚠️ THE RAW PHONE COUNTS, NOT THE NORMALISED ONE. An Islamabad landline is
     ten digits and `toE164` returns null for it — refusing that would throw away
     a real enquiry because the number is not a mobile. What is lost without an
     E.164 form is duplicate matching and WhatsApp, and `phoneWarning` says so
     instead of this refusing. */
  if (!phone && !email) {
    problems.push('Add a phone number or an email — otherwise there is no way to contact this person.');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    problems.push('That email address does not look complete.');
  }

  if (!isAddLeadSource(input.source)) {
    problems.push('Choose where this enquiry came from.');
  }

  if (input.sourceDetail.trim().length > MAX_LINE) {
    problems.push(`Keep the source detail under ${MAX_LINE} characters.`);
  }

  if (input.enquiry.trim().length > MAX_ENQUIRY) {
    problems.push(`The enquiry is too long — keep it under ${MAX_ENQUIRY} characters.`);
  }

  const budget = input.budget.trim();
  if (budget) {
    const digits = budget.replace(/[^\d]/g, '');
    if (!digits || Number(digits) <= 0) {
      problems.push('The budget should be a number of rupees, or left empty.');
    }
  }

  if (input.preferredChannel && !(PREFERRED_CHANNELS as readonly string[]).includes(input.preferredChannel)) {
    problems.push('That is not a way to contact somebody.');
  }

  /* ⚠️ CONSENT IS ASKED FOR, NOT ASSUMED — and "not yet asked" is a legitimate
     answer that must stay available. What is refused is the contradiction:
     saying they prefer WhatsApp while recording that they said no to it. */
  if (input.whatsappConsent === false && input.preferredChannel === 'whatsapp') {
    problems.push(
      'They said no to WhatsApp, so it cannot also be how they prefer to be contacted.',
    );
  }

  /* ⚠️ A NEXT ACTION WITHOUT A TIME NEVER APPEARS ON ANYBODY'S DAY. The desk is
     ordered by `next_action_at`; a plan with no date is a plan nobody is
     reminded of, which is indistinguishable from no plan at all. */
  if (input.nextAction.trim() && !input.nextActionAt) {
    problems.push('Choose when the next action is due — without a date it will not appear on your day.');
  }

  if (input.nextActionAt && !input.nextAction.trim()) {
    problems.push('Say what the next action is, not only when it is due.');
  }

  return problems;
}

/**
 * The quiet caveat a number earns when it cannot be normalised.
 *
 * Null when there is nothing to say. This is never a refusal — see the header of
 * `lib/domain/phone.ts`: a number that cannot be parsed is still kept and still
 * shown, it simply is not pretended about.
 */
export function phoneWarning(phone: string): string | null {
  const raw = phone.trim();
  if (!raw) return null;
  if (toE164(raw)) return null;
  return 'This does not look like a mobile number, so WhatsApp and duplicate checking will not work for it. It will still be saved exactly as typed.';
}

/* ============================================================================
 * WHAT TO DO ABOUT SOMEBODY WE ALREADY KNOW
 * ========================================================================= */

export interface DuplicateLike {
  readonly kind: 'lead' | 'client';
  readonly name: string;
  readonly projectName: string | null;
  readonly sameProject: boolean;
  readonly isOpen: boolean;
  readonly isMine: boolean;
  readonly ownerName: string | null;
  readonly stage: string | null;
}

export interface DuplicateVerdict {
  /**
   * `blocked` — cannot be created at all, and the database refuses it too.
   * `confirm` — real, but a person may go ahead having been shown it.
   * `none`    — nothing known about this person.
   */
  readonly verdict: 'blocked' | 'confirm' | 'none';
  readonly message: string | null;
}

/**
 * ⚠️ THE ONE CASE WITH NO OVERRIDE: an OPEN lead for this person, on this
 * project, belonging to somebody else. That is the exact situation the whole
 * assignment system exists to prevent, and letting it through would also be the
 * quietest possible way to take a colleague's lead — retype it, and the rota
 * might hand it to you.
 *
 * ⚠️ A LEAD ON ANOTHER PROJECT IS NOT A DUPLICATE. The same person asking about
 * Chitral and then about Executive Housing is two enquiries, and `crm_clients`
 * was built without a `project_id` for exactly this reason (111). It is worth
 * saying out loud; it is not worth blocking.
 *
 * This mirrors `CRM05`/`CRM06` in migration 158. The database is the authority —
 * this exists so the screen can say the same thing before anybody presses save.
 */
export function duplicateVerdict(dupes: readonly DuplicateLike[]): DuplicateVerdict {
  const blocking = dupes.find((d) => d.kind === 'lead' && d.sameProject && d.isOpen && !d.isMine);
  if (blocking) {
    return {
      verdict: 'blocked',
      message: `${blocking.ownerName ?? 'A colleague'} already has an open lead for ${blocking.name} on this project. Add a note to that lead rather than creating a second one.`,
    };
  }

  const mine = dupes.find((d) => d.kind === 'lead' && d.sameProject && d.isOpen && d.isMine);
  if (mine) {
    return {
      verdict: 'confirm',
      message: `You already have an open lead for ${mine.name} on this project.`,
    };
  }

  const elsewhere = dupes.find((d) => d.kind === 'lead' && !d.sameProject && d.isOpen);
  if (elsewhere) {
    return {
      verdict: 'confirm',
      message: `${elsewhere.name} has an open enquiry on ${elsewhere.projectName ?? 'another project'}${
        elsewhere.ownerName ? `, with ${elsewhere.ownerName}` : ''
      }. Adding this one is fine — they are two different enquiries.`,
    };
  }

  const client = dupes.find((d) => d.kind === 'client');
  if (client) {
    return {
      verdict: 'confirm',
      message: `${client.name} has bought from us before. Worth knowing before the first call.`,
    };
  }

  const closed = dupes.find((d) => d.kind === 'lead');
  if (closed) {
    return {
      verdict: 'confirm',
      message: `${closed.name} enquired before and that lead is closed${
        closed.ownerName ? ` — it was ${closed.ownerName}'s` : ''
      }. This will be a new enquiry.`,
    };
  }

  return { verdict: 'none', message: null };
}
