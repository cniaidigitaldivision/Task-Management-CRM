import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE AGENCY CATALOGUE — packages, services, platforms, clients
 * ----------------------------------------------------------------------------
 * Migration 032. Read by every screen that offers a choice: the project form's
 * package dropdown, the platform tick-list, the services picker.
 *
 * ── READABLE BY EVERYONE, WRITABLE BY ADMIN+ ─────────────────────────────────
 * The select policies are "anybody signed in", because a Member has to be able
 * to see which package their own project is on. The write policies are Admin+,
 * because this is the company's commercial offering. Both are enforced in the
 * database; nothing here re-implements them.
 *
 * ── ⚠️ THESE ARE DEFAULTS, NOT THE TRUTH ─────────────────────────────────────
 * A package's numbers seed a new project's form and are then COPIED onto the
 * project. Never join a report to `packages` to find out what a project was
 * promised — read the project's own `assets_target_min`. Editing SPARK must not
 * change what an existing SPARK client was told. See migration 033's header.
 * ========================================================================= */

export interface PackageRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly monthlyFeePkr: number | null;
  readonly feeIsFrom: boolean;
  /** Null where the document says "Multi-market" or "Custom" rather than a
   *  number. Not zero — zero platforms would be a different claim. */
  readonly platformCount: number | null;
  readonly assetsMin: number | null;
  readonly assetsMax: number | null;
  readonly reelsMin: number | null;
  readonly includesWebsite: boolean;
  readonly websiteNote: string | null;
  readonly includesCrm: boolean;
  readonly crmNote: string | null;
  readonly automationNote: string | null;
  readonly reportingCadence: string | null;
  readonly freeBenefit: string | null;
  readonly bestFor: string | null;
  /** Platform ids the package names itself. Only the lower tiers do; the rest
   *  give a count and leave the choice to the project. */
  readonly defaultPlatformIds: readonly string[];
}

function toPackage(row: Record<string, unknown>): PackageRow {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    tagline: (row.tagline as string | null) ?? null,
    monthlyFeePkr: num(row.monthly_fee_pkr),
    feeIsFrom: Boolean(row.fee_is_from),
    platformCount: num(row.platform_count),
    assetsMin: num(row.assets_min),
    assetsMax: num(row.assets_max),
    reelsMin: num(row.reels_min),
    includesWebsite: Boolean(row.includes_website),
    websiteNote: (row.website_note as string | null) ?? null,
    includesCrm: Boolean(row.includes_crm),
    crmNote: (row.crm_note as string | null) ?? null,
    automationNote: (row.automation_note as string | null) ?? null,
    reportingCadence: (row.reporting_cadence as string | null) ?? null,
    freeBenefit: (row.free_benefit as string | null) ?? null,
    bestFor: (row.best_for as string | null) ?? null,
    defaultPlatformIds: (row.default_platform_ids as string[] | null) ?? [],
  };
}

/** Every active package, cheapest first. */
export async function listPackages(actorId: string): Promise<PackageRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select p.*,
           coalesce(
             (select array_agg(pp.platform_id) from public.package_platforms pp
               where pp.package_id = p.id),
             '{}'
           ) as default_platform_ids
      from public.packages p
     where p.is_active
     order by p.sort_order
  `);
  return rows.map((r) => toPackage(r as Record<string, unknown>));
}

export interface PlatformRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export async function listPlatforms(actorId: string): Promise<PlatformRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, slug, name from public.platforms
     where is_active order by sort_order, name
  `);
  return rows.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
  }));
}

export interface ServiceRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: 'service' | 'add_on';
  readonly unit: 'monthly' | 'per_project' | 'on_demand';
  readonly pricePkr: number | null;
  readonly priceIsFrom: boolean;
}

export async function listServices(actorId: string): Promise<ServiceRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, slug, name, category, unit, price_pkr, price_is_from
      from public.services
     where is_active order by category, sort_order, name
  `);
  return rows.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    category: r.category as 'service' | 'add_on',
    unit: r.unit as 'monthly' | 'per_project' | 'on_demand',
    pricePkr: r.price_pkr === null ? null : Number(r.price_pkr),
    priceIsFrom: Boolean(r.price_is_from),
  }));
}

export interface ClientRow {
  readonly id: string;
  readonly name: string;
  readonly isInternal: boolean;
}

/** Ships empty — the owner populates it. See migration 032. */
export async function listClients(actorId: string): Promise<ClientRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, is_internal from public.clients
     where is_active order by is_internal desc, lower(name)
  `);
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    isInternal: Boolean(r.is_internal),
  }));
}

/**
 * Create a client on the fly, or return the existing one.
 *
 * The project form needs this: typing a new client's name should not mean
 * leaving the form to go and register them first. Matched on lower(name),
 * which is what the unique index enforces, so "AGC Interior" and "AGC interior"
 * cannot become two clients — the exact failure a free-text column would have.
 */
export async function ensureClient(
  actorId: string,
  input: { name: string; isInternal: boolean },
): Promise<string> {
  const name = input.name.trim();

  const rows = await withUser(actorId, (tx) => tx`
    insert into public.clients (name, is_internal)
    values (${name}, ${input.isInternal})
    on conflict (lower(name)) do update
       /* Touch nothing meaningful — this exists only to return the id of the row
          that already existed. Overwriting is_internal here would let creating
          a project silently reclassify an established client. */
       set updated_at = now()
    returning id
  `);
  return rows[0].id as string;
}
