'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { createFollowUp } from '@/lib/db/queries/crm-followups';
import { notify } from '@/lib/db/queries/feed';
import {
  addLeadNote,
  assignLead,
  crmBookAppointment,
  crmCloseAppointment,
  crmRescheduleAppointment,
  crmAttachUnit,
  crmCreateLead,
  crmDecideQuotation,
  crmDiaryAround,
  crmMarkQuotationSent,
  crmRaiseQuotation,
  crmUpdateLeadDetails,
  crmLeadDuplicates,
  crmNextOwner,
  deleteLeadNote,
  isContactKind,
  listCrmLeads,
  logLeadContact,
  setLeadNextAction,
  crmNextRung,
  crmQuotationForEmail,
  crmRecordSentEmail,
  crmReviseQuotation,
  saveQualification,
  setLeadStage,
  setLeadTemperature,
  unassignedLeadIds,
  type CrmDiaryEntry,
  type CrmDuplicate,
  type CrmLeadRow,
} from '@/lib/db/queries/crm-leads';
import { isLostReason, isStage, TEMPERATURES } from '@/lib/domain/crm-stages';
import {
  AUTHORITIES, BUDGET_BANDS, PAYMENT_MODES, PURPOSES, TIMELINES,
  qualificationGaps,
} from '@/lib/domain/crm-qualification';
import { OUTCOMES, outcomeProblems } from '@/lib/domain/crm-outcomes';
import { newLeadProblems } from '@/lib/domain/crm-new-lead';
import { appointmentKindLabel, appointmentProblems, clashesWith, MAX_MINUTES, MIN_MINUTES } from '@/lib/domain/crm-appointments';
import { needsApproval, quotationProblems, toRupees } from '@/lib/domain/crm-quotations';
import { displayPhone, toE164 } from '@/lib/domain/phone';
import { fromAddress, quotationEmail, sendLeadEmail } from '@/lib/crm/email';
import { describeSender } from '@/lib/email/send';
import { DIVISION_NAME } from '@/lib/domain/constants';

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

  /* ⚠️ 167'S GATE COMES BACK AS A SENTENCE, NOT A 500. The trigger refuses a
     lead reaching `qualified` (or anything past it) with no qualifying answers,
     and it puts WHICH answers are missing in the error's DETAIL. Letting that
     surface as an unhandled exception would give the salesperson a red box that
     names no fix — and this codebase has a standing lesson about catch blocks
     that guess at a cause instead of reading the one the database gave. */
  let ok: boolean;
  try {
    ok = await setLeadStage(user.id, leadId, stage, reason);
  } catch (err) {
    if ((err as { code?: string })?.code === 'CRM08') {
      const missing = String((err as { detail?: string }).detail ?? '').trim();
      return {
        ok: false,
        error: missing
          ? `Qualify this lead first — still to find out: ${missing}.`
          : 'Qualify this lead first.',
      };
    }
    throw err;
  }
  if (!ok) return { ok: false, error: NOT_YOURS };

  refresh(leadId);
  return { ok: true };
}

/* ============================================================================
 * QUALIFICATION — migration 167
 * ----------------------------------------------------------------------------
 * ⚠️ THIS DOES NOT MOVE THE STAGE, AND THAT IS THE DESIGN. Recording what the
 * call established and deciding where the lead now sits are two separate acts: a
 * salesperson who learns the client is just browsing has qualified them
 * perfectly well, and marching them into `qualified` for it would make the stage
 * mean "somebody asked four questions" rather than "this is a real buyer".
 *
 * ⚠️ AND THE TEMPERATURE ARRIVES FROM THE FORM, NEVER FROM `suggestTemperature`.
 * The suggestion is shown beside the field; a human commits it. Owner, 2026-09-16:
 * *"On the basis of this response I will set their temperature."*
 * ========================================================================= */

export async function saveQualificationAction(input: {
  leadId: string;
  budgetBand: string | null;
  authority: string | null;
  purpose: string | null;
  timeline: string | null;
  paymentMode: string | null;
  locationPreference: string;
  qualificationNote: string;
  budget: string;
  temperature: string | null;
}): Promise<LeadWriteResult> {
  const user = await requireUser();

  /* ⚠️ VALIDATED, NEVER PASSED THROUGH. Each of these reaches SQL as an enum
     cast, where an unknown value is a 500 rather than a sentence. */
  const oneOf = (value: string | null, allowed: readonly string[]) =>
    value === null || value === '' ? null : allowed.includes(value) ? value : undefined;

  const budgetBand = oneOf(input.budgetBand, BUDGET_BANDS);
  const authority = oneOf(input.authority, AUTHORITIES);
  const purpose = oneOf(input.purpose, PURPOSES);
  const timeline = oneOf(input.timeline, TIMELINES);
  const paymentMode = oneOf(input.paymentMode, PAYMENT_MODES);

  if ([budgetBand, authority, purpose, timeline, paymentMode].includes(undefined)) {
    return { ok: false, error: 'One of those answers is not a value this form offers.' };
  }

  const temperature =
    input.temperature === null || input.temperature === ''
      ? null
      : (TEMPERATURES as readonly string[]).includes(input.temperature)
        ? input.temperature
        : undefined;
  if (temperature === undefined) return { ok: false, error: 'That is not a temperature.' };

  /* ⚠️ A BUDGET THAT IS NOT A NUMBER IS DROPPED, NOT REFUSED. The band is what
     the gate reads and what the reports use; the precise figure is a convenience
     somebody may type "80 lakh" into, and refusing the whole form for it would
     lose the four answers that matter. */
  const rawBudget = Number(input.budget.replace(/[^0-9.]/g, ''));
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : null;

  const ok = await saveQualification(user.id, input.leadId, {
    budgetBand: budgetBand ?? null,
    authority: authority ?? null,
    purpose: purpose ?? null,
    timeline: timeline ?? null,
    paymentMode: paymentMode ?? null,
    locationPreference: input.locationPreference.trim() || null,
    qualificationNote: input.qualificationNote.trim() || null,
    budget,
    temperature,
  });
  if (!ok) return { ok: false, error: NOT_YOURS };

  refresh(input.leadId);
  revalidatePath('/my-leads');

  /* ⚠️ REPORTS WHAT IS STILL MISSING RATHER THAN CLAIMING SUCCESS. Saving three
     of four answers is progress worth keeping — but telling somebody "saved"
     when the gate is still shut is how they discover it at the dropdown. */
  const gaps = qualificationGaps({
    budgetBand: budgetBand ?? null,
    authority: authority ?? null,
    purpose: purpose ?? null,
    timeline: timeline ?? null,
  });
  return gaps.length > 0
    ? { ok: true, error: `Saved. Still to find out: ${gaps.join(', ').toLowerCase()}` }
    : { ok: true };
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
/* ==========================================================================
 * HANDING LEADS OUT — Step 7
 * --------------------------------------------------------------------------
 * ⚠️ WHO MAY DO THIS IS DECIDED BY MIGRATION 120's TRIGGER, not here. A
 * salesperson pushing an awkward lead onto a colleague is refused by the
 * database whatever calls it, and the timeline entry is written by 116's
 * trigger for the same reason. What lives here is the notification, which the
 * database has no business sending.
 * ========================================================================== */

/** Tell somebody a lead is theirs. Never throws — a failed bell must not undo
 *  an assignment that already happened. */
async function tellThem(actorId: string, ownerId: string, leadId: string, who: string) {
  try {
    await withUser(actorId, (tx) =>
      notify(tx, actorId, {
        userId: ownerId,
        kind: 'lead_assigned',
        title: `${who} is yours to work`,
        /* ⚠️ NO PHONE NUMBER IN THE BODY. A notification is pushed to a device
           and may sit on a lock screen; the lead's own page is one tap away and
           is behind the access rules. */
        body: 'Open the lead to see the full record and log your first call.',
        linkTo: `/leads/${leadId}`,
        entityId: leadId,
      }),
    );
  } catch {
    /* Swallowed deliberately — see above. */
  }
}

export async function assignLeadAction(
  leadId: string,
  ownerId: string | null,
  leadName: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  try {
    const moved = await assignLead(user.id, leadId, ownerId);
    /* ⚠️ `false` MEANS "ALREADY THEIRS", not a failure. The query only counts a
       row when the owner actually changes, so re-pressing the same name is a
       no-op that must not report an error. */
    if (moved && ownerId) await tellThem(user.id, ownerId, leadId, leadName || 'A lead');
  } catch {
    /* 120's trigger raises `insufficient_privilege` for a salesperson. */
    return {
      ok: false,
      error: "Only this department's manager or an Admin can hand out its leads.",
    };
  }

  refresh(leadId);
  return { ok: true };
}

/**
 * Share out the unassigned leads on a project.
 *
 * Owner, 2026-09-10: *"The system will automatically, smartly and intelligently
 * divide the leads to the salesperson… one salesperson has 2 leads. Definitely
 * the person who has fewer leads will get the lead."*
 *
 * ⚠️ THE RULE IS ARITHMETIC AND LIVES IN `app.crm_next_owner()` — fewest OPEN
 * leads, then whoever waited longest. Migration 120's header carries the full
 * reasoning, including why lifetime counting would punish whoever closes
 * fastest.
 *
 * ⚠️ ONE `crm_next_owner()` CALL PER LEAD, and that is what makes it balance.
 * Each assignment changes the counts the next call reads. Fetching the rota once
 * and reusing it would hand the whole batch to whoever happened to be lowest at
 * the start — the exact opposite of the intent.
 *
 * ⚠️ AND IT STOPS AT A LIMIT. Sharing out all 615 at once would be one
 * irreversible action, with 615 notifications, decided by a single click.
 */
export async function shareOutLeadsAction(
  projectId: string,
  count: number,
): Promise<LeadWriteResult & { assigned?: number }> {
  const user = await requireUser();

  const wanted = Math.min(Math.max(1, Math.floor(count) || 0), 50);

  let ids: string[];
  try {
    ids = await unassignedLeadIds(user.id, projectId, wanted);
  } catch {
    return { ok: false, error: 'Those leads could not be read.' };
  }

  if (ids.length === 0) {
    return { ok: false, error: 'Every lead on this project already has an owner.' };
  }

  let assigned = 0;
  for (const id of ids) {
    let owner: string | null;
    try {
      owner = await crmNextOwner(user.id, projectId);
    } catch {
      return { ok: false, error: 'The rota could not be read.' };
    }

    /* ⚠️ REPORTED, NOT SWALLOWED. With nobody in sales this would otherwise
       assign nothing and say it had succeeded. */
    if (!owner) {
      return {
        ok: false,
        assigned,
        error:
          assigned > 0
            ? `Shared out ${assigned} before running out of people to give them to.`
            : 'Nobody in the department this project belongs to can be given a lead.',
      };
    }

    try {
      const moved = await assignLead(user.id, id, owner);
      if (moved) {
        assigned += 1;
        await tellThem(user.id, owner, id, 'A lead');
      }
    } catch {
      return {
        ok: false,
        assigned,
        error:
          assigned > 0
            ? `Shared out ${assigned}, then one was refused. Only this department's manager or an Admin can hand out its leads.`
            : "Only this department's manager or an Admin can hand out its leads.",
      };
    }
  }

  revalidatePath('/leads');
  return { ok: true, assigned };
}

export async function deleteNoteAction(leadId: string, noteId: string): Promise<LeadWriteResult> {
  const user = await requireUser();

  const ok = await deleteLeadNote(user.id, noteId);
  if (!ok) return { ok: false, error: 'That note could not be removed. It may not be yours.' };

  refresh(leadId);
  return { ok: true };
}

/* ==========================================================================
 * RECORD OUTCOME — what happened, and what happens next
 * --------------------------------------------------------------------------
 * The owner's Phase 1 form. ⚠️ ONE ACTION, ONE TRANSACTION, because these five
 * facts are one event: the stage moved BECAUSE of an outcome, and the next
 * action was set BECAUSE of both. Four separate writes would leave a timeline
 * that reads as four unrelated changes a second apart, and a failure halfway
 * would leave a lead moved with nothing explaining why.
 *
 * ⚠️ AND RLS IS WHAT DECIDES WHETHER IT MAY HAPPEN. The whole update runs under
 * `withUser`, so a lead the caller does not own updates zero rows and the action
 * reports it — the same refusal a salesperson gets for anybody else's lead, from
 * the same policy that hides it on the desk.
 * ========================================================================== */
export async function recordOutcomeAction(
  leadId: string,
  input: {
    outcome: string;
    stage: string;
    nextAction: string;
    nextActionType: string | null;
    nextActionAt: string | null;
    lostReason: string | null;
    note: string;
    contactConfirmed: boolean;
    pauseSequence: boolean;
    /** Only read when the outcome is `site_visit_requested`. */
    visitLocation?: string;
  },
): Promise<LeadWriteResult & { booked?: string }> {
  const user = await requireUser();

  if (!(OUTCOMES as readonly string[]).includes(input.outcome)) {
    return { ok: false, error: 'That is not an outcome.' };
  }
  if (!isStage(input.stage)) return { ok: false, error: 'That is not a stage.' };
  if (input.lostReason !== null && !isLostReason(input.lostReason)) {
    return { ok: false, error: 'That is not a loss reason.' };
  }
  if (
    input.nextActionType !== null &&
    !['call', 'whatsapp', 'email', 'meeting', 'site_visit', 'task'].includes(input.nextActionType)
  ) {
    return { ok: false, error: 'That is not a kind of next action.' };
  }

  /* ⚠️ THE SAME RULES THE FORM SHOWS, RE-RUN ON THE SERVER. The form's copy is
     a courtesy so somebody is not told "no" after pressing send; this one is the
     rule. A client that skips the form entirely gets the same answer. */
  const problems = outcomeProblems({
    outcome: input.outcome,
    stage: input.stage,
    nextActionAt: input.nextActionAt,
    nextAction: input.nextAction,
    lostReason: input.lostReason,
    contactConfirmed: input.contactConfirmed,
  });
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const closing = input.stage === 'won' || input.stage === 'lost';
  const reason = input.stage === 'lost' ? input.lostReason : null;
  /* A callback or a visit time is the only next action this form sets now. */
  const setsNext = !closing && input.nextActionAt !== null && input.nextAction.trim() !== '';

  const moved = await withUser(user.id, async (tx) => {
    const before = await tx`
      select stage::text as stage, next_action, next_action_at
        from public.crm_leads where id = ${leadId}::uuid`;
    const prev = (before as Array<Record<string, unknown>>)[0];
    if (!prev) return false;

    await tx`
      update public.crm_leads
         set stage = ${input.stage}::public.crm_stage,
             lost_reason = ${reason}::public.crm_lost_reason,
             last_outcome = ${input.outcome}::public.crm_outcome,
             last_outcome_at = now(),
             last_outcome_by_id = ${user.id}::uuid,
             /* ⚠️ A CLOSED LEAD KEEPS NO NEXT ACTION. Leaving one there puts a
                won deal back on somebody's "due today" every morning.

                ⚠️ AND AN OPEN ONE KEEPS ITS OWN (2026-09-21). The form no longer
                asks for a next action — the owner: *"schedule follow-up or add a
                task are the only things that should not be added"* — so it only
                writes one when a callback or a visit time was given. Writing the
                empty field would wipe the next action a follow-up set. */
             next_action = case when ${closing}::boolean then null
                                when ${setsNext}::boolean then ${input.nextAction.trim()}
                                else next_action end,
             next_action_type = case when ${closing}::boolean then null
                                     when ${setsNext}::boolean then ${input.nextActionType}::public.crm_next_action_kind
                                     else next_action_type end,
             next_action_at = case when ${closing}::boolean then null
                                   when ${setsNext}::boolean then ${input.nextActionAt}::timestamptz
                                   else next_action_at end
       where id = ${leadId}::uuid`;

    /* ── ⚠️ `closed_at` IS THE TRIGGER'S, NOT OURS ─────────────────────────
       `crm_leads_close_stamp` (116) stamps it when a stage becomes won or lost
       and clears it when a lead reopens — deliberately, so that the
       response-time figures cannot be doctored by whatever wrote the row. It is
       one of the columns 116 pointedly did NOT grant.

       This used to write it twice and get it wrong both times:
       `closed_at = ${'${closing ? null : null}'}` is null on BOTH branches, and a
       second statement then set `now()`. The first was also what made the whole
       action fail with "permission denied" — a column nobody was allowed to
       write, in a statement that did not need to write it. Removed rather than
       granted; the trigger already did the job correctly. */

    /* ⚠️ THE TIMELINE CARRIES THE WHOLE EVENT, not just the new stage. "Stage
       changed to Lost" answers what; `from`, `outcome` and the note answer why,
       and why is the question somebody asks six months later. */
    await tx`
      insert into public.crm_lead_activity (lead_id, kind, actor_id, occurred_at, detail)
      values (
        ${leadId}::uuid, 'stage_changed', ${user.id}::uuid, now(),
        ${tx.json({
          from: String(prev.stage),
          to: input.stage,
          outcome: input.outcome,
          note: input.note.trim() || null,
          next_action: setsNext ? input.nextAction.trim() : null,
          next_action_at: setsNext ? input.nextActionAt : null,
        })}
      )`;

    if (input.note.trim()) {
      await tx`
        insert into public.crm_lead_notes (lead_id, author_id, body)
        values (${leadId}::uuid, ${user.id}::uuid, ${input.note.trim()})`;
    }

    /* ⚠️ A REPLY OR A CLOSE STOPS THE CHASE. Owner's rule, and the one that
       matters most: an automated sequence talking over a client who has just
       replied is the fastest way to look like a robot. `stopped` for a closed
       lead, `paused` while somebody decides. */
    if (input.pauseSequence || closing || input.outcome === 'client_replied') {
      /* ⚠️⚠️ `now()` IS SQL. IT CANNOT TRAVEL AS A PARAMETER, AND THIS THREW.
         Written as `${closing ? null : 'now()'}::timestamptz`, which reads like
         SQL and is not: everything in `${}` is a bound value, so the string
         "now()" was handed to postgres.js's timestamptz serializer, which did
         `new Date('now()').toISOString()` and raised **RangeError: Invalid time
         value** before a byte reached Postgres.

         ⚠️ AND IT TOOK THE WHOLE OUTCOME WITH IT. This runs inside the same
         transaction as the stage change, the timeline row and the note, so
         every outcome that closes a lead, records a reply, or pauses a chase
         rolled back entirely — the salesperson saw an error and lost what the
         client had just told them. Anything that does not close a lead was
         unaffected, which is why it survived this long.

         The clock stays the database's, as it is on `updated_at` one line down;
         only the branch is a parameter now. */
      await tx`
        update public.crm_lead_sequences
           set state = ${closing ? 'stopped' : 'paused'}::public.crm_sequence_state,
               paused_at = case when ${closing}::boolean then null else now() end,
               pause_reason = ${
                 closing
                   ? null
                   : input.outcome === 'client_replied'
                     ? 'Client replied'
                     : 'Paused when the outcome was recorded'
               },
               stopped_at = case when ${closing}::boolean then now() else null end,
               updated_at = now()
         where lead_id = ${leadId}::uuid
           and state in ('scheduled', 'active', 'paused')`;
    }

    return true;
  });

  if (!moved) return { ok: false, error: NOT_YOURS };

  /* ── ⚠️ "SITE VISIT REQUESTED" PUTS THE VISIT IN THE DIARY ────────────────
     Recording that outcome and leaving nothing behind but a reminder was the
     gap Phase E exists to close. A next action says *I should ring them
     Tuesday*; a client who asked to see a plot is coming on Tuesday, and
     somebody has to be there.

     ⚠️ BOOKED AFTER THE OUTCOME, IN ITS OWN TRANSACTION, AND THE ORDER IS
     DELIBERATE. If the booking fails the outcome is still recorded and the next
     action still stands — a salesperson loses a diary entry, not the note of
     what the client said. The other order would risk the reverse, which is
     worse: a visit in the diary that no timeline explains. */
  let booked: string | undefined;
  if (input.outcome === 'site_visit_requested' && input.nextActionAt && !closing) {
    const appt = await crmBookAppointment(user.id, {
      leadId,
      kind: 'site_visit',
      scheduledAt: input.nextActionAt,
      durationMinutes: 60,
      /* ⚠️ The form asks for it only on this outcome; empty is allowed here
         because the visit itself is the fact worth keeping, and a place can be
         added before the day. `appointmentProblems` insists on one for a
         booking made through the booking form, where there is room to ask. */
      location: input.visitLocation?.trim() || null,
      note: input.note.trim() || null,
    });
    booked = appt?.id;
  }

  refresh(leadId);
  revalidatePath('/my-leads');
  return { ok: true, booked };
}

/* ============================================================================
 * ADDING A LEAD BY HAND
 * ----------------------------------------------------------------------------
 * ── ⚠️ THERE IS NO OWNER IN THIS INPUT, AND THAT IS THE RULE ───────────────
 * The owner's spec: *"The salesperson must not select an owner."* It is enforced
 * three deep, and each layer is independently sufficient:
 *
 *   this type            has no field to put one in
 *   crmCreateLead        has no argument to pass one through
 *   app.crm_create_lead  has no parameter to receive one
 *
 * A rule that cannot be expressed cannot be forgotten by a second call site.
 *
 * ── ⚠️ THE REFUSALS COME BACK AS SENTENCES, NOT SQLSTATEs ─────────────────
 * Migration 158 raises with its own error codes. They are mapped here by CODE,
 * never by matching on message text — a message is copy and will be reworded; a
 * code is an interface. The one exception is CRM05, which keeps the database's
 * own wording because it names the colleague and this layer does not know who
 * that is.
 * ========================================================================= */

export interface CreateLeadResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly id?: string;
  /** Who the rota gave it to, for the confirmation. */
  readonly ownerName?: string | null;
  /** The figures the rota decided on, in a sentence. */
  readonly why?: string | null;
}

/** Raised by app.crm_create_lead (migration 158). */
const CREATE_LEAD_REFUSALS: Record<string, string> = {
  CRM00: 'You are not signed in.',
  CRM02: 'You cannot add leads to that project.',
  CRM03: 'A lead needs a name.',
  CRM04: 'Add a phone number or an email — otherwise there is no way to contact this person.',
  CRM06: 'You already have an open lead for this person on this project.',
};

function refusalFor(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  if (!code) return null;
  /* ⚠️ CRM05 keeps the database's own message because it NAMES THE COLLEAGUE,
     and that name is the only part that makes the sentence actionable — "add a
     note to Sahad's lead" is a next step; "this is a duplicate" is not. */
  if (code === 'CRM05') return String((err as { message?: string }).message ?? '');
  return CREATE_LEAD_REFUSALS[code] ?? null;
}

/**
 * Do we already know this person? Called as somebody fills the form, and again
 * before it offers the save button.
 *
 * ⚠️ RETURNS AN EMPTY LIST RATHER THAN THROWING. This runs while a form is still
 * half-filled; a rejected promise would put a red banner on a screen nobody has
 * finished. The database refuses a real clash on save regardless, so the worst
 * case of a silent failure here is a warning that arrives late instead of early.
 */
export async function checkDuplicatesAction(
  projectId: string,
  phone: string,
  email: string,
): Promise<{ duplicates: CrmDuplicate[] }> {
  const user = await requireUser();
  if (!projectId) return { duplicates: [] };

  const e164 = toE164(phone);
  const cleanEmail = email.trim().toLowerCase() || null;
  if (!e164 && !cleanEmail) return { duplicates: [] };

  try {
    return { duplicates: await crmLeadDuplicates(user.id, projectId, e164, cleanEmail) };
  } catch {
    return { duplicates: [] };
  }
}

export async function createLeadAction(input: {
  projectId: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  sourceDetail: string;
  enquiry: string;
  propertyId: string | null;
  budget: string;
  whatsappConsent: boolean | null;
  preferredChannel: string | null;
  preferredTime: string;
  nextAction: string;
  nextActionAt: string | null;
  nextActionType: string | null;
  allowDuplicate: boolean;
}): Promise<CreateLeadResult> {
  const user = await requireUser();

  /* ⚠️ THE SAME RULES THE FORM SHOWS, RE-RUN HERE. The form's copy is a courtesy
     so nobody is told "no" after pressing save; this one is the rule, and a
     client that skips the form entirely gets the same answer. */
  const problems = newLeadProblems({
    projectId: input.projectId,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    city: input.city,
    source: input.source,
    sourceDetail: input.sourceDetail,
    enquiry: input.enquiry,
    budget: input.budget,
    whatsappConsent: input.whatsappConsent,
    preferredChannel: input.preferredChannel,
    preferredTime: input.preferredTime,
    nextAction: input.nextAction,
    nextActionAt: input.nextActionAt,
    nextActionType: input.nextActionType,
  });
  if (problems.length > 0) return { ok: false, error: problems[0] };

  if (
    input.nextActionType !== null &&
    !['call', 'whatsapp', 'email', 'meeting', 'site_visit', 'task'].includes(input.nextActionType)
  ) {
    return { ok: false, error: 'That is not a kind of next action.' };
  }

  /* Whole rupees. "1,20,00,000" and "12000000" are the same number; everything
     that is not a digit is stripped, and 150 keeps the column a bigint. */
  const budgetDigits = input.budget.trim().replace(/[^\d]/g, '');

  try {
    const created = await crmCreateLead(user.id, {
      projectId: input.projectId,
      fullName: input.fullName.trim(),
      /* Exactly as typed — it is what they wrote, and it is evidence. */
      phone: input.phone.trim() || null,
      /* Derived. Null when it could not be read with confidence, which is a real
         answer and not a failure — see lib/domain/phone.ts. */
      phoneE164: toE164(input.phone),
      email: input.email.trim().toLowerCase() || null,
      city: input.city.trim() || null,
      source: input.source,
      sourceDetail: input.sourceDetail.trim() || null,
      enquiry: input.enquiry.trim() || null,
      propertyId: input.propertyId,
      budget: budgetDigits ? Number(budgetDigits) : null,
      whatsappConsent: input.whatsappConsent,
      preferredChannel: input.preferredChannel,
      preferredTime: input.preferredTime.trim() || null,
      nextAction: input.nextAction.trim() || null,
      nextActionAt: input.nextActionAt,
      nextActionType: input.nextActionType,
      allowDuplicate: input.allowDuplicate,
    });

    revalidatePath('/my-leads');
    revalidatePath('/leads');

    /* ⚠️ THE NEW OWNER IS TOLD, not left to discover it. A lead that lands
       silently on somebody's desk is one they find hours later, and the response
       time this whole system measures is counting the entire time.

       ⚠️ `tellThem` RATHER THAN A SECOND NOTIFIER — it already decides what may
       appear on a lock screen, and a copy of that decision here would be one
       more place to forget it. It also returns early when the recipient is the
       actor, so Sarah typing a walk-in the rota then gives to Sarah is not told
       about the thing she is already looking at. */
    if (created.id && created.ownerId) {
      await tellThem(user.id, created.ownerId, created.id, input.fullName.trim() || 'A lead');
    }

    return { ok: true, id: created.id, ownerName: created.ownerName, why: created.why };
  } catch (err) {
    const refusal = refusalFor(err);
    if (refusal) return { ok: false, error: refusal };
    throw err;
  }
}

/* ============================================================================
 * APPOINTMENTS — Phase E
 * ----------------------------------------------------------------------------
 * ⚠️ AN APPOINTMENT IS NOT A NEXT ACTION. `next_action_at` is a note to self:
 * *ring them Tuesday*. This is a promise to somebody else: *they are coming to
 * the site at 4pm and someone has to be there.* Only one of those has a second
 * person's afternoon in it, which is why it has a duration, a place, an owner
 * and an outcome — and why booking one is its own action rather than a field.
 * ========================================================================= */

export interface BookResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly id?: string;
  /** Said out loud, never a refusal — see `clashesWith`. */
  readonly clash?: string;
  /** True when the client reminder was queued alongside the booking. */
  readonly reminded?: boolean;
}

/**
 * What else is in the diary near a proposed time, so the form can say so before
 * anybody commits to it.
 *
 * ⚠️ AN EMPTY LIST ON FAILURE, NEVER A THROW. This runs while somebody is still
 * choosing a time; a rejected promise would put an error banner on a half-filled
 * form. The worst case of a silent failure is a clash warned about late rather
 * than early — and the booking itself is unaffected either way.
 */
export async function diaryAroundAction(whenIso: string): Promise<{ entries: CrmDiaryEntry[] }> {
  const user = await requireUser();
  if (!whenIso || Number.isNaN(Date.parse(whenIso))) return { entries: [] };
  try {
    return { entries: await crmDiaryAround(user.id, whenIso) };
  } catch {
    return { entries: [] };
  }
}

export async function bookAppointmentAction(input: {
  leadId: string;
  kind: string;
  scheduledAt: string | null;
  durationMinutes: number;
  location: string;
  note: string;
  /**
   * Hours before the appointment to remind the client, or null for none.
   *
   * ⚠️ A REMINDER IS A FOLLOW-UP, NOT A FLAG ON THE APPOINTMENT. It is written
   * with purpose `appointment_reminder`, which is what the Appointments tab reads
   * back as "WhatsApp reminder · Scheduled" and what the Follow-ups tab lists. A
   * boolean on the appointment row would show on this screen and reach nobody.
   */
  remindHoursBefore?: number | null;
}): Promise<BookResult> {
  const user = await requireUser();

  /* ⚠️ THE SAME RULES THE FORM SHOWS, RE-RUN HERE. The form's copy spares
     somebody a refusal after filling a panel in; this one is the rule, and a
     client that skips the form gets the same answer. */
  const problems = appointmentProblems(
    {
      kind: input.kind,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      location: input.location,
      note: input.note,
    },
    Date.now(),
  );
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const booked = await crmBookAppointment(user.id, {
    leadId: input.leadId,
    kind: input.kind,
    scheduledAt: input.scheduledAt!,
    durationMinutes: input.durationMinutes,
    location: input.location.trim() || null,
    note: input.note.trim() || null,
  });

  /* ⚠️ NULL MEANS RLS REFUSED THE LEAD — the insert selected no row rather than
     raising, so there is nothing to catch and nothing to report as a fault. */
  if (!booked) return { ok: false, error: NOT_YOURS };

  refresh(input.leadId);
  revalidatePath('/my-leads');

  /* ⚠️ THE CLASH IS CHECKED AFTER THE BOOKING, ON PURPOSE. Checking first and
     refusing would make the system wrong more often than the person: a colleague
     covers one, a visit runs next door to the last, the salesperson intends to
     move the other. So it books, then says what else is in that hour — the
     person decides, with the booking already safe. */
  let clash: string | undefined;
  try {
    const around = await crmDiaryAround(user.id, input.scheduledAt!);
    const others = around
      .filter((a) => a.id !== booked.id)
      .map((a) => ({
        startMs: Date.parse(a.scheduledAt),
        minutes: a.durationMinutes,
        status: a.status,
      }));
    if (
      clashesWith(
        { startMs: Date.parse(input.scheduledAt!), minutes: input.durationMinutes },
        others,
      )
    ) {
      clash = 'You already have something booked in that hour. Both are saved — move one if you need to.';
    }
  } catch {
    /* A clash we failed to look for is not a reason to hide a successful
       booking. */
  }

  /* ⚠️ THE REMINDER COMES AFTER THE BOOKING, AND CANNOT UNDO IT. A reminder that
     failed to queue is worth saying; it is not worth throwing away an appointment
     the client has already been told about. */
  let reminded = false;
  const hours = input.remindHoursBefore ?? null;
  if (hours !== null && hours > 0) {
    const dueMs = Date.parse(input.scheduledAt!) - hours * 3_600_000;
    if (dueMs > Date.now()) {
      try {
        const written = await createFollowUp(user.id, {
          leadId: input.leadId,
          channel: 'whatsapp',
          purpose: 'appointment_reminder',
          title: `Remind about the ${appointmentKindLabel(input.kind).toLowerCase()} on ${new Date(
            input.scheduledAt!,
          ).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
            timeZone: 'Asia/Karachi',
          })}`,
          body: input.location.trim() ? `Where: ${input.location.trim()}` : null,
          dueAt: new Date(dueMs).toISOString(),
        });
        reminded = written !== null && written.ok !== false;
      } catch {
        /* Said by `reminded: false`, never by losing the booking. */
      }
    }
  }

  return { ok: true, id: booked.id, clash, reminded };
}

/**
 * Move an appointment to a different time — 219.
 *
 * Owner, 2026-09-19: *"there is no option in the appointment tab to edit the
 * appointment… the client is saying this time is not suitable, so please change
 * the time… and when I reschedule, send an auto message on WhatsApp."*
 *
 * ⚠️ IT DOES NOT TELL THE CLIENT ITSELF. 219's trigger does that, on the row
 * changing — so a time moved from anywhere, by any screen or any future agent,
 * is confirmed the same way. A send from this action would be one path of
 * several, and the others would go out silently.
 */
export async function rescheduleAppointmentAction(input: {
  appointmentId: string;
  leadId: string;
  at: string;
  minutes?: number | null;
  location?: string | null;
  note?: string | null;
}): Promise<LeadWriteResult> {
  const user = await requireUser();

  const at = Date.parse(input.at);
  if (Number.isNaN(at)) return { ok: false, error: 'Choose a date and time.' };

  /* ⚠️ THE PAST IS REFUSED, and this is the one rule a reschedule needs that a
     booking does not: the commonest reason to move an appointment is that its
     time has already gone, so the field opens on a moment that is invalid. */
  if (at <= Date.now()) {
    return { ok: false, error: 'Choose a time in the future — that moment has passed.' };
  }

  const minutes = input.minutes ?? null;
  if (minutes !== null && (minutes < MIN_MINUTES || minutes > MAX_MINUTES)) {
    return { ok: false, error: `How long should it run? Between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.` };
  }

  const moved = await crmRescheduleAppointment(user.id, {
    appointmentId: input.appointmentId,
    at: new Date(at).toISOString(),
    minutes,
    location: input.location?.trim() || null,
    note: input.note?.trim() || null,
  });
  if (!moved) return { ok: false, error: NOT_YOURS };

  refresh(input.leadId);
  revalidatePath('/appointments');
  return { ok: true };
}

export async function closeAppointmentAction(
  appointmentId: string,
  leadId: string,
  status: string,
  outcome: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  /* ⚠️ DONE OR CANCELLED — NOTHING ELSE (2026-09-21). Owner, after one stray
     click on "No-show" closed a visit: *"'Not shown' is not a scenario… It's
     done or it cancels. Put them in the reason to cancel."* A client who did
     not come is a cancellation with that reason. */
  if (!['completed', 'cancelled'].includes(status)) {
    return { ok: false, error: 'An appointment is either done or cancelled.' };
  }
  if (status === 'cancelled' && !outcome.trim()) {
    return { ok: false, error: 'Say why it is being cancelled.' };
  }

  /* ⚠️ A COMPLETED APPOINTMENT NEEDS AN OUTCOME, and migration 152 says so with
     a CHECK. Refusing here first turns a constraint violation into a sentence
     somebody can act on. "It happened" with nothing recorded is the same as not
     recording it — and what happened at the visit is what moves the lead. */
  if (status === 'completed' && !outcome.trim()) {
    return { ok: false, error: 'Say what happened at the visit. That is the part worth keeping.' };
  }

  const done = await crmCloseAppointment(
    user.id,
    appointmentId,
    status as 'completed' | 'no_show' | 'cancelled',
    outcome.trim() || null,
  );
  if (!done) return { ok: false, error: NOT_YOURS };

  refresh(leadId);
  revalidatePath('/my-leads');
  return { ok: true };
}

/* ============================================================================
 * TURNING A PAGE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"Why is the pagination taking time to render? Why is
 * everything taking time to render? Why is it not on the client side?"*
 *
 * ⚠️ MEASURED BEFORE ANSWERING. One click on "next page" re-ran NINE queries —
 * the project list, the counts, the owner options, the Add Lead data, the
 * property catalogue and the drawer's three — because a page number lives in the
 * URL and changing the URL re-renders the whole route.
 *
 *     the whole page re-rendering (9 queries)   1477 ms
 *     only the rows that actually change        486 ms
 *     ─────────────────────────────────────────────────
 *     67% of it was fetching things a page change cannot alter.
 *
 * The rows themselves genuinely have to come from the database — page 2 is not
 * on the client and cannot be. What was avoidable is everything else.
 *
 * ⚠️ SO THIS RETURNS ROWS AND NOTHING ELSE, and the desk swaps them into state.
 * No navigation, no re-render of the page around them; the URL catches up behind
 * so a reload and the back button still land on the right page. Rule Zero, law 3
 * — never re-fetch what is already on the page.
 * ========================================================================= */

export async function leadsPageAction(
  projectId: string | null,
  filters: {
    stage: string | null;
    temperature: string | null;
    formId: string | null;
    search: string | null;
    due: string | null;
  },
  page: number,
  perPage: number,
): Promise<{ rows: CrmLeadRow[]; total: number } | null> {
  const user = await requireUser();

  /* ⚠️ VALIDATED, NOT TRUSTED — the same whitelisting the page does. These
     arrive from a client and `stage` reaches SQL as an enum comparison, where an
     unknown value is a 500 rather than an empty list. */
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePer = Math.min(50, Math.max(1, Math.floor(perPage) || 8));

  try {
    const data = await listCrmLeads(
      user.id,
      projectId,
      {
        stage: filters.stage && isStage(filters.stage) ? filters.stage : null,
        ownerId: null,
        temperature: filters.temperature ?? null,
        formId: filters.formId ?? null,
        search: filters.search ?? null,
        from: null,
        to: null,
        due: ['overdue', 'today', 'no-plan', 'waiting', 'upcoming', 'closed'].includes(
          filters.due ?? '',
        )
          ? (filters.due ?? null)
          : null,
        /* ⚠️ HARD TRUE, exactly as the page has it. This action is reachable
           from a client, so the one rule that makes this "my leads" cannot be
           something the caller supplies. */
        mine: true,
      },
      safePer,
      (safePage - 1) * safePer,
    );
    return { rows: data.rows as CrmLeadRow[], total: data.total };
  } catch {
    /* ⚠️ NULL, AND THE DESK KEEPS THE ROWS IT HAS. A failed page turn must not
       blank a table somebody is reading — it falls back to the navigation, which
       is slower and always works. */
    return null;
  }
}

/* ============================================================================
 * QUOTATIONS — Phase D
 * ----------------------------------------------------------------------------
 * ⚠️ THE APPROVAL RULES ARE THE DATABASE'S, NOT THIS FILE'S. 151 refuses an
 * approved row with no approver, refuses an approver who is the preparer, and
 * refuses a discount larger than the price. What is here is the same rules said
 * in words, so somebody is told what is wrong instead of meeting a constraint
 * violation — and a client that skips this layer still cannot get past them.
 * ========================================================================= */

export interface QuotationResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly number?: string;
  /** What actually happened to it, so the screen can say so. */
  readonly status?: string;
}

export async function raiseQuotationAction(input: {
  leadId: string;
  basePrice: string;
  premiumCharges: string;
  requestedDiscount: string;
  validUntil: string | null;
  terms: string;
  sendNow: boolean;
}): Promise<QuotationResult> {
  const user = await requireUser();

  /* ⚠️ KARACHI'S TODAY, NOT THE SERVER'S. For five hours each evening a UTC
     date is still yesterday here, and a validity date typed as today would be
     refused as already past. */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

  const problems = quotationProblems(
    {
      basePrice: input.basePrice,
      premiumCharges: input.premiumCharges,
      requestedDiscount: input.requestedDiscount,
      validUntil: input.validUntil,
      terms: input.terms,
    },
    today,
  );
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const basePrice = toRupees(input.basePrice) ?? 0;
  const premiumCharges = input.premiumCharges.trim() ? (toRupees(input.premiumCharges) ?? 0) : 0;
  const requestedDiscount = input.requestedDiscount.trim()
    ? (toRupees(input.requestedDiscount) ?? 0)
    : 0;

  const raised = await crmRaiseQuotation(user.id, {
    leadId: input.leadId,
    basePrice,
    premiumCharges,
    requestedDiscount,
    validUntil: input.validUntil,
    terms: input.terms.trim() || null,
    /* ⚠️ A DISCOUNT IS NEVER SENT STRAIGHT OUT, whatever the form asked for.
       The query decides this too; saying it twice costs nothing and means a
       caller that skips the form cannot send an unapproved discount. */
    sendNow: input.sendNow && !needsApproval(requestedDiscount),
  });

  if (!raised) return { ok: false, error: NOT_YOURS };

  refresh(input.leadId);
  revalidatePath('/my-leads');

  const status = needsApproval(requestedDiscount)
    ? 'pending_approval'
    : input.sendNow
      ? 'sent'
      : 'draft';
  return { ok: true, number: raised.number, status };
}

export async function decideQuotationAction(
  quotationId: string,
  leadId: string,
  decision: string,
  approvedDiscount: string,
  note: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, error: 'That is not a decision.' };
  }

  /* ⚠️ A REFUSAL NEEDS A REASON. "Rejected" with nothing written is a message
     the salesperson cannot act on — they will either ask anyway or quietly stop
     asking, and both are worse than a sentence. */
  if (decision === 'rejected' && !note.trim()) {
    return { ok: false, error: 'Say why. A rejection with no reason is one nobody can act on.' };
  }

  const approved = decision === 'approved' ? (toRupees(approvedDiscount) ?? 0) : 0;

  try {
    const done = await crmDecideQuotation(
      user.id,
      quotationId,
      decision,
      approved,
      note.trim() || null,
    );
    if (!done) return { ok: false, error: 'That quotation could not be updated.' };
  } catch (err) {
    /* ⚠️ 23514 IS THE TABLE REFUSING, and the two that will actually happen are
       worth naming rather than printing as a constraint. Both are rules somebody
       could reasonably not know. */
    const code = (err as { code?: string })?.code;
    if (code === '23514') {
      return {
        ok: false,
        error:
          'Refused: a quotation cannot be approved by the person who prepared it, and a discount cannot exceed the price.',
      };
    }
    throw err;
  }

  refresh(leadId);
  revalidatePath('/my-leads');
  return { ok: true };
}

export async function sendQuotationAction(
  quotationId: string,
  leadId: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();
  const done = await crmMarkQuotationSent(user.id, quotationId);

  /* ⚠️ FALSE MEANS THE STATUS WAS WRONG, not that the row was missing — the
     update's own WHERE refuses anything not approved or draft. Naming the actual
     reason saves somebody looking for a bug that is a rule. */
  if (!done) {
    return {
      ok: false,
      error: 'Only an approved quotation can be sent. This one is still waiting for a decision.',
    };
  }

  refresh(leadId);
  revalidatePath('/my-leads');
  return { ok: true };
}

/**
 * Point a lead at the unit they are asking about.
 *
 * ⚠️ NO PRICE PASSES THROUGH HERE. The salesperson chooses WHICH unit; what it
 * costs is the catalogue's, and `crm_properties` is read-only to them (150). A
 * price argument on this action would be a way around that rule dressed as a
 * convenience.
 */
export async function attachUnitAction(
  leadId: string,
  propertyId: string | null,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  const done = await crmAttachUnit(user.id, leadId, propertyId);

  /* ⚠️ FALSE MEANS ONE OF TWO THINGS and they deserve different sentences: the
     lead is not theirs, or the unit belongs to a different project. The second
     is the one somebody would otherwise chase as a bug. */
  if (!done) {
    return {
      ok: false,
      error: propertyId
        ? 'That unit belongs to a different project, or that lead is not yours to change.'
        : NOT_YOURS,
    };
  }

  refresh(leadId);
  revalidatePath('/my-leads');
  return { ok: true };
}

/* ============================================================================
 * EMAILING A QUOTATION — migration 175
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"the proposal and the quotation, each time sent by
 * WhatsApp and also auto-sent by email."*
 *
 * ⚠️ EMAIL IS THE CHANNEL THAT ALWAYS WORKS, and that is why it matters more
 * than it looks. WhatsApp refuses free text outside its 24-hour window; email
 * never does. For the 44 leads in the Gulf, everybody who does not reply on
 * WhatsApp, and every client who reads mail at a desk, this is the only reliable
 * way a price reaches them.
 * ========================================================================= */

export async function emailQuotationAction(
  quotationId: string,
  note: string,
): Promise<LeadWriteResult> {
  const user = await requireUser();

  const q = await crmQuotationForEmail(user.id, quotationId);
  /* ⚠️ The same sentence for "gone" and "not yours" — see the route's own note. */
  if (!q) return { ok: false, error: NOT_YOURS };

  /* ⚠️ REFUSED BEFORE ANYTHING IS SENT, and it names the fix. A lead with no
     email address is an ordinary state — 640 of 641 arrived from a Meta form
     that did not ask for one — so this is not an error, it is a missing field
     somebody can go and fill in. */
  const to = (q.leadEmail ?? '').trim();
  if (!to) {
    return {
      ok: false,
      error: `${q.leadName ?? 'This lead'} has no email address on record. Add one and it can go by email as well.`,
    };
  }

  const email = quotationEmail({
    greetingName: q.leadName ?? 'Sir/Madam',
    quotationNumber: q.number,
    version: q.version,
    /* ⚠️ FORMATTED HERE, ONCE. A template that formatted money would decide the
       currency and the grouping in a file nobody reads, and then the email and
       the screen would disagree about the same price. */
    amountLabel: `PKR ${q.netAmount.toLocaleString('en-PK')}`,
    validUntilLabel: q.validUntil
      ? new Date(q.validUntil).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
        })
      : null,
    itemLabel: q.itemLabel,
    itemDetail: q.itemDetail,
    from: {
      /* ⚠️ THE BUSINESS AS THE CLIENT KNOWS IT — the same resolution WhatsApp
         uses, cleaned of our own tags. This used to be `projectName`, so a
         price went out headed with the label on OUR project list. */
      businessName: q.businessName ?? DIVISION_NAME,
      subtitle: q.subtitle,
      salespersonName: user.fullName,
      replyTo: describeSender().configured ? fromAddress() : null,
      phone: q.phone ? displayPhone(q.phone) : null,
    },
    note: note.trim() || null,
  });

  const sent = await sendLeadEmail({
    to,
    email,
    as: { businessName: q.businessName, replyTo: user.email ?? null },
  });
  if (!sent.ok) return { ok: false, error: sent.error ?? 'The email could not be sent.' };

  /* ⚠️ RECORDED ONLY ONCE IT HAS ACTUALLY GONE. A row written first would show a
     quotation as delivered that the provider refused, and the salesperson would
     stop chasing a client who never got a price.

     ⚠️ AND A FAILURE TO RECORD IS NOT A FAILURE TO SEND. The email is already
     with the client; saying otherwise would have somebody send it twice. */
  const recorded = await crmRecordSentEmail(user.id, {
    leadId: q.leadId,
    subject: email.subject,
    body: email.text,
    messageId: sent.messageId ?? null,
  });

  refresh(q.leadId);
  revalidatePath('/my-leads');

  return recorded
    ? { ok: true }
    : { ok: true, error: 'Sent, but it could not be added to the conversation.' };
}

/**
 * Move a client down to the next price the company has already agreed to.
 *
 * ⚠️ THE SALESPERSON CHOOSES WHEN, NOT HOW FAR. Owner: *"After verifying,
 * discussing, or showing the features… explain what we are providing, that's why
 * our price is that. After that you can finally give the last quotation."* The
 * rungs are the item's; this action only advances one.
 */
export async function reviseQuotationAction(
  quotationId: string,
  validUntil: string,
): Promise<LeadWriteResult & { number?: string; version?: number }> {
  const user = await requireUser();

  const rung = await crmNextRung(user.id, quotationId);
  if (!rung) {
    /* ⚠️ NAMES WHY THERE IS NOWHERE TO GO, because "cannot revise" reads as a
       fault. Either the floor has been reached — which is a decision, not an
       error — or the item has no ladder set, which somebody can go and fix. */
    return {
      ok: false,
      error:
        'There is no lower price set for this item. Either it is already at the floor, or its second and third prices have not been filled in.',
    };
  }

  const revised = await crmReviseQuotation(
    user.id,
    quotationId,
    /^\d{4}-\d{2}-\d{2}$/.test(validUntil.trim()) ? validUntil.trim() : null,
  );
  if (!revised) return { ok: false, error: NOT_YOURS };

  refresh(revised.id);
  revalidatePath('/my-leads');

  return {
    ok: true,
    number: revised.number,
    version: revised.version,
    error: rung.isFloor
      ? `${revised.number} v${revised.version} raised at PKR ${revised.price.toLocaleString('en-PK')} — this is the floor, there is nothing below it.`
      : undefined,
  };
}

/* ============================================================================
 * CORRECTING A LEAD'S DETAILS — migration 201
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"add the edit option for things like phone number, email…
 * or their name, their interest… when I contact him and he gives me a correct
 * number or a correct email, I want to add that information."*
 * ========================================================================= */

export interface LeadDetailsResult extends LeadWriteResult {
  /** How many fields actually moved, so the toast can say "nothing changed". */
  readonly changed?: number;
  /** What the number normalised to, so the form can show what was stored. */
  readonly phoneE164?: string | null;
}

export async function updateLeadDetailsAction(input: {
  leadId: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  interest: string;
}): Promise<LeadDetailsResult> {
  const user = await requireUser();

  const fullName = input.fullName.trim();
  if (fullName.length > 160) return { ok: false, error: 'Keep the name under 160 characters.' };
  const city = input.city.trim();
  if (city.length > 120) return { ok: false, error: 'Keep the city under 120 characters.' };
  const interest = input.interest.trim();
  if (interest.length > 400) return { ok: false, error: 'Keep the interest under 400 characters — the detail belongs in a note.' };

  /* ⚠️ AN EMAIL IS CHECKED HERE, because the whole point of this form is that
     somebody read an address off a phone call. A typo saved silently is a
     quotation that bounces and nobody notices for a week. */
  const email = input.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: `"${email}" does not look like an email address.` };
  }
  if (email.length > 240) return { ok: false, error: 'That email address is too long.' };

  /* ⚠️ AND A NUMBER MUST NORMALISE, or WhatsApp cannot reach it. `toE164` is the
     same function the importer and the composer use, so a number this refuses is
     one nothing else in the system could have dialled either. */
  const phone = input.phone.trim();
  const phoneE164 = phone ? toE164(phone) : null;
  if (phone && !phoneE164) {
    return {
      ok: false,
      error: `"${phone}" is not a number we can dial. A Pakistani mobile looks like 0300 1234567, or +92 300 1234567.`,
    };
  }

  const saved = await crmUpdateLeadDetails(user.id, input.leadId, {
    fullName: fullName || null,
    phone: phone || null,
    phoneE164,
    email: email || null,
    city: city || null,
    interest: interest || null,
  });
  if (!saved.ok) return { ok: false, error: NOT_YOURS };

  refresh(input.leadId);
  revalidatePath('/my-leads');
  return { ok: true, changed: saved.changed, phoneE164 };
}
