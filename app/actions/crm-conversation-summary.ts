'use server';

/* ============================================================================
 * SUMMARISE A LEAD'S CONVERSATION — migration 180
 * ----------------------------------------------------------------------------
 * ⚠️ CALLED BY THE SUMMARY VIEW WHEN THE THREAD HAS MOVED, NEVER ON PAGE LOAD.
 * The owner asked for it to be automatic, and it is — nobody presses a button —
 * but "automatic" means "when somebody looks and it is out of date", not "every
 * time a drawer opens". 137's cost rule stands: a model call per page view is the
 * difference between a few dollars a month and a few hundred.
 *
 * ⚠️ AND THE SECOND READER PAYS NOTHING. The fingerprint is checked again here,
 * against the database, before any call is made — so two people opening the same
 * lead, or one person's view re-mounting, cost one summary, not two.
 * ========================================================================= */

import { requireUser } from '@/lib/auth/current-user';
import {
  buildConversationBrief,
  summariseConversation,
  summaryFingerprint,
} from '@/lib/ai/conversation-summary';
import { withUser } from '@/lib/db/client';
import {
  crmLeadThread,
  getCrmLead,
  readSummaryRow,
  saveConversationSummary,
  type CrmConversationSummary,
} from '@/lib/db/queries/crm-leads';

export interface ConversationSummaryResult {
  readonly ok: boolean;
  readonly summary?: CrmConversationSummary;
  readonly error?: string;
}

export async function summariseConversationAction(
  leadId: string,
): Promise<ConversationSummaryResult> {
  const user = await requireUser();

  /* ⚠️ EVERY READ IS RLS-SCOPED, AND THEY LEAVE TOGETHER (law 4). Somebody who
     cannot see the lead gets null here and is refused — this action must never
     be a way to have a model describe a colleague's conversation to you. */
  const [found, thread, stored] = await Promise.all([
    getCrmLead(user.id, leadId),
    crmLeadThread(user.id, leadId),
    withUser(user.id, (tx) => tx`
      select overview, points, message_count, last_message_id, note_count,
             generated_at, model, source_fingerprint
        from public.crm_lead_conversation_summaries
       where lead_id = ${leadId}::uuid
    `),
  ]);
  if (!found) return { ok: false, error: 'That lead is not available to you.' };
  if (thread.length === 0) return { ok: false, error: 'Nothing has been said yet.' };

  const newest = thread[thread.length - 1];
  const fp = summaryFingerprint({
    messageCount: thread.length,
    lastMessageId: newest.id,
    noteCount: found.notes.length,
  });

  const existing = (stored as Array<Record<string, unknown>>)[0];
  if (existing && existing.source_fingerprint === fp) {
    return { ok: true, summary: readSummaryRow(existing) };
  }

  const brief = buildConversationBrief({
    leadName: found.lead.fullName,
    projectName: found.lead.projectName,
    stage: found.lead.stage,
    messages: thread,
    notes: found.notes.map((n) => n.body),
  });

  let written;
  try {
    written = await summariseConversation(brief);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The summary could not be written.',
    };
  }

  const saved = await saveConversationSummary(user.id, leadId, {
    overview: written.overview,
    points: written.points,
    messageCount: thread.length,
    lastMessageId: newest.id,
    noteCount: found.notes.length,
    fingerprint: fp,
    model: written.model,
  });
  if (!saved) return { ok: false, error: 'The summary was written but could not be saved.' };

  /* ⚠️ NO revalidatePath. The view that asked renders what comes back, in the
     frame it arrives — re-running the whole /my-leads render to deliver one
     paragraph it already holds would be Rule Zero's first mistake again. */
  return { ok: true, summary: saved };
}
