'use server';

/* ============================================================================
 * THE DRAWER'S FOLLOW-UPS TAB — what its buttons do
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, on the reference: Review reply · Reschedule · Stop on the
 * running sequence; Add reminder and New follow-up at the foot.
 *
 * Input is checked here; ownership is checked by RLS in the queries; what a
 * sequence may do next is checked by the engine's own stop-conditions. Every
 * write revalidates the desk, so the row's Next action and sequence label move
 * with it — and the drawer re-reads its own copy on the render that follows.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  closeFollowUp,
  createFollowUp,
  pauseSequence,
  rescheduleSequence,
  startSequence,
  stopSequence,
  type FollowUpWrite,
} from '@/lib/db/queries/crm-followups';

export type FollowUpResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ['whatsapp', 'email', 'call', 'task'] as const;

function settle(result: FollowUpWrite): FollowUpResult {
  if (!result.ok) return result;
  revalidatePath('/my-leads');
  revalidatePath('/todos');
  revalidatePath(`/leads/${result.leadId}`);
  return { ok: true };
}

/** A moment somebody chose: readable, not in the past, not absurdly far off. */
function when(iso: string, { allowPast = false } = {}): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  if (!allowPast && ms < Date.now() - 5 * 60_000) return null;
  if (ms > Date.now() + 366 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

export async function createFollowUpAction(input: {
  leadId: string;
  channel: string;
  title: string;
  note: string;
  dueAt: string;
}): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId)) return { ok: false, error: 'That lead could not be found.' };
  if (!CHANNELS.includes(input.channel as never)) return { ok: false, error: 'Choose how you will follow up.' };

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Say what the follow-up is.' };
  if (title.length > 140) return { ok: false, error: 'Keep the title under 140 characters — it has to fit on a row.' };
  const note = input.note.trim();
  if (note.length > 2000) return { ok: false, error: 'That note is longer than 2,000 characters.' };

  const dueAt = when(input.dueAt);
  if (!dueAt) return { ok: false, error: 'Choose a time from now onwards.' };

  return settle(
    await createFollowUp(user.id, {
      leadId: input.leadId,
      channel: input.channel as (typeof CHANNELS)[number],
      title,
      body: note || null,
      dueAt,
    }),
  );
}

export async function completeFollowUpAction(followUpId: string, note: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(followUpId)) return { ok: false, error: 'That follow-up could not be found.' };
  const text = note.trim();
  if (text.length > 2000) return { ok: false, error: 'That note is longer than 2,000 characters.' };
  return settle(await closeFollowUp(user.id, followUpId, { done: true, note: text || null }));
}

export async function cancelFollowUpAction(followUpId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(followUpId)) return { ok: false, error: 'That follow-up could not be found.' };
  return settle(await closeFollowUp(user.id, followUpId, { done: false }));
}

export async function pauseSequenceAction(leadSequenceId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  return settle(await pauseSequence(user.id, leadSequenceId, user.fullName));
}

export async function rescheduleSequenceAction(leadSequenceId: string, at: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  const next = when(at);
  if (!next) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(await rescheduleSequence(user.id, leadSequenceId, next));
}

export async function stopSequenceAction(leadSequenceId: string): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(leadSequenceId)) return { ok: false, error: 'That sequence could not be found.' };
  return settle(await stopSequence(user.id, leadSequenceId, user.fullName));
}

export async function startSequenceAction(input: {
  leadId: string;
  sequenceId: string;
  firstAt: string | null;
}): Promise<FollowUpResult> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(input.leadId) || !UUID.test(input.sequenceId)) {
    return { ok: false, error: 'That sequence could not be found.' };
  }
  const firstAt = input.firstAt ? when(input.firstAt) : null;
  if (input.firstAt && !firstAt) return { ok: false, error: 'Choose a time from now onwards.' };
  return settle(await startSequence(user.id, { leadId: input.leadId, sequenceId: input.sequenceId, firstAt }));
}
