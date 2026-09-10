'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import {
  addLeadNote,
  deleteLeadNote,
  isContactKind,
  logLeadContact,
  setLeadNextAction,
  setLeadStage,
  setLeadTemperature,
} from '@/lib/db/queries/crm-leads';
import { isLostReason, isStage, TEMPERATURES } from '@/lib/domain/crm-stages';

/* ============================================================================
 * WORKING A LEAD — Step 6 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO ROLE CHECK, AND IT IS NOT AN OVERSIGHT ────────────────────────────
 * Three things already decide this, and every one of them is closer to the data
 * than this file is:
 *
 *   111's policies   which leads you may touch at all
 *   116's grant      which five columns a session may change
 *   116's policy     which kinds a person may claim happened
 *
 * A `can(...)` here would be a fourth rule to keep in step with three that
 * cannot be forgotten. What IS here is validation of the VOCABULARY — a stage
 * that is not a stage reaches Postgres as an enum cast and comes back a 500,
 * and these values arrive from a form.
 *
 * ── ⚠️ THE FAILURE MESSAGES WERE READ OFF THE DATABASE, NOT GUESSED ────────
 * Reproduced against the live schema on 2026-09-10, as `cni_app` under a real
 * session, because the displayed refusal is usually not the real error:
 *
 *   update a lead you cannot see  → 0 ROWS, NO EXCEPTION   (so: `ok: false`)
 *   note on a lead you cannot see → 42501 RLS violation     (so: a throw)
 *   contact on one                → 42501 RLS violation     (so: a throw)
 *   lost with no reason           → 23514 check_violation
 *   an unknown stage              → 22P02 invalid enum input
 *
 * The two shapes are why an update returns a boolean and an insert is wrapped:
 * one of them cannot throw and the other cannot return false. Guessing that
 * both behaved the same would have produced a screen that said "saved" when
 * nothing was.
 * ========================================================================= */

export interface LeadWriteResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** The longest a note may be. Mirrors the CHECK constraint in 111. */
const MAX_NOTE = 4000;

/** The longest thing anybody should type into a one-line field. */
const MAX_LINE = 200;

/**
 * ⚠️ BOTH PATHS, ALWAYS. The desk counts stages and sorts on `next_action_at`,
 * so a change made here that only refreshed the record would leave somebody
 * pressing Back to a list that still says what it said five minutes ago — and
 * disbelieving the screen they just used.
 */
function refresh(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
}

/** The same sentence for "gone" and "not yours" — see the route's own note. */
const NOT_YOURS = 'That lead could not be updated. It may not be yours to work.';

export async function setStageAction(
  leadId: string,
  stage: string,
  lostReason: string | null,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  if (!isStage(stage)) return { ok: false, error: 'That is not a stage.' };

  /* ⚠️ CHECKED HERE AS WELL AS IN THE DATABASE, and the database is the one that
     matters. 111's constraint refuses a lost lead with no reason; this exists so
     the person gets a sentence instead of a 500, not so the rule lives here. */
  if (stage === 'lost' && (lostReason === null || !isLostReason(lostReason))) {
    return { ok: false, error: 'Say why it was lost — the reason is what makes the report useful.' };
  }

  /* ⚠️ Cleared on every other stage, rather than left to 116's trigger to undo.
     A query that relies on a trigger to reverse what it just wrote is one
     refactor away from not being reversed. */
  const reason = stage === 'lost' ? lostReason : null;

  const ok = await setLeadStage(user.id, leadId, stage, reason);
  if (!ok) return { ok: false, error: NOT_YOURS };

  refresh(leadId);
  return { ok: true };
}

export async function setTemperatureAction(
  leadId: string,
  temperature: string | null,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  if (temperature !== null && !(TEMPERATURES as readonly string[]).includes(temperature)) {
    return { ok: false, error: 'That is not a temperature.' };
  }

  const ok = await setLeadTemperature(user.id, leadId, temperature);
  if (!ok) return { ok: false, error: NOT_YOURS };

  refresh(leadId);
  return { ok: true };
}

export async function setNextActionAction(
  leadId: string,
  action: string,
  dueDate: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  const text = action.trim();
  const due = dueDate.trim();

  if (text.length > MAX_LINE) {
    return { ok: false, error: `Keep it under ${MAX_LINE} characters — it has to fit on a row.` };
  }

  /* ⚠️ A DATE WITH NOTHING OWED IS A REMINDER WITH NO INSTRUCTION. The desk
     sorts on the date and prints the text beside it; a row that says only
     "tomorrow" tells the person who picks it up nothing about what to do. */
  if (text === '' && due !== '') {
    return { ok: false, error: 'Say what the next action is, not only when it is due.' };
  }

  if (due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { ok: false, error: 'That date could not be read.' };
  }

  const ok = await setLeadNextAction(user.id, leadId, text || null, due || null);
  if (!ok) return { ok: false, error: NOT_YOURS };

  refresh(leadId);
  return { ok: true };
}

/**
 * Record that somebody reached out.
 *
 * ⚠️ THIS IS THE ONLY THING THAT STAMPS RESPONSE TIME, through 116's trigger.
 * It is also the reason the WhatsApp and call links elsewhere on the page are
 * links and not buttons: opening a chat is not evidence that a message was sent,
 * and a timeline that recorded the click would credit work nobody did.
 */
export async function logContactAction(
  leadId: string,
  kind: string,
  outcome: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  if (!isContactKind(kind)) return { ok: false, error: 'That is not something that can be logged.' };

  const note = outcome.trim();
  if (note.length > MAX_LINE) {
    return { ok: false, error: `Keep the outcome under ${MAX_LINE} characters.` };
  }

  try {
    await logLeadContact(user.id, leadId, kind, note || null);
  } catch {
    /* ⚠️ 42501, measured — an insert refused by RLS THROWS where an update
       returns nothing. The only thing it can honestly mean is that this lead is
       not the caller's to work. */
    return { ok: false, error: NOT_YOURS };
  }

  refresh(leadId);
  return { ok: true };
}

export async function addNoteAction(leadId: string, body: string): Promise<LeadWriteResult> {
  const user = await requireUser();

  const text = body.trim();
  if (text === '') return { ok: false, error: 'Write something first.' };
  if (text.length > MAX_NOTE) {
    return { ok: false, error: `That is longer than ${MAX_NOTE} characters.` };
  }

  try {
    await addLeadNote(user.id, leadId, text);
  } catch {
    return { ok: false, error: NOT_YOURS };
  }

  refresh(leadId);
  return { ok: true };
}

/**
 * ⚠️ THE TIMELINE ENTRY SURVIVES. `crm_lead_activity` has no delete policy at any
 * rank, so withdrawing a note removes what was said and leaves the fact that
 * something was said at that hour on the record. That pair is deliberate.
 */
export async function deleteNoteAction(leadId: string, noteId: string): Promise<LeadWriteResult> {
  const user = await requireUser();

  const ok = await deleteLeadNote(user.id, noteId);
  if (!ok) return { ok: false, error: 'That note could not be removed. It may not be yours.' };

  refresh(leadId);
  return { ok: true };
}
