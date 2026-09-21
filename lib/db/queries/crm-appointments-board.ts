import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE APPOINTMENTS PAGE — one query, everything the screen shows
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-21, with the design: cards for Today / Upcoming / Awaiting
 * confirmation / Completed this week, a table, a details panel (date, location,
 * consultant, reminder, related items, notes), and the last recorded outcome.
 *
 * ⚠️ ONE QUERY, FILTERED ON THE CLIENT (Rule Zero, law 3). Every card, filter,
 * saved view and the calendar are subsets of these rows; none of them asks the
 * server again. Only a write (book, reschedule, cancel, record, a note) does.
 *
 * ⚠️ WINDOWED (law 5): 180 days back, everything ahead, at most 500 rows — and
 * the screen says so.
 *
 * ⚠️ MY DIARY. `owner_id = app.current_user_id()` on top of RLS: a manager who
 * can read the department still sees their own appointments here.
 *
 * ⚠️ NO BACKTICKS IN THE SQL COMMENTS — this is one template literal.
 * ========================================================================= */

export const BOARD_BACK_DAYS = 180;
export const BOARD_LIMIT = 500;

export interface BoardAppointment {
  readonly id: string;
  /** APPT-<refNo> (238). */
  readonly refNo: number;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly leadPhone: string | null;
  readonly leadStage: string;
  readonly leadNextAction: string | null;
  readonly leadNextActionAt: string | null;
  readonly projectName: string | null;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly location: string | null;
  readonly notes: string | null;
  readonly outcome: string | null;
  readonly outcomeAt: string | null;
  readonly clientInterested: boolean | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly propertyId: string | null;
  /** The plot the client knows it by — "A-101". */
  readonly propertyCode: string | null;
  readonly propertyLabel: string | null;
  /** The lead's live quotation, if any — "QT-1042". */
  readonly quotationId: string | null;
  readonly quotationNumber: string | null;
  /** The booking's confirmation went out (220/222) — so "Confirmed" is the client's answer to wait for. */
  readonly confirmationSent: boolean;
  /** The reminder before it: planned (Scheduled), done (Sent), failed, cancelled — or null for none. */
  readonly reminderStatus: string | null;
  readonly reminderAt: string | null;
  /** The feedback message after it (237), when one was queued. */
  readonly feedbackStatus: string | null;
  readonly feedbackAt: string | null;
  /** This appointment replaced an earlier one (225). */
  readonly moved: boolean;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function crmAppointmentBoard(actorId: string): Promise<BoardAppointment[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.ref_no, a.lead_id, a.kind::text as kind, a.status::text as status,
           a.scheduled_at, a.duration_minutes, a.location, a.notes, a.outcome, a.outcome_at,
           a.client_interested, a.owner_id, a.property_id, a.replaces_id is not null as moved,
           l.full_name as lead_name, l.phone_e164 as lead_phone, l.stage::text as lead_stage,
           l.next_action as lead_next_action, l.next_action_at as lead_next_action_at,
           /* The definer, not a join to projects: a salesperson is a member of none. */
           app.crm_project_name(a.project_id) as project_name,
           (select u.full_name from public.users u where u.id = a.owner_id) as owner_name,
           coalesce(nullif(btrim(p.plot_number), ''), p.code) as property_code,
           nullif(concat_ws(' · ',
             nullif(concat_ws(' ',
               case when p.size_marla is not null
                    then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99')) || ' Marla' end,
               initcap(substring(p.kind from '[^ ]+$'))), ''),
             nullif(concat_ws(', ', p.plot_number,
               case when p.block is not null then 'Block ' || p.block end), '')), '') as property_label,
           q.id as quotation_id, q.number as quotation_number,
           exists (
             select 1 from public.crm_follow_ups f
              where f.purpose = 'appointment_reminder'
                and f.status = 'done'
                and f.title like 'Confirm the%'
                and (f.appointment_id = a.id
                     or (f.appointment_id is null and f.lead_id = a.lead_id
                         and f.created_at >= a.created_at - interval '1 minute'
                         and f.created_at <= a.scheduled_at))
           ) as confirmation_sent,
           r.status as reminder_status, r.due_at as reminder_at,
           fb.status as feedback_status, fb.due_at as feedback_at
      from public.crm_appointments a
      join public.crm_leads l on l.id = a.lead_id
      left join public.crm_properties p on p.id = a.property_id
      left join lateral (
        select q.id, q.number
          from public.crm_quotations q
         where q.lead_id = a.lead_id
           and q.status::text not in ('superseded', 'rejected', 'expired')
         order by q.created_at desc
         limit 1
      ) q on true
      left join lateral (
        select f.status::text as status, f.due_at
          from public.crm_follow_ups f
         where f.purpose = 'appointment_reminder'
           and f.title like 'Remind about%'
           and (f.appointment_id = a.id
                or (f.appointment_id is null and f.lead_id = a.lead_id
                    and f.created_at >= a.created_at - interval '1 minute'
                    and f.due_at <= a.scheduled_at))
         order by f.created_at desc
         limit 1
      ) r on true
      left join lateral (
        select f.status::text as status, f.due_at
          from public.crm_follow_ups f
         where f.appointment_id = a.id and f.purpose = 'meeting_feedback'
         order by f.created_at desc
         limit 1
      ) fb on true
     where a.owner_id = app.current_user_id()
       /* 225: a superseded row is history, not an appointment. */
       and a.status <> 'rescheduled'
       and a.scheduled_at >= (date_trunc('day', now() at time zone 'Asia/Karachi')
                              - make_interval(days => ${BOARD_BACK_DAYS})) at time zone 'Asia/Karachi'
     order by a.scheduled_at desc
     limit ${BOARD_LIMIT}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    refNo: Number(r.ref_no),
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    leadPhone: (r.lead_phone as string | null) ?? null,
    leadStage: String(r.lead_stage ?? 'new'),
    leadNextAction: (r.lead_next_action as string | null) ?? null,
    leadNextActionAt: iso(r.lead_next_action_at),
    projectName: (r.project_name as string | null) ?? null,
    kind: String(r.kind),
    status: String(r.status),
    scheduledAt: new Date(r.scheduled_at as string).toISOString(),
    durationMinutes: Number(r.duration_minutes ?? 60),
    location: (r.location as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
    outcomeAt: iso(r.outcome_at),
    clientInterested: (r.client_interested as boolean | null) ?? null,
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    propertyId: (r.property_id as string | null) ?? null,
    propertyCode: (r.property_code as string | null) ?? null,
    propertyLabel: (r.property_label as string | null) ?? null,
    quotationId: (r.quotation_id as string | null) ?? null,
    quotationNumber: (r.quotation_number as string | null) ?? null,
    confirmationSent: Boolean(r.confirmation_sent),
    reminderStatus: (r.reminder_status as string | null) ?? null,
    reminderAt: iso(r.reminder_at),
    feedbackStatus: (r.feedback_status as string | null) ?? null,
    feedbackAt: iso(r.feedback_at),
    moved: Boolean(r.moved),
  }));
}

/** The caller's own open leads — who a new appointment can be booked for. */
export interface BookableLead {
  readonly id: string;
  readonly name: string;
  readonly projectName: string | null;
  readonly phone: string | null;
  readonly stage: string;
}

export async function crmBookableLeads(actorId: string): Promise<BookableLead[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select l.id, coalesce(nullif(btrim(l.full_name), ''), 'Unnamed lead') as name,
           app.crm_project_name(l.project_id) as project_name,
           l.phone_e164 as phone, l.stage::text as stage
      from public.crm_leads l
     where l.owner_id = app.current_user_id()
       and l.stage not in ('won', 'lost')
       and l.archived_at is null
     order by lower(l.full_name) nulls last
     limit 1000
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    projectName: (r.project_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    stage: String(r.stage),
  }));
}

/** Save the appointment's notes. RLS (152) decides whether the caller may. */
export async function crmSetAppointmentNotes(actorId: string, appointmentId: string, notes: string | null): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_appointments
       set notes = ${notes}::text, updated_at = now()
     where id = ${appointmentId}::uuid
     returning id
  `);
  return (rows as unknown[]).length > 0;
}

/**
 * Mark an appointment confirmed — the client said yes, on a call or in the chat.
 *
 * ⚠️ AN ORDINARY UPDATE, SO RLS DECIDES (152). Nothing is sent: the client has
 * already answered, and telling them again would be noise. Only a live
 * appointment moves; a completed or cancelled one returns false.
 */
export async function crmConfirmAppointment(actorId: string, appointmentId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_appointments
       set status = 'confirmed'::public.crm_appointment_status, updated_at = now()
     where id = ${appointmentId}::uuid
       and status in ('scheduled', 'confirmed')
       and scheduled_at > now()
     returning id
  `);
  return (rows as unknown[]).length > 0;
}

/** Whether this caller may touch the appointment at all — RLS answers. */
export async function crmCanSeeAppointment(actorId: string, appointmentId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    select 1 as ok from public.crm_appointments where id = ${appointmentId}::uuid
  `);
  return (rows as unknown[]).length > 0;
}
