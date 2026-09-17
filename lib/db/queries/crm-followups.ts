import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * FOLLOW-UPS AND SEQUENCES — the writes behind the drawer's Follow-ups tab
 * ----------------------------------------------------------------------------
 * Every one runs as the person (`withUser`), so RLS decides whose lead it is:
 * 153's policies delegate both tables to `crm_leads`. A lead the caller cannot
 * see matches no row, and the write reports "not yours" rather than an error
 * that says which ids exist.
 *
 * ⚠️ EACH IS ONE TRANSACTION. Stopping a sequence and cancelling what it had
 * already queued, or completing a follow-up and moving the lead's next action
 * on, are one fact each — half of either is a desk that says something false.
 * ========================================================================= */

export type FollowUpWrite =
  | { readonly ok: true; readonly leadId: string }
  | { readonly ok: false; readonly error: string };

const NOT_YOURS = 'That could not be changed. It may not be yours to work.';

/** A refusal raised inside a transaction, so everything it wrote rolls back. */
class Refused extends Error {}

/**
 * ⚠️ "NOT YOURS" ONLY WHEN IT IS NOT. An update that matched nothing has two
 * causes: the row is hidden by RLS, or it is visible and already past the state
 * the button assumed — completed twice, stopped from another tab. The second
 * deserves its real reason, and asking costs one read on a path that already
 * failed.
 */
async function explainMiss(
  tx: Parameters<Parameters<typeof withUser>[1]>[0],
  table: 'crm_follow_ups' | 'crm_lead_sequences',
  id: string,
): Promise<null> {
  const rows = (table === 'crm_follow_ups'
    ? await tx`select status::text as s from public.crm_follow_ups where id = ${id}::uuid`
    : await tx`select state::text as s from public.crm_lead_sequences where id = ${id}::uuid`) as Array<{ s: string }>;
  const state = rows[0]?.s;
  if (!state) return null;
  if (table === 'crm_follow_ups') throw new Refused(`That follow-up is already ${state === 'done' ? 'completed' : state}.`);
  throw new Refused(state === 'stopped' ? 'That sequence has already stopped.' : `That sequence is ${state} — refresh and try again.`);
}

const run = async (actorId: string, fn: Parameters<typeof withUser>[1]): Promise<FollowUpWrite> => {
  try {
    const leadId = (await withUser(actorId, fn)) as string | null;
    return leadId ? { ok: true, leadId } : { ok: false, error: NOT_YOURS };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    const code = (error as { code?: string }).code;
    if (code === '23505') return { ok: false, error: 'This lead already has a sequence running. Stop it first.' };
    if (code === '23514') return { ok: false, error: 'That sequence has no steps to run.' };
    throw error;
  }
};

/* ── Follow-ups a person sets ───────────────────────────────────────────── */

export async function createFollowUp(
  actorId: string,
  input: {
    leadId: string;
    channel: 'whatsapp' | 'email' | 'call' | 'task';
    title: string;
    body: string | null;
    dueAt: string;
  },
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = await tx`
      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
      select l.id, 'custom', ${input.channel}::public.crm_followup_channel, 'remind_me',
             (case when ${input.dueAt}::timestamptz <= now() then 'due' else 'planned' end)::public.crm_followup_status,
             ${input.title}, ${input.body}, ${input.dueAt}::timestamptz,
             coalesce(l.owner_id, ${actorId}::uuid), ${actorId}::uuid
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning lead_id
    `;
    if ((rows as unknown[]).length === 0) return null;

    /* ⚠️ THE DESK'S "NEXT ACTION" FOLLOWS. A follow-up set for tomorrow while the
       row still reads "Quotation check-in — overdue" is a table that lies about
       what is owed. It takes over when there is no next action, when the
       current one is already late, or when this one comes sooner. */
    await tx`
      update public.crm_leads
         set next_action = ${input.title},
             next_action_at = ${input.dueAt}::timestamptz,
             next_action_type = ${input.channel}::public.crm_next_action_kind
       where id = ${input.leadId}::uuid
         and (next_action_at is null
              or next_action_at < now()
              or next_action_at > ${input.dueAt}::timestamptz)
    `;
    return input.leadId;
  });
}

/**
 * Close a follow-up — done, with what happened, or cancelled.
 *
 * ⚠️ IF IT WAS THE LEAD'S NEXT ACTION, THE NEXT OPEN ONE TAKES ITS PLACE — or
 * nothing does, and the desk shows "nothing planned", which is then true.
 */
export async function closeFollowUp(
  actorId: string,
  followUpId: string,
  outcome: { done: true; note: string | null } | { done: false },
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const closed = (await tx`
      update public.crm_follow_ups
         set status = ${outcome.done ? 'done' : 'cancelled'}::public.crm_followup_status,
             done_at = case when ${outcome.done} then now() else done_at end,
             done_by_id = case when ${outcome.done} then ${actorId}::uuid else done_by_id end,
             outcome_note = case when ${outcome.done} then ${outcome.done ? outcome.note : null} else outcome_note end,
             updated_at = now()
       where id = ${followUpId}::uuid
         and status in ('planned', 'due')
      returning lead_id, title
    `) as Array<{ lead_id: string; title: string }>;
    const row = closed[0];
    if (!row) return explainMiss(tx, 'crm_follow_ups', followUpId);

    await tx`
      update public.crm_leads l
         set next_action = nxt.title,
             next_action_at = nxt.due_at,
             next_action_type = nxt.channel::text::public.crm_next_action_kind
        from (select 1) one
        left join lateral (
          select o.title, o.due_at, o.channel
            from public.crm_follow_ups o
           where o.lead_id = ${row.lead_id}::uuid
             and o.id <> ${followUpId}::uuid
             and o.status in ('planned', 'due')
           order by o.due_at
           limit 1
        ) nxt on true
       where l.id = ${row.lead_id}::uuid
         and l.next_action is not distinct from ${row.title}
    `;
    return row.lead_id;
  });
}

/* ── Sequences ──────────────────────────────────────────────────────────── */

export async function pauseSequence(actorId: string, leadSequenceId: string, byName: string): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = 'paused', paused_at = now(), pause_reason = ${`paused by ${byName}`},
             next_step_at = null, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active')
      returning lead_id
    `) as Array<{ lead_id: string }>;
    return rows[0]?.lead_id ?? explainMiss(tx, 'crm_lead_sequences', leadSequenceId);
  });
}

/**
 * Resume at a chosen moment — which is what Reschedule means.
 *
 * ⚠️ `resumed_at` IS WHAT MAKES IT STICK (182). Without it, the reply that
 * paused the sequence would pause it again on the engine's next pass.
 *
 * ⚠️ AND IT ASKS THE ENGINE'S OWN STOP-CONDITIONS BEFORE COMMITTING. A lead that
 * has closed, a client who said no, a quotation that expired: resuming those
 * would be a promise the engine immediately breaks. The same function decides
 * both, so the button and the scheduler cannot disagree.
 */
export async function rescheduleSequence(
  actorId: string,
  leadSequenceId: string,
  at: string,
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = (case when current_step = 0 then 'scheduled' else 'active' end)::public.crm_sequence_state,
             paused_at = null, pause_reason = null, resumed_at = now(),
             next_step_at = ${at}::timestamptz, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active', 'paused')
         and current_step < total_steps
      returning lead_id
    `) as Array<{ lead_id: string }>;
    if (!rows[0]) return explainMiss(tx, 'crm_lead_sequences', leadSequenceId);

    const [{ reason }] = (await tx`
      select app.crm_sequence_stop_reason(${leadSequenceId}::uuid) as reason
    `) as Array<{ reason: string | null }>;
    if (reason) throw new Refused(`It cannot run — ${reason}.`);
    return rows[0].lead_id;
  });
}

export async function stopSequence(actorId: string, leadSequenceId: string, byName: string): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      update public.crm_lead_sequences
         set state = 'stopped', stopped_at = now(), paused_at = null,
             pause_reason = ${`stopped by ${byName}`}, next_step_at = null, updated_at = now()
       where id = ${leadSequenceId}::uuid
         and state in ('scheduled', 'active', 'paused')
      returning lead_id
    `) as Array<{ lead_id: string }>;
    if (!rows[0]) return explainMiss(tx, 'crm_lead_sequences', leadSequenceId);

    /* ⚠️ WHAT IT HAD ALREADY QUEUED GOES TOO. A stopped chase whose next message
       is still sitting in the queue marked auto-send is not stopped. */
    await tx`
      update public.crm_follow_ups
         set status = 'cancelled', updated_at = now()
       where lead_sequence_id = ${leadSequenceId}::uuid
         and status in ('planned', 'due')
    `;
    return rows[0].lead_id;
  });
}

/**
 * Put a lead on a sequence.
 *
 * ⚠️ ONE LIVE SEQUENCE PER LEAD is the database's rule (a unique index), not
 * this function's — two chases on one client is exactly what it prevents.
 * ⚠️ A QUOTATION SEQUENCE IS TIED TO THE LIVE QUOTATION, so 170 stops it the
 * moment that quotation expires or is superseded.
 */
export async function startSequence(
  actorId: string,
  input: { leadId: string; sequenceId: string; firstAt: string | null },
): Promise<FollowUpWrite> {
  return run(actorId, async (tx) => {
    const rows = (await tx`
      insert into public.crm_lead_sequences
        (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at,
         quotation_id, created_by_id)
      select l.id, s.id, 'scheduled', 0,
             (select count(*) from public.crm_sequence_steps st where st.sequence_id = s.id),
             now(),
             coalesce(${input.firstAt}::timestamptz,
                      now() + make_interval(days => coalesce((
                        select greatest(st.delay_days, 0) from public.crm_sequence_steps st
                         where st.sequence_id = s.id and st.step_no = 1), 0))),
             case when s.purpose = 'quotation' then (
               select q.id from public.crm_quotations q
                where q.lead_id = l.id and q.status in ('approved', 'sent', 'pending_approval')
                order by q.version desc, q.created_at desc
                limit 1)
             end,
             ${actorId}::uuid
        from public.crm_leads l
        join public.crm_sequences s
          on s.id = ${input.sequenceId}::uuid
         and s.is_active
         and (s.project_id is null or s.project_id = l.project_id)
       where l.id = ${input.leadId}::uuid
      returning id, lead_id
    `) as Array<{ id: string; lead_id: string }>;
    if (!rows[0]) return null;

    const [{ reason }] = (await tx`
      select app.crm_sequence_stop_reason(${rows[0].id}::uuid) as reason
    `) as Array<{ reason: string | null }>;
    if (reason) throw new Refused(`It cannot start — ${reason}.`);
    return rows[0].lead_id;
  });
}
