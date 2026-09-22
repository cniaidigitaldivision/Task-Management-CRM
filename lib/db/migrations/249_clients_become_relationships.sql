-- ============================================================================
-- 249 · CLIENTS BECOME RELATIONSHIPS
-- ----------------------------------------------------------------------------
-- Owner's design, 2026-09-22: a Clients page with total / active / new /
-- needs-attention / outstanding cards; Active, Prospects, Needs attention,
-- Dormant and Archived tabs; project, owner and relationship filters; a
-- preview carrying value, open deals, last contact, next follow-up, the linked
-- project and every related record; Add client with duplicate detection;
-- import and export.
--
-- ── WHAT A CLIENT IS, AND STAYS ────────────────────────────────────────────
-- A person (`crm_clients`), linked to projects THROUGH their leads — migration
-- 111's rule, kept: one person enquiring about two things is one client. So:
--   · Visibility still follows the leads (126's rule, unchanged in meaning).
--   · The related records — properties, quotations, appointments, bookings,
--     invoices — are read through those leads, because every one of those
--     tables carries a lead_id and none carries a client_id.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- Relationship fields on the client (company, source, account owner,
-- preferred channel, status, archive, a readable number), one reader for the
-- page, and the three writes it needs.
--
-- ── ⚠️ A CLIENT ADDED BY HAND GETS A LEAD, AND THE LEAD IS NOT "WON" ───────
-- Without a lead a client is invisible to every salesperson and belongs to no
-- project. With a WON lead, a person typed in on this page would count as a
-- sale in every lead report, and would skip the qualification rule (CRM08)
-- that exists precisely so nothing jumps to won unasked. So the lead opens as
-- `contacted`, and the RELATIONSHIP status lives on the client. When they buy,
-- the lead is marked won on the desk as it always was.
--
-- ── ⚠️⚠️ AND IT IS NOT GREETED ─────────────────────────────────────────────
-- `crm_greet_new_lead` sends the project's WhatsApp greeting to any new lead
-- with a phone number. Adding an existing client — or importing a sheet of
-- them — would message real people a welcome they never asked for; the
-- trigger's own comment calls that "the single incident §5 of the guardrails is
-- about". It now stands down when the transaction says `app.crm_quiet_insert`,
-- and the Clients page sets that unless somebody explicitly ticks "send the
-- greeting". Imports are always quiet.
--
-- ── ⚠️ NOT PER ROW (law 5) ─────────────────────────────────────────────────
-- 126's reader calls `app.crm_manages_project(l.project_id)` for every lead. The
-- page reader asks once per PROJECT and tests membership per lead.
-- ============================================================================

-- ── 1 · The relationship fields ─────────────────────────────────────────────

create sequence if not exists public.crm_client_ref_seq start 1001;

alter table public.crm_clients
  add column if not exists company           text,
  add column if not exists source            public.crm_lead_source,
  add column if not exists owner_id          uuid references public.users(id) on delete set null,
  add column if not exists preferred_channel text,
  add column if not exists status            text not null default 'active',
  add column if not exists archived_at       timestamptz,
  add column if not exists created_by_id     uuid references public.users(id) on delete set null,
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists ref_no            integer;

update public.crm_clients set ref_no = nextval('public.crm_client_ref_seq') where ref_no is null;
alter table public.crm_clients alter column ref_no set default nextval('public.crm_client_ref_seq');

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_status_ck') then
    alter table public.crm_clients add constraint crm_clients_status_ck
      check (status in ('prospect', 'onboarding', 'active', 'dormant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_channel_ck') then
    alter table public.crm_clients add constraint crm_clients_channel_ck
      check (preferred_channel is null or preferred_channel in ('whatsapp', 'call', 'email'));
  end if;
end
$c$;

create unique index if not exists crm_clients_ref_no_key on public.crm_clients (ref_no);

comment on column public.crm_clients.status is
  '249 · the RELATIONSHIP, set by a person. "Needs attention" and "Dormant" are also computed on read; see app.crm_client_board.';

-- The three there already bought: their owner and source come from that lead.
update public.crm_clients c
   set owner_id = coalesce(c.owner_id, (
         select l.owner_id from public.crm_leads l
          where l.client_id = c.id order by (l.stage = 'won') desc, l.submitted_at desc limit 1)),
       source   = coalesce(c.source, (
         select l.source from public.crm_leads l
          where l.client_id = c.id order by (l.stage = 'won') desc, l.submitted_at desc limit 1));

-- ── 2 · The greeting stands down for a quiet insert ─────────────────────────
-- Injected into the live definition rather than retyped, so nothing else in a
-- trigger that decides whether a real person gets a message is changed by hand.
do $g$
declare
  d text;
begin
  select pg_get_functiondef('app.crm_greet_new_lead()'::regprocedure) into d;
  if position('crm_quiet_insert' in d) = 0 then
    d := regexp_replace(
      d,
      /* CRLF-safe: this function was created from a Windows file, so its stored
         body ends lines with CR LF, and a pattern for LF alone matched nothing. */
      E'\\r?\\nbegin\\r?\\n',
      E'\nbegin\n  /* 249 · A QUIET INSERT IS NOT AN ARRIVAL: a client typed in or imported on\n     the Clients page is not greeted unless somebody asked for it. */\n  if coalesce(current_setting(''app.crm_quiet_insert'', true), '''') = ''on'' then\n    return null;\n  end if;\n'
    );
    execute d;
  end if;
end
$g$;

-- ── 3 · Visibility, once ────────────────────────────────────────────────────

create or replace function app.crm_client_visible(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select exists (
    select 1 from public.crm_leads l
     where l.client_id = p_client
       and l.archived_at is null
       and (app.crm_manages_project(l.project_id)
            or (app.crm_in_project_department(l.project_id) and l.owner_id = app.current_user_id()))
  )
$fn$;

-- ── 4 · The page reader ─────────────────────────────────────────────────────

create or replace function app.crm_client_board()
returns table (
  id uuid, ref_no integer, full_name text, company text, phone_e164 text, email text, city text,
  notes text, source text, preferred_channel text, status text, archived_at timestamptz,
  created_at timestamptz, owner_id uuid, owner_name text,
  lead_ids uuid[], primary_lead_id uuid, primary_project_id uuid, primary_project_name text,
  project_names text[], lead_stage text, open_deals integer, won_leads integer,
  last_contact_at timestamptz, last_direction text,
  next_at timestamptz, next_kind text, next_label text,
  properties integer, quotations integer, appointments integer, bookings integer, invoices integer,
  unpaid_invoices integer, unpaid_amount numeric, overdue_invoices integer,
  booked_value numeric, quoted_value numeric
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  with me as (select app.current_user_id() as uid),
  /* ⚠️ ONCE PER PROJECT, NOT PER LEAD (law 5). */
  proj as (
    select p.id, p.name,
           app.crm_manages_project(p.id) as manages,
           app.crm_in_project_department(p.id) as dept
      from public.projects p
     where p.id in (select distinct x.project_id from public.crm_leads x where x.client_id is not null)
  ),
  vl as (
    select l.id, l.client_id, l.project_id, l.owner_id, l.stage, l.submitted_at, l.property_id,
           l.next_action_at, l.next_action, l.next_action_type
      from public.crm_leads l
      join proj on proj.id = l.project_id
      cross join me
     where l.client_id is not null
       and l.archived_at is null
       and (proj.manages or (proj.dept and l.owner_id = me.uid))
  ),
  msg as (
    select m.lead_id,
           max(m.occurred_at) as last_at,
           (array_agg(m.direction::text order by m.occurred_at desc, m.id desc))[1] as last_dir
      from public.crm_lead_messages m
     where m.lead_id in (select vl.id from vl)
     group by m.lead_id
  ),
  quo as (
    select q.lead_id, count(*)::int as n,
           coalesce(sum(q.net_amount) filter (where q.status in ('approved', 'sent')), 0) as live_value
      from public.crm_quotations q
     where q.lead_id in (select vl.id from vl) and q.status <> 'superseded'
     group by q.lead_id
  ),
  bk as (
    select b.lead_id,
           count(*) filter (where b.status <> 'cancelled')::int as n,
           coalesce(sum(b.amount) filter (where b.status <> 'cancelled'), 0) as value
      from public.crm_bookings b
     where b.lead_id in (select vl.id from vl)
     group by b.lead_id
  ),
  inv as (
    select i.lead_id,
           count(*) filter (where i.status <> 'void')::int as n,
           count(*) filter (where i.status in ('unpaid', 'part_paid'))::int as unpaid,
           coalesce(sum(i.amount - coalesce(i.paid_amount, 0)) filter (where i.status in ('unpaid', 'part_paid')), 0) as owed,
           count(*) filter (where i.status in ('unpaid', 'part_paid')
                             and i.due_at < (now() at time zone 'Asia/Karachi')::date)::int as overdue
      from public.crm_invoices i
     where i.lead_id in (select vl.id from vl)
     group by i.lead_id
  ),
  ap as (
    select a.lead_id, count(*)::int as n,
           min(a.scheduled_at) filter (where a.status in ('scheduled', 'confirmed') and a.scheduled_at >= now()) as next_at
      from public.crm_appointments a
     where a.lead_id in (select vl.id from vl)
     group by a.lead_id
  ),
  fu as (
    select f.lead_id, min(f.due_at) filter (where f.status in ('planned', 'due')) as next_at
      from public.crm_follow_ups f
     where f.lead_id in (select vl.id from vl)
     group by f.lead_id
  ),
  props as (
    select vl.client_id, count(distinct x.pid)::int as n
      from vl
      cross join lateral (
        select vl.property_id as pid
        union select q.property_id from public.crm_quotations q where q.lead_id = vl.id
        union select b.property_id from public.crm_bookings b where b.lead_id = vl.id and b.status <> 'cancelled'
      ) x
     where x.pid is not null
     group by vl.client_id
  ),
  /* The soonest thing owed on any of the client's leads — past ones included,
     because an overdue call is exactly what "needs attention" means. */
  nxt as (
    select distinct on (vl.client_id) vl.client_id, x.at, x.kind, x.label
      from vl
      left join fu on fu.lead_id = vl.id
      left join ap on ap.lead_id = vl.id
      cross join lateral (values
        (vl.next_action_at, coalesce(vl.next_action_type::text, 'task'), vl.next_action),
        (fu.next_at, 'follow_up', 'Follow-up'),
        (ap.next_at, 'appointment', 'Appointment')
      ) x(at, kind, label)
     where x.at is not null
     order by vl.client_id, x.at asc
  ),
  per_client as (
    select vl.client_id,
           array_agg(vl.id order by coalesce(msg.last_at, vl.submitted_at) desc) as lead_ids,
           (array_agg(vl.id order by coalesce(msg.last_at, vl.submitted_at) desc))[1] as primary_lead,
           (array_agg(vl.project_id order by coalesce(msg.last_at, vl.submitted_at) desc))[1] as primary_project,
           (array_agg(vl.owner_id order by coalesce(msg.last_at, vl.submitted_at) desc))[1] as primary_owner,
           (array_agg(vl.stage::text order by coalesce(msg.last_at, vl.submitted_at) desc))[1] as primary_stage,
           array_agg(distinct proj.name) as project_names,
           count(*) filter (where vl.stage not in ('won', 'lost'))::int as open_deals,
           count(*) filter (where vl.stage = 'won')::int as won_leads,
           max(msg.last_at) as last_at,
           (array_agg(msg.last_dir order by msg.last_at desc nulls last))[1] as last_dir,
           coalesce(sum(quo.n), 0)::int as quotations,
           coalesce(sum(quo.live_value), 0) as quoted_value,
           coalesce(sum(bk.n), 0)::int as bookings,
           coalesce(sum(bk.value), 0) as booked_value,
           coalesce(sum(inv.n), 0)::int as invoices,
           coalesce(sum(inv.unpaid), 0)::int as unpaid,
           coalesce(sum(inv.owed), 0) as owed,
           coalesce(sum(inv.overdue), 0)::int as overdue,
           coalesce(sum(ap.n), 0)::int as appointments
      from vl
      join proj on proj.id = vl.project_id
      left join msg on msg.lead_id = vl.id
      left join quo on quo.lead_id = vl.id
      left join bk on bk.lead_id = vl.id
      left join inv on inv.lead_id = vl.id
      left join ap on ap.lead_id = vl.id
     group by vl.client_id
  )
  select c.id, c.ref_no, c.full_name, c.company, c.phone_e164, c.email, c.city,
         c.notes, c.source::text, c.preferred_channel, c.status, c.archived_at,
         c.created_at,
         coalesce(c.owner_id, pc.primary_owner),
         (select u.full_name from public.users u where u.id = coalesce(c.owner_id, pc.primary_owner)),
         pc.lead_ids, pc.primary_lead, pc.primary_project,
         (select proj.name from proj where proj.id = pc.primary_project),
         pc.project_names, pc.primary_stage, pc.open_deals, pc.won_leads,
         pc.last_at, pc.last_dir,
         nxt.at, nxt.kind, nxt.label,
         coalesce(props.n, 0), pc.quotations, pc.appointments, pc.bookings, pc.invoices,
         pc.unpaid, pc.owed, pc.overdue,
         pc.booked_value, pc.quoted_value
    from per_client pc
    join public.crm_clients c on c.id = pc.client_id
    left join nxt on nxt.client_id = c.id
    left join props on props.client_id = c.id
   order by c.created_at desc
   limit 2000
$fn$;

-- ── 5 · What happened with this client, newest first ────────────────────────

create or replace function app.crm_client_activity(p_client uuid, p_limit integer default 15)
returns table (occurred_at timestamptz, kind text, title text, detail text, lead_id uuid)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  with vl as (
    select l.id from public.crm_leads l
     where l.client_id = p_client
       and l.archived_at is null
       and app.crm_client_visible(p_client)
  )
  select * from (
    /* The lead's own log — minus the importer's noise. */
    select a.occurred_at, a.kind::text,
           case a.kind::text
             when 'created'         then 'Added'
             when 'assigned'        then 'Assigned'
             when 'stage_changed'   then 'Stage changed'
             when 'note_added'      then 'Note added'
             when 'call_attempted'  then 'Call attempted'
             when 'call_connected'  then 'Call connected'
             when 'call_no_answer'  then 'Call — no answer'
             when 'whatsapp_sent'   then 'WhatsApp sent'
             when 'email_sent'      then 'Email sent'
             when 'won'             then 'Marked won'
             when 'lost'            then 'Marked lost'
             when 'temperature_set' then 'Temperature set'
             when 'next_action_set' then 'Next step set'
             else initcap(replace(a.kind::text, '_', ' '))
           end,
           coalesce(nullif(a.outcome, ''), (select u.full_name from public.users u where u.id = a.actor_id)),
           a.lead_id
      from public.crm_lead_activity a
     where a.lead_id in (select id from vl) and a.kind::text <> 'imported'
    union all
    select coalesce(q.approved_at, q.sent_at, q.created_at), 'quotation',
           'Quotation ' || q.number || ' ' || replace(q.status::text, '_', ' '),
           (select u.full_name from public.users u where u.id = coalesce(q.approved_by_id, q.prepared_by_id)),
           q.lead_id
      from public.crm_quotations q
     where q.lead_id in (select id from vl) and q.status <> 'superseded'
    union all
    select b.created_at, 'booking', 'Booking ' || coalesce(b.number, '') || ' ' || replace(b.status::text, '_', ' '),
           null, b.lead_id
      from public.crm_bookings b where b.lead_id in (select id from vl)
    union all
    select i.created_at, 'invoice', 'Invoice ' || coalesce(i.number, '') || ' ' || replace(i.status::text, '_', ' '),
           null, i.lead_id
      from public.crm_invoices i where i.lead_id in (select id from vl)
    union all
    /* A conversation is one line per day, not one per message. */
    select max(m.occurred_at), 'conversation',
           (case when bool_or(m.channel = 'email') and not bool_or(m.channel = 'whatsapp') then 'Email' else 'WhatsApp' end)
             || ' conversation',
           count(*)::text || ' message' || case when count(*) = 1 then '' else 's' end,
           m.lead_id
      from public.crm_lead_messages m
     where m.lead_id in (select id from vl)
     group by m.lead_id, (m.occurred_at at time zone 'Asia/Karachi')::date
  ) x(occurred_at, kind, title, detail, lead_id)
  where x.occurred_at is not null
  order by x.occurred_at desc
  limit greatest(1, least(p_limit, 50))
$fn$;

-- ── 6 · Add a client — a lead on the project, quiet by default ──────────────

create or replace function app.crm_add_client(
  p_project uuid, p_full_name text, p_phone text, p_phone_e164 text, p_email text,
  p_city text, p_company text, p_source text, p_owner uuid, p_channel text,
  p_status text, p_notes text, p_greet boolean default false
)
returns table (client_id uuid, lead_id uuid, owner_id uuid, owner_name text, ref_no integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_actor uuid := app.current_user_id();
  v_name  text := nullif(trim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone_e164, '')), '');
  v_raw   text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_owner uuid;
  v_client uuid;
  v_lead uuid;
  v_ref integer;
  v_clash record;
begin
  if v_actor is null then
    raise exception 'No acting user.' using errcode = 'CR249';
  end if;
  if not app.crm_in_project_department(p_project) and not app.crm_manages_project(p_project) then
    raise exception 'You cannot add clients to this project.' using errcode = 'CR249';
  end if;
  if v_name is null then
    raise exception 'A client needs a name.' using errcode = 'CR249';
  end if;
  if v_raw is null and v_email is null then
    raise exception 'Add a phone number or an email — there is no way to reach this client otherwise.' using errcode = 'CR249';
  end if;
  if coalesce(p_status, 'active') not in ('prospect', 'onboarding', 'active', 'dormant') then
    raise exception 'That is not a relationship status.' using errcode = 'CR249';
  end if;
  if p_channel is not null and p_channel not in ('whatsapp', 'call', 'email') then
    raise exception 'That is not a way to reach somebody.' using errcode = 'CR249';
  end if;

  /* ⚠️ ONLY A MANAGER HANDS A CLIENT TO SOMEBODY ELSE — the same rule
     `crm_guard_reassign` enforces on leads. */
  v_owner := coalesce(p_owner, v_actor);
  if v_owner <> v_actor and not app.crm_manages_project(p_project) then
    raise exception 'Only a manager of this project can assign a client to somebody else.' using errcode = 'CR249';
  end if;
  if not exists (select 1 from public.users u where u.id = v_owner and u.is_active) then
    raise exception 'That salesperson is not an active user.' using errcode = 'CR249';
  end if;

  /* ⚠️ DUPLICATES ARE REFUSED HERE, NOT ONLY WARNED ABOUT ON THE FORM. The same
     number is the same person (126's rule), and two client rows for one person
     would split their history in two. */
  select c.id, c.full_name into v_clash
    from public.crm_clients c
   where (v_phone is not null and c.phone_e164 = v_phone)
      or (v_email is not null and lower(c.email) = v_email)
   limit 1;
  if v_clash.id is not null then
    raise exception 'This person is already a client (%).', v_clash.full_name using errcode = 'CR249';
  end if;
  select l.id, coalesce(o.full_name, 'somebody who has since left') as owner_name into v_clash
    from public.crm_leads l
    left join public.users o on o.id = l.owner_id
   where l.project_id = p_project
     and l.stage not in ('won', 'lost')
     and l.archived_at is null
     and ((v_phone is not null and l.phone_e164 = v_phone)
       or (v_email is not null and lower(l.email) = v_email))
   limit 1;
  if v_clash.id is not null then
    raise exception 'This person already has an open lead on this project, with %. Make that lead the client instead of adding a second one.',
      v_clash.owner_name using errcode = 'CR249';
  end if;

  insert into public.crm_clients
    (full_name, phone_e164, email, city, company, source, owner_id, preferred_channel,
     status, notes, first_lead_at, converted_by_id, created_by_id)
  values
    (v_name, v_phone, v_email, nullif(trim(coalesce(p_city, '')), ''),
     nullif(trim(coalesce(p_company, '')), ''),
     coalesce(nullif(p_source, ''), 'manual')::public.crm_lead_source,
     v_owner, p_channel, coalesce(p_status, 'active'),
     nullif(trim(coalesce(p_notes, '')), ''), now(), v_actor, v_actor)
  returning id, crm_clients.ref_no into v_client, v_ref;

  if not coalesce(p_greet, false) then
    perform set_config('app.crm_quiet_insert', 'on', true);
  end if;

  /* ⚠️ `contacted`, WITH first_contacted_at: they are somebody we already talk
     to. No first-response clock (crm_stamp_first_response_due skips it), no
     rota (the owner is set), and not won — see the header. */
  insert into public.crm_leads
    (project_id, full_name, phone, phone_e164, email, city, source, source_detail,
     owner_id, client_id, stage, submitted_at, first_contacted_at, created_by_id,
     preferred_channel)
  values
    (p_project, v_name, v_raw, v_phone, v_email, nullif(trim(coalesce(p_city, '')), ''),
     coalesce(nullif(p_source, ''), 'manual')::public.crm_lead_source,
     'Added on the Clients page', v_owner, v_client, 'contacted', now(), now(), v_actor,
     case p_channel when 'whatsapp' then 'whatsapp'::public.crm_followup_channel
                    when 'email' then 'email'::public.crm_followup_channel
                    when 'call' then 'call'::public.crm_followup_channel end)
  returning id into v_lead;

  perform set_config('app.crm_quiet_insert', '', true);

  insert into public.crm_lead_assignments (lead_id, to_user_id, from_user_id, decided_by_id, rule, reason_text)
  values (v_lead, v_owner, null, v_actor, 'manual',
          'Added as a client on the Clients page by '
            || coalesce((select full_name from public.users where id = v_actor), 'a colleague') || '.');

  return query
    select v_client, v_lead, v_owner, (select u.full_name from public.users u where u.id = v_owner), v_ref;
end;
$fn$;

-- ── 7 · Edit, archive, reassign ─────────────────────────────────────────────

create or replace function app.crm_update_client(
  p_client uuid, p_full_name text, p_company text, p_phone_e164 text, p_email text,
  p_city text, p_source text, p_owner uuid, p_channel text, p_status text, p_notes text,
  p_archive boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_actor uuid := app.current_user_id();
  v_now record;
  v_manages boolean;
begin
  if v_actor is null or not app.crm_client_visible(p_client) then
    raise exception 'That client could not be found.' using errcode = 'CR249';
  end if;
  select * into v_now from public.crm_clients where id = p_client for update;

  select bool_or(app.crm_manages_project(l.project_id)) into v_manages
    from public.crm_leads l where l.client_id = p_client;

  if p_owner is not null and p_owner is distinct from v_now.owner_id and not coalesce(v_manages, false) then
    raise exception 'Only a manager of this client''s project can change who looks after them.' using errcode = 'CR249';
  end if;
  if p_status is not null and p_status not in ('prospect', 'onboarding', 'active', 'dormant') then
    raise exception 'That is not a relationship status.' using errcode = 'CR249';
  end if;
  if p_channel is not null and p_channel <> '' and p_channel not in ('whatsapp', 'call', 'email') then
    raise exception 'That is not a way to reach somebody.' using errcode = 'CR249';
  end if;
  if p_full_name is not null and nullif(trim(p_full_name), '') is null then
    raise exception 'A client needs a name.' using errcode = 'CR249';
  end if;
  /* The same number is the same person — a change may not collide with another client. */
  if p_phone_e164 is not null and p_phone_e164 <> '' and exists (
    select 1 from public.crm_clients c where c.phone_e164 = p_phone_e164 and c.id <> p_client
  ) then
    raise exception 'Another client already has that phone number.' using errcode = 'CR249';
  end if;
  if p_email is not null and p_email <> '' and exists (
    select 1 from public.crm_clients c where lower(c.email) = lower(trim(p_email)) and c.id <> p_client
  ) then
    raise exception 'Another client already has that email.' using errcode = 'CR249';
  end if;

  /* ⚠️ NULL MEANS "LEAVE IT"; an empty string means "clear it". */
  update public.crm_clients c set
    full_name         = coalesce(nullif(trim(p_full_name), ''), c.full_name),
    company           = case when p_company is null then c.company else nullif(trim(p_company), '') end,
    phone_e164        = case when p_phone_e164 is null then c.phone_e164 else nullif(trim(p_phone_e164), '') end,
    email             = case when p_email is null then c.email else lower(nullif(trim(p_email), '')) end,
    city              = case when p_city is null then c.city else nullif(trim(p_city), '') end,
    source            = case when p_source is null then c.source else nullif(p_source, '')::public.crm_lead_source end,
    owner_id          = coalesce(p_owner, c.owner_id),
    preferred_channel = case when p_channel is null then c.preferred_channel else nullif(p_channel, '') end,
    status            = coalesce(p_status, c.status),
    notes             = case when p_notes is null then c.notes else nullif(trim(p_notes), '') end,
    archived_at       = case when p_archive is null then c.archived_at
                             when p_archive then coalesce(c.archived_at, now()) else null end,
    updated_at        = now()
  where c.id = p_client;
  return true;
end;
$fn$;

-- ── 8 · Who already exists, for a whole import at once ──────────────────────

create or replace function app.crm_client_matches(p_phones text[], p_emails text[])
returns table (phone_e164 text, email text, kind text, full_name text, owner_name text, project_name text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  /* ⚠️ THE MINIMUM THAT STOPS A DUPLICATE, as 157's single check returns: a
     name, an owner, a project — never a number, a note or a value from a lead
     the caller cannot otherwise read. */
  select c.phone_e164, lower(c.email), 'client', c.full_name,
         (select u.full_name from public.users u where u.id = c.owner_id), null::text
    from public.crm_clients c
   where c.phone_e164 = any (p_phones) or lower(c.email) = any (p_emails)
  union all
  select l.phone_e164, lower(l.email), 'lead', l.full_name,
         (select u.full_name from public.users u where u.id = l.owner_id), app.crm_project_name(l.project_id)
    from public.crm_leads l
   where l.stage not in ('won', 'lost') and l.archived_at is null and l.client_id is null
     and (l.phone_e164 = any (p_phones) or lower(l.email) = any (p_emails))
$fn$;

grant execute on function app.crm_client_visible(uuid) to public;
grant execute on function app.crm_client_board() to public;
grant execute on function app.crm_client_activity(uuid, integer) to public;
grant execute on function app.crm_add_client(uuid, text, text, text, text, text, text, text, uuid, text, text, text, boolean) to public;
grant execute on function app.crm_update_client(uuid, text, text, text, text, text, text, uuid, text, text, text, boolean) to public;
grant execute on function app.crm_client_matches(text[], text[]) to public;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_admin uuid;
  v_member uuid;
  v_project uuid;
  n_admin integer;
  n_member integer;
  n_old integer;
  r record;
  g text;
begin
  select pg_get_functiondef('app.crm_greet_new_lead()'::regprocedure) into g;
  if position('crm_quiet_insert' in g) = 0 then
    raise exception '249 · the greeting does not stand down for a quiet insert' using errcode = 'CR249';
  end if;

  if exists (select 1 from public.crm_clients where ref_no is null) then
    raise exception '249 · a client has no number' using errcode = 'CR249';
  end if;

  select u.id into v_admin from public.users u where u.is_active and u.role in ('admin', 'super_admin') order by u.created_at limit 1;
  /* A salesperson who actually holds a client lead — the case that matters. */
  select l.owner_id into v_member
    from public.crm_leads l join public.users u on u.id = l.owner_id
   where l.client_id is not null and u.role = 'member' and u.is_active limit 1;

  /* ⚠️ THE NEW READER MUST SEE EXACTLY WHAT THE OLD ONE SAW, per person. */
  if v_admin is not null then
    perform set_config('app.user_id', v_admin::text, true);
    select count(*) into n_admin from app.crm_client_board();
    select count(*) into n_old from app.crm_client_list();
    if n_admin <> n_old then
      raise exception '249 · admin sees % clients on the new reader and % on the old', n_admin, n_old using errcode = 'CR249';
    end if;
    raise notice '249 · ✓ admin: % clients on both readers', n_admin;
  end if;
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    select count(*) into n_member from app.crm_client_board();
    select count(*) into n_old from app.crm_client_list();
    if n_member <> n_old then
      raise exception '249 · a salesperson sees % clients on the new reader and % on the old', n_member, n_old using errcode = 'CR249';
    end if;
    raise notice '249 · ✓ salesperson: % clients on both readers', n_member;
  else
    raise notice '249 · ⚠ no salesperson holds a client — the member comparison was NOT run';
  end if;

  /* ── Adding a client: a quiet, unwon lead, and refusal of a duplicate ─── */
  select p.id into v_project from public.projects p
   where exists (select 1 from public.crm_leads l where l.project_id = p.id) order by p.name limit 1;
  if v_admin is not null and v_project is not null then
    perform set_config('app.user_id', v_admin::text, true);
    select * into r from app.crm_add_client(
      v_project, '249 self-check', null, null, '249-selfcheck@example.invalid',
      null, 'Check Co', 'manual', null, 'email', 'prospect', null, false);
    if not exists (select 1 from public.crm_leads l where l.id = r.lead_id and l.stage = 'contacted' and l.client_id = r.client_id) then
      raise exception '249 · the added client has no contacted lead linked to it' using errcode = 'CR249';
    end if;
    if exists (select 1 from public.crm_lead_sequences s where s.lead_id = r.lead_id) then
      raise exception '249 · a quiet client was greeted' using errcode = 'CR249';
    end if;
    begin
      perform * from app.crm_add_client(
        v_project, '249 again', null, null, '249-selfcheck@example.invalid',
        null, null, 'manual', null, null, 'prospect', null, false);
      raise exception '249 · a duplicate client was accepted' using errcode = 'CR249';
    exception when sqlstate 'CR249' then
      if sqlerrm = '249 · a duplicate client was accepted' then raise; end if;
    end;
    /* ⚠️ PUT IT BACK — a self-check that leaves a lead on a live project has
       changed the business to test itself. */
    delete from public.crm_lead_assignments where lead_id = r.lead_id;
    delete from public.crm_lead_activity where lead_id = r.lead_id;
    delete from public.crm_leads where id = r.lead_id;
    delete from public.crm_clients where id = r.client_id;
    raise notice '249 · ✓ adding a client makes a quiet contacted lead, refuses the duplicate, and is cleaned up';
  end if;

  perform set_config('app.user_id', '', true);
  raise notice '249 · ✓ clients become relationships';
end
$chk$;
