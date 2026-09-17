-- ============================================================================
-- 192 · THE MACHINE MAY SEND WHAT A PERSON MAY — no more, and no less
-- ----------------------------------------------------------------------------
-- 188's queue refused any WhatsApp step unless `crm_leads.whatsapp_consent` was
-- explicitly TRUE. Written as a guardrail; found the same evening to be a trap:
--
--   ⚠️ NOTHING IN THE PRODUCT EVER SETS THAT COLUMN. No screen, no action, no
--   import — checked across the whole tree. It is NULL on all 652 leads. So
--   "Auto-send" on WhatsApp could never have sent anything, on any lead, ever,
--   and the only symptom would have been silence: a plan that looked right,
--   said "Sent automatically" on screen, and quietly did nothing for days.
--
-- ── THE RULE, AND WHOSE DECISION IT IS ─────────────────────────────────────
-- A lead in this CRM arrived by giving their number to this business — a Meta
-- lead form, or somebody typing in an enquiry they made. That is the same basis
-- on which a salesperson already messages them by hand, today, from this app.
-- The owner asked for these follow-ups to send themselves; the machine now
-- works to the SAME line as the person: send unless they have said no.
--
-- ⚠️ `is false` STILL STOPS EVERYTHING, in the queue and in
-- `crm_sequence_stop_reason`. A stated no is absolute and is not a preference
-- any plan can override.
--
-- ⚠️ AND THE 24-HOUR WINDOW IS UNTOUCHED. Free text still only goes inside it;
-- outside it only a template Meta approved. That is WhatsApp's rule, not ours,
-- and it is the one that would reach a real customer wrongly.
-- ============================================================================

drop function if exists app.crm_followups_to_send(integer);

create function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid,
  lead_id uuid,
  project_id uuid,
  lead_sequence_id uuid,
  owner_id uuid,
  channel text,
  title text,
  body text,
  subject text,
  lead_name text,
  to_phone text,
  to_email text,
  template_name text,
  template_language text,
  document_ids uuid[],
  window_open boolean,
  wa_phone_number_id text,
  sender_name text,
  project_name text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         nullif(st.wa_template_name, ''), coalesce(nullif(st.wa_template_language, ''), 'en'),
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   where f.status = 'due'
     and f.mode = 'auto_send'
     and f.due_at <= now()
     and l.stage not in ('won', 'lost')
     /* Every stop-condition, asked again at the moment of sending. */
     and (f.lead_sequence_id is null or app.crm_sequence_stop_reason(f.lead_sequence_id) is null)
     and (
       (f.channel = 'whatsapp'
        and l.phone_e164 is not null
        and p.whatsapp_phone_number_id is not null
        /* ⚠️ A STATED NO STOPS IT. NULL means nobody has ever asked, which is
           where every lead in this database stands — see the header. */
        and l.whatsapp_consent is distinct from false
        /* ⚠️ AND WHATSAPP'S OWN RULE, WHICH IS NOT OURS TO RELAX: free text only
           inside the 24-hour window; outside it, only an approved template. */
        and (app.crm_window_is_open(f.lead_id) or nullif(st.wa_template_name, '') is not null))
       or (f.channel = 'email' and l.email is not null)
     )
   order by f.due_at
   limit greatest(1, least(p_limit, 100))
$fn$;

comment on function app.crm_followups_to_send(integer) is
  'What a scheduled sender may deliver right now. Re-asks every stop-condition, refuses a stated no, and refuses free text outside the 24-hour window. 187, widened in 188, corrected in 192.';

revoke all on function app.crm_followups_to_send(integer) from public;
grant execute on function app.crm_followups_to_send(integer) to cni_app;

-- ============================================================================
-- SELF-CHECK — ⚠️ THE EXACT CASE THAT WAS BROKEN: a lead nobody has asked
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_fu uuid;
  n_null int; n_false int; n_outside int;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
   where l.project_id = v_project and l.is_test_data and l.phone_e164 is not null
     and l.stage not in ('won', 'lost')
   limit 1;
  if v_lead is null then
    raise exception '192 · no demo lead with a number — refusing to skip the check';
  end if;

  begin
    update public.crm_leads set whatsapp_consent = null where id = v_lead;
    /* An inbound message inside the window, so free text is allowed. */
    insert into public.crm_lead_messages (lead_id, direction, kind, body, status, created_at)
    values (v_lead, 'inbound', 'text', '192', 'delivered', now());

    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'due', 'SELFCHECK-192', 'Hello.', now(), v_sales, v_sales)
    returning id into v_fu;

    select count(*) into n_null from app.crm_followups_to_send(50) q where q.follow_up_id = v_fu;

    update public.crm_leads set whatsapp_consent = false where id = v_lead;
    select count(*) into n_false from app.crm_followups_to_send(50) q where q.follow_up_id = v_fu;

    /* Outside the window with no template: still refused, consent or not.
       ⚠️ EVERY INBOUND MOVES, not just the one this check wrote — the demo lead
       carries seeded messages and one of them inside 24 hours would hold the
       window open and make this check pass for the wrong reason. */
    update public.crm_leads set whatsapp_consent = true where id = v_lead;
    update public.crm_lead_messages set created_at = now() - interval '30 hours'
     where lead_id = v_lead and direction = 'inbound';
    select count(*) into n_outside from app.crm_followups_to_send(50) q where q.follow_up_id = v_fu;

    raise exception using errcode = 'P0192', message = '192 rollback';
  exception when sqlstate 'P0192' then
    null;
  end;

  if n_null <> 1 then
    raise exception '192 · a lead nobody has asked is still refused — auto-send would do nothing on every lead';
  end if;
  if n_false <> 0 then
    raise exception '192 · a stated no did not stop the machine';
  end if;
  if n_outside <> 0 then
    raise exception '192 · free text was offered outside the 24-hour window';
  end if;
  if exists (select 1 from public.crm_follow_ups where title = 'SELFCHECK-192') then
    raise exception '192 · the self-check left rows behind';
  end if;

  raise notice '192 · the machine sends where a person may: a stated no stops it, an unasked lead does not, and the 24-hour window still rules free text';
end $chk$;
