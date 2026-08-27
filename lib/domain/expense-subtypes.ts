/* ============================================================================
 * WHAT KIND OF BILL, EXACTLY
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"If I say that it's a utility bill, how can I know if it's
 * an electricity bill, a gas bill, something like maintenance, or anything? If
 * utility, then give options [...] If he says none of those, then select 'Other'
 * and mention what it is."*
 *
 * A second level under the broad categories, offered only where it means
 * something. `office_rent` has no sub-list — rent is rent.
 *
 * ── ⚠️ EVERY LIST ENDS IN `other`, AND THAT IS NOT A FALLBACK ──────────────
 * It is the point. A fixed list that cannot express what actually happened gets
 * filled in with the nearest wrong answer, and then the analysis is confidently
 * false. `other` plus a required free-text note keeps the figure honest and
 * tells whoever curates this list what to add next.
 *
 * ── ⚠️ AI TOOLS ARE NOT HERE ────────────────────────────────────────────────
 * They live in `public.subscriptions`, which is a TABLE so the owner can add one
 * without a deploy (migration 032's rule). The form reads that list. Duplicating
 * the tool names here would create a second source of truth that silently drifts
 * from the one the seat board and the monthly run both use.
 * ========================================================================= */

export interface SubtypeOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Sub-lists by category slug.
 *
 * ⚠️ Keyed on the slug from migration 064's seed. That migration's column
 * comment says those slugs are read from application code and must not be
 * renamed; this is one of the places that does it.
 */
export const EXPENSE_SUBTYPES: Readonly<Record<string, readonly SubtypeOption[]>> = {
  utilities: [
    { value: 'electricity', label: 'Electricity' },
    { value: 'gas', label: 'Gas' },
    { value: 'water', label: 'Water' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'security', label: 'Security / guard' },
    { value: 'cleaning', label: 'Cleaning' },
    { value: 'other', label: 'Other — say what' },
  ],
  internet: [
    { value: 'fibre', label: 'Fibre line' },
    { value: 'backup', label: 'Backup connection' },
    { value: 'mobile_data', label: 'Mobile data' },
    { value: 'other', label: 'Other — say what' },
  ],
  equipment: [
    { value: 'computer', label: 'Computer / laptop' },
    { value: 'peripheral', label: 'Peripheral — headphones, mouse' },
    { value: 'camera', label: 'Camera / lighting' },
    { value: 'furniture', label: 'Furniture' },
    { value: 'phone', label: 'Phone / tablet' },
    { value: 'repair', label: 'Repair' },
    { value: 'other', label: 'Other — say what' },
  ],
  software_other: [
    { value: 'workspace', label: 'Google Workspace' },
    { value: 'hosting', label: 'Hosting / domain' },
    { value: 'design', label: 'Design software' },
    { value: 'security', label: 'Security / VPN' },
    { value: 'other', label: 'Other — say what' },
  ],
  marketing: [
    { value: 'ads', label: 'Paid ads' },
    { value: 'print', label: 'Print / collateral' },
    { value: 'event', label: 'Event / sponsorship' },
    { value: 'influencer', label: 'Influencer / creator' },
    { value: 'other', label: 'Other — say what' },
  ],
  travel: [
    { value: 'fuel', label: 'Fuel' },
    { value: 'fare', label: 'Fare — taxi, flight, bus' },
    { value: 'lodging', label: 'Lodging' },
    { value: 'meals', label: 'Meals' },
    { value: 'other', label: 'Other — say what' },
  ],
  office_rent: [
    { value: 'rent', label: 'Monthly rent' },
    { value: 'deposit', label: 'Deposit / advance' },
    { value: 'other', label: 'Other — say what' },
  ],
  misc: [{ value: 'other', label: 'Other — say what' }],
};

/** The sub-list for a category, or an empty list where it has none. */
export function subtypesFor(categorySlug: string): readonly SubtypeOption[] {
  return EXPENSE_SUBTYPES[categorySlug] ?? [];
}

/**
 * A stored subtype turned back into something readable.
 *
 * ⚠️ Falls back to the raw value rather than to "Unknown". A subtype that was
 * removed from the list above still describes a real row, and printing
 * "Unknown" over `electricity` would lose information the database still holds.
 */
export function subtypeLabel(
  categorySlug: string,
  subtype: string | null,
  other: string | null,
): string | null {
  if (!subtype) return null;
  if (subtype === 'other') return other?.trim() || 'Other';
  const found = subtypesFor(categorySlug).find((option) => option.value === subtype);
  return found?.label ?? subtype;
}

/**
 * The category whose sub-list is the tool catalogue rather than one of the
 * lists above. Read by the form to decide which control to show.
 */
export const TOOL_CATEGORY_SLUG = 'ai_subscriptions';

/** Categories the monthly run owns; never offered on the filing form. */
export const POSTED_ONLY_SLUGS: ReadonlySet<string> = new Set(['salaries']);
