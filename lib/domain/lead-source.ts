/* ============================================================================
 * WHERE A LEAD CAME FROM
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-14: *"Source will be an important part… the meta leads are from
 * Facebook or Instagram. Definitely maybe some source in the next future, maybe
 * from Google or somewhere else."*
 *
 * ── ⚠️ A CHANNEL AND A DETAIL, NOT ONE LONG ENUM — migration 148 ───────────
 * The channel is a closed set and belongs in the database enum. What KIND of
 * source it was — "Lead ad", "Search ad", "Contact form", "Existing client" — is
 * open, sales-team vocabulary, and lives in `source_detail` as free text.
 * Enumerating every channel × type pair is how an enum reaches thirty values
 * nobody can read, and how "Performance Max" becomes a migration.
 *
 * ── ⚠️ `meta_lead_ad` IS NOT FACEBOOK ──────────────────────────────────────
 * All 643 imported leads carry it, and Meta's lead payload never says whether
 * the ad ran on Facebook or Instagram. So it renders as "Meta" — the truth —
 * rather than being guessed into one of the two. New leads can be filed under
 * `facebook` or `instagram` when something real says which.
 * ========================================================================= */

export interface SourceMeta {
  readonly label: string;
  /** What it usually is, when the row has no `source_detail` of its own. */
  readonly defaultDetail: string | null;
  /** A design token for the mark. */
  readonly token: string;
  /**
   * The brand slug to draw, resolved across `PLATFORM_MARKS` and
   * `SERVICE_MARKS`.
   *
   * ⚠️ IT LIVES HERE, BESIDE THE LABEL, AND THAT IS THE POINT. Owner,
   * 2026-09-15: *"It should be dynamic such that it should know which logo to
   * use with which type of source."* The icon briefly had its own lookup table
   * in a component; two tables keyed by the same thing drift, and the way they
   * drift is that somebody adds a source to one of them. A source added to THIS
   * record gets its label, its default detail and its logo in one edit.
   *
   * `null` means the source is not a company — a walk-in and a referral are
   * events, not brands, and inventing a badge for them would be a lie drawn as
   * an icon. Those fall through to a plain glyph.
   */
  readonly mark: string | null;
}

const SOURCES: Record<string, SourceMeta> = {
  /* ⚠️ `meta` IS THE HONEST MARK FOR `meta_lead_ad`, not Facebook's. Checked
     again 2026-09-15 against all 636 imported payloads: they carry the form
     answers and nothing else — no platform field — so which of the two apps the
     ad ran on is genuinely unknown for every historical lead. Drawing the
     Facebook logo would be a guess printed as a fact. New leads can be filed
     under `facebook` or `instagram` when something real says which. */
  meta_lead_ad: { label: 'Meta', defaultDetail: 'Lead ad', token: 'chart-1', mark: 'meta' },
  facebook: { label: 'Facebook', defaultDetail: 'Lead ad', token: 'chart-1', mark: 'facebook' },
  instagram: { label: 'Instagram', defaultDetail: 'Story ad', token: 'status-review', mark: 'instagram' },
  google: { label: 'Google', defaultDetail: 'Search ad', token: 'gold-700', mark: 'google' },
  linkedin: { label: 'LinkedIn', defaultDetail: 'Lead gen form', token: 'status-backlog', mark: 'linkedin' },
  website: { label: 'Website', defaultDetail: 'Contact form', token: 'accent-primary', mark: null },
  whatsapp: { label: 'WhatsApp', defaultDetail: 'Direct message', token: 'feedback-success', mark: 'whatsapp' },
  referral: { label: 'Referral', defaultDetail: 'Existing client', token: 'chart-4', mark: null },
  walk_in: { label: 'Walk-in', defaultDetail: 'Office visit', token: 'chart-2', mark: null },
  import: { label: 'Imported', defaultDetail: 'Bulk file', token: 'neutral-500', mark: null },
  manual: { label: 'Added by hand', defaultDetail: null, token: 'neutral-500', mark: null },
};

export function sourceLabel(source: string | null): string {
  if (!source) return 'Unknown';
  /* ⚠️ An unrecognised value shows ITSELF rather than "Other". A source added to
     the enum and forgotten here should look odd on screen, not vanish into a
     word that conceals which one it was — the same rule `stageLabel` follows. */
  return SOURCES[source]?.label ?? source;
}

/**
 * The second line: what kind of source it was.
 *
 * ⚠️ THE ROW'S OWN VALUE WINS. `source_detail` is what somebody actually
 * recorded; the default is only a sensible guess for rows that predate the
 * column, and it must never overwrite a real answer.
 */
export function sourceDetail(source: string | null, detail: string | null): string | null {
  const own = detail?.trim();
  if (own) return own;
  return source ? (SOURCES[source]?.defaultDetail ?? null) : null;
}

export function sourceToken(source: string | null): string {
  return (source && SOURCES[source]?.token) || 'neutral-500';
}

/** Every channel a lead can be filed under, for a picker. */
export const SOURCE_OPTIONS = Object.entries(SOURCES).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

/**
 * The brand slug for this source, or null when it has no logo.
 *
 * ⚠️ AN UNKNOWN SOURCE RETURNS NULL rather than guessing a slug from its name.
 * `PlatformIcon` renders a grey monogram tile for a slug it cannot resolve —
 * which LOOKS like a logo and is not one, so a wrong guess here ships as a
 * plausible wrong mark rather than an obvious blank.
 */
export function sourceMark(source: string | null): string | null {
  if (!source) return null;
  return SOURCES[source]?.mark ?? null;
}
