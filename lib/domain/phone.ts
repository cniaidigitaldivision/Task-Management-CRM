/* ============================================================================
 * PHONE NUMBERS, NORMALISED — LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no framework.
 *
 * ── ⚠️ WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 * The same person types `0300-1234567` into one lead form and `+92 300 1234567`
 * into the next. Stored as typed, those are two unrelated strings, and three
 * things quietly stop working:
 *
 *   · duplicate detection finds nothing, so two salespeople ring one person
 *   · the WhatsApp link fails, because wa.me needs digits with a country code
 *   · "find the lead for this caller" cannot be answered from a ringing phone
 *
 * So `crm_leads` keeps both: `phone` exactly as they typed it — because that is
 * what they wrote and it is evidence — and `phone_e164` derived, indexed, and
 * matched on.
 *
 * ── ⚠️ PAKISTAN-FIRST, AND HONEST ABOUT IT ─────────────────────────────────
 * This division's leads are Pakistani, with the occasional Saudi number from the
 * KSA campaign. A full E.164 library would be ~200 KB to handle countries that
 * will never appear. So: the local formats are understood properly, anything
 * already carrying a `+` and a plausible country code is kept, and anything else
 * returns **null** rather than a guess.
 *
 * Null is a real answer. A number this cannot parse still lives in `phone`, and
 * the interface shows it — it simply does not pretend to have normalised it.
 * A wrong normalisation is worse than none: it merges two different people.
 * ========================================================================= */

/** Pakistan. `03xxxxxxxxx` locally, `+923xxxxxxxxx` in E.164. */
const PK_CC = '92';

/**
 * A number in E.164 (`+923001234567`), or null when it cannot be parsed with
 * confidence.
 *
 * ⚠️ Returns null rather than guessing. See the header — a wrong normalisation
 * merges two people into one lead, which is the one failure that cannot be
 * undone by looking at the raw value later.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  /* Everything that is not a digit or a leading plus is noise: spaces, dashes,
     brackets, and the `/` people use for a second number. */
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) return null;

  /* ── Already international ─────────────────────────────────────────────── */
  if (hasPlus) {
    /* ⚠️ A plus does not make it valid. E.164 allows at most 15 digits and no
       real number is under 8; outside that it is a typo or a form field
       somebody pasted a sentence into. */
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  /* ── 0092… — the international prefix typed the old way ────────────────── */
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    if (rest.length < 8 || rest.length > 15) return null;
    return `+${rest}`;
  }

  /* ── 92300… — country code without the plus ────────────────────────────── */
  if (digits.startsWith(PK_CC) && digits.length === 12) {
    return `+${digits}`;
  }

  /* ── 03001234567 — how a Pakistani mobile is written locally ───────────── */
  if (digits.startsWith('0') && digits.length === 11) {
    return `+${PK_CC}${digits.slice(1)}`;
  }

  /* ── 3001234567 — the leading zero dropped, which forms often do ───────── */
  if (digits.startsWith('3') && digits.length === 10) {
    return `+${PK_CC}${digits}`;
  }

  /* ⚠️ Anything else is a landline, a foreign number with no prefix, two
     numbers in one box, or a typo. Null, and the raw value is kept. */
  return null;
}

/**
 * The digits WhatsApp wants — no plus, no punctuation.
 *
 * `wa.me/923001234567` opens a chat with that person and needs no integration,
 * no API and no approval. It is the whole of the WhatsApp feature until a
 * Business Platform number exists.
 */
export function whatsAppDigits(raw: string | null | undefined): string | null {
  const e164 = toE164(raw);
  return e164 ? e164.slice(1) : null;
}

/**
 * How a number should be shown to somebody in Pakistan.
 *
 * `+923001234567` → `0300 1234567`, because that is the form a person reads
 * back off a screen and dials. Foreign numbers keep their international form,
 * since a local rendering of one would be wrong.
 */
export function displayPhone(e164: string | null | undefined, raw?: string | null): string {
  if (!e164) return raw?.trim() || '—';

  if (e164.startsWith(`+${PK_CC}`) && e164.length === 13) {
    const local = e164.slice(3);
    return `0${local.slice(0, 3)} ${local.slice(3)}`;
  }
  return e164;
}
