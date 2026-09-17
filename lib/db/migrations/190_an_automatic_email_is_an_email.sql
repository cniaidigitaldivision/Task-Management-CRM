-- ============================================================================
-- 190 · AN AUTOMATIC EMAIL IS AN EMAIL, NOT A WHATSAPP MESSAGE
-- ----------------------------------------------------------------------------
-- Found the first time the sender actually sent something (2026-09-17). 187's
-- `app.crm_record_sequence_message` wrote every provider id into
-- `wa_message_id`, whatever the channel, and 175's constraint refused it:
--
--     new row for relation "crm_lead_messages" violates check constraint
--     "crm_lead_messages_ids_match_channel"
--
-- ⚠️ AND THE FAILURE WAS WORSE THAN A REFUSED INSERT. The send happens first,
-- then one transaction settled the follow-up AND wrote the thread row — so the
-- constraint rolled back the settle too. The email had gone, the step was still
-- `due`, and the next run would have sent the same letter to the same client
-- again, every fifteen minutes, for ever. **A duplicate-send loop.**
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- 1 · The id goes in the column its channel owns.
-- 2 · The function SETTLES FIRST and writes the thread row second, in its own
--     statement, so a thread that cannot be written can never un-send a message.
--     (The sender calls them as two transactions for the same reason.)
-- ============================================================================

create or replace function app.crm_record_sequence_message(
  p_follow_up uuid,
  p_wamid text,
  p_body text,
  p_subject text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
  v_channel text;
begin
  select f.channel::text into v_channel from public.crm_follow_ups f where f.id = p_follow_up;
  if v_channel is null then
    return null;
  end if;

  insert into public.crm_lead_messages
    (lead_id, channel, direction, kind, subject, body,
     wa_message_id, email_message_id, status, sent_by_id, occurred_at)
  select f.lead_id, f.channel::text::public.crm_message_channel, 'outbound', 'text',
         /* ⚠️ A SUBJECT IS EMAIL-ONLY — 175's other constraint, and a WhatsApp
            row carrying one is refused just as loudly. */
         case when v_channel = 'email' then p_subject end,
         p_body,
         case when v_channel = 'whatsapp' then p_wamid end,
         case when v_channel = 'email' then p_wamid end,
         'sent', f.assigned_to_id, now()
    from public.crm_follow_ups f
   where f.id = p_follow_up
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function app.crm_record_sequence_message(uuid, text, text, text) from public;
grant execute on function app.crm_record_sequence_message(uuid, text, text, text) to cni_app;

-- ============================================================================
-- SELF-CHECK — both channels, and the constraint that caught it
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_fu_mail uuid; v_fu_wa uuid;
  v_mail uuid; v_wa uuid; r_mail record; r_wa record;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
   where l.project_id = v_project and l.is_test_data limit 1;
  if v_lead is null then
    raise exception '190 · no demo lead — refusing to skip the check';
  end if;

  begin
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'email', 'auto_send', 'due', 'SELFCHECK-190 mail', 'Body.', now(), v_sales, v_sales)
    returning id into v_fu_mail;
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'due', 'SELFCHECK-190 wa', 'Body.', now(), v_sales, v_sales)
    returning id into v_fu_wa;

    v_mail := app.crm_record_sequence_message(v_fu_mail, 'resend-190', 'Body.', 'A subject');
    v_wa   := app.crm_record_sequence_message(v_fu_wa,   'wamid.190',  'Body.', null);

    select channel::text as channel, email_message_id, wa_message_id, subject into r_mail
      from public.crm_lead_messages where id = v_mail;
    select channel::text as channel, email_message_id, wa_message_id, subject into r_wa
      from public.crm_lead_messages where id = v_wa;

    raise exception using errcode = 'P0190', message = '190 rollback';
  exception when sqlstate 'P0190' then
    null;
  end;

  if r_mail.channel <> 'email' or r_mail.email_message_id <> 'resend-190'
     or r_mail.wa_message_id is not null or r_mail.subject <> 'A subject' then
    raise exception '190 · an automatic email was not recorded as an email (%)', r_mail;
  end if;
  if r_wa.channel <> 'whatsapp' or r_wa.wa_message_id <> 'wamid.190'
     or r_wa.email_message_id is not null or r_wa.subject is not null then
    raise exception '190 · an automatic WhatsApp message was recorded wrongly (%)', r_wa;
  end if;
  if exists (select 1 from public.crm_follow_ups where title like 'SELFCHECK-190%') then
    raise exception '190 · the self-check left rows behind';
  end if;

  raise notice '190 · an automatic message is recorded under its own channel, with its own id column, and an email keeps its subject';
end $chk$;
