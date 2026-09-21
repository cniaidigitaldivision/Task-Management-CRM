-- ============================================================================
-- 234 · NO FOLLOW-UP WAITS FOR REVIEW
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21:
--
--   *"Please make sure that no follow-up is put in the review. If I am
--   scheduling any follow-up it means that I have reviewed it and I am
--   intentionally putting that follow-up. Don't put any follow-up in the review
--   furthermore."*
--
-- Three things put a follow-up in review, and all three stop here:
--
--   1 · THE PLAN ENGINE (crm_advance_sequences) turned a WhatsApp step with no
--       template into review_first whenever the client had not written for 24
--       hours. It now queues it as auto_send.
--   2 · THE QUEUE (crm_followups_to_send) would not hand such a step to the
--       sender at all. It now does, with the step's PURPOSE, and the sender
--       picks the approved template for that purpose when it goes
--       (lib/crm/followup-sender.ts — templateForPurpose, the same picker the
--       wizard uses). If no approved template fits, the step FAILS with the
--       reason and the owner is told — it is never parked as a draft.
--   3 · THE SCREENS — the wizard's "Draft for me to send", the single
--       follow-up's own downgrade, and the manager's quotation-request task —
--       are changed in the same commit.
--
-- ⚠️ WHAT IS ALREADY WAITING IS CONVERTED, not left behind. Every open
-- review_first follow-up on WhatsApp or email becomes auto_send and goes on the
-- sender's next run; one on a call or a task becomes the reminder it really is.
-- Every plan step saved as review_first becomes auto_send the same way.
-- ============================================================================

/* ── 1 · The plan engine queues auto-send, never review ─────────────── */
CREATE OR REPLACE FUNCTION app.crm_advance_sequences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  r          record;
  v_step     record;
  v_next     record;
  v_stop     text;
  v_settings record;
  v_slot     timestamptz;
  v_when     timestamptz;
  v_mode     public.crm_followup_mode;
  v_title    text;
  v_replied  boolean;
  v_sent     integer;
  n_queued   integer := 0;
begin
  for r in
    select ls.id, ls.lead_id, ls.sequence_id, ls.current_step, ls.total_steps,
           ls.started_at, ls.resumed_at,
           s.send_from_hour, s.send_to_hour, s.send_days,
           l.project_id, l.owner_id
      from public.crm_lead_sequences ls
      join public.crm_sequences s on s.id = ls.sequence_id
      join public.crm_leads l on l.id = ls.lead_id
     where ls.state in ('scheduled', 'active')
       and ls.next_step_at is not null
       and ls.next_step_at <= now()
     order by ls.next_step_at
     limit 200
  loop
    /* 208 · the settle is one function now, shared with the inbound webhook. */
    v_stop := app.crm_sequence_settle(r.id);
    if v_stop is not null then
      continue;
    end if;

    select * into v_step
      from public.crm_sequence_steps
     where sequence_id = r.sequence_id
       and step_no = r.current_step + 1
     limit 1;

    if not found then
      update public.crm_lead_sequences
         set state = 'stopped', stopped_at = now(),
             pause_reason = 'every step has been sent',
             next_step_at = null, updated_at = now()
       where id = r.id;

      /* ── EVERY STEP SENT AND NOT A WORD BACK: PARK IT — 206 ─────────────── */
      v_replied := exists (
        select 1 from public.crm_lead_messages m
         where m.lead_id = r.lead_id
           and m.direction = 'inbound'
           and m.occurred_at >= coalesce(r.resumed_at, r.started_at));

      select count(*) into v_sent
        from public.crm_follow_ups f
       where f.lead_sequence_id = r.id
         and f.status = 'done';

      if not v_replied and v_sent > 0 then
        update public.crm_leads
           set stage = 'nurture',
               next_action = null,
               next_action_at = null,
               next_action_type = null
         where id = r.lead_id
           and stage not in ('won', 'lost', 'nurture');

        if found then
          insert into public.crm_lead_notes (lead_id, author_id, body)
          values (
            r.lead_id, r.owner_id,
            'Moved to Nurture automatically — ' || v_sent ||
            ' follow-up' || case when v_sent = 1 then '' else 's' end ||
            ' sent and no reply. The lead is parked, not lost: nothing was refused, so it can be picked up again at any time.');
        end if;
      end if;

      continue;
    end if;

    /* ── BUSINESS HOURS FIRST. Nothing is dropped. ───────────────────────── */
    select * into v_settings from public.crm_project_settings where project_id = r.project_id;
    v_slot := app.crm_next_send_slot(
      now(), r.send_from_hour, r.send_to_hour, r.send_days,
      v_settings.sla_night_from, v_settings.sla_night_to);
    if v_slot > now() + interval '1 minute' then
      update public.crm_lead_sequences set next_step_at = v_slot, updated_at = now() where id = r.id;
      continue;
    end if;

    /* ── ONE CHASE PER LEAD PER DAY ─────────────────────────────────────── */
    if exists (
      select 1 from public.crm_follow_ups f
       where f.lead_id = r.lead_id
         and f.lead_sequence_id is not null
         and (f.created_at at time zone 'Asia/Karachi')::date
             = (now() at time zone 'Asia/Karachi')::date
    ) then
      update public.crm_lead_sequences
         set next_step_at = now() + interval '1 day', updated_at = now()
       where id = r.id;
      continue;
    end if;

    v_replied := exists (
      select 1 from public.crm_lead_messages m
       where m.lead_id = r.lead_id
         and m.direction = 'inbound'
         and m.created_at >= coalesce(r.resumed_at, r.started_at));

    v_title := coalesce(nullif(v_step.title, ''),
                        coalesce(nullif(v_step.purpose, ''), 'Follow up') || ' · step ' || v_step.step_no);

    if v_step.only_if_no_reply and v_replied then
      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at,
         lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id, outcome_note)
      values (
        r.lead_id,
        coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
        v_step.channel, 'remind_me', 'skipped', v_title, v_step.body, now(),
        r.id, v_step.step_no, r.owner_id, r.owner_id,
        'Skipped — the client had already replied');
    else
      /* 234 · NOTHING IS HANDED BACK FOR REVIEW. A closed window used to turn
         a template-less WhatsApp step into a draft for a person; the sender now
         sends the approved template for the step's purpose instead. A call or
         a task is a reminder, as it always was. */
      v_mode := case
        when v_step.channel not in ('whatsapp', 'email') then 'remind_me'
        when v_step.mode = 'remind_me' then 'remind_me'
        else 'auto_send'
      end::public.crm_followup_mode;

      insert into public.crm_follow_ups
        (lead_id, purpose, channel, mode, status, title, body, due_at,
         lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
      values (
        r.lead_id,
        coalesce(nullif(v_step.purpose, '')::public.crm_followup_purpose, 'no_response'),
        v_step.channel, v_mode, 'due', v_title, v_step.body, now(),
        r.id, v_step.step_no, r.owner_id, r.owner_id);

      if v_mode <> 'auto_send' then
        update public.crm_leads
           set next_action = v_title,
               next_action_at = now(),
               next_action_type = v_step.channel::text::public.crm_next_action_kind
         where id = r.lead_id
           and (next_action_at is null or next_action_at < now());
      end if;
    end if;

    /* ── WHEN THE NEXT STEP FALLS — 207 ─────────────────────────────────────
       The day comes from its delay; the HOUR comes from the step itself when
       somebody chose one. */
    select * into v_next
      from public.crm_sequence_steps
     where sequence_id = r.sequence_id and step_no = v_step.step_no + 1
     limit 1;

    if found then
      v_when := now() + make_interval(days => greatest(v_next.delay_days, 0));

      if v_next.send_at_time is not null then
        /* ⚠️ THE DATE IN KARACHI, THE TIME ON IT, BACK TO AN INSTANT. */
        v_when := ((v_when at time zone 'Asia/Karachi')::date + v_next.send_at_time)
                    at time zone 'Asia/Karachi';

        if v_when < now() then
          v_when := v_when + interval '1 day';
        end if;
      end if;

      update public.crm_lead_sequences
         set state = 'active',
             current_step = v_step.step_no,
             started_at = coalesce(started_at, now()),
             next_step_at = app.crm_next_send_slot(
               v_when, r.send_from_hour, r.send_to_hour, r.send_days,
               v_settings.sla_night_from, v_settings.sla_night_to),
             updated_at = now()
       where id = r.id;
    else
      update public.crm_lead_sequences
         set state = 'active',
             current_step = v_step.step_no,
             started_at = coalesce(started_at, now()),
             next_step_at = null,
             updated_at = now()
       where id = r.id;
    end if;

    n_queued := n_queued + 1;
  end loop;

  return n_queued;
end;
$function$;

/* ── 2 · The queue hands over every auto-send step, with its purpose ─────── */
drop function if exists app.crm_followups_to_send(integer);

create function app.crm_followups_to_send(p_limit integer default 25)
returns table(follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
              channel text, title text, body text, subject text, lead_name text, to_phone text,
              to_email text, template_name text, template_language text, template_vars text[],
              template_values text[], document_ids uuid[], window_open boolean,
              wa_phone_number_id text, sender_name text, project_name text, purpose text)
language sql
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
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          and (
            /* 234 · no longer "window open or a template on the row": a step
               without one is sent with the approved template for its purpose,
               chosen by the sender when it goes. */
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             and l.whatsapp_consent is distinct from false)
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
         coalesce(nullif(f.wa_template_name, ''), nullif(st.wa_template_name, '')),
         coalesce(nullif(f.wa_template_language, ''), nullif(st.wa_template_language, ''), 'en'),
         /* 228 · the follow-up's own list, then the step's. */
         coalesce(f.wa_template_vars, st.wa_template_vars),
         f.wa_template_values,
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name,
         f.purpose::text
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

grant execute on function app.crm_followups_to_send(integer) to cni_app;

/* ── 3 · What is already waiting ──────────────────────────────────────── */
update public.crm_sequence_steps
   set mode = (case when channel in ('whatsapp', 'email') then 'auto_send' else 'remind_me' end)::public.crm_followup_mode
 where mode = 'review_first';

update public.crm_follow_ups
   set mode = (case when channel in ('whatsapp', 'email') then 'auto_send' else 'remind_me' end)::public.crm_followup_mode,
       updated_at = now()
 where mode = 'review_first'
   and status in ('planned', 'due');

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  n_fn int; n_rows int; n_steps int; v_lead uuid; v_owner uuid; v_test uuid; n_handed int := -1;
begin
  /* Nothing in the database can write review_first any more. */
  select count(*) into n_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prosrc like '%''review_first''%';
  if n_fn > 0 then
    raise exception '234 · % function(s) can still put a follow-up in review', n_fn using errcode = 'CR234';
  end if;

  select count(*) into n_rows from public.crm_follow_ups where mode = 'review_first' and status in ('planned', 'due');
  select count(*) into n_steps from public.crm_sequence_steps where mode = 'review_first';
  if n_rows > 0 or n_steps > 0 then
    raise exception '234 · still waiting for review: % follow-ups, % plan steps', n_rows, n_steps using errcode = 'CR234';
  end if;

  /* A WhatsApp auto-send step with NO template, on a lead whose window is shut,
     reaches the sender — and carries its purpose. Written and read inside a
     block that is rolled back, so nothing real is claimed or left behind. */
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]'
     and p.whatsapp_phone_number_id is not null
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
     and not app.crm_window_is_open(l.id)
   limit 1;
  if v_lead is null then
    raise exception '234 · no closed-window demo lead to check the queue with' using errcode = 'CR234';
  end if;

  begin
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'due', '234 check', 'check', now() - interval '1 minute',
            v_owner, v_owner)
    returning id into v_test;

    select count(*) into n_handed
      from app.crm_followups_to_send(100) q
     where q.follow_up_id = v_test and q.purpose = 'no_response' and q.template_name is null and not q.window_open;

    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if n_handed <> 1 then
    raise exception '234 · a template-less step on a closed window was not handed to the sender (%)', n_handed using errcode = 'CR234';
  end if;
  if exists (select 1 from public.crm_follow_ups where title = '234 check') then
    raise exception '234 · the check row was left behind' using errcode = 'CR234';
  end if;

  raise notice '234 · ✓ nothing can put a follow-up in review, nothing is waiting in review, and a template-less step on a closed window goes to the sender with its purpose';
end
$chk$;
