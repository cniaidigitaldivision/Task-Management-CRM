import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ============================================================================
 * SQL THAT TRAVELLED AS A PARAMETER — 2026-09-19
 * ----------------------------------------------------------------------------
 * Recording an outcome that closed a lead, noted a reply, or paused a chase
 * threw **RangeError: Invalid time value** and rolled the whole thing back —
 * the stage change, the timeline row and the salesperson's note with it.
 *
 * The cause was four characters that read like SQL and were not:
 *
 *     paused_at = $-{closing ? null : 'now()'}::timestamptz
 *
 * Everything inside a template hole is a BOUND VALUE. postgres.js saw the
 * ::timestamptz cast, chose its timestamptz serializer, and called
 * new Date('now()').toISOString() — which raises before a byte reaches
 * Postgres. Proved both ways against the live database: the old shape throws,
 * and `case when $-{closing}::boolean then now() else null end` returns a
 * timestamp on one branch and a null on the other.
 *
 * ⚠️ TYPES CANNOT SEE THIS. A string is a perfectly good parameter, the cast is
 * a plain suffix on a template literal, and nothing evaluates the statement at
 * compile time. It shipped, and it only broke on the branch nobody had tested —
 * which is why the guard below is a grep rather than a type.
 *
 * (The hyphens above keep this comment out of the sweep's own results.)
 * ========================================================================= */

/** Functions that are SQL, not values — none of them may be a bound parameter. */
const SQL_FUNCTIONS = ['now()', 'current_timestamp', 'current_date', 'localtimestamp'] as const;

/** One of those, quoted, inside a template hole. */
const QUOTED_IN_A_HOLE = new RegExp(
  '\\$\\{[^}]*([\'"`])\\s*(' +
    SQL_FUNCTIONS.map((fn) => fn.replace(/[()]/g, '\\$&')).join('|') +
    ')\\s*\\1',
  'i',
);

const ROOT = process.cwd();
const LOOK_IN = ['app', 'lib', 'components'];
const THIS_FILE = 'sql-in-a-parameter.test.ts';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no SQL function is passed as a bound value', () => {
  it('finds none in app, lib or components', () => {
    const offenders: string[] = [];

    for (const file of LOOK_IN.flatMap((d) => sourceFiles(join(ROOT, d)))) {
      if (file.endsWith(THIS_FILE)) continue;
      const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));

      /* ⚠️ A COMMENT IS NOT A STATEMENT, AND "starts with a star" IS NOT ENOUGH.
         The fix's own explanation quotes the line that threw, across several
         lines of one block — and the continuation lines start with words. So the
         comment is actually stripped, block state carried between lines, and
         what is left of each line is what gets tested. A guard that cannot tell
         documentation from code makes the documentation impossible to write. */
      let inBlock = false;
      lines.forEach((raw, i) => {
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
        const line = code.includes('//') ? code.slice(0, code.indexOf('//')) : code;

        if (QUOTED_IN_A_HOLE.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} — ${raw.trim()}`);
        }
      });
    }

    expect(offenders, offenders.join(String.fromCharCode(10))).toEqual([]);
  });

  it('would have caught the statement that threw', () => {
    /* The line from `recordOutcomeAction`, kept as the specimen it is. */
    const specimen = 'paused_at = ${closing ? null : \'now()\'}::timestamptz,';
    expect(QUOTED_IN_A_HOLE.test(specimen)).toBe(true);
    expect(QUOTED_IN_A_HOLE.test('stopped_at = ${closing ? "now()" : null}::timestamptz,')).toBe(true);
  });

  it('leaves real SQL alone', () => {
    expect(QUOTED_IN_A_HOLE.test('updated_at = now(),')).toBe(false);
    expect(
      QUOTED_IN_A_HOLE.test('paused_at = case when ${closing}::boolean then null else now() end,'),
    ).toBe(false);
    /* A value that merely sits next to the words is not one of them. */
    expect(QUOTED_IN_A_HOLE.test('occurred_at = ${when}::timestamptz,')).toBe(false);
  });
});
