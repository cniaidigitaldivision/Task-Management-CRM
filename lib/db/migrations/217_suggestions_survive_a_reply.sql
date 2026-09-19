-- ============================================================================
-- 217 · SUGGESTIONS SURVIVE THE SALESPERSON'S OWN REPLY
-- ----------------------------------------------------------------------------
-- 212 made a salesperson typing take over from the agent — the right rule, with
-- the wrong edge. Its trigger set `agent_mode = 'off'` on ANY outbound message a
-- person sent. But in `suggest` mode a person sends EVERY message; that is what
-- the mode is. So the first reply sent from a suggestion would have switched
-- Suggestions off behind the salesperson's back — the owner's screenshot shows
-- it as a standing choice ("AI suggests, you send"), not a one-shot.
--
-- Caught reading 212 against the owner's own design before the control shipped,
-- not by a user.
--
--   agent    + a person sends  →  off     (they took over — 05-GUARDRAILS §8)
--   suggest  + a person sends  →  suggest (unchanged — this is the mode working)
--   off      + a person sends  →  off
--
-- ⚠️ THE HANDOFF STILL CLEARS IN EVERY MODE. A salesperson answering is the
-- answer to the bell, whichever mode the thread is in.
-- ============================================================================

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
     set agent_mode = case when agent_mode = 'agent' then 'off'::public.crm_agent_mode
                           else agent_mode end,
         agent_handoff_at = null,
         agent_handoff_reason = null
   where id = new.lead_id
     and (agent_mode = 'agent' or agent_handoff_at is not null);

  return null;
end;
$fn$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_sug uuid; v_agent uuid;
  m_sug text; m_agent text; h_cleared boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;

  begin
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data, agent_mode)
    values (v_project, 'manual', 'SELFCHECK-217 suggest', 'new', now(), v_owner, true, 'suggest')
    returning id into v_sug;
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data,
                                  agent_mode, agent_handoff_at, agent_handoff_reason)
    values (v_project, 'manual', 'SELFCHECK-217 agent', 'new', now(), v_owner, true,
            'agent', now(), 'asked for a discount')
    returning id into v_agent;

    insert into public.crm_lead_messages (lead_id, channel, direction, kind, body, occurred_at, sent_by_id)
    values (v_sug,   'whatsapp', 'outbound', 'text', 'Sent from a suggestion', now(), v_owner),
           (v_agent, 'whatsapp', 'outbound', 'text', 'I will take this one',   now(), v_owner);

    select agent_mode::text into m_sug from public.crm_leads where id = v_sug;
    select agent_mode::text, agent_handoff_at is null into m_agent, h_cleared
      from public.crm_leads where id = v_agent;

    raise exception using errcode = 'P0217', message = '217 rollback';
  exception when sqlstate 'P0217' then
    null;
  end;

  if m_sug is distinct from 'suggest' then
    raise exception '217 · sending a suggested reply switched Suggestions off (now %)', m_sug;
  end if;
  if m_agent is distinct from 'off' then
    raise exception '217 · a salesperson replying did not take over from the agent (now %)', m_agent;
  end if;
  if not h_cleared then
    raise exception '217 · the handoff was not cleared by the salesperson''s reply';
  end if;

  raise notice '217 · suggestions survive a reply; the agent still steps aside when a person writes';
end $chk$;
