import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ============================================================================
 * JSON.stringify(x)::jsonb STORES A STRING, AND NEVER ERRORS
 * ----------------------------------------------------------------------------
 * postgres.js serialises a json parameter itself, so pre-stringifying encodes it
 * TWICE and the column ends up holding a JSON *string* rather than the object it
 * spells. Nothing raises. The row looks right in a log and is wrong in the
 * database.
 *
 * Measured 2026-09-20, after the same family of bug threw
 * `cannot call json_to_recordset on a scalar` on a new query:
 *   · `crm_reports.payload` — both stored reports had jsonb_typeof = 'string',
 *     and the reader casts `row.payload as Report`: an object-shaped lie.
 *   · `crm_lead_insights.talking_points` — the reader asks `Array.isArray()`,
 *     which is false for a string, so the panel silently showed no talking
 *     points at all, indistinguishable from the model returning none.
 *
 * It had already cost a week on project type_fields (registry C-22), and FOUR
 * files carry a written warning about it. Two more did it anyway, which is the
 * argument for a test rather than another comment.
 *
 * ⚠️ THE FIX IS `tx.json(value)` — the driver encodes it exactly once.
 *
 * ── ⚠️ AND WHY THE OTHER TEMPLATE TRAP IS NOT TESTED HERE ──────────────────
 * A backtick inside a SQL comment ends the template, and it has now happened six
 * times. It is not guarded because it CANNOT SHIP: the file stops compiling, so
 * `tsc` is already the guard. The cost is diagnosis, not defects — it blames a
 * line two statements away. A heuristic that tried to find "inside a tagged
 * template" without lexing flagged twenty-three innocent lines in
 * `app/actions/crm-leads.ts` on its first run; a guard with that many false
 * positives is deleted within the week and teaches nothing. The note stays in
 * `docs/` and in memory instead.
 * ========================================================================= */

const ROOT = process.cwd();
const THIS_FILE = 'sql-template-traps.test.ts';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `JSON.stringify(...)` cast straight to json or jsonb in a template hole. */
const DOUBLE_ENCODED = /\$\{[^}]*JSON\.stringify\([^}]*\}\s*::\s*jsonb?\b/i;

describe('JSON is never stringified before it is bound', () => {
  it('finds none in app or lib', () => {
    const offenders: string[] = [];
    for (const file of ['app', 'lib'].flatMap((d) => sourceFiles(join(ROOT, d)))) {
      if (file.endsWith(THIS_FILE)) continue;

      /* ⚠️ A COMMENT IS NOT A STATEMENT. The fix for this very bug explains
         itself by quoting the line that was wrong — and on this guard's first
         run its only "offender" was that explanation. A guard that cannot tell
         documentation from code makes the documentation impossible to write,
         which is the same reasoning `sql-in-a-parameter.test.ts` carries. */
      let inBlock = false;
      readFileSync(file, 'utf8').split(String.fromCharCode(10)).forEach((raw, i) => {
        let code = raw;
        if (inBlock) {
          const ends = code.indexOf('*/');
          if (ends === -1) return;
          code = code.slice(ends + 2);
          inBlock = false;
        }
        code = code.replace(/\/\*.*?\*\//g, ' ');
        const opens = code.indexOf('/*');
        if (opens !== -1) {
          inBlock = true;
          code = code.slice(0, opens);
        }
        if (code.includes('//')) code = code.slice(0, code.indexOf('//'));

        if (DOUBLE_ENCODED.test(code)) {
          offenders.push(
            `${file.slice(ROOT.length + 1)}:${i + 1} — stores a JSON string, not JSON. Use tx.json(value).`,
          );
        }
      });
    }
    expect(offenders, offenders.join(String.fromCharCode(10))).toEqual([]);
  });

  it('would have caught both of the live ones', () => {
    expect(DOUBLE_ENCODED.test('      ${JSON.stringify(report)}::jsonb,')).toBe(true);
    expect(DOUBLE_ENCODED.test('        ${JSON.stringify(insight.talkingPoints)}::jsonb,')).toBe(true);
  });

  it('catches ::json as well as ::jsonb', () => {
    expect(DOUBLE_ENCODED.test('from json_to_recordset(${JSON.stringify(rows)}::json)')).toBe(true);
  });

  it('leaves tx.json alone', () => {
    expect(DOUBLE_ENCODED.test('      ${tx.json(report)},')).toBe(false);
  });

  it('leaves a stringify that is not bound as JSON alone', () => {
    /* Writing a JSON blob into a TEXT column is a different, legitimate thing. */
    expect(DOUBLE_ENCODED.test('      ${JSON.stringify(payload)}::text,')).toBe(false);
  });
});
