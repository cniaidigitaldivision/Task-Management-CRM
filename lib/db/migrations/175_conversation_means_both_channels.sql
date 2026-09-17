-- ============================================================================
-- 175 · "CONVERSATION" MEANS WHATSAPP *AND* EMAIL
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"One more thing I have noticed: you didn't implement the
-- email services… the proposal and the quotation, each time sent by WhatsApp and
-- also auto-sent by email."*
--
-- Correct, and it was never wired. `12-LIFECYCLE-SPEC.md` has had this as Phase 8
-- since the spec arrived: *"Real email send/receive against a lead, so
-- Conversation means both channels."*
--
-- ⚠️ THE MAILER ITSELF WAS ALREADY THERE AND CAPABLE — Resend, a verified
-- `EMAIL_FROM`, `lib/email/send.ts`, and PDF attachments already used by
-- invoices. What did not exist was any lead email at all. The plumbing was
-- built; the pipe to the CRM was not.
--
-- ── ⚠️ ONE THREAD, NOT TWO TABLES ──────────────────────────────────────────
-- A `crm_lead_emails` table would mean every screen that shows a conversation
-- merges two sources and sorts them by hand, and the day they disagree about
-- ordering is the day somebody reads a reply before the message it answers.
-- `crm_lead_messages` is the thread; `channel` says how it travelled.
-- ============================================================================

create type public.crm_message_channel as enum ('whatsapp', 'email');

alter table public.crm_lead_messages
  add column channel public.crm_message_channel not null default 'whatsapp',
  /* ⚠️ EMAIL ONLY, AND THE CHECK BELOW ENFORCES IT. `15-MY-LEADS-PHASE.md`
     already refused to invent one: *"Subjects are an email concept. WhatsApp has
     a body and no subject; showing a fabricated one would be inventing
     content."* Now that emails are real, the column is real — for them alone. */
  add column subject text,
  /* Resend's own id. ⚠️ Without it, "the client says they never received it" has
     no answer at all — and that is an ordinary support question, not an edge
     case. `wa_message_id` keeps its name and its meaning; renaming it would
     touch the webhook, 142's sibling logic and the status callbacks. */
  add column email_message_id text;

comment on column public.crm_lead_messages.channel is
  'How this message travelled. The thread is one table so no screen has to merge two sources and sort them by hand.';

alter table public.crm_lead_messages
  add constraint crm_lead_messages_subject_is_email_only check (
    subject is null or channel = 'email'
  ),
  add constraint crm_lead_messages_ids_match_channel check (
    (wa_message_id is null or channel = 'whatsapp')
    and (email_message_id is null or channel = 'email')
  );

/* ⚠️ THE GRANT — the part 166 exists because somebody forgot. `cni_app` holds a
   COLUMN-LEVEL insert grant here, so a new column is unwritable by the
   application until it is named. Every email the CRM sends goes through this. */
grant insert (channel, subject, email_message_id) on public.crm_lead_messages to cni_app;
grant select (channel, subject, email_message_id) on public.crm_lead_messages to cni_app;

/* An index for the one question the conversation tab will ask often enough to
   matter: this lead's thread, newest first, on either channel. */
create index crm_lead_messages_lead_channel_idx
  on public.crm_lead_messages (lead_id, occurred_at desc);


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_msg uuid;
  refused boolean; n_wa integer;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then
    raise exception '175 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '175 · nobody eligible'; end if;

  -- ⚠️ EVERY MESSAGE THAT ALREADY EXISTED IS WHATSAPP. A default that quietly
  --    relabelled seventeen real conversations would be worse than no column.
  select count(*) into n_wa from public.crm_lead_messages where channel <> 'whatsapp';
  if n_wa > 0 then
    raise exception '175 · % existing message(s) were not left as whatsapp', n_wa;
  end if;

  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, email, stage, is_test_data, submitted_at)
  values (v_project, v_sales, 'manual', 'SELFCHECK-175', '+920000000175',
          'selfcheck-175@example.invalid', 'contacted', true, now())
  returning id into v_lead;

  -- 1 · ⚠️ A SALESPERSON CAN WRITE AN EMAIL INTO THE THREAD, through the
  --     application's own grant. Reading information_schema proves a grant
  --     exists and says nothing about whether the statement runs — 162 and 166.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  insert into public.crm_lead_messages
    (lead_id, channel, direction, kind, subject, body, email_message_id,
     status, sent_by_id, occurred_at)
  values (v_lead, 'email', 'outbound', 'text', 'Your quotation QT-SELFCHECK',
          'Please find the quotation attached.', 'resend-selfcheck-175',
          'sent', v_sales, now())
  returning id into v_msg;
  reset role;

  if v_msg is null then
    delete from public.crm_leads where id = v_lead;
    raise exception '175 · a salesperson could not record a sent email — the column grant is missing';
  end if;

  -- 2 · ⚠️ A WHATSAPP MESSAGE MAY NOT CARRY A SUBJECT. Inventing one is exactly
  --     what 15-MY-LEADS-PHASE refused to do, and now the database refuses it.
  refused := false;
  begin
    insert into public.crm_lead_messages
      (lead_id, channel, direction, kind, subject, body, status, occurred_at)
    values (v_lead, 'whatsapp', 'outbound', 'text', 'A subject', 'Hello', 'sent', now());
  exception when check_violation then refused := true;
  end;
  if not refused then
    delete from public.crm_lead_messages where lead_id = v_lead;
    delete from public.crm_leads where id = v_lead;
    raise exception '175 · a WhatsApp message was allowed a subject';
  end if;

  -- 3 · And the ids cannot be crossed over.
  refused := false;
  begin
    insert into public.crm_lead_messages
      (lead_id, channel, direction, kind, body, wa_message_id, status, occurred_at)
    values (v_lead, 'email', 'outbound', 'text', 'Hello', 'wamid.NOPE', 'sent', now());
  exception when check_violation then refused := true;
  end;
  if not refused then
    delete from public.crm_lead_messages where lead_id = v_lead;
    delete from public.crm_leads where id = v_lead;
    raise exception '175 · an email row carried a WhatsApp message id';
  end if;

  -- 4 · ⚠️ AND THE THREAD IS STILL ONE THREAD. Both channels come back from one
  --     query, in time order — which is the whole reason this is not a second table.
  insert into public.crm_lead_messages
    (lead_id, channel, direction, kind, body, status, occurred_at)
  values (v_lead, 'whatsapp', 'inbound', 'text', 'Got it, thanks', 'delivered', now());

  if (select count(distinct channel) from public.crm_lead_messages where lead_id = v_lead) <> 2 then
    delete from public.crm_lead_messages where lead_id = v_lead;
    delete from public.crm_leads where id = v_lead;
    raise exception '175 · the two channels did not land in one thread';
  end if;

  -- 5 · A colleague still cannot read it.
  declare
    v_other uuid; n_seen integer;
  begin
    select u.id into v_other from public.users u
      join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.id <> v_sales and u.department_role = 'member'
       and u.is_active limit 1;
    if v_other is not null then
      set local role cni_app;
      perform set_config('app.user_id', v_other::text, true);
      select count(*) into n_seen from public.crm_lead_messages where lead_id = v_lead;
      reset role;
      if n_seen > 0 then
        delete from public.crm_lead_messages where lead_id = v_lead;
        delete from public.crm_leads where id = v_lead;
        raise exception '175 · a colleague could read another salesperson''s email thread';
      end if;
    end if;
  end;

  delete from public.crm_lead_messages where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;

  raise notice '175 · email lives in the same thread as WhatsApp, a salesperson can write one, a WhatsApp message may not carry a subject, the ids cannot cross, and a colleague sees none of it';
end $chk$;
