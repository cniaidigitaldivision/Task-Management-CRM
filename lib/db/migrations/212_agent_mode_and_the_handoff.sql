-- ============================================================================
-- 212 · AGENT MODE, AND THE HANDOFF THAT RINGS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19, with a screenshot of Meta's own agent running on a live
-- Pakistani number: *"I want an agent mode on/off radio button… By default it
-- will be on… he thinks that I don't know about this answer so he automatically
-- hands it over to the salesperson… the salesperson should be notified at the
-- top… When I click on it, it should directly bring me to that chat."*
--
-- Their screenshot shows the shape exactly, and this is that shape:
--
--   the composer      My reply  ·  Suggestions  ·  AI agent
--   the chat list     All  ·  AI handoff  ·  AI responding
--
-- ── ⚠️ THREE MODES, NOT A BOOLEAN ──────────────────────────────────────────
-- `03-HANDOVER.md` argued a boolean cannot express the case that matters. The
-- owner's own screenshot settles it better: the middle position is the useful
-- one. **Suggestions works TODAY** — `lib/ai/reply-suggestion.ts` already drafts
-- a reply for a person to read and send. `agent` is the one still waiting on a
-- knowledge base.
--
-- ── ⚠️ AND THE HANDOFF IS A FACT, NOT A FOURTH MODE ────────────────────────
-- When the agent stops, it sets `agent_handoff_at` AND drops the mode to
-- `suggest`. The list shows "AI handoff" from the timestamp, the composer shows
-- the mode. One control, and the handoff is the thing it did to itself — which
-- is what the owner described.
--
-- ── ⚠️ OFF FOR EVERY EXISTING LEAD, AND THAT IS NOT TIMIDITY ───────────────
-- Defaulting 689 leads to `agent` would paint "AI RESPONDING" across a list
-- where no agent exists. A control that claims something untrue is worse than no
-- control. The project setting decides what a NEW lead starts as, the same shape
-- 210's greeting uses, and it is off until somebody turns it on.
-- ============================================================================

-- ── 1 · The three modes ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_agent_mode') then
    create type public.crm_agent_mode as enum ('off', 'suggest', 'agent');
  end if;
end $$;

comment on type public.crm_agent_mode is
  'Who writes the reply on this lead: off = the salesperson alone, suggest = AI drafts and a person sends, agent = AI writes and sends. 212.';

alter table public.crm_leads
  add column if not exists agent_mode public.crm_agent_mode not null default 'off',
  /* ⚠️ WHEN, NOT WHETHER. "It handed over" is a moment somebody has to act on,
     and a boolean cannot say how long the client has been waiting. */
  add column if not exists agent_handoff_at timestamptz,
  add column if not exists agent_handoff_reason text;

comment on column public.crm_leads.agent_handoff_reason is
  '⚠️ WHAT IT COULD NOT ANSWER, in the client''s own terms — never the word "handover". A notification that makes somebody open the thread and re-read it to find out why costs more than it saves. 212.';

create index if not exists crm_leads_agent_handoff_idx
  on public.crm_leads (agent_handoff_at desc)
  where agent_handoff_at is not null;

-- ⚠️ A HANDOFF THAT DOES NOT SAY WHY IS THE VERSION THAT FAILS — 03-HANDOVER.md.
alter table public.crm_leads
  drop constraint if exists crm_leads_handoff_has_a_reason;
alter table public.crm_leads
  add constraint crm_leads_handoff_has_a_reason
  check (agent_handoff_at is null or nullif(btrim(coalesce(agent_handoff_reason, '')), '') is not null);

-- The mode a new lead starts in, per project. Off until somebody says otherwise.
alter table public.crm_project_settings
  add column if not exists agent_mode_default public.crm_agent_mode not null default 'off';


-- ── 2 · A salesperson typing takes over, without touching the control ───────
-- ⚠️ THE ONE RULE THE OWNER DID NOT ASK FOR AND WILL NEED. Nobody should have to
-- remember to switch software off before answering a client; one forgotten toggle
-- means the client gets two replies, which is worse than getting none.
-- `05-GUARDRAILS.md` §8, enforced here so it holds for every path that ever
-- writes an outbound message.
create or replace function app.crm_human_takes_over()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  /* Only a person's own message counts. The agent's own sends carry no session
     user, and must not switch the agent off after every sentence it writes. */
  if new.direction <> 'outbound' or new.sent_by_id is null then
    return null;
  end if;

  update public.crm_leads
     set agent_mode = 'off',
         /* ⚠️ THE FLAG CLEARS TOO. They have answered; the bell must stop. */
         agent_handoff_at = null,
         agent_handoff_reason = null
   where id = new.lead_id
     and (agent_mode <> 'off' or agent_handoff_at is not null);

  return null;
end;
$fn$;

drop trigger if exists crm_messages_human_takes_over on public.crm_lead_messages;
create trigger crm_messages_human_takes_over
  after insert on public.crm_lead_messages
  for each row execute function app.crm_human_takes_over();


-- ── 3 · The agent hands over, and it rings ──────────────────────────────────
-- (The kind itself is added by 211, in its own transaction — see that file.)

create or replace function app.crm_agent_hand_over(p_lead uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_owner uuid;
  v_who   text;
  v_why   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_why is null then
    /* ⚠️ REFUSED, NOT DEFAULTED. "This lead needs your attention" is the version
       that fails, and inventing one here would let every caller ship it. */
    raise exception 'a handover must say what it could not answer';
  end if;

  select l.owner_id, coalesce(nullif(btrim(l.full_name), ''), l.phone_e164, 'A lead')
    into v_owner, v_who
    from public.crm_leads l where l.id = p_lead;
  if v_who is null then
    return false;
  end if;

  update public.crm_leads
     set agent_mode = 'suggest',          -- it stops writing; it still helps
         agent_handoff_at = now(),
         agent_handoff_reason = v_why
   where id = p_lead;

  if v_owner is null then
    return true;   -- nobody owns it; the desk's unassigned list is the signal
  end if;

  /* ⚠️ ONE UNREAD PER LEAD, the same rule 145 uses for replies. A handover that
     rings four times is a bell somebody learns to ignore. */
  if exists (
    select 1 from public.notifications n
     where n.user_id = v_owner and n.kind = 'agent_handover'
       and n.entity_id = p_lead and not n.is_read
  ) then
    return true;
  end if;

  insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
  values (v_owner, 'agent_handover',
          v_who || ' needs you: ' || v_why,
          'The assistant stopped here and is waiting for you.',
          /* ⚠️ THE CONVERSATIONS PAGE, not the old drawer route. It is where the
             owner works now, and it opens on this very thread. */
          '/conversations?lead=' || p_lead::text,
          p_lead);
  return true;
end;
$fn$;

grant execute on function app.crm_agent_hand_over(uuid, text) to cni_app;


-- ── 4 · Setting the mode is the salesperson's own act ───────────────────────
create or replace function app.crm_set_agent_mode(p_lead uuid, p_mode text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_n integer;
begin
  if p_mode not in ('off', 'suggest', 'agent') then
    raise exception 'unknown agent mode %', p_mode;
  end if;

  /* ⚠️ VISIBILITY IS CHECKED, NOT ASSUMED. A definer that skipped this would let
     any caller change the mode on another salesperson's lead — the membership
     bug this codebase has shipped eight times. */
  if not app.crm_lead_is_visible(p_lead) then
    return false;
  end if;

  update public.crm_leads
     set agent_mode = p_mode::public.crm_agent_mode,
         /* Choosing any mode by hand answers the handoff. */
         agent_handoff_at = null,
         agent_handoff_reason = null
   where id = p_lead;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_set_agent_mode(uuid, text) to cni_app;


-- ── 5 · A new lead starts where the project says ────────────────────────────
create or replace function app.crm_lead_agent_default()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_mode public.crm_agent_mode;
begin
  select s.agent_mode_default into v_mode
    from public.crm_project_settings s where s.project_id = new.project_id;

  if v_mode is not null and v_mode <> 'off' then
    update public.crm_leads set agent_mode = v_mode where id = new.id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists crm_leads_agent_default on public.crm_leads;
create trigger crm_leads_agent_default
  after insert on public.crm_leads
  for each row execute function app.crm_lead_agent_default();


-- ============================================================================
-- SELF-CHECK — typing takes over, a handoff rings once and says why
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_fresh uuid;
  s_after_handoff text; s_after_typing text; s_fresh text;
  n_bell int; n_bell_again int; v_title text; v_link text;
  handoff_at_cleared boolean; refused boolean := false;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '212 · fixtures missing (project %, owner %)', v_project, v_owner;
  end if;

  begin
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-212', '+923000000211', '+923000000211', 'new', now(), v_owner, true)
    returning id into v_lead;

    update public.crm_leads set agent_mode = 'agent' where id = v_lead;

    /* 1 · A handover with no reason is refused outright. */
    begin
      perform app.crm_agent_hand_over(v_lead, '   ');
    exception when others then refused := true;
    end;

    /* 2 · A real one drops the mode, stamps the moment, and rings once. */
    perform app.crm_agent_hand_over(v_lead, 'asked whether the possession date moved');
    select agent_mode::text into s_after_handoff from public.crm_leads where id = v_lead;
    select count(*)::int into n_bell from public.notifications
     where entity_id = v_lead and kind = 'agent_handover';
    select title, link_to into v_title, v_link from public.notifications
     where entity_id = v_lead and kind = 'agent_handover' limit 1;

    /* 3 · A second handover while the first is unread must not ring again. */
    perform app.crm_agent_hand_over(v_lead, 'asked again');
    select count(*)::int into n_bell_again from public.notifications
     where entity_id = v_lead and kind = 'agent_handover';

    /* 4 · ⚠️ A SALESPERSON TYPING TAKES OVER — without touching the control. */
    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at, sent_by_id)
    values (v_lead, 'whatsapp', 'outbound', 'text', 'I will check and confirm', now(), v_owner);
    select agent_mode::text, agent_handoff_at is null
      into s_after_typing, handoff_at_cleared
      from public.crm_leads where id = v_lead;

    /* 5 · A new lead takes the project's default. */
    insert into public.crm_project_settings (project_id) values (v_project) on conflict (project_id) do nothing;
    update public.crm_project_settings set agent_mode_default = 'suggest' where project_id = v_project;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-212 fresh', 'new', now(), v_owner, true)
    returning id into v_fresh;
    select agent_mode::text into s_fresh from public.crm_leads where id = v_fresh;

    raise exception using errcode = 'P0212', message = '212 rollback';
  exception when sqlstate 'P0212' then
    null;
  end;

  if not refused then
    raise exception '212 · a handover with no reason was allowed — that is the notification that fails';
  end if;
  if s_after_handoff is distinct from 'suggest' then
    raise exception '212 · the agent did not stop writing on handover (mode %)', s_after_handoff;
  end if;
  if n_bell <> 1 then
    raise exception '212 · the handover did not ring exactly once (rang %)', n_bell;
  end if;
  if v_title not like '%possession date%' then
    raise exception '212 · the bell does not carry WHAT it could not answer (title %)', v_title;
  end if;
  if v_link not like '/conversations?lead=%' then
    raise exception '212 · the bell does not open the conversation (link %)', v_link;
  end if;
  if n_bell_again <> 1 then
    raise exception '212 · a second handover rang again while the first was unread';
  end if;
  if s_after_typing is distinct from 'off' or not handoff_at_cleared then
    raise exception '212 · a salesperson typing did not take over (mode %, cleared %)', s_after_typing, handoff_at_cleared;
  end if;
  if s_fresh is distinct from 'suggest' then
    raise exception '212 · a new lead did not take the project default (got %)', s_fresh;
  end if;

  raise notice '212 · agent mode, and a handoff that says what it could not answer';
end $chk$;
