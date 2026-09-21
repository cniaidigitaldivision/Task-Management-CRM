-- ============================================================================
-- 231 · WHAT THE AGENT NEEDS TO DO ITS JOB
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21:
--
--   *"The AI agent is still not selected and it still says 'Needs the knowledge
--   base before it can answer', while I have uploaded the CRM and all those
--   things. Now please properly go and make them work."*
--
--   *"When the client replies and says 'Give me more detail about the CRM', the
--   agent will send a proposal and set a follow-up for the proposal… When the
--   client replies it will auto-close."*
--
--   *"If he is interested in a CRM then the system should be smart enough to show
--   all the CRM-related things in the files of the drawer."*
--
-- Five pieces, each one a thing the agent or the drawer could not do before.
--
--   1 · A DOCUMENT KNOWS ITS PRODUCT. `crm_documents.product` — a CRM proposal
--       is shown to a CRM lead and never to an ERP one (227's four products).
--   2 · A LEAD KNOWS WHAT IT IS INTERESTED IN. `crm_leads.product`, or, until
--       somebody sets it, whatever the campaign and form it came from are
--       called — "CRM Leads Sept" is a CRM lead without anybody saying so.
--   3 · A MESSAGE KNOWS THE AGENT SENT IT. `sent_by_agent`, for the ✦ AI mark.
--   4 · AN AGENT'S FOLLOW-UP CLOSES ITSELF WHEN THE CLIENT ANSWERS.
--       `cancel_on_reply`, and a trigger on every inbound message.
--   5 · EVERY DECISION IS WRITTEN DOWN. `crm_agent_runs` — what it did and why,
--       and a claim so one message is never answered twice.
--
-- ⚠️ THE AGENT RUNS WITH NO PERSON SIGNED IN — from the webhook, under
-- `withAppRole`, where a bare table read returns nothing for anybody
-- (`withapprole-narrows-harder`). So everything it reads and writes goes through
-- the definers at the end of this file, and nothing else.
-- ============================================================================

-- ── 1 · A document knows its product ────────────────────────────────────────
alter table public.crm_documents
  add column if not exists product public.crm_product not null default 'any';

comment on column public.crm_documents.product is
  'Which product this document is about (227). A lead is shown its own product''s documents plus the ones marked any.';

-- ── 2 · A lead knows what it wants ──────────────────────────────────────────
alter table public.crm_leads
  add column if not exists product public.crm_product;

comment on column public.crm_leads.product is
  'What the lead is interested in, when somebody (or the agent) has said so. Null = work it out from the campaign — app.crm_lead_product.';

/*
 * ⚠️ THE ORDER OF THE WORDS IS THE RULE. "CRM with WhatsApp automation" is a CRM
 * lead; "ERP" must be tested before "CRM" never matters, but "whatsapp" must be
 * tested LAST, because nearly every campaign here mentions WhatsApp as the
 * channel rather than the product.
 */
create or replace function app.crm_product_from_words(p_words text)
returns public.crm_product
language sql
immutable
as $fn$
  select case
    when p_words is null then null
    when p_words ~* '\merp\M|inventory'  then 'erp'::public.crm_product
    when p_words ~* 'taskly'             then 'taskly'::public.crm_product
    when p_words ~* '\mcrm\M|lead management' then 'crm'::public.crm_product
    when p_words ~* 'whats\s*app\s*(automation|api|business)' then 'whatsapp'::public.crm_product
    else null
  end
$fn$;

create or replace function app.crm_lead_product(p_lead uuid)
returns public.crm_product
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select coalesce(
           l.product,
           s.product,
           app.crm_product_from_words(concat_ws(' ', c.name, f.name, f.sells, l.source_detail)))
    from public.crm_leads l
    left join public.crm_project_settings s on s.project_id = l.project_id
    left join public.crm_campaigns c on c.id = l.campaign_id
    left join public.crm_lead_forms f on f.id = l.form_id
   where l.id = p_lead
$fn$;

grant execute on function app.crm_lead_product(uuid) to cni_app;

-- ── 3 · The agent's own messages ────────────────────────────────────────────
alter table public.crm_lead_messages
  add column if not exists sent_by_agent boolean not null default false;

comment on column public.crm_lead_messages.sent_by_agent is
  'The AI agent wrote and sent this. Shown with the ✦ AI mark, exactly as WhatsApp Business shows its own agent.';

-- ── 4 · An agent's follow-up closes itself when they answer ─────────────────
alter table public.crm_follow_ups
  add column if not exists cancel_on_reply boolean not null default false;

comment on column public.crm_follow_ups.cancel_on_reply is
  'Cancelled the moment the client writes. Set on every follow-up the agent schedules — a chase is pointless once they answered.';

create or replace function app.crm_cancel_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  if new.direction <> 'inbound' then
    return null;
  end if;
  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'They replied before it was due, so it was not needed.',
         updated_at = now()
   where lead_id = new.lead_id
     and cancel_on_reply
     and status in ('planned', 'due');
  return null;
end;
$fn$;

drop trigger if exists crm_lead_messages_cancel_on_reply on public.crm_lead_messages;
create trigger crm_lead_messages_cancel_on_reply
  after insert on public.crm_lead_messages
  for each row execute function app.crm_cancel_on_reply();

-- ── 5 · Every decision, written down ────────────────────────────────────────
create table if not exists public.crm_agent_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  /* ⚠️ UNIQUE: one inbound message is answered once, however many times Meta
     redelivers it or however many workers race for it. */
  message_id uuid not null unique references public.crm_lead_messages(id) on delete cascade,
  action text not null default 'claimed'
    check (action in ('claimed', 'replied', 'handed_over', 'skipped', 'superseded', 'failed')),
  reason text,
  detail jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_agent_runs is
  'One row per inbound message the AI agent looked at: what it did and why. The claim that stops a message being answered twice.';

create index if not exists crm_agent_runs_lead_idx on public.crm_agent_runs (lead_id, created_at desc);

alter table public.crm_agent_runs enable row level security;

/* ⚠️ READ THROUGH THE LEAD — a salesperson sees why the agent did what it did
   on their own leads, and on nobody else's. Written only by the definers. */
drop policy if exists crm_agent_runs_select on public.crm_agent_runs;
create policy crm_agent_runs_select on public.crm_agent_runs
  for select using (exists (select 1 from public.crm_leads l where l.id = lead_id));

grant select on public.crm_agent_runs to cni_app;


-- ============================================================================
-- THE AGENT'S OWN DOORS
-- ============================================================================

/* May this project's leads be answered by the agent? Only once a person has
   approved something for it to say. */
create or replace function app.crm_agent_ready(p_project uuid)
returns integer
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select count(*)::integer
    from public.crm_knowledge k
   where k.project_id = p_project
     and k.status = 'approved'
     and (k.expires_at is null or k.expires_at >= (now() at time zone 'Asia/Karachi')::date)
$fn$;

grant execute on function app.crm_agent_ready(uuid) to cni_app;

/* Claim a message. False = somebody else already has it. */
create or replace function app.crm_agent_claim(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead uuid;
  v_n integer;
begin
  select lead_id into v_lead from public.crm_lead_messages
   where id = p_message and direction = 'inbound';
  if v_lead is null then
    return false;
  end if;
  insert into public.crm_agent_runs (lead_id, message_id) values (v_lead, p_message)
  on conflict (message_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_agent_claim(uuid) to cni_app;

create or replace function app.crm_agent_log(p_message uuid, p_action text, p_reason text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  update public.crm_agent_runs
     set action = p_action, reason = p_reason, detail = p_detail, updated_at = now()
   where message_id = p_message
$fn$;

grant execute on function app.crm_agent_log(uuid, text, text, jsonb) to cni_app;

/*
 * Everything the agent needs to know about the message it is answering.
 *
 * ⚠️ `newest_inbound` IS HOW A BURST IS ANSWERED ONCE. A client who sends three
 * lines in a row triggers three runs; each waits a few seconds and only the one
 * holding the NEWEST message answers — reading all three.
 */
create or replace function app.crm_agent_context(p_message uuid)
returns table(
  lead_id uuid, lead_name text, phone text, project_id uuid, project_name text,
  phone_number_id text, business text, owner_id uuid, agent_mode text,
  handoff_at timestamptz, window_open boolean, product text,
  message_kind text, message_body text, message_voice boolean,
  newest_inbound uuid, agent_run_length integer, stage text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select l.id, l.full_name, l.phone_e164, p.id, p.name,
         p.whatsapp_phone_number_id,
         coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name),
         l.owner_id, l.agent_mode::text, l.agent_handoff_at,
         app.crm_window_is_open(l.id),
         app.crm_lead_product(l.id)::text,
         m.kind::text, m.body, m.media_voice,
         (select i.id from public.crm_lead_messages i
           where i.lead_id = l.id and i.direction = 'inbound' and i.hidden_at is null
           order by i.occurred_at desc, i.created_at desc limit 1),
         /* How many messages the agent has sent since a PERSON last wrote. */
         (select count(*)::integer from public.crm_lead_messages a
           where a.lead_id = l.id and a.direction = 'outbound' and a.sent_by_agent
             and a.occurred_at > coalesce(
               (select max(h.occurred_at) from public.crm_lead_messages h
                 where h.lead_id = l.id and h.direction = 'outbound' and h.sent_by_id is not null),
               '-infinity'::timestamptz)),
         l.stage::text
    from public.crm_lead_messages m
    join public.crm_leads l on l.id = m.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
   where m.id = p_message
$fn$;

grant execute on function app.crm_agent_context(uuid) to cni_app;

create or replace function app.crm_agent_thread(p_lead uuid, p_limit integer default 30)
returns table(direction text, kind text, body text, media_filename text, occurred_at timestamptz, sent_by_agent boolean)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select t.direction, t.kind, t.body, t.media_filename, t.occurred_at, t.sent_by_agent
    from (
      select m.direction::text as direction, m.kind::text as kind, m.body, m.media_filename,
             m.occurred_at, m.sent_by_agent
        from public.crm_lead_messages m
       where m.lead_id = p_lead and m.hidden_at is null and m.channel = 'whatsapp'
       order by m.occurred_at desc
       limit greatest(1, least(p_limit, 60))
    ) t
   order by t.occurred_at
$fn$;

grant execute on function app.crm_agent_thread(uuid, integer) to cni_app;

/* The documents the agent may send: this project's shared ones, for this
   product or for any. Never another lead's own file. */
create or replace function app.crm_agent_documents(p_project uuid, p_product text)
returns table(id uuid, title text, kind text, product text, storage_path text, mime text, size_bytes bigint)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select d.id, d.title, d.kind::text, d.product::text, d.storage_path, d.mime, d.size_bytes
    from public.crm_documents d
   where d.project_id = p_project
     and d.lead_id is null
     and d.kind <> 'letterhead'
     and (d.product = 'any' or p_product is null or d.product::text = p_product)
   order by d.kind, d.created_at desc
$fn$;

grant execute on function app.crm_agent_documents(uuid, text) to cni_app;

/* Record what the agent sent, marked as the agent's. */
create or replace function app.crm_agent_record_message(
  p_lead uuid, p_wamid text, p_kind text, p_body text,
  p_media_mime text default null, p_media_filename text default null,
  p_media_path text default null, p_media_size bigint default null, p_error text default null
) returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_id uuid;
begin
  insert into public.crm_lead_messages
    (lead_id, wa_message_id, direction, kind, body, media_mime, media_filename,
     media_path, media_size, status, error_detail, occurred_at, sent_by_agent)
  values
    (p_lead, p_wamid, 'outbound',
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[]) then p_kind else 'text' end)::public.crm_message_kind,
     p_body, p_media_mime, p_media_filename, p_media_path, p_media_size,
     case when p_error is null then 'sent' else 'failed' end::public.crm_message_status,
     p_error, now(), true)
  returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function app.crm_agent_record_message(uuid, text, text, text, text, text, text, bigint, text) to cni_app;

/*
 * The agent schedules ONE follow-up, and it closes itself if they answer.
 *
 * ⚠️ ONE AT A TIME. A new agent follow-up replaces any earlier one still
 * waiting — "follow up on the proposal" and then "follow up on the quotation"
 * is one chase, about the newest thing.
 *
 * ⚠️ AT 11 AM KARACHI, N DAYS OUT — never "exactly 48 hours after a message
 * sent at 11 PM".
 */
create or replace function app.crm_agent_schedule_follow_up(
  p_lead uuid, p_purpose text, p_days integer, p_title text, p_body text,
  p_template text, p_language text, p_vars text[]
) returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_owner uuid;
  v_id uuid;
  v_days integer := greatest(1, least(14, coalesce(p_days, 2)));
begin
  select owner_id into v_owner from public.crm_leads where id = p_lead;

  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Replaced by a newer follow-up the agent set.',
         updated_at = now()
   where lead_id = p_lead and cancel_on_reply and status in ('planned', 'due');

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id, wa_template_name, wa_template_language, wa_template_vars,
     cancel_on_reply)
  values
    (p_lead, p_purpose::public.crm_followup_purpose, 'whatsapp', 'auto_send', 'planned',
     left(coalesce(nullif(btrim(p_title), ''), 'Follow-up set by the AI agent'), 120),
     p_body,
     ((now() at time zone 'Asia/Karachi')::date + v_days + time '11:00') at time zone 'Asia/Karachi',
     v_owner, null, nullif(p_template, ''), nullif(p_language, ''), p_vars, true)
  returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function app.crm_agent_schedule_follow_up(uuid, text, integer, text, text, text, text, text[]) to cni_app;

/* The agent may record what the lead turned out to want — once, never over a
   person's choice. */
create or replace function app.crm_agent_note_product(p_lead uuid, p_product text)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  update public.crm_leads
     set product = p_product::public.crm_product
   where id = p_lead and product is null
     and p_product in ('taskly', 'crm', 'erp', 'whatsapp')
$fn$;

grant execute on function app.crm_agent_note_product(uuid, text) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_msg uuid; v_msg2 uuid; v_f uuid;
  s_after text; c1 boolean; c2 boolean; v_prod text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '231 · fixtures missing';
  end if;

  /* The words decide the product, WhatsApp last. */
  if app.crm_product_from_words('CRM + WhatsApp automation leads') is distinct from 'crm'
     or app.crm_product_from_words('ERP inventory campaign') is distinct from 'erp'
     or app.crm_product_from_words('Taskly launch') is distinct from 'taskly'
     or app.crm_product_from_words('WhatsApp Business API automation') is distinct from 'whatsapp'
     or app.crm_product_from_words('Chat with us on WhatsApp') is not null
     or app.crm_product_from_words('Scrm is not a word') is not null then
    raise exception '231 · the product was read wrongly from a campaign name';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data, source_detail)
    values (v_project, 'manual', 'SELFCHECK-231', '+923000000231', '+923000000231', 'contacted', now(), v_owner, true, 'CRM leads form')
    returning id into v_lead;
    select app.crm_lead_product(v_lead)::text into v_prod;

    /* An agent follow-up, then the client writes: it closes itself. */
    select app.crm_agent_schedule_follow_up(v_lead, 'proposal', 2, 'Proposal follow-up', 'x',
             'proposal_follow_up', 'en_GB', array['lead_first_name', 'company']) into v_f;
    insert into public.crm_lead_messages (lead_id, direction, kind, body, wa_message_id)
    values (v_lead, 'inbound', 'text', 'thanks, looking at it', 'selfcheck-231-a')
    returning id into v_msg;
    select status::text into s_after from public.crm_follow_ups where id = v_f;

    /* A message is claimed once. */
    select app.crm_agent_claim(v_msg) into c1;
    select app.crm_agent_claim(v_msg) into c2;

    raise exception using errcode = 'P0231', message = '231 rollback';
  exception when sqlstate 'P0231' then
    null;
  end;

  if v_prod is distinct from 'crm' and v_prod is distinct from (select product::text from public.crm_project_settings where project_id = v_project) then
    raise exception '231 · a lead from a CRM form was not recognised as a CRM lead (got %)', v_prod;
  end if;
  if s_after is distinct from 'cancelled' then
    raise exception '231 · the agent''s follow-up did not close when the client replied (status %)', s_after;
  end if;
  if not c1 or c2 then
    raise exception '231 · a message could be claimed twice (first %, second %)', c1, c2;
  end if;

  raise notice '231 · documents and leads know their product, and the agent''s follow-ups close when the client answers';
end $chk$;
