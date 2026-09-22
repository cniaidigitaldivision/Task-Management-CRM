import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE CLIENTS PAGE — one read, and the writes it needs (249)
 * ----------------------------------------------------------------------------
 * ⚠️ EVERYTHING THROUGH A DEFINER. `projects_select` needs project membership
 * the sales team does not have (125's trap, recorded eight times now), and the
 * related tables are read through the client's leads — so the page reads
 * `app.crm_client_board()`, which applies 126's visibility rule once per
 * project, and writes through `crm_add_client` / `crm_update_client`, which
 * enforce who may do what.
 *
 * ⚠️ ONE QUERY FOR THE PAGE (Rule Zero, law 3). Tabs, cards, filters, the table,
 * the cards view, paging and the preview are all drawn from these rows; only
 * the preview's activity list is read on selection, and it says so while it is.
 * ========================================================================= */

export interface ClientRow {
  readonly id: string;
  readonly refNo: number;
  readonly name: string;
  readonly company: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly notes: string | null;
  readonly source: string | null;
  readonly preferredChannel: 'whatsapp' | 'call' | 'email' | null;
  /** What a person set: prospect · onboarding · active · dormant. */
  readonly status: 'prospect' | 'onboarding' | 'active' | 'dormant';
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly leadIds: readonly string[];
  /** The lead most recently active — what "open the conversation" means. */
  readonly primaryLeadId: string | null;
  readonly primaryProjectId: string | null;
  readonly primaryProjectName: string | null;
  readonly projectNames: readonly string[];
  readonly leadStage: string | null;
  readonly openDeals: number;
  readonly wonLeads: number;
  readonly lastContactAt: string | null;
  readonly lastDirection: 'inbound' | 'outbound' | null;
  /** The soonest thing owed — past ones included, which is what "overdue" means. */
  readonly nextAt: string | null;
  readonly nextKind: string | null;
  readonly nextLabel: string | null;
  readonly properties: number;
  readonly quotations: number;
  readonly appointments: number;
  readonly bookings: number;
  readonly invoices: number;
  readonly unpaidInvoices: number;
  readonly unpaidAmount: number;
  readonly overdueInvoices: number;
  /** Non-cancelled bookings — money actually committed. */
  readonly bookedValue: number;
  /** Approved or sent quotations — money offered, not yet committed. */
  readonly quotedValue: number;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function crmClientBoard(actorId: string): Promise<ClientRow[]> {
  const rows = await withUser(actorId, (tx) => tx`select * from app.crm_client_board()`);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    refNo: Number(r.ref_no),
    name: String(r.full_name ?? 'Unnamed'),
    company: (r.company as string | null) ?? null,
    phoneE164: (r.phone_e164 as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    preferredChannel: (['whatsapp', 'call', 'email'].includes(String(r.preferred_channel))
      ? r.preferred_channel
      : null) as ClientRow['preferredChannel'],
    status: (['prospect', 'onboarding', 'active', 'dormant'].includes(String(r.status))
      ? r.status
      : 'active') as ClientRow['status'],
    archivedAt: iso(r.archived_at),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    leadIds: ((r.lead_ids as string[] | null) ?? []).map(String),
    primaryLeadId: (r.primary_lead_id as string | null) ?? null,
    primaryProjectId: (r.primary_project_id as string | null) ?? null,
    primaryProjectName: (r.primary_project_name as string | null) ?? null,
    projectNames: ((r.project_names as string[] | null) ?? []).map(String),
    leadStage: (r.lead_stage as string | null) ?? null,
    openDeals: num(r.open_deals),
    wonLeads: num(r.won_leads),
    lastContactAt: iso(r.last_contact_at),
    lastDirection: r.last_direction === 'inbound' || r.last_direction === 'outbound' ? r.last_direction : null,
    nextAt: iso(r.next_at),
    nextKind: (r.next_kind as string | null) ?? null,
    nextLabel: (r.next_label as string | null) ?? null,
    properties: num(r.properties),
    quotations: num(r.quotations),
    appointments: num(r.appointments),
    bookings: num(r.bookings),
    invoices: num(r.invoices),
    unpaidInvoices: num(r.unpaid_invoices),
    unpaidAmount: num(r.unpaid_amount),
    overdueInvoices: num(r.overdue_invoices),
    bookedValue: num(r.booked_value),
    quotedValue: num(r.quoted_value),
  }));
}

export interface ClientMoment {
  readonly at: string;
  readonly kind: string;
  readonly title: string;
  readonly detail: string | null;
  readonly leadId: string | null;
}

export async function crmClientActivity(actorId: string, clientId: string, limit = 15): Promise<ClientMoment[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_client_activity(${clientId}::uuid, ${limit})
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    at: iso(r.occurred_at) ?? new Date(0).toISOString(),
    kind: String(r.kind),
    title: String(r.title ?? ''),
    detail: (r.detail as string | null) ?? null,
    leadId: (r.lead_id as string | null) ?? null,
  }));
}

export interface NewClient {
  readonly projectId: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly company: string | null;
  readonly source: string;
  readonly ownerId: string | null;
  readonly channel: 'whatsapp' | 'call' | 'email' | null;
  readonly status: ClientRow['status'];
  readonly notes: string | null;
  /** ⚠️ False unless a person ticked it — see 249's header. */
  readonly greet: boolean;
}

export type Refused = { ok: false; error: string };

/** The function's own sentence, for its own code only — anything else is a real fault. */
function refusal(error: unknown): Refused | null {
  const code = (error as { code?: string }).code;
  if (code === 'CR249' || code === 'CRM96') return { ok: false, error: (error as Error).message };
  return null;
}

export async function crmAddClient(
  actorId: string,
  c: NewClient,
): Promise<{ ok: true; clientId: string; leadId: string; ownerName: string | null; refNo: number } | Refused> {
  try {
    const rows = await withUser(actorId, (tx) => tx`
      select * from app.crm_add_client(
        ${c.projectId}::uuid, ${c.fullName}, ${c.phone}, ${c.phoneE164}, ${c.email},
        ${c.city}, ${c.company}, ${c.source}, ${c.ownerId}::uuid, ${c.channel},
        ${c.status}, ${c.notes}, ${c.greet})
    `);
    const r = (rows as Array<Record<string, unknown>>)[0];
    return {
      ok: true,
      clientId: String(r.client_id),
      leadId: String(r.lead_id),
      ownerName: (r.owner_name as string | null) ?? null,
      refNo: Number(r.ref_no),
    };
  } catch (error) {
    const r = refusal(error);
    if (r) return r;
    throw error;
  }
}

/** Null on a field means "leave it"; an empty string means "clear it". */
export interface ClientEdit {
  readonly fullName?: string | null;
  readonly company?: string | null;
  readonly phoneE164?: string | null;
  readonly email?: string | null;
  readonly city?: string | null;
  readonly source?: string | null;
  readonly ownerId?: string | null;
  readonly channel?: string | null;
  readonly status?: ClientRow['status'] | null;
  readonly notes?: string | null;
  readonly archive?: boolean | null;
}

export async function crmUpdateClient(actorId: string, clientId: string, e: ClientEdit): Promise<{ ok: true } | Refused> {
  try {
    await withUser(actorId, (tx) => tx`
      select app.crm_update_client(
        ${clientId}::uuid, ${e.fullName ?? null}, ${e.company ?? null}, ${e.phoneE164 ?? null},
        ${e.email ?? null}, ${e.city ?? null}, ${e.source ?? null}, ${e.ownerId ?? null}::uuid,
        ${e.channel ?? null}, ${e.status ?? null}, ${e.notes ?? null}, ${e.archive ?? null})
    `);
    return { ok: true };
  } catch (error) {
    const r = refusal(error);
    if (r) return r;
    throw error;
  }
}

export interface ClientMatch {
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly kind: 'client' | 'lead';
  readonly name: string;
  readonly ownerName: string | null;
  readonly projectName: string | null;
}

/** Who already exists, for a whole import at once — the minimum, see 249 §8. */
export async function crmClientMatches(actorId: string, phones: string[], emails: string[]): Promise<ClientMatch[]> {
  if (phones.length === 0 && emails.length === 0) return [];
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_client_matches(${phones}::text[], ${emails}::text[])
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    phoneE164: (r.phone_e164 as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    kind: r.kind === 'lead' ? 'lead' : 'client',
    name: String(r.full_name ?? 'Unnamed'),
    ownerName: (r.owner_name as string | null) ?? null,
    projectName: (r.project_name as string | null) ?? null,
  }));
}

/**
 * Who a client on this project may be given to.
 *
 * ⚠️ THE ROTA'S OWN LIST (`app.crm_lead_rota`) — the people eligible for this
 * project's leads — so the picker cannot offer somebody the database would
 * then refuse. A non-manager is only ever offered themselves, which is the rule
 * `crm_add_client` enforces.
 */
export async function crmClientOwnerChoices(
  actorId: string,
  projectId: string,
): Promise<{ manages: boolean; people: Array<{ id: string; name: string; openLeads: number }> }> {
  return withUser(actorId, async (tx) => {
    const [m] = (await tx`select app.crm_manages_project(${projectId}::uuid) as manages`) as unknown as Array<{ manages: boolean }>;
    const rota = (await tx`select user_id, full_name, open_leads from app.crm_lead_rota(${projectId}::uuid)`) as unknown as Array<{
      user_id: string;
      full_name: string;
      open_leads: number;
    }>;
    return {
      manages: m?.manages === true,
      people: rota.map((r) => ({ id: String(r.user_id), name: String(r.full_name), openLeads: Number(r.open_leads ?? 0) })),
    };
  });
}
