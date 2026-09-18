-- ============================================================================
-- 204 · 1 PM MEANS 1 PM — a minute's granularity, and no two senders at once
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18: *"I have set a time of 1 pm, but I received it at 1:03."*
--
-- Three minutes of that was 202's half-fix and 203 closed it. But the owner is
-- pointing at something the design still gets wrong, and they are right:
--
-- ⚠️ THE SENDER RAN EVERY FIVE MINUTES, so a follow-up set for 1:03 would have
-- waited until 1:05 however perfectly everything else worked. A person choosing
-- a time to the minute — which the picker lets them do — was quietly being given
-- a five-minute window instead. 1:00 happened to align with the beat; 1:03 would
-- not have.
--
-- So the sender now runs EVERY MINUTE. Which forces the question that
-- five minutes was hiding:
--
-- ── ⚠️ WHAT IF ONE RUN IS STILL GOING WHEN THE NEXT STARTS? ────────────────
-- Today's 13:00 request timed out after **120 seconds** (`pg_net`'s ceiling)
-- while the run itself kept working. At one-minute beats that is two runners
-- alive at once — and `sendOne` sends to Meta BEFORE it settles the row, so both
-- would read the same row from the queue and **both would message the client**.
-- Settling twice is already refused (203), so the second would be recorded as a
-- failure — the client would still have received the message twice.
--
-- A queue that hands the same row to two workers is not a queue. So this one
-- CLAIMS: reading the queue marks each row taken, in the same statement, and a
-- second runner sees nothing.
--
-- ⚠️ AND A CLAIM EXPIRES, or one crashed run would strand a follow-up for ever.
-- Five minutes is far longer than any real send and far shorter than a person
-- would notice.
--
-- ⚠️ AND THE JOBS STOP ARRIVING ALL AT ONCE. Five of the seven fired at minute
-- 0 together — the sender, the sequence advancer, the SLA sweep, the lead sync
-- and the hourly follow-up job — which is what starved the request that timed
-- out. They are spread across the minute now. Nothing about their meaning
-- changes; they simply stop queueing behind each other.
-- ============================================================================

alter table public.crm_follow_ups
  /* When a sender took this row. Null means nobody holds it. */
  add column if not exists claimed_at timestamptz;

comment on column public.crm_follow_ups.claimed_at is
  '204 · when a sender claimed this row. Stops two overlapping runs messaging one client twice.';

create index if not exists crm_follow_ups_claim_idx
  on public.crm_follow_ups (status, due_at)
  where mode = 'auto_send';

/**
 * The queue — and taking from it is taking, not looking.
 *
 * ⚠️ `VOLATILE`, AND IT WRITES. It was `STABLE` when it only read. A function
 * that hands out work has to record that it did, or it is a race with extra
 * steps.
 *
 * ⚠️ `for update skip locked` ON THE INNER SELECT. Two runners arriving in the
 * same instant would otherwise both pass the `claimed_at is null` test before
 * either wrote. `skip locked` makes the second step over the row rather than
 * wait for it, which is what a queue wants and what a lock alone would not give.
 */
create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
  channel text, title text, body text, subject text, lead_name text, to_phone text, to_email text,
  template_name text, template_language text, document_ids uuid[], window_open boolean,
  wa_phone_number_id text, sender_name text, project_name text
)
language sql
volatile
security definer
set search_path = public, app, pg_temp
as $fn$
  with claimed as (
    update public.crm_follow_ups f
       set claimed_at = now()
     where f.id in (
       select c.id
         from public.crm_follow_ups c
         join public.crm_leads l on l.id = c.lead_id
         join public.projects p on p.id = l.project_id
         left join public.crm_lead_sequences ls on ls.id = c.lead_sequence_id
         left join public.crm_sequence_steps st
                on st.sequence_id = ls.sequence_id and st.step_no = c.sequence_step_no
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          /* ⚠️ NOBODY HOLDS IT, or whoever did has been gone five minutes. */
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          and (
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             /* ⚠️ A STATED NO STOPS IT. NULL means nobody has ever asked (192). */
             and l.whatsapp_consent is distinct from false
             /* ⚠️ WHATSAPP'S OWN RULE: free text only inside the 24-hour window;
                outside it, only an approved template. */
             and (app.crm_window_is_open(c.lead_id) or nullif(st.wa_template_name, '') is not null))
            or (c.channel = 'email' and l.email is not null)
          )
        order by c.due_at
        limit greatest(1, least(p_limit, 100))
        for update of c skip locked
     )
    returning f.id
  )
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         nullif(st.wa_template_name, ''), coalesce(nullif(st.wa_template_language, ''), 'en'),
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
    from claimed
    join public.crm_follow_ups f on f.id = claimed.id
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   order by f.due_at
$fn$;

comment on function app.crm_followups_to_send(integer) is
  'Claims and returns what the sender should send now. 187, widened in 202, claim added in 204.';

/* ⚠️ AND A SETTLED ROW RELEASES ITS CLAIM, so a failed send can be retried by
   hand without waiting five minutes for the claim to lapse. */
create or replace function app.crm_followup_sent(p_follow_up uuid, p_message_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  n integer;
begin
  update public.crm_follow_ups
     set status = case when p_error is null then 'done' else 'failed' end::public.crm_followup_status,
         done_at = case when p_error is null then now() end,
         outcome_note = coalesce(p_error, 'Sent automatically' ||
                                 case when p_message_id is null then '' else ' · ' || p_message_id end),
         claimed_at = null,
         updated_at = now()
   where id = p_follow_up
     /* ⚠️ THE SAME QUESTION THE QUEUE ASKED (203), so a row that was offered can
        always be settled — and only once. */
     and app.crm_followup_is_due(id);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

-- ============================================================================
-- THE TIMETABLE — every minute, and nothing arriving in a crowd
-- ============================================================================
select cron.schedule('crm-followup-sender', '* * * * *', $$ select app.trigger_crm_followup_sender(); $$);

/* ⚠️ SPREAD ACROSS THE MINUTE. Five jobs fired at minute 0 together and one of
   them timed out at 120 s today. Their meaning is unchanged; they simply stop
   queueing behind each other. */
select cron.schedule('crm-lead-sync',    '2,17,32,47 * * * *', (select command from cron.job where jobname = 'crm-lead-sync'));
select cron.schedule('crm-sequences',    '4,19,34,49 * * * *', (select command from cron.job where jobname = 'crm-sequences'));
select cron.schedule('crm-sla-breaches', '6,21,36,51 * * * *', (select command from cron.job where jobname = 'crm-sla-breaches'));
select cron.schedule('crm-follow-ups',   '8 3-14 * * *',       (select command from cron.job where jobname = 'crm-follow-ups'));

-- ============================================================================
-- SELF-CHECK — a claimed row is invisible to the next runner
-- ============================================================================
do $chk$
declare
  v_project uuid; v_lead uuid; v_owner uuid; v_id uuid;
  n_first int := -1; n_second int := -1; n_after_settle int := -1; n_stale int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.whatsapp_phone_number_id is not null limit 1;

  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
   where l.project_id = v_project
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
     and app.crm_window_is_open(l.id)
   limit 1;
  if v_lead is null then
    raise exception '204 · no lead with an open window — the claim could not be proved';
  end if;

  begin
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'planned',
            'SELFCHECK-204', 'body', now() - interval '1 minute', v_owner, v_owner)
    returning id into v_id;

    /* 1 · The first runner takes it. */
    select count(*)::int into n_first from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;
    /* 2 · ⚠️ THE SECOND SEES NOTHING. This is the whole point: without it both
       would message the client. */
    select count(*)::int into n_second from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    /* 3 · A claim older than five minutes is nobody's — a crashed run must not
       strand a follow-up for ever. */
    update public.crm_follow_ups set claimed_at = now() - interval '6 minutes' where id = v_id;
    select count(*)::int into n_stale from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    /* 4 · And once settled it is gone from the queue whatever the claim says. */
    perform app.crm_followup_sent(v_id, 'wamid.selfcheck-204', null);
    select count(*)::int into n_after_settle from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    raise exception using errcode = 'P0204', message = '204 rollback';
  exception when sqlstate 'P0204' then
    null;
  end;

  if n_first <> 1 then raise exception '204 · the queue did not offer a due auto-send'; end if;
  if n_second <> 0 then
    raise exception '204 · a claimed follow-up was offered twice — a client would be messaged twice';
  end if;
  if n_stale <> 1 then raise exception '204 · a stale claim was never released'; end if;
  if n_after_settle <> 0 then raise exception '204 · a settled follow-up is still in the queue'; end if;

  raise notice '204 ✓ claimed once, invisible to the next runner, stale claims reclaimed, settled rows gone';
end $chk$;
