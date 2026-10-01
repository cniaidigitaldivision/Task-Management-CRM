/* ============================================================================
 * IMPORTING A SHEET — THE VOCABULARY BOTH IMPORTERS SHARE
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React.
 *
 * ── ⚠️ WHY THIS FILE EXISTS ────────────────────────────────────────────────
 * `crm-property.ts` defined `ImportIssue`, `ImportTally` and `tallyImport` for
 * the property catalogue. The lead importer needs exactly the same three, and
 * copying eight lines would have been the cheapest thing to do today and the
 * most expensive thing to live with: two definitions of "ready" is how one
 * wizard comes to say 148 and the other 149 about the same 150-row file, and
 * nobody can tell which is lying.
 *
 * The lesson is the one the reports module learned an hour earlier — `sources`
 * and `channels` share one row type so that two definitions of "contacted"
 * cannot grow between them. Same rule, applied before the drift rather than
 * after.
 * ========================================================================= */

/**
 * One thing wrong with one row.
 *
 * ⚠️ THREE SEVERITIES, NOT TWO, AND THEY ARE THREE DIFFERENT ANSWERS.
 * An **error** means the row cannot become a record at all. A **warning** means
 * it can, but somebody should look. A **duplicate** is neither: it is a fact
 * about the row's relationship to what is already there, and whether it blocks
 * depends on an option the person chooses.
 *
 * Folding duplicates into errors was tried on the property importer and made a
 * clean round trip read as 38 failures.
 */
export interface ImportIssue {
  readonly line: number;
  readonly severity: 'error' | 'warning' | 'duplicate';
  readonly text: string;
}

export interface ImportTally {
  readonly ready: number;
  readonly errors: number;
  readonly warnings: number;
  readonly duplicates: number;
}

/**
 * The four count tiles.
 *
 * ⚠️ `ready` COUNTS ROWS, THE REST COUNT ISSUES. One row can carry three errors;
 * it is still one row that will not import. Counting issues for `ready` too
 * would make "148 ready of 150" arithmetic that does not add up, and a reader
 * checking it would be right to distrust the whole screen.
 */
export function tallyImport(rows: number, issues: readonly ImportIssue[]): ImportTally {
  const linesWithErrors = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.line));
  return {
    ready: Math.max(0, rows - linesWithErrors.size),
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    duplicates: issues.filter((i) => i.severity === 'duplicate').length,
  };
}
