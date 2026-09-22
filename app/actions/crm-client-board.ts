'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import {
  crmAddClient,
  crmClientActivity,
  crmClientBoard,
  crmClientMatches,
  crmClientOwnerChoices,
  crmUpdateClient,
  type ClientEdit,
  type ClientMatch,
  type ClientMoment,
} from '@/lib/db/queries/crm-client-board';
import { crmLeadDuplicates, type CrmDuplicate } from '@/lib/db/queries/crm-leads';
import { notify } from '@/lib/db/queries/feed';
import {
  cards as cardsOf,
  displayStatus,
  money,
  nextLine,
  phoneLabel,
  refLabel,
  shortDay,
  SOURCE_OPTIONS,
  STATUS_LOOK,
  valueOf,
  type StoredStatus,
} from '@/lib/domain/crm-client-board';
import { companyLetterhead } from '@/lib/db/queries/invoices';
import { composeClientListPdf, type ClientPdfRow } from '@/lib/pdf/client-list-pdf';
import { toE164 } from '@/lib/domain/phone';

/* ============================================================================
 * THE CLIENTS PAGE'S WRITES (249)
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY FIELD IS CHECKED HERE, AND AGAIN IN THE DATABASE. A select is a hint
 * to a person and no kind of guarantee about what arrives; the definer is the
 * rule, and this is what turns a bad input into a sentence before it gets there.
 * ========================================================================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly StoredStatus[] = ['prospect', 'onboarding', 'active', 'dormant'];
const CHANNELS = ['whatsapp', 'call', 'email'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function settle() {
  revalidatePath('/clients');
  revalidatePath('/my-leads');
}

const isSource = (s: string) => SOURCE_OPTIONS.some((o) => o.value === s);

/** The same shape `tellThem` in crm-leads uses — a lead given to somebody is announced. */
async function tellOwner(actorId: string, ownerId: string, leadId: string, who: string) {
  if (ownerId === actorId) return;
  try {
    await withUser(actorId, (tx) =>
      notify(tx, actorId, {
        userId: ownerId,
        kind: 'lead_assigned',
        title: `${who} is now your client`,
        /* ⚠️ No phone number in the body — a notification may sit on a lock screen. */
        body: 'Open Clients to see the full record.',
        linkTo: '/clients',
        entityId: leadId,
      }),
    );
  } catch {
    /* A missed notification must not undo a client that was saved. */
  }
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export async function clientActivityAction(clientId: string): Promise<{ ok: boolean; moments: ClientMoment[] }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(clientId)) return { ok: false, moments: [] };
  return { ok: true, moments: await crmClientActivity(user.id, clientId, 15) };
}

export async function clientOwnerChoicesAction(projectId: string): Promise<{
  manages: boolean;
  people: Array<{ id: string; name: string; openLeads: number }>;
}> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(projectId)) return { manages: false, people: [] };
  return crmClientOwnerChoices(user.id, projectId);
}

/**
 * Do we already know this person? Run as the form is filled, before Save.
 *
 * ⚠️ THE SAME CHECK THE ADD-LEAD FORM USES (157), which sees across ownership
 * and covers existing clients as well as open leads — returning a name, an owner
 * and a project, never a number or a note. The database refuses a real clash on
 * save regardless; this is what lets the form say so first.
 */
export async function clientDuplicatesAction(
  projectId: string,
  phone: string,
  email: string,
): Promise<{ duplicates: CrmDuplicate[] }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(projectId)) return { duplicates: [] };
  const e164 = toE164(phone);
  const clean = email.trim().toLowerCase() || null;
  if (!e164 && !clean) return { duplicates: [] };
  try {
    return { duplicates: await crmLeadDuplicates(user.id, projectId, e164, clean) };
  } catch {
    return { duplicates: [] };
  }
}

/* ── Adding one ──────────────────────────────────────────────────────────── */

export interface AddClientInput {
  readonly projectId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string;
  readonly city: string;
  readonly company: string;
  readonly source: string;
  readonly ownerId: string | null;
  readonly channel: string | null;
  readonly status: string;
  readonly notes: string;
  readonly greet: boolean;
}

type Added = Result<{ clientId: string; leadId: string; ownerName: string | null; refNo: number }>;

export async function addClientAction(input: AddClientInput): Promise<Added> {
  const { user } = await requireCrmAccess();
  const r = await addClientCore(user.id, input);
  if (!r.ok) return r;
  if (input.ownerId) await tellOwner(user.id, input.ownerId, r.leadId, input.fullName.trim());
  settle();
  return r;
}

/** Validate and write one client — no notification, no revalidation (the callers own those). */
async function addClientCore(actorId: string, input: AddClientInput): Promise<Added> {
  if (!UUID.test(input.projectId)) return { ok: false, error: 'Choose the project this client belongs to.' };
  const name = input.fullName.trim();
  if (!name) return { ok: false, error: 'A client needs a name.' };
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  if (!phone && !email) return { ok: false, error: 'Add a phone number or an email.' };
  if (email && !EMAIL.test(email)) return { ok: false, error: 'That email does not look right.' };
  const e164 = phone ? toE164(phone) : null;
  if (phone && !e164) return { ok: false, error: 'That phone number could not be read — include the country code, e.g. +92 300 1234567.' };
  if (!STATUSES.includes(input.status as StoredStatus)) return { ok: false, error: 'Choose a relationship status.' };
  if (input.channel && !(CHANNELS as readonly string[]).includes(input.channel)) return { ok: false, error: 'Choose how they prefer to be reached.' };
  if (!isSource(input.source)) return { ok: false, error: 'Choose where this client came from.' };
  if (input.ownerId && !UUID.test(input.ownerId)) return { ok: false, error: 'Choose a salesperson.' };
  if (name.length > 200 || input.notes.length > 4000) return { ok: false, error: 'That is longer than a client record takes.' };

  return crmAddClient(actorId, {
    projectId: input.projectId,
    fullName: name,
    phone: phone || null,
    phoneE164: e164,
    email: email || null,
    city: input.city.trim() || null,
    company: input.company.trim() || null,
    source: input.source,
    ownerId: input.ownerId,
    channel: (input.channel as 'whatsapp' | 'call' | 'email' | null) || null,
    status: input.status as StoredStatus,
    notes: input.notes.trim() || null,
    greet: input.greet === true,
  });
}

/* ── Changing one, or many ───────────────────────────────────────────────── */

export async function updateClientAction(
  clientId: string,
  edit: {
    fullName?: string;
    company?: string;
    phone?: string;
    email?: string;
    city?: string;
    source?: string;
    ownerId?: string | null;
    channel?: string;
    status?: string;
    notes?: string;
    archive?: boolean;
  },
): Promise<Result> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(clientId)) return { ok: false, error: 'That client could not be found.' };

  const e: ClientEdit = {};
  const out = e as Record<string, unknown>;
  if (edit.fullName !== undefined) {
    if (!edit.fullName.trim()) return { ok: false, error: 'A client needs a name.' };
    out.fullName = edit.fullName.trim();
  }
  if (edit.company !== undefined) out.company = edit.company;
  if (edit.city !== undefined) out.city = edit.city;
  if (edit.notes !== undefined) out.notes = edit.notes;
  if (edit.phone !== undefined) {
    const e164 = edit.phone.trim() ? toE164(edit.phone) : '';
    if (edit.phone.trim() && !e164) return { ok: false, error: 'That phone number could not be read — include the country code.' };
    out.phoneE164 = e164;
  }
  if (edit.email !== undefined) {
    const clean = edit.email.trim().toLowerCase();
    if (clean && !EMAIL.test(clean)) return { ok: false, error: 'That email does not look right.' };
    out.email = clean;
  }
  if (edit.source !== undefined) {
    if (edit.source && !isSource(edit.source)) return { ok: false, error: 'That is not a source.' };
    out.source = edit.source;
  }
  if (edit.channel !== undefined) {
    if (edit.channel && !(CHANNELS as readonly string[]).includes(edit.channel)) return { ok: false, error: 'That is not a channel.' };
    out.channel = edit.channel;
  }
  if (edit.status !== undefined) {
    if (!STATUSES.includes(edit.status as StoredStatus)) return { ok: false, error: 'That is not a relationship status.' };
    out.status = edit.status;
  }
  if (edit.ownerId !== undefined && edit.ownerId !== null) {
    if (!UUID.test(edit.ownerId)) return { ok: false, error: 'Choose a salesperson.' };
    out.ownerId = edit.ownerId;
  }
  if (edit.archive !== undefined) out.archive = edit.archive === true;

  const r = await crmUpdateClient(user.id, clientId, e);
  if (r.ok) settle();
  return r;
}

export type BulkOp = { status: StoredStatus } | { ownerId: string } | { archive: boolean };

/**
 * One change to many clients.
 *
 * ⚠️ EACH ONE THROUGH THE SAME DEFINER, and each refusal reported by name. A
 * bulk action that silently skipped the clients it was not allowed to touch
 * would report "done" for work that was not.
 */
export async function bulkClientAction(ids: readonly string[], op: BulkOp): Promise<{
  ok: boolean;
  done: number;
  refused: Array<{ id: string; error: string }>;
}> {
  const { user } = await requireCrmAccess();
  const clean = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 500);
  const refused: Array<{ id: string; error: string }> = [];
  let done = 0;
  for (const id of clean) {
    const edit: ClientEdit =
      'status' in op
        ? { status: STATUSES.includes(op.status) ? op.status : null }
        : 'ownerId' in op
          ? { ownerId: UUID.test(op.ownerId) ? op.ownerId : null }
          : { archive: op.archive === true };
    const r = await crmUpdateClient(user.id, id, edit);
    if (r.ok) done += 1;
    else refused.push({ id, error: r.error });
  }
  if (done) settle();
  return { ok: refused.length === 0, done, refused };
}

/* ── Import ──────────────────────────────────────────────────────────────── */

/** Who in this sheet already exists, before anything is written. */
export async function importMatchesAction(phones: readonly string[], emails: readonly string[]): Promise<ClientMatch[]> {
  const { user } = await requireCrmAccess();
  const e164s = [...new Set(phones.map((p) => toE164(p)).filter((p): p is string => Boolean(p)))].slice(0, 2000);
  const mails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 2000);
  return crmClientMatches(user.id, e164s, mails);
}

export interface ImportInputRow {
  readonly line: number;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly company: string;
  readonly city: string;
  readonly source: string;
  readonly status: string;
  readonly channel: string | null;
  readonly notes: string;
}

/**
 * Import the rows a person confirmed.
 *
 * ⚠️⚠️ ALWAYS QUIET. An imported sheet is people we already know, and 249's
 * whole reason for `crm_quiet_insert` is that greeting them would message every
 * one of them at once. There is no "greet" option on this path.
 *
 * ⚠️ ROW BY ROW, and every row's own answer comes back. One bad row must not
 * stop the other ninety-nine, and one refused row must not be reported as done.
 */
export async function importClientsAction(input: {
  projectId: string;
  ownerId: string | null;
  rows: readonly ImportInputRow[];
}): Promise<{
  ok: boolean;
  added: number;
  failed: Array<{ line: number; name: string; error: string }>;
  error?: string;
}> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.projectId)) return { ok: false, added: 0, failed: [], error: 'Choose a project.' };
  if (input.ownerId && !UUID.test(input.ownerId)) return { ok: false, added: 0, failed: [], error: 'Choose a salesperson.' };
  const rows = input.rows.slice(0, 500);
  const failed: Array<{ line: number; name: string; error: string }> = [];
  let added = 0;
  let firstLead: string | null = null;
  for (const row of rows) {
    const r = await addClientCore(user.id, {
      projectId: input.projectId,
      fullName: row.name,
      phone: row.phone,
      email: row.email,
      city: row.city,
      company: row.company,
      source: isSource(row.source) ? row.source : 'manual',
      ownerId: input.ownerId,
      channel: row.channel,
      status: STATUSES.includes(row.status as StoredStatus) ? row.status : 'active',
      notes: row.notes,
      greet: false,
    });
    if (r.ok) {
      added += 1;
      firstLead ??= r.leadId;
    } else failed.push({ line: row.line, name: row.name || '(no name)', error: r.error });
  }
  /* ⚠️ ONE NOTICE FOR THE WHOLE SHEET, not one per row — a hundred-row import
     must not put a hundred notifications on somebody's phone. */
  if (added && input.ownerId && firstLead) {
    await tellOwner(user.id, input.ownerId, firstLead, `${added} imported client${added === 1 ? '' : 's'}`);
  }
  if (added) settle();
  return { ok: failed.length === 0, added, failed };
}

/* ── The PDF export ──────────────────────────────────────────────────────────
 * Owner, 2026-09-22: *"In the PDF the proper header should be used in the same
 * way that we are using a header … a proper table, and everything should be
 * properly and sleekly organized."*
 *
 * ⚠️ THE IDS COME FROM THE SCREEN; THE ROWS DO NOT. The board is re-read as the
 * caller, so a PDF can only ever hold clients this person may see — a crafted
 * list of somebody else's ids comes back as fewer rows, never as their data.
 * The letterhead is read in the same wave (law 4).
 * ------------------------------------------------------------------------- */

const PDF_MAX = 2000;
const PDF_TONE: Record<string, ClientPdfRow['statusTone']> = {
  active: 'green',
  prospect: 'blue',
  onboarding: 'blue',
  attention: 'amber',
  dormant: 'grey',
  archived: 'grey',
};

export async function exportClientsPdfAction(
  ids: readonly string[],
  scope: string,
): Promise<Result<{ base64: string; count: number }>> {
  const { user } = await requireCrmAccess();
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, PDF_MAX);
  if (!wanted.length) return { ok: false, error: 'Nothing to export — no clients were chosen.' };
  try {
    const [board, company] = await Promise.all([crmClientBoard(user.id), companyLetterhead(user.id)]);
    const byId = new Map(board.map((c) => [c.id, c]));
    const list = wanted.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (!list.length) return { ok: false, error: 'None of those clients are open to you any more.' };

    const nowMs = Date.now();
    const rows: ClientPdfRow[] = list.map((c) => {
      const s = displayStatus(c, nowMs);
      const v = valueOf(c);
      const n = nextLine(c, nowMs);
      return {
        ref: refLabel(c.refNo),
        name: c.name,
        company: [c.company, c.city].filter(Boolean).join(', '),
        phone: c.phoneE164 ? phoneLabel(c.phoneE164) : '',
        email: c.email ?? '',
        project: c.primaryProjectName ?? '',
        owner: c.ownerName ?? '',
        status: STATUS_LOOK[s].label,
        statusTone: PDF_TONE[s] ?? 'grey',
        value: v.kind === 'none' ? '-' : money(v.amount),
        valueNote: v.kind === 'quoted' ? 'quoted' : undefined,
        next: n.when ? `${n.text} - ${n.when}` : n.text,
        nextLate: n.tone === 'red',
        lastContact: c.lastContactAt ? shortDay(c.lastContactAt) : 'Never',
      };
    });

    /* The page's own five cards, over exactly these rows. */
    const k = cardsOf(list, nowMs);
    const booked = list.reduce((sum, c) => sum + c.bookedValue, 0);
    const stamp = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(nowMs));

    const bytes = await composeClientListPdf({
      company,
      title: 'Client directory',
      generatedFor: user.fullName,
      generatedAt: stamp,
      scope: `${scope.slice(0, 140)} · ${list.length} record${list.length === 1 ? '' : 's'}`,
      summary: [
        { label: 'Clients', value: String(k.total.value) },
        { label: 'Active', value: String(k.active.value) },
        { label: 'Needs attention', value: String(k.attention.value) },
        { label: 'Booked value', value: money(booked) },
        { label: 'Outstanding', value: money(k.outstanding.value) },
      ],
      rows,
    });
    return { ok: true, base64: Buffer.from(bytes).toString('base64'), count: list.length };
  } catch (e) {
    console.error('[clients] PDF export failed', e);
    return { ok: false, error: 'The PDF could not be made. The Excel and CSV exports still work.' };
  }
}
