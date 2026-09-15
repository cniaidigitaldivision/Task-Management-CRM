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
}

const SOURCES: Record<string, SourceMeta> = {
  meta_lead_ad: { label: 'Meta', defaultDetail: 'Lead ad', token: 'chart-1' },
  facebook: { label: 'Facebook', defaultDetail: 'Lead ad', token: 'chart-1' },
  instagram: { label: 'Instagram', defaultDetail: 'Lead ad', token: 'status-review' },
  google: { label: 'Google', defaultDetail: 'Search ad', token: 'gold-700' },
  linkedin: { label: 'LinkedIn', defaultDetail: 'Lead ad', token: 'status-backlog' },
  website: { label: 'Website', defaultDetail: 'Contact form', token: 'accent-primary' },
  whatsapp: { label: 'WhatsApp', defaultDetail: 'Direct message', token: 'feedback-success' },
  referral: { label: 'Referral', defaultDetail: 'Existing client', token: 'chart-4' },
  walk_in: { label: 'Walk-in', defaultDetail: 'Office visit', token: 'chart-2' },
  import: { label: 'Imported', defaultDetail: 'Bulk file', token: 'neutral-500' },
  manual: { label: 'Added by hand', defaultDetail: null, token: 'neutral-500' },
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
