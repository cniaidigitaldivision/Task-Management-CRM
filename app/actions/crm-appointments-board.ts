'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmBookableLeads,
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
