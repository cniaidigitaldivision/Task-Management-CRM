import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ============================================================================
 * A SUPERSEDED APPOINTMENT IS NOT A VISIT — 2026-09-19
 * ----------------------------------------------------------------------------
 * Owner, on an Appointments (2) holding one site visit: *"These are not two
 * separate visits."* They were one visit; the old reschedule wrote a second row
 * and marked the first `rescheduled`.
 *
 * 225 made rescheduling move the row instead, so no new superseded rows are
 * written — but the old ones exist, and every list that reads
 * `crm_appointments` has to agree about them or the screen contradicts itself.
 *
 * ⚠️ AND THIS IS THE SECOND TIME THE SAME DISAGREEMENT SHIPPED. First the
 * dialog's own query was filtered and the drawer's was not, so opening
 * Appointments showed TWO rows, redrew, and settled on one — the owner watched
 * it happen: *"it first shows me the two appointments (rendering, rendering,
 * rendering) and then shows me the real one."* A panel drawn from rows the page
 * already holds (Rule Zero, law 3) is only instant if those rows say the same
 * thing the full read will.
 *
 * So the rule is not "remember to filter". It is this test: every read of
 * `crm_appointments` that builds a list must exclude superseded rows, whether by
 * naming them or by listing the statuses it wants.
 * ========================================================================= */

const ROOT = process.cwd();
const QUERIES = join(ROOT, 'lib', 'db', 'queries');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The statements that READ a list of appointments, with their `where` clause.
 *
 * ⚠️ READS ONLY. An `insert`, an `update` or a `delete` naming the table is not
 * a list and must not be dragged into this rule — an update that touched only
 * live rows would be a different bug.
 */
function appointmentReads(sql: string): string[] {
  const out: string[] = [];
  const from = /from\s+public\.crm_appointments\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = from.exec(sql)) !== null) {
    const before = sql.slice(Math.max(0, m.index - 400), m.index).toLowerCase();
    /* The nearest preceding verb decides what this is. */
    const verb = ['insert into', 'update', 'delete from']
      .map((v) => ({ v, at: before.lastIndexOf(v) }))
      .concat([{ v: 'select', at: before.lastIndexOf('select') }])
      .sort((a, b) => b.at - a.at)[0];
    if (!verb || verb.at === -1 || verb.v !== 'select') continue;

    /* Up to the end of the statement: the next `;`, the closing backtick of the
       tagged template, or 900 characters, whichever comes first. */
    const rest = sql.slice(m.index, m.index + 900);
    out.push(rest);
  }
  return out;
}

/** Does this statement already exclude superseded rows, however it says so? */
function excludesSuperseded(statement: string): boolean {
  const s = statement.toLowerCase();
  if (/status\s*(<>|!=)\s*'rescheduled'/.test(s)) return true;
  if (/status\s+not\s+in\s*\([^)]*'rescheduled'[^)]*\)/.test(s)) return true;
  /* An allow-list that never mentions it is just as safe — and safer, because a
     new superseded-ish status is excluded by default. */
  if (/status\s+in\s*\(([^)]*)\)/.test(s)) {
    const allowed = /status\s+in\s*\(([^)]*)\)/.exec(s)?.[1] ?? '';
    return !allowed.includes('rescheduled');
  }
  /* Reading ONE appointment by its id is not a list. */
  if (/where\s+[a-z]*\.?id\s*=/.test(s)) return true;
  return false;
}

describe('no list shows an appointment that was superseded', () => {
  it('every read of crm_appointments excludes rescheduled rows', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(QUERIES)) {
      const sql = readFileSync(file, 'utf8');
      for (const statement of appointmentReads(sql)) {
        if (excludesSuperseded(statement)) continue;
        const line = sql.slice(0, sql.indexOf(statement.slice(0, 60))).split(String.fromCharCode(10)).length;
        offenders.push(
          `${file.slice(ROOT.length + 1)}:${line} — reads crm_appointments without excluding superseded rows`,
        );
      }
    }

    expect(offenders, offenders.join(String.fromCharCode(10))).toEqual([]);
  });

  it('recognises each way of saying it', () => {
    expect(excludesSuperseded("from public.crm_appointments a where a.lead_id = $1 and a.status <> 'rescheduled'")).toBe(true);
    expect(excludesSuperseded("from public.crm_appointments a where a.status not in ('cancelled', 'rescheduled')")).toBe(true);
    expect(excludesSuperseded("from public.crm_appointments a where a.status in ('scheduled', 'confirmed')")).toBe(true);
    expect(excludesSuperseded('from public.crm_appointments a where a.id = $1')).toBe(true);
  });

  it('would have caught the query the owner saw flicker', () => {
    /* The drawer's batch read, exactly as it shipped: no status clause at all,
       feeding the seed the dialog opens on. */
    const asShipped = `select a.lead_id, a.id, a.kind::text, a.status::text, a.scheduled_at
        from public.crm_appointments a
       where a.lead_id = any($1::uuid[])
       order by a.lead_id, a.scheduled_at desc`;
    expect(excludesSuperseded(asShipped)).toBe(false);
  });

  it('does not police writes', () => {
    const sql = `update public.crm_appointments set status = 'rescheduled' where id = $1`;
    expect(appointmentReads(sql)).toEqual([]);
  });
});
