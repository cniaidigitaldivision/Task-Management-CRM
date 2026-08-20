import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from '@/lib/db/client';
import { projectReportData } from '@/lib/db/queries/project-report';
import {
  getProjectReport,
  insertProjectReport,
  deleteProjectReport,
} from '@/lib/db/queries/report-files';
import { getProject } from '@/lib/db/queries/projects';
import { buildProjectReport } from '@/lib/domain/project-report';
import { parseReportContent, type ReportContent } from '@/lib/domain/report-content';
import { reportPeriod, REPORT_KINDS } from '@/lib/domain/report-periods';
import { composeReportPdf } from '@/lib/pdf/report-poster';

/* ============================================================================
 * A PROJECT REPORT, END TO END, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * The unit suite proves the arithmetic and that the page renders from a fixture. It
 * cannot prove the seam this file exists for:
 *
 *   real project → real tasks → content → a `jsonb` column → back out → a PDF
 *
 * ── ⚠️ THE `jsonb` ROUND TRIP IS THE POINT ────────────────────────────────────
 * `content` goes into Postgres as JSON and comes back as a plain object with no types
 * attached. `parseReportContent` is deliberately tolerant so an older row still renders
 * rather than 500-ing — which means a field that silently fails to survive the trip
 * produces a PLAINER PAGE, not an error. Nothing but a round-trip test catches that.
 *
 * ── ⚠️ AND IT RUNS AS A REAL USER ─────────────────────────────────────────────
 * Every check written in this project as `postgres` has proved nothing about grants:
 * `postgres` bypasses table GRANTs, so a query a Coordinator would be refused passes
 * silently. `/documents` shipped broken exactly that way. The inserts and reads below go
 * through `withUser`, so migration 038's policies and 039's constraints are all in play.
 * ========================================================================= */

const DUMP = process.env.REPORT_POSTER_DUMP === '1';
const DUMP_DIR = path.join(process.cwd(), '.report-preview');

async function anAdmin(): Promise<{ id: string; name: string } | null> {
  /* Over the owner connection, and ONLY to find the actor — see the note in
     ceo-report.test.ts. The behaviour under test still runs through `withUser`. */
  const rows = await sql`
    select id, full_name from public.users
     where role in ('admin', 'super_admin') and is_active
     order by role limit 1
  `;
  const row = rows[0];
  return row ? { id: row.id as string, name: (row.full_name as string) ?? 'unknown' } : null;
}

async function aProject(actorId: string): Promise<string | null> {
  const rows = await sql`select id from public.projects order by created_at limit 1`;
  const id = rows[0]?.id as string | undefined;
  if (!id) return null;
  /* Confirm it is visible to this actor under RLS before using it — otherwise a failure
     here would look like a report bug rather than a fixture that cannot be read. */
  return (await getProject(actorId, id)) ? id : null;
}

/** The content builder, mirroring `generateProjectReportAction`. */
async function contentFor(
  actorId: string,
  projectId: string,
  kind: (typeof REPORT_KINDS)[number],
  today: string,
): Promise<ReportContent> {
  const project = (await getProject(actorId, projectId))!;
  const period = reportPeriod(kind, today);
  const data = await projectReportData(actorId, projectId, period.start, period.end);
  const report = buildProjectReport(period, data.assets, data.placements, {
    staticPostsPerDay: project.staticPostsPerDay,
    reelsPerWeek: project.reelsPerWeek,
    reelDays: project.reelDays,
    postingDays: project.postingDays,
  });

  const isDaily = kind === 'today' || kind === 'yesterday';

  return {
    kind,
    projectName: project.name,
    projectCode: project.code,
    periodLabel: period.label,
    kindLabel: `${kind.toUpperCase()} REPORT`,
    introduction: [`${project.name} is a project.`],
    headline: [
      { label: 'TARGET', value: String(report.target), sub: `${report.offDays} off days` },
      { label: 'ACHIEVED', value: String(report.totalAssets), sub: `${report.totalReels} reels` },
      { label: 'REMAINING', value: String(report.remaining), sub: '' },
    ],
    platforms: project.platforms.map((platform) => platform.name),
    rows: isDaily
      ? []
      : report.buckets.map((bucket) => ({
          label: bucket.label,
          staticPosts: bucket.staticPosts,
          reels: bucket.reels,
          total: bucket.assets,
          target: bucket.target,
          isOff: bucket.target === 0 && bucket.offDays > 0,
        })),
    published: data.placements
      .filter((placement) => placement.url !== null)
      .slice(0, 6)
      .map((placement) => ({
        platform: placement.platformName,
        contentType: placement.contentKind === 'reel' ? 'Reel' : 'Static Post',
        time: '',
        url: placement.url ?? '',
      })),
    platformSummaries: project.platforms.map((platform) => {
      const row = report.platforms.find((entry) => entry.platformId === platform.id);
      return {
        platform: platform.name,
        summary: `${row?.placements ?? 0} posts.`,
        posts: row?.placements ?? 0,
        sharePct: 0,
      };
    }),
    glance: [`${report.totalAssets} published against a target of ${report.target}.`],
    notes: [],
    activityTotal: String(report.totalAssets),
    activityCaption: `${report.totalStatic} static and ${report.totalReels} reels.`,
    footer: 'Generated by the integration suite.',
  };
}

describe('a project report, from the database to a PDF', () => {
  it('builds, stores, reads back and renders every kind', async () => {
    const admin = await anAdmin();
    expect(admin, 'no active admin in the database to run a report as').not.toBeNull();

    const projectId = await aProject(admin!.id);
    expect(projectId, 'no project visible to the admin to report on').not.toBeNull();

    const today = new Date().toISOString().slice(0, 10);

    for (const kind of REPORT_KINDS) {
      const content = await contentFor(admin!.id, projectId!, kind, today);
      const period = reportPeriod(kind, today);

      /* ── Store it. ⚠️ No image path at all: migration 039's
         `project_reports_renderable` check has to accept content alone, and 038's
         insert policy has to accept it from this actor. */
      const reportId = await insertProjectReport(admin!.id, {
        projectId: projectId!,
        kind,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        content: content as unknown as Record<string, unknown>,
        summary: `Integration check for ${kind}`,
        figures: { target: 0, achieved: 0 },
        model: 'cni-composer',
      });

      try {
        /* ── Read it back through RLS, as the route does. ── */
        const row = await getProjectReport(admin!.id, reportId);
        expect(row, `${kind}: the stored report could not be read back`).not.toBeNull();
        expect(row!.imagePath, `${kind}: a drawn report must have no image path`).toBeNull();

        const parsed = parseReportContent(row!.content);
        expect(parsed, `${kind}: the stored content did not parse`).not.toBeNull();

        /* ⚠️ THE ASSERTIONS THIS FILE EXISTS FOR. Every field that reaches the page has
           to survive the `jsonb` trip — a lost one renders a plainer page, silently. */
        expect(parsed!.kind).toBe(content.kind);
        expect(parsed!.projectName).toBe(content.projectName);
        expect(parsed!.periodLabel).toBe(content.periodLabel);
        expect(parsed!.activityTotal).toBe(content.activityTotal);
        expect(parsed!.headline.length).toBe(content.headline.length);
        expect(parsed!.rows.length).toBe(content.rows.length);
        expect(parsed!.platforms).toEqual([...content.platforms]);
        expect(parsed!.platformSummaries.length).toBe(content.platformSummaries.length);
        expect(parsed!.glance).toEqual([...content.glance]);

        /* ── And render it. ── */
        const pdf = await composeReportPdf(parsed!, {
          generatedOn: row!.createdAt.slice(0, 10),
          generatedBy: admin!.name,
        });
        expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), kind).toBe('%PDF-');
        expect(pdf.byteLength, `${kind}: too small to contain the embedded assets`).toBeGreaterThan(
          200_000,
        );

        if (DUMP) {
          await mkdir(DUMP_DIR, { recursive: true });
          await writeFile(path.join(DUMP_DIR, `live-${kind}.pdf`), pdf);
        }
      } finally {
        /* ⚠️ Always removed, even on failure. These rows are visible on the real
           project page, and a test that leaves debris behind changes what the owner
           sees. */
        await deleteProjectReport(admin!.id, reportId);
      }
    }
  });

  it('refuses a report with neither content nor an image', async () => {
    const admin = await anAdmin();
    const projectId = await aProject(admin!.id);
    const period = reportPeriod('month', new Date().toISOString().slice(0, 10));

    /* ⚠️ Caught in the query layer before it reaches the constraint, so the person who
       pressed the button gets a sentence rather than an opaque check violation. */
    await expect(
      insertProjectReport(admin!.id, {
        projectId: projectId!,
        kind: 'month',
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        summary: 'Nothing to render',
        figures: {},
        model: 'cni-composer',
      }),
    ).rejects.toThrow(/neither/i);
  });
});
