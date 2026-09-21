'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { runDueFollowUps } from '@/lib/crm/followup-sender';
import { withAppRole } from '@/lib/db/client';
import {
  crmBookableLeads,
  crmCanSeeAppointment,
  crmConfirmAppointment,
  crmSetAppointmentNotes,
  type BookableLead,
} from '@/lib/db/queries/crm-appointments-board';

/* ============================================================================
 * THE APPOINTMENTS PAGE'S OWN WRITES AND READS
 * ----------------------------------------------------------------------------
 * Booking, rescheduling, cancelling and recording reuse the actions every other
 * screen uses (crm-leads.ts). Only two things are new here: who a new
 * appointment can be booked for, and the appointment's notes.
 * ========================================================================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's own open leads, for "Schedule appointment". Read when the dialog opens. */
export async function bookableLeadsAction(): Promise<BookableLead[]> {
  const { user } = await requireCrmAccess();
  return crmBookableLeads(user.id);
}

export async function saveAppointmentNotesAction(
  appointmentId: string,
  leadId: string,
  notes: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(appointmentId)) return { ok: false, error: 'That appointment could not be found.' };
  const text = notes.trim();
  if (text.length > 2000) return { ok: false, error: 'Keep notes under 2,000 characters.' };
  const ok = await crmSetAppointmentNotes(user.id, appointmentId, text || null);
  if (!ok) return { ok: false, error: 'That appointment could not be updated. It may not be yours.' };
  revalidatePath('/appointments');
  if (UUID.test(leadId)) revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/* ── 243 · Confirming, the two ways a salesperson actually does it ─────────
 * Owner, 2026-09-21: *"There's no button available on the appointment page
 * where he can confirm that appointment … or just the button where, with chat,
 * he can confirm that."*
 * ========================================================================= */

/** The client told me — mark it confirmed. Nothing is sent. */
export async function confirmAppointmentAction(
  appointmentId: string,
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(appointmentId)) return { ok: false, error: 'That appointment could not be found.' };
  const done = await crmConfirmAppointment(user.id, appointmentId);
  if (!done) {
    return { ok: false, error: 'That could not be confirmed — it may be yours no longer, already recorded, or past.' };
  }
  revalidatePath('/appointments');
  if (UUID.test(leadId)) revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/**
 * Ask the client on WhatsApp — the booking's own confirmation, again.
 *
 * ⚠️ SENT WHILE THEY WATCH. The row is queued due now and the sender is run at
 * once, so the salesperson sees "Sent" rather than "in a minute or so".
 */
export async function askClientToConfirmAction(
  appointmentId: string,
  leadId: string,
): Promise<{ ok: boolean; sent?: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(appointmentId)) return { ok: false, error: 'That appointment could not be found.' };
  /* RLS first: the definer below cannot ask whether this diary is theirs. */
  if (!(await crmCanSeeAppointment(user.id, appointmentId))) {
    return { ok: false, error: 'That appointment could not be found. It may not be yours.' };
  }

  let followUpId: string | null = null;
  try {
    const rows = (await withAppRole((tx) => tx`
      select app.crm_appointment_ask_confirm(${appointmentId}::uuid) as id
    `)) as unknown as Array<{ id: string | null }>;
    followUpId = rows[0]?.id ?? null;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const why =
      code === 'CRC02' ? 'That appointment is already recorded or cancelled.'
        : code === 'CRC03' ? 'That time has already passed.'
          : code === 'CRC04' ? 'This client has no WhatsApp number, or has not agreed to messages.'
            : 'That message could not be queued.';
    return { ok: false, error: why };
  }
  if (!followUpId) return { ok: false, error: 'That message could not be queued.' };

  /* A send that fails is reported, never thrown away — the row stays. */
  let sent = false;
  try {
    const reports = await runDueFollowUps(5);
    sent = reports.some((r) => r.followUpId === followUpId && r.outcome === 'sent');
  } catch {
    sent = false;
  }

  revalidatePath('/appointments');
  if (UUID.test(leadId)) revalidatePath(`/leads/${leadId}`);
  return { ok: true, sent };
}
