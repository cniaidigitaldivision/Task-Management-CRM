import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * RELATED ITEMS — everything the drawer's dialog shows, in ONE round trip
 * ----------------------------------------------------------------------------
 * Owner's five tabs of 2026-09-17: Quotations, Properties, Appointments,
 * Bookings, Invoices.
 *
 * ⚠️ ONE STATEMENT, NOT FIVE. Five reads inside one `withUser` transaction run
 * in series on one connection — 500 ms from Karachi for a dialog somebody opens
 * to look at a price (`transactions-run-queries-in-series` in the notes). This
 * is one statement returning one row of JSON.
 *
 * ⚠️ AND IT IS FETCHED WHEN THE DIALOG OPENS, never with the drawer. The drawer
 * must stay instant (Rule Zero); a payment plan nobody has asked to see has no
 * business in its first paint.
 *
 * ⚠️ RLS DECIDES EVERYTHING. Read as the person: `crm_bookings`, `crm_invoices`,
 * `crm_quotations` and `crm_appointments` all delegate to `crm_leads`, so a lead
 * they cannot see comes back empty rather than forbidden.
 * ========================================================================= */

export interface RelatedQuotation {
  readonly id: string;
  readonly number: string;
  readonly version: number;
  readonly status: string;
  readonly netAmount: number;
  readonly basePrice: number;
  readonly requestedDiscount: number;
  readonly approvedDiscount: number;
  readonly validUntil: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly pdfPath: string | null;
  readonly propertyId: string | null;
  readonly propertyLabel: string | null;
  readonly preparedByName: string | null;
  readonly terms: string | null;
}

export interface RelatedPaymentStage {
  readonly label: string;
  readonly amount: number | null;
  readonly percentage: number | null;
  readonly instalments: number | null;
}

export interface RelatedProperty {
  readonly id: string;
  readonly label: string;
  readonly block: string | null;
  readonly kind: string;
  readonly status: string;
  readonly sizeMarla: number | null;
  readonly areaSqft: number | null;
  readonly dimensions: string | null;
  readonly facing: string | null;
  readonly roadWidthFt: number | null;
  readonly basePrice: number | null;
  readonly projectName: string | null;
  readonly stages: readonly RelatedPaymentStage[];
  /** True when this is the unit attached to the lead itself. */
  readonly linked: boolean;
}

export interface RelatedAppointment {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly location: string | null;
  readonly notes: string | null;
  readonly outcome: string | null;
  readonly ownerName: string | null;
  readonly propertyLabel: string | null;
}

export interface RelatedBooking {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly amount: number;
  readonly verifiedAmount: number;
  readonly requestedAt: string;
  readonly verificationRequestedAt: string | null;
  readonly verifiedAt: string | null;
  readonly confirmedAt: string | null;
  readonly cancelReason: string | null;
  readonly notes: string | null;
  readonly quotationNumber: string | null;
  readonly quotationStatus: string | null;
  readonly propertyLabel: string | null;
  readonly createdByName: string | null;
}

export interface RelatedInvoice {
  readonly id: string;
  readonly number: string;
  readonly description: string;
  readonly status: string;
  readonly amount: number;
  readonly paidAmount: number;
  readonly issuedAt: string;
  readonly dueAt: string | null;
  readonly pdfPath: string | null;
  readonly bookingNumber: string | null;
  readonly quotationNumber: string | null;
  readonly propertyLabel: string | null;
}

export interface RelatedItems {
  readonly quotations: readonly RelatedQuotation[];
  readonly properties: readonly RelatedProperty[];
  readonly appointments: readonly RelatedAppointment[];
  readonly bookings: readonly RelatedBooking[];
  readonly invoices: readonly RelatedInvoice[];
  /** What this person may do with money — Finance and admins only (194/195). */
  readonly canVerifyPayments: boolean;
}

const EMPTY: RelatedItems = {
  quotations: [], properties: [], appointments: [], bookings: [], invoices: [],
  canVerifyPayments: false,
};

export async function readLeadRelatedItems(actorId: string, leadId: string): Promise<RelatedItems> {
  const rows = (await withUser(actorId, (tx) => tx`
    with lead as (
      select l.id, l.project_id, l.property_id from public.crm_leads l where l.id = ${leadId}::uuid
    ),
    /* Every property this lead touches: the unit attached to it, and any unit a
       quotation or a booking names. */
    props as (
      select p.*, (p.id = (select property_id from lead)) as linked
        from public.crm_properties p
       where p.id = (select property_id from lead)
          or p.id in (select property_id from public.crm_quotations where lead_id = (select id from lead))
          or p.id in (select property_id from public.crm_bookings where lead_id = (select id from lead))
    )
    select
      coalesce((
        select json_agg(json_build_object(
          'id', q.id, 'number', q.number, 'version', q.version, 'status', q.status,
          'netAmount', q.net_amount, 'basePrice', q.base_price,
          'requestedDiscount', q.requested_discount, 'approvedDiscount', q.approved_discount,
          'validUntil', q.valid_until, 'createdAt', q.created_at, 'sentAt', q.sent_at,
          'pdfPath', q.pdf_path, 'propertyId', q.property_id,
          'propertyLabel', pr.code || coalesce(' · ' || pr.block, ''),
          'preparedByName', (select o.full_name from app.crm_lead_owners() o where o.id = q.prepared_by_id),
          'terms', q.terms
        ) order by q.created_at desc)
          from public.crm_quotations q
          left join public.crm_properties pr on pr.id = q.property_id
         where q.lead_id = (select id from lead)), '[]'::json) as quotations,

      coalesce((
        select json_agg(json_build_object(
          'id', p.id, 'label', p.code || coalesce(' · ' || p.block, ''), 'block', p.block,
          'kind', p.kind, 'status', p.status, 'sizeMarla', p.size_marla, 'areaSqft', p.area_sqft,
          'dimensions', p.dimensions, 'facing', p.facing, 'roadWidthFt', p.road_width_ft,
          'basePrice', p.base_price, 'projectName', app.crm_project_name(p.project_id),
          'linked', p.linked,
          'stages', coalesce((
            select json_agg(json_build_object(
              'label', s.label, 'amount', s.amount, 'percentage', s.percentage, 'instalments', s.instalments)
              order by s.sort_order)
              from public.crm_payment_stages s where s.property_id = p.id), '[]'::json)
        ) order by p.linked desc, p.code)
          from props p), '[]'::json) as properties,

      coalesce((
        select json_agg(json_build_object(
          'id', a.id, 'kind', a.kind, 'status', a.status, 'scheduledAt', a.scheduled_at,
          'durationMinutes', a.duration_minutes, 'location', a.location, 'notes', a.notes,
          'outcome', a.outcome,
          'ownerName', (select o.full_name from app.crm_lead_owners() o where o.id = a.owner_id),
          'propertyLabel', pr.code || coalesce(' · ' || pr.block, '')
        ) order by a.scheduled_at desc)
          from public.crm_appointments a
          left join public.crm_properties pr on pr.id = a.property_id
         where a.lead_id = (select id from lead)), '[]'::json) as appointments,

      coalesce((
        select json_agg(json_build_object(
          'id', b.id, 'number', b.number, 'status', b.status, 'amount', b.amount,
          'verifiedAmount', b.verified_amount, 'requestedAt', b.requested_at,
          'verificationRequestedAt', b.verification_requested_at, 'verifiedAt', b.verified_at,
          'confirmedAt', b.confirmed_at, 'cancelReason', b.cancel_reason, 'notes', b.notes,
          'quotationNumber', q.number, 'quotationStatus', q.status,
          'propertyLabel', pr.code || coalesce(' · ' || pr.block, ''),
          'createdByName', (select o.full_name from app.crm_lead_owners() o where o.id = b.created_by_id)
        ) order by b.created_at desc)
          from public.crm_bookings b
          left join public.crm_quotations q on q.id = b.quotation_id
          left join public.crm_properties pr on pr.id = b.property_id
         where b.lead_id = (select id from lead)), '[]'::json) as bookings,

      coalesce((
        select json_agg(json_build_object(
          'id', i.id, 'number', i.number, 'description', i.description, 'status', i.status,
          'amount', i.amount, 'paidAmount', i.paid_amount, 'issuedAt', i.issued_at,
          'dueAt', i.due_at, 'pdfPath', i.pdf_path,
          'bookingNumber', b.number, 'quotationNumber', q.number,
          'propertyLabel', pr.code || coalesce(' · ' || pr.block, '')
        ) order by i.issued_at desc, i.created_at desc)
          from public.crm_invoices i
          left join public.crm_bookings b on b.id = i.booking_id
          left join public.crm_quotations q on q.id = i.quotation_id
          left join public.crm_properties pr on pr.id = i.property_id
         where i.lead_id = (select id from lead)), '[]'::json) as invoices,

      (app.acting_at_least('admin'::public.user_role)
       or app.acting_department_key() = 'finance') as can_verify
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return EMPTY;

  const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    canVerifyPayments: row.can_verify === true,
    quotations: list<Record<string, unknown>>(row.quotations).map((q) => ({
      id: String(q.id),
      number: String(q.number),
      version: num(q.version),
      status: String(q.status),
      netAmount: num(q.netAmount),
      basePrice: num(q.basePrice),
      requestedDiscount: num(q.requestedDiscount),
      approvedDiscount: num(q.approvedDiscount),
      validUntil: q.validUntil ? String(q.validUntil) : null,
      createdAt: new Date(String(q.createdAt)).toISOString(),
      sentAt: q.sentAt ? new Date(String(q.sentAt)).toISOString() : null,
      pdfPath: (q.pdfPath as string | null) ?? null,
      propertyId: (q.propertyId as string | null) ?? null,
      propertyLabel: (q.propertyLabel as string | null) ?? null,
      preparedByName: (q.preparedByName as string | null) ?? null,
      terms: (q.terms as string | null) ?? null,
    })),
    properties: list<Record<string, unknown>>(row.properties).map((p) => ({
      id: String(p.id),
      label: String(p.label ?? ''),
      block: (p.block as string | null) ?? null,
      kind: String(p.kind ?? ''),
      status: String(p.status ?? ''),
      sizeMarla: p.sizeMarla === null ? null : num(p.sizeMarla),
      areaSqft: p.areaSqft === null ? null : num(p.areaSqft),
      dimensions: (p.dimensions as string | null) ?? null,
      facing: (p.facing as string | null) ?? null,
      roadWidthFt: p.roadWidthFt === null ? null : num(p.roadWidthFt),
      basePrice: p.basePrice === null ? null : num(p.basePrice),
      projectName: (p.projectName as string | null) ?? null,
      linked: p.linked === true,
      stages: list<Record<string, unknown>>(p.stages).map((s) => ({
        label: String(s.label ?? ''),
        amount: s.amount === null ? null : num(s.amount),
        percentage: s.percentage === null ? null : num(s.percentage),
        instalments: s.instalments === null ? null : num(s.instalments),
      })),
    })),
    appointments: list<Record<string, unknown>>(row.appointments).map((a) => ({
      id: String(a.id),
      kind: String(a.kind),
      status: String(a.status),
      scheduledAt: new Date(String(a.scheduledAt)).toISOString(),
      durationMinutes: num(a.durationMinutes),
      location: (a.location as string | null) ?? null,
      notes: (a.notes as string | null) ?? null,
      outcome: (a.outcome as string | null) ?? null,
      ownerName: (a.ownerName as string | null) ?? null,
      propertyLabel: (a.propertyLabel as string | null) ?? null,
    })),
    bookings: list<Record<string, unknown>>(row.bookings).map((b) => ({
      id: String(b.id),
      number: String(b.number),
      status: String(b.status),
      amount: num(b.amount),
      verifiedAmount: num(b.verifiedAmount),
      requestedAt: new Date(String(b.requestedAt)).toISOString(),
      verificationRequestedAt: b.verificationRequestedAt ? new Date(String(b.verificationRequestedAt)).toISOString() : null,
      verifiedAt: b.verifiedAt ? new Date(String(b.verifiedAt)).toISOString() : null,
      confirmedAt: b.confirmedAt ? new Date(String(b.confirmedAt)).toISOString() : null,
      cancelReason: (b.cancelReason as string | null) ?? null,
      notes: (b.notes as string | null) ?? null,
      quotationNumber: (b.quotationNumber as string | null) ?? null,
      quotationStatus: (b.quotationStatus as string | null) ?? null,
      propertyLabel: (b.propertyLabel as string | null) ?? null,
      createdByName: (b.createdByName as string | null) ?? null,
    })),
    invoices: list<Record<string, unknown>>(row.invoices).map((i) => ({
      id: String(i.id),
      number: String(i.number),
      description: String(i.description),
      status: String(i.status),
      amount: num(i.amount),
      paidAmount: num(i.paidAmount),
      issuedAt: String(i.issuedAt),
      dueAt: i.dueAt ? String(i.dueAt) : null,
      pdfPath: (i.pdfPath as string | null) ?? null,
      bookingNumber: (i.bookingNumber as string | null) ?? null,
      quotationNumber: (i.quotationNumber as string | null) ?? null,
      propertyLabel: (i.propertyLabel as string | null) ?? null,
    })),
  };
}

/* ── The writes behind the dialog's buttons ─────────────────────────────── */

export type RelatedWrite = { readonly ok: true } | { readonly ok: false; readonly error: string };

const NOT_YOURS = 'That could not be changed. It may not be yours to work.';

/** A booking a salesperson takes, against a quotation the client agreed. */
export async function createBooking(
  actorId: string,
  input: { leadId: string; quotationId: string | null; propertyId: string | null; amount: number; notes: string | null },
): Promise<RelatedWrite> {
  const rows = (await withUser(actorId, (tx) => tx`
    insert into public.crm_bookings
      (lead_id, project_id, property_id, quotation_id, amount, notes, is_test_data, created_by_id)
    select l.id, l.project_id,
           coalesce(${input.propertyId}::uuid, l.property_id),
           ${input.quotationId}::uuid, ${input.amount}, ${input.notes},
           l.is_test_data, ${actorId}::uuid
      from public.crm_leads l
     where l.id = ${input.leadId}::uuid
    returning id
  `)) as Array<{ id: string }>;
  return rows[0] ? { ok: true } : { ok: false, error: NOT_YOURS };
}

/** "Request verification" — the salesperson's half of the booking. */
export async function requestBookingVerification(actorId: string, bookingId: string): Promise<RelatedWrite> {
  const rows = (await withUser(actorId, (tx) => tx`
    update public.crm_bookings
       set status = 'pending_verification', verification_requested_at = now(), updated_at = now()
     where id = ${bookingId}::uuid
       and status in ('requested', 'pending_verification')
    returning id
  `)) as Array<{ id: string }>;
  return rows[0] ? { ok: true } : { ok: false, error: 'That booking is not waiting to be checked.' };
}

/**
 * Finance's half.
 *
 * ⚠️ THE TRIGGER REFUSES ANYBODY ELSE (194) — this is not the guard, it is the
 * caller. A salesperson pressing it gets the database's own words back.
 */
export async function confirmBooking(actorId: string, bookingId: string, verifiedAmount: number): Promise<RelatedWrite> {
  try {
    const rows = (await withUser(actorId, (tx) => tx`
      update public.crm_bookings
         set verified_amount = ${verifiedAmount},
             status = 'confirmed',
             confirmed_at = now(),
             updated_at = now()
       where id = ${bookingId}::uuid
         and status in ('requested', 'pending_verification')
      returning id
    `)) as Array<{ id: string }>;
    return rows[0] ? { ok: true } : { ok: false, error: 'That booking is already settled.' };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'CRM94') return { ok: false, error: 'Only Finance can confirm a booking.' };
    throw error;
  }
}

export async function createInvoice(
  actorId: string,
  input: { leadId: string; bookingId: string | null; description: string; amount: number; dueAt: string | null },
): Promise<RelatedWrite> {
  const rows = (await withUser(actorId, (tx) => tx`
    insert into public.crm_invoices
      (lead_id, project_id, booking_id, quotation_id, property_id, description, amount, due_at,
       is_test_data, created_by_id)
    select l.id, l.project_id, b.id, coalesce(b.quotation_id, q.id), coalesce(b.property_id, l.property_id),
           ${input.description}, ${input.amount}, ${input.dueAt}::date, l.is_test_data, ${actorId}::uuid
      from public.crm_leads l
      left join public.crm_bookings b on b.id = ${input.bookingId}::uuid and b.lead_id = l.id
      left join lateral (
        select q.id from public.crm_quotations q
         where q.lead_id = l.id and q.status not in ('superseded', 'rejected', 'expired')
         order by q.version desc limit 1
      ) q on true
     where l.id = ${input.leadId}::uuid
    returning id
  `)) as Array<{ id: string }>;
  return rows[0] ? { ok: true } : { ok: false, error: NOT_YOURS };
}

/** ⚠️ Finance only — 195's trigger, surfaced in the caller's words. */
export async function recordInvoicePayment(actorId: string, invoiceId: string, paidAmount: number): Promise<RelatedWrite> {
  try {
    const rows = (await withUser(actorId, (tx) => tx`
      update public.crm_invoices
         set paid_amount = ${paidAmount}, updated_at = now()
       where id = ${invoiceId}::uuid
         and status <> 'void'
      returning id
    `)) as Array<{ id: string }>;
    return rows[0] ? { ok: true } : { ok: false, error: 'That invoice could not be updated.' };
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'CRM95') return { ok: false, error: 'Only Finance can record a payment.' };
    if (e.code === '23514') return { ok: false, error: 'A payment cannot be more than the invoice.' };
    throw error;
  }
}

/**
 * Attach a PDF to a quotation.
 *
 * ⚠️ THE FILE IS ALREADY IN THE BUCKET. The browser uploads it on a signed URL —
 * a Vercel function refuses a body over 4.5 MB, and a quotation with a site plan
 * in it passes that easily. This records where it went.
 *
 * ⚠️ AND IT IS ALSO A DOCUMENT. `crm_documents` is where the shelf, the email
 * attachments and the sequence steps look; a PDF known only to one column would
 * be invisible to all three.
 */
export async function attachQuotationPdf(
  actorId: string,
  input: { quotationId: string; path: string; title: string; mime: string; sizeBytes: number },
): Promise<RelatedWrite> {
  const rows = (await withUser(actorId, async (tx) => {
    const updated = (await tx`
      update public.crm_quotations
         set pdf_path = ${input.path}, updated_at = now()
       where id = ${input.quotationId}::uuid
      returning lead_id, project_id, number
    `) as Array<{ lead_id: string; project_id: string; number: string }>;
    if (!updated[0]) return [] as Array<{ id: string }>;

    return (await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      select ${updated[0].project_id}::uuid, ${updated[0].lead_id}::uuid, 'quotation',
             ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid,
             l.is_test_data
        from public.crm_leads l where l.id = ${updated[0].lead_id}::uuid
      on conflict (storage_path) do nothing
      returning id
    `) as Array<{ id: string }>;
  })) as Array<{ id: string }>;

  /* ⚠️ An empty array here means the document row already existed for this path,
     which is fine — the quotation was still updated. Only a missing quotation is
     a refusal, and that returned early above. */
  return Array.isArray(rows) ? { ok: true } : { ok: false, error: NOT_YOURS };
}
