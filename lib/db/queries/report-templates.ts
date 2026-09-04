import 'server-only';

import type {
  Cadence,
  ExportRecord,
  ReportSchedule,
  ReportTemplate,
  TemplateCategory,
  TemplateEngine,
} from '@/lib/domain/report-templates';

import { withUser } from '../client';

/* ============================================================================
 * REPORT TEMPLATES, SCHEDULES AND EXPORT HISTORY — migration 096
 * ----------------------------------------------------------------------------
 * Everything the Studio's Reports & Exports tab reads, and the three writes it
 * makes. RLS decides scope throughout — `withUser` sets `app.user_id` and the
 * policies in 096 do the rest, so there is no second visibility rule here to
 * drift from `app.project_is_visible`.
 * ========================================================================= */

function isoText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * ⚠️ `date` COLUMNS COME BACK AS A JS `Date` AT UTC MIDNIGHT from postgres.js,
 * and `toISOString().slice(0, 10)` is the only safe way to read one. Formatting
 * it in local time would shift a Karachi date back a day for five hours each
 * evening, which is exactly the bug that once made a correct answer look wrong.
 */
function dateText(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/* ---- Templates ----------------------------------------------------------- */

function toTemplate(row: Record<string, unknown>): ReportTemplate {
  return {
    id: row.id as string,
    slug: (row.slug as string | null) ?? null,
    name: row.name as string,
    description: row.description as string,
    category: row.category as TemplateCategory,
    engine: row.engine as TemplateEngine,
    kind: (row.kind as ReportTemplate['kind']) ?? null,
    format: row.format as 'pdf' | 'csv',
    isBuiltin: row.is_builtin as boolean,
    createdById: (row.created_by_id as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    usageCount: Number(row.usage_count ?? 0),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined
      ? null
      : isoText(row.last_used_at),
    updatedAt: isoText(row.updated_at),
    isFavourite: Boolean(row.is_favourite),
  };
}

/**
 * Every template, with this person's own favourites resolved.
 *
 * ⚠️ ONE QUERY, NOT ONE PLUS N. The obvious shape is "list templates, then ask
 * per template whether it is starred", which is nine extra round trips on the
 * first page load and grows with every template anybody adds. The left join
 * against a single-user predicate does it in one pass.
 */
export async function listReportTemplates(actorId: string): Promise<readonly ReportTemplate[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select t.*,
             u.full_name as created_by_name,
             f.user_id is not null as is_favourite
        from public.report_templates t
        left join public.users u
               on u.id = t.created_by_id
        left join public.report_template_favourites f
               on f.template_id = t.id
              and f.user_id = ${actorId}::uuid
       order by t.is_builtin desc, t.usage_count desc, t.name
    `;
    return rows.map((r) => toTemplate(r as Record<string, unknown>));
  });
}

export async function getReportTemplate(
  actorId: string,
  templateId: string,
): Promise<ReportTemplate | null> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select t.*,
             u.full_name as created_by_name,
             f.user_id is not null as is_favourite
        from public.report_templates t
        left join public.users u on u.id = t.created_by_id
        left join public.report_template_favourites f
               on f.template_id = t.id and f.user_id = ${actorId}::uuid
       where t.id = ${templateId}::uuid
    `;
    return rows.length === 0 ? null : toTemplate(rows[0] as Record<string, unknown>);
  });
}

export async function insertReportTemplate(
  actorId: string,
  input: {
    readonly name: string;
    readonly description: string;
    readonly category: TemplateCategory;
    readonly engine: TemplateEngine;
    readonly kind: string | null;
    readonly format: 'pdf' | 'csv';
  },
): Promise<string> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      insert into public.report_templates
        (name, description, category, engine, kind, format, is_builtin, created_by_id)
      values (${input.name}, ${input.description}, ${input.category}, ${input.engine},
              ${input.kind}, ${input.format}, false, ${actorId}::uuid)
      returning id
    `;
    return rows[0].id as string;
  });
}

export async function deleteReportTemplate(actorId: string, templateId: string): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    /* ⚠️ NO `is_builtin` CHECK HERE, DELIBERATELY. The policy in 096 refuses a
       built-in outright, so this affects zero rows and returns false — one rule,
       in the database, rather than the same rule written twice and eventually
       disagreeing with itself. */
    const rows = await tx`
      delete from public.report_templates where id = ${templateId}::uuid returning id
    `;
    return rows.length > 0;
  });
}

/** Star or un-star, per person. Returns the state it settled on. */
export async function toggleTemplateFavourite(
  actorId: string,
  templateId: string,
): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const removed = await tx`
      delete from public.report_template_favourites
       where template_id = ${templateId}::uuid and user_id = ${actorId}::uuid
      returning template_id
    `;
    if (removed.length > 0) return false;

    await tx`
      insert into public.report_template_favourites (template_id, user_id)
      values (${templateId}::uuid, ${actorId}::uuid)
      on conflict do nothing
    `;
    return true;
  });
}

/** Bumps "Used N times" through the SECURITY DEFINER function — see 096. */
export async function recordTemplateUse(actorId: string, templateId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`select app.record_template_use(${templateId}::uuid)`);
}

/* ---- Schedules ----------------------------------------------------------- */

function toSchedule(row: Record<string, unknown>): ReportSchedule {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    templateId: row.template_id as string,
    templateName: row.template_name as string,
    format: row.format as 'pdf' | 'csv',
    cadence: row.cadence as Cadence,
    nextRunOn: dateText(row.next_run_on),
    lastRunAt: row.last_run_at === null || row.last_run_at === undefined
      ? null
      : isoText(row.last_run_at),
    lastError: (row.last_error as string | null) ?? null,
    isActive: row.is_active as boolean,
    createdByName: (row.created_by_name as string | null) ?? null,
  };
}

export async function schedulesForProject(
  actorId: string,
  projectId: string,
): Promise<readonly ReportSchedule[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select s.*,
             t.name   as template_name,
             t.format as format,
             u.full_name as created_by_name
        from public.report_schedules s
        join public.report_templates t on t.id = s.template_id
        left join public.users u on u.id = s.created_by_id
       where s.project_id = ${projectId}::uuid
       order by s.is_active desc, s.next_run_on
    `;
    return rows.map((r) => toSchedule(r as Record<string, unknown>));
  });
}

export async function insertSchedule(
  actorId: string,
  input: {
    readonly projectId: string;
    readonly templateId: string;
    readonly cadence: Cadence;
    readonly nextRunOn: string;
  },
): Promise<string> {
  return withUser(actorId, async (tx) => {
    /* ⚠️ THE UPSERT NEEDS THE UPDATE POLICY THAT 096 GRANTS, and it is easy to
       forget: an `on conflict do update` requires SELECT, INSERT *and* UPDATE
       policies, and missing the last one fails with a message about the INSERT
       that sends you looking in the wrong place. `report_schedules_write` is
       `for all`, which covers it.

       Re-scheduling the same template at the same cadence revives the row
       rather than erroring — pressing the button twice is a double-click, not a
       conflict worth reporting. */
    const rows = await tx`
      insert into public.report_schedules
        (project_id, template_id, cadence, next_run_on, created_by_id)
      values (${input.projectId}::uuid, ${input.templateId}::uuid,
              ${input.cadence}, ${input.nextRunOn}::date, ${actorId}::uuid)
      on conflict (project_id, template_id, cadence) do update
        set is_active   = true,
            next_run_on = excluded.next_run_on,
            last_error  = null,
            updated_at  = now()
      returning id
    `;
    return rows[0].id as string;
  });
}

export async function setScheduleActive(
  actorId: string,
  scheduleId: string,
  isActive: boolean,
): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      update public.report_schedules
         set is_active = ${isActive}, updated_at = now()
       where id = ${scheduleId}::uuid
      returning id
    `;
    return rows.length > 0;
  });
}

export async function deleteSchedule(actorId: string, scheduleId: string): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      delete from public.report_schedules where id = ${scheduleId}::uuid returning id
    `;
    return rows.length > 0;
  });
}

/* ---- Export history ------------------------------------------------------ */

function toExport(row: Record<string, unknown>): ExportRecord {
  return {
    id: row.id as string,
    templateName: row.template_name as string,
    format: row.format as 'pdf' | 'csv',
    fileName: row.file_name as string,
    byteSize: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    rowCount: row.row_count === null || row.row_count === undefined ? null : Number(row.row_count),
    status: row.status as 'ready' | 'failed',
    error: (row.error as string | null) ?? null,
    reportId: (row.report_id as string | null) ?? null,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    createdAt: isoText(row.created_at),
  };
}

export async function exportsForProject(
  actorId: string,
  projectId: string,
  limit = 60,
): Promise<readonly ExportRecord[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select e.*, u.full_name as requested_by_name
        from public.report_exports e
        left join public.users u on u.id = e.requested_by_id
       where e.project_id = ${projectId}::uuid
       order by e.created_at desc
       limit ${limit}
    `;
    return rows.map((r) => toExport(r as Record<string, unknown>));
  });
}

export async function recordExport(
  actorId: string,
  input: {
    readonly projectId: string;
    readonly templateId: string | null;
    readonly templateName: string;
    readonly reportId: string | null;
    readonly format: 'pdf' | 'csv';
    readonly fileName: string;
    readonly byteSize: number | null;
    readonly rowCount: number | null;
    readonly status: 'ready' | 'failed';
    readonly error: string | null;
  },
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      insert into public.report_exports
        (project_id, template_id, template_name, report_id, format, file_name,
         byte_size, row_count, status, error, requested_by_id)
      values (${input.projectId}::uuid, ${input.templateId}, ${input.templateName},
              ${input.reportId}, ${input.format}, ${input.fileName},
              ${input.byteSize}, ${input.rowCount}, ${input.status}, ${input.error},
              ${actorId}::uuid)
    `,
  );
}

/* ---- The tab's two counters ---------------------------------------------- */

/**
 * How many reports and exports this project has, for the KPI row.
 *
 * ⚠️ ONE ROUND TRIP FOR BOTH. Two counts from two tables is the textbook reason
 * to write two queries and the textbook way to double a page's latency for
 * nothing — the same single-pass shape `taskTotals` uses.
 */
export async function reportCountsForProject(
  actorId: string,
  projectId: string,
): Promise<{ readonly reportsGenerated: number; readonly exportsTaken: number }> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select
        (select count(*) from public.project_reports where project_id = ${projectId}::uuid)
          as reports_generated,
        (select count(*) from public.report_exports
          where project_id = ${projectId}::uuid and status = 'ready')
          as exports_taken
    `;
    return {
      reportsGenerated: Number(rows[0]?.reports_generated ?? 0),
      exportsTaken: Number(rows[0]?.exports_taken ?? 0),
    };
  });
}
