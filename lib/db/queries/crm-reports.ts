import 'server-only';

import { withUser } from '../client';
import {
  buildAgeingReport,
  buildFunnelReport,
  buildPeopleReport,
  buildSourcesReport,
  type AgeingRow,
  type FunnelRow,
  type PersonRow,
  type ReportContext,
  type CrmReportKind,
  type SourceRow,
} from '@/lib/domain/crm-reports';
import type { Report } from '@/lib/domain/reports';

/* ============================================================================
 * CRM REPORTS — LAYER 1
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO AUTHORISATION CODE HERE EITHER ───────────────────────────────────
 * Migration 128's four functions each check `app.crm_manages_project` inside
 * themselves, because they aggregate across leads a salesperson cannot read.
 * A salesperson gets empty rows, so a report they somehow generated would be
 * blank rather than a leak — and the insert policy refuses them anyway.
 *
 * ── ⚠️ COMPUTE ONCE, THEN STORE. NEVER READ LIVE FOR A SAVED REPORT ────────
 * The owner's rule: *"first save in a database and always fetch from the
 * database."* A stored report is a statement made on a date, so reading it back
 * must never re-run the query — see 128's header for why the usual reason
 * (Meta's 90-day deletion) is not the real one.
 * ========================================================================= */

/** A stored report, as the list shows it. */
export interface StoredReport {
  readonly id: string;
  readonly kind: CrmReportKind;
  readonly title: string;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly rowCount: number;
  readonly generatedAt: string;
  readonly generatedBy: string | null;
}

/**
 * Compute one report from the live tables, shaped and ready to store.
 *
 * ⚠️ THIS IS THE ONLY PLACE THAT READS LIVE. Everything a person looks at comes
 * from `listStoredReports` / `getStoredReport`, which read the frozen copy.
 */
export async function computeCrmReport(
  actorId: string,
  kind: CrmReportKind,
  projectId: string,
  ctx: ReportContext,
): Promise<Report> {
  return withUser(actorId, async (tx) => {
    if (kind === 'ageing') {
      const rows = await tx`select * from app.crm_report_ageing(${projectId}::uuid)`;
      return buildAgeingReport(
        (rows as Array<Record<string, unknown>>).map(
          (r): AgeingRow => ({
            bucket: String(r.bucket),
            sortOrder: Number(r.sort_order ?? 0),
            leads: Number(r.leads ?? 0),
            oldestDays: Number(r.oldest_days ?? 0),
          }),
        ),
        ctx,
      );
    }

    if (kind === 'funnel') {
      const rows = await tx`
        select * from app.crm_report_funnel(
          ${projectId}::uuid, ${ctx.from}::date, ${ctx.to}::date)
      `;
      return buildFunnelReport(
        (rows as Array<Record<string, unknown>>).map(
          (r): FunnelRow => ({
            stage: String(r.stage),
            leads: Number(r.leads ?? 0),
            share: r.share === null ? null : Number(r.share),
          }),
        ),
        ctx,
      );
    }

    if (kind === 'sources') {
      const rows = await tx`
        select * from app.crm_report_sources(
          ${projectId}::uuid, ${ctx.from}::date, ${ctx.to}::date)
      `;
      return buildSourcesReport(
        (rows as Array<Record<string, unknown>>).map(
          (r): SourceRow => ({
            source: String(r.source),
            leads: Number(r.leads ?? 0),
            contacted: Number(r.contacted ?? 0),
            won: Number(r.won ?? 0),
            lost: Number(r.lost ?? 0),
            /* ⚠️ NULL SURVIVES THE WHOLE WAY. `Number(null)` is 0, which would
               turn "we cannot say yet" into "nothing converts". */
            winRate: r.win_rate === null || r.win_rate === undefined ? null : Number(r.win_rate),
          }),
        ),
        ctx,
      );
    }

    const rows = await tx`
      select * from app.crm_report_people(
        ${projectId}::uuid, ${ctx.from}::date, ${ctx.to}::date)
    `;
    return buildPeopleReport(
      (rows as Array<Record<string, unknown>>).map(
        (r): PersonRow => ({
          person: String(r.person ?? 'Unnamed'),
          leads: Number(r.leads ?? 0),
          contacted: Number(r.contacted ?? 0),
          won: Number(r.won ?? 0),
          lost: Number(r.lost ?? 0),
          stillOpen: Number(r.still_open ?? 0),
          medianMinutes:
            r.median_minutes === null || r.median_minutes === undefined
              ? null
              : Number(r.median_minutes),
        }),
      ),
      ctx,
    );
  });
}

/**
 * Freeze it.
 *
 * ⚠️ `period_from` AND `period_to` ARE NULL FOR AGEING, because it has no
 * period — it is a snapshot of the moment it was taken, and storing the caller's
 * requested range against it would make an old snapshot look like a range query.
 */
export async function storeCrmReport(
  actorId: string,
  kind: CrmReportKind,
  projectId: string,
  report: Report,
): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_reports
      (project_id, kind, period_from, period_to, title, payload, row_count, generated_by_id)
    values (
      ${projectId}::uuid,
      ${kind}::public.crm_report_kind,
      ${kind === 'ageing' ? null : report.period.start}::date,
      ${kind === 'ageing' ? null : report.period.end}::date,
      ${report.title},
      ${JSON.stringify(report)}::jsonb,
      ${report.rows.length},
      ${actorId}::uuid
    )
    returning id
  `);

  const id = (rows as Array<Record<string, unknown>>)[0]?.id;
  return id ? String(id) : null;
}

/** Every report frozen for this project, newest first. */
export async function listStoredReports(
  actorId: string,
  projectId: string,
): Promise<StoredReport[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.id, r.kind::text, r.title, r.period_from, r.period_to,
           r.row_count, r.generated_at, u.full_name as generated_by
      from public.crm_reports r
      left join public.users u on u.id = r.generated_by_id
     where r.project_id = ${projectId}::uuid
     order by r.generated_at desc
     limit 100
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as CrmReportKind,
    title: String(r.title),
    periodFrom: r.period_from ? String(r.period_from).slice(0, 10) : null,
    periodTo: r.period_to ? String(r.period_to).slice(0, 10) : null,
    rowCount: Number(r.row_count ?? 0),
    generatedAt: new Date(r.generated_at as string).toISOString(),
    /* ⚠️ A plain join to `users`, and it is the trap 121 fixed elsewhere — a
       department manager reads one row of the staff table, so a colleague's
       report would show no author. It is tolerable HERE and nowhere else,
       because only a manager or an Admin can generate one, so the author is
       almost always the reader. The list says "Unknown" rather than describing a
       working colleague as gone. */
    generatedBy: (r.generated_by as string | null) ?? null,
  }));
}

/**
 * One frozen report, exactly as it was written.
 *
 * ⚠️ NOTHING IS RECOMPUTED, and nothing is validated against today's tables. If
 * a column was renamed since, the old report still shows the old name — which is
 * the entire point of storing the payload whole.
 */
export async function getStoredReport(
  actorId: string,
  reportId: string,
): Promise<{ report: Report; stored: StoredReport } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
    return null;
  }

  const rows = await withUser(actorId, (tx) => tx`
    select r.id, r.kind::text, r.title, r.period_from, r.period_to,
           r.row_count, r.generated_at, r.payload,
           u.full_name as generated_by
      from public.crm_reports r
      left join public.users u on u.id = r.generated_by_id
     where r.id = ${reportId}::uuid
     limit 1
  `);

  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;

  return {
    report: row.payload as Report,
    stored: {
      id: String(row.id),
      kind: String(row.kind) as CrmReportKind,
      title: String(row.title),
      periodFrom: row.period_from ? String(row.period_from).slice(0, 10) : null,
      periodTo: row.period_to ? String(row.period_to).slice(0, 10) : null,
      rowCount: Number(row.row_count ?? 0),
      generatedAt: new Date(row.generated_at as string).toISOString(),
      generatedBy: (row.generated_by as string | null) ?? null,
    },
  };
}
