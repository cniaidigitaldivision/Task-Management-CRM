/* ============================================================================
 * NUMBER FORMATS — named, not passed as functions
 * ----------------------------------------------------------------------------
 * Every chart and every counting figure needs to know how to print a number, and
 * the obvious API for that is a `format` callback. It does not work here, and the
 * reason is worth writing down because it will be reached for again.
 *
 * ── WHY A NAME AND NOT A FUNCTION ────────────────────────────────────────────
 * The charts and `CountUp` are Client Components, and almost every caller is a
 * Server Component — a page. **A function cannot cross that boundary.** React
 * refuses it outright: *"Functions cannot be passed directly to Client Components
 * unless you explicitly expose it by marking it with 'use server'."*
 *
 * Found the hard way: the design-system page returned HTTP 500 with a
 * `format={(n) => n.toFixed(1)}` on one figure. Typecheck and lint both passed,
 * because the type is correct — it is the serialisation boundary that is not, and
 * only rendering the page finds it. A `format` prop typed as a function is
 * therefore a trap: it works from a client caller, fails from a server one, and
 * the dashboard is a server one.
 *
 * So the prop is one of these names, the component resolves it here, and the same
 * figure prints the same way on every screen — which a per-caller lambda never
 * guaranteed anyway.
 * ========================================================================= */

export type NumberFormat =
  /** Whole numbers — counts of tasks, projects, people. The default. */
  | 'integer'
  /** One decimal place. Rates and averages that would round to something wrong. */
  | 'decimal'
  /** One decimal place and a per-cent sign. Expects 0–100, not 0–1. */
  | 'percent'
  /** Hours, to one decimal, with the unit. Time logged. */
  | 'hours'
  /** Effort points, whole, with the unit. */
  | 'points'
  /** Thousands as `1.2k`. For an axis, where four digits per tick will not fit. */
  | 'compact'
  /**
   * Whole rupees, grouped — `4,446,000`.
   *
   * ⚠️ ADDED because `integer` prints `4446000`, and a seven-digit figure with no
   * separators is one a reader has to count digits on. That is fine for a task
   * count, which is what `integer` was written for, and not fine for money —
   * seen on the finance page's own hero tiles.
   *
   * `integer` is deliberately UNCHANGED: it is the default for every chart and
   * counter in the product, and putting commas into task counts would be a wide
   * visual change nobody asked for.
   */
  | 'money';

/**
 * Prints a number in the named form.
 *
 * ── WHY THESE ARE HAND-ROLLED AND NOT `Intl.NumberFormat` ────────────────────
 * `Intl` would localise the decimal separator and the grouping, which sounds like
 * a feature until an axis silently renders `1,2k` in one browser locale and
 * `1.2k` in another and the two disagree on the same screen. This application has
 * one language and these strings sit in charts, where consistency between two
 * panels matters more than matching a device's regional setting.
 *
 * Non-finite input prints an em dash rather than `NaN`. A gap in the data should
 * read as a gap, and `NaN` on a dashboard reads as a broken dashboard.
 */
export function formatNumber(value: number, kind: NumberFormat = 'integer'): string {
  if (!Number.isFinite(value)) return '—';

  switch (kind) {
    case 'decimal':
      return value.toFixed(1);
    case 'percent':
      /* Whole percentages lose their decimal: "94%" rather than "94.0%". An axis
         of tenths keeps it, because 94.0 and 94.6 must not print alike. */
      return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
    case 'hours':
      return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
    case 'points':
      return `${Math.round(value)} pts`;
    case 'compact': {
      const magnitude = Math.abs(value);
      if (magnitude >= 1_000_000) return `${trim(value / 1_000_000)}m`;
      if (magnitude >= 1_000) return `${trim(value / 1_000)}k`;
      return trim(value);
    }
    case 'money':
      return group(Math.round(value));
    case 'integer':
    default:
      return String(Math.round(value));
  }
}

/**
 * `4446000` → `4,446,000`.
 *
 * ⚠️ Hand-rolled rather than `toLocaleString`, for the reason given at the top of
 * this file — and with a second reason here: several `en-*` locales group by the
 * lakh/crore system (`44,46,000`). Two panels rendering the same figure
 * differently because one ran on the server and one in the browser is exactly
 * the failure this module exists to prevent.
 */
function group(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(value));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    /* A comma before every third digit counting from the right, never leading. */
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return negative ? `−${out}` : out;
}

/** One decimal, but only when it says something: 1.2k, and 5k rather than 5.0k. */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
