/* ============================================================================
 * WHAT A WEBSITE FORM SENT US — LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React. A posted body in, our field names out.
 *
 * ── ⚠️ THE FORM IS SOMEBODY ELSE'S ────────────────────────────────────────
 * This is the whole reason the file exists. A client's contact page already has
 * `name`, `mobile` and `message` inputs, written by whoever built the site
 * years ago. The alternative to recognising those is telling them to rename
 * every field — which means editing a page they are frightened of, and which
 * breaks their own styling and validation on the way.
 *
 * So the names we document are accepted, and so are the names people actually
 * use. An explicit `fullName` still wins over an aliased `name`.
 *
 * ── ⚠️ AN UNKNOWN FIELD IS IGNORED, NOT REFUSED ───────────────────────────
 * Sites post all sorts — `utm_term`, a CSRF token, a `submit` button's value.
 * Refusing the request because of one would fail the exact caller this exists
 * for, and none of it can reach the database: only the names below are passed
 * on.
 * ========================================================================= */

/** The names this product documents. */
export const INTAKE_FIELDS = [
  'fullName', 'phone', 'phoneE164', 'email', 'city', 'enquiry', 'budget',
  'source', 'sourceDetail', 'whatsappConsent', '_trap',
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

/**
 * What else a real form calls these.
 *
 * ⚠️ `_trap` HAS ALIASES TOO, and they are the names a template generator
 * produces — `website_url`, `bot-field`. A honeypot nobody can name is a
 * honeypot nobody adds.
 */
export const INTAKE_ALIASES: Readonly<Record<string, IntakeField>> = {
  name: 'fullName', full_name: 'fullName', fullname: 'fullName', your_name: 'fullName',
  'your-name': 'fullName', customer_name: 'fullName', client_name: 'fullName',

  mobile: 'phone', mobile_no: 'phone', mobile_number: 'phone', phone_number: 'phone',
  contact: 'phone', contact_number: 'phone', tel: 'phone', cell: 'phone', whatsapp: 'phone',
  'phone-e164': 'phoneE164', phone_e164: 'phoneE164',

  mail: 'email', email_address: 'email', 'e-mail': 'email', emailaddress: 'email',

  town: 'city', location: 'city',

  message: 'enquiry', comments: 'enquiry', comment: 'enquiry', requirement: 'enquiry',
  requirements: 'enquiry', notes: 'enquiry', details: 'enquiry', query: 'enquiry',
  'your-message': 'enquiry',

  amount: 'budget', price: 'budget', budget_pkr: 'budget',

  utm_source: 'source', channel: 'source', lead_source: 'source',
  campaign: 'sourceDetail', utm_campaign: 'sourceDetail', ref: 'sourceDetail',
  referrer: 'sourceDetail', page: 'sourceDetail',

  /* The honeypot, under the names a generator is likely to produce. */
  website_url: '_trap', honeypot: '_trap', hp: '_trap', 'bot-field': '_trap',
  _gotcha: '_trap', 'leave-blank': '_trap',
};

/**
 * Reduce a posted body to the fields we understand.
 *
 * ⚠️ AN ARRAY TAKES ITS FIRST VALUE. A form with two inputs of the same name —
 * a hidden default and a visible override — posts both, and `String(array)`
 * would file a lead called "Ayesha,Ayesha Noor".
 *
 * ⚠️ AND AN EMPTY STRING IS NOT A VALUE. A form posts every input it has,
 * filled in or not; keeping `city: ''` would overwrite nothing but would make
 * the honeypot check read a present-but-empty trap as a bot.
 */
export function readIntakeFields(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (rawValue === null || rawValue === undefined) continue;
    const value = String(Array.isArray(rawValue) ? rawValue[0] : rawValue).trim();
    if (value === '') continue;

    const key = rawKey.trim();
    const mapped: IntakeField | undefined =
      (INTAKE_FIELDS as readonly string[]).includes(key)
        ? (key as IntakeField)
        : INTAKE_ALIASES[key.toLowerCase()];
    if (!mapped) continue;

    /* First one wins, and the loop sees documented names in whatever order the
       body had them — so an explicit `fullName` beats an aliased `name` only if
       it arrived first. Checked below. */
    if (!(mapped in out)) out[mapped] = value;
  }

  /* ⚠️ THE DOCUMENTED NAME WINS WHATEVER THE ORDER. A body carrying both
     `name` and `fullName` must not depend on which the site happened to write
     first — that is a bug that appears on one client's form and not another's. */
  for (const field of INTAKE_FIELDS) {
    const exact = input[field];
    if (exact === null || exact === undefined) continue;
    const value = String(Array.isArray(exact) ? exact[0] : exact).trim();
    if (value !== '') out[field] = value;
  }

  return out;
}
