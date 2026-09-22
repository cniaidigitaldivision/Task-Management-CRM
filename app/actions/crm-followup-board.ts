'use server';

import { revalidatePath } from 'next/cache';

import { requireCrmAccess } from '@/lib/auth/current-user';
import { runDueFollowUps } from '@/lib/crm/followup-sender';
import {
  crmFollowUpConditions,
  crmMakeFollowUpDue,
  crmRescheduleFollowUp,
  crmSaveFollowUpConditions,
  crmSetFollowUpBody,
} from '@/lib/db/queries/crm-followup-board';
import {
  GAP_OPTIONS,
  ON_OPT_OUT_OPTIONS,
  ON_QUOTE_EXPIRED_OPTIONS,
  ON_REPLY_OPTIONS,
  type ConditionEdit,
  type FollowUpConditions,
} from '@/lib/domain/crm-followup-conditions';

/* ============================================================================
 * THE FOLLOW-UPS PAGE'S OWN WRITES
 * ----------------------------------------------------------------------------
 * Everything else the page does — complete, cancel, pause, stop a sequence,
 * plan a new one — already has an action and is reused rather than rebuilt.
 * ========================================================================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4000;

function settle(leadId: string) {
  revalidatePath('/follow-ups');
  revalidatePath('/todos');
  if (UUID.test(leadId)) revalidatePath(`/leads/${leadId}`);
}

export async function saveFollowUpBodyAction(
  id: string,
  leadId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That follow-up could not be found.' };
  const text = body.trim();
  if (!text) return { ok: false, error: 'A follow-up cannot send an empty message.' };
  if (text.length > MAX_BODY) return { ok: false, error: `Keep it under ${MAX_BODY} characters.` };

  const { user } = await requireCrmAccess();
  const ok = await crmSetFollowUpBody(user.id, id, text);
  if (!ok) return { ok: false, error: 'That could not be saved — it may already have been sent.' };
  settle(leadId);
  return { ok: true };
}

export async function rescheduleFollowUpAction(
  id: string,
  leadId: string,
  at: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That follow-up could not be found.' };
  const when = Date.parse(at);
  if (Number.isNaN(when)) return { ok: false, error: 'Choose a date and time.' };

  const ok = await crmRescheduleFollowUp(user.id, id, new Date(when).toISOString());
  if (!ok) return { ok: false, error: 'That could not be moved — it may already have been sent.' };
  settle(leadId);
  return { ok: true };
}

/**
 * Send this one now.
 *
 * ⚠️ IT GOES THROUGH THE SENDER, NOT ROUND IT. The step is made due and
 * `runDueFollowUps` takes it under exactly the rules every other step obeys:
 * inside the 24-hour window it is free text, outside it the approved template,
 * and a template with a blank it cannot fill is refused with the reason. A
 * second sending path here would be a second set of rules to keep in step.
 */
export async function sendFollowUpNowAction(
  id: string,
  leadId: string,
): Promise<{ ok: boolean; sent?: boolean; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That follow-up could not be found.' };

  const ok = await crmMakeFollowUpDue(user.id, id);
  if (!ok) {
    return {
      ok: false,
      error: 'This one cannot be sent from here — it is a reminder for you, or it has already gone.',
    };
  }

  let sent = false;
  let why: string | undefined;
  try {
    const reports = await runDueFollowUps(10);
    const mine = reports.find((r) => r.followUpId === id);
    sent = mine?.outcome === 'sent';
    if (mine && mine.outcome === 'failed') why = mine.detail;
  } catch {
    /* The row stays due; the scheduler will take it on its next run. */
  }

  settle(leadId);
  return sent ? { ok: true, sent: true } : { ok: true, sent: false, error: why };
}

/* ============================================================================
 * 247 · THE CONDITIONS DIALOG
 * ----------------------------------------------------------------------------
 * ⚠️ READ AND WRITE GO THROUGH THE SAME DEFINER THE SENDER USES, so what the
 * dialog shows is what the gate will decide. Nothing here evaluates a rule.
 * ========================================================================= */

export async function followUpConditionsAction(
  id: string,
): Promise<{ ok: boolean; conditions?: FollowUpConditions; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That follow-up could not be found.' };
  const conditions = await crmFollowUpConditions(user.id, id);
  if (!conditions) return { ok: false, error: 'That follow-up could not be found.' };
  return { ok: true, conditions };
}

/** ⚠️ EVERY FIELD IS CHECKED AGAINST ITS OWN OPTION LIST. A select is a hint
    to a person and no kind of guarantee about what arrives here. */
export async function saveFollowUpConditionsAction(
  id: string,
  leadId: string,
  edit: ConditionEdit,
): Promise<{ ok: boolean; conditions?: FollowUpConditions; error?: string }> {
  const { user } = await requireCrmAccess();
  if (!UUID.test(id)) return { ok: false, error: 'That follow-up could not be found.' };

  const tri = (v: unknown) => (v === true || v === false ? v : null);
  const oneOf = <T extends string>(v: unknown, options: ReadonlyArray<{ value: T }>, fallback: T): T =>
    options.some((o) => o.value === v) ? (v as T) : fallback;

  const attempts = Number(edit?.maxAttempts);
  const gap = Number(edit?.retryGapMinutes);
  const clean: ConditionEdit = {
    noReply: tri(edit?.noReply),
    quoteValid: tri(edit?.quoteValid),
    notBooked: tri(edit?.notBooked),
    onReply: oneOf(edit?.onReply, ON_REPLY_OPTIONS, 'hold'),
    onOptOut: oneOf(edit?.onOptOut, ON_OPT_OUT_OPTIONS, 'stop_sales'),
    onQuoteExpired: oneOf(edit?.onQuoteExpired, ON_QUOTE_EXPIRED_OPTIONS, 'hold'),
    maxAttempts: Number.isFinite(attempts) ? Math.max(1, Math.min(8, Math.round(attempts))) : 8,
    retryGapMinutes: GAP_OPTIONS.some((o) => o.value === gap) ? gap : 10,
  };

  const ok = await crmSaveFollowUpConditions(user.id, id, clean);
  if (!ok) {
    return { ok: false, error: 'Those conditions could not be saved — this follow-up may already have been sent.' };
  }
  settle(leadId);
  /* Hand back the resolved set, so the dialog shows what the database now says
     rather than what the screen hoped it would say. */
  const conditions = await crmFollowUpConditions(user.id, id);
  return { ok: true, ...(conditions ? { conditions } : {}) };
}
