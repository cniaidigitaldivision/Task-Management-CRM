'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import * as P from '@/lib/db/queries/crm-properties';
import {
  areaSqft,
  SELECTABLE_STATUSES,
  shareable,
  shareText,
  statusLook,
  type PropertyStatus,
} from '@/lib/domain/crm-property';

/* ============================================================================
 * THE PROPERTY CATALOGUE — the writes
 * ----------------------------------------------------------------------------
 * ── ⚠️ EVERY RULE IS RE-CHECKED HERE, NOT IN THE DIALOG ───────────────────
 * A server action is a public endpoint. The page hiding a button protects
 * nothing; `13-PROPERTY-AND-QUOTATION-TESTPACK.md` says the same thing about
 * the send path and it is the same lesson.
 *
 * ── ⚠️ AND RLS IS THE LAST WORD ───────────────────────────────────────────
 * `crm_properties_write` (266) decides whose catalogue this is. Nothing below
 * re-implements that rule in TypeScript — a second copy is a second thing to
 * keep in step. These checks are about the SHAPE of what is being written.
 * ========================================================================= */

export type PropertyResult =
  | { readonly ok: true; readonly message: string; readonly id?: string }
  | { readonly ok: false; readonly error: string };

export interface PropertyForm {
  readonly projectId: string;
  readonly code: string;
  readonly plotNumber: string;
  readonly block: string;
  readonly kind: string;
  readonly sizeMarla: string;
  readonly dimensions: string;
  readonly category: string;
  readonly facing: string;
  readonly roadWidthFt: string;
  readonly basePrice: string;
  readonly premiumCharges: string;
  readonly status: string;
  readonly developmentStatus: string;
  readonly notes: string;
  /** The project's own standard, so the area is computed from the right one. */
  readonly marlaStandard: number;
}

/** Digits only. `4,500,000` and `PKR 4500000` both mean the same number. */
function toAmount(raw: string): number | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

function validate(form: PropertyForm): { readonly input: P.PropertyInput } | { readonly error: string } {
  const code = (form.code ?? '').trim();
  const plot = (form.plotNumber ?? '').trim();
  if (!form.projectId) return { error: 'Choose the project this plot belongs to.' };
  if (code.length < 2) return { error: 'A property needs an ID — PROP-A101, for example.' };
  if (plot.length < 1) return { error: 'A property needs a plot or unit number.' };

  const marla = Number((form.sizeMarla ?? '').trim());
  if (!Number.isFinite(marla) || marla <= 0) return { error: 'Size must be a number of Marla. 1 Kanal is 20.' };

  const price = toAmount(form.basePrice);
  if (price === null) return { error: 'Base price must be a number of rupees.' };
  const premium = toAmount(form.premiumCharges) ?? 0;

  const status = (form.status || 'available') as PropertyStatus;
  if (!SELECTABLE_STATUSES.includes(status)) return { error: 'That is not an availability state.' };

  const road = Number((form.roadWidthFt ?? '').replace(/[^0-9]/g, ''));

  return {
    input: {
      projectId: form.projectId,
      code,
      plotNumber: plot,
      block: (form.block ?? '').trim() || null,
      kind: (form.kind ?? '').trim() || null,
      sizeMarla: marla,
      /* ⚠️ COMPUTED FROM THE PROJECT'S STANDARD, which travelled with the form.
         Never from 225 — see `lib/domain/crm-property.ts`. */
      areaSqft: areaSqft(marla, form.marlaStandard),
      dimensions: (form.dimensions ?? '').trim() || null,
      category: (form.category ?? '').trim() || 'Standard',
      facing: (form.facing ?? '').trim() || null,
      roadWidthFt: Number.isFinite(road) && road > 0 ? road : null,
      basePrice: price,
      premiumCharges: premium,
      status,
      developmentStatus: (form.developmentStatus ?? '').trim() || null,
      notes: (form.notes ?? '').trim() || null,
    },
  };
}

function refresh() {
  revalidatePath('/properties');
}

export async function createPropertyAction(form: PropertyForm): Promise<PropertyResult> {
  const { user } = await requireCrmAccess();
  const checked = validate(form);
  if ('error' in checked) return { ok: false, error: checked.error };

  if (await P.crmPropertyCodeTaken(user.id, checked.input.projectId, checked.input.code)) {
    return { ok: false, error: `${checked.input.code} already exists on this project.` };
  }

  const written = await P.crmCreateProperty(user.id, checked.input);
  if (!written.ok) return { ok: false, error: written.error };

  await auditAlone(user, {
    entityType: 'crm_property',
    entityId: written.id,
    action: 'property.created',
    after: { code: checked.input.code, status: checked.input.status, price: checked.input.basePrice },
  });

  refresh();
  return { ok: true, message: `${checked.input.code} was added.`, id: written.id };
}

export async function updatePropertyAction(id: string, form: PropertyForm): Promise<PropertyResult> {
  const { user } = await requireCrmAccess();
  const checked = validate(form);
  if ('error' in checked) return { ok: false, error: checked.error };

  if (await P.crmPropertyCodeTaken(user.id, checked.input.projectId, checked.input.code, id)) {
    return { ok: false, error: `${checked.input.code} already belongs to another plot on this project.` };
  }

  const written = await P.crmUpdateProperty(user.id, id, checked.input);
  if (!written.ok) return { ok: false, error: written.error };

  await auditAlone(user, {
    entityType: 'crm_property',
    entityId: id,
    action: 'property.updated',
    after: { code: checked.input.code, status: checked.input.status, price: checked.input.basePrice },
  });

  refresh();
  return { ok: true, message: `${checked.input.code} was saved.`, id };
}

/**
 * The bulk control on the toolbar.
 *
 * ⚠️ RESERVING IS A REAL COMMITMENT, so it is audited per property rather than
 * as one "12 rows changed" line. Somebody asking in three months why A-114 was
 * held needs an answer with a name on it.
 */
export async function setPropertyStatusAction(
  ids: readonly string[],
  status: string,
): Promise<PropertyResult> {
  const { user } = await requireCrmAccess();
  if (ids.length === 0) return { ok: false, error: 'Nothing was selected.' };
  if (!SELECTABLE_STATUSES.includes(status as PropertyStatus)) {
    return { ok: false, error: 'That is not an availability state.' };
  }

  const moved = await P.crmSetPropertyStatus(user.id, ids, status);
  if (moved === 0) return { ok: false, error: 'None of those could be changed.' };

  for (const id of ids.slice(0, moved)) {
    await auditAlone(user, {
      entityType: 'crm_property',
      entityId: id,
      action: 'property.status_changed',
      after: { status },
    });
  }

  refresh();
  const label = statusLook(status).label.toLowerCase();
  return { ok: true, message: `${moved} ${moved === 1 ? 'property is' : 'properties are'} now ${label}.` };
}

export async function deletePropertyAction(id: string): Promise<PropertyResult> {
  const { user } = await requireCrmAccess();
  const gone = await P.crmDeleteProperty(user.id, id);
  if (!gone) return { ok: false, error: 'That property could not be removed.' };
  await auditAlone(user, { entityType: 'crm_property', entityId: id, action: 'property.deleted' });
  refresh();
  return { ok: true, message: 'That property was removed from the catalogue.' };
}

/* ---------------------------------------------------------------------------
 * The import
 * ------------------------------------------------------------------------- */

export interface ImportRow {
  readonly [key: string]: string;
}

/**
 * The confirm step of **Upload → Map → Validate → Review → Preview → Confirm**.
 *
 * ⚠️ THE ROWS ARE VALIDATED AGAIN HERE. The wizard validates in the browser so
 * the person can fix a sheet without a round trip; that is a convenience, not a
 * gate. A crafted request reaching this action must meet the same rules.
 */
export async function importPropertiesAction(
  projectId: string,
  marlaStandard: number,
  rows: readonly ImportRow[],
): Promise<PropertyResult & { readonly inserted?: number; readonly updated?: number }> {
  const { user } = await requireCrmAccess();
  if (!projectId) return { ok: false, error: 'Choose the project to import into.' };
  if (rows.length === 0) return { ok: false, error: 'That sheet had no rows to import.' };
  if (rows.length > 2000) return { ok: false, error: 'That is more than 2,000 rows. Split the sheet.' };

  const prepared: P.PropertyInput[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of rows.entries()) {
    const checked = validate({
      projectId,
      marlaStandard,
      code: raw.code ?? '',
      plotNumber: raw.plotNumber ?? '',
      block: raw.block ?? '',
      kind: raw.kind ?? '',
      sizeMarla: raw.sizeMarla ?? '',
      dimensions: raw.dimensions ?? '',
      category: raw.category ?? '',
      facing: raw.facing ?? '',
      roadWidthFt: raw.roadWidthFt ?? '',
      basePrice: raw.basePrice ?? '',
      premiumCharges: raw.premiumCharges ?? '',
      status: (raw.status ?? 'available').toLowerCase().replace(/\s+/g, '_'),
      developmentStatus: raw.developmentStatus ?? '',
      notes: raw.notes ?? '',
    });
    if ('error' in checked) return { ok: false, error: `Row ${i + 2}: ${checked.error}` };

    /* ⚠️ A sheet naming the same plot twice would make the upsert's last row
       win silently. Refused instead — the person needs to know their sheet is
       wrong, not to discover one of the two prices later. */
    const key = checked.input.code.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `${checked.input.code} appears more than once in that sheet.` };
    seen.add(key);

    prepared.push(checked.input);
  }

  const { inserted, updated } = await P.crmImportProperties(user.id, projectId, prepared);

  await auditAlone(user, {
    entityType: 'crm_property',
    entityId: projectId,
    action: 'property.imported',
    after: { inserted, updated, rows: prepared.length },
  });

  refresh();
  return {
    ok: true,
    inserted,
    updated,
    message:
      updated > 0
        ? `${inserted} added and ${updated} updated.`
        : `${inserted} ${inserted === 1 ? 'property' : 'properties'} added.`,
  };
}

/* ---------------------------------------------------------------------------
 * Sharing
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ THE ROW IS RE-READ AS THE CALLER, never taken from the request.
 *
 * The same rule the Clients export follows: the ids come from the screen but
 * the values come from the database under this person's own RLS, so a share
 * cannot carry a property they may not see — and cannot carry a field the
 * browser was never given.
 *
 * ⚠️ AND IT DOES NOT WRITE. The owner: *"sharing a property must never reserve
 * it automatically."* There is no status change anywhere in this function, and
 * the test asserts the row is untouched afterwards.
 */
export async function sharePropertyAction(id: string): Promise<
  PropertyResult & { readonly text?: string; readonly subject?: string }
> {
  const { user } = await requireCrmAccess();
  const board = await P.crmPropertyBoard(user.id);
  const row = board.find((r) => r.id === id);
  if (!row) return { ok: false, error: 'That property is not one you can share.' };

  const safe = shareable(row, row.marlaStandard);
  return {
    ok: true,
    message: 'Customer-safe details copied.',
    subject: `${row.plotNumber ?? row.code} · ${row.projectName}`,
    text: shareText(safe),
  };
}

/** The same, for the whole filtered selection — the toolbar's "Share list". */
export async function sharePropertyListAction(ids: readonly string[]): Promise<
  PropertyResult & { readonly text?: string }
> {
  const { user } = await requireCrmAccess();
  if (ids.length === 0) return { ok: false, error: 'Nothing was selected.' };

  const board = await P.crmPropertyBoard(user.id);
  const wanted = new Set(ids);
  const rows = board.filter((r) => wanted.has(r.id));
  if (rows.length === 0) return { ok: false, error: 'None of those can be shared.' };

  const text = rows.map((r) => shareText(shareable(r, r.marlaStandard))).join('\n\n———\n\n');
  return { ok: true, message: `${rows.length} properties copied.`, text };
}
