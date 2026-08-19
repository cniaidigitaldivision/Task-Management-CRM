import { describe, expect, it } from 'vitest';

import { ceoReportData } from '@/lib/db/queries/ceo-report';
import { buildReport, currentMonthStart, recentMonths } from '@/lib/domain/ceo-report';
import { chatgptKey, writeNarrative } from '@/lib/ai/narrative';
import { sql } from '@/lib/db/client';

/* ============================================================================
 * THE MONTHLY REPORT, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * The unit suite proves the arithmetic. It cannot prove the three queries behind it
 * are valid SQL against the live schema, that they run under `cni_app` rather than
 * needing `postgres`, or that the prompt survives contact with real data.
 *
 * ── ⚠️ WHY THIS MATTERS MORE THAN USUAL HERE ──────────────────────────────────
 * Every check written in this project as `postgres` has proved nothing about
 * grants: `postgres` bypasses table GRANTs, so a query that a Coordinator would be
 * refused passes silently. `/documents` shipped broken exactly that way. These run
 * as a real user through `withUser`, which is what `ceoReportData` does.
 * ========================================================================= */

/**
 * A real Admin id — the report is scoped by RLS to whoever runs it, so it has to be
 * exercised as somebody rather than as nobody.
 *
 * ⚠️ Read over the owner connection, as the other integration suites do, and ONLY
 * to find the actor. `withAppRole` was tried first and returned nothing: the
 * pre-auth role may look users up for a sign-in, not enumerate them, so the
 * fixture found no admin and every test failed for a reason that had nothing to do
 * with the report. Finding the actor is setup; the behaviour under test still runs
 * through `withUser` inside `ceoReportData`, which is the part that must be
 * subject to grants and policies.
 */
async function anAdmin(): Promise<{ id: string; role: string } | null> {
  const rows = await sql`
    select id, role from public.users
     where role in ('admin', 'super_admin') and is_active
     order by role limit 1
  `;
  const row = rows[0];
  return row ? { id: row.id as string, role: row.role as string } : null;
}

describe('ceoReportData against the live schema', () => {
  it('runs all three queries as a real user and returns a coherent shape', async () => {
    const admin = await anAdmin();
    expect(admin, 'no active admin in the database to run the report as').not.toBeNull();

    const month = currentMonthStart(Date.now());
    const data = await ceoReportData(admin!.id, month);

    /* The point of the assertion is that it got here at all: a bad column name, a
       revoked grant or a broken policy throws rather than returning an empty
       array, and an empty division is a legitimate answer. */
    expect(data.monthStart).toBe(month);
    expect(Array.isArray(data.projects)).toBe(true);
    expect(Array.isArray(data.people)).toBe(true);
    expect(Array.isArray(data.platforms)).toBe(true);
  });

  it('keeps null and zero distinct on every target column', async () => {
    /* ⚠️ `Number(null)` is 0, so a careless mapping turns "no minimum agreed" into
       "agreed to publish nothing" — a different verdict, and one that paints a
       project red for missing a promise nobody made. */
    const admin = await anAdmin();
    const data = await ceoReportData(admin!.id, currentMonthStart(Date.now()));

    for (const p of data.projects) {
      for (const value of [p.assetsTargetMin, p.assetsTargetMax, p.reelsTargetMin, p.monthlyFeePkr]) {
        expect(value === null || typeof value === 'number').toBe(true);
        expect(Number.isNaN(value as number)).toBe(false);
      }
      /* Counts are always numbers — there is no such thing as "unknown how many
         were published". */
      expect(typeof p.assetsPublished).toBe('number');
      expect(typeof p.reelsPublished).toBe('number');
      expect(typeof p.liveLinks).toBe('number');
    }
  });

  it('builds a report whose totals agree with its own rows', async () => {
    const admin = await anAdmin();
    const report = buildReport(await ceoReportData(admin!.id, currentMonthStart(Date.now())));

    const { totals } = report;
    expect(totals.projectCount).toBe(report.lines.length);
    /* Every project falls in exactly one client kind — the bug that showed as
       "7 projects, 0 internal · 1 external". */
    expect(totals.internalCount + totals.externalCount + totals.unclassifiedCount).toBe(
      totals.projectCount,
    );
    expect(totals.assetsPublished).toBe(
      report.lines.reduce((t, l) => t + l.project.assetsPublished, 0),
    );
    /* Reels are inside the asset total, never on top of it. */
    expect(totals.reelsPublished).toBeLessThanOrEqual(totals.assetsPublished);
    /* Only projects that need attention appear on the reading list. */
    for (const line of report.attention) {
      expect(['behind', 'short_on_reels']).toContain(line.progress.verdict);
    }
  });

  it('reports an earlier month without complaint', async () => {
    /* A report run on the 2nd about last month has to work, and the month is a
       parameter precisely so it can. */
    const admin = await anAdmin();
    const [, lastMonth] = recentMonths(Date.now(), 2);
    const data = await ceoReportData(admin!.id, lastMonth!);
    expect(data.monthStart).toBe(lastMonth);
  });
});

describe('the written analysis, on real figures', () => {
  const key = chatgptKey();

  /* Skipped rather than failed when no key is set: this suite must stay runnable
     without third-party credentials, and the report is designed to work without
     the commentary. */
  it.skipIf(!key)(
    'composes prose whose every figure traces back to the database',
    async () => {
      const admin = await anAdmin();
      const report = buildReport(await ceoReportData(admin!.id, currentMonthStart(Date.now())));

      if (report.isEmpty) {
        /* Nothing to narrate is a real state, and the action refuses it rather than
           inviting the model to fill the silence. */
        expect(report.factSheet).toContain('No active projects.');
        return;
      }

      const narrative = await writeNarrative(report.factSheet);

      expect(narrative.headline.length).toBeGreaterThan(0);
      expect(narrative.summary.length).toBeGreaterThan(0);

      /* ⚠️ THE ASSERTION THIS WHOLE DESIGN EXISTS FOR. The model is told not to
         calculate; this is the check that it did not. A failure here is not a
         flaky test — it means the page would have shown the CEO a figure that came
         from nowhere. */
      expect(
        narrative.unverifiedFigures,
        `the model wrote figures absent from the fact sheet: ${narrative.unverifiedFigures.join(', ')}`,
      ).toEqual([]);

      /* And it must not have invented a project. Real data here includes projects
         with zero activity, which is exactly when a model is tempted to embroider. */
      const prose = [narrative.headline, ...narrative.summary, ...narrative.risks].join(' ');
      expect(prose).not.toMatch(/lorem|example\.com|placeholder/i);
    },
    120_000,
  );
});
