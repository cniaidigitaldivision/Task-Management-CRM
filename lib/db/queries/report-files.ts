import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * GENERATED REPORTS — migrations 038 and 039
 * ----------------------------------------------------------------------------
 * The record of every report generated for a project: which period it covers, the
 * content it was built from, and the exact figures behind it.
 *
 * ── ⚠️ TWO KINDS OF ROW, AND ONLY ONE OF THEM IS A PICTURE ────────────────────
 * A row carries EITHER `content` (a report drawn by `lib/pdf/report-poster.ts` from the
 * owner's layout, rebuilt into a PDF on demand) OR `imagePath` (a poster drawn by
 * `gpt-image-1` and stored). Migration 039's `project_reports_renderable` check
 * guarantees at least one is present, so the PDF route always has something to render.
 *
 * The image rows are the older ones. They are kept working rather than migrated because
 * some of them have already gone to a client, and the PDF a client received must stay
 * reproducible byte for byte.
 *
 * ── ⚠️ THE CONTENT AND FIGURES ARE THE AUDIT TRAIL ────────────────────────────
 * Months after a report has gone out, the only way to answer "was that right?" is to
 * compare it against what the CRM said when it was made. Re-deriving it from today's
 * tasks would produce different numbers — tasks get edited, back-dated and completed —
 * so the row is the evidence. Append-only by design: migration 038 grants no UPDATE at
 * all, and 039's self-check proves `content` cannot be rewritten either.
 * ========================================================================= */

export interface ReportFileRow {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodLabel: string;
  /** Null for a drawn report — see the header. */
  readonly imagePath: string | null;
  readonly imageBytes: number | null;
  /** The `ReportContent` this report was built from. Null on pre-039 image rows. */
  readonly content: unknown;
  readonly summary: string;
  readonly figures: Readonly<Record<string, unknown>>;
  readonly model: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

function toRow(row: Record<string, unknown>): ReportFileRow {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as string,
    periodStart: dateText(row.period_start),
    periodEnd: dateText(row.period_end),
    periodLabel: row.period_label as string,
    imagePath: (row.image_path as string | null) ?? null,
    imageBytes: row.image_bytes === null || row.image_bytes === undefined ? null : Number(row.image_bytes),
    content: row.content ?? null,
    summary: row.summary as string,
    figures: (row.figures as Record<string, unknown>) ?? {},
    model: row.model as string,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Newest first. The project page lists these under Generate Report. */
export async function listProjectReports(
  actorId: string,
  projectId: string,
  limit = 20,
): Promise<ReportFileRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.*, u.full_name as created_by_name
      from public.project_reports r
      left join public.users u on u.id = r.created_by_id
     where r.project_id = ${projectId}
     order by r.created_at desc
     limit ${limit}
  `);
  return rows.map((row) => toRow(row as Record<string, unknown>));
}

/** One report, for the PDF route. Null when it does not exist OR is not visible —
 *  the route answers 404 for both, so an id cannot be probed. */
export async function getProjectReport(
  actorId: string,
  reportId: string,
): Promise<ReportFileRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.*, u.full_name as created_by_name
      from public.project_reports r
      left join public.users u on u.id = r.created_by_id
     where r.id = ${reportId}
  `);
  return rows[0] ? toRow(rows[0] as Record<string, unknown>) : null;
}

export async function insertProjectReport(
  actorId: string,
  input: {
    projectId: string;
    kind: string;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    /** A drawn report: the content it was built from. */
    content?: Record<string, unknown> | null;
    /** An image-model report: where the poster is stored. */
    imagePath?: string | null;
    imageBytes?: number | null;
    summary: string;
    figures: Record<string, unknown>;
    model: string;
  },
): Promise<string> {
  /* ⚠️ Refused here as well as by the constraint. `project_reports_renderable` would
     catch it, but a check violation surfaces as an opaque database error to somebody who
     pressed a button — and this is a programming mistake, not a user one. */
  if (!input.content && !input.imagePath) {
    throw new Error('A report needs either its content or a stored image; this one has neither.');
  }

  const rows = await withUser(actorId, (tx) => tx`
    insert into public.project_reports
      (project_id, kind, period_start, period_end, period_label,
       content, image_path, image_bytes, summary, figures, model, created_by_id)
    values (
      ${input.projectId}, ${input.kind},
      ${input.periodStart}::date, ${input.periodEnd}::date, ${input.periodLabel},
      ${input.content ? tx.json(input.content as never) : null},
      ${input.imagePath ?? null}, ${input.imageBytes ?? null}, ${input.summary},
      ${tx.json(input.figures as never)}, ${input.model}, ${actorId}
    )
    returning id
  `);
  return rows[0].id as string;
}

export async function deleteProjectReport(actorId: string, reportId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.project_reports where id = ${reportId}
  `);
}

/** A `date` column as 'YYYY-MM-DD', read from UTC parts rather than via
 *  `toISOString()` — see the note in project-report.ts for why that matters. */
function dateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  return String(value).slice(0, 10);
}
