import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { leadPriority, type PriorityInput } from '@/lib/domain/lead-priority';

/* ============================================================================
 * THE PRIORITY FILTER AND THE PRIORITY CHIP MUST AGREE
 * ----------------------------------------------------------------------------
 * `lib/domain/lead-priority.ts` decides the chip on every row. The "More
 * filters" drawer needs the same verdict as a WHERE clause, and a derived value
 * cannot be filtered on in the database without writing the rule a second time.
 *
 * That file's own header says what happens next:
 *
 *   > *"Two definitions of 'high priority' on two screens is how somebody stops
 *   > trusting both — and the person most likely to notice is the one being
 *   > measured by it."*
 *
 * ── ⚠️ SO THE RULE IS RE-IMPLEMENTED HERE, FROM THE SQL, AND COMPARED ──────
 * `sqlPriority` below is a hand transcription of the predicates in
 * `lib/db/queries/crm-leads.ts`. Every combination of the three inputs that
 * matter is driven through BOTH and must come out the same. If somebody edits
 * one and not the other, this fails.
 *
 * ⚠️ IT ALSO READS THE QUERY FILE AND CHECKS THE PREDICATES ARE STILL THERE.
 * A transcription test proves two functions agree; it does not prove either of
 * them is the one the database runs. Asserting the SQL text is crude and it is
 * the only thing standing between this test and passing happily about code that
 * has been deleted.
 * ========================================================================= */

/* ── ⚠️ SQL'S THREE-VALUED LOGIC, MODELLED ────────────────────────────────
   The first version of this file compared two JavaScript booleans and passed
   while the live filter was dropping two thirds of the list. JavaScript has no
   NULL to get wrong; SQL does, and the bug lived exactly there:

       (select …) = 'inbound'   is NULL when the lead has no messages
       NULL or NULL             is NULL
       not NULL                 is NULL
       WHERE NULL               matches nothing

   So `normal` — written as `not (inbound or overdue)` — silently excluded every
   lead with no conversation and no next action. Driving Sarah's own page: her
   chips said 31 Normal and the filter returned 9.

   These helpers reproduce Postgres's rules rather than JavaScript's, so what is
   compared below is the thing that actually runs. */
type Sql3 = true | false | null;

const or3 = (a: Sql3, b: Sql3): Sql3 =>
  a === true || b === true ? true : a === null || b === null ? null : false;
const not3 = (a: Sql3): Sql3 => (a === null ? null : !a);
/** A WHERE clause keeps a row only on TRUE. NULL and FALSE both drop it. */
const matches = (a: Sql3): boolean => a === true;

/** The three predicates in `crm-leads.ts`, as a function — NULLs and all. */
function sqlPriority(lead: PriorityInput, nowMs: number): 'high' | 'normal' | 'low' | 'none' {
  const closed = lead.stage === 'won' || lead.stage === 'lost';

  /* ⚠️ `coalesce(…, false)` in the query is what makes this `false` rather than
     `null` when there are no messages. Remove the coalesce and this test
     fails — which is the whole point of it. */
  const noMessages = lead.lastMessageDirection === null;
  const lastIsInbound: Sql3 = noMessages ? false : lead.lastMessageDirection === 'inbound';
  const actionOverdue: Sql3 =
    lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < nowMs;

  const high = or3(lastIsInbound, actionOverdue);

  if (closed) return 'low';
  if (matches(high)) return 'high';
  if (matches(not3(high))) return 'normal';
  /* Neither branch would return this row — the bug, if it ever comes back. */
  return 'none';
}

const NOW = Date.parse('2026-10-01T09:00:00.000Z');
const PAST = '2026-09-20T09:00:00.000Z';
const FUTURE = '2026-10-20T09:00:00.000Z';

const STAGES = ['new', 'contacted', 'qualified', 'negotiation', 'won', 'lost'] as const;
const DATES = [null, PAST, FUTURE] as const;
const DIRECTIONS = [null, 'inbound', 'outbound'] as const;

describe('the priority filter and the priority chip', () => {
  it('⚠️ agree on every combination of the three inputs', () => {
    const disagreements: string[] = [];

    for (const stage of STAGES) {
      for (const nextActionAt of DATES) {
        for (const lastMessageDirection of DIRECTIONS) {
          const lead: PriorityInput = { stage, nextActionAt, lastMessageDirection };
          const chip = leadPriority(lead, NOW).level;
          const filter = sqlPriority(lead, NOW);
          if (chip !== filter) {
            disagreements.push(
              `${stage} / next=${nextActionAt ?? 'none'} / last=${lastMessageDirection ?? 'none'}: chip says ${chip}, filter says ${filter}`,
            );
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('⚠️ never leaves a lead in no bucket at all', () => {
    /* THE BUG THIS FILE EXISTS FOR. Every lead must be reachable by exactly one
       of the three filters; a row matching none of them disappears from a
       filtered list while its own chip says it belongs there. */
    const orphans: string[] = [];
    for (const stage of STAGES) {
      for (const nextActionAt of DATES) {
        for (const lastMessageDirection of DIRECTIONS) {
          const verdict = sqlPriority({ stage, nextActionAt, lastMessageDirection }, NOW);
          if (verdict === 'none') {
            orphans.push(`${stage} / next=${nextActionAt ?? 'none'} / last=${lastMessageDirection ?? 'none'}`);
          }
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('⚠️ and the query still coalesces the subquery, which is what prevents it', () => {
    const sql = readFileSync(resolve(process.cwd(), 'lib/db/queries/crm-leads.ts'), 'utf8');
    const block = sql.slice(sql.indexOf('const lastIsInbound'), sql.indexOf('if (search)'));
    expect(block).toContain('coalesce(');
    expect(block).toContain("= 'inbound', false)");
  });

  it('covers every level, so an always-normal bug could not pass the case above', () => {
    /* ⚠️ THE TEST ABOVE WOULD PASS IF BOTH SIDES RETURNED "normal" FOR
       EVERYTHING. Agreement is only worth something once the answers vary. */
    const levels = new Set<string>();
    for (const stage of STAGES) {
      for (const nextActionAt of DATES) {
        for (const lastMessageDirection of DIRECTIONS) {
          levels.add(leadPriority({ stage, nextActionAt, lastMessageDirection }, NOW).level);
        }
      }
    }
    expect([...levels].sort()).toEqual(['high', 'low', 'normal']);
  });
});

describe('the SQL this test transcribes', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'lib/db/queries/crm-leads.ts'),
    'utf8',
  );

  it('still branches on all three levels', () => {
    expect(sql).toContain("filters.priority === 'low'");
    expect(sql).toContain("filters.priority === 'high'");
    expect(sql).toContain("filters.priority === 'normal'");
  });

  it('⚠️ still excludes hidden messages, like the row the reader sees', () => {
    /* The list's own lateral has `hidden_at is null`. A priority rule without it
       ranks a lead "high" because of a message its row does not show. Four
       messages are hidden on the live table, so this is a real difference. */
    /* ⚠️ FROM THE PREDICATE, NOT FROM THE BRANCH. The two subqueries are now
       built once above the branches, so slicing from `filters.priority` finds
       no SQL at all — and an empty slice would have passed a test asserting
       "every subquery is guarded". */
    const priorityBlock = sql.slice(
      sql.indexOf('const lastIsInbound'),
      sql.indexOf('if (search)'),
    );
    const inboundChecks = priorityBlock.match(/crm_lead_messages/g) ?? [];
    const hiddenChecks = priorityBlock.match(/hidden_at is null/g) ?? [];
    expect(inboundChecks.length).toBeGreaterThan(0);
    expect(hiddenChecks.length).toBe(inboundChecks.length);
  });

  it('⚠️ counts "waiting for reply" the same way', () => {
    /* The tab, its count and this filter all ask "did they write last?". Three
       spellings is how a tab comes to say 3 and show 2. */
    const inbound = sql.match(/order by m\.occurred_at desc, m\.id desc limit 1\) = 'inbound'/g) ?? [];
    const guarded = sql.match(/hidden_at is null\s*\n?\s*order by m\.occurred_at desc, m\.id desc limit 1\) = 'inbound'/g) ?? [];
    expect(inbound.length).toBeGreaterThan(2);
    expect(guarded.length).toBe(inbound.length);
  });
});
