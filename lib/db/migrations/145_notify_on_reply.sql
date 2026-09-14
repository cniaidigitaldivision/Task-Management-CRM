-- ============================================================================
-- 145 · THE BELL RINGS WHEN A CUSTOMER WRITES BACK — Step 8
-- ----------------------------------------------------------------------------
-- Until now the only thing that noticed an inbound WhatsApp message was the
-- docked panel, and only while somebody had it open. A reply arriving while the
-- salesperson was on another screen was silent until they happened to open that
-- lead — which could be days.
--
-- ⚠️ AND THAT WOULD HAVE QUIETLY CORRUPTED THE ONE NUMBER THIS DESK IS JUDGED
-- ON. `median_response_minutes` feeds the rota (133) and the sales-team panel.
-- Measuring it while nobody is told a reply exists measures how often somebody
-- happened to be looking at the right screen, and then the rota hands the next
-- lead to whoever had a quiet afternoon.
--
-- ⚠️ AND THE 24-HOUR WINDOW MAKES IT URGENT RATHER THAN TIDY. Meta refuses
-- free-form text more than 24 hours after the customer's last message. A reply
-- nobody saw for a day is a conversation that must be restarted from an approved
-- template — which this system does not have yet — or not at all.
--
-- ── ⚠️ WHO IS TOLD, AND WHY IT IS NOT EVERYBODY ────────────────────────────
-- The OWNER. Owner's rule, 2026-09-13: *"The lead, which is attached to
-- salesperson 1, will always reply to him… This is not a good way: the lead is
-- with one person and talking to some other person."* A team-wide ping would be
-- a shared inbox by another route.
--
-- ⚠️ EXCEPT WHERE THERE IS NO OWNER, and that case is the reason this is not
-- three lines. An UNASSIGNED lead that writes back is a stranger who has raised
-- their hand and whom nobody is on the hook for — exactly the message that rots.
-- So the department's managers are told instead. It is the only broadcast here
-- and it stops at managers.
-- ============================================================================

create or replace function app.crm_notify_lead_replied(p_lead uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid;
  v_project uuid;
  v_dept    uuid;
  v_who     text;
  v_title   text;
  v_link    text;
  r         record;
  n_sent    int := 0;
begin
  select l.owner_id, l.project_id,
         coalesce(nullif(trim(l.full_name), ''), l.phone_e164, 'A lead')
    into v_owner, v_project, v_who
    from public.crm_leads l
   where l.id = p_lead;

  if v_project is null then
    return 0;   -- no such lead; the caller already tolerates this
  end if;

  v_title := v_who || ' replied on WhatsApp';
  /* ⚠️ `?chat=1` — the conversation is open on arrival. A notification that
     lands somebody on a page with a button still to find is a notification that
     costs a click at exactly the moment the 24-hour window is running. */
  v_link  := '/leads/' || p_lead::text || '?chat=1';

  if v_owner is not null then
    /* ⚠️ ONE UNREAD AT A TIME. A customer sending six lines in a row is one
       event, not six — and six identical rows in the bell is how somebody learns
       to ignore the bell. Once it is read, the next reply rings again. */
    if exists (
      select 1 from public.notifications n
       where n.user_id = v_owner
         and n.kind = 'lead_replied'
         and n.entity_id = p_lead
         and not n.is_read
    ) then
      return 0;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (v_owner, 'lead_replied', v_title,
            'Answer inside 24 hours — after that WhatsApp only allows an approved template.',
            v_link, p_lead);
    return 1;
  end if;

  /* ── Nobody owns it ──────────────────────────────────────────────────── */
  select p.lead_department_id into v_dept
    from public.projects p where p.id = v_project;
  if v_dept is null then
    return 0;
  end if;

  for r in
    select u.id
      from public.users u
     where u.department_id = v_dept
       and u.department_role = 'manager'
       and u.is_active
  loop
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.id
         and n.kind = 'lead_replied'
         and n.entity_id = p_lead
         and not n.is_read
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (r.id, 'lead_replied', v_title,
            'Nobody owns this lead yet, and they are waiting. Share it out or answer it.',
            v_link, p_lead);
    n_sent := n_sent + 1;
  end loop;

  return n_sent;
end $$;

comment on function app.crm_notify_lead_replied(uuid) is
  'Rings the bell for the lead''s OWNER when a customer writes back, or for the '
  'department''s managers when nobody owns it. One unread per lead, so six lines '
  'in a row are one notification. Migration 145.';

revoke all on function app.crm_notify_lead_replied(uuid) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- HOOKED INTO THE RECORDER
-- ----------------------------------------------------------------------------
-- ⚠️ INSIDE `crm_record_inbound_message`, NOT IN THE WEBHOOK ROUTE. The route
-- is one of several things that could store a message, and a notification that
-- lives in a caller is a notification that is missing from the next caller. It
-- also means the whole thing — message and bell — is one transaction: there is
-- no state where the conversation has a line in it that nobody was told about.
--
-- ⚠️ AND ONLY WHEN A ROW WAS ACTUALLY INSERTED. `on conflict do nothing` leaves
-- `v_id` null on Meta's retries, and Meta retries often. Ringing on the retry
-- would put the same reply in the bell several times.
--
-- Body copied verbatim from 138 apart from the two marked lines.
-- ════════════════════════════════════════════════════════════════════════════
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

  if v_lead is null then
    return null;
  end if;

  insert into public.crm_lead_messages
    (lead_id, wa_message_id, direction, kind, body, media_id, media_mime,
     media_filename, occurred_at)
  values
    (v_lead, p_wamid, 'inbound',
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[])
           then p_kind else 'unknown' end)::public.crm_message_kind,
     p_body, p_media_id, p_media_mime, p_filename,
     coalesce(p_occurred, now()))
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  /* ⚠️ THE ONLY CHANGE FROM 138. Null id means Meta sent us this one again. */
  if v_id is not null then
    perform app.crm_notify_lead_replied(v_lead);
  end if;

  return v_id;
end $$;

comment on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz) is
  'Stores one inbound WhatsApp message against its lead AND rings the bell for '
  'whoever owes it a reply. Null when the number matches no lead, which is '
  'ordinary and not an error. Migrations 138 and 145.';

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead   uuid;
  v_owner  uuid;
  v_num    text;
  v_before int;
  v_after  int;
  v_id     uuid;
  v_link   text;
begin
  /* ⚠️ RESOLVED THROUGH 142, NOT PICKED BY HAND. The first version of this
     check looked for an owned lead whose number no sibling shared — and found
     none, because only the 20 demo leads are owned, only 4 of those carry a real
     number, and all 4 share it. A check that skips proves nothing, so this asks
     142's resolver which lead a reply on that number would ACTUALLY land on and
     measures the bell for that lead's owner. It is also the real path. */
  select l.phone_e164 into v_num
    from public.crm_leads l
   where l.phone_e164 is not null
     and (select o.owner_id
            from public.crm_leads o
           where o.id = app.crm_lead_for_number(l.phone_e164)) is not null
   limit 1;

  if v_num is null then
    raise notice '145 · no number whose reply would land on an owned lead';
    return;
  end if;

  v_lead := app.crm_lead_for_number(v_num);
  select owner_id into v_owner from public.crm_leads where id = v_lead;

  select count(*) into v_before from public.notifications
   where user_id = v_owner and kind = 'lead_replied' and entity_id = v_lead;

  -- 1 · A reply rings the owner's bell.
  v_id := app.crm_record_inbound_message(
            v_num, '145-self-check-a', 'text', 'self check', null, null, null, now());
  if v_id is null then
    raise exception '145 · the self-check message was not stored at all';
  end if;

  select count(*) into v_after from public.notifications
   where user_id = v_owner and kind = 'lead_replied' and entity_id = v_lead;
  if v_after <> v_before + 1 then
    raise exception '145 · a reply did not ring the owner: % → %', v_before, v_after;
  end if;

  -- 2 · ⚠️ AND THE LINK OPENS THE CONVERSATION, not a page with a button on it.
  select link_to into v_link from public.notifications
   where user_id = v_owner and kind = 'lead_replied' and entity_id = v_lead
   order by created_at desc limit 1;
  if v_link is distinct from '/leads/' || v_lead::text || '?chat=1' then
    raise exception '145 · the notification links to %, not to the open chat', v_link;
  end if;

  -- 3 · ⚠️ SIX LINES IN A ROW ARE ONE NOTIFICATION. Not tidiness: a bell that
  --     cries six times is a bell somebody turns off.
  perform app.crm_record_inbound_message(
            v_num, '145-self-check-b', 'text', 'and another', null, null, null, now());
  select count(*) into v_after from public.notifications
   where user_id = v_owner and kind = 'lead_replied' and entity_id = v_lead and not is_read;
  if v_after <> 1 then
    raise exception '145 · % unread notifications for one conversation', v_after;
  end if;

  -- 4 · ⚠️ AND META'S RETRY RINGS NOTHING. Same wamid, sent again.
  if app.crm_record_inbound_message(
       v_num, '145-self-check-a', 'text', 'self check', null, null, null, now()) is not null then
    raise exception '145 · a retried message was stored a second time';
  end if;
  select count(*) into v_after from public.notifications
   where user_id = v_owner and kind = 'lead_replied' and entity_id = v_lead;
  if v_after <> v_before + 1 then
    raise exception '145 · a retry rang the bell again';
  end if;

  -- 5 · An unknown number still stores nothing and rings nothing.
  if app.crm_record_inbound_message(
       '+99900000000', '145-nobody', 'text', 'wrong number', null, null, null, now()) is not null then
    raise exception '145 · a message from a number matching no lead was stored';
  end if;

  /* Clean up, as the table's OWNER — there is deliberately no DELETE policy on
     a conversation, and 138 does exactly this for the same reason. */
  delete from public.crm_lead_messages
   where wa_message_id in ('145-self-check-a', '145-self-check-b', '145-nobody');
  delete from public.notifications
   where kind = 'lead_replied' and entity_id = v_lead and created_at > now() - interval '5 minutes';

  raise notice '145 · a customer writing back rings the bell once, and a retry rings nothing';
end $$;
