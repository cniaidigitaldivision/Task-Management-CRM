import { toE164 } from '@/lib/domain/phone';

/* ============================================================================
 * TURNING A META LEAD INTO A ROW — LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no network, no clock. Given what Meta returns for one lead,
 * decide what goes into columns and what stays as raw answers.
 *
 * ── ⚠️ THE FIELD NAMES ARE WHATEVER THE ADVERTISER TYPED ───────────────────
 * Verified against the live account on 2026-09-09. One Chitral form returns:
 *
 *     country · full_name · city · phone_number
 *     which__size_are_you_interested_in?_
 *     are_you_looking_for_plots_&_villa_?
 *
 * Question marks, ampersands, double underscores, a trailing underscore. Meta
 * derives the key from the question text, so every new form invents new keys and
 * a column per question would mean a migration per campaign.
 *
 * So: the four fields the CRM ACTS on are recognised and lifted into columns,
 * and the entire answer set is kept whole. Nothing Meta sent is discarded.
 * ========================================================================= */

/** One lead, as the Graph API returns it. */
export interface MetaLead {
  readonly id: string;
  readonly created_time: string;
  readonly field_data?: ReadonlyArray<{
    readonly name: string;
    readonly values?: readonly string[];
  }>;
}

/** What the writer function expects, one element of its `p_leads` array. */
export interface LeadPayload {
  readonly external_id: string;
  readonly form_meta_id: string;
  readonly full_name: string | null;
  readonly phone: string | null;
  readonly phone_e164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly answers: Record<string, string>;
  readonly submitted_at: string;
}

/* ── ⚠️ RECOGNISED BY MEANING, NOT BY EXACT KEY ─────────────────────────────
   Meta's standard fields are stable, but advertisers also build custom ones
   called "phone" or "mobile_number" or "contact_number". Matching a small set of
   substrings catches those without pretending to understand the rest.

   Ordered: the first match wins, so `full_name` beats `name` and a field called
   `company_name` never becomes the person's name. */
const NAME_KEYS = ['full_name', 'name'] as const;

/* ⚠️ EXCLUDED FROM THE LOOSE NAME MATCH. `first_name` and `last_name` both
   contain "name", so a substring search finds one of them and returns half a
   person — the mapper returned "Zain" for a lead called Zain Ul Abedin until a
   test caught it. They are handled by composition instead, below. */
const NAME_PARTS = ['first_name', 'last_name', 'middle_name'] as const;
const PHONE_KEYS = ['phone_number', 'phone', 'mobile', 'contact_number', 'whatsapp'] as const;
const EMAIL_KEYS = ['email'] as const;
const CITY_KEYS = ['city', 'town'] as const;

function pick(
  answers: Record<string, string>,
  keys: readonly string[],
  exclude: readonly string[] = [],
): string | null {
  /* Exact match first — an advertiser's `phone_number` is more trustworthy than
     a custom `preferred_phone_time` that merely contains "phone". */
  for (const key of keys) {
    const exact = answers[key];
    if (exact && exact.trim()) return exact.trim();
  }
  for (const key of keys) {
    for (const [name, value] of Object.entries(answers)) {
      if (exclude.includes(name)) continue;
      if (name.includes(key) && value && value.trim()) return value.trim();
    }
  }
  return null;
}

/**
 * A lead, ready for `app.crm_record_leads`.
 *
 * ⚠️ Returns null when the lead carries no id or no submission time — both come
 * from Meta on every real lead, so their absence means something is wrong with
 * the response rather than with the lead. Storing a row with a null
 * `submitted_at` would break every ageing and response-time figure downstream,
 * and it is not recoverable afterwards.
 */
export function toLeadPayload(lead: MetaLead, formMetaId: string): LeadPayload | null {
  if (!lead?.id || !lead.created_time) return null;

  /* Every answer, flattened. Meta gives `values` as an array because a checkbox
     question can have several; joined with a comma so the raw record stays
     readable, and nothing is dropped. */
  const answers: Record<string, string> = {};
  for (const field of lead.field_data ?? []) {
    if (!field?.name) continue;
    const value = (field.values ?? []).filter(Boolean).join(', ').trim();
    if (value) answers[field.name] = value;
  }

  /* Some forms ask for first and last separately rather than a full name.
     ⚠️ Composed BEFORE the loose match runs, and preferred over it — see
     NAME_PARTS. Half a name is worse than none: a salesperson greeting somebody
     by a fragment reads as a mail-merge that went wrong. */
  const first = answers.first_name?.trim() || null;
  const last = answers.last_name?.trim() || null;
  const composed = [first, last].filter(Boolean).join(' ').trim();

  const phone = pick(answers, PHONE_KEYS);

  return {
    external_id: lead.id,
    form_meta_id: formMetaId,
    /* Exact `full_name` wins; then first + last composed; then a loose match
       that cannot see the name PARTS. */
    full_name: answers.full_name?.trim() || composed || pick(answers, NAME_KEYS, NAME_PARTS),
    phone,
    /* ⚠️ Null when it cannot be parsed with confidence — see lib/domain/phone.ts.
       The raw value is kept above regardless, so nothing is lost; what is
       refused is a GUESS, because a wrong normalisation merges two strangers
       into one lead and that cannot be undone by looking at the raw value. */
    phone_e164: toE164(phone),
    email: pick(answers, EMAIL_KEYS),
    city: pick(answers, CITY_KEYS),
    answers,
    submitted_at: lead.created_time,
  };
}
