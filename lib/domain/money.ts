/* ============================================================================
 * MONEY, WRITTEN DOWN
 * ----------------------------------------------------------------------------
 * One place that turns a number into something a person reads.
 *
 * ── ⚠️ THE LOCALE IS PINNED, AND THAT IS NOT A PREFERENCE ───────────────────
 * `toLocaleString()` with no locale uses the runtime's own. The server's is
 * whatever the host is set to and the browser's is whatever the reader has —
 * so the same number renders as "1,20,000" on one side and "120,000" on the
 * other, React notices the text differs between the server render and the
 * hydration, and the console fills with a hydration mismatch. Every existing
 * money formatter in this codebase pins `'en-PK'` for exactly this reason.
 *
 * ── ⚠️ WHY THIS EXISTS WHEN FOUR OTHERS ALREADY DO ──────────────────────────
 * `ceo-report.ts:pkr`, `project-overview.tsx:money`, `contract-dialog.tsx:money`
 * and `package-fields.tsx:fee` are all near-identical. They are deliberately
 * LEFT ALONE — each is load-bearing on a screen the owner has signed off, and
 * consolidating them would be a wide diff across working code for no visible
 * gain. New finance code uses this module; nothing else is disturbed.
 * ========================================================================= */

const LOCALE = 'en-PK';

/** `PKR 120,000`. The full figure, for tables and totals. */
export function pkr(amount: number, currency = 'PKR'): string {
  const rounded = Math.round(amount);
  return `${currency} ${rounded.toLocaleString(LOCALE)}`;
}

/** `120,000` — no currency word, for a column that already has one in its header. */
export function plain(amount: number): string {
  return Math.round(amount).toLocaleString(LOCALE);
}

/**
 * `1.2M`, `805k`, `940`. For a tile where the full figure would not fit.
 *
 * ⚠️ Compacted, never rounded to nothing: below 1,000 the exact number is
 * printed. "0k" for 940 rupees would be a lie told to save four characters.
 */
export function pkrCompact(amount: number, currency = 'PKR'): string {
  const n = Math.abs(Math.round(amount));
  const sign = amount < 0 ? '−' : '';

  if (n >= 10_000_000) return `${sign}${currency} ${trim(n / 10_000_000)}Cr`;
  if (n >= 100_000) return `${sign}${currency} ${trim(n / 100_000)}L`;
  if (n >= 1_000) return `${sign}${currency} ${trim(n / 1_000)}k`;
  return `${sign}${currency} ${n.toLocaleString(LOCALE)}`;
}

/**
 * One decimal, but only when it says something: `1.2k` keeps its digit and
 * `2.0k` loses it, because a trailing zero reads as precision that is not there.
 */
function trim(value: number): string {
  const one = Math.round(value * 10) / 10;
  return Number.isInteger(one) ? String(one) : one.toFixed(1);
}

/**
 * `+PKR 42,000` / `−PKR 8,500`. For a figure whose SIGN is the point.
 *
 * ⚠️ A true minus sign (U+2212), not a hyphen. At the weight these figures are
 * set, a hyphen is easy to miss, and missing it inverts the meaning of a profit
 * line. The same character is used in `pkrCompact`.
 */
export function signed(amount: number, currency = 'PKR'): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return `${currency} 0`;
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${currency} ${Math.abs(rounded).toLocaleString(LOCALE)}`;
}
