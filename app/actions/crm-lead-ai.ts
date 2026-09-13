'use server';

/* ============================================================================
 * READ A LEAD WITH THE MODEL — Step 11
 * ----------------------------------------------------------------------------
 * ⚠️ ON A BUTTON, NEVER ON PAGE LOAD. `07-AI-PLAN.md` is explicit about the
 * cost: *"Generating on every page load is the difference between a few dollars
 * a month and a few hundred."* With 647 leads — 627 of which nobody has ever
 * rung and which are therefore the most likely to be scrolled past — an
 * automatic call would spend the most money on exactly the leads nobody is
 * working.
 *
 * ⚠️ AND THE SECOND READER PAYS NOTHING. The reading is cached against a
 * fingerprint of the lead's material facts; a colleague opening the same lead
 * an hour later gets it free, and it is only offered again once the lead has
 * genuinely moved.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { buildLeadBrief, fingerprint, readLead } from '@/lib/ai/lead-insight';
import { withUser } from '@/lib/db/client';
import { getCrmLead } from '@/lib/db/queries/crm-leads';

export interface LeadAiResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function readLeadWithAiAction(leadId: string): Promise<LeadAiResult> {
  const user = await requireUser();

  /* ⚠️ READ THROUGH `getCrmLead`, WHICH IS RLS-SCOPED. Somebody who cannot see
     the lead must not be able to have the model describe it to them — that
     would make this action a way around the policy protecting the lead. */
  const found = await getCrmLead(user.id, leadId);
  if (!found) return { ok: false, error: 'That lead is not available to you.' };

  /* ⚠️ `getCrmLead` returns the whole record — the lead, its notes, its
     timeline and any sibling enquiries on the same number. Only the first two
     are shown to the model: the timeline is a list of state changes the model
     cannot say anything useful about, and a sibling lead belongs to somebody
     else's conversation. */
  const record = found.lead;
  const notes = found.notes.map((n) => n.body);
  const fp = fingerprint({
    answers: record.answers,
    stage: record.stage,
    noteCount: notes.length,
    city: record.city,
  });

  /* Already read, and nothing material has changed since. Costs nothing. */
  const existing = await withUser(user.id, (tx) => tx`
    select source_fingerprint from public.crm_lead_insights where lead_id = ${leadId}::uuid
  `);
  if ((existing as Array<Record<string, unknown>>)[0]?.source_fingerprint === fp) {
    return { ok: true };
  }

  const brief = buildLeadBrief({
    fullName: record.fullName,
    city: record.city,
    projectName: record.projectName,
    formName: record.formName,
    stage: record.stage,
    submittedAt: record.submittedAt,
    answers: record.answers,
    notes,
  });

  let insight;
  try {
    insight = await readLead(brief);
  } catch (error) {
    /* ⚠️ REPORTED, NOT SWALLOWED. A panel that silently stays empty after
       somebody presses a button reads as a broken page; the message says which
       of the three things went wrong — no key, a refusal, or a timeout. */
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The model could not be reached.',
    };
  }

  try {
    await withUser(user.id, (tx) => tx`
      insert into public.crm_lead_insights
        (lead_id, summary, talking_points, draft_message, source_fingerprint, model, generated_by_id)
      values (
        ${leadId}::uuid,
        ${insight.summary},
        ${JSON.stringify(insight.talkingPoints)}::jsonb,
        ${insight.draftMessage},
        ${fp},
        ${insight.model},
        ${user.id}::uuid
      )
      /* ⚠️ UPSERT, because this is a cache and regenerating must replace. The
         activity log and the stored reports are append-only for the opposite
         reason: they are evidence. */
      on conflict (lead_id) do update set
        summary            = excluded.summary,
        talking_points     = excluded.talking_points,
        draft_message      = excluded.draft_message,
        source_fingerprint = excluded.source_fingerprint,
        model              = excluded.model,
        generated_at       = now(),
        generated_by_id    = excluded.generated_by_id
    `);
  } catch {
    return { ok: false, error: 'The reading could not be saved.' };
  }

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}
