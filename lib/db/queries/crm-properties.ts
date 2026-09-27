import { sql, withUser } from '@/lib/db/client';
import { DEFAULT_MARLA_SQFT } from '@/lib/domain/crm-property';

/* ============================================================================
 * THE PROPERTY CATALOGUE — reads and writes
 * ----------------------------------------------------------------------------
 * ── ⚠️ ONE QUERY FOR THE WHOLE PAGE — Rule Zero, laws 3 and 4 ─────────────
 * The board returns everything the detail panel draws, including the linked
 * counts and the documents, so clicking a row costs NO round trip. The panel is
 * drawn from the row the table already holds, which is the `/my-leads` pattern
 * (`leadFromRow`) the handover names as the reference implementation.
 *
 * ⚠️ The alternative — fetch the detail on selection — was measured on the lead
 * desk at ~101 ms from Karachi per click. For a page whose whole purpose is
 * clicking down a list of plots, that is the difference between a catalogue and
 * a form.
 *
 * ── ⚠️ THE MARLA STANDARD TRAVELS WITH EVERY ROW ──────────────────────────
 * Not looked up once in the component. Two projects on one screen can have two
 * standards, and an area computed with the wrong one is wrong by 21% and still
 * looks like a number. It is joined per row for that reason.
 *
 * ── ⚠️ RLS DOES THE NARROWING, NOT A `where` ──────────────────────────────
 * `crm_properties_select` (266) is `admin or project_id = any(dept projects)`,
 * computed once as an InitPlan. Nothing here repeats that rule — a second copy
 * in SQL is a second thing to keep in step, and the one in the policy is the one
 * that cannot be bypassed.
 * ========================================================================= */

export interface PropertyRow {
  readonly id: string;
  readonly code: string;
  readonly plotNumber: string | null;
  readonly block: string | null;
  readonly kind: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectCity: string | null;
  readonly marlaStandard: number;
  readonly sizeMarla: number | null;
  readonly areaSqft: number | null;
  readonly dimensions: string | null;
  readonly category: string | null;
  readonly facing: string | null;
  readonly roadWidthFt: number | null;
  readonly isCorner: boolean;
  readonly isParkFacing: boolean;
  readonly isMainBoulevard: boolean;
  readonly basePrice: number | null;
  readonly premiumCharges: number | null;
  readonly status: string;
  readonly developmentStatus: string | null;
  readonly expectedPossession: string | null;
  readonly isDraft: boolean;
  readonly notes: string | null;
  readonly priceUpdatedAt: string | null;
  readonly updatedAt: string | null;
  readonly isTestData: boolean;
  /** Counts for the panel. Computed in the same wave. */
  readonly linkedLeads: number;
  readonly linkedQuotations: number;
  readonly linkedAppointments: number;
  readonly activeBooking: string | null;
  readonly documents: readonly PropertyDocument[];
  readonly links: readonly PropertyLink[];
  readonly stages: readonly PaymentStage[];
}

export interface PropertyDocument {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly storagePath: string;
}

export interface PropertyLink {
  readonly kind: 'quotation' | 'appointment' | 'lead';
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
}

export interface PaymentStage {
  readonly label: string;
  readonly percentage: number;
  readonly amount: number;
  readonly instalments: number | null;
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

export async function crmPropertyBoard(actorId: string): Promise<readonly PropertyRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    /* ⚠⚠ NEVER "join public.projects" HERE. "projects_select" is
       "app.project_is_visible(id)" — PROJECT MEMBERSHIP — and a salesperson is
       not a member of the schemes they sell. An inner join silently returns
       ZERO properties for exactly the person the page is for, while an admin
       sees all of them and the page looks finished.

       This is the NINTH time this join has been written in this codebase; the
       tracker counted eight before it. It was caught here by running the query
       as Sarah and getting 0 rows out of 148.

       "app.crm_project_options()" is the definer that answers "which projects
       may this CRM caller see", set-returning and argument-free, so the CTE is
       evaluated ONCE rather than per row (law 5). */
    with proj as (select id, name from app.crm_project_options())
    select
      p.id, p.code, p.plot_number, p.block, p.kind,
      p.project_id, proj.name as project_name,
      s.city as project_city,
      coalesce(s.marla_sqft_standard, ${DEFAULT_MARLA_SQFT}) as marla_standard,
      p.size_marla, p.area_sqft, p.dimensions, p.category, p.facing, p.road_width_ft,
      coalesce(p.is_corner, false) as is_corner,
      coalesce(p.is_park_facing, false) as is_park_facing,
      coalesce(p.is_main_boulevard, false) as is_main_boulevard,
      p.base_price, p.premium_charges, p.status::text as status,
      p.development_status, p.expected_possession, p.is_draft, p.notes,
      p.price_updated_at, p.updated_at,
      coalesce(p.is_test_data, false) as is_test_data,

      (select count(*) from public.crm_leads l where l.property_id = p.id) as linked_leads,
      (select count(*) from public.crm_quotations q where q.property_id = p.id) as linked_quotations,
      /* ⚠️ A RESCHEDULED ROW IS HISTORY, NOT A VISIT. One visit moved twice
         would otherwise count as three here and the panel would disagree with
         the Appointments page about the same plot. Caught by
         lib/db/__tests__/superseded-appointments.test.ts, which exists because
         this exact disagreement shipped twice before. */
      (select count(*) from public.crm_appointments a
        where a.property_id = p.id and a.status <> 'rescheduled') as linked_appointments,
      (select b.number from public.crm_bookings b
        where b.property_id = p.id and b.cancelled_at is null
        order by b.created_at desc limit 1) as active_booking,

      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'kind', d.kind::text, 'title', d.title, 'storagePath', d.storage_path)
          order by d.created_at)
          from public.crm_documents d where d.property_id = p.id
      ), '[]'::jsonb) as documents,

      coalesce((
        select jsonb_agg(x.item order by x.sort, x.label)
          from (
            select 1 as sort, q.number as label,
                   jsonb_build_object('kind','quotation','id',q.id,'label',q.number,
                                      'detail', initcap(replace(q.status::text,'_',' '))) as item
              from public.crm_quotations q where q.property_id = p.id
            union all
            select 2 as sort, a.id::text as label,
                   jsonb_build_object('kind','appointment','id',a.id,
                                      'label', coalesce(a.ref_no::text, initcap(replace(a.kind::text,'_',' '))),
                                      'detail', to_char(a.scheduled_at at time zone 'Asia/Karachi','DD Mon')) as item
              from public.crm_appointments a
             where a.property_id = p.id and a.status <> 'rescheduled'
            union all
            select 3 as sort, l.full_name as label,
                   jsonb_build_object('kind','lead','id',l.id,'label',l.full_name,
                                      'detail', initcap(replace(l.stage::text,'_',' '))) as item
              from public.crm_leads l where l.property_id = p.id
          ) x
      ), '[]'::jsonb) as links,

      coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', st.label, 'percentage', st.percentage,
          'amount', st.amount, 'instalments', st.instalments) order by st.sort_order)
          from public.crm_payment_stages st where st.property_id = p.id
      ), '[]'::jsonb) as stages

      from public.crm_properties p
      left join proj on proj.id = p.project_id
      left join public.crm_project_settings s on s.project_id = p.project_id
     /* ⚠️ A DRAFT IS NOT INVENTORY — 267. Half a plot: no price agreed and no
        dimensions checked. Counting one puts a figure on a card nobody has
        finished deciding. */
     where not p.is_draft
     order by p.block nulls last, p.code
  `);

  return rows.map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? '',
    plotNumber: (r.plot_number as string | null) ?? null,
    block: (r.block as string | null) ?? null,
    kind: (r.kind as string | null) ?? null,
    projectId: r.project_id as string,
    projectName: (r.project_name as string | null) ?? '',
    projectCity: (r.project_city as string | null) ?? null,
    marlaStandard: Number(r.marla_standard ?? DEFAULT_MARLA_SQFT),
    sizeMarla: n(r.size_marla),
    areaSqft: n(r.area_sqft),
    dimensions: (r.dimensions as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    facing: (r.facing as string | null) ?? null,
    roadWidthFt: n(r.road_width_ft),
    isCorner: Boolean(r.is_corner),
    isParkFacing: Boolean(r.is_park_facing),
    isMainBoulevard: Boolean(r.is_main_boulevard),
    basePrice: n(r.base_price),
    premiumCharges: n(r.premium_charges),
    status: (r.status as string | null) ?? 'available',
    developmentStatus: (r.development_status as string | null) ?? null,
    expectedPossession: iso(r.expected_possession),
    isDraft: Boolean(r.is_draft),
    notes: (r.notes as string | null) ?? null,
    priceUpdatedAt: iso(r.price_updated_at),
    updatedAt: iso(r.updated_at),
    isTestData: Boolean(r.is_test_data),
    linkedLeads: Number(r.linked_leads ?? 0),
    linkedQuotations: Number(r.linked_quotations ?? 0),
    linkedAppointments: Number(r.linked_appointments ?? 0),
    activeBooking: (r.active_booking as string | null) ?? null,
    documents: (r.documents as PropertyDocument[] | null) ?? [],
    links: (r.links as PropertyLink[] | null) ?? [],
    stages: ((r.stages as PaymentStage[] | null) ?? []).map((s) => ({
      ...s,
      percentage: Number(s.percentage),
      amount: Number(s.amount),
    })),
  }));
}

/* ---------------------------------------------------------------------------
 * The projects somebody may put a property on
 * ------------------------------------------------------------------------- */

export interface CatalogueProject {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly marlaStandard: number;
  readonly sells: string | null;
}

/**
 * ⚠️ Only projects that SELL something with a catalogue. Owner's rule from
 * Phase C: *"Chitral sells plots; AI & Digital sells services. The property
 * fields must not appear on a project that has no catalogue."*
 */
export async function crmCatalogueProjects(actorId: string): Promise<readonly CatalogueProject[]> {
  const rows = await withUser(actorId, (tx) => tx`
    /* ⚠️ Same reason as the board above — "app.crm_project_options()", never
       "public.projects". A picker that is empty for a salesperson is a page
       they cannot add anything on. */
    select pr.id, pr.name, s.city, s.sells::text as sells,
           coalesce(s.marla_sqft_standard, ${DEFAULT_MARLA_SQFT}) as marla_standard
      from app.crm_project_options() pr
      join public.crm_project_settings s on s.project_id = pr.id
     where s.sells in ('property', 'mixed')
     order by pr.name
  `);
  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string | null) ?? '',
    city: (r.city as string | null) ?? null,
    marlaStandard: Number(r.marla_standard ?? DEFAULT_MARLA_SQFT),
    sells: (r.sells as string | null) ?? null,
  }));
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------- */

export interface PropertyInput {
  readonly projectId: string;
  readonly code: string;
  readonly plotNumber: string;
  readonly block: string | null;
  readonly kind: string | null;
  readonly sizeMarla: number;
  readonly areaSqft: number | null;
  readonly dimensions: string | null;
  readonly category: string | null;
  readonly facing: string | null;
  readonly roadWidthFt: number | null;
  readonly basePrice: number;
  readonly premiumCharges: number;
  readonly status: string;
  readonly developmentStatus: string | null;
  readonly expectedPossession: string | null;
  readonly isDraft: boolean;
  readonly isCorner: boolean;
  readonly isParkFacing: boolean;
  readonly isMainBoulevard: boolean;
  readonly notes: string | null;
}

export type WriteResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

/** Is this code already used on this project? Asked before writing, so the
 *  message names the clash rather than showing a constraint violation. */
export async function crmPropertyCodeTaken(
  actorId: string,
  projectId: string,
  code: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    select 1 from public.crm_properties
     where project_id = ${projectId}::uuid
       and lower(btrim(code)) = lower(btrim(${code}))
       and (${exceptId ?? null}::uuid is null or id <> ${exceptId ?? null}::uuid)
     limit 1
  `);
  return rows.length > 0;
}

export async function crmCreateProperty(actorId: string, input: PropertyInput): Promise<WriteResult> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_properties
      (project_id, code, plot_number, block, kind, size_marla, area_sqft, dimensions,
       category, facing, road_width_ft, is_corner, is_park_facing, is_main_boulevard,
       base_price, premium_charges, status, development_status, notes,
       expected_possession, is_draft,
       price_updated_at, catalogue_kind, created_by_id, is_test_data)
    values (${input.projectId}::uuid, ${input.code}, ${input.plotNumber}, ${input.block},
            ${input.kind}, ${input.sizeMarla}, ${input.areaSqft}, ${input.dimensions},
            ${input.category}, ${input.facing}, ${input.roadWidthFt},
            /* ⚠️ THEIR OWN CHECKBOXES on the owner's reference, not derived from
               Category — a corner plot can also face a park, and deriving them
               made those two mutually exclusive. */
            ${input.isCorner}, ${input.isParkFacing}, ${input.isMainBoulevard},
            ${input.basePrice}, ${input.premiumCharges},
            ${input.status}::public.crm_property_status,
            ${input.developmentStatus}, ${input.notes},
            ${input.expectedPossession}::date, ${input.isDraft},
            now(), 'plot', ${actorId}::uuid,
            /* ⚠️ A property inherits the project's test flag, so a demo scheme
               can never contribute a row to a real pipeline figure. */
            coalesce((select is_test_data from public.crm_properties x
                       where x.project_id = ${input.projectId}::uuid limit 1), false))
    returning id
  `);
  const id = rows[0]?.id as string | undefined;
  return id ? { ok: true, id } : { ok: false, error: 'That property was not saved.' };
}

export async function crmUpdateProperty(
  actorId: string,
  id: string,
  input: PropertyInput,
): Promise<WriteResult> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_properties
       set code = ${input.code},
           plot_number = ${input.plotNumber},
           block = ${input.block},
           kind = ${input.kind},
           size_marla = ${input.sizeMarla},
           area_sqft = ${input.areaSqft},
           dimensions = ${input.dimensions},
           category = ${input.category},
           facing = ${input.facing},
           road_width_ft = ${input.roadWidthFt},
           is_corner = ${input.isCorner},
           is_park_facing = ${input.isParkFacing},
           is_main_boulevard = ${input.isMainBoulevard},
           base_price = ${input.basePrice},
           premium_charges = ${input.premiumCharges},
           status = ${input.status}::public.crm_property_status,
           development_status = ${input.developmentStatus},
           expected_possession = ${input.expectedPossession}::date,
           is_draft = ${input.isDraft},
           notes = ${input.notes},
           /* Only stamped when the money actually moved. */
           price_updated_at = case when base_price is distinct from ${input.basePrice}
                                   or premium_charges is distinct from ${input.premiumCharges}
                                   then now() else price_updated_at end,
           updated_at = now()
     where id = ${id}::uuid
    returning id
  `);
  const out = rows[0]?.id as string | undefined;
  return out ? { ok: true, id: out } : { ok: false, error: 'That property could not be changed.' };
}

/** The bulk "Update status" control. Returns how many actually moved. */
export async function crmSetPropertyStatus(
  actorId: string,
  ids: readonly string[],
  status: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  /* ⚠️ One set-based statement, not a loop. A transaction runs its queries in
     series on one connection — 49 s became 2.4 s on the leads importer when
     that lesson was learned. */
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_properties
       set status = ${status}::public.crm_property_status, updated_at = now()
     where id = any (${ids as string[]}::uuid[])
    returning id
  `);
  return rows.length;
}

export async function crmDeleteProperty(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.crm_properties where id = ${id}::uuid returning id
  `);
  return rows.length > 0;
}

/**
 * The bulk import's write step.
 *
 * ⚠️ ONE STATEMENT FOR THE WHOLE SHEET. `unnest` turns the rows into a table
 * and Postgres inserts them in one pass; 500 separate inserts inside one
 * transaction would run in series over a single connection.
 *
 * ⚠️ AND IT IS AN UPSERT ON (project, code) — re-importing a corrected sheet
 * must fix the rows it names rather than making a second copy of the scheme.
 */
export async function crmImportProperties(
  actorId: string,
  projectId: string,
  rows: readonly PropertyInput[],
): Promise<{ readonly inserted: number; readonly updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const before = await withUser(actorId, (tx) => tx`
    select lower(btrim(code)) as code from public.crm_properties
     where project_id = ${projectId}::uuid
  `);
  const existing = new Set(before.map((r) => String(r.code)));

  await withUser(actorId, (tx) => tx`
    insert into public.crm_properties
      (project_id, code, plot_number, block, kind, size_marla, area_sqft, dimensions,
       category, facing, road_width_ft, is_corner, is_park_facing, is_main_boulevard,
       base_price, premium_charges, status, development_status, notes,
       expected_possession, is_draft,
       price_updated_at, catalogue_kind, created_by_id, is_test_data)
    select ${projectId}::uuid, x.code, x.plot_number, x.block, x.kind,
           x.size_marla, x.area_sqft, x.dimensions, x.category, x.facing, x.road_width_ft,
           x.is_corner, x.is_park_facing, x.is_main_boulevard,
           x.base_price, x.premium_charges, x.status::public.crm_property_status,
           x.development_status, x.notes, x.expected_possession::date, false,
           now(), 'plot', ${actorId}::uuid,
           coalesce((select is_test_data from public.crm_properties y
                      where y.project_id = ${projectId}::uuid limit 1), false)
      from unnest(
        ${rows.map((r) => r.code)}::text[],
        ${rows.map((r) => r.plotNumber)}::text[],
        ${rows.map((r) => r.block)}::text[],
        ${rows.map((r) => r.kind)}::text[],
        ${rows.map((r) => r.sizeMarla)}::numeric[],
        ${rows.map((r) => r.areaSqft)}::int[],
        ${rows.map((r) => r.dimensions)}::text[],
        ${rows.map((r) => r.category)}::text[],
        ${rows.map((r) => r.facing)}::text[],
        ${rows.map((r) => r.roadWidthFt)}::int[],
        ${rows.map((r) => r.basePrice)}::bigint[],
        ${rows.map((r) => r.premiumCharges)}::bigint[],
        ${rows.map((r) => r.status)}::text[],
        ${rows.map((r) => r.developmentStatus)}::text[],
        ${rows.map((r) => r.notes)}::text[],
        ${rows.map((r) => r.isCorner)}::boolean[],
        ${rows.map((r) => r.isParkFacing)}::boolean[],
        ${rows.map((r) => r.isMainBoulevard)}::boolean[],
        ${rows.map((r) => r.expectedPossession)}::text[]
      ) as x(code, plot_number, block, kind, size_marla, area_sqft, dimensions,
             category, facing, road_width_ft, base_price, premium_charges,
             status, development_status, notes,
             is_corner, is_park_facing, is_main_boulevard, expected_possession)
    /* ⚠️ THE INDEX IS ON AN EXPRESSION, so the conflict target must be the
       same expression. "crm_properties_code_uq" is
       "(project_id, lower(btrim(code)))"; naming the bare column here compiles
       and then throws "no unique or exclusion constraint matching" at run time,
       which is a failure the importer would only meet on a real sheet. */
    on conflict (project_id, lower(btrim(code))) do update
      set plot_number = excluded.plot_number,
          block = excluded.block,
          kind = excluded.kind,
          size_marla = excluded.size_marla,
          area_sqft = excluded.area_sqft,
          dimensions = excluded.dimensions,
          category = excluded.category,
          facing = excluded.facing,
          road_width_ft = excluded.road_width_ft,
          is_corner = excluded.is_corner,
          is_park_facing = excluded.is_park_facing,
          is_main_boulevard = excluded.is_main_boulevard,
          base_price = excluded.base_price,
          premium_charges = excluded.premium_charges,
          status = excluded.status,
          development_status = excluded.development_status,
          expected_possession = excluded.expected_possession,
          notes = excluded.notes,
          price_updated_at = now(),
          updated_at = now()
  `);

  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    if (existing.has(r.code.trim().toLowerCase())) updated += 1;
    else inserted += 1;
  }
  return { inserted, updated };
}

/** Used by the migration-free health check in `scripts/check-properties.mjs`. */
export async function crmPropertyCount(): Promise<number> {
  const rows = await sql`select count(*)::int as n from public.crm_properties`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * The first of these codes that already exists on the project, or null.
 *
 * ⚠️ ONE QUERY FOR THE WHOLE SHEET. Asking per row would be 500 round trips in
 * series down one connection — the lesson the leads importer learned at 49
 * seconds.
 */
export async function crmFirstExistingCode(
  actorId: string,
  projectId: string,
  codes: readonly string[],
): Promise<string | null> {
  if (codes.length === 0) return null;
  const rows = await withUser(actorId, (tx) => tx`
    select code from public.crm_properties
     where project_id = ${projectId}::uuid
       and lower(btrim(code)) = any (${codes.map((c) => c.trim().toLowerCase())}::text[])
     limit 1
  `);
  return (rows[0]?.code as string | undefined) ?? null;
}
