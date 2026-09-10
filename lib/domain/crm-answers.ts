/* ============================================================================
 * WHAT THEY TOLD THE FORM, MADE READABLE — LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React.
 *
 * `crm_leads.answers` holds Meta's payload exactly as it arrived, and Meta
 * derives each key from the question text the advertiser typed. Verified on the
 * live table, 2026-09-10 — one real Chitral lead:
 *
 *     city                                  Chitral
 *     full_name                             Muhammad Qasim Tanha
 *     phone_number                          +923211912132
 *     are_you_looking_for_plots_&_villa_?   plots
 *     which__size_are_you_interested_in?_   10_marla_(commercial)
 *
 * Double underscores, a trailing underscore after a question mark, an ampersand,
 * and a choice answer that is a machine value. Printing those keys on a screen a
 * salesperson reads before ringing somebody would make them decode their own
 * CRM, so this module turns them into sentences.
 *
 * ── ⚠️ THE ORDER IS OURS, BECAUSE THE FORM'S ORDER IS ALREADY GONE ─────────
 * The obvious thing — show the answers in the order the form asked them — is not
 * available and it is worth knowing why, because the code to "fix" it would look
 * correct. `answers` is **jsonb**, and jsonb does not preserve key order: it
 * sorts keys by length and then bytewise. The row above came back city ·
 * full_name · phone_number · … which is length order, not the order the person
 * filled it in. Meta's original sequence was lost at INSERT, months before
 * anything read it.
 *
 * So this imposes an order and says so, rather than implying a fidelity it does
 * not have: **what they asked for first, how to reach them last.** A salesperson
 * opening a lead wants the qualifying answers — which plot, what size — and
 * already has the name and number in the header above.
 *
 * ⚠️ Storing a `jsonb[]` or an `answer_order` column would preserve it properly.
 * Not worth a migration for a screen that reads better in a chosen order anyway;
 * recorded here so the choice is visible rather than accidental.
 * ========================================================================= */

/** One answer, ready to render. */
export interface LeadAnswer {
  /** Meta's own key, kept as evidence and as a stable React key. */
  readonly key: string;
  /** The key turned back into the question a person was asked. */
  readonly question: string;
  /** The value as stored — exactly what they submitted. */
  readonly raw: string;
  /** The value tidied for reading. Equal to `raw` when nothing needed doing. */
  readonly answer: string;
  /**
   * True when this answer is already shown elsewhere on the record — the name,
   * the number, the city. See `orderedAnswers`.
   */
  readonly alsoOnRecord: boolean;
}

/* ⚠️ THE KEYS `lib/crm/lead-fields.ts` LIFTS INTO REAL COLUMNS. Kept in step
   with that module by hand, and deliberately so: this list decides only what
   sorts to the BOTTOM of a list, so drift makes a screen slightly worse rather
   than making a lead wrong. Matching by substring for the same reason the
   importer does — advertisers invent `contact_number` and `mobile`. */
const ON_RECORD = [
  'full_name',
  'first_name',
  'last_name',
  'middle_name',
  'name',
  'phone_number',
  'phone',
  'mobile',
  'contact_number',
  'whatsapp',
  'email',
  'city',
  'town',
] as const;

function isOnRecord(key: string): boolean {
  const lower = key.toLowerCase();
  return ON_RECORD.some((k) => lower === k || lower.includes(k));
}

/**
 * Meta's field key, turned back into the question.
 *
 * `which__size_are_you_interested_in?_` → `Which size are you interested in?`
 *
 * ⚠️ Falls back to the raw key rather than to a placeholder. A key that defeats
 * this should look odd on the screen, where somebody can see which question it
 * was, rather than disappear into "Question" where nobody can.
 */
export function humaniseFieldKey(key: string): string {
  const words = key
    .replace(/_/g, ' ')
    /* ⚠️ Punctuation loses the space the underscore left in front of it. Meta
       writes `…interested_in?_`, which becomes `interested in ? ` and would
       print with the question mark floating away from the sentence. */
    .replace(/\s+([?!.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (words === '') return key;

  /* Sentence case, not title case: only the first letter moves. "Are you
     looking for plots & villa?" is a question somebody asked; "Are You Looking
     For Plots & Villa?" is a headline, and the advertiser's own capitalisation
     inside the sentence is left exactly as they typed it. */
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A stored answer, tidied for reading.
 *
 * `10_marla_(commercial)` → `10 marla (commercial)`. Meta returns the machine
 * value of a choice, and the underscores are its own, not the person's.
 *
 * ⚠️ ONLY UNDERSCORES AND WHITESPACE. No capitalising, no reformatting: a
 * free-text answer is the lead's own words and a phone number is a phone number.
 * `raw` is carried alongside on every `LeadAnswer` so the screen can show what
 * was actually submitted when the two differ.
 */
export function humaniseAnswer(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every answer on a lead, in the order the record should read.
 *
 * What they asked about first; name, number and city last, because those are
 * already in the header. Within each group, by question, so the same form
 * always renders in the same order — see the header for why the form's own
 * order is not available.
 *
 * ⚠️ Blank values are dropped. The importer only stores answers that had a
 * value, but a lead edited by hand later could carry an empty string, and an
 * empty row under a question reads as "they answered and we lost it".
 */
export function orderedAnswers(answers: Record<string, string> | null | undefined): LeadAnswer[] {
  if (!answers) return [];

  const rows: LeadAnswer[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const raw = typeof value === 'string' ? value : String(value ?? '');
    if (raw.trim() === '') continue;

    rows.push({
      key,
      question: humaniseFieldKey(key),
      raw,
      answer: humaniseAnswer(raw),
      alsoOnRecord: isOnRecord(key),
    });
  }

  return rows.sort((a, b) => {
    if (a.alsoOnRecord !== b.alsoOnRecord) return a.alsoOnRecord ? 1 : -1;
    return a.question.localeCompare(b.question);
  });
}
