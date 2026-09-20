import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ============================================================================
 * THE SALES TEAM ARE NOT MEMBERS OF THE PROJECTS THEY SELL
 * ----------------------------------------------------------------------------
 * `projects_select` is `app.project_is_visible(id)`, which needs project
 * MEMBERSHIP. A salesperson works a project's leads without ever being a member
 * of it — so a CRM query that reads `public.projects` directly returns **zero
 * rows** for exactly the people the screen is built for, and returns everything
 * for the admin who tests it.
 *
 * ⚠️ THIS HAS NOW SHIPPED THREE TIMES.
 *   1. The "Former member" bug.
 *   2. `listCrmProjects` — the desk said "No projects are visible to you yet"
 *      above six hundred readable leads. It carries a ⚠️ about it to this day.
 *   3. 2026-09-20, `knowledgeBoard` — measured as Sarah, a direct read of the
 *      demo project returned 0 rows, the board came back null, and the owner
 *      watched *"Reading this project's knowledge…"* spin for ever.
 *
 * Knowing about it did not prevent the third one. So it is a test.
 *
 * ⚠️ AND ONLY THE CRM MODULES. Tasks, finance and documents read `projects`
 * directly and are right to: their callers ARE members. A blanket ban would be a
 * rule that is wrong more often than it is right.
 * ========================================================================= */

const ROOT = process.cwd();
const QUERIES = join(ROOT, 'lib', 'db', 'queries');

/** `from public.projects`, but not inside a comment. */
function directReads(sql: string): number[] {
  const lines = sql.split(String.fromCharCode(10));
  const found: number[] = [];
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
    if (code.includes('//')) code = code.slice(0, code.indexOf('//'));

    /* `join public.projects` is the same read by another name. */
    if (/\b(from|join)\s+public\.projects\b/i.test(code)) found.push(i + 1);
  });

  return found;
}

describe('a CRM query never reads public.projects directly', () => {
  it('finds none in lib/db/queries/crm-*.ts', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(QUERIES)) {
      if (!/^crm-.*\.ts$/.test(file)) continue;
      const sql = readFileSync(join(QUERIES, file), 'utf8');
      for (const line of directReads(sql)) {
        offenders.push(
          `lib/db/queries/${file}:${line} — reads public.projects directly; ` +
            'the sales team are not members, so this returns zero rows for them. ' +
            'Use app.crm_project_name() or app.crm_project_options().',
        );
      }
    }

    expect(offenders, offenders.join(String.fromCharCode(10))).toEqual([]);
  });

  it('would have caught the query that hung the knowledge screen', () => {
    const asShipped = `
      const projects = (await tx\`
        select p.id, p.name from public.projects p where p.id = \${projectId}::uuid
      \`);
    `;
    expect(directReads(asShipped)).toHaveLength(1);
  });

  it('does not trip on the warning comments that explain the rule', () => {
    /* Every one of these files carries a ⚠️ naming the table. A guard that
       cannot tell documentation from code makes the documentation impossible. */
    const commented = `
      /* ⚠️ NOT select … from public.projects — see the note. */
      const rows = await tx\`select * from app.crm_project_options()\`;
    `;
    expect(directReads(commented)).toEqual([]);
  });

  it('catches a join as well as a from', () => {
    expect(directReads('join public.projects p on p.id = l.project_id')).toHaveLength(1);
  });
});
