import 'server-only';

import { withUser } from '../client';
import { notify } from './feed';

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
  readonly propertyTitle: string | null;
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
  /** "A-101 · Block A" — the unit, as the design names it. */
  readonly label: string;
  /** "5 Marla Plot" — what it is. */
  readonly title: string;
  readonly category: string | null;
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
  readonly propertyId: string | null;
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
  readonly quotationId: string | null;
  readonly propertyId: string | null;
  readonly propertyLabel: string | null;
  /**
   * Whether the catalogue is holding that plot — 'reserved' once this booking
   * exists (199).
   *
   * ⚠️ THE PLOT'S OWN WORD FOR IT, not something inferred from the booking. The
   * owner's rule is that a booking is payment sent AND the plot held; reading the
   * hold off the booking would make the screen agree with itself and with nothing
   * else.
   */
  readonly propertyStatus: string | null;
  /** What the unit costs — the quotation it was booked against. */
  readonly propertyTotal: number | null;
  readonly createdByName: string | null;
  /** The payment evidence for the booking amount (196). */
  readonly receiptPath: string | null;
  readonly receiptUploadedAt: string | null;
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
  readonly bookingId: string | null;
  readonly quotationId: string | null;
  readonly propertyLabel: string | null;
  /** When the salesperson sent it to the client (196). */
  readonly sentAt: string | null;
  /** The receipt the client sent back — evidence, never a payment. */
  readonly receiptPath: string | null;
  readonly receiptUploadedAt: string | null;
  readonly receiptByName: string | null;
}

export interface RelatedFile {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  /** Null when it belongs to the whole project rather than this lead. */
  readonly leadId: string | null;
  /** 231 · which product a shared document is about ('any' for all). */
  readonly product: string;
}

export interface RelatedItems {
  readonly quotations: readonly RelatedQuotation[];
  readonly properties: readonly RelatedProperty[];
  readonly appointments: readonly RelatedAppointment[];
  readonly bookings: readonly RelatedBooking[];
  readonly invoices: readonly RelatedInvoice[];
  readonly files: readonly RelatedFile[];
  /**
   * 231 · the project's own quotations for this lead's product — uploaded on
   * "What the agent knows" as kind Quotation. Owner, 2026-09-21: *"If I say that
   * I have uploaded CRM quotations, 3 quotations will be visible in the related
   * item quotation tab."* Shown in Quotations, never in Files.
   */
  readonly projectQuotations: readonly RelatedFile[];
  /** 231 · what this lead is interested in, when it is known. */
  readonly leadProduct: string | null;
  /**
   * The next planned appointment reminder, if anybody has set one.
   * ⚠️ READ FROM THE FOLLOW-UPS, never assumed — the design shows "WhatsApp
   * reminder · Scheduled", and saying so when none exists is a promise nobody keeps.
   */
  readonly visitReminderAt: string | null;
  /** What this person may do with money — Finance and admins only (194/195). */
  readonly canVerifyPayments: boolean;
}

const EMPTY: RelatedItems = {
  quotations: [], properties: [], appointments: [], bookings: [], invoices: [], files: [],
  projectQuotations: [], leadProduct: null,
  visitReminderAt: null,
  canVerifyPayments: false,
};

function fileRow(f: Record<string, unknown>): RelatedFile {
  return {
    id: String(f.id),
    title: String(f.title),
    kind: String(f.kind ?? 'other'),
    mime: String(f.mime ?? ''),
    sizeBytes: Number(f.sizeBytes ?? 0),
    createdAt: new Date(String(f.createdAt)).toISOString(),
    leadId: (f.leadId as string | null) ?? null,
    product: String(f.product ?? 'any'),
  };
}

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
          'propertyLabel', coalesce(pr.plot_number, pr.code) || coalesce(' · Block ' || pr.block, ''),
          'propertyTitle', concat_ws(' ', case when pr.size_marla is not null then trim(to_char(pr.size_marla, 'FM999990.##')) || ' Marla' end,
                             initcap(split_part(coalesce(pr.kind, ''), ' ', array_length(string_to_array(coalesce(pr.kind, ' '), ' '), 1)))),
          'preparedByName', (select o.full_name from app.crm_lead_owners() o where o.id = q.prepared_by_id),
          'terms', q.terms
        ) order by q.created_at desc)
          from public.crm_quotations q
          left join public.crm_properties pr on pr.id = q.property_id
         where q.lead_id = (select id from lead)), '[]'::json) as quotations,

      coalesce((
        select json_agg(json_build_object(
          'id', p.id,
          'label', coalesce(p.plot_number, p.code) || coalesce(' · Block ' || p.block, ''),
          'title', concat_ws(' ', case when p.size_marla is not null then trim(to_char(p.size_marla, 'FM999990.##')) || ' Marla' end,
                             initcap(split_part(coalesce(p.kind, 'unit'), ' ', array_length(string_to_array(coalesce(p.kind, 'unit'), ' '), 1)))),
          'category', p.category, 'block', p.block,
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
          'propertyId', a.property_id,
          'propertyLabel', coalesce(pr.plot_number, pr.code) || coalesce(' · Block ' || pr.block, '')
        ) order by a.scheduled_at desc)
          from public.crm_appointments a
          left join public.crm_properties pr on pr.id = a.property_id
         where a.lead_id = (select id from lead)
           /* ⚠️ A rescheduled ROW IS HISTORY, NOT A VISIT. One was only ever
              written by the old two-row reschedule (225 replaced it), and every
              one of them has a successor carrying the real time — so listing it
              counts a single site visit twice, which is exactly what the owner
              was looking at. The row is kept; it is just not a thing in the
              diary any more.
              (No backticks in here: this is inside a tagged template.) */
           and a.status <> 'rescheduled'), '[]'::json) as appointments,

      coalesce((
        select json_agg(json_build_object(
          'id', b.id, 'number', b.number, 'status', b.status, 'amount', b.amount,
          'verifiedAmount', b.verified_amount, 'requestedAt', b.requested_at,
          'verificationRequestedAt', b.verification_requested_at, 'verifiedAt', b.verified_at,
          'confirmedAt', b.confirmed_at, 'cancelReason', b.cancel_reason, 'notes', b.notes,
          'quotationNumber', q.number, 'quotationStatus', q.status, 'quotationId', q.id,
          'propertyId', b.property_id,
          'propertyLabel', coalesce(pr.plot_number, pr.code) || coalesce(' · Block ' || pr.block, ''),
          'propertyStatus', pr.status,
          'propertyTotal', q.net_amount,
          'receiptPath', b.receipt_path, 'receiptUploadedAt', b.receipt_uploaded_at,
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
          'bookingId', b.id, 'quotationId', q.id,
          'propertyLabel', coalesce(pr.plot_number, pr.code) || coalesce(' · Block ' || pr.block, ''),
          'sentAt', i.sent_at, 'receiptPath', i.receipt_path,
          'receiptUploadedAt', i.receipt_uploaded_at,
          'receiptByName', (select o.full_name from app.crm_lead_owners() o where o.id = i.receipt_uploaded_by_id)
        ) order by i.issued_at desc, i.created_at desc)
          from public.crm_invoices i
          left join public.crm_bookings b on b.id = i.booking_id
          left join public.crm_quotations q on q.id = i.quotation_id
          left join public.crm_properties pr on pr.id = i.property_id
         where i.lead_id = (select id from lead)), '[]'::json) as invoices,

      /* ⚠️ THIS LEAD'S FILES AND THE PROJECT'S SHARED ONES. A brochure belongs to
         the project and is as attachable as a signed quotation that belongs to
         one person.

         ⚠️ 231 · AND ONLY THE PROJECT'S DOCUMENTS FOR THIS LEAD'S PRODUCT. Owner,
         2026-09-21: *"If he is interested in a CRM then the system should be
         smart enough to show all the CRM-related things in the files."* A
         document filed under "all products" shows for everyone; a lead whose
         product is not known yet sees everything rather than nothing.

         ⚠️ QUOTATIONS ARE NOT FILES, and the letterhead is never sent. The owner:
         *"These things and quotations will appear in the Quotation tab only, not
         in Files."* (No backticks in here: this is inside a tagged template.) */
      coalesce((
        select json_agg(json_build_object(
          'id', d.id, 'title', d.title, 'kind', d.kind, 'mime', d.mime,
          'sizeBytes', d.size_bytes, 'createdAt', d.created_at, 'leadId', d.lead_id,
          'product', d.product)
          order by (d.lead_id is null), d.created_at desc)
          from public.crm_documents d
         where d.project_id = (select project_id from lead)
           and d.kind not in ('quotation', 'letterhead')
           and (d.lead_id = (select id from lead)
                or (d.lead_id is null
                    and (d.product = 'any'
                         or app.crm_lead_product((select id from lead)) is null
                         or d.product = app.crm_lead_product((select id from lead)))))), '[]'::json) as files,

      coalesce((
        select json_agg(json_build_object(
          'id', d.id, 'title', d.title, 'kind', d.kind, 'mime', d.mime,
          'sizeBytes', d.size_bytes, 'createdAt', d.created_at, 'leadId', d.lead_id,
          'product', d.product)
          order by d.created_at desc)
          from public.crm_documents d
         where d.project_id = (select project_id from lead)
           and d.lead_id is null
           and d.kind = 'quotation'
           and (d.product = 'any'
                or app.crm_lead_product((select id from lead)) is null
                or d.product = app.crm_lead_product((select id from lead)))), '[]'::json) as project_quotations,

      app.crm_lead_product((select id from lead))::text as lead_product,

      (select min(f.due_at) from public.crm_follow_ups f
        where f.lead_id = (select id from lead)
          and f.purpose = 'appointment_reminder'
          and f.status in ('planned', 'due')) as visit_reminder_at,

      (app.acting_at_least('admin'::public.user_role)
       or app.acting_department_key() = 'finance') as can_verify
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return EMPTY;

  const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    canVerifyPayments: row.can_verify === true,
    visitReminderAt: row.visit_reminder_at ? new Date(String(row.visit_reminder_at)).toISOString() : null,
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
      propertyTitle: (q.propertyTitle as string | null) || null,
      preparedByName: (q.preparedByName as string | null) ?? null,
      terms: (q.terms as string | null) ?? null,
    })),
    properties: list<Record<string, unknown>>(row.properties).map((p) => ({
      id: String(p.id),
      label: String(p.label ?? ''),
      title: String(p.title ?? ''),
      category: (p.category as string | null) ?? null,
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
      propertyId: (a.propertyId as string | null) ?? null,
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
      quotationId: (b.quotationId as string | null) ?? null,
      propertyId: (b.propertyId as string | null) ?? null,
      propertyLabel: (b.propertyLabel as string | null) ?? null,
      propertyStatus: (b.propertyStatus as string | null) ?? null,
      propertyTotal: b.propertyTotal === null || b.propertyTotal === undefined ? null : num(b.propertyTotal),
      createdByName: (b.createdByName as string | null) ?? null,
      receiptPath: (b.receiptPath as string | null) ?? null,
      receiptUploadedAt: b.receiptUploadedAt ? new Date(String(b.receiptUploadedAt)).toISOString() : null,
    })),
    files: list<Record<string, unknown>>(row.files).map(fileRow),
    projectQuotations: list<Record<string, unknown>>(row.project_quotations).map(fileRow),
    leadProduct: (row.lead_product as string | null) ?? null,
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
      bookingId: (i.bookingId as string | null) ?? null,
      quotationId: (i.quotationId as string | null) ?? null,
      propertyLabel: (i.propertyLabel as string | null) ?? null,
      sentAt: i.sentAt ? new Date(String(i.sentAt)).toISOString() : null,
      receiptPath: (i.receiptPath as string | null) ?? null,
      receiptUploadedAt: i.receiptUploadedAt ? new Date(String(i.receiptUploadedAt)).toISOString() : null,
      receiptByName: (i.receiptByName as string | null) ?? null,
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
 * The salesperson's half of an invoice: it went out, and this came back.
 *
 * ⚠️ NEITHER IS A PAYMENT. 195's trigger still owns `paid_amount`; this records
 * that the client was asked and what they sent as proof, which is precisely what
 * Finance then looks at. Owner, 2026-09-17: *"he will make sure that the invoice
 * is sent. Once approved they will approve and upload that invoice, or you can
 * say, payment receipt as proof."*
 */
export async function markInvoiceSent(actorId: string, invoiceId: string): Promise<RelatedWrite> {
  const rows = (await withUser(actorId, (tx) => tx`
    update public.crm_invoices
       set sent_at = coalesce(sent_at, now()), updated_at = now()
     where id = ${invoiceId}::uuid and status <> 'void'
    returning id
  `)) as Array<{ id: string }>;
  return rows[0] ? { ok: true } : { ok: false, error: 'That invoice could not be updated.' };
}

export async function attachInvoiceReceipt(
  actorId: string,
  input: { invoiceId: string; path: string; title: string; mime: string; sizeBytes: number },
): Promise<RelatedWrite> {
  return withUser(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_invoices
         set receipt_path = ${input.path}, updated_at = now()
       where id = ${input.invoiceId}::uuid and status <> 'void'
      returning lead_id, project_id, number
    `) as Array<{ lead_id: string; project_id: string; number: string }>;
    if (!rows[0]) return { ok: false as const, error: 'That invoice could not be updated.' };

    /* ⚠️ AND IT IS A DOCUMENT TOO, so Finance can open it from the shelf without
       going through this dialog. */
    await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      select ${rows[0].project_id}::uuid, ${rows[0].lead_id}::uuid, 'receipt',
             ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid, l.is_test_data
        from public.crm_leads l where l.id = ${rows[0].lead_id}::uuid
      on conflict (storage_path) do nothing
    `;
    return { ok: true as const };
  });
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

/* ── Requests to the manager — 197 ───────────────────────────────────────── */

/**
 * "Request updated quote" and "Request correction".
 *
 * ⚠️ READ THE LEAD UNDER RLS FIRST. The recipients function is a definer keyed on
 * a project; asking it only after this person has proven they can see the lead
 * is what stops it becoming a way to message managers about somebody else's.
 *
 * ⚠️ AND IT LEAVES A NOTE. A request that lived only in a notification would be
 * gone the day the manager cleared their bell; the lead's own notes keep it.
 */
export async function requestFromManager(
  actorId: string,
  input: { leadId: string; kind: 'quote' | 'invoice'; subject: string; note: string },
): Promise<RelatedWrite & { readonly recipients?: number; readonly queued?: number }> {
  return withUser(actorId, async (tx) => {
    const leads = (await tx`
      select l.id, l.project_id, l.full_name from public.crm_leads l where l.id = ${input.leadId}::uuid
    `) as Array<{ id: string; project_id: string; full_name: string | null }>;
    const lead = leads[0];
    if (!lead) return { ok: false as const, error: NOT_YOURS };

    const heading = input.kind === 'quote'
      ? `Requested an updated quotation — ${input.subject}`
      : `Requested an invoice correction — ${input.subject}`;
    await tx`
      insert into public.crm_lead_notes (lead_id, author_id, body)
      values (${lead.id}::uuid, ${actorId}::uuid, ${`${heading}\n\n${input.note}`})
    `;

    const [{ ids }] = (await tx`
      select app.crm_request_recipients(${lead.project_id}::uuid) as ids
    `) as Array<{ ids: string[] | null }>;
    const recipients = (ids ?? []).filter((id) => id !== actorId);

    /* ⚠️ NOBODY TO ASK IS A REFUSAL, NOT A SUCCESS. Owner, 2026-09-18: *"I
       receive a notification that the quotation is sent, while I see in the sales
       manager dashboard that no quotation is received."* Reporting "sent" to
       nobody is the half of that bug which would have been hardest to find later,
       because the screen agreed with itself. */
    if (recipients.length === 0) {
      return {
        ok: false as const,
        error: 'Nobody is set up to receive this. This project has no department manager and no active admin.',
        recipients: 0,
      };
    }

    const title = input.kind === 'quote'
      ? `Updated quotation requested — ${input.subject}`
      : `Invoice correction requested — ${input.subject}`;

    let queued = 0;
    for (const userId of recipients) {
      /* ── ⚠️ A REQUEST HAS TO BECOME WORK, NOT JUST A BELL ─────────────────
         This is the bug the owner found. A notification is a message: it is read
         once, cleared, and gone. The manager's own screen (`crmMyTodos`) is
         DERIVED FROM REAL STATE — a lead not yet contacted, an appointment with
         no outcome, a quotation awaiting approval — and a request created none of
         those, so their list stayed empty while the salesperson was told it had
         been sent.

         A follow-up assigned to them IS that state: it sits in their queue until
         somebody does something about it, and doing the work is what clears it.
         `crm_follow_ups` already carries an assignee, so this needs no new table
         and no new todo kind. */
      const already = (await tx`
        select 1 as one from public.crm_follow_ups
         where lead_id = ${lead.id}::uuid
           and assigned_to_id = ${userId}::uuid
           and status in ('planned', 'due')
           and title = ${title}
         limit 1
      `) as Array<{ one: number }>;

      /* ⚠️ ASKING TWICE MUST NOT QUEUE TWICE. The owner pressed this button two
         minutes apart while testing and the manager would have got the same job
         twice — a list with duplicates in it is a list people stop clearing. */
      if (already.length === 0) {
        await tx`
          insert into public.crm_follow_ups
            (lead_id, purpose, channel, mode, status, title, body, due_at,
             assigned_to_id, created_by_id)
          values (
            ${lead.id}::uuid,
            ${input.kind === 'quote' ? 'quotation' : 'custom'}::public.crm_followup_purpose,
            'task'::public.crm_followup_channel,
            /* ⚠️ remind_me, NEVER auto_send. A person decides what a new
               quotation says; nothing about this may be sent by machine. It is
               a task on the manager's list — a reminder, not a draft to review
               (234: nothing is stored for review any more).
               (No backticks in this comment: the file is a JS template literal
               and one would end the string — backticks-break-sql-literals.) */
            'remind_me',
            /* Due now: it is owed the moment it is asked for. The status 'due'
               is also what puts it on the manager's list; 'planned' would hide it
               until the clock caught up. */
            'due'::public.crm_followup_status,
            ${title},
            ${input.note},
            now(),
            ${userId}::uuid,
            ${actorId}::uuid
          )
        `;
        queued += 1;
      }

      /* And the bell as well, because a queue is not a prompt. */
      await notify(tx, actorId, {
        userId,
        kind: 'lead_request',
        title: input.kind === 'quote'
          ? `Updated quotation requested for ${lead.full_name ?? 'a lead'}`
          : `Invoice correction requested for ${lead.full_name ?? 'a lead'}`,
        body: `${input.subject}. ${input.note}`.slice(0, 280),
        linkTo: `/leads/${lead.id}`,
        entityId: lead.id,
      });
    }

    return { ok: true as const, recipients: recipients.length, queued };
  });
}

/* ── Rescheduling a visit ────────────────────────────────────────────────── */

/**
 * Move an appointment.
 *
 * ⚠️ THE SAME VISIT, AT A NEW TIME — NOT A SECOND VISIT. This wrote a new row
 * pointing back with `replaces_id` and left the old one as `rescheduled`, which
 * put two site visits on a screen that had one. Owner, 2026-09-19: *"These are
 * not two separate visits. It's one visit: first I schedule it, then the client
 * says that this time is not feasible, and then I change its time."*
 *
 * ⚠️ AND IT GOES THROUGH `app.crm_reschedule_appointment`, WHICH ALREADY DID
 * THIS CORRECTLY. Two implementations of one idea had drifted apart — 219's
 * moved the row, this one split it — and the button happened to call the wrong
 * one. 225 is now the only rescheduling there is: it records the time moved
 * from in the notes, refuses to move a visit that already happened, and returns
 * a confirmed visit to `scheduled` because the client never agreed to the new
 * time.
 */
export async function rescheduleAppointment(
  actorId: string,
  input: { appointmentId: string; scheduledAt: string },
): Promise<RelatedWrite> {
  return withUser(actorId, async (tx) => {
    const done = (await tx`
      select app.crm_reschedule_appointment(
        ${input.appointmentId}::uuid, ${input.scheduledAt}::timestamptz
      ) as ok
    `) as Array<{ ok: boolean }>;
    if (!done[0]?.ok) {
      return { ok: false as const, error: 'That appointment could not be moved — a visit that already happened is recorded, not moved.' };
    }
    return { ok: true as const };
  });
}

/* ── The booking's payment evidence — 196 ────────────────────────────────── */

export async function attachBookingReceipt(
  actorId: string,
  input: { bookingId: string; path: string; title: string; mime: string; sizeBytes: number },
): Promise<RelatedWrite> {
  return withUser(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_bookings
         set receipt_path = ${input.path}, updated_at = now()
       where id = ${input.bookingId}::uuid and status <> 'cancelled'
      returning lead_id, project_id
    `) as Array<{ lead_id: string; project_id: string }>;
    if (!rows[0]) return { ok: false as const, error: 'That booking could not be updated.' };
    await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      select ${rows[0].project_id}::uuid, ${rows[0].lead_id}::uuid, 'receipt',
             ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid, l.is_test_data
        from public.crm_leads l where l.id = ${rows[0].lead_id}::uuid
      on conflict (storage_path) do nothing
    `;
    return { ok: true as const };
  });
}

/** An invoice's own PDF, uploaded by whoever raised it. */
export async function attachInvoicePdf(
  actorId: string,
  input: { invoiceId: string; path: string; title: string; mime: string; sizeBytes: number },
): Promise<RelatedWrite> {
  return withUser(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_invoices
         set pdf_path = ${input.path}, updated_at = now()
       where id = ${input.invoiceId}::uuid and status <> 'void'
      returning lead_id, project_id
    `) as Array<{ lead_id: string; project_id: string }>;
    if (!rows[0]) return { ok: false as const, error: 'That invoice could not be updated.' };
    await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      select ${rows[0].project_id}::uuid, ${rows[0].lead_id}::uuid, 'invoice',
             ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid, l.is_test_data
        from public.crm_leads l where l.id = ${rows[0].lead_id}::uuid
      on conflict (storage_path) do nothing
    `;
    return { ok: true as const };
  });
}

/* ── A quotation that arrived as a PDF — 2026-09-17 ───────────────────────── */

export interface QuotationFromPdf {
  readonly leadId: string;
  readonly number: string;
  readonly amount: number;
  readonly validUntil: string | null;
  /** What the PDF called the unit: "5 Marla · Block A". Kept even when no plot matches. */
  readonly unitHint: string;
  /** For matching against the project's catalogue. */
  readonly plot: string | null;
  readonly block: string | null;
  readonly marla: number | null;
  readonly path: string;
  readonly title: string;
  readonly mime: string;
  readonly sizeBytes: number;
}

/**
 * Record a quotation somebody uploaded as a PDF.
 *
 * ⚠️ THE NUMBER COMES FROM THE DOCUMENT, so the CRM and the client's copy say the
 * same thing. If that number is already on this project, the row becomes the next
 * **version** of it rather than a second QT-1042 — `(lower(number), version)` is
 * unique in 151 and a clash there is exactly the case this handles.
 *
 * ⚠️ THE UNIT IS MATCHED, NEVER CREATED. A plot code in a PDF is a claim about the
 * catalogue; matching it links the quotation, failing to match leaves
 * `property_id` null and keeps what the PDF said in the terms. Inventing a plot
 * from a PDF would put a unit in the catalogue that the project never sold.
 *
 * ⚠️ AND IT IS A DRAFT. Uploading the file is not sending it. The salesperson
 * still attaches it to a message, and that is what stamps `sent_at`.
 */
export async function createQuotationFromPdf(
  actorId: string,
  input: QuotationFromPdf,
): Promise<RelatedWrite & { readonly id?: string; readonly number?: string; readonly matchedUnit?: string | null }> {
  return withUser(actorId, async (tx) => {
    const leads = (await tx`
      select id, project_id from public.crm_leads where id = ${input.leadId}::uuid
    `) as Array<{ id: string; project_id: string }>;
    const lead = leads[0];
    if (!lead) return { ok: false as const, error: NOT_YOURS };

    /* The plot, if this project has it. Code and plot number are both tried
       because a scheme writes "A-101" in either column, and the comparison
       ignores spaces and hyphens so "A 101" and "A-101" are the same plot. */
    /* ⚠️ NO BACKSLASH ESCAPES IN THE SQL PATTERN. A template literal eats them —
       `'[\s\-_/]'` reaches Postgres as `[s-_/]` and would strip every letter s
       out of a plot code. `[^A-Za-z0-9]` needs none and says the same thing. */
    const norm = input.plot ? input.plot.replace(/[^A-Za-z0-9]+/g, '').toUpperCase() : null;
    const units = (await tx`
      select id, coalesce(plot_number, code) as label, block, size_marla
        from public.crm_properties
       where project_id = ${lead.project_id}::uuid
         and (
           (${norm}::text is not null
            and upper(regexp_replace(coalesce(plot_number, code), '[^A-Za-z0-9]+', '', 'g')) = ${norm}::text)
           or (${norm}::text is null
               and ${input.block}::text is not null
               and upper(coalesce(block, '')) = upper(${input.block}::text)
               and (${input.marla}::numeric is null or size_marla = ${input.marla}::numeric))
         )
       order by case when ${norm}::text is not null then 0 else 1 end
       limit 1
    `) as Array<{ id: string; label: string | null; block: string | null; size_marla: string | null }>;
    const unit = units[0] ?? null;

    /* The next version of this number, if the number is already used here. */
    const [{ next_version: nextVersion }] = (await tx`
      select coalesce(max(version), 0) + 1 as next_version
        from public.crm_quotations
       where lower(btrim(number)) = lower(btrim(${input.number}))
    `) as Array<{ next_version: number }>;

    const terms = `Uploaded from ${input.title}.\nProperty as quoted: ${input.unitHint}.`;
    const rows = (await tx`
      insert into public.crm_quotations
        (lead_id, project_id, property_id, number, version,
         base_price, premium_charges, requested_discount, approved_discount, net_amount,
         valid_until, status, terms, pdf_path, prepared_by_id, is_test_data)
      select l.id, l.project_id, ${unit?.id ?? null}::uuid,
             ${input.number}, ${nextVersion}::int,
             ${input.amount}::bigint, 0, 0, 0, ${input.amount}::bigint,
             ${input.validUntil}::date, 'draft'::public.crm_quotation_status,
             ${terms}, ${input.path}, ${actorId}::uuid, l.is_test_data
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning id, number
    `) as Array<{ id: string; number: string }>;
    const row = rows[0];
    if (!row) return { ok: false as const, error: NOT_YOURS };

    /* ⚠️ AND IT IS A DOCUMENT TOO — the shelf, the email attachments and the
       follow-up steps all read `crm_documents`, never `pdf_path`. */
    await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      select ${lead.project_id}::uuid, l.id, 'quotation',
             ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid, l.is_test_data
        from public.crm_leads l where l.id = ${input.leadId}::uuid
      on conflict (storage_path) do nothing
    `;

    /* ⚠️ A NOTE, NOT AN ACTIVITY ROW. `crm_lead_activity_insert` (116) admits five
       kinds and 'note_added' is not one of them — deliberately: that kind comes
       from `app.crm_note_record_activity`, a definer trigger on the note itself,
       so an activity row saying "note added" always has a note behind it.
       Inserting one directly is refused with 42501, which rolls the whole upload
       back. Proved live before this shipped. */
    await tx`
      insert into public.crm_lead_notes (lead_id, author_id, body)
      values (${input.leadId}::uuid, ${actorId}::uuid,
              ${`Quotation ${row.number} added from ${input.title} — ${input.unitHint}, PKR ${input.amount.toLocaleString('en-PK')}.`})
    `;

    return {
      ok: true as const,
      id: row.id,
      number: row.number,
      matchedUnit: unit
        ? [unit.label, unit.block ? `Block ${unit.block}` : null].filter(Boolean).join(' · ')
        : null,
    };
  });
}

/* -- The plots on an uploaded property sheet - 2026-09-18 ------------------ */

export interface PlotContext {
  readonly ok: boolean;
  /** Whether this person may extend the project's catalogue at all. */
  readonly canAdd: boolean;
  /** Codes the project already has, lower-cased, so the picker can say which are new. */
  readonly existing: readonly string[];
}

/**
 * What the sheet picker needs before it offers to add anything.
 *
 * ⚠️ A SALESPERSON MAY NOT EDIT THE CATALOGUE, and 150 says so in a policy: only
 * a project's manager writes `crm_properties`, because a price is the company's
 * and not the seller's. So the picker asks first and offers the manager route
 * instead — a button that fails on submit teaches people the feature is broken.
 */
export async function readPlotContext(actorId: string, leadId: string): Promise<PlotContext> {
  const rows = (await withUser(actorId, async (tx) => {
    /* ⚠️ NO JOIN ON `projects`. A salesperson can see the lead and NOT the project
       row (`projects` has its own policy), so an inner join returned nothing and
       the picker refused every sheet with "that lead could not be found". The
       project's name is on screen already — it does not need fetching. */
    const leads = (await tx`
      select l.project_id,
             app.crm_manages_project(l.project_id) as can_add
        from public.crm_leads l
       where l.id = ${leadId}::uuid
    `) as Array<{ project_id: string; can_add: boolean }>;
    const lead = leads[0];
    if (!lead) return [] as Array<Record<string, unknown>>;

    const codes = (await tx`
      select lower(btrim(code)) as code from public.crm_properties
       where project_id = ${lead.project_id}::uuid
    `) as Array<{ code: string }>;
    return [{ can_add: lead.can_add, codes: codes.map((c) => c.code) }];
  })) as Array<{ can_add: boolean; codes: string[] }>;

  const row = rows[0];
  if (!row) return { ok: false, canAdd: false, existing: [] };
  return { ok: true, canAdd: row.can_add === true, existing: row.codes };
}

export interface PlotToAdd {
  readonly code: string;
  readonly block: string | null;
  readonly sizeMarla: number | null;
  readonly basePrice: number | null;
  readonly category: string | null;
}

/**
 * Add the plots a sheet named to the project's catalogue.
 *
 * ⚠️ ONE STATEMENT FOR ALL OF THEM. A sheet has a hundred rows and a transaction
 * runs its queries in series — a loop of inserts from Karachi is a hundred round
 * trips for one upload (`transactions-run-queries-in-series` in the notes).
 *
 * ⚠️ `on conflict do nothing`, AND THAT IS NOT A FAILURE. A sheet re-uploaded
 * after two plots sold must add the rest and leave the ones already there alone;
 * the count returned says how many were actually new.
 *
 * ⚠️ THE CODE CARRIES ITS BLOCK WHEN THE SHEET NUMBERS PER BLOCK. `code` is
 * unique per project (150), so a bare "42" in Block D is stored as "D-42" with
 * "42" kept as the plot number — otherwise Block D's 42 and Block E's 42 are one
 * plot and the second is silently dropped.
 */
export async function addPlotsFromSheet(
  actorId: string,
  input: {
    leadId: string;
    path: string;
    title: string;
    mime: string;
    sizeBytes: number;
    plots: readonly PlotToAdd[];
  },
): Promise<RelatedWrite & { readonly added?: number; readonly skipped?: number }> {
  if (input.plots.length === 0) return { ok: false, error: 'No plots were selected.' };

  return withUser(actorId, async (tx) => {
    const leads = (await tx`
      select l.id, l.project_id, l.is_test_data,
             app.crm_manages_project(l.project_id) as can_add
        from public.crm_leads l where l.id = ${input.leadId}::uuid
    `) as Array<{ id: string; project_id: string; is_test_data: boolean; can_add: boolean }>;
    const lead = leads[0];
    if (!lead) return { ok: false as const, error: NOT_YOURS };
    if (lead.can_add !== true) {
      return {
        ok: false as const,
        error: 'Only the project manager can add plots to the catalogue. The sheet has been kept on this lead — ask your manager to add them.',
      };
    }

    const codes = input.plots.map((pl) => (pl.block && /^\d+$/.test(pl.code) ? `${pl.block}-${pl.code}` : pl.code));
    const numbers = input.plots.map((pl) => pl.code);
    const blocks = input.plots.map((pl) => pl.block);
    /* ⚠️ NUMERIC ARRAYS AS TEXT, then cast in SQL. postgres.js cannot infer the
       element type of a JS array of nulls-and-numbers, which is the same trap
       that made a boolean[] parameter fail in 187. */
    const sizes = input.plots.map((pl) => (pl.sizeMarla === null ? null : String(pl.sizeMarla)));
    const prices = input.plots.map((pl) => (pl.basePrice === null ? null : String(Math.round(pl.basePrice))));
    const categories = input.plots.map((pl) => pl.category);

    const inserted = (await tx`
      insert into public.crm_properties
        (project_id, code, plot_number, block, kind, size_marla, base_price, category, status, is_test_data)
      select ${lead.project_id}::uuid, t.code, t.plot_number, t.block, 'Residential plot',
             t.size_marla::numeric(8,2), t.base_price::bigint, t.category, 'available', ${lead.is_test_data}
        from unnest(
               ${codes}::text[], ${numbers}::text[], ${blocks}::text[],
               ${sizes}::text[], ${prices}::text[], ${categories}::text[]
             ) as t(code, plot_number, block, size_marla, base_price, category)
      on conflict (project_id, lower(btrim(code))) do nothing
      returning id
    `) as Array<{ id: string }>;

    /* The sheet itself stays on the lead — it is the evidence for these prices. */
    await tx`
      insert into public.crm_documents
        (project_id, lead_id, kind, title, storage_path, mime, size_bytes, uploaded_by_id, is_test_data)
      values (${lead.project_id}::uuid, ${lead.id}::uuid, 'price_list',
              ${input.title}, ${input.path}, ${input.mime}, ${input.sizeBytes}, ${actorId}::uuid, ${lead.is_test_data})
      on conflict (storage_path) do nothing
    `;

    return {
      ok: true as const,
      added: inserted.length,
      skipped: input.plots.length - inserted.length,
    };
  });
}
