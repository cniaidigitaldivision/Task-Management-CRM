-- ============================================================================
-- 188 · THE SENDER CAN READ THE QUEUE
-- ----------------------------------------------------------------------------
-- 187 built the queue and then locked it: `revoke all … from public` with no
-- grant to `cni_app` means the application role cannot execute any of those
-- functions. The migration owner could, which is why the self-check passed —
-- ⚠️ A SELF-CHECK RUNS AS THE OWNER AND THEREFORE CANNOT SEE A MISSING GRANT.
-- `definers-hide-missing-grants` is the note in memory; this is the same trap
-- from the other side.
--
-- It also gives the queue the two things a sender needs and 187 did not return:
-- WHICH NUMBER to send from, and WHO the message is from. `app.crm_project_wa_number`
-- (141) cannot answer for a machine — it asks whether the CALLER manages the
-- project, and the caller here is a scheduled job with no session. So the number
-- is read inside this definer, for rows it has already vetted.
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
     /* ⚠️ THE STOP-CONDITIONS, ASKED AGAIN AT THE MOMENT OF SENDING. A row
        queued fifteen minutes ago is a promise about now, and the client may
        have replied in between. */
     and (f.lead_sequence_id is null or app.crm_sequence_stop_reason(f.lead_sequence_id) is null)
     and (
       (f.channel = 'whatsapp'
        and l.phone_e164 is not null
        and p.whatsapp_phone_number_id is not null
        /* ⚠️ NULL CONSENT IS NOT A YES FOR A MACHINE. A person may choose to
           message somebody nobody has asked; a scheduler may not
           (`docs/crm-ai/05-GUARDRAILS.md` §5). This is the one place the two
           differ, and it is deliberate. */
        and l.whatsapp_consent is true
        and (app.crm_window_is_open(f.lead_id) or nullif(st.wa_template_name, '') is not null))
       or (f.channel = 'email' and l.email is not null)
     )
   order by f.due_at
   limit greatest(1, least(p_limit, 100))
$fn$;

comment on function app.crm_followups_to_send(integer) is
  'What a scheduled sender may deliver right now. Re-asks every stop-condition, refuses free text outside the 24-hour window, and refuses WhatsApp without a stated yes. 187, widened in 188.';

revoke all on function app.crm_followups_to_send(integer) from public;
grant execute on function app.crm_followups_to_send(integer) to cni_app;
grant execute on function app.crm_followup_sent(uuid, text, text) to cni_app;
grant execute on function app.crm_record_sequence_message(uuid, text, text, text) to cni_app;
grant execute on function app.crm_next_send_slot(timestamptz, smallint, smallint, smallint[], integer, integer) to cni_app;

-- ============================================================================
-- SELF-CHECK — ⚠️ AS `cni_app`, which is the whole point of this migration
-- ============================================================================
do $chk$
declare
  v_can boolean := false;
  v_rows integer;
begin
  begin
    set local role cni_app;
    perform set_config('app.user_id', '', true);
    select count(*) into v_rows from app.crm_followups_to_send(5);
    v_can := true;
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_can := false;
  end;

  if not v_can then
    raise exception '188 · cni_app still cannot read the send queue — the sender would fail in production and nowhere else';
  end if;

  raise notice '188 · the application role can read the send queue and settle what it sent (% row(s) due right now)', v_rows;
end $chk$;
