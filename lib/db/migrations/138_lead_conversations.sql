-- ============================================================================
-- 138 · WHERE A WHATSAPP CONVERSATION LIVES
-- ----------------------------------------------------------------------------
-- Step 8 of the nine. Until now the webhook proved every event was genuinely
-- Meta's and then wrote it to a log, because there was nowhere to put it. The
-- owner replied to a test message on 2026-09-13 and the only honest answer to
-- "did you get it?" was that Meta had, and we could not show it. This is that
-- gap closed.
--
-- ── ⚠️ THE CONVERSATION HANGS OFF THE LEAD, AND THAT IS THE WHOLE DESIGN ───
-- Owner, 2026-09-13: *"The lead, which is attached to salesperson 1, will
-- always reply to him… This is not a good way: the lead is with one person and
-- talking to some other person."* Correct, and it is why there is no shared
-- inbox here.
--
-- A message belongs to a LEAD. A lead belongs to one owner. So the policy below
-- delegates to `crm_leads` by EXISTS rather than restating who may read what —
-- which means a salesperson can open exactly the conversations on their own
-- leads and literally cannot query a colleague's, and the day the lead rule
-- changes this follows it. Five migrations (105, 121, 125, 129, 130) have now
-- each demonstrated what a second copy of one predicate costs.
--
-- ── ⚠️ `wa_message_id` IS UNIQUE, AND IT IS NOT DECORATION ─────────────────
-- Meta RETRIES a webhook it did not get a fast 2xx for, with an escalating
-- back-off. Without this, one slow response turns into the same message
-- appearing in the thread two or three times — and a conversation that
-- duplicates itself is one nobody trusts. The insert is ON CONFLICT DO NOTHING,
-- so a retry is silently correct.
--
-- ── ⚠️ AND INBOUND IS WRITTEN WITH NO SESSION ──────────────────────────────
-- The webhook is authenticated by signature, not by a login — there is no user.
-- So recording an inbound message goes through a SECURITY DEFINER function, the
-- same shape `app.crm_record_leads` (112) already uses for the importer, rather
-- than by loosening the policy to admit an anonymous writer.
-- ============================================================================

do $$ begin
  create type public.crm_message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  /* Only what the Cloud API actually delivers. `unknown` exists because Meta
     adds message types faster than anybody redeploys, and a webhook that threw
     on an unrecognised type would drop the retry and then drop it again. */
  create type public.crm_message_kind as enum
    ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_message_status as enum ('sent', 'delivered', 'read', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_lead_messages (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.crm_leads(id) on delete cascade,
  /* ⚠️ Meta's own id. UNIQUE — see the header. Null only for an outbound
     message whose send failed before Meta answered with one. */
  wa_message_id   text unique,
  direction       public.crm_message_direction not null,
  kind            public.crm_message_kind not null default 'text',
  /* The text, or a media caption. Null for a media message with no caption. */
  body            text,
  /* ⚠️ THE MEDIA ITSELF IS NOT STORED HERE. Meta keeps it for a limited period
     behind an authenticated URL; copying every image into our database would
     make this table enormous and would duplicate something we can fetch. The id
     is kept so it can be fetched on demand. */
  media_id        text,
  media_mime      text,
  media_filename  text,
  /* Outbound only. Inbound has no status — it has already happened. */
  status          public.crm_message_status,
  status_at       timestamptz,
  error_detail    text,
  /* Who sent it, for an outbound message. ⚠️ THIS IS THE POINT OF THE WHOLE
     FEATURE: on the phone app, "who replied" is unknowable. Here it is a
     column. */
  sent_by_id      uuid references public.users(id) on delete set null,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.crm_lead_messages is
  'One WhatsApp message, attached to the lead it belongs to. Readable by exactly '
  'whoever may read that lead — there is no shared inbox. Migration 138.';

/* The thread, newest last, for one lead. The only query this table runs often. */
create index if not exists crm_lead_messages_thread_idx
  on public.crm_lead_messages (lead_id, occurred_at);

/* ⚠️ For the status webhook, which arrives with Meta's id and nothing else. */
create index if not exists crm_lead_messages_wamid_idx
  on public.crm_lead_messages (wa_message_id) where wa_message_id is not null;

alter table public.crm_lead_messages enable row level security;

drop policy if exists crm_lead_messages_select on public.crm_lead_messages;
create policy crm_lead_messages_select on public.crm_lead_messages
  for select using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_messages.lead_id)
  );

/* ⚠️ INSERT ONLY, AND NO UPDATE OR DELETE FOR ANY SESSION. A conversation is
   evidence — it is what "how did he deal with the client" is answered from, and
   what the response time is measured against. The same stance as
   `crm_lead_activity` and `crm_reports`, and the opposite of
   `crm_lead_insights`, which is a cache and must be replaceable.

   Delivery statuses are written by the definer function below, not by a
   session, so an append-only rule here costs nothing operationally. */
drop policy if exists crm_lead_messages_insert on public.crm_lead_messages;
create policy crm_lead_messages_insert on public.crm_lead_messages
  for insert with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_messages.lead_id)
    and direction = 'outbound'
    and (sent_by_id is null or sent_by_id = app.current_user_id())
  );

grant select, insert on public.crm_lead_messages to cni_app;

/* ── Which lead does this number belong to? ──────────────────────────────────
   ⚠️ THE NEWEST OPEN ONE WINS, and it is not arbitrary. 615 leads carry 597
   distinct numbers — about eighteen people enquired twice — so a number can
   genuinely match several leads. Attaching a reply to a closed lead from March
   rather than the live one from this week would put the conversation where
   nobody is looking.

   ⚠️ AND IT MATCHES ON `phone_e164`, NEVER ON `phone`. `0300-1234567` and
   `+92 300 1234567` are one person and two strings; the raw column is whatever
   Meta captured. */
create or replace function app.crm_lead_for_number(p_e164 text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select l.id
    from public.crm_leads l
   where l.phone_e164 = p_e164
   order by
     (l.stage not in ('won','lost')) desc,   -- an open lead first
     l.submitted_at desc                     -- then the most recent
   limit 1
$$;

comment on function app.crm_lead_for_number(text) is
  'The lead a WhatsApp number belongs to: newest OPEN lead first. ~18 of 615 '
  'leads share a number with another. Migration 138.';

/* ── Recording what arrived ──────────────────────────────────────────────────
   ⚠️ CALLED BY THE WEBHOOK, WHICH HAS NO SESSION. Authenticated by signature,
   not by a login, so this is SECURITY DEFINER — the same shape the importer's
   writer has used since 112. Loosening the table's policy to admit an anonymous
   writer would have been the other way, and would have admitted rather more
   than the webhook. */
create or replace function app.crm_record_inbound_message(
  p_from_e164  text,
  p_wamid      text,
  p_kind       text,
  p_body       text,
  p_media_id   text,
  p_media_mime text,
  p_filename   text,
  p_occurred   timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_id   uuid;
begin
  v_lead := app.crm_lead_for_number(p_from_e164);

  /* ⚠️ NOT AN ERROR, AND NOT STORED EITHER. Somebody messaging the business
     number who is not a lead — a supplier, a wrong number, a member of staff —
     is ordinary. Returning null lets the route answer 200 so Meta stops
     retrying, while nothing is written against a lead that does not exist. */
  if v_lead is null then
    return null;
  end if;

  insert into public.crm_lead_messages
    (lead_id, wa_message_id, direction, kind, body, media_id, media_mime,
     media_filename, occurred_at)
  values
    (v_lead, p_wamid, 'inbound',
     /* An unrecognised type is recorded as `unknown` rather than refused — see
        the enum's own note. */
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[])
           then p_kind else 'unknown' end)::public.crm_message_kind,
     p_body, p_media_id, p_media_mime, p_filename,
     coalesce(p_occurred, now()))
  /* ⚠️ A RETRY IS NOT A SECOND MESSAGE. */
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  return v_id;
end $$;

comment on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz) is
  'Stores one inbound WhatsApp message against its lead. Null when the number '
  'matches no lead, which is ordinary and not an error. Migration 138.';

/* ── Delivery receipts ───────────────────────────────────────────────────────
   Also from the webhook, also sessionless. Only ever moves a status forward:
   `read` must not be overwritten by a `delivered` that arrives late, and Meta
   does deliver them out of order. */
create or replace function app.crm_record_message_status(
  p_wamid  text,
  p_status text,
  p_detail text,
  p_at     timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rank int;
  v_now  int;
  v_ok   boolean := false;
begin
  v_rank := case p_status when 'sent' then 1 when 'delivered' then 2
                          when 'read' then 3 when 'failed' then 4 else 0 end;
  if v_rank = 0 then
    return false;
  end if;

  update public.crm_lead_messages m
     set status = p_status::public.crm_message_status,
         status_at = coalesce(p_at, now()),
         error_detail = coalesce(p_detail, m.error_detail)
   where m.wa_message_id = p_wamid
     and (
       m.status is null
       or v_rank > (case m.status::text when 'sent' then 1 when 'delivered' then 2
                                        when 'read' then 3 when 'failed' then 4 else 0 end)
     );

  get diagnostics v_now = row_count;
  v_ok := v_now > 0;
  return v_ok;
end $$;

revoke all on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz) from public;
revoke all on function app.crm_record_message_status(text,text,text,timestamptz) from public;
revoke all on function app.crm_lead_for_number(text) from public;
grant execute on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz) to cni_app;
grant execute on function app.crm_record_message_status(text,text,text,timestamptz) to cni_app;
grant execute on function app.crm_lead_for_number(text) to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead   uuid;
  v_owner  uuid;
  v_other  uuid;
  v_phone  text;
  v_msg    uuid;
  v_again  uuid;
  n        int;
begin
  select id, owner_id, phone_e164 into v_lead, v_owner, v_phone
    from public.crm_leads
   where owner_id is not null and phone_e164 is not null limit 1;

  if v_lead is null then
    raise notice '138 · no assigned lead with a number — skipping';
    return;
  end if;

  select u.id into v_other from public.users u
   where u.is_active and u.id <> v_owner and u.role not in ('admin','super_admin')
     and u.department_id is distinct from (select department_id from public.users where id = v_owner)
   limit 1;

  -- 1 · A number finds its lead.
  if app.crm_lead_for_number(v_phone) is null then
    raise exception '138 · a lead''s own number does not match it';
  end if;

  -- 2 · An inbound message lands on that lead.
  --
  --     ⚠️ AND THE LEAD IT LANDS ON IS RE-READ, NOT ASSUMED. The first version
  --     of this check compared against the lead it had picked itself and failed
  --     — because ~18 of the 615 leads share a number with another, so
  --     `crm_lead_for_number` legitimately chose the newest OPEN sibling
  --     instead. The check was wrong and the routing was right. Taking the
  --     answer from the function under test is the only honest way to assert
  --     what it did.
  v_lead  := app.crm_lead_for_number(v_phone);
  select owner_id into v_owner from public.crm_leads where id = v_lead;

  v_msg := app.crm_record_inbound_message(
    v_phone, '138-self-check-wamid', 'text', 'hello from the self-check',
    null, null, null, now());
  if v_msg is null then
    raise exception '138 · an inbound message from a lead''s own number was not recorded';
  end if;

  if v_owner is null then
    raise notice '138 · the matched lead has no owner — skipping the per-person checks';
  end if;

  -- 3 · ⚠️ AND META'S RETRY DOES NOT DUPLICATE IT. This is the check that
  --     matters most: a conversation that repeats itself is one nobody trusts.
  v_again := app.crm_record_inbound_message(
    v_phone, '138-self-check-wamid', 'text', 'hello from the self-check',
    null, null, null, now());
  if v_again is not null then
    raise exception '138 · the same wamid was stored twice — a webhook retry would duplicate the thread';
  end if;
  select count(*) into n from public.crm_lead_messages where wa_message_id = '138-self-check-wamid';
  if n <> 1 then
    raise exception '138 · % copies of one message exist', n;
  end if;

  -- 4 · An unknown number is ignored, not an error.
  if app.crm_record_inbound_message(
       '+99900000000', '138-nobody', 'text', 'wrong number', null, null, null, now()) is not null then
    raise exception '138 · a message from a number matching no lead was stored anyway';
  end if;

  -- 5 · ⚠️ THE OWNER CAN READ IT AND A COLLEAGUE CANNOT. The owner's whole
  --     objection to a shared inbox rests on this being true of the MESSAGES,
  --     not only of the lead.
  if v_owner is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    select count(*) into n from public.crm_lead_messages where lead_id = v_lead;
    reset role;
    if n < 1 then
      raise exception '138 · the lead''s owner cannot read its conversation';
    end if;
  end if;

  if v_other is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into n from public.crm_lead_messages where lead_id = v_lead;
    reset role;
    if n <> 0 then
      raise exception '138 · a colleague can read somebody else''s WhatsApp conversation';
    end if;
  end if;

  -- 6 · A status moves forward and never backward.
  perform app.crm_record_message_status('138-self-check-wamid', 'read', null, now());
  perform app.crm_record_message_status('138-self-check-wamid', 'delivered', null, now());
  select count(*) into n from public.crm_lead_messages
   where wa_message_id = '138-self-check-wamid' and status = 'read';
  if n <> 1 then
    raise exception '138 · a late "delivered" overwrote "read"';
  end if;

  -- 7 · Clean up. ⚠️ Deleted as the OWNER of the table, not through a session —
  --     there is deliberately no DELETE policy, because a conversation is
  --     evidence.
  delete from public.crm_lead_messages where wa_message_id in ('138-self-check-wamid', '138-nobody');

  raise notice '138 · a conversation belongs to its lead, and to nobody else''s';
end $$;
