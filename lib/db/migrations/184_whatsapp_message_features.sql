-- ============================================================================
-- 184 · WHATSAPP, THE WAY WHATSAPP WORKS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"all the WhatsApp features… delete, send voice, video,
-- images, documents, PDF… message info, reply, copy, react, forward, pin, star,
-- delete… and saved replies — I am Sarah, how can I assist you — saved for
-- everyone, according to their name."*
--
-- What the Cloud API allows, checked against Meta's own reference that day:
--   · REPLY      `context.message_id` on any message                    ✅
--   · REACT      `type: reaction`; messages up to 30 days old           ✅
--   · VOICE      `audio.voice: true`, OGG with the OPUS codec, mono     ✅
--   · MEDIA      jpeg/png ≤ 5 MB · mp4/3gpp ≤ 16 MB · audio ≤ 16 MB ·
--                documents ≤ 100 MB                                     ✅
--   · DELETE FOR EVERYONE   ❌ no such endpoint. A business cannot unsend.
--   · PIN / STAR ❌ phone-side features with no API — here they are the CRM's.
--
-- ⚠️ AND INBOUND MEDIA IDS EXPIRE AFTER 7 DAYS (Meta's reference, 2026). The
-- media route fetched attachments on view, so a photo a client sent on Monday was
-- gone by the following Tuesday. `media_path` is our own stored copy.
-- ============================================================================

alter table public.crm_lead_messages
  add column reply_to_wamid     text,
  add column our_reaction       text,
  add column our_reaction_by_id uuid references public.users(id) on delete set null,
  add column our_reaction_at    timestamptz,
  add column their_reaction     text,
  add column their_reaction_at  timestamptz,
  add column pinned_at          timestamptz,
  add column pinned_by_id       uuid references public.users(id) on delete set null,
  add column hidden_at          timestamptz,
  add column hidden_by_id       uuid references public.users(id) on delete set null,
  add column delivered_at       timestamptz,
  add column read_at            timestamptz,
  add column played_at          timestamptz,
  add column media_path         text,
  add column media_size         bigint check (media_size is null or media_size >= 0),
  add column media_voice        boolean not null default false,
  add column forwarded          boolean not null default false,
  add constraint crm_lead_messages_reaction_short
    check (our_reaction is null or char_length(our_reaction) <= 16),
  add constraint crm_lead_messages_their_reaction_short
    check (their_reaction is null or char_length(their_reaction) <= 16);

comment on column public.crm_lead_messages.hidden_at is
  '"Delete for me". ⚠️ The client still has the message — the WhatsApp Cloud API cannot unsend. The row is kept; the thread shows that it was deleted and by whom. 184.';
comment on column public.crm_lead_messages.media_path is
  'Our own copy in storage. Inbound Meta media ids expire after 7 days; this does not. 184.';

/* Replies look up the quoted message by its wamid, inside one lead's thread. */
create index if not exists crm_lead_messages_pinned_idx
  on public.crm_lead_messages (lead_id) where pinned_at is not null;

-- ── Who may write what ─────────────────────────────────────────────────────
grant select (reply_to_wamid, our_reaction, our_reaction_by_id, our_reaction_at,
              their_reaction, their_reaction_at, pinned_at, pinned_by_id,
              hidden_at, hidden_by_id, delivered_at, read_at, played_at,
              media_path, media_size, media_voice, forwarded)
  on public.crm_lead_messages to cni_app;
grant insert (reply_to_wamid, media_path, media_size, media_voice, forwarded)
  on public.crm_lead_messages to cni_app;
/* ⚠️ ONLY THESE. Nobody rewrites what was said, when, or to whom. */
grant update (our_reaction, our_reaction_by_id, our_reaction_at,
              pinned_at, pinned_by_id, hidden_at, hidden_by_id)
  on public.crm_lead_messages to cni_app;

drop policy if exists crm_lead_messages_update on public.crm_lead_messages;
create policy crm_lead_messages_update on public.crm_lead_messages
  for update to cni_app
  using (exists (select 1 from public.crm_leads l where l.id = crm_lead_messages.lead_id))
  with check (exists (select 1 from public.crm_leads l where l.id = crm_lead_messages.lead_id));

/* ⚠️ WHO DID IT IS STAMPED BY THE DATABASE, not passed in. A server that could
   name anybody as the person who deleted a message would make the placeholder
   "deleted by Sahad" a claim instead of a record. And a delete is final — the
   phone has no undelete either. */
create or replace function app.crm_lead_messages_stamp_actor()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $fn$
declare
  v_me uuid := app.current_user_id();
begin
  if v_me is null then
    return new; -- the owner or a definer (the webhook); nothing to stamp
  end if;
  if new.our_reaction is distinct from old.our_reaction then
    new.our_reaction_by_id := v_me;
    new.our_reaction_at := now();
  end if;
  if new.pinned_at is distinct from old.pinned_at then
    new.pinned_by_id := case when new.pinned_at is null then null else v_me end;
    new.pinned_at := case when new.pinned_at is null then null else now() end;
  end if;
  if old.hidden_at is not null and new.hidden_at is distinct from old.hidden_at then
    raise exception 'A deleted message cannot be restored.' using errcode = 'CRM11';
  end if;
  if new.hidden_at is distinct from old.hidden_at then
    new.hidden_by_id := v_me;
    new.hidden_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists crm_lead_messages_stamp_actor on public.crm_lead_messages;
create trigger crm_lead_messages_stamp_actor
  before update on public.crm_lead_messages
  for each row execute function app.crm_lead_messages_stamp_actor();

-- ════════════════════════════════════════════════════════════════════════════
-- STARS — personal, as on the phone
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_message_stars (
  message_id uuid not null references public.crm_lead_messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.crm_message_stars enable row level security;

create policy crm_message_stars_select on public.crm_message_stars
  for select to cni_app
  using (user_id = (select app.current_user_id())
         and exists (select 1 from public.crm_lead_messages m where m.id = crm_message_stars.message_id));
create policy crm_message_stars_insert on public.crm_message_stars
  for insert to cni_app
  with check (user_id = (select app.current_user_id())
              and exists (select 1 from public.crm_lead_messages m where m.id = crm_message_stars.message_id));
create policy crm_message_stars_delete on public.crm_message_stars
  for delete to cni_app
  using (user_id = (select app.current_user_id()));
grant select, insert, delete on public.crm_message_stars to cni_app;

-- ════════════════════════════════════════════════════════════════════════════
-- SAVED REPLIES
-- ----------------------------------------------------------------------------
-- ⚠️ TEAM REPLIES ARE WRITTEN BY A MANAGER, personal ones by anybody. What goes
-- out under the business's name to every client is the manager's to decide — the
-- same rule 153 applies to sequence templates. The placeholders ({{my_first_name}},
-- {{company}} …) are filled in at the moment of use, so one reply greets as Sarah
-- when Sarah uses it and as Sahad when Sahad does.
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_saved_replies (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('team', 'personal')),
  title         text not null check (btrim(title) <> '' and char_length(title) <= 60),
  shortcut      text check (shortcut is null or shortcut ~ '^[a-z0-9-]{1,24}$'),
  body          text not null check (btrim(body) <> '' and char_length(body) <= 4096),
  sort_order    integer not null default 100,
  is_test_data  boolean not null default false,
  created_by_id uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index crm_saved_replies_scope_idx on public.crm_saved_replies (scope, created_by_id);
alter table public.crm_saved_replies enable row level security;

create or replace function app.crm_writes_team_replies()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.crm_sees_every_lead() or app.crm_manages_own_department()
$$;
revoke all on function app.crm_writes_team_replies() from public;
grant execute on function app.crm_writes_team_replies() to cni_app;

create policy crm_saved_replies_select on public.crm_saved_replies
  for select to cni_app
  using (scope = 'team' or created_by_id = (select app.current_user_id()));
create policy crm_saved_replies_write on public.crm_saved_replies
  for all to cni_app
  using (
    (scope = 'personal' and created_by_id = (select app.current_user_id()))
    or (scope = 'team' and (select app.crm_writes_team_replies()))
  )
  with check (
    (scope = 'personal' and created_by_id = (select app.current_user_id()))
    or (scope = 'team' and (select app.crm_writes_team_replies()))
  );
grant select, insert, update, delete on public.crm_saved_replies to cni_app;

insert into public.crm_saved_replies (scope, title, shortcut, body, sort_order) values
  ('team', 'Greeting', 'greet',
   'AoA Sir, welcome on behalf of {{company}}. I am {{my_first_name}}. Kindly let me know how I can assist you.', 10),
  ('team', 'Greeting by name', 'hi',
   'AoA {{lead_first_name}}, welcome on behalf of {{company}}. I am {{my_first_name}}. Kindly let me know how I can assist you.', 20),
  ('team', 'Quotation shared', 'quote',
   'I have shared the quotation with you. Please review it at your convenience, and let me know if you have any questions — I am happy to go through it with you.', 30),
  ('team', 'Payment plan', 'plan',
   'Here is the payment plan for your reference. Please let me know which option suits you, and I will guide you through the next steps.', 40),
  ('team', 'Call back', 'call',
   'Thank you for your message. I will call you shortly — please let me know a time that suits you.', 50),
  ('team', 'Visit confirmed', 'visit',
   'Your visit is confirmed. Our team will be waiting for you — please share your arrival time, and feel free to call me if you need directions.', 60),
  ('team', 'Thank you', 'thanks',
   'Thank you for your time, {{lead_first_name}}. Please feel free to reach out to me anytime. Regards, {{my_first_name}} — {{company}}.', 70);

-- ════════════════════════════════════════════════════════════════════════════
-- THE WEBHOOK: replies, voice notes, reactions, delivered/read/played times
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists app.crm_record_inbound_message(text, text, text, text, text, text, text, timestamptz);

create or replace function app.crm_record_inbound_message(
  p_from_e164  text,
  p_wamid      text,
  p_kind       text,
  p_body       text,
  p_media_id   text,
  p_media_mime text,
  p_filename   text,
  p_occurred   timestamptz,
  p_reply_to   text default null,
  p_voice      boolean default false
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
     media_filename, occurred_at, reply_to_wamid, media_voice)
  values
    (v_lead, p_wamid, 'inbound',
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[])
           then p_kind else 'unknown' end)::public.crm_message_kind,
     p_body, p_media_id, p_media_mime, p_filename,
     coalesce(p_occurred, now()), p_reply_to, coalesce(p_voice, false))
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform app.crm_notify_lead_replied(v_lead);
  end if;
  return v_id;
end $$;

revoke all on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz,text,boolean) from public;
grant execute on function app.crm_record_inbound_message(text,text,text,text,text,text,text,timestamptz,text,boolean) to cni_app;

/* ⚠️ A REACTION IS NOT A MESSAGE. It lands on the message it reacts to, and only
   when that message belongs to the number that reacted — a wamid alone is not
   proof the reaction is about this lead's conversation. An empty emoji removes it. */
create or replace function app.crm_record_inbound_reaction(
  p_from_e164 text,
  p_target    text,
  p_emoji     text,
  p_at        timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_n    int;
begin
  v_lead := app.crm_lead_for_number(p_from_e164);
  if v_lead is null or p_target is null then
    return false;
  end if;
  update public.crm_lead_messages m
     set their_reaction = nullif(left(coalesce(p_emoji, ''), 16), ''),
         their_reaction_at = coalesce(p_at, now())
   where m.wa_message_id = p_target
     and m.lead_id in (select l.id from public.crm_leads l
                        where l.phone_e164 = (select phone_e164 from public.crm_leads where id = v_lead));
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function app.crm_record_inbound_reaction(text,text,text,timestamptz) from public;
grant execute on function app.crm_record_inbound_reaction(text,text,text,timestamptz) to cni_app;

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
  v_at   timestamptz := coalesce(p_at, now());
begin
  /* Each moment is kept, whatever order Meta delivers them in — Message info
     shows all three, and a late "delivered" must not erase a "read". */
  update public.crm_lead_messages m
     set delivered_at = case when p_status in ('delivered', 'read') then coalesce(m.delivered_at, v_at) else m.delivered_at end,
         read_at      = case when p_status = 'read' then coalesce(m.read_at, v_at) else m.read_at end,
         played_at    = case when p_status = 'played' then coalesce(m.played_at, v_at) else m.played_at end
   where m.wa_message_id = p_wamid;

  v_rank := case p_status when 'sent' then 1 when 'delivered' then 2
                          when 'read' then 3 when 'played' then 3 when 'failed' then 4 else 0 end;
  if v_rank = 0 or p_status = 'played' then
    return false;
  end if;

  update public.crm_lead_messages m
     set status = p_status::public.crm_message_status,
         status_at = v_at,
         error_detail = coalesce(p_detail, m.error_detail)
   where m.wa_message_id = p_wamid
     and (
       m.status is null
       or v_rank > (case m.status::text when 'sent' then 1 when 'delivered' then 2
                                        when 'read' then 3 when 'failed' then 4 else 0 end)
     );
  get diagnostics v_now = row_count;
  return v_now > 0;
end $$;

/* Our stored copy of an attachment — written once, never overwritten. */
create or replace function app.crm_message_store_media(p_message uuid, p_path text, p_size bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  update public.crm_lead_messages
     set media_path = p_path, media_size = coalesce(media_size, p_size)
   where id = p_message and media_path is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function app.crm_message_store_media(uuid, text, bigint) from public;
grant execute on function app.crm_message_store_media(uuid, text, bigint) to cni_app;

-- ============================================================================
-- SELF-CHECK — as cni_app with real people; every fixture rolled back
-- ============================================================================
do $$
declare
  v_lead uuid; v_owner uuid; v_phone text; v_manager uuid; v_outsider uuid;
  v_msg uuid; v_in uuid;
  r_by uuid; r_hidden_by uuid; r_pinned_by uuid;
  n_star_other int; n_team_by_sales int := -1; n_team_by_manager int := -1;
  v_restore text; v_react boolean; v_their text; v_deliv timestamptz; v_read timestamptz; v_status text;
  v_seeded int;
begin
  select l.id, l.owner_id, l.phone_e164 into v_lead, v_owner, v_phone
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.role = 'member' and u.is_active
   where l.is_test_data and l.phone_e164 is not null
     and app.crm_lead_for_number(l.phone_e164) = l.id
   limit 1;
  select id into v_manager from public.users where is_active and department_role = 'manager' and role = 'member' limit 1;
  select u.id into v_outsider from public.users u
   where u.is_active and u.role = 'member' and u.id <> v_owner
     and u.department_id is distinct from (select department_id from public.users where id = v_owner)
   limit 1;
  if v_lead is null or v_manager is null or v_outsider is null then
    raise exception '184 · fixtures missing (lead %, manager %, outsider %) — refusing to skip', v_lead, v_manager, v_outsider;
  end if;

  select count(*) into v_seeded from public.crm_saved_replies where scope = 'team';
  if v_seeded < 7 then
    raise exception '184 · the team replies were not seeded';
  end if;

  begin
    -- An outbound message, as its owner.
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    insert into public.crm_lead_messages (lead_id, wa_message_id, direction, kind, body, status, sent_by_id, occurred_at, reply_to_wamid)
    values (v_lead, '184-self-check-out', 'outbound', 'text', '184', 'sent', v_owner, now(), null)
    returning id into v_msg;

    -- react, pin, hide as the owner; try to spoof the actor
    update public.crm_lead_messages set our_reaction = '👍', our_reaction_by_id = v_manager where id = v_msg;
    update public.crm_lead_messages set pinned_at = now() where id = v_msg;
    update public.crm_lead_messages set hidden_at = now() where id = v_msg;
    select our_reaction_by_id, hidden_by_id, pinned_by_id into r_by, r_hidden_by, r_pinned_by
      from public.crm_lead_messages where id = v_msg;

    -- a delete cannot be undone
    begin
      update public.crm_lead_messages set hidden_at = null where id = v_msg;
      v_restore := 'restored';
    exception when sqlstate 'CRM11' then
      v_restore := 'refused';
    end;

    -- a star is personal
    insert into public.crm_message_stars (message_id, user_id) values (v_msg, v_owner);
    reset role;

    set local role cni_app;
    perform set_config('app.user_id', v_manager::text, true);
    select count(*) into n_star_other from public.crm_message_stars where message_id = v_msg;
    begin
      insert into public.crm_saved_replies (scope, title, body, created_by_id) values ('team', '184', '184', v_manager);
      n_team_by_manager := 1;
    exception when insufficient_privilege then n_team_by_manager := 0;
    end;
    reset role;

    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);
    begin
      insert into public.crm_saved_replies (scope, title, body, created_by_id) values ('team', '184', '184', v_owner);
      n_team_by_sales := 1;
    exception when insufficient_privilege then n_team_by_sales := 0;
    end;
    reset role;

    -- the webhook side: a reply, a reaction to our message, delivery and read
    v_in := app.crm_record_inbound_message(v_phone, '184-self-check-in', 'text', 'ok', null, null, null, now(), '184-self-check-out', false);
    v_react := app.crm_record_inbound_reaction(v_phone, '184-self-check-out', '❤️', now());
    perform app.crm_record_message_status('184-self-check-out', 'read', null, now());
    perform app.crm_record_message_status('184-self-check-out', 'delivered', null, now() - interval '1 minute');
    select their_reaction, delivered_at, read_at, status::text into v_their, v_deliv, v_read, v_status
      from public.crm_lead_messages where id = v_msg;

    raise exception using errcode = 'P0184', message = '184 rollback';
  exception when sqlstate 'P0184' then
    null;
  end;

  if r_by is distinct from v_owner then raise exception '184 · the reaction actor was taken from the caller (got %)', r_by; end if;
  if r_hidden_by is distinct from v_owner then raise exception '184 · the delete was not stamped with its actor'; end if;
  if r_pinned_by is distinct from v_owner then raise exception '184 · the pin was not stamped with its actor'; end if;
  if v_restore is distinct from 'refused' then raise exception '184 · a deleted message was restored'; end if;
  if n_star_other <> 0 then raise exception '184 · another person can see my star'; end if;
  if n_team_by_manager <> 1 then raise exception '184 · a manager could not write a team reply'; end if;
  if n_team_by_sales <> 0 then raise exception '184 · a salesperson wrote a team reply'; end if;
  if v_in is null then raise exception '184 · an inbound reply was not stored'; end if;
  if not v_react or v_their is distinct from '❤️' then raise exception '184 · an inbound reaction did not land (%/%)', v_react, v_their; end if;
  if v_deliv is null or v_read is null or v_status <> 'read' then
    raise exception '184 · status times wrong (delivered %, read %, status %)', v_deliv, v_read, v_status;
  end if;
  if exists (select 1 from public.crm_lead_messages where wa_message_id like '184-self-check%') then
    raise exception '184 · the self-check left messages behind';
  end if;

  raise notice '184 · reactions, pins and deletes are stamped with their real actor; deletes are final; stars are private; team replies are a manager''s; webhook replies, reactions and status times land';
end $$;
