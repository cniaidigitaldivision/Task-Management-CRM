import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE FOLLOW-UPS PAGE — one query, everything the screen shows
 * ----------------------------------------------------------------------------
 * Owner's design, 2026-09-22: four cards (Due today, Overdue, Reply needed,
 * Active sequences), a queue with tabs, filters, and a details panel carrying
 * the message that will go out, the conditions that would stop it, and the
 * sequence it belongs to.
 *
 * ⚠️ ONE QUERY, FILTERED ON THE CLIENT (Rule Zero, law 3). Tabs, cards, search,
 * filters and saved views are all subsets of these rows; only a write reaches
 * the server again.
 *
 * ⚠️ MY QUEUE. `assigned_to_id = app.current_user_id()` on top of RLS: a
 * manager who can read the department still sees their own list here.
 *
 * ⚠️ WINDOWED (law 5): everything still open, plus 30 days of history, at most
 * 400 rows — and the screen says so.
 *
 * ⚠️ NO BACKTICKS IN THE SQL COMMENTS — this file is one template literal.
 * ========================================================================= */

export const BOARD_BACK_DAYS = 30;
export const BOARD_LIMIT = 400;

export interface BoardFollowUp {
  readonly id: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly leadPhone: string | null;
  readonly leadStage: string;
  readonly projectName: string | null;
  readonly purpose: string;
  readonly channel: string;
  /** auto_send · remind_me (234 retired review_first; old rows may still say it). */
  readonly mode: string;
  readonly status: string;
  readonly dueAt: string;
  readonly title: string;
  readonly body: string | null;
  readonly subject: string | null;
  readonly outcomeNote: string | null;
  readonly doneAt: string | null;
  readonly attempts: number;
  /** The approved template used when the 24-hour window is shut. */
  readonly templateName: string | null;
  /** Whether that window is open right now — free text goes, no template needed. */
  readonly windowOpen: boolean;
  readonly consent: boolean;
  readonly ownerName: string | null;
  readonly businessSender: string | null;

  /** The sequence this step belongs to, if any. */
  readonly sequenceRunId: string | null;
  readonly sequenceName: string | null;
  readonly sequenceState: string | null;
  readonly sequencePauseReason: string | null;
  readonly stepNo: number | null;
  readonly stepTotal: number | null;
  readonly stopOnReply: boolean;
  readonly stopOnVisit: boolean;
  readonly stopOnQuotationDead: boolean;
  /** Every step of that sequence, for the preview: day, channel, what it says. */
  readonly steps: ReadonlyArray<{ stepNo: number; day: number; channel: string; title: string }>;

  /** What this follow-up is about — a quotation, an appointment, or nothing. */
  readonly quotationId: string | null;
  readonly quotationNumber: string | null;
  readonly quotationStatus: string | null;
  readonly quotationValidUntil: string | null;
  readonly appointmentId: string | null;
  readonly appointmentRef: number | null;
  readonly appointmentAt: string | null;
  readonly propertyLabel: string | null;

  /** The last thing either side said, for "Recent conversation". */
  readonly lastMessageAt: string | null;
  readonly lastMessageBody: string | null;
  readonly lastMessageDirection: string | null;
  readonly lastMessageStatus: string | null;
  /** The client wrote last and nobody has answered. */
  readonly awaitingOurReply: boolean;
  /** We wrote last and the client has not answered. */
  readonly awaitingTheirReply: boolean;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function crmFollowUpBoard(actorId: string): Promise<BoardFollowUp[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select f.id, f.lead_id, f.purpose::text as purpose, f.channel::text as channel,
           f.mode::text as mode, f.status::text as status, f.due_at, f.title, f.body,
           f.outcome_note, f.done_at, f.attempts,
           coalesce(nullif(f.wa_template_name, ''), nullif(st.wa_template_name, '')) as template_name,
           st.subject,
           l.full_name as lead_name, l.phone_e164 as lead_phone, l.stage::text as lead_stage,
           l.whatsapp_consent is distinct from false as consent,
           app.crm_project_name(l.project_id) as project_name,
           (select u.full_name from public.users u where u.id = f.assigned_to_id) as owner_name,
           coalesce(nullif(btrim(s.whatsapp_display_name), ''), app.crm_project_name(l.project_id)) as business_sender,
           app.crm_window_is_open(f.lead_id) as window_open,

           ls.id as sequence_run_id, ls.state::text as sequence_state, ls.pause_reason,
           f.sequence_step_no as step_no, ls.total_steps as step_total,
           q.name as sequence_name,
           coalesce(q.stop_on_reply, true) as stop_on_reply,
           coalesce(q.stop_on_visit, true) as stop_on_visit,
           coalesce(q.stop_on_quotation_dead, true) as stop_on_quotation_dead,
           coalesce((
             select json_agg(json_build_object(
                      'stepNo', x.step_no, 'day', x.delay_days + 1,
                      'channel', x.channel::text,
                      'title', coalesce(nullif(x.title, ''), initcap(replace(x.purpose, '_', ' '))))
                    order by x.step_no)
               from public.crm_sequence_steps x where x.sequence_id = q.id), '[]'::json) as steps,

           quo.id as quotation_id, quo.number as quotation_number,
           quo.status::text as quotation_status, quo.valid_until,
           a.id as appointment_id, a.ref_no as appointment_ref, a.scheduled_at as appointment_at,
           (select nullif(concat_ws(', ', p.plot_number,
                     case when p.block is not null then 'Block ' || p.block end), '')
              from public.crm_properties p where p.id = coalesce(quo.property_id, a.property_id)) as property_label,

           m.occurred_at as last_message_at, m.body as last_message_body,
           m.direction::text as last_message_direction, m.status::text as last_message_status
      from public.crm_follow_ups f
      join public.crm_leads l on l.id = f.lead_id
      left join public.crm_project_settings s on s.project_id = l.project_id
      left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
      left join public.crm_sequences q on q.id = ls.sequence_id
      left join public.crm_sequence_steps st
             on st.sequence_id = q.id and st.step_no = f.sequence_step_no
      left join public.crm_appointments a on a.id = f.appointment_id
      left join lateral (
        select x.id, x.number, x.status, x.valid_until, x.property_id
          from public.crm_quotations x
         where x.lead_id = f.lead_id
           and x.status::text not in ('superseded', 'rejected', 'expired')
         order by x.created_at desc
         limit 1
      ) quo on true
      left join lateral (
        select x.occurred_at, x.body, x.direction, x.status
          from public.crm_lead_messages x
         where x.lead_id = f.lead_id and x.hidden_at is null
         order by x.occurred_at desc
         limit 1
      ) m on true
     where f.assigned_to_id = app.current_user_id()
       and (
         f.status in ('planned', 'due')
         or f.updated_at >= now() - make_interval(days => ${BOARD_BACK_DAYS})
       )
     order by f.due_at
     limit ${BOARD_LIMIT}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => {
    const direction = (r.last_message_direction as string | null) ?? null;
    return {
      id: String(r.id),
      leadId: String(r.lead_id),
      leadName: (r.lead_name as string | null) ?? null,
      leadPhone: (r.lead_phone as string | null) ?? null,
      leadStage: String(r.lead_stage ?? 'new'),
      projectName: (r.project_name as string | null) ?? null,
      purpose: String(r.purpose),
      channel: String(r.channel),
      mode: String(r.mode),
      status: String(r.status),
      dueAt: new Date(r.due_at as string).toISOString(),
      title: String(r.title ?? ''),
      body: (r.body as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      outcomeNote: (r.outcome_note as string | null) ?? null,
      doneAt: iso(r.done_at),
      attempts: Number(r.attempts ?? 0),
      templateName: (r.template_name as string | null) ?? null,
      windowOpen: Boolean(r.window_open),
      consent: Boolean(r.consent),
      ownerName: (r.owner_name as string | null) ?? null,
      businessSender: (r.business_sender as string | null) ?? null,

      sequenceRunId: (r.sequence_run_id as string | null) ?? null,
      sequenceName: (r.sequence_name as string | null) ?? null,
      sequenceState: (r.sequence_state as string | null) ?? null,
      sequencePauseReason: (r.pause_reason as string | null) ?? null,
      stepNo: r.step_no === null || r.step_no === undefined ? null : Number(r.step_no),
      stepTotal: r.step_total === null || r.step_total === undefined ? null : Number(r.step_total),
      stopOnReply: Boolean(r.stop_on_reply),
      stopOnVisit: Boolean(r.stop_on_visit),
      stopOnQuotationDead: Boolean(r.stop_on_quotation_dead),
      steps: (Array.isArray(r.steps) ? r.steps : []) as BoardFollowUp['steps'],

      quotationId: (r.quotation_id as string | null) ?? null,
      quotationNumber: (r.quotation_number as string | null) ?? null,
      quotationStatus: (r.quotation_status as string | null) ?? null,
      quotationValidUntil: iso(r.valid_until),
      appointmentId: (r.appointment_id as string | null) ?? null,
      appointmentRef: r.appointment_ref === null || r.appointment_ref === undefined ? null : Number(r.appointment_ref),
      appointmentAt: iso(r.appointment_at),
      propertyLabel: (r.property_label as string | null) ?? null,

      lastMessageAt: iso(r.last_message_at),
      lastMessageBody: (r.last_message_body as string | null) ?? null,
      lastMessageDirection: direction,
      lastMessageStatus: (r.last_message_status as string | null) ?? null,
      awaitingOurReply: direction === 'inbound',
      awaitingTheirReply: direction === 'outbound',
    };
  });
}

/** Every sequence still running for this person — the "Active sequences" card and tab. */
export interface BoardSequence {
  readonly id: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly projectName: string | null;
  readonly name: string;
  readonly purpose: string;
  readonly state: string;
  readonly step: number;
  readonly total: number;
  readonly startedAt: string;
  readonly nextStepAt: string | null;
  readonly pauseReason: string | null;
}

export async function crmFollowUpSequences(actorId: string): Promise<BoardSequence[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select ls.id, ls.lead_id, ls.state::text as state, ls.current_step, ls.total_steps,
           ls.started_at, ls.next_step_at, ls.pause_reason,
           q.name, q.purpose::text as purpose,
           l.full_name as lead_name, app.crm_project_name(l.project_id) as project_name
      from public.crm_lead_sequences ls
      join public.crm_sequences q on q.id = ls.sequence_id
      join public.crm_leads l on l.id = ls.lead_id
     where l.owner_id = app.current_user_id()
       and ls.state in ('scheduled', 'active', 'paused')
     order by ls.next_step_at nulls last, ls.started_at desc
     limit 200
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    projectName: (r.project_name as string | null) ?? null,
    name: String(r.name),
    purpose: String(r.purpose),
    state: String(r.state),
    step: Number(r.current_step ?? 0),
    total: Number(r.total_steps ?? 0),
    startedAt: new Date(r.started_at as string).toISOString(),
    nextStepAt: iso(r.next_step_at),
    pauseReason: (r.pause_reason as string | null) ?? null,
  }));
}

/* ============================================================================
 * THE THREE WRITES THIS PAGE ADDS
 * ----------------------------------------------------------------------------
 * Completing, cancelling, pausing and stopping a sequence already have their
 * own actions and are reused. What the queue needs on top is: edit the words
 * before they go, move one step to another time, and send one now.
 *
 * ⚠️ RLS DECIDES (153's policies); each of these also refuses a row that is no
 * longer open, so a step somebody else has just sent cannot be edited or sent
 * twice from a stale screen.
 * ========================================================================= */

/** Edit the message a follow-up will send. */
export async function crmSetFollowUpBody(actorId: string, id: string, body: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_follow_ups
       set body = ${body}, updated_at = now()
     where id = ${id}::uuid and status in ('planned', 'due')
     returning id
  `);
  return (rows as unknown[]).length > 0;
}

/** Move one step to another time. */
export async function crmRescheduleFollowUp(actorId: string, id: string, at: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_follow_ups
       set due_at = ${at}::timestamptz,
           status = (case when ${at}::timestamptz <= now() then 'due' else 'planned' end)::public.crm_followup_status,
           updated_at = now()
     where id = ${id}::uuid and status in ('planned', 'due')
     returning id
  `);
  return (rows as unknown[]).length > 0;
}

/**
 * Make a step due right now, so the sender takes it on this run.
 *
 * ⚠️ IT DOES NOT SEND. `runDueFollowUps` does, under the same rules as every
 * other step — the window, the template, the client's consent. This only moves
 * the clock, which is the honest way to say "go now" without building a second
 * sending path that could disagree with the first.
 */
export async function crmMakeFollowUpDue(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_follow_ups
       set due_at = now(), status = 'due'::public.crm_followup_status, updated_at = now()
     where id = ${id}::uuid
       and status in ('planned', 'due')
       and mode = 'auto_send'
       and channel in ('whatsapp', 'email')
     returning id
  `);
  return (rows as unknown[]).length > 0;
}
