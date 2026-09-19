-- ============================================================================
-- 210 · THE GREETING ANSWERS FIRST — and a template may finally carry a name
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"The most important thing over here is that I want a basic
-- greeting message that should be automatically sent… when a new lead arrives…
-- by their lead name."* And: *"Right now I want to implement everything that
-- will be working with the sandbox. I have added 4 to 5 recipients."*
--
-- The plan is `docs/crm-ai/07-THE-GREETING-AND-AGENT-MODE.md`. Two things here:
--
--   1. A step may carry its template's VARIABLES, so a greeting can say a name.
--   2. A project may have a greeting, and a lead arriving starts it.
--
-- ── ⚠️ NO NEW SENDING MACHINERY, AND THAT IS THE POINT ─────────────────────
-- The greeting is a one-step sequence with `delay_days = 0`. The engine, the
-- 24-hour window, the claim guard (204), the thread write (190), and the
-- pause-on-reply (208) all already exist and are proved. Building a second
-- sending path for "just the greeting" would be a second place for every one of
-- those rules to be got wrong.
--
-- ── ⚠️ ONE SHARED SEQUENCE PER PROJECT, ONE RUN PER LEAD ───────────────────
-- Not a sequence per lead: 660 leads a month would be 1,980 rows for one
-- sentence. `crm_sequences.lead_id` is nullable precisely so a project-level
-- template can exist, which is what 153 built.
--
-- ── ⚠️ OFF BY DEFAULT, AND NEVER RETROACTIVE ───────────────────────────────
-- `greeting_on` starts FALSE for every project, so applying this migration sends
-- nothing to anybody. And it is an INSERT trigger, so by construction it can
-- only ever reach leads that arrive AFTER it is switched on — 688 of 689 leads
-- have `whatsapp_consent` NULL, and a backfill would message the whole database
-- in one run (`docs/crm-ai/05-GUARDRAILS.md` §5).
-- ============================================================================

-- ── 1 · A step's template variables, in Meta's own order ────────────────────
-- ⚠️ TOKEN NAMES, NOT VALUES. Storing "Ali" would freeze a name into a plan; the
-- names here are the ones `app.crm_followup_tokens` already resolves at send
-- time — lead_first_name, company, my_first_name and the rest.
alter table public.crm_sequence_steps
  add column if not exists wa_template_vars text[];

comment on column public.crm_sequence_steps.wa_template_vars is
  'Token names filling {{1}}, {{2}}… of wa_template_name, in Meta''s order. Resolved at send time by app.crm_followup_tokens, never stored as values. 210.';


-- ── 2 · A project's greeting ────────────────────────────────────────────────
alter table public.crm_project_settings
  add column if not exists greeting_on boolean not null default false,
  add column if not exists greeting_template_name text,
  add column if not exists greeting_template_language text,
  add column if not exists greeting_vars text[];

comment on column public.crm_project_settings.greeting_on is
  '⚠️ FALSE FOR EVERY PROJECT UNTIL SOMEBODY TURNS IT ON. True means a lead arriving with a phone number is greeted at once. 210.';

-- ⚠️ A GREETING THAT IS ON MUST HAVE SOMETHING TO SEND. Without the template
-- name the window is shut for 96% of leads and the step would sit there for ever
-- being refused — a feature that looks on and does nothing.
alter table public.crm_project_settings
  drop constraint if exists crm_project_settings_greeting_needs_template;
alter table public.crm_project_settings
  add constraint crm_project_settings_greeting_needs_template
  check (not greeting_on or nullif(btrim(coalesce(greeting_template_name, '')), '') is not null);


-- ── 3 · The one shared greeting sequence, found or made ─────────────────────
create or replace function app.crm_project_greeting_sequence(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_seq uuid;
  v_set record;
begin
  select * into v_set from public.crm_project_settings where project_id = p_project;
  if not found or not v_set.greeting_on then
    return null;
  end if;

  select s.id into v_seq
    from public.crm_sequences s
   where s.project_id = p_project and s.lead_id is null and s.name = 'Greeting'
   limit 1;

  if v_seq is null then
    /* ⚠️ `is_test_data` FALSE: this row is CONFIGURATION, not sample data, and a
       demo-data sweep must not take a project's greeting with it.
       ⚠️ AND IT RUNS AT ANY HOUR. An instant answer is the entire feature; making
       it wait for 10 AM would turn "answered in seconds" into "answered
       tomorrow", which is the thing being fixed. */
    insert into public.crm_sequences
      (project_id, lead_id, name, purpose, stop_on_reply, stop_on_visit, stop_on_quotation_dead,
       send_from_hour, send_to_hour, send_days, is_active, is_test_data)
    values (p_project, null, 'Greeting', 'custom', true, false, false,
            0, 24, array[0,1,2,3,4,5,6]::smallint[], true, false)
    returning id into v_seq;
  end if;

  /* ⚠️ THE STEP IS REWRITTEN FROM THE SETTINGS EVERY TIME, so changing the
     template in settings cannot leave a stale name on the step. Two places
     holding "which template" is how a project sends last month's wording. */
  insert into public.crm_sequence_steps
    (sequence_id, step_no, channel, delay_days, purpose, title, body, mode,
     only_if_no_reply, wa_template_name, wa_template_language, wa_template_vars)
  values (v_seq, 1, 'whatsapp', 0, 'custom', 'Greeting',
          'Assalam-o-Alaikum {{lead_first_name}}, thank you for your enquiry with {{company}}. How can I help?',
          'auto_send', false,
          nullif(btrim(coalesce(v_set.greeting_template_name, '')), ''),
          coalesce(nullif(btrim(coalesce(v_set.greeting_template_language, '')), ''), 'en'),
          v_set.greeting_vars)
  on conflict (sequence_id, step_no) do update
     set wa_template_name = excluded.wa_template_name,
         wa_template_language = excluded.wa_template_language,
         wa_template_vars = excluded.wa_template_vars,
         body = excluded.body,
         mode = excluded.mode;

  return v_seq;
end;
$fn$;

grant execute on function app.crm_project_greeting_sequence(uuid) to cni_app;


-- ── 4 · A lead arrives, and is answered ─────────────────────────────────────
create or replace function app.crm_greet_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_seq uuid;
begin
  /* Nothing to send to. */
  if new.phone_e164 is null then
    return null;
  end if;

  /* ⚠️ A STATED NO IS FINAL. NULL is "nobody asked", which for a person who has
     just handed us their number and asked to be contacted is the case this
     feature exists for — but FALSE is a refusal and outranks everything. */
  if new.whatsapp_consent is false then
    return null;
  end if;

  /* ⚠️⚠️ AND NOT A BACKLOG. An import of six months of old leads is not six
     hundred people arriving; greeting them would be the single incident
     §5 of the guardrails is about. A lead is "arriving" for one day only. */
  if new.submitted_at < now() - interval '1 day' then
    return null;
  end if;

  /* The project must actually be able to send. */
  if not exists (
    select 1 from public.projects p
     where p.id = new.project_id and p.whatsapp_phone_number_id is not null
  ) then
    return null;
  end if;

  v_seq := app.crm_project_greeting_sequence(new.project_id);
  if v_seq is null then
    return null;   -- greeting off for this project
  end if;

  /* ⚠️ ONE RUN, EVEN IF SOMETHING RE-RUNS THIS. A second greeting to the same
     person is worse than none — it reads as a broken system on the first
     sentence they ever get from the business. */
  if exists (
    select 1 from public.crm_lead_sequences ls
     where ls.lead_id = new.id and ls.sequence_id = v_seq
  ) then
    return null;
  end if;

  insert into public.crm_lead_sequences
    (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at)
  values (new.id, v_seq, 'scheduled', 0, 1, now(), now());

  return null;
end;
$fn$;

drop trigger if exists crm_leads_greet on public.crm_leads;
create trigger crm_leads_greet
  after insert on public.crm_leads
  for each row execute function app.crm_greet_new_lead();


-- ── 5 · The queue hands the sender the variables ────────────────────────────
-- Reproduced from the live 204 definition with ONE column added.
--
-- ⚠️ DROPPED FIRST, BECAUSE `create or replace` CANNOT WIDEN A RETURN TYPE.
-- Postgres refuses with "cannot change return type of existing function" when the
-- OUT parameters differ, and the only caller is the sender, which is redeployed
-- with this.
drop function if exists app.crm_followups_to_send(integer);

create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
  channel text, title text, body text, subject text, lead_name text,
  to_phone text, to_email text, template_name text, template_language text,
  template_vars text[], document_ids uuid[], window_open boolean,
  wa_phone_number_id text, sender_name text, project_name text
)
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
         left join public.crm_lead_sequences ls on ls.id = c.lead_sequence_id
         left join public.crm_sequence_steps st
                on st.sequence_id = ls.sequence_id and st.step_no = c.sequence_step_no
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          and (
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             and l.whatsapp_consent is distinct from false
             and (app.crm_window_is_open(c.lead_id) or nullif(st.wa_template_name, '') is not null))
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
         nullif(st.wa_template_name, ''), coalesce(nullif(st.wa_template_language, ''), 'en'),
         st.wa_template_vars,
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
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

comment on function app.crm_followups_to_send(integer) is
  'Claims and returns what the sender should send now. 187, widened in 202, claim added in 204, template variables in 210.';


-- ============================================================================
-- SELF-CHECK — it greets a new arrival, and refuses every case it should
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid;
  v_new uuid; v_old uuid; v_nophone uuid; v_refused uuid;
  n_new int; n_old int; n_nophone int; n_refused int; n_off int;
  v_seq uuid; v_tpl text; v_vars text[];
  v_had record;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null
   limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '210 · fixtures missing (project %, owner %)', v_project, v_owner;
  end if;

  begin
    /* ⚠️ THE SETTINGS ROW IS RESTORED BY THE ROLLBACK, like everything else —
       but the check must not assume one exists. */
    insert into public.crm_project_settings (project_id) values (v_project)
      on conflict (project_id) do nothing;

    /* 1 · With the greeting OFF, a new lead must be left entirely alone. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-210 off', '+923000000210', '+923000000210', 'new', now(), v_owner, true)
    returning id into v_old;
    select count(*)::int into n_off from public.crm_lead_sequences where lead_id = v_old;

    /* Now switch it on. */
    update public.crm_project_settings
       set greeting_on = true,
           greeting_template_name = 'selfcheck_greeting',
           greeting_template_language = 'en',
           greeting_vars = array['lead_first_name', 'company']
     where project_id = v_project;

    /* 2 · A lead arriving now, with a number → greeted. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-210 new', '+923000000211', '+923000000211', 'new', now(), v_owner, true)
    returning id into v_new;

    /* 3 · ⚠️ AN OLD LEAD BEING IMPORTED IS NOT SOMEBODY ARRIVING. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-210 backlog', '+923000000212', '+923000000212', 'new',
            now() - interval '40 days', v_owner, true)
    returning id into v_old;

    /* 4 · No number to send to. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-210 no phone', 'new', now(), v_owner, true)
    returning id into v_nophone;

    /* 5 · A stated no outranks everything. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data, whatsapp_consent)
    values (v_project, 'manual', 'SELFCHECK-210 refused', '+923000000213', '+923000000213', 'new', now(), v_owner, true, false)
    returning id into v_refused;

    select count(*)::int into n_new     from public.crm_lead_sequences where lead_id = v_new;
    select count(*)::int into n_old     from public.crm_lead_sequences where lead_id = v_old;
    select count(*)::int into n_nophone from public.crm_lead_sequences where lead_id = v_nophone;
    select count(*)::int into n_refused from public.crm_lead_sequences where lead_id = v_refused;

    select s.id into v_seq from public.crm_sequences s
     where s.project_id = v_project and s.lead_id is null and s.name = 'Greeting';
    select st.wa_template_name, st.wa_template_vars into v_tpl, v_vars
      from public.crm_sequence_steps st where st.sequence_id = v_seq and st.step_no = 1;

    raise exception using errcode = 'P0210', message = '210 rollback';
  exception when sqlstate 'P0210' then
    null;
  end;

  if n_off <> 0 then
    raise exception '210 · a lead was greeted while the greeting was switched off';
  end if;
  if n_new <> 1 then
    raise exception '210 · a lead arriving with a number was not greeted (runs: %)', n_new;
  end if;
  if n_old <> 0 then
    raise exception '210 · a backlog import was greeted — that is the mass-message incident';
  end if;
  if n_nophone <> 0 then
    raise exception '210 · a lead with no number was queued a WhatsApp greeting';
  end if;
  if n_refused <> 0 then
    raise exception '210 · a lead who said no was greeted';
  end if;
  if v_tpl is distinct from 'selfcheck_greeting' then
    raise exception '210 · the step did not take its template from the settings (got %)', v_tpl;
  end if;
  if v_vars is distinct from array['lead_first_name', 'company'] then
    raise exception '210 · the step did not carry its template variables (got %)', v_vars;
  end if;

  raise notice '210 · a new arrival is greeted; a backlog, a refusal and a lead with no number are not';
end $chk$;
